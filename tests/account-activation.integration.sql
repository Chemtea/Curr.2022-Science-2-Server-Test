-- Exact test project only. Synthetic fixtures are entirely rolled back on success.
-- Run after account-activation.sql, using the authorized SQL migration write path.
do $$
declare
  v_account uuid:=gen_random_uuid(); v_other uuid:=gen_random_uuid();
  v_login text:='activation_test_'||replace(gen_random_uuid()::text,'-','');
  v_other_login text:='activation_other_'||replace(gen_random_uuid()::text,'-','');
  v_admin_hash text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
  v_ip text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
  v_result jsonb; v_count integer; v_i integer;
begin
 begin
  if has_function_privilege('anon','public.activation_redeem(text,integer,text,text,text)','EXECUTE')
     or has_function_privilege('authenticated','public.activation_admin(text,text,uuid,text)','EXECUTE') then
    raise exception 'TEST_FAILED: public activation RPC privilege'; end if;
  if not has_function_privilege('service_role','public.activation_redeem(text,integer,text,text,text)','EXECUTE') then
    raise exception 'TEST_FAILED: service cannot activate'; end if;
  insert into public.app_users(id,login_id,name,school_year,status,account_type,password_hash)
    values(v_account,v_login,'Synthetic activation fixture',2026,'등록대기','student',''),
          (v_other,v_other_login,'Synthetic activation other',2026,'등록대기','student','');
  insert into public.app_sessions(token_hash,account_id,session_type,login_id,display_name,account_type,school_year,permissions,expires_at)
    values(v_admin_hash,null,'admin','admin','Synthetic activation verifier','admin',null,'{}',now()+interval '5 minutes');
  v_result:=public.activation_admin(repeat('0',64),'list');
  if v_result->>'status'<>'401' then raise exception 'TEST_FAILED: unknown teacher session'; end if;
  update public.app_sessions set expires_at=now()-interval '1 second' where token_hash=v_admin_hash;
  v_result:=public.activation_admin(v_admin_hash,'list');
  if v_result->>'status'<>'401' then raise exception 'TEST_FAILED: expired teacher session'; end if;
  update public.app_sessions set expires_at=now()+interval '5 minutes' where token_hash=v_admin_hash;
  v_result:=public.activation_admin(v_admin_hash,'issue',v_account,repeat('1',64));
  if v_result->>'success'<>'true' then raise exception 'TEST_FAILED: teacher cannot issue'; end if;
  v_result:=public.activation_redeem(v_other_login,2026,repeat('1',64),repeat('9',64),v_ip);
  if v_result->>'success'<>'false' then raise exception 'TEST_FAILED: invitation not bound to account'; end if;
  v_result:=public.activation_admin(v_admin_hash,'issue',v_account,repeat('2',64));
  v_result:=public.activation_redeem(v_login,2026,repeat('1',64),repeat('9',64),v_ip);
  if v_result->>'success'<>'false' then raise exception 'TEST_FAILED: replaced code remained valid'; end if;
  update public.account_activation_codes set expires_at=now()-interval '1 second' where account_id=v_account and code_hash=repeat('2',64);
  v_result:=public.activation_redeem(v_login,2026,repeat('2',64),repeat('9',64),v_ip);
  if v_result->>'success'<>'false' then raise exception 'TEST_FAILED: expired code accepted'; end if;
  v_result:=public.activation_admin(v_admin_hash,'issue',v_account,repeat('3',64));
  v_result:=public.activation_redeem(v_login,2026,repeat('3',64),repeat('9',64),v_ip);
  if v_result->>'success'<>'true' then raise exception 'TEST_FAILED: valid activation rejected'; end if;
  select count(*) into v_count from public.app_users where id=v_account and password_hash=repeat('9',64) and status='등록완료';
  if v_count<>1 then raise exception 'TEST_FAILED: first password missing'; end if;
  select count(*) into v_count from public.account_activation_codes where account_id=v_account and code_hash=repeat('3',64) and consumed_at is not null;
  if v_count<>1 then raise exception 'TEST_FAILED: successful code not consumed'; end if;
  v_result:=public.activation_redeem(v_login,2026,repeat('3',64),repeat('8',64),v_ip);
  if v_result->>'success'<>'false' then raise exception 'TEST_FAILED: code reused'; end if;
  v_result:=public.activation_admin(v_admin_hash,'issue',v_account,repeat('4',64));
  if v_result->>'status'<>'409' then raise exception 'TEST_FAILED: registered account reactivated'; end if;
  select count(*) into v_count from public.app_users where id=v_account and password_hash=repeat('9',64);
  if v_count<>1 then raise exception 'TEST_FAILED: second attempt changed password'; end if;
  v_result:=public.activation_admin(v_admin_hash,'issue',v_other,repeat('5',64));
  v_result:=public.activation_admin(v_admin_hash,'revoke',v_other);
  v_result:=public.activation_redeem(v_other_login,2026,repeat('5',64),repeat('9',64),v_ip);
  if v_result->>'success'<>'false' then raise exception 'TEST_FAILED: revoked code accepted'; end if;
  update public.app_users set guardian_consent_required=true,guardian_consent_verified=false where id=v_other;
  v_result:=public.activation_admin(v_admin_hash,'issue',v_other,repeat('6',64));
  if v_result->>'status'<>'409' then raise exception 'TEST_FAILED: unverified guardian requirement ignored'; end if;
  update public.app_users set guardian_consent_verified=true where id=v_other;
  v_result:=public.activation_admin(v_admin_hash,'issue',v_other,repeat('6',64));
  if v_result->>'success'<>'true' then raise exception 'TEST_FAILED: verified guardian requirement rejected'; end if;
  update public.app_users set guardian_consent_verified=false where id=v_other;
  v_result:=public.activation_redeem(v_other_login,2026,repeat('6',64),repeat('9',64),v_ip);
  if v_result->>'success'<>'false' then raise exception 'TEST_FAILED: guardian verification not rechecked at redeem'; end if;
  for v_i in 1..5 loop
    v_result:=public.activation_redeem(v_other_login,2026,repeat('0',64),repeat('9',64),v_ip);
  end loop;
  if v_result->>'status'<>'429' then raise exception 'TEST_FAILED: repeated guesses not limited'; end if;
  if public.activation_account_pending('{"status":"등록대기","login_id":"admin","password_hash":""}') or
     public.activation_account_pending('{"status":"등록대기","login_id":"test","is_active":false,"password_hash":""}') then
    raise exception 'TEST_FAILED: disabled or admin activation permitted'; end if;
  raise exception using errcode='ZX001',message='ACTIVATION_TEST_ROLLBACK';
 exception when sqlstate 'ZX001' then null;
 end;
 raise notice 'PASS: teacher authentication, account binding, reissue/revoke/expiry, single use, no password overwrite, throttling and private RPC grants';
end;
$$;
