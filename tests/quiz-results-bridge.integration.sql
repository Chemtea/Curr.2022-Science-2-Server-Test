-- TEST TARGET ONLY: rerykeslgwhamreoskgx.
-- Run after both content-platform.sql and quiz-results-bridge.sql.
-- Every fixture and result is synthetic and rolled back in a subtransaction.
-- Can accompany the bridge in one apply_migration; only migration history stays.
-- No existing student
-- records, credentials, submitted answers, point rules, or locks are changed.
do $$
declare
  v_account uuid := gen_random_uuid();
  v_content uuid := gen_random_uuid();
  v_blocked uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_key text := 'bridge_test_' || replace(gen_random_uuid()::text,'-','');
  v_first jsonb;
  v_retry jsonb;
  v_second jsonb;
  v_expected integer;
  v_count integer;
  v_row record;
begin
 begin
  if has_function_privilege('anon','public.content_record_quiz(uuid,uuid,uuid,jsonb,jsonb,integer)','EXECUTE') or
     has_function_privilege('authenticated','public.content_record_quiz(uuid,uuid,uuid,jsonb,jsonb,integer)','EXECUTE') then
    raise exception 'TEST_FAILED: public role can execute grading';
  end if;
  if not has_function_privilege('service_role','public.content_record_quiz(uuid,uuid,uuid,jsonb,jsonb,integer)','EXECUTE') then
    raise exception 'TEST_FAILED: server role cannot grade';
  end if;
  insert into public.app_users(id,login_id,name,school_year,status,account_type)
    values(v_account,v_key,'Synthetic bridge verification',2026,'등록완료','student');
  insert into public.content_items(id,kind,title,unit_id,lesson_id,format,content,quiz_data,has_quiz,published,student_access)
    values(v_content,'lesson','Synthetic bridge quiz',v_key,v_key,'lesson-pack','{"schema":"science-lesson/v1"}',
      '[{"correct":2,"choices":3,"explanation":"Synthetic Q1"},{"correct":1,"choices":2,"explanation":"Synthetic Q2"}]',true,true,true);
  select coalesce(points,0)::integer into v_expected from public.point_rules
    where active=true and min_accuracy<=50 order by min_accuracy desc,id asc limit 1;
  v_expected := coalesce(v_expected,0);

  -- Forged result is intentionally wrong: only actual choices determine 1/2.
  v_first := public.content_record_quiz(v_content,v_account,v_request,'[2,2]',
    '{"score":999,"total":999,"awardedPoints":999999}',1);
  if (v_first->>'score')::integer <> 1 or (v_first->>'total')::integer <> 2 or
     (v_first->>'awardedPoints')::integer <> v_expected or
     (v_first->>'currentPoints')::integer <> v_expected or
     v_first->>'dashboardSaved' <> 'true' then raise exception 'TEST_FAILED: trusted grading or reward'; end if;
  select score,total,q1,q2,q3,attempt_no,lesson_key into v_row from public.learning_submissions
    where account_id=v_account;
  if v_row.score <> 1 or v_row.total <> 2 or v_row.q1 <> 'O' or v_row.q2 <> 'X' or
     v_row.q3 <> '-' or v_row.attempt_no <> 1 or v_row.lesson_key <> v_key then
    raise exception 'TEST_FAILED: dashboard projection';
  end if;

  v_retry := public.content_record_quiz(v_content,v_account,v_request,'[2,2]','{}',1);
  if v_retry->>'submissionId' <> v_first->>'submissionId' or v_retry->>'duplicate' <> 'true' then
    raise exception 'TEST_FAILED: retry identity';
  end if;
  select count(*) into v_count from public.learning_submissions where account_id=v_account;
  if v_count <> 1 then raise exception 'TEST_FAILED: retry inserted dashboard row'; end if;
  select count(*) into v_count from public.content_quiz_attempts where account_id=v_account;
  if v_count <> 1 then raise exception 'TEST_FAILED: retry inserted answer row'; end if;
  select count(*) into v_count from public.point_ledger where account_id=v_account;
  if v_count <> (case when v_expected>0 then 1 else 0 end) then raise exception 'TEST_FAILED: retry credited again'; end if;
  begin
    perform public.content_record_quiz(v_content,v_account,v_request,'[1,1]','{}',1);
    raise exception 'TEST_FAILED: changed retry answers accepted';
  exception when raise_exception then
    if sqlerrm <> 'QUIZ_RETRY_CONFLICT' then raise; end if;
  end;

  v_second := public.content_record_quiz(v_content,v_account,gen_random_uuid(),'[2,1]','{}',1);
  if (v_second->>'score')::integer <> 2 or (v_second->>'awardedPoints')::integer <> 0 or
     (v_second->>'currentPoints')::integer <> v_expected or
     (v_second->>'attemptNo')::integer <> 2 then raise exception 'TEST_FAILED: repeat credit or attempt'; end if;
  select first_score,best_score,last_score,attempt_count,awarded_points into v_row
    from public.first_submissions where account_id=v_account and lesson_key=v_key;
  if v_row.first_score<>1 or v_row.best_score<>2 or v_row.last_score<>2 or
     v_row.attempt_count<>2 or v_row.awarded_points<>v_expected then
    raise exception 'TEST_FAILED: first/best result history';
  end if;
  select count(*) into v_count from public.content_quiz_attempts
    where account_id=v_account and answers='[2,1]'::jsonb and result->>'dashboardSaved'='true';
  if v_count<>1 then raise exception 'TEST_FAILED: choices not retained privately'; end if;

  -- The existing login contract includes approved external learner accounts.
  update public.app_users set account_type='external',status='승인완료' where id=v_account;
  v_second := public.content_record_quiz(v_content,v_account,gen_random_uuid(),'[2,1]','{}',1);
  if (v_second->>'attemptNo')::integer <> 3 or (v_second->>'awardedPoints')::integer <> 0 then
    raise exception 'TEST_FAILED: approved external learner rejected';
  end if;
  -- Change only the fixture's login, not the existing teacher row. Spaces and
  -- case also prove the reserved teacher ID check uses a normalized comparison.
  update public.app_users set login_id='   AdMiN   ' where id=v_account;
  begin
    perform public.content_record_quiz(v_content,v_account,gen_random_uuid(),'[2,1]','{}',1);
    raise exception 'TEST_FAILED: reserved admin identity accepted as learner';
  exception when raise_exception then
    if sqlerrm <> 'QUIZ_STUDENT_REQUIRED' then raise; end if;
  end;
  update public.app_users set login_id=v_key,account_type='student',status='등록완료' where id=v_account;

  begin
    perform public.content_record_quiz(v_content,v_account,gen_random_uuid(),'[2,1]','{}',999);
    raise exception 'TEST_FAILED: stale version accepted';
  exception when raise_exception then
    if sqlerrm <> 'CONTENT_VERSION_CONFLICT' then raise; end if;
  end;
  begin
    perform public.content_record_quiz(v_content,v_account,gen_random_uuid(),'[2,1.5]','{}',1);
    raise exception 'TEST_FAILED: fractional selection accepted';
  exception when raise_exception then
    if sqlerrm <> 'QUIZ_INVALID_ANSWERS' then raise; end if;
  end;

  -- A builtin lesson in a missing unit has no explicit open lock: fail closed.
  insert into public.content_items(id,kind,title,unit_id,lesson_id,format,content,quiz_data,has_quiz,published,student_access)
    values(v_blocked,'lesson','Synthetic locked quiz',v_key,'u3_l1','lesson-pack','{"schema":"science-lesson/v1"}',
      '[{"correct":1,"choices":2,"explanation":"Synthetic"}]',true,true,true);
  begin
    perform public.content_record_quiz(v_blocked,v_account,gen_random_uuid(),'[1]','{}',1);
    raise exception 'TEST_FAILED: missing builtin lock accepted';
  exception when raise_exception then
    if sqlerrm <> 'QUIZ_CONTENT_LOCKED' then raise; end if;
  end;
  update public.app_users set status='등록대기' where id=v_account;
  begin
    perform public.content_record_quiz(v_content,v_account,gen_random_uuid(),'[2,1]','{}',1);
    raise exception 'TEST_FAILED: disabled student accepted';
  exception when raise_exception then
    if sqlerrm <> 'QUIZ_STUDENT_REQUIRED' then raise; end if;
  end;
  select count(*) into v_count from public.learning_submissions where account_id=v_account;
  if v_count <> 3 then raise exception 'TEST_FAILED: rejected request wrote results'; end if;
  -- Deliberately abort only this nested block after all assertions pass.
  raise exception using message='BRIDGE_TEST_ROLLBACK',errcode='ZX001';
 exception when sqlstate 'ZX001' then
  if sqlerrm <> 'BRIDGE_TEST_ROLLBACK' then raise; end if;
 end;
end;
$$;
select 'PASS: server grading, dashboard O/X, first/best history, first-only reward, retry idempotency, private choices, approved external learner, reserved admin rejection, invalid/version/lock/account rejection, service-only grants; all synthetic rows rolled back' as verification;
