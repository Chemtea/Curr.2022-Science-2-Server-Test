-- TEST TARGET ONLY: rerykeslgwhamreoskgx (science-platform-test).
-- Apply after content-platform.sql and the legacy submission-api 410 guard.
-- Compatibility was checked against this test DB on 2026-09-13.
-- New quiz choices, dashboard results, and the existing deterministic first
-- submission credit are committed together. This does not alter point rules.
begin;

create or replace function public.content_record_quiz(
  p_content_id uuid, p_account_id uuid, p_request_id uuid,
  p_answers jsonb, p_result jsonb, p_content_version integer
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  v_previous public.content_quiz_attempts%rowtype;
  v_item public.content_items%rowtype;
  v_user record;
  v_locks jsonb;
  v_lesson_key text;
  v_builtin boolean;
  v_total integer;
  v_score integer := 0;
  v_i integer;
  v_question jsonb;
  v_selected integer;
  v_correct integer;
  v_choices integer;
  v_marks text[] := array['-','-','-','-','-'];
  v_feedback jsonb := '[]'::jsonb;
  v_attempt integer;
  v_submission jsonb;
  v_result jsonb;
begin
  if p_account_id is null or p_request_id is null or p_content_id is null then
    raise exception 'QUIZ_INVALID_REQUEST';
  end if;
  -- Serialize all new content submissions for the account, including different
  -- lessons, so parallel first submissions cannot lose a balance increment.
  perform pg_advisory_xact_lock(hashtextextended('quiz:' || p_account_id::text, 0));
  select * into v_previous from public.content_quiz_attempts
    where account_id = p_account_id and request_id = p_request_id;
  if v_previous.id is not null then
    if v_previous.content_id <> p_content_id or v_previous.answers is distinct from p_answers then
      raise exception using message = 'QUIZ_RETRY_CONFLICT', errcode = 'P0001';
    end if;
    -- A network retry repeats neither the dashboard write nor the award.
    return v_previous.result || jsonb_build_object('duplicate',true);
  end if;

  select id, login_id, name, school_year, account_type, status into v_user
    from public.app_users where id = p_account_id for share;
  if not found or v_user.account_type not in ('student','external') or
     lower(trim(v_user.login_id)) = 'admin' or
     lower(trim(v_user.status)) not in ('등록완료','승인','승인완료','active','approved','enabled') then
    raise exception 'QUIZ_STUDENT_REQUIRED';
  end if;
  select * into v_item from public.content_items where id = p_content_id for share;
  if v_item.id is null or v_item.version is distinct from p_content_version or v_item.kind <> 'lesson' or
     not v_item.published or not v_item.student_access or v_item.archived_at is not null then
    raise exception using message = 'CONTENT_VERSION_CONFLICT', errcode = 'P0001';
  end if;

  -- The Edge Function checks these too; lock the current row so a teacher's
  -- concurrent lock change cannot commit between validation and this result.
  select setting_value into v_locks from public.app_settings
    where setting_key = 'lock_states' for share;
  if jsonb_typeof(v_locks) is distinct from 'object' then raise exception 'QUIZ_CONTENT_LOCKED'; end if;
  v_builtin := coalesce(v_item.lesson_id ~ '^(u3_l[1235678]|u7_l[1-8])$', false);
  if v_locks #> array[v_item.unit_id,'isLocked'] = 'true'::jsonb or
     v_locks #> array[v_item.unit_id,'lessons',v_item.lesson_id] = 'true'::jsonb or
     v_locks #> array['step_locks',v_item.lesson_id,'4'] = 'true'::jsonb then
    raise exception 'QUIZ_CONTENT_LOCKED';
  end if;
  if v_builtin and (
    v_locks #> array[v_item.unit_id,'isLocked'] is distinct from 'false'::jsonb or
    v_locks #> array[v_item.unit_id,'lessons',v_item.lesson_id] is distinct from 'false'::jsonb or
    v_locks #> array['step_locks',v_item.lesson_id,'4'] is distinct from 'false'::jsonb
  ) then raise exception 'QUIZ_CONTENT_LOCKED'; end if;

  -- p_result is retained only for API signature compatibility. The database
  -- derives score and feedback from its private key; supplied scores are unused.
  if jsonb_typeof(v_item.quiz_data) is distinct from 'array' or
     jsonb_typeof(p_answers) is distinct from 'array' then raise exception 'QUIZ_INVALID_ANSWERS'; end if;
  v_total := jsonb_array_length(v_item.quiz_data);
  if v_total not between 1 and 5 or jsonb_array_length(p_answers) <> v_total then
    raise exception 'QUIZ_INVALID_ANSWERS';
  end if;
  for v_i in 0..v_total-1 loop
    v_question := v_item.quiz_data->v_i;
    if jsonb_typeof(v_question) is distinct from 'object' or
       jsonb_typeof(v_question->'correct') is distinct from 'number' or
       jsonb_typeof(v_question->'choices') is distinct from 'number' or
       (v_question->>'correct') !~ '^([1-9]|10)$' or
       (v_question->>'choices') !~ '^([2-9]|10)$' then raise exception 'QUIZ_INVALID_KEY'; end if;
    v_correct := (v_question->>'correct')::integer;
    v_choices := (v_question->>'choices')::integer;
    if v_correct > v_choices then raise exception 'QUIZ_INVALID_KEY'; end if;
    if jsonb_typeof(p_answers->v_i) is distinct from 'number' or
       (p_answers->>v_i) !~ '^([1-9]|10)$' then raise exception 'QUIZ_INVALID_ANSWERS'; end if;
    v_selected := (p_answers->>v_i)::integer;
    if v_selected > v_choices then raise exception 'QUIZ_INVALID_ANSWERS'; end if;
    v_marks[v_i+1] := case when v_selected=v_correct then 'O' else 'X' end;
    if v_selected=v_correct then v_score := v_score+1; end if;
    v_feedback := v_feedback || jsonb_build_array(jsonb_build_object(
      'question',v_i+1,'selected',v_selected,'correct',v_selected=v_correct,
      'correctChoice',v_correct,'explanation',coalesce(v_question->>'explanation','')));
  end loop;

  -- Preserve the pre-migration dashboard key and first-submission identity.
  -- A new lesson without an explicit ID still gets a stable, server-owned key.
  v_lesson_key := coalesce(nullif(v_item.lesson_id,''),'content_' || replace(v_item.id::text,'-',''));
  perform pg_advisory_xact_lock(hashtextextended(p_account_id::text || '::' || v_lesson_key,0));
  -- Ensure the balance row exists before the legacy routine locks it. Its zero
  -- initialization is in this transaction and is rolled back if anything fails.
  insert into public.point_balances(account_id,student_id,name,school_year,balance,lifetime_earned,lifetime_spent,updated_at)
    values(v_user.id,v_user.login_id,v_user.name,v_user.school_year,0,0,0,now())
    on conflict(account_id) do nothing;
  v_submission := public.submit_lesson_result_atomic(
    v_user.id,v_user.login_id,v_user.name,v_user.school_year,
    v_lesson_key,v_item.title,v_score,v_total,
    v_marks[1],v_marks[2],v_marks[3],v_marks[4],v_marks[5]);
  select coalesce(max(attempt_no),0)+1 into v_attempt from public.content_quiz_attempts
    where account_id = p_account_id and content_id = p_content_id;
  v_result := v_submission || jsonb_build_object(
    'score',v_score,'total',v_total,'feedback',v_feedback,
    'contentAttemptNo',v_attempt,'pointsEnabled',true,'dashboardSaved',true,'duplicate',false);
  insert into public.content_quiz_attempts(content_id,account_id,request_id,content_version,attempt_no,answers,result)
    values(p_content_id,p_account_id,p_request_id,p_content_version,v_attempt,p_answers,v_result);
  return v_result;
end;
$$;
revoke all on function public.content_record_quiz(uuid,uuid,uuid,jsonb,jsonb,integer) from public, anon, authenticated;
grant execute on function public.content_record_quiz(uuid,uuid,uuid,jsonb,jsonb,integer) to service_role;
commit;
