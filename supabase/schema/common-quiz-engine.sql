-- TEST TARGET ONLY: rerykeslgwhamreoskgx (science-platform-test).
-- Apply after content-platform, content-versions and quiz-results-bridge.
-- One assessed attempt per account/material, independent of browser or version.
begin;
create table if not exists public.content_quiz_sessions (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id),
  account_id uuid not null references public.app_users(id),
  content_version integer not null check (content_version > 0),
  lesson_key text not null,
  public_snapshot jsonb not null,
  private_keys jsonb not null,
  answers jsonb not null,
  result jsonb,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id,content_id),
  check(jsonb_typeof(private_keys)='array' and jsonb_array_length(private_keys) between 1 and 5),
  check(jsonb_typeof(answers)='array' and jsonb_array_length(answers)=jsonb_array_length(private_keys))
);
comment on table public.content_quiz_sessions is 'Private immutable first choices and frozen grading version. Access only through verified custom-session content API.';
alter table public.content_quiz_sessions enable row level security;
revoke all on public.content_quiz_sessions from public,anon,authenticated;
grant select,insert,update on public.content_quiz_sessions to service_role;

-- Only the chosen question's permitted feedback crosses the server boundary.
create or replace function public.content_quiz_feedback(p_content jsonb,p_keys jsonb,p_question integer,p_choice integer,p_reveal boolean)
returns jsonb language plpgsql immutable security invoker set search_path=pg_catalog,public
as $$
declare
  v_public jsonb; v_key jsonb; v_choice_id text; v_correct integer; v_is_correct boolean; v_result jsonb;
begin
  if p_question is null or p_choice is null or p_question < 1 or p_question > jsonb_array_length(p_keys) then raise exception 'QUIZ_INVALID_ANSWERS'; end if;
  v_public := p_content->'quiz'->(p_question-1);
  v_key := p_keys->(p_question-1);
  if jsonb_typeof(v_key->'correct') is distinct from 'number' or jsonb_typeof(v_key->'choices') is distinct from 'number' or (v_key->>'correct') !~ '^([1-9]|10)$' or (v_key->>'choices') !~ '^([2-9]|10)$' then raise exception 'QUIZ_INVALID_KEY'; end if;
  v_correct := (v_key->>'correct')::integer;
  if v_correct > (v_key->>'choices')::integer then raise exception 'QUIZ_INVALID_KEY'; end if;
  if p_choice < 1 or p_choice > (v_key->>'choices')::integer then raise exception 'QUIZ_INVALID_ANSWERS'; end if;
  v_choice_id := coalesce(v_public->'choices'->(p_choice-1)->>'id','q'||p_question||'-c'||p_choice);
  v_is_correct := p_choice=v_correct;
  v_result := jsonb_build_object(
    'question',p_question,'questionId',coalesce(v_public->>'id','q'||p_question),
    'selected',p_choice,'selectedId',v_choice_id,'correct',v_is_correct,
    'titleHtml',case when v_is_correct then coalesce(v_key->>'correctTitleHtml','정답입니다!') else '다시 생각해 보세요.' end,
    'explanationHtml',case when v_is_correct or p_reveal then coalesce(v_key->>'explanationHtml',v_key->>'explanation','') else '' end,
    'explanation',case when v_is_correct or p_reveal then coalesce(v_key->>'explanation','') else '' end,
    'hintHtml',case when not v_is_correct then coalesce(v_key->>'wrongHintHtml','') else '' end,
    'reasonHtml',case when not v_is_correct then coalesce(v_key->'wrongReasons'->>v_choice_id,'') else '' end,
    'review',v_public->'review');
  if v_is_correct or p_reveal then v_result := v_result || jsonb_build_object('correctChoice',v_correct); end if;
  return v_result;
