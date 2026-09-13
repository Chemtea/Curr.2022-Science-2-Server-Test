-- Synthetic-only transaction checks, rolled back automatically. Exact test target only.
do $$
declare
 a uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); r uuid:=gen_random_uuid();
 k text:='assessment_test_'||replace(gen_random_uuid()::text,'-','');
 p jsonb; first_result jsonb; next_result jsonb; count_rows integer;
begin
 begin
  if has_function_privilege('anon','public.assessment_submit_atomic(jsonb)','EXECUTE') or has_function_privilege('authenticated','public.assessment_submit_atomic(jsonb)','EXECUTE') then raise exception 'TEST_FAILED: public submit RPC'; end if;
  if has_table_privilege('anon','public.assessment_submissions','SELECT') or has_table_privilege('authenticated','public.assessment_submissions','SELECT') then raise exception 'TEST_FAILED: public table'; end if;
  insert into public.app_users(id,login_id,name,school_year,status,account_type) values(a,k,'Synthetic assessment student',2026,'등록완료','student');
  insert into public.content_items(id,kind,title,unit_id,lesson_id,format,content,published,student_access) values(c,'assessment','Synthetic assessment','assessment_test_eval','assessment_test_l1','html','"<p>Test</p>"',true,true);
  update public.app_settings set setting_value=jsonb_build_object('evalHallVisibilityMode','all','assessment_test_eval',jsonb_build_object('isLocked',false,'lessons',jsonb_build_object('assessment_test_l1',false))) where setting_key='lock_states';
  p:=jsonb_build_object('content_id',c,'account_id',a,'slot','data','request_id',r,'content_version',1,'payload',jsonb_build_object('fields',jsonb_build_object('response','test')),'payload_hash',repeat('a',64),'byte_size',30);
  first_result:=public.assessment_submit_atomic(p);
  if first_result->>'revision'<>'1' or first_result->>'duplicate'<>'false' then raise exception 'TEST_FAILED: first submit'; end if;
  next_result:=public.assessment_submit_atomic(p);
  if next_result->>'id'<>first_result->>'id' or next_result->>'duplicate'<>'true' then raise exception 'TEST_FAILED: retry'; end if;
  begin perform public.assessment_submit_atomic(p||jsonb_build_object('payload_hash',repeat('b',64))); raise exception 'TEST_FAILED: changed retry'; exception when raise_exception then if sqlerrm<>'ASSESSMENT_RETRY_CONFLICT' then raise; end if; end;
  p:=p||jsonb_build_object('request_id',gen_random_uuid());
  begin perform public.assessment_submit_atomic(p);raise exception 'TEST_FAILED: second submit accepted';exception when raise_exception then if sqlerrm<>'ASSESSMENT_ALREADY_SUBMITTED' then raise; end if;end;
  perform public.assessment_set_resubmit(c,a,'data',true,'synthetic-admin');
  next_result:=public.assessment_submit_atomic(p);
  if next_result->>'revision'<>'2' then raise exception 'TEST_FAILED: permitted revision'; end if;
  select count(*) into count_rows from public.assessment_submissions where content_id=c and account_id=a;
  if count_rows<>2 then raise exception 'TEST_FAILED: old submission missing'; end if;
  if exists(select 1 from public.assessment_resubmit_permissions where content_id=c and account_id=a and allowed) then raise exception 'TEST_FAILED: permission not consumed'; end if;
  update public.content_items set published=false where id=c;
  begin perform public.assessment_submit_atomic(p);raise exception 'TEST_FAILED: locked retry';exception when raise_exception then if sqlerrm<>'ASSESSMENT_LOCKED' then raise; end if;end;
  update public.content_items set published=true,version=2 where id=c;
  begin perform public.assessment_submit_atomic(p||jsonb_build_object('request_id',gen_random_uuid()));raise exception 'TEST_FAILED: stale version';exception when raise_exception then if sqlerrm<>'ASSESSMENT_VERSION_CONFLICT' then raise; end if;end;
  update public.app_users set status='등록대기' where id=a;
  begin perform public.assessment_submit_atomic(p);raise exception 'TEST_FAILED: pending user';exception when raise_exception then if sqlerrm<>'ASSESSMENT_FORBIDDEN' then raise; end if;end;
  raise exception using errcode='ZA001',message='Assessment tests complete, discard fixtures';
 exception when sqlstate 'ZA001' then null;
 end;
end $$;
