"""Prepare guarded content-only upgrades, never execute them automatically.

Both private input directories and SQL output must be outside the public site.
The exact old public body is checked before changing a row. Access flags,
archival state, metadata and stable lesson IDs are retained. Existing version
history and results are left in place. No teacher answer data is committed.
"""
import argparse,json
from pathlib import Path

def literal(value):
    return "'"+json.dumps(value,ensure_ascii=False).replace("'","''")+"'::jsonb"

def main():
    p=argparse.ArgumentParser();p.add_argument('old_records',type=Path);p.add_argument('converted',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    site=Path(__file__).resolve().parents[1]
    if a.output.resolve().is_relative_to(site):raise RuntimeError('Private migration output must be outside the public site')
    a.output.mkdir(parents=True,exist_ok=True,mode=0o700)
    for path in sorted(a.converted.glob('*.json')):
        lesson=path.stem
        if not (a.old_records/path.name).exists():continue
        old=json.loads((a.old_records/path.name).read_text());new=json.loads(path.read_text())
        if '$upgrade$' in json.dumps([old,new],ensure_ascii=False):raise RuntimeError('SQL delimiter collision in source; no migration prepared')
        if old.get('lesson_id')!=lesson or new['metadata']['lesson_id']!=lesson:raise RuntimeError('Lesson identity mismatch')
        # Safe identifiers must still be SQL-quoted as values, never interpolated as names.
        key="'"+lesson.replace("'","''")+"'"
        sql=f"""-- TEST ONLY: rerykeslgwhamreoskgx. Private content migration for {lesson}.
do $upgrade$
declare v_item public.content_items%rowtype; v_new jsonb:={literal(new['content'])}; v_old jsonb:={literal(old['content'])}; v_keys jsonb:={literal(new['quiz_data'])}; v_count integer;
begin
 select count(*) into v_count from public.content_items where kind='lesson' and lesson_id={key};
 if v_count<>1 then raise exception 'UPGRADE_EXPECTED_ONE_LESSON'; end if;
 select * into v_item from public.content_items where kind='lesson' and lesson_id={key} for update;
 if v_item.content=v_new and v_item.quiz_data=v_keys then return; end if;
 if v_item.content is distinct from v_old then raise exception 'UPGRADE_SOURCE_CHANGED'; end if;
 perform public.content_save_atomic(to_jsonb(v_item)||jsonb_build_object('content',v_new,'quiz_data',v_keys,'has_quiz',true),'admin',v_item.version);
 if exists(select 1 from public.content_items after where after.id=v_item.id and
   (after.archived_at is distinct from v_item.archived_at or after.published is distinct from v_item.published or after.student_access is distinct from v_item.student_access or after.lesson_id is distinct from v_item.lesson_id)) then
   raise exception 'UPGRADE_ACCESS_STATE_CHANGED';
 end if;
end;
$upgrade$;
"""
        target=a.output/(lesson+'.sql');target.write_text(sql);target.chmod(0o600)
    print('Prepared guarded private migrations; no remote changes.')

if __name__=='__main__':main()