end;
$$;
revoke all on function public.content_quiz_feedback(jsonb,jsonb,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.content_quiz_feedback(jsonb,jsonb,integer,integer,boolean) to service_role;

create or replace function public.content_quiz_engine(
  p_action text,p_content_id uuid,p_account_id uuid,p_content_version integer,
  p_attempt_id uuid default null,p_question integer default null,p_choice integer default null,p_request_id uuid default null
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public
as $$
declare
  v_user public.app_users%rowtype; v_user_json jsonb;
  v_item public.content_items%rowtype; v_session public.content_quiz_sessions%rowtype;
  v_previous public.content_quiz_attempts%rowtype; v_prior jsonb;
  v_locks jsonb; v_builtin boolean; v_key text;
  v_count integer; v_i integer; v_choice integer; v_score integer:=0;
  v_answers jsonb:='[]'::jsonb; v_feedback jsonb:='[]'::jsonb; v_selected_feedback jsonb;
  v_marks text[]:=array['-','-','-','-','-']; v_result jsonb; v_response jsonb;
  v_duplicate boolean:=false; v_balance integer; v_attempt_no integer;
begin
  if p_action is null or p_action not in ('begin_quiz','answer_quiz','submit_quiz','review_quiz') or p_account_id is null or p_content_id is null or p_content_version is null or p_content_version < 1 then raise exception 'QUIZ_INVALID_REQUEST'; end if;
  -- Same account lock as the legacy bridge: account balance cannot lose updates
  -- between simultaneous submissions in two lessons or two tabs.
  perform pg_advisory_xact_lock(hashtextextended('quiz:'||p_account_id::text,0));
  select * into v_user from public.app_users where id=p_account_id for share;
  v_user_json:=to_jsonb(v_user);
  if v_user.id is null or coalesce(v_user.account_type,'') not in ('student','external') or lower(trim(v_user.login_id))='admin' or
     coalesce(lower(trim(v_user.status)),'') not in ('등록완료','승인','승인완료','active','approved','enabled') or
     nullif(v_user_json->>'deleted_at','') is not null or nullif(v_user_json->>'disabled_at','') is not null or
     v_user_json->>'is_active'='false' or v_user_json->>'active'='false' or
     (v_user_json->>'approval_status' is not null and lower(v_user_json->>'approval_status') not in ('approved','승인','승인완료')) then raise exception 'QUIZ_STUDENT_REQUIRED'; end if;
  select * into v_item from public.content_items where id=p_content_id for share;
  if v_item.id is null or v_item.kind<>'lesson' or not v_item.published or not v_item.student_access or v_item.archived_at is not null then raise exception 'QUIZ_CONTENT_LOCKED'; end if;
  select setting_value into v_locks from public.app_settings where setting_key='lock_states' for share;
  if jsonb_typeof(v_locks) is distinct from 'object' then raise exception 'QUIZ_CONTENT_LOCKED'; end if;
  v_builtin:=coalesce(v_item.lesson_id ~ '^(u3_l[1235678]|u7_l[1-8])$',false);
  if v_locks #> array[v_item.unit_id,'isLocked']='true'::jsonb or
     v_locks #> array[v_item.unit_id,'lessons',v_item.lesson_id]='true'::jsonb or
     v_locks #> array['step_locks',v_item.lesson_id,'4']='true'::jsonb then raise exception 'QUIZ_CONTENT_LOCKED'; end if;
  if v_builtin and (v_locks #> array[v_item.unit_id,'isLocked'] is distinct from 'false'::jsonb or
     v_locks #> array[v_item.unit_id,'lessons',v_item.lesson_id] is distinct from 'false'::jsonb or
     v_locks #> array['step_locks',v_item.lesson_id,'4'] is distinct from 'false'::jsonb) then raise exception 'QUIZ_CONTENT_LOCKED'; end if;
  v_key:=coalesce(nullif(v_item.lesson_id,''),'content_'||replace(v_item.id::text,'-',''));
  select * into v_session from public.content_quiz_sessions where account_id=p_account_id and content_id=p_content_id for update;
  if v_session.id is null then
    if p_action<>'begin_quiz' then raise exception 'QUIZ_ATTEMPT_REQUIRED'; end if;
    if v_item.version<>p_content_version then raise exception 'CONTENT_VERSION_CONFLICT'; end if;
    if v_item.content->>'schema' is distinct from 'science-lesson/v3' then raise exception 'QUIZ_SCHEMA_REQUIRED'; end if;
    v_count:=jsonb_array_length(v_item.quiz_data);
    if v_count not between 1 and 5 or jsonb_array_length(v_item.content->'quiz')<>v_count then raise exception 'QUIZ_INVALID_KEY'; end if;
    select jsonb_agg('null'::jsonb) into v_answers from generate_series(1,v_count);
    -- Migration does not open a second assessed attempt for any prior submitter.
    select * into v_previous from public.content_quiz_attempts where account_id=p_account_id and content_id=p_content_id order by attempt_no,created_at limit 1;
    if v_previous.id is not null then
      -- Historical answers are displayed only against an exact old snapshot.
      -- The current v3 learning pack remains usable for review if the old format
      -- cannot represent its feedback; the score and earned points stay intact.
      v_prior:=v_previous.result || jsonb_build_object('duplicate',true,'historicalSubmission',true);
      select snapshot into v_result from public.content_versions where content_id=p_content_id and version=v_previous.content_version;
      if v_result->'content'->>'schema'='science-lesson/v3' then
        v_item.content:=v_result->'content'; v_item.quiz_data:=v_result->'quiz_data'; v_item.version:=v_previous.content_version;
        v_answers:=v_previous.answers;
      end if;
    else
      select to_jsonb(prior) into v_prior from public.first_submissions prior where account_id=p_account_id and lesson_key=v_key;
      if v_prior is not null then
        v_prior:=jsonb_build_object('score',v_prior->'first_score','total',coalesce(v_prior->'first_total',v_prior->'total',to_jsonb(v_count)),
          'awardedPoints',coalesce(v_prior->'awarded_points','0'::jsonb),'pointsEnabled',true,'dashboardSaved',true,
          'duplicate',true,'historicalSubmission',true);
      end if;
    end if;
    insert into public.content_quiz_sessions(content_id,account_id,content_version,lesson_key,public_snapshot,private_keys,answers,result,submitted_at)
      values(p_content_id,p_account_id,v_item.version,v_key,v_item.content,v_item.quiz_data,v_answers,v_prior,case when v_prior is not null then now() else null end) returning * into v_session;
  end if;
  if p_attempt_id is not null and v_session.id<>p_attempt_id then raise exception 'QUIZ_ATTEMPT_NOT_FOUND'; end if;
  if p_action<>'begin_quiz' and (p_attempt_id is null or p_content_version<>v_session.content_version) then raise exception 'QUIZ_ATTEMPT_VERSION_CONFLICT'; end if;
  v_count:=jsonb_array_length(v_session.private_keys);
  v_key:=v_session.lesson_key;
  if p_action in ('answer_quiz','review_quiz') then
    if p_request_id is null then raise exception 'QUIZ_INVALID_REQUEST'; end if;
    -- Validate indexes before reading or updating JSON paths.
    v_selected_feedback:=public.content_quiz_feedback(v_session.public_snapshot,v_session.private_keys,p_question,p_choice,v_session.submitted_at is not null);
    if p_action='review_quiz' then
      if v_session.submitted_at is null then raise exception 'QUIZ_REVIEW_NOT_READY'; end if;
    else
      if v_session.submitted_at is not null then raise exception 'QUIZ_ALREADY_SUBMITTED'; end if;
      v_choice:=(v_session.answers->>(p_question-1))::integer;
      if v_choice is not null and v_choice<>p_choice then raise exception 'QUIZ_ANSWER_LOCKED'; end if;
      v_duplicate:=v_choice is not null;
      if v_choice is null then
        update public.content_quiz_sessions set answers=jsonb_set(answers,array[(p_question-1)::text],to_jsonb(p_choice)),updated_at=now() where id=v_session.id returning * into v_session;
      end if;
    end if;
  elsif p_action='submit_quiz' then
    if p_request_id is null then raise exception 'QUIZ_INVALID_REQUEST'; end if;
    if v_session.submitted_at is not null then v_duplicate:=true;
    else
      for v_i in 0..v_count-1 loop
        v_choice:=(v_session.answers->>v_i)::integer;
        if v_choice is null then raise exception 'QUIZ_INCOMPLETE'; end if;
        v_selected_feedback:=public.content_quiz_feedback(v_session.public_snapshot,v_session.private_keys,v_i+1,v_choice,true);
        if (v_selected_feedback->>'correct')::boolean then v_score:=v_score+1; v_marks[v_i+1]:='O'; else v_marks[v_i+1]:='X'; end if;
        v_feedback:=v_feedback||jsonb_build_array(v_selected_feedback);
      end loop;
      perform pg_advisory_xact_lock(hashtextextended(p_account_id::text||'::'||v_key,0));
      insert into public.point_balances(account_id,student_id,name,school_year,balance,lifetime_earned,lifetime_spent,updated_at)
        values(v_user.id,v_user.login_id,v_user.name,v_user.school_year,0,0,0,now()) on conflict(account_id) do nothing;
      v_result:=public.submit_lesson_result_atomic(v_user.id,v_user.login_id,v_user.name,v_user.school_year,v_key,
        coalesce(v_session.public_snapshot->>'title',v_item.title),v_score,v_count,v_marks[1],v_marks[2],v_marks[3],v_marks[4],v_marks[5]);
      select coalesce(max(attempt_no),0)+1 into v_attempt_no from public.content_quiz_attempts where account_id=p_account_id and content_id=p_content_id;
      v_result:=v_result||jsonb_build_object('score',v_score,'total',v_count,'feedback',v_feedback,'contentVersion',v_session.content_version,
        'contentAttemptNo',v_attempt_no,'pointsEnabled',true,'dashboardSaved',true,'duplicate',false);
      -- Server attempt ID is the immutable final idempotency key; arbitrary
      -- browser request IDs cannot collide with another learner submission.
      insert into public.content_quiz_attempts(content_id,account_id,request_id,content_version,attempt_no,answers,result)
        values(p_content_id,p_account_id,v_session.id,v_session.content_version,v_attempt_no,v_session.answers,v_result);
      update public.content_quiz_sessions set result=v_result,submitted_at=now(),updated_at=now() where id=v_session.id returning * into v_session;
    end if;
  end if;
  v_feedback:='[]'::jsonb;
  for v_i in 0..v_count-1 loop
    v_choice:=(v_session.answers->>v_i)::integer;
    v_feedback:=v_feedback||jsonb_build_array(case when v_choice is null then null else public.content_quiz_feedback(v_session.public_snapshot,v_session.private_keys,v_i+1,v_choice,v_session.submitted_at is not null) end);
  end loop;
  v_result:=v_session.result;
  if v_result is not null then
    select balance into v_balance from public.point_balances where account_id=p_account_id;
    v_result:=v_result||jsonb_build_object('currentPoints',coalesce(v_balance,0),'duplicate',v_duplicate or p_action<>'submit_quiz');
  end if;
  v_response:=jsonb_build_object('attempt',jsonb_build_object('id',v_session.id,'contentVersion',v_session.content_version,
    'content',v_session.public_snapshot,'answers',v_session.answers,'feedback',v_feedback,'submitted',v_session.submitted_at is not null,
    'result',v_result),'duplicate',v_duplicate);
  if p_action in ('answer_quiz','review_quiz') then v_response:=v_response||jsonb_build_object('feedback',v_selected_feedback); end if;
  if p_action='submit_quiz' then v_response:=v_response||v_result; end if;
  return v_response;
end;
$$;
revoke all on function public.content_quiz_engine(text,uuid,uuid,integer,uuid,integer,integer,uuid) from public,anon,authenticated;
grant execute on function public.content_quiz_engine(text,uuid,uuid,integer,uuid,integer,integer,uuid) to service_role;
commit;
