-- Run only on science-platform-test (rerykeslgwhamreoskgx).
-- Private, owner-only rollback snapshot. No source tables are changed.
begin;
create schema reset_backup_20260913_html;
revoke all on schema reset_backup_20260913_html from public, anon, authenticated, service_role;
create table reset_backup_20260913_html.manifest(table_name text primary key, row_count bigint not null, saved_at timestamptz not null default now());
do $$ declare r record; n bigint; begin
  for r in select tablename from pg_tables where schemaname='public' loop
    execute format('create table reset_backup_20260913_html.%I as table public.%I', r.tablename, r.tablename);
    execute format('select count(*) from reset_backup_20260913_html.%I', r.tablename) into n;
    insert into reset_backup_20260913_html.manifest(table_name,row_count) values(r.tablename,n);
  end loop;
end $$;
create table reset_backup_20260913_html.storage_objects as select * from storage.objects;
create table reset_backup_20260913_html.storage_buckets as select * from storage.buckets;
-- Existing private Storage bytes are retained; object metadata alone is not a binary backup.
revoke all on all tables in schema reset_backup_20260913_html from public, anon, authenticated, service_role;
commit;
