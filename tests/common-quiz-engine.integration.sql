-- TEST TARGET ONLY: rerykeslgwhamreoskgx (science-platform-test).
-- Run after common-quiz-engine.sql and the preceding content/points migrations.
-- All accounts, content, answers and point entries below are synthetic. A nested
-- exception rolls back EVERY fixture, including the synthetic lock-tree keys.
-- This exercises serial retries and database constraints, not a multi-connection
-- concurrency schedule. Concurrent HTTP coverage is a separate deployment gate.
do $$
declare
  v_account uuid := gen_random_uuid();
  v_other_account uuid := gen_random_uuid();
  v_legacy_account uuid := gen_random_uuid();
  v_first_only_account uuid := gen_random_uuid();
  v_content uuid := gen_random_uuid();
  v_legacy_content uuid := gen_random_uuid();
  v_first_only_content uuid := gen_random_uuid();
  v_attempt uuid;
  v_request uuid := gen_random_uuid();
  v_key text := 'engine_' || replace(gen_random_uuid()::text,'-','');
  v_public jsonb := '{
    "schema":"science-lesson/v3",
    "title":"Synthetic version one",
    "display":{"titleHtml":"Synthetic version one","headerTag":"Synthetic","subtitleHtml":"Public lesson","footerHtml":"","contentMaxWidth":1050},
    "steps":[
      {"id":"step1","title":"Observation","html":"<p>Frozen observation</p>"},
      {"id":"step2","title":"Experiment","html":"<p>Frozen experiment</p>"},
      {"id":"step3","title":"Explanation","html":"<p>Frozen explanation</p>"}
    ],
    "quiz":[
      {"id":"q1","promptHtml":"<p>Synthetic Q1</p>","contextHtml":"<p>Public context</p>","choices":[{"id":"q1-c1","html":"Choice A"},{"id":"q1-c2","html":"Choice B"},{"id":"q1-c3","html":"Choice C"}],"review":{"stepId":"step1","label":"Observation"}},
      {"id":"q2","promptHtml":"<p>Synthetic Q2</p>","contextHtml":"","choices":[{"id":"q2-c1","html":"Choice A"},{"id":"q2-c2","html":"Choice B"}],"review":{"stepId":"step2","label":"Experiment"}}
    ],
    "simulation":{"html":"","css":"","js":"","dependencies":[],"hostContract":"science-experiment-content/v1","microphone":false}
  }'::jsonb;
  v_private jsonb := '[
    {"questionId":"q1","correct":2,"choices":3,"explanation":"PRIVATE_Q1_CORRECT_PLAIN",
     "correctTitleHtml":"<strong>PRIVATE_Q1_CORRECT_TITLE</strong>",
     "explanationHtml":"<p>PRIVATE_Q1_CORRECT_BODY</p>",
     "wrongHintHtml":"<p>PRIVATE_Q1_HINT</p>",
     "wrongReasons":{"q1-c1":"<p>PRIVATE_Q1_WRONG_A</p>","q1-c3":"<p>PRIVATE_Q1_WRONG_C</p>"}},
    {"questionId":"q2","correct":1,"choices":2,"explanation":"PRIVATE_Q2_CORRECT_PLAIN",
     "correctTitleHtml":"<strong>PRIVATE_Q2_CORRECT_TITLE</strong>",
     "explanationHtml":"<p>PRIVATE_Q2_CORRECT_BODY</p>",
     "wrongHintHtml":"<p>PRIVATE_Q2_HINT</p>",
     "wrongReasons":{"q2-c2":"<p>PRIVATE_Q2_WRONG_B</p>"}}
  ]'::jsonb;
  v_begin jsonb;
  v_answer jsonb;
  v_repeat jsonb;
  v_resume jsonb;
  v_submit jsonb;
  v_review jsonb;
  v_legacy jsonb;
  v_before jsonb;
  v_after jsonb;
  v_locks jsonb;
  v_original_locks jsonb;
  v_expected integer;
  v_count integer;
  v_balance integer;
  v_row record;
  v_role text;
  v_action text;
