-- TEST platform only. Banner appearance is separate from content publication,
-- lesson versions, quiz attempts and points. Apply after content-platform.sql.
begin;

create table if not exists public.unit_appearances (
  unit_id text primary key check (
    unit_id ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'
    and unit_id not in ('__proto__', 'prototype', 'constructor')
    and unit_id !~* '_eval$' and unit_id !~* '^eval'
  ),
  icon text not null check (icon in ('car','element','flask','galaxy','sun','earth','lightning','light','star','space','compound','matter','flower','animal','cell','leaf','tree','computer','book','magnet','wave')),
  color_start text not null check (color_start ~ '^#[0-9A-Fa-f]{6}$'),
  color_end text not null check (color_end ~ '^#[0-9A-Fa-f]{6}$'),
  mode text not null check (mode in ('solid','gradient')),
  angle integer not null check (angle between 0 and 359),
  version integer not null check (version > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.unit_appearance_audit (
  id uuid primary key default gen_random_uuid(),
  unit_id text not null references public.unit_appearances(unit_id),
  actor text not null check (length(actor) between 1 and 200),
  version integer not null check (version > 0),
  appearance jsonb not null,
  created_at timestamptz not null default now(),
  unique(unit_id, version)
);

alter table public.unit_appearances enable row level security;
alter table public.unit_appearance_audit enable row level security;
-- Existing custom app_sessions are verified by content-api. They are not
-- Supabase Auth identities; direct anonymous/authenticated access is denied.
revoke all on public.unit_appearances, public.unit_appearance_audit from public, anon, authenticated;
grant select, insert, update on public.unit_appearances to service_role;
grant select, insert on public.unit_appearance_audit to service_role;

create or replace function public.unit_appearance_save_atomic(
  p_unit_id text, p_appearance jsonb, p_expected_version integer, p_actor text
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  v_current public.unit_appearances%rowtype;
  v_saved public.unit_appearances%rowtype;
begin
  if p_unit_id is null or p_unit_id !~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'
    or p_unit_id in ('__proto__', 'prototype', 'constructor')
    or p_unit_id ~* '_eval$' or p_unit_id ~* '^eval'
    or p_expected_version is null or p_expected_version not between 0 and 2147483646
    or p_actor is null or length(btrim(p_actor)) not between 1 and 200 then
    raise exception 'UNIT_APPEARANCE_INVALID';
  end if;
  if jsonb_typeof(p_appearance) is distinct from 'object' then
    raise exception 'UNIT_APPEARANCE_INVALID';
  end if;
  if (select count(*) from jsonb_object_keys(p_appearance)) <> 5
    or p_appearance - array['icon','color_start','color_end','mode','angle'] <> '{}'::jsonb
    or coalesce(p_appearance->>'icon','') not in ('car','element','flask','galaxy','sun','earth','lightning','light','star','space','compound','matter','flower','animal','cell','leaf','tree','computer','book','magnet','wave')
    or coalesce(p_appearance->>'color_start','') !~ '^#[0-9A-Fa-f]{6}$'
    or coalesce(p_appearance->>'color_end','') !~ '^#[0-9A-Fa-f]{6}$'
    or coalesce(p_appearance->>'mode','') not in ('solid','gradient')
    or jsonb_typeof(p_appearance->'angle') is distinct from 'number'
    or coalesce(p_appearance->>'angle','') !~ '^[0-9]{1,3}$' then
    raise exception 'UNIT_APPEARANCE_INVALID';
  end if;
  if (p_appearance->>'angle')::integer > 359 then
    raise exception 'UNIT_APPEARANCE_INVALID';
  end if;

  -- Serialize create and update alike; row locks alone do not cover absence.
  perform pg_advisory_xact_lock(hashtextextended('unit-appearance:' || p_unit_id, 0));
  -- The check is repeated inside the transaction, not trusted from the client
  -- or from the earlier API read. Draft regular lessons are valid for teachers.
  if p_unit_id not in ('unit3','unit7') and not exists (
    select 1 from public.content_items
    where unit_id = p_unit_id and kind = 'lesson' and archived_at is null
  ) then
    raise exception 'UNIT_APPEARANCE_UNIT_NOT_FOUND';
  end if;

  select * into v_current from public.unit_appearances where unit_id = p_unit_id for update;
  if coalesce(v_current.version, 0) <> p_expected_version then
    raise exception 'UNIT_APPEARANCE_VERSION_CONFLICT';
  end if;
  insert into public.unit_appearances(unit_id, icon, color_start, color_end, mode, angle, version, updated_at)
  values (p_unit_id, p_appearance->>'icon', upper(p_appearance->>'color_start'), upper(p_appearance->>'color_end'),
    p_appearance->>'mode', (p_appearance->>'angle')::integer, p_expected_version + 1, now())
  on conflict (unit_id) do update set
    icon = excluded.icon, color_start = excluded.color_start, color_end = excluded.color_end,
    mode = excluded.mode, angle = excluded.angle, version = excluded.version, updated_at = excluded.updated_at
  returning * into v_saved;

  insert into public.unit_appearance_audit(unit_id, actor, version, appearance)
  values (p_unit_id, p_actor, v_saved.version, to_jsonb(v_saved) - 'updated_at');
  return to_jsonb(v_saved) - 'updated_at';
end;
$$;

revoke all on function public.unit_appearance_save_atomic(text,jsonb,integer,text) from public, anon, authenticated;
grant execute on function public.unit_appearance_save_atomic(text,jsonb,integer,text) to service_role;

commit;
