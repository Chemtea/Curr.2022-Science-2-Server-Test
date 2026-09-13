-- TEST ONLY: run after legacy-html-catalog.sql. All temporary rows roll back.
begin;
do $$
declare
  v_id uuid := gen_random_uuid();
  v_duplicate uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_item jsonb;
  v_saved jsonb;
  v_result jsonb;
  v_conflict boolean := false;
  v_count integer;
begin
  if exists(select 1 from public.content_items where unit_id = 'unit999') then
    raise exception 'TEST_FIXTURE_UNIT_OCCUPIED';
  end if;
  if has_table_privilege('anon','public.content_items','select') or
    has_table_privilege('authenticated','public.content_versions','select') or
    has_function_privilege('anon','public.content_rename_unit(text,text,text,text)','execute') then
    raise exception 'PRIVATE_CATALOG_GRANT_INVALID';
  end if;
  v_item := jsonb_build_object('id',v_id,'kind','lesson','format','html','title','1차시 — 검증',
    'unit_id','unit999','lesson_id','u999_l1','unit_title','검증 단원','content','<!doctype html><html><body>fixture</body></html>',
    'published',false,'student_access',false,'archived_at',null);
  v_saved := public.content_save_atomic(v_item,'rollback-test',0);
  if v_saved->>'content' <> v_item->>'content' or (v_saved->>'version')::int <> 1 then
    raise exception 'HTML_SOURCE_CHANGED';
  end if;
  begin
    perform public.content_save_atomic(v_item || jsonb_build_object('id',v_duplicate),'rollback-test',0);
  exception when others then
    if sqlerrm <> 'CONTENT_IDENTITY_CONFLICT' then raise; end if;
    v_conflict := true;
  end;
  if not v_conflict then raise exception 'DUPLICATE_LESSON_ALLOWED'; end if;
  v_result := public.content_save_atomic(v_item || jsonb_build_object('id',v_second,'lesson_id','u999_l2','unit_title','잘못된 덮어쓰기'),'rollback-test',0);
  if v_result->>'unit_title' <> '검증 단원' then raise exception 'UNIT_TITLE_UNSTABLE'; end if;

  v_result := public.content_rename_unit('unit999','바뀐 단원','검증 단원','rollback-test');
  if (v_result->>'updated_count')::int <> 2 then raise exception 'UNIT_RENAME_INCOMPLETE'; end if;
  select count(*) into v_count from public.content_versions where content_id in (v_id,v_second) and version = 2 and snapshot->>'unit_title' = '바뀐 단원';
  if v_count <> 2 then raise exception 'RENAME_VERSION_MISSING'; end if;
  v_conflict := false;
  begin
    perform public.content_rename_unit('unit999','오래된 변경','검증 단원','rollback-test');
  exception when others then
    if sqlerrm <> 'UNIT_TITLE_CONFLICT' then raise; end if;
    v_conflict := true;
  end;
  if not v_conflict then raise exception 'STALE_RENAME_ALLOWED'; end if;
  v_result := public.content_restore_version(v_id,2,1,'rollback-test');
  if v_result->>'unit_title' <> '바뀐 단원' or (v_result->>'student_access')::boolean or (v_result->>'version')::int <> 3 then
    raise exception 'RESTORE_CHANGED_UNIT_OR_PUBLICATION';
  end if;

  -- Archiving frees the lesson slot; restoring into a newly occupied slot fails.
  v_result := public.content_save_atomic(v_result || jsonb_build_object('archived_at',now(),'published',false,'student_access',false),'rollback-test',3);
  perform public.content_save_atomic(v_item || jsonb_build_object('id',v_duplicate),'rollback-test',0);
  v_conflict := false;
  begin
    perform public.content_save_atomic(v_result || jsonb_build_object('archived_at',null),'rollback-test',4);
  exception when others then
    if sqlerrm <> 'CONTENT_IDENTITY_CONFLICT' then raise; end if;
    v_conflict := true;
  end;
  if not v_conflict then raise exception 'RESTORE_DUPLICATE_ALLOWED'; end if;
end;
$$;
rollback;