begin
 begin
  -- The custom-session Edge Function owns authorization. Client roles must not
  -- impersonate an arbitrary account through the RPC or read frozen answer keys.
  foreach v_role in array array['anon','authenticated'] loop
    if has_function_privilege(v_role,'public.content_quiz_engine(text,uuid,uuid,integer,uuid,integer,integer,uuid)','EXECUTE') or
       has_function_privilege(v_role,'public.content_quiz_feedback(jsonb,jsonb,integer,integer,boolean)','EXECUTE') or
       has_table_privilege(v_role,'public.content_quiz_sessions','SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'TEST_FAILED: client role can access common quiz engine or private sessions';
    end if;
  end loop;
  if not has_function_privilege('service_role','public.content_quiz_engine(text,uuid,uuid,integer,uuid,integer,integer,uuid)','EXECUTE') then
    raise exception 'TEST_FAILED: server role cannot execute common quiz engine';
  end if;
  if (select prosecdef from pg_proc where oid='public.content_quiz_engine(text,uuid,uuid,integer,uuid,integer,integer,uuid)'::regprocedure) then
    raise exception 'TEST_FAILED: common quiz engine unexpectedly bypasses invoker permissions';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.content_quiz_sessions'::regclass) then
    raise exception 'TEST_FAILED: private quiz session RLS is disabled';
  end if;

  insert into public.app_users(id,login_id,name,school_year,status,account_type) values
    (v_account,v_key,'Synthetic engine learner',2026,'등록완료','student'),
    (v_other_account,v_key || '_other','Synthetic other learner',2026,'등록완료','student'),
    (v_legacy_account,v_key || '_old','Synthetic legacy learner',2026,'등록완료','student'),
    (v_first_only_account,v_key || '_first','Synthetic first-only learner',2026,'등록완료','student');
  insert into public.content_items(id,kind,title,unit_id,lesson_id,format,content,quiz_data,has_quiz,published,student_access)
    values(v_content,'lesson','Synthetic version one',v_key,v_key,'lesson-pack',v_public,v_private,true,true,true);
  select setting_value into v_original_locks from public.app_settings where setting_key='lock_states';
  if jsonb_typeof(v_original_locks) is distinct from 'object' then
    raise exception 'TEST_FAILED: lock settings unavailable for fixture';
  end if;
  select coalesce(points,0)::integer into v_expected from public.point_rules
    where active=true and min_accuracy<=50 order by min_accuracy desc,id asc limit 1;
  v_expected := coalesce(v_expected,0);

  begin
    perform public.content_quiz_engine('begin_quiz',v_content,v_account,999);
    raise exception 'TEST_FAILED: new attempt accepted stale loaded version';
  exception when raise_exception then
    if sqlerrm <> 'CONTENT_VERSION_CONFLICT' then raise; end if;
  end;

  v_begin := public.content_quiz_engine('begin_quiz',v_content,v_account,1);
  v_attempt := (v_begin#>>'{attempt,id}')::uuid;
  if v_attempt is null or v_begin#>>'{attempt,contentVersion}' is distinct from '1' or
     v_begin#>'{attempt,content}' is distinct from v_public or
     v_begin#>>'{attempt,submitted}' is distinct from 'false' then
    raise exception 'TEST_FAILED: new attempt snapshot contract';
  end if;
  if v_begin::text ~ 'PRIVATE_|correctChoice|wrongReasons|quiz_data' then
    raise exception 'TEST_FAILED: initial response leaked private answer data';
  end if;
  v_repeat := public.content_quiz_engine('begin_quiz',v_content,v_account,1);
  if v_repeat#>>'{attempt,id}' is distinct from v_attempt::text then
    raise exception 'TEST_FAILED: repeated begin created another attempt';
  end if;
  begin
    insert into public.content_quiz_sessions(content_id,account_id,content_version,lesson_key,public_snapshot,private_keys,answers)
      select content_id,account_id,content_version,lesson_key,public_snapshot,private_keys,answers
      from public.content_quiz_sessions where id=v_attempt;
    raise exception 'TEST_FAILED: database accepted two attempts for one learner and material';
  exception when unique_violation then null;
  end;
  begin
    perform public.content_quiz_engine('answer_quiz',v_content,v_account,1,v_attempt,1,0,gen_random_uuid());
    raise exception 'TEST_FAILED: invalid choice index was accepted';
  exception when raise_exception then
    if sqlerrm <> 'QUIZ_INVALID_ANSWERS' then raise; end if;
  end;
  begin
    perform public.content_quiz_engine('submit_quiz',v_content,v_account,1,v_attempt,null,null,v_request);
    raise exception 'TEST_FAILED: incomplete attempt submitted';
  exception when raise_exception then
    if sqlerrm <> 'QUIZ_INCOMPLETE' then raise; end if;
  end;

  -- Choosing a wrong answer commits the first choice, and reveals only the
  -- selected misconception/hint. Neither the other wrong option nor unattempted
  -- question's private feedback may be returned.
  v_answer := public.content_quiz_engine('answer_quiz',v_content,v_account,1,v_attempt,1,1,gen_random_uuid());
  if v_answer#>>'{feedback,correct}' is distinct from 'false' or
     v_answer#>'{attempt,answers}' is distinct from '[1,null]'::jsonb or
     v_answer#>>'{feedback,review,stepId}' is distinct from 'step1' or
     position('PRIVATE_Q1_WRONG_A' in v_answer::text)=0 or
     position('PRIVATE_Q1_HINT' in v_answer::text)=0 or
     v_answer::text ~ 'PRIVATE_Q1_WRONG_C|PRIVATE_Q1_CORRECT_|PRIVATE_Q2_|correctChoice|wrongReasons' then
    raise exception 'TEST_FAILED: targeted wrong feedback or pre-submit key disclosure';
  end if;
  v_repeat := public.content_quiz_engine('answer_quiz',v_content,v_account,1,v_attempt,1,1,gen_random_uuid());
  if v_repeat#>'{attempt,answers}' is distinct from v_answer#>'{attempt,answers}' or
     v_repeat->'feedback' is distinct from v_answer->'feedback' then
    raise exception 'TEST_FAILED: same first-choice retry changed saved answer or feedback';
  end if;
  begin
    perform public.content_quiz_engine('answer_quiz',v_content,v_account,1,v_attempt,1,2,gen_random_uuid());
    raise exception 'TEST_FAILED: a different first choice replaced saved answer';
  exception when raise_exception then
    if sqlerrm <> 'QUIZ_ANSWER_LOCKED' then raise; end if;
  end;
  begin
    perform public.content_quiz_engine('review_quiz',v_content,v_account,1,v_attempt,1,2,gen_random_uuid());
    raise exception 'TEST_FAILED: pre-submit review exposed another choice';
  exception when raise_exception then
    if sqlerrm <> 'QUIZ_REVIEW_NOT_READY' then raise; end if;
  end;
  begin
    perform public.content_quiz_engine('answer_quiz',v_content,v_other_account,1,v_attempt,1,2,gen_random_uuid());
    raise exception 'TEST_FAILED: another account used the attempt';
  exception when raise_exception then
    if sqlerrm not in ('QUIZ_ATTEMPT_NOT_FOUND','QUIZ_ATTEMPT_REQUIRED') then raise; end if;
  end;

  -- A teacher updates the lesson/key while the learner is part-way through.
  -- Resume, the remaining answer and grading must keep the originally loaded
  -- public content AND private key, even if the request carries the new version.
  update public.content_items set version=2,title='Synthetic version two',lesson_id=v_key || '_renamed',
    content=jsonb_set(v_public,'{title}','"Synthetic version two"'::jsonb),
    quiz_data=jsonb_set(v_private,'{1,correct}','2'::jsonb)
    where id=v_content;
  v_resume := public.content_quiz_engine('begin_quiz',v_content,v_account,2);
  if v_resume#>>'{attempt,id}' is distinct from v_attempt::text or
     v_resume#>>'{attempt,contentVersion}' is distinct from '1' or
     v_resume#>'{attempt,content}' is distinct from v_public or
     v_resume#>'{attempt,answers}' is distinct from v_answer#>'{attempt,answers}' or
     v_resume::text ~ 'PRIVATE_Q2_|correctChoice' then
    raise exception 'TEST_FAILED: resume lost choice or frozen lesson version';
  end if;
  begin
    perform public.content_quiz_engine('answer_quiz',v_content,v_account,2,v_attempt,2,1,gen_random_uuid());
    raise exception 'TEST_FAILED: response used the newly loaded version without accepting frozen version';
  exception when raise_exception then
    if sqlerrm <> 'QUIZ_ATTEMPT_VERSION_CONFLICT' then raise; end if;
  end;
  v_answer := public.content_quiz_engine('answer_quiz',v_content,v_account,1,v_attempt,2,1,gen_random_uuid());
  if v_answer#>>'{feedback,correct}' is distinct from 'true' or
     v_answer#>'{attempt,answers}' is distinct from '[1,1]'::jsonb or
     position('PRIVATE_Q2_CORRECT_BODY' in v_answer::text)=0 or
     v_answer::text ~ 'PRIVATE_Q2_WRONG_B|PRIVATE_Q1_CORRECT_|wrongReasons' or
     v_answer#>>'{feedback,correctChoice}' is distinct from '1' then
    raise exception 'TEST_FAILED: correct feedback did not use the frozen private key';
  end if;
  if exists(select 1 from public.learning_submissions where account_id=v_account) or
     exists(select 1 from public.point_ledger where account_id=v_account) then
    raise exception 'TEST_FAILED: choosing answers prematurely submitted or awarded points';
  end if;

  v_submit := public.content_quiz_engine('submit_quiz',v_content,v_account,1,v_attempt,null,null,v_request);
  if v_submit#>>'{attempt,submitted}' is distinct from 'true' or
     (v_submit->>'score')::integer is distinct from 1 or
     (v_submit->>'total')::integer is distinct from 2 or
     (v_submit->>'awardedPoints')::integer is distinct from v_expected or
     (v_submit->>'currentPoints')::integer is distinct from v_expected or
     v_submit->>'dashboardSaved' is distinct from 'true' then
    raise exception 'TEST_FAILED: frozen grading, points rule or dashboard result';
  end if;
  select score,total,q1,q2,attempt_no,lesson_key into v_row from public.learning_submissions where account_id=v_account;
  if v_row.score is distinct from 1 or v_row.total is distinct from 2 or
     v_row.q1 is distinct from 'X' or v_row.q2 is distinct from 'O' or
     v_row.attempt_no is distinct from 1 or v_row.lesson_key is distinct from v_key then
    raise exception 'TEST_FAILED: common quiz dashboard projection';
  end if;
  select first_score,best_score,last_score,attempt_count,awarded_points,lesson_name into v_row
    from public.first_submissions where account_id=v_account and lesson_key=v_key;
  if v_row.first_score is distinct from 1 or v_row.best_score is distinct from 1 or
     v_row.last_score is distinct from 1 or v_row.attempt_count is distinct from 1 or
     v_row.awarded_points is distinct from v_expected or v_row.lesson_name is distinct from 'Synthetic version one' then
    raise exception 'TEST_FAILED: first submission history or reward';
  end if;
  select balance into v_balance from public.point_balances where account_id=v_account;
  if v_balance is distinct from v_expected then raise exception 'TEST_FAILED: points balance disagrees with returned value'; end if;

  -- Same request, different request and begin/reload after submit must all return
  -- the one stored result. Post-submit review may change feedback but no records.
  v_repeat := public.content_quiz_engine('submit_quiz',v_content,v_account,1,v_attempt,null,null,v_request);
  if v_repeat->>'submissionId' is distinct from v_submit->>'submissionId' then
    raise exception 'TEST_FAILED: submit network retry changed result identity';
  end if;
  v_repeat := public.content_quiz_engine('submit_quiz',v_content,v_account,1,v_attempt,null,null,gen_random_uuid());
  if v_repeat->>'submissionId' is distinct from v_submit->>'submissionId' then
    raise exception 'TEST_FAILED: another submit request changed result identity';
  end if;
  v_resume := public.content_quiz_engine('begin_quiz',v_content,v_account,2);
  if v_resume#>>'{attempt,id}' is distinct from v_attempt::text or
     v_resume#>>'{attempt,submitted}' is distinct from 'true' then
    raise exception 'TEST_FAILED: reload lost the submitted state';
  end if;
  v_review := public.content_quiz_engine('review_quiz',v_content,v_account,1,v_attempt,1,2,gen_random_uuid());
  if v_review#>>'{feedback,correct}' is distinct from 'true' or
     v_review#>>'{feedback,correctChoice}' is distinct from '2' or
     position('PRIVATE_Q1_CORRECT_BODY' in v_review::text)=0 or
     v_review#>'{attempt,answers}' is distinct from v_submit#>'{attempt,answers}' then
    raise exception 'TEST_FAILED: post-submit correct review or original-answer preservation';
  end if;
  v_review := public.content_quiz_engine('review_quiz',v_content,v_account,1,v_attempt,1,3,gen_random_uuid());
  if v_review#>>'{feedback,correct}' is distinct from 'false' or
     position('PRIVATE_Q1_WRONG_C' in v_review::text)=0 or
     v_review#>'{attempt,answers}' is distinct from v_submit#>'{attempt,answers}' then
    raise exception 'TEST_FAILED: post-submit wrong review or original-answer preservation';
  end if;
  select count(*) into v_count from public.learning_submissions where account_id=v_account;
  if v_count<>1 then raise exception 'TEST_FAILED: retry or review added a dashboard submission'; end if;
  select count(*) into v_count from public.point_ledger where account_id=v_account;
  if v_count<>(case when v_expected>0 then 1 else 0 end) then
    raise exception 'TEST_FAILED: retry or review awarded points again';
  end if;
  select balance into v_balance from public.point_balances where account_id=v_account;
  if v_balance is distinct from v_expected then raise exception 'TEST_FAILED: retry or review changed balance'; end if;
  update public.content_items set lesson_id=v_key where id=v_content;
  begin
    perform public.content_quiz_engine('answer_quiz',v_content,v_account,1,v_attempt,1,2,gen_random_uuid());
    raise exception 'TEST_FAILED: submitted first answers remained writable';
  exception when raise_exception then
    if sqlerrm <> 'QUIZ_ALREADY_SUBMITTED' then raise; end if;
  end;

  -- Authorization must be rechecked even for idempotent, previously submitted
  -- requests. A role/account/lock change must not be bypassed by a cached result.
  foreach v_role in array array['manager','admin'] loop
    update public.app_users set account_type=v_role where id=v_account;
    begin
      perform public.content_quiz_engine('begin_quiz',v_content,v_account,2);
      raise exception 'TEST_FAILED: privileged account accepted as a learner';
    exception when raise_exception then
      if sqlerrm <> 'QUIZ_STUDENT_REQUIRED' then raise; end if;
    end;
  end loop;
  update public.app_users set account_type='student',status='등록대기' where id=v_account;
  begin
    perform public.content_quiz_engine('submit_quiz',v_content,v_account,1,v_attempt,null,null,v_request);
    raise exception 'TEST_FAILED: disabled learner accessed submitted result';
  exception when raise_exception then
    if sqlerrm <> 'QUIZ_STUDENT_REQUIRED' then raise; end if;
  end;
  update public.app_users set status='등록완료',login_id='   AdMiN   ' where id=v_account;
  begin
    perform public.content_quiz_engine('begin_quiz',v_content,v_account,2);
    raise exception 'TEST_FAILED: reserved admin login accepted as learner';
  exception when raise_exception then
    if sqlerrm <> 'QUIZ_STUDENT_REQUIRED' then raise; end if;
  end;
  update public.app_users set login_id=v_key,account_type='external',status='승인완료' where id=v_account;
  v_resume := public.content_quiz_engine('begin_quiz',v_content,v_account,2);
  if v_resume#>>'{attempt,id}' is distinct from v_attempt::text then
    raise exception 'TEST_FAILED: approved external learner lost existing attempt';
  end if;
  update public.app_users set account_type='student',status='등록완료' where id=v_account;

  -- Add only synthetic keys, under a row lock, without overwriting unrelated
  -- settings. The outer rollback restores the exact pre-test lock value.
  select setting_value into v_locks from public.app_settings where setting_key='lock_states' for update;
  update public.app_settings set setting_value=v_locks || jsonb_build_object(v_key,jsonb_build_object('isLocked',true))
    where setting_key='lock_states';
  foreach v_action in array array['begin_quiz','answer_quiz','review_quiz','submit_quiz'] loop
    begin
      perform public.content_quiz_engine(v_action,v_content,v_account,1,v_attempt,1,1,v_request);
      raise exception 'TEST_FAILED: current unit lock was bypassed';
    exception when raise_exception then
      if sqlerrm <> 'QUIZ_CONTENT_LOCKED' then raise; end if;
    end;
  end loop;
  update public.app_settings set setting_value=v_locks || jsonb_build_object(v_key,jsonb_build_object('isLocked',false,'lessons',jsonb_build_object(v_key,true)))
    where setting_key='lock_states';
  begin
    perform public.content_quiz_engine('begin_quiz',v_content,v_account,2);
    raise exception 'TEST_FAILED: current lesson lock was bypassed';
  exception when raise_exception then
    if sqlerrm <> 'QUIZ_CONTENT_LOCKED' then raise; end if;
  end;
  update public.app_settings set setting_value=jsonb_set(v_locks,'{step_locks}',
    coalesce(v_locks->'step_locks','{}'::jsonb) || jsonb_build_object(v_key,jsonb_build_object('4',true)))
    where setting_key='lock_states';
  begin
    perform public.content_quiz_engine('begin_quiz',v_content,v_account,2);
    raise exception 'TEST_FAILED: current step-four lock was bypassed';
  exception when raise_exception then
    if sqlerrm <> 'QUIZ_CONTENT_LOCKED' then raise; end if;
  end;
  update public.app_settings set setting_value=v_locks where setting_key='lock_states';
  update public.content_items set lesson_id='u3_l1' where id=v_content;
  begin
    perform public.content_quiz_engine('begin_quiz',v_content,v_account,2);
    raise exception 'TEST_FAILED: builtin lesson with missing explicit open locks was accepted';
  exception when raise_exception then
    if sqlerrm <> 'QUIZ_CONTENT_LOCKED' then raise; end if;
  end;
  update public.content_items set lesson_id=v_key where id=v_content;
  update public.content_items set student_access=false where id=v_content;
  begin
    perform public.content_quiz_engine('begin_quiz',v_content,v_account,2);
    raise exception 'TEST_FAILED: teacher-only content exposed submitted attempt';
  exception when raise_exception then
    if sqlerrm <> 'QUIZ_CONTENT_LOCKED' then raise; end if;
  end;
  update public.content_items set student_access=true,archived_at=now() where id=v_content;
  begin
    perform public.content_quiz_engine('begin_quiz',v_content,v_account,2);
    raise exception 'TEST_FAILED: archived content exposed submitted attempt';
  exception when raise_exception then
    if sqlerrm <> 'QUIZ_CONTENT_LOCKED' then raise; end if;
  end;
  update public.content_items set archived_at=null where id=v_content;

  -- A pre-engine choice record must import as already submitted, never create a
  -- second result/credit. It intentionally originates from the supported v1 RPC.
  insert into public.content_items(id,kind,title,unit_id,lesson_id,format,content,quiz_data,has_quiz,published,student_access)
    values(v_legacy_content,'lesson','Synthetic migrated quiz',v_key,v_key || '_old','lesson-pack',
      '{"schema":"science-lesson/v1"}',v_private,true,true,true);
  v_legacy := public.content_record_quiz(v_legacy_content,v_legacy_account,gen_random_uuid(),'[1,1]','{}',1);
  select jsonb_build_object('results',(select jsonb_agg(to_jsonb(s)) from public.learning_submissions s where s.account_id=v_legacy_account),
    'ledger',(select jsonb_agg(to_jsonb(l)) from public.point_ledger l where l.account_id=v_legacy_account),
    'balance',(select to_jsonb(b) from public.point_balances b where b.account_id=v_legacy_account)) into v_before;
  update public.content_items set content=v_public,version=2 where id=v_legacy_content;
  v_resume := public.content_quiz_engine('begin_quiz',v_legacy_content,v_legacy_account,2);
  if v_resume#>>'{attempt,submitted}' is distinct from 'true' or
     v_resume#>'{attempt,answers}' is distinct from '[null,null]'::jsonb or
     v_resume#>>'{attempt,result,submissionId}' is distinct from v_legacy->>'submissionId' then
    raise exception 'TEST_FAILED: previous choice submission was not preserved';
  end if;
  v_repeat := public.content_quiz_engine('submit_quiz',v_legacy_content,v_legacy_account,
    (v_resume#>>'{attempt,contentVersion}')::integer,(v_resume#>>'{attempt,id}')::uuid,null,null,gen_random_uuid());
  select jsonb_build_object('results',(select jsonb_agg(to_jsonb(s)) from public.learning_submissions s where s.account_id=v_legacy_account),
    'ledger',(select jsonb_agg(to_jsonb(l)) from public.point_ledger l where l.account_id=v_legacy_account),
    'balance',(select to_jsonb(b) from public.point_balances b where b.account_id=v_legacy_account)) into v_after;
  if v_before is distinct from v_after then raise exception 'TEST_FAILED: imported choice submission changed previous records or balance'; end if;

  -- Older legacy students can have dashboard/first-submission history without
  -- private content_quiz_attempts. Import that fact without fabricating choices.
  insert into public.content_items(id,kind,title,unit_id,lesson_id,format,content,quiz_data,has_quiz,published,student_access)
    values(v_first_only_content,'lesson','Synthetic first-only quiz',v_key,v_key || '_first','lesson-pack',v_public,v_private,true,true,true);
  insert into public.point_balances(account_id,student_id,name,school_year,balance,lifetime_earned,lifetime_spent,updated_at)
    values(v_first_only_account,v_key || '_first','Synthetic first-only learner',2026,0,0,0,now());
  v_legacy := public.submit_lesson_result_atomic(v_first_only_account,v_key || '_first','Synthetic first-only learner',2026::smallint,
    v_key || '_first','Synthetic first-only quiz',1,2,'X','O','-','-','-');
  select jsonb_build_object('results',(select jsonb_agg(to_jsonb(s)) from public.learning_submissions s where s.account_id=v_first_only_account),
    'ledger',(select jsonb_agg(to_jsonb(l)) from public.point_ledger l where l.account_id=v_first_only_account),
    'balance',(select to_jsonb(b) from public.point_balances b where b.account_id=v_first_only_account)) into v_before;
  v_resume := public.content_quiz_engine('begin_quiz',v_first_only_content,v_first_only_account,1);
  if v_resume#>>'{attempt,submitted}' is distinct from 'true' then
    raise exception 'TEST_FAILED: dashboard-only previous submission was not preserved';
  end if;
  if v_resume#>'{attempt,answers}' is distinct from '[null,null]'::jsonb then
    raise exception 'TEST_FAILED: dashboard-only import fabricated first answers';
  end if;
  v_repeat := public.content_quiz_engine('submit_quiz',v_first_only_content,v_first_only_account,1,
    (v_resume#>>'{attempt,id}')::uuid,null,null,gen_random_uuid());
  select jsonb_build_object('results',(select jsonb_agg(to_jsonb(s)) from public.learning_submissions s where s.account_id=v_first_only_account),
    'ledger',(select jsonb_agg(to_jsonb(l)) from public.point_ledger l where l.account_id=v_first_only_account),
    'balance',(select to_jsonb(b) from public.point_balances b where b.account_id=v_first_only_account)) into v_after;
  if v_before is distinct from v_after then raise exception 'TEST_FAILED: imported first submission changed previous records or balance'; end if;

  raise exception using message='COMMON_QUIZ_ENGINE_TEST_ROLLBACK',errcode='ZX006';
 exception when sqlstate 'ZX006' then
  if sqlerrm <> 'COMMON_QUIZ_ENGINE_TEST_ROLLBACK' then raise; end if;
 end;
 if exists(select 1 from public.app_users where id in (v_account,v_other_account,v_legacy_account,v_first_only_account)) or
    exists(select 1 from public.content_items where id in (v_content,v_legacy_content,v_first_only_content)) or
    exists(select 1 from public.learning_submissions where account_id in (v_account,v_other_account,v_legacy_account,v_first_only_account)) or
    exists(select 1 from public.point_ledger where account_id in (v_account,v_other_account,v_legacy_account,v_first_only_account)) or
    exists(select 1 from public.content_quiz_sessions where account_id in (v_account,v_other_account,v_legacy_account,v_first_only_account)) or
    exists(select 1 from public.content_quiz_attempts where account_id in (v_account,v_other_account,v_legacy_account,v_first_only_account)) then
   raise exception 'TEST_FAILED: synthetic common-engine records remain after rollback';
 end if;
 if (select setting_value from public.app_settings where setting_key='lock_states') is distinct from v_original_locks then
   raise exception 'TEST_FAILED: lock settings were not restored by fixture rollback';
 end if;
end;
$$;
select 'PASS: frozen quiz version, immutable first choices, targeted feedback, submitted review, one result and first-only points, learner/ownership/lock guards, legacy preservation, service-only RPC; all synthetic data rolled back. True multi-connection concurrency requires a separate run.' as verification;
