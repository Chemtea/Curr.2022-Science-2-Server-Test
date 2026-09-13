-- TEST TARGET ONLY: rerykeslgwhamreoskgx (science-platform-test).
-- Reviewed schema source, to apply after content-platform.sql.
-- History begins with each row's CURRENT state at installation. Older states
-- that were never stored cannot be reconstructed from metadata-only audit rows.
begin;

create table if not exists public.content_versions (
  content_id uuid not null references public.content_items(id),
  version integer not null check (version > 0),
  snapshot jsonb not null check (
    jsonb_typeof(snapshot) = 'object' and
    snapshot->>'id' is not null and (snapshot->>'id')::uuid = content_id and
    snapshot->>'version' is not null and (snapshot->>'version')::integer = version
  ),
  created_at timestamptz not null default now(),
  primary key (content_id, version)
);

comment on table public.content_versions is
  'Private full snapshots, including grading keys and private storage paths. Never expose directly to students.';

alter table public.content_versions enable row level security;
-- Existing custom admin/student sessions are validated by content-api; they
-- must not be mistaken for Supabase Auth identities in an auth.uid() policy.
revoke all on public.content_versions from public, anon, authenticated, service_role;
-- Service writes are append-only; existing snapshots cannot be edited/deleted.
grant select, insert on public.content_versions to service_role;

create or replace function public.content_capture_version()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public
as $$
begin
  insert into public.content_versions(content_id, version, snapshot, created_at)
    values (new.id, new.version, to_jsonb(new), new.updated_at)
    on conflict (content_id, version) do nothing;
  return new;
end;
$$;
revoke all on function public.content_capture_version() from public, anon, authenticated;
grant execute on function public.content_capture_version() to service_role;

drop trigger if exists content_version_capture on public.content_items;
create trigger content_version_capture after insert or update on public.content_items
  for each row execute function public.content_capture_version();

-- Trigger installation takes the table lock first. The backfill and future
-- captures therefore cannot leave a write during deployment without a version.
insert into public.content_versions(content_id, version, snapshot, created_at)
  select id, version, to_jsonb(item), updated_at from public.content_items item
  on conflict (content_id, version) do nothing;

create or replace function public.content_restore_version(
  p_content_id uuid,
  p_expected_version integer,
  p_target_version integer,
  p_actor text
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  v_current public.content_items%rowtype;
  v_snapshot jsonb;
begin
  if p_content_id is null or p_expected_version is null or p_expected_version < 1 or
     p_target_version is null or p_target_version < 1 then
    raise exception using message = 'CONTENT_VERSION_INVALID', errcode = 'P0001';
  end if;
  -- Same lock namespace and ordering as content_save_atomic. It is safe to
  -- acquire this transaction-level advisory lock again in the nested save.
  perform pg_advisory_xact_lock(hashtextextended('content:' || p_content_id::text, 0));
  select * into v_current from public.content_items where id = p_content_id for update;
  if not found then
    raise exception using message = 'CONTENT_NOT_FOUND', errcode = 'P0001';
  end if;
  if v_current.version <> p_expected_version then
    raise exception using message = 'CONTENT_VERSION_CONFLICT', errcode = 'P0001';
  end if;
  if v_current.archived_at is not null then
    raise exception using message = 'CONTENT_ARCHIVED', errcode = 'P0001';
  end if;
  select snapshot into v_snapshot from public.content_versions
    where content_id = p_content_id and version = p_target_version;
  if not found then
    raise exception using message = 'CONTENT_VERSION_NOT_FOUND', errcode = 'P0001';
  end if;

  -- The caller supplies only a version number, never a replacement snapshot.
  -- Saving creates current.version + 1, keeps the same ID/created_at and leaves
  -- historical submissions attached. Access/archive flags from the old state
  -- cannot republish the material or place the current record back in archive.
  -- published=true + student_access=false is this platform's teacher-only state.
  return public.content_save_atomic(v_snapshot || jsonb_build_object(
    'id', p_content_id,
    'published', true,
    'student_access', false,
    'archived_at', null
  ), p_actor, p_expected_version);
end;
$$;
revoke all on function public.content_restore_version(uuid,integer,integer,text) from public, anon, authenticated;
grant execute on function public.content_restore_version(uuid,integer,integer,text) to service_role;
commit;
