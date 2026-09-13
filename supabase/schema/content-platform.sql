-- TEST TARGET ONLY: rerykeslgwhamreoskgx (science-platform-test).
-- Additive reviewed schema proposal. Live DB is paused: compatibility, grants,
-- existing auth status values, and advisors MUST be checked after resuming.
-- This is not a generated migration history entry. Do not apply to production.
begin;

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('lesson','worksheet','assessment','answer')),
  title text not null check (length(title) between 1 and 300),
  description text not null default '' check (length(description) <= 2000),
  unit_id text not null check (unit_id ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$' and unit_id not in ('__proto__','constructor','prototype')),
  unit_title text not null default '' check (length(unit_title) <= 200),
  lesson_id text check (lesson_id ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$' and lesson_id not in ('__proto__','constructor','prototype')),
  format text not null check (format in ('lesson-pack','html','pdf')),
  content jsonb,
  storage_path text,
  quiz_data jsonb not null default '[]'::jsonb check (jsonb_typeof(quiz_data) = 'array' and jsonb_array_length(quiz_data) <= 5),
  has_quiz boolean not null default false,
  published boolean not null default false,
  student_access boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint content_answers_teacher_only check (kind <> 'answer' or student_access = false),
  constraint content_payload_location check (
    (format = 'pdf' and storage_path is not null and content is null) or
    (format <> 'pdf' and storage_path is null and content is not null)
  ),
  constraint content_text_limit check (content is null or octet_length(content::text) <= 2097152),
  constraint content_pack_kind check (format <> 'lesson-pack' or kind = 'lesson'),
  constraint content_assessment_identifiers check (kind <> 'assessment' or (lesson_id is not null and unit_id ~ '_eval$'))
);
create index if not exists content_catalog_idx on public.content_items(unit_id, lesson_id, created_at) where archived_at is null;

create table if not exists public.content_audit (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id),
  actor text not null,
  action text not null check (action in ('create','update','archive')),
  version integer not null,
  metadata jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists content_audit_item_idx on public.content_audit(content_id, created_at desc);

-- This test records learning submissions without crediting existing reward tables.
-- Enabling points later requires verifying the old one-time award RPC in this DB.
create table if not exists public.content_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id),
  account_id uuid not null references public.app_users(id),
  request_id uuid not null,
  content_version integer not null,
  attempt_no integer not null,
  answers jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique(account_id, request_id),
  unique(account_id, content_id, attempt_no)
);
create index if not exists content_quiz_item_idx on public.content_quiz_attempts(content_id, created_at desc);

alter table public.content_items enable row level security;
alter table public.content_audit enable row level security;
alter table public.content_quiz_attempts enable row level security;
-- The platform has custom stu_/adm_ sessions. auth.uid() is NOT their identity.
-- All access is mediated by content-api after checking current custom sessions.
revoke all on public.content_items, public.content_audit, public.content_quiz_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.content_items, public.content_audit, public.content_quiz_attempts to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('science-content-private', 'science-content-private', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];
-- Restrictive policies also protect this bucket if an older permissive policy
-- elsewhere on storage.objects permits all authenticated or anonymous objects.
drop policy if exists science_content_bucket_is_private on storage.objects;
create policy science_content_bucket_is_private on storage.objects as restrictive
for all to anon, authenticated
using (bucket_id <> 'science-content-private')
with check (bucket_id <> 'science-content-private');

create or replace function public.content_save_atomic(p_item jsonb, p_actor text, p_expected_version integer)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  v_id uuid := (p_item->>'id')::uuid;
  v_old public.content_items%rowtype;
  v_saved public.content_items%rowtype;
  v_action text;
