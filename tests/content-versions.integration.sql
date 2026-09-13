-- TEST TARGET ONLY: rerykeslgwhamreoskgx.
-- Run after content-versions.sql. All synthetic rows are rolled back inside
-- the DO block, allowing this to accompany the reviewed schema transaction.
do $$
declare
  v_id uuid := gen_random_uuid();
  v_pdf_id uuid := gen_random_uuid();
  v_original jsonb;
  v_saved jsonb;
  v_history jsonb;
  v_count integer;
  v_role text;
begin
 begin
  foreach v_role in array array['anon','authenticated'] loop
    if has_table_privilege(v_role,'public.content_versions','SELECT') or
       has_table_privilege(v_role,'public.content_versions','INSERT') or
       has_table_privilege(v_role,'public.content_versions','UPDATE') or
       has_table_privilege(v_role,'public.content_versions','DELETE') or
       has_function_privilege(v_role,'public.content_restore_version(uuid,integer,integer,text)','EXECUTE') or
       has_function_privilege(v_role,'public.content_capture_version()','EXECUTE') then
      raise exception 'TEST_FAILED: client role has private version access';
    end if;
  end loop;
  if not has_table_privilege('service_role','public.content_versions','SELECT') or
     not has_table_privilege('service_role','public.content_versions','INSERT') or
     has_table_privilege('service_role','public.content_versions','UPDATE') or
     has_table_privilege('service_role','public.content_versions','DELETE') or
     not has_function_privilege('service_role','public.content_restore_version(uuid,integer,integer,text)','EXECUTE') then
    raise exception 'TEST_FAILED: server version grants';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.content_versions'::regclass) then
    raise exception 'TEST_FAILED: version RLS disabled';
  end if;
  if exists(select 1 from pg_proc where oid in (
    'public.content_restore_version(uuid,integer,integer,text)'::regprocedure,
    'public.content_capture_version()'::regprocedure) and prosecdef) then
    raise exception 'TEST_FAILED: version function is security definer';
  end if;
  if exists(select 1 from public.content_items item where not exists (
    select 1 from public.content_versions history where history.content_id=item.id and history.version=item.version
  )) then raise exception 'TEST_FAILED: current state not backfilled'; end if;

  v_original := public.content_save_atomic(jsonb_build_object(
    'id',v_id,'kind','lesson','title','Synthetic original','unit_id','versions_test',
    'lesson_id','versions_test_l1','format','lesson-pack','has_quiz',true,
    'content','{"schema":"science-lesson/v1","steps":[{"html":"<p>Original body</p>"}]}'::jsonb,
    'quiz_data','[{"correct":2,"choices":3,"explanation":"Private original answer"}]'::jsonb,
    'published',true,'student_access',true
  ),'synthetic-version-test',0);
  select snapshot into v_history from public.content_versions where content_id=v_id and version=1;
  if v_history is distinct from v_original or v_history#>>'{quiz_data,0,correct}' <> '2' then
    raise exception 'TEST_FAILED: full private original snapshot not captured';
  end if;
  v_saved := public.content_save_atomic(v_original || jsonb_build_object(
    'title','Synthetic replacement','content','{"schema":"science-lesson/v1","steps":[]}'::jsonb,
    'quiz_data','[{"correct":1,"choices":2,"explanation":"Private replacement answer"}]'::jsonb
  ),'synthetic-version-test',1);
  if (v_saved->>'version')::integer <> 2 then raise exception 'TEST_FAILED: update version'; end if;

  begin
    perform public.content_restore_version(v_id,1,1,'synthetic-version-test');
    raise exception 'TEST_FAILED: stale restore accepted';
  exception when raise_exception then
    if sqlerrm <> 'CONTENT_VERSION_CONFLICT' then raise; end if;
  end;
  begin
    perform public.content_restore_version(v_id,2,987654,'synthetic-version-test');
    raise exception 'TEST_FAILED: missing version accepted';
  exception when raise_exception then
    if sqlerrm <> 'CONTENT_VERSION_NOT_FOUND' then raise; end if;
  end;
  begin
    perform public.content_restore_version(v_id,null,1,'synthetic-version-test');
    raise exception 'TEST_FAILED: null expected version accepted';
  exception when raise_exception then
    if sqlerrm <> 'CONTENT_VERSION_INVALID' then raise; end if;
  end;
  begin
    perform public.content_restore_version(gen_random_uuid(),1,1,'synthetic-version-test');
    raise exception 'TEST_FAILED: unknown content accepted';
  exception when raise_exception then
    if sqlerrm <> 'CONTENT_NOT_FOUND' then raise; end if;
  end;

  v_saved := public.content_restore_version(v_id,2,1,'synthetic-version-test');
  if v_saved->>'id' <> v_id::text or (v_saved->>'version')::integer <> 3 or
     v_saved->>'title' <> 'Synthetic original' or v_saved->'content' <> v_original->'content' or
     v_saved->'quiz_data' <> v_original->'quiz_data' or v_saved->>'created_at' <> v_original->>'created_at' or
     v_saved->>'published' <> 'true' or v_saved->>'student_access' <> 'false' or
     v_saved->>'archived_at' is not null then
    raise exception 'TEST_FAILED: restore body, grading key, identity or teacher-only state';
  end if;
  select snapshot into v_history from public.content_versions where content_id=v_id and version=1;
  if v_history is distinct from v_original then raise exception 'TEST_FAILED: original history was changed'; end if;
  select count(*) into v_count from public.content_versions where content_id=v_id;
  if v_count <> 3 then raise exception 'TEST_FAILED: restore did not append one history row'; end if;
  select count(*) into v_count from public.content_audit where content_id=v_id and version=3 and actor='synthetic-version-test';
  if v_count <> 1 then raise exception 'TEST_FAILED: restore audit missing'; end if;

  -- Duplicate capture does not overwrite the historical snapshot. This direct
  -- update only touches the synthetic row and is rolled back below.
  update public.content_items set title='Synthetic same-version write' where id=v_id;
  select snapshot into v_history from public.content_versions where content_id=v_id and version=3;
  if v_history->>'title' <> 'Synthetic original' then raise exception 'TEST_FAILED: duplicate capture overwrote history'; end if;

  v_saved := public.content_save_atomic(v_saved || jsonb_build_object(
    'archived_at',now(),'published',false,'student_access',false
  ),'synthetic-version-test',3);
  begin
    perform public.content_restore_version(v_id,4,1,'synthetic-version-test');
    raise exception 'TEST_FAILED: archived current record restored through version route';
  exception when raise_exception then
    if sqlerrm <> 'CONTENT_ARCHIVED' then raise; end if;
  end;
  -- Normal archive restoration happens separately. Even an archived historical
  -- target cannot overwrite the active record's archive/access flags.
  v_saved := public.content_save_atomic(v_saved || jsonb_build_object(
    'archived_at',null,'published',true,'student_access',false
  ),'synthetic-version-test',4);
  v_saved := public.content_restore_version(v_id,5,4,'synthetic-version-test');
  if (v_saved->>'version')::integer <> 6 or v_saved->>'archived_at' is not null or
     v_saved->>'published' <> 'true' or v_saved->>'student_access' <> 'false' then
    raise exception 'TEST_FAILED: archived historical flags restored';
  end if;

  v_original := public.content_save_atomic(jsonb_build_object(
    'id',v_pdf_id,'kind','worksheet','title','Synthetic PDF','unit_id','versions_test',
    'format','pdf','content',null,'storage_path','synthetic-versions/old.pdf'
  ),'synthetic-version-test',0);
  v_saved := public.content_save_atomic(v_original || jsonb_build_object(
    'storage_path','synthetic-versions/new.pdf'
  ),'synthetic-version-test',1);
  v_saved := public.content_restore_version(v_pdf_id,2,1,'synthetic-version-test');
  if v_saved->>'storage_path' <> 'synthetic-versions/old.pdf' or v_saved->>'content' is not null then
    raise exception 'TEST_FAILED: private PDF path not restored';
  end if;

  raise exception using message='ROLLBACK_SYNTHETIC_VERSION_FIXTURES',errcode='ZX002';
 exception when sqlstate 'ZX002' then null;
 end;
 if exists(select 1 from public.content_items where id in (v_id,v_pdf_id)) or
    exists(select 1 from public.content_versions where content_id in (v_id,v_pdf_id)) or
    exists(select 1 from public.content_audit where content_id in (v_id,v_pdf_id)) then
   raise exception 'TEST_FAILED: synthetic version fixtures remain';
 end if;
end;
$$;
