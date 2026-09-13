-- Test target only: rerykeslgwhamreoskgx. Service-only assessment submissions.
begin;
create table if not exists public.assessment_submissions (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id),
  account_id uuid not null references public.app_users(id),
  slot text not null check (slot in ('data','pdf')),
  request_id uuid not null,
  revision integer not null check (revision > 0),
  content_version integer not null,
  canonical_code text not null,
  student_name text not null,
  filename text not null,
  payload jsonb,
  storage_path text,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check (byte_size between 1 and 10485760),
  created_at timestamptz not null default now(),
  unique (account_id,request_id),
  unique (account_id,content_id,slot,revision),
  check ((slot='pdf' and storage_path is not null and payload is null) or
    (slot='data' and storage_path is null and jsonb_typeof(payload)='object' and octet_length(payload::text)<=524288))
);
create index if not exists assessment_collection_idx on public.assessment_submissions(content_id,canonical_code,created_at desc);
create table if not exists public.assessment_resubmit_permissions (
  content_id uuid not null references public.content_items(id),
  account_id uuid not null references public.app_users(id),
  slot text not null check (slot in ('data','pdf')),
  allowed boolean not null default false,
  changed_by text not null,
  updated_at timestamptz not null default now(),
  primary key(content_id,account_id,slot)
);
create table if not exists public.assessment_audit (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id),
  account_id uuid not null references public.app_users(id),
  slot text not null check (slot in ('data','pdf')),
  actor text not null,
  action text not null check(action in ('submit','allow_resubmit','deny_resubmit')),
  revision integer,
  created_at timestamptz not null default now()
);
create index if not exists assessment_audit_content_idx on public.assessment_audit(content_id,created_at desc);
create table if not exists public.assessment_runtime_settings (
  content_id uuid primary key references public.content_items(id),
  sound_muted boolean not null default true,
  changed_by text not null,
  updated_at timestamptz not null default now()
);
alter table public.assessment_submissions enable row level security;
alter table public.assessment_resubmit_permissions enable row level security;
alter table public.assessment_audit enable row level security;
alter table public.assessment_runtime_settings enable row level security;
revoke all on public.assessment_submissions,public.assessment_resubmit_permissions,public.assessment_audit,public.assessment_runtime_settings from public,anon,authenticated;
grant select,insert,update,delete on public.assessment_submissions,public.assessment_resubmit_permissions,public.assessment_audit,public.assessment_runtime_settings to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('science-assessment-private','science-assessment-private',false,10485760,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['application/pdf'];
drop policy if exists science_assessment_bucket_private on storage.objects;
create policy science_assessment_bucket_private on storage.objects as restrictive for all to anon,authenticated
using(bucket_id <> 'science-assessment-private') with check(bucket_id <> 'science-assessment-private');

create or replace function public.assessment_submit_atomic(p_submission jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
  v_account uuid := (p_submission->>'account_id')::uuid;
  v_content uuid := (p_submission->>'content_id')::uuid;
  v_request uuid := (p_submission->>'request_id')::uuid;
  v_slot text := p_submission->>'slot';
  v_item public.content_items%rowtype;
  v_user jsonb;
  v_locks jsonb;
  v_old public.assessment_submissions%rowtype;
  v_saved public.assessment_submissions%rowtype;
  v_revision integer;
  v_allowed boolean;
  v_code text;
  v_display text;
  v_name text;
begin
  if v_slot not in ('data','pdf') then raise exception 'ASSESSMENT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('assessment-request:'||v_account::text||':'||v_request::text,0));
  perform pg_advisory_xact_lock(hashtextextended('assessment:'||v_account::text||':'||v_content::text||':'||v_slot,0));
  select to_jsonb(u) into v_user from public.app_users u where id=v_account for share;
  if v_user is null or lower(coalesce(v_user->>'account_type','')) not in ('student','external') or
    lower(coalesce(v_user->>'login_id',''))='admin' or
    lower(coalesce(v_user->>'status','')) not in ('등록완료','승인','승인완료','active','approved','enabled') or
    v_user->>'deleted_at' is not null or v_user->>'disabled_at' is not null or
    v_user->>'is_active'='false' or v_user->>'active'='false' or
    (v_user->>'approval_status' is not null and lower(v_user->>'approval_status') not in ('approved','승인','승인완료')) then
    raise exception 'ASSESSMENT_FORBIDDEN';
  end if;
  select * into v_item from public.content_items where id=v_content for share;
  select setting_value into v_locks from public.app_settings where setting_key='lock_states' for share;
  if v_item.id is null or v_item.kind <> 'assessment' or v_item.archived_at is not null or
    not v_item.published or not v_item.student_access or
    not coalesce((v_locks->>'evalHallVisibilityMode'='all' or
      (v_locks->>'evalHallVisibilityMode' is null and v_locks->>'evalHallVisible'='true')) and
      v_locks->v_item.unit_id->>'isLocked'='false' and
      v_locks->v_item.unit_id->'lessons'->>v_item.lesson_id='false',false) then
    raise exception 'ASSESSMENT_LOCKED';
  end if;
  select * into v_old from public.assessment_submissions where account_id=v_account and request_id=v_request;
  if v_old.id is not null then
    if v_old.content_id<>v_content or v_old.slot<>v_slot or v_old.payload_hash<>p_submission->>'payload_hash' then
      raise exception 'ASSESSMENT_RETRY_CONFLICT';
    end if;
    return jsonb_build_object('id',v_old.id,'revision',v_old.revision,'filename',v_old.filename,'created_at',v_old.created_at,'duplicate',true);
  end if;
  if v_item.version<>(p_submission->>'content_version')::integer then raise exception 'ASSESSMENT_VERSION_CONFLICT'; end if;
  select coalesce(max(revision),0)+1 into v_revision from public.assessment_submissions where account_id=v_account and content_id=v_content and slot=v_slot;
  select allowed into v_allowed from public.assessment_resubmit_permissions where account_id=v_account and content_id=v_content and slot=v_slot for update;
  if v_revision>1 and not coalesce(v_allowed,false) then raise exception 'ASSESSMENT_ALREADY_SUBMITTED'; end if;
  v_code := v_user->>'login_id';
  if v_code ~ '^[1-3][1-9][0-9]{2}$' then v_code:=left(v_code,1)||'0'||substring(v_code from 2); end if;
  v_display:=case when v_code ~ '^[1-3]0[1-9][0-9]{2}$' then left(v_code,1)||substring(v_code from 3) else v_code end;
  v_name:=regexp_replace(coalesce(v_user->>'name','학생'),'[[:cntrl:]/\\:*?"<>|]','_','g');
  insert into public.assessment_submissions(content_id,account_id,slot,request_id,revision,content_version,canonical_code,student_name,filename,payload,storage_path,payload_hash,byte_size)
  values(v_content,v_account,v_slot,v_request,v_revision,v_item.version,v_code,v_name,
    regexp_replace(v_display,'[^A-Za-z0-9_-]','_','g')||'_'||left(v_name,40)||'_'||coalesce(v_item.lesson_id,'assessment')||'_v'||v_revision::text||case when v_slot='pdf' then '.pdf' else '.json' end,
    nullif(p_submission->'payload','null'::jsonb),p_submission->>'storage_path',p_submission->>'payload_hash',(p_submission->>'byte_size')::integer)
  returning * into v_saved;
  update public.assessment_resubmit_permissions set allowed=false,updated_at=now() where account_id=v_account and content_id=v_content and slot=v_slot;
  insert into public.assessment_audit(content_id,account_id,slot,actor,action,revision) values(v_content,v_account,v_slot,'account:'||v_account::text,'submit',v_revision);
  return jsonb_build_object('id',v_saved.id,'revision',v_saved.revision,'filename',v_saved.filename,'created_at',v_saved.created_at,'duplicate',false);
end $$;

create or replace function public.assessment_set_resubmit(p_content_id uuid,p_account_id uuid,p_slot text,p_allowed boolean,p_actor text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if p_slot not in ('data','pdf') or p_actor is null or length(p_actor) not between 1 and 200 then raise exception 'ASSESSMENT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('assessment:'||p_account_id::text||':'||p_content_id::text||':'||p_slot,0));
  if not exists(select 1 from public.assessment_submissions where content_id=p_content_id and account_id=p_account_id and slot=p_slot) then raise exception 'ASSESSMENT_NOT_FOUND'; end if;
  insert into public.assessment_resubmit_permissions(content_id,account_id,slot,allowed,changed_by)
  values(p_content_id,p_account_id,p_slot,p_allowed,p_actor)
  on conflict(content_id,account_id,slot) do update set allowed=excluded.allowed,changed_by=excluded.changed_by,updated_at=now();
  insert into public.assessment_audit(content_id,account_id,slot,actor,action) values(p_content_id,p_account_id,p_slot,p_actor,case when p_allowed then 'allow_resubmit' else 'deny_resubmit' end);
  return jsonb_build_object('allowed',p_allowed);
end $$;
revoke execute on function public.assessment_submit_atomic(jsonb),public.assessment_set_resubmit(uuid,uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.assessment_submit_atomic(jsonb),public.assessment_set_resubmit(uuid,uuid,text,boolean,text) to service_role;
commit;
