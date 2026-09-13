-- REVIEWED SOURCE, TEST ONLY: science-platform-test / rerykeslgwhamreoskgx.
-- Apply after the old test content is backed up/reset and content_versions.sql exists.
-- Private file source remains server-side. No direct anon/authenticated grants.
begin;
alter table public.content_items drop constraint if exists content_text_limit;
alter table public.content_items add constraint content_text_limit check (
  content is null or
  (format = 'html' and jsonb_typeof(content) = 'string' and octet_length(content #>> '{}') <= 10485760) or
  (format <> 'html' and octet_length(content::text) <= 2097152)
);
-- Uniqueness also covers concurrent creates and restores into an occupied slot.
create unique index if not exists content_active_lesson_identity
  on public.content_items(unit_id, lesson_id) where kind = 'lesson' and archived_at is null;
alter table public.content_items drop constraint if exists content_legacy_lesson_identity;
alter table public.content_items add constraint content_legacy_lesson_identity check (
  kind not in ('lesson','worksheet') or (
    unit_id ~ '^unit[1-9][0-9]{0,2}$' and lesson_id is not null and
    lesson_id ~ ('^u' || substring(unit_id from 5) || '_l[1-9][0-9]{0,2}$')
  )
);

create or replace function public.content_save_atomic(p_item jsonb, p_actor text, p_expected_version integer)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  v_id uuid := (p_item->>'id')::uuid;
  v_old public.content_items%rowtype;
  v_saved public.content_items%rowtype;
  v_action text;
  v_title text;
begin
  -- All catalog writers take this lock before individual content locks.
  perform pg_advisory_xact_lock(hashtextextended('content:catalog', 0));
  perform pg_advisory_xact_lock(hashtextextended('content:' || v_id::text, 0));
  select * into v_old from public.content_items where id = v_id for update;
  if (v_old.id is null and p_expected_version <> 0) or
     (v_old.id is not null and v_old.version <> p_expected_version) then
    raise exception using message = 'CONTENT_VERSION_CONFLICT', errcode = 'P0001';
  end if;
  if p_actor is null or length(p_actor) not between 1 and 200 then
    raise exception 'Invalid audit actor';
  end if;
  if p_item->>'kind' in ('lesson','worksheet') and (
    coalesce(p_item->>'unit_id','') !~ '^unit[1-9][0-9]{0,2}$' or
    coalesce(p_item->>'lesson_id','') !~ ('^u' || substring(p_item->>'unit_id' from 5) || '_l[1-9][0-9]{0,2}$')
  ) then
    raise exception using message = 'CONTENT_IDENTITY_INVALID', errcode = 'P0001';
  end if;
  -- Keep the registered unit name stable across file edits and version restores.
  -- Renaming the whole unit is an explicit, separately audited operation.
  select unit_title into v_title from public.content_items
    where unit_id = p_item->>'unit_id' and archived_at is null
    order by updated_at desc, id limit 1;
  if found then p_item := p_item || jsonb_build_object('unit_title', v_title); end if;
  if p_item->>'kind' = 'lesson' and p_item->>'archived_at' is null and exists (
    select 1 from public.content_items where kind = 'lesson' and archived_at is null
      and unit_id = p_item->>'unit_id' and lesson_id = p_item->>'lesson_id' and id <> v_id
  ) then
    raise exception using message = 'CONTENT_IDENTITY_CONFLICT', errcode = 'P0001';
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
  perform pg_advisory_xact_lock(hashtextextended('content:catalog', 0));
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

create or replace function public.content_rename_unit(
  p_unit_id text, p_unit_title text, p_expected_title text, p_actor text
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  v_row public.content_items%rowtype;
  v_saved public.content_items%rowtype;
  v_count integer := 0;
begin
  if p_unit_id is null or p_unit_id !~ '^unit[1-9][0-9]{0,2}$' or
    p_unit_title is null or length(btrim(p_unit_title)) not between 1 and 200 or
    p_expected_title is null or length(btrim(p_expected_title)) not between 1 and 200 or
    p_actor is null or length(btrim(p_actor)) not between 1 and 200 then
    raise exception 'UNIT_TITLE_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('content:catalog', 0));
  if not exists (select 1 from public.content_items where unit_id = p_unit_id and archived_at is null) then
    raise exception 'UNIT_NOT_FOUND';
  end if;
  if exists (select 1 from public.content_items where unit_id = p_unit_id and archived_at is null and unit_title <> p_expected_title) then
    raise exception 'UNIT_TITLE_CONFLICT';
  end if;
  if btrim(p_unit_title) = p_expected_title then
    return jsonb_build_object('unit_id',p_unit_id,'unit_title',p_expected_title,'updated_count',0);
  end if;
  for v_row in select * from public.content_items where unit_id = p_unit_id and archived_at is null order by id for update loop
    update public.content_items set unit_title = btrim(p_unit_title), version = version + 1, updated_at = now()
      where id = v_row.id returning * into v_saved;
    insert into public.content_audit(content_id,actor,action,version,metadata)
      values (v_saved.id,p_actor,'update',v_saved.version,
        jsonb_build_object('operation','rename_unit','unit_id',p_unit_id,'unit_title',v_saved.unit_title));
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('unit_id',p_unit_id,'unit_title',btrim(p_unit_title),'updated_count',v_count);
end;
$$;
revoke all on function public.content_rename_unit(text,text,text,text) from public, anon, authenticated;
grant execute on function public.content_rename_unit(text,text,text,text) to service_role;
commit;
