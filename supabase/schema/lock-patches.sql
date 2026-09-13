-- TEST ONLY: rerykeslgwhamreoskgx. Reviewed additive SQL, not yet executed.
-- Avoids v1's body.locks??{} erasure when the new worksheet sends patches.
begin;
create or replace function public.science_lock_patch_valid(p_path text[], p_value jsonb)
returns boolean language sql immutable security invoker set search_path = pg_catalog
as $$
  select coalesce(
    cardinality(p_path) between 1 and 5 and
    not exists(select 1 from unnest(p_path) part where part is null or part in ('__proto__','constructor','prototype')) and (
      (cardinality(p_path)=1 and p_path[1]='evalHallVisibilityMode' and p_value in ('"all"'::jsonb,'"admin_only"'::jsonb,'"hidden"'::jsonb)) or
      (jsonb_typeof(p_value)='boolean' and (
        (cardinality(p_path)=1 and p_path[1]='evalHallVisible') or
        (p_path[1] ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$' and p_path[1] not in ('step_locks','worksheetCurriculum','evalHallVisibilityMode','evalHallVisible') and (
          (cardinality(p_path)=2 and p_path[2]='isLocked') or
          (cardinality(p_path)=3 and p_path[2]='lessons' and p_path[3] ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$')
        )) or
        (cardinality(p_path)=3 and p_path[1]='step_locks' and p_path[2] ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$' and p_path[3] ~ '^[1-4]$') or
        (p_path[1]='worksheetCurriculum' and (
          (cardinality(p_path)=2 and p_path[2]='isLocked') or
          (p_path[2]='units' and p_path[3] ~ '^([1-9][0-9]{0,2}|[A-Za-z][A-Za-z0-9_-]{0,63})$' and (
            (cardinality(p_path)=4 and p_path[4]='isLocked') or
            (cardinality(p_path)=5 and p_path[4]='items' and p_path[5] ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$')
          ))
        ))
      ))
    ), false);
$$;
revoke all on function public.science_lock_patch_valid(text[],jsonb) from public, anon, authenticated;
grant execute on function public.science_lock_patch_valid(text[],jsonb) to service_role;

create or replace function public.apply_science_lock_patches(p_patches jsonb, p_actor text)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  v_locks jsonb;
  v_patch jsonb;
  v_path text[];
  v_parent text[];
  v_i integer;
begin
  if jsonb_typeof(p_patches) is distinct from 'array' or jsonb_array_length(p_patches) not between 1 and 300 or
     p_actor is null or length(p_actor) not between 1 and 200 then raise exception 'Invalid lock patches'; end if;
  -- Concurrent initialization is safe; existing contents are never overwritten.
  insert into public.app_settings(setting_key,setting_value,updated_at,updated_by)
    values('lock_states','{}'::jsonb,now(),p_actor) on conflict(setting_key) do nothing;
  -- Serialize edits against the current row, rather than a stale client snapshot.
  select setting_value into v_locks from public.app_settings where setting_key='lock_states' for update;
  if jsonb_typeof(v_locks) is distinct from 'object' then raise exception 'Invalid saved lock state'; end if;
  for v_patch in select value from jsonb_array_elements(p_patches) loop
    if jsonb_typeof(v_patch) is distinct from 'object' or jsonb_typeof(v_patch->'path') is distinct from 'array' then raise exception 'Invalid lock patch path'; end if;
    if exists(select 1 from jsonb_array_elements(v_patch->'path') x where jsonb_typeof(x) <> 'string') then raise exception 'Lock path must contain strings'; end if;
    select array_agg(value order by ordinal) into v_path from jsonb_array_elements_text(v_patch->'path') with ordinality as elements(value,ordinal);
    if not public.science_lock_patch_valid(v_path,v_patch->'value') then raise exception 'Lock path is not permitted'; end if;
    -- jsonb_set alone does not create absent intermediate objects.
    for v_i in 1..cardinality(v_path)-1 loop
      v_parent := v_path[1:v_i];
      if v_locks #> v_parent is null then v_locks := jsonb_set(v_locks,v_parent,'{}'::jsonb,true);
      elsif jsonb_typeof(v_locks #> v_parent) <> 'object' then raise exception 'Lock path would replace existing data'; end if;
    end loop;
    v_locks := jsonb_set(v_locks,v_path,v_patch->'value',true);
  end loop;
  update public.app_settings set setting_value=v_locks,updated_at=now(),updated_by=p_actor where setting_key='lock_states';
  return v_locks;
end;
$$;
revoke all on function public.apply_science_lock_patches(jsonb,text) from public, anon, authenticated;
grant execute on function public.apply_science_lock_patches(jsonb,text) to service_role;
commit;
