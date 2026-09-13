-- Test project rerykeslgwhamreoskgx only. Apply before deploying activation-api/platform-api.
-- A first password requires a teacher-issued random code; only its hash is stored.
begin;
create table if not exists public.account_activation_codes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.app_users(id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  issued_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz
);
create index if not exists account_activation_codes_account_idx on public.account_activation_codes(account_id, created_at desc);
create table if not exists public.account_activation_limits (
  bucket_key text primary key,
  window_start timestamptz not null,
  attempts integer not null default 0
);
alter table public.account_activation_codes enable row level security;
alter table public.account_activation_limits enable row level security;
revoke all on public.account_activation_codes, public.account_activation_limits from public, anon, authenticated;
grant all on public.account_activation_codes, public.account_activation_limits to service_role;

create or replace function public.activation_account_pending(p_user jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(p_user->>'status', '') = '등록대기'
    and coalesce(btrim(p_user->>'password_hash'), '') = ''
    and lower(coalesce(p_user->>'login_id', '')) <> 'admin'
    and lower(coalesce(nullif(p_user->>'account_type', ''), 'student')) in ('student','external','manager','middle_manager','중간관리자')
    and p_user->>'deleted_at' is null and p_user->>'disabled_at' is null
    and coalesce(p_user->>'is_active', 'true') <> 'false'
    and coalesce(p_user->>'active', 'true') <> 'false'
    and (p_user->>'approval_status' is null or lower(p_user->>'approval_status') in ('approved','승인','승인완료'));
$$;

create or replace function public.activation_admin(
  p_admin_token_hash text, p_action text, p_account_id uuid default null, p_code_hash text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_session public.app_sessions%rowtype; v_user public.app_users%rowtype;
  v_admin public.app_users%rowtype; v_json jsonb; v_items jsonb; v_expires timestamptz;
begin
  select * into v_session from public.app_sessions where token_hash = p_admin_token_hash;
  if not found or v_session.expires_at <= now() or v_session.session_type is distinct from 'admin'
     or v_session.account_type is distinct from 'admin' or v_session.login_id is distinct from 'admin'
     or to_jsonb(v_session)->>'revoked_at' is not null then
    return jsonb_build_object('success',false,'status',401,'message','교사 관리자 로그인이 필요합니다.');
  end if;
  if not exists (select 1 from public.app_settings where setting_key='admin_password_hash'
      and setting_value->>'hash' ~ '^[0-9a-fA-F]{64}$') then
    return jsonb_build_object('success',false,'status',403,'message','교사 관리자 인증 설정을 확인해 주세요.');
  end if;
  if v_session.account_id is not null then
    select * into v_admin from public.app_users where id=v_session.account_id;
    v_json := to_jsonb(v_admin);
    if not found or lower(v_admin.login_id) <> 'admin'
       or coalesce(v_json->>'status','') not in ('등록대기','등록완료','승인','승인완료','active','approved','enabled')
       or v_json->>'deleted_at' is not null or v_json->>'disabled_at' is not null
       or coalesce(v_json->>'is_active','true')='false' or coalesce(v_json->>'active','true')='false' then
      return jsonb_build_object('success',false,'status',403,'message','사용 가능한 교사 관리자 계정이 필요합니다.');
    end if;
  end if;
  if p_action = 'list' then
    select coalesce(jsonb_agg(row_to_json(q) order by q.school_year desc nulls last, q.login_id), '[]'::jsonb) into v_items
    from (select u.id, u.login_id, u.name, u.school_year,
      u.guardian_consent_required, u.guardian_consent_verified,
      (select max(c.expires_at) from public.account_activation_codes c where c.account_id=u.id
         and c.consumed_at is null and c.revoked_at is null and c.expires_at>now()) as code_expires_at
      from public.app_users u where public.activation_account_pending(to_jsonb(u))) q;
    return jsonb_build_object('success',true,'items',v_items);
  end if;
  if p_action not in ('issue','revoke') then
    return jsonb_build_object('success',false,'status',400,'message','지원하지 않는 작업입니다.');
  end if;
  -- All activation mutations lock account first, then invitation, avoiding races/deadlocks.
  select * into v_user from public.app_users where id=p_account_id for update;
  if not found or not public.activation_account_pending(to_jsonb(v_user)) then
    return jsonb_build_object('success',false,'status',409,'message','최초 비밀번호 등록 대기 계정만 처리할 수 있습니다.');
  end if;
  if p_action='issue' and v_user.guardian_consent_required and not v_user.guardian_consent_verified then
    return jsonb_build_object('success',false,'status',409,'message','보호자 동의 확인이 필요한 계정입니다. 기존 계정 관리에서 동의 확인을 먼저 완료해 주세요.');
  end if;
  if p_action='issue' and (p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$') then
    return jsonb_build_object('success',false,'status',400,'message','활성화 코드 형식이 올바르지 않습니다.');
  end if;
  update public.account_activation_codes set revoked_at=now() where account_id=v_user.id and consumed_at is null and revoked_at is null;
  if p_action='issue' then
    v_expires := now()+interval '24 hours';
    insert into public.account_activation_codes(account_id,code_hash,issued_by,expires_at)
    values(v_user.id,p_code_hash,v_session.login_id,v_expires);
  end if;
  return jsonb_build_object('success',true,'expires_at',v_expires);
end;
$$;

create or replace function public.activation_redeem(
  p_login_id text, p_school_year integer, p_code_hash text, p_password_hash text, p_ip_hash text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_user public.app_users%rowtype; v_code public.account_activation_codes%rowtype;
  v_key text; v_attempts integer; v_limit integer;
  v_message constant text := '학번·학년도·활성화 코드를 확인해 주세요. 코드가 만료되었다면 교사에게 재발급을 요청하세요.';
begin
  if p_login_id is null or p_login_id !~ '^[A-Za-z0-9_.@-]{1,80}$' or p_school_year is null or p_school_year not between 2000 and 2100
     or p_password_hash is null or p_password_hash !~ '^[0-9a-f]{64}$'
     or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('success',false,'status',400,'message',v_message);
  end if;
  -- Count every redemption attempt. Fixed fifteen-minute buckets commit even on rejection.
  -- The IP allowance supports a whole class sharing one school internet connection.
  foreach v_key in array array['account:'||lower(p_login_id)||':'||p_school_year, 'ip:'||p_ip_hash] loop
    v_limit := case when v_key like 'account:%' then 5 else 100 end;
    insert into public.account_activation_limits(bucket_key,window_start,attempts) values(v_key,now(),1)
    on conflict(bucket_key) do update set
      attempts = case when account_activation_limits.window_start <= now()-interval '15 minutes' then 1 else account_activation_limits.attempts+1 end,
      window_start = case when account_activation_limits.window_start <= now()-interval '15 minutes' then now() else account_activation_limits.window_start end
    returning attempts into v_attempts;
    if v_attempts>v_limit then return jsonb_build_object('success',false,'status',429,'cooldownSeconds',900,'message','활성화 시도가 많습니다. 15분 뒤 다시 시도해 주세요.'); end if;
  end loop;
  select * into v_user from public.app_users where lower(login_id)=lower(p_login_id)
    and (school_year=p_school_year or (school_year is null and lower(account_type) in ('external','manager','middle_manager','중간관리자')))
    order by school_year nulls first limit 1 for update;
  if not found or not public.activation_account_pending(to_jsonb(v_user)) or (v_user.guardian_consent_required and not v_user.guardian_consent_verified) then
    return jsonb_build_object('success',false,'status',400,'message',v_message);
  end if;
  select * into v_code from public.account_activation_codes where account_id=v_user.id and code_hash=p_code_hash for update;
  if not found or v_code.expires_at<=now() or v_code.consumed_at is not null or v_code.revoked_at is not null then
    return jsonb_build_object('success',false,'status',400,'message',v_message);
  end if;
  update public.account_activation_codes set consumed_at=now() where id=v_code.id;
  update public.account_activation_codes set revoked_at=now() where account_id=v_user.id and id<>v_code.id and consumed_at is null and revoked_at is null;
  update public.app_users set password_hash=p_password_hash,password_scheme='sha256_client',status='등록완료',registered_at=now(),updated_at=now() where id=v_user.id;
  delete from public.app_sessions where account_id=v_user.id;
  return jsonb_build_object('success',true,'message','계정이 활성화되었습니다. 설정한 비밀번호로 로그인하세요.');
end;
$$;
revoke all on function public.activation_account_pending(jsonb), public.activation_admin(text,text,uuid,text), public.activation_redeem(text,integer,text,text,text) from public, anon, authenticated;
grant execute on function public.activation_account_pending(jsonb), public.activation_admin(text,text,uuid,text), public.activation_redeem(text,integer,text,text,text) to service_role;
commit;