begin
  perform pg_advisory_xact_lock(hashtextextended('content:' || v_id::text, 0));
  select * into v_old from public.content_items where id = v_id for update;
  if (v_old.id is null and p_expected_version <> 0) or
     (v_old.id is not null and v_old.version <> p_expected_version) then
    raise exception using message = 'CONTENT_VERSION_CONFLICT', errcode = 'P0001';
  end if;
  if p_actor is null or length(p_actor) not between 1 and 200 then
    raise exception 'Invalid audit actor';
  end if;
  insert into public.content_items(id, kind, title, description, unit_id, unit_title, lesson_id,
    format, content, storage_path, quiz_data, has_quiz, published, student_access, version, archived_at)
  values (v_id, p_item->>'kind', p_item->>'title', coalesce(p_item->>'description',''),
    p_item->>'unit_id', coalesce(p_item->>'unit_title',''), p_item->>'lesson_id',
    p_item->>'format', nullif(p_item->'content','null'::jsonb), p_item->>'storage_path',
    coalesce(p_item->'quiz_data','[]'::jsonb), coalesce((p_item->>'has_quiz')::boolean,false),
    coalesce((p_item->>'published')::boolean,false), coalesce((p_item->>'student_access')::boolean,false),
    1, (p_item->>'archived_at')::timestamptz)
  on conflict (id) do update set kind = excluded.kind, title = excluded.title,
    description = excluded.description, unit_id = excluded.unit_id, unit_title = excluded.unit_title,
    lesson_id = excluded.lesson_id, format = excluded.format, content = excluded.content,
    storage_path = excluded.storage_path, quiz_data = excluded.quiz_data, has_quiz = excluded.has_quiz,
    published = excluded.published, student_access = excluded.student_access,
    version = content_items.version + 1, updated_at = now(), archived_at = excluded.archived_at
  returning * into v_saved;
  v_action := case when v_old.id is null then 'create' when v_saved.archived_at is not null then 'archive' else 'update' end;
  insert into public.content_audit(content_id, actor, action, version, metadata)
  values (v_id, p_actor, v_action, v_saved.version,
    jsonb_build_object('title',v_saved.title,'kind',v_saved.kind,'published',v_saved.published,
      'student_access',v_saved.student_access,'format',v_saved.format));
  return to_jsonb(v_saved);
end;
$$;
revoke all on function public.content_save_atomic(jsonb,text,integer) from public, anon, authenticated;
grant execute on function public.content_save_atomic(jsonb,text,integer) to service_role;

create or replace function public.content_record_quiz(
  p_content_id uuid, p_account_id uuid, p_request_id uuid,
  p_answers jsonb, p_result jsonb, p_content_version integer
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  v_previous public.content_quiz_attempts%rowtype;
  v_attempt integer;
  v_item public.content_items%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('quiz:' || p_account_id::text, 0));
  select * into v_previous from public.content_quiz_attempts
    where account_id = p_account_id and request_id = p_request_id;
  if v_previous.id is not null then
    if v_previous.content_id <> p_content_id or v_previous.answers <> p_answers then
      raise exception using message = 'QUIZ_RETRY_CONFLICT', errcode = 'P0001';
    end if;
    return v_previous.result || jsonb_build_object('attemptNo',v_previous.attempt_no,'duplicate',true);
  end if;
  select * into v_item from public.content_items where id = p_content_id for share;
  if v_item.id is null or v_item.version <> p_content_version or v_item.kind <> 'lesson' or
     not v_item.published or not v_item.student_access or v_item.archived_at is not null then
    raise exception using message = 'CONTENT_VERSION_CONFLICT', errcode = 'P0001';
  end if;
  select coalesce(max(attempt_no),0) + 1 into v_attempt from public.content_quiz_attempts
    where account_id = p_account_id and content_id = p_content_id;
  insert into public.content_quiz_attempts(content_id, account_id, request_id, content_version, attempt_no, answers, result)
    values(p_content_id,p_account_id,p_request_id,p_content_version,v_attempt,p_answers,p_result);
  return p_result || jsonb_build_object('attemptNo',v_attempt,'duplicate',false);
end;
$$;
revoke all on function public.content_record_quiz(uuid,uuid,uuid,jsonb,jsonb,integer) from public, anon, authenticated;
grant execute on function public.content_record_quiz(uuid,uuid,uuid,jsonb,jsonb,integer) to service_role;
commit;
