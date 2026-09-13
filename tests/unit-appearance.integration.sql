-- Run after supabase/schema/unit-appearance.sql on the TEST project only.
-- All synthetic writes are rolled back by an inner subtransaction, even if
-- this DO block is embedded in a reviewed schema migration. No accounts,
-- sessions, lesson payloads, publication flags or point records are created.
do $$
declare
  v_before jsonb;
  v_saved jsonb;
  v_version integer;
  v_audit_count bigint;
  v_payload jsonb := '{"icon":"galaxy","color_start":"#312e81","color_end":"#7c3aed","mode":"gradient","angle":135}'::jsonb;
  v_role text;
  v_bad jsonb;
  v_error text;
begin
  foreach v_role in array array['anon','authenticated'] loop
    if has_table_privilege(v_role, 'public.unit_appearances', 'SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege(v_role, 'public.unit_appearance_audit', 'SELECT,INSERT,UPDATE,DELETE')
      or has_function_privilege(v_role, 'public.unit_appearance_save_atomic(text,jsonb,integer,text)', 'EXECUTE') then
      raise exception 'UNIT_STYLE_TEST_PUBLIC_PRIVILEGE';
    end if;
  end loop;
  if (select prosecdef from pg_proc where oid = 'public.unit_appearance_save_atomic(text,jsonb,integer,text)'::regprocedure)
    or not (select relrowsecurity from pg_class where oid = 'public.unit_appearances'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.unit_appearance_audit'::regclass) then
    raise exception 'UNIT_STYLE_TEST_RLS_OR_INVOKER';
  end if;
  if not has_function_privilege('service_role', 'public.unit_appearance_save_atomic(text,jsonb,integer,text)', 'EXECUTE') then
    raise exception 'UNIT_STYLE_TEST_SERVICE_GRANT';
  end if;
  select to_jsonb(a), a.version into v_before, v_version from public.unit_appearances a where a.unit_id = 'unit3';
  v_version := coalesce(v_version, 0);
  select count(*) into v_audit_count from public.unit_appearance_audit where unit_id = 'unit3';
  begin
    v_saved := public.unit_appearance_save_atomic('unit3', v_payload, v_version, 'synthetic-unit-style-validation');
    if v_saved->>'unit_id' <> 'unit3' or (v_saved->>'version')::integer <> v_version + 1
      or v_saved->>'color_start' <> '#312E81' or v_saved->>'icon' <> 'galaxy' then
      raise exception 'UNIT_STYLE_TEST_SAVE';
    end if;
    if not exists(select 1 from public.unit_appearance_audit where unit_id = 'unit3' and version = v_version + 1 and actor = 'synthetic-unit-style-validation') then
      raise exception 'UNIT_STYLE_TEST_AUDIT';
    end if;
    begin
      perform public.unit_appearance_save_atomic('unit3', v_payload || '{"icon":"sun"}'::jsonb, v_version, 'synthetic-unit-style-validation');
      raise exception 'UNIT_STYLE_TEST_CONFLICT_ACCEPTED';
    exception when others then
      get stacked diagnostics v_error = message_text;
      if v_error <> 'UNIT_APPEARANCE_VERSION_CONFLICT' then raise; end if;
    end;
    if (select icon from public.unit_appearances where unit_id = 'unit3') <> 'galaxy' then
      raise exception 'UNIT_STYLE_TEST_CONFLICT_CHANGED_ROW';
    end if;
    for v_bad in select value from jsonb_array_elements('[{"angle":360},{"angle":"135"},{"angle":1.5},{"color_start":"red"},{"color_end":"#123456;url(x)"},{"icon":"<svg>"},{"mode":"url(x)"},{"angle":null},{"extra":"field"}]'::jsonb) loop
      begin
        perform public.unit_appearance_save_atomic('unit3', v_payload || v_bad, v_version + 1, 'synthetic-unit-style-validation');
        raise exception 'UNIT_STYLE_TEST_INVALID_ACCEPTED';
      exception when others then
        get stacked diagnostics v_error = message_text;
        if v_error <> 'UNIT_APPEARANCE_INVALID' then raise; end if;
      end;
    end loop;
    begin
      perform public.unit_appearance_save_atomic('unit3_eval', v_payload, 0, 'synthetic-unit-style-validation');
      raise exception 'UNIT_STYLE_TEST_EVAL_ACCEPTED';
    exception when others then
      get stacked diagnostics v_error = message_text;
      if v_error <> 'UNIT_APPEARANCE_INVALID' then raise; end if;
    end;
    v_saved := public.unit_appearance_save_atomic('unit3', v_payload || '{"icon":"sun","mode":"solid","angle":0}'::jsonb, v_version + 1, 'synthetic-unit-style-validation');
    if (v_saved->>'version')::integer <> v_version + 2 or v_saved->>'mode' <> 'solid' then
      raise exception 'UNIT_STYLE_TEST_UPDATE';
    end if;
    -- The distinguished SQLSTATE is caught only here and rolls back all writes
    -- above. Unexpected assertions propagate and fail the validation.
    raise exception sqlstate 'PZ001' using message = 'UNIT_STYLE_TEST_ROLLBACK';
  exception when sqlstate 'PZ001' then null;
  end;
  if (select to_jsonb(a) from public.unit_appearances a where unit_id = 'unit3') is distinct from v_before
    or (select count(*) from public.unit_appearance_audit where unit_id = 'unit3') <> v_audit_count then
    raise exception 'UNIT_STYLE_TEST_ROLLBACK_FAILED';
  end if;
end;
$$;

select true as unit_appearance_validation_passed;
