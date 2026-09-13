"""Exact test-project integration runner. Credentials and results stay outside git.

Prepare: python tests/live-content-editor.py prepare /absolute/private-work-dir
Apply generated setup.sql ONLY to rerykeslgwhamreoskgx through the authorized
migration tool. After content-api/versions are deployed, run `run` with the same
directory. The runner touches only its generated account, sessions and content.
Apply cleanup.sql after verification; remove private PDF objects separately via
the Storage API before deleting their database references. Never print secrets.
"""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import os
import secrets
import sys
import urllib.error
import urllib.request
import uuid

PROJECT = 'rerykeslgwhamreoskgx'
BASE = f'https://{PROJECT}.supabase.co/functions/v1/content-api'
MARKER = 'synthetic-content-editor-integration'


def write_private(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    path.chmod(0o600)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def prepare(directory):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    if (directory / 'credentials.json').exists():
        raise RuntimeError('Fixture already prepared; use the existing directory or a fresh one.')
    c = {
        'project': PROJECT, 'student_id': str(uuid.uuid4()),
        'student_login': 'editor_test_' + secrets.token_hex(8),
        'student_token': 'stu_' + secrets.token_hex(48),
        'admin_token': 'adm_' + secrets.token_hex(48),
        'content_id': str(uuid.uuid4()), 'pdf_id': str(uuid.uuid4()),
    }
    write_private(directory / 'credentials.json', c)
    sql = f"""-- Synthetic content editor verification only. Exact target: {PROJECT}.
begin;
do $$
declare v_admin uuid;
begin
  select id into v_admin from public.app_users where lower(btrim(login_id))='admin' limit 1;
  if not found then raise exception 'Synthetic fixture requires existing teacher account'; end if;
  insert into public.app_users(id,login_id,name,school_year,status,account_type,password_hash,password_scheme)
    values('{c['student_id']}','{c['student_login']}','Synthetic editor verification',2026,'등록완료','student','{digest(secrets.token_hex(32))}','sha256_client');
  insert into public.app_sessions(token_hash,account_id,session_type,login_id,display_name,account_type,school_year,permissions,expires_at,user_agent)
    values('{digest(c['student_token'])}','{c['student_id']}','student','{c['student_login']}','Synthetic editor verification','student',2026,array[]::text[],now()+interval '60 minutes','{MARKER}');
  insert into public.app_sessions(token_hash,account_id,session_type,login_id,display_name,account_type,school_year,permissions,expires_at,user_agent)
    values('{digest(c['admin_token'])}',v_admin,'admin','admin','Synthetic editor verification','admin',null,array[]::text[],now()+interval '60 minutes','{MARKER}');
end;
$$;
commit;
"""
    (directory / 'setup.sql').write_text(sql)
    (directory / 'setup.sql').chmod(0o600)
    cleanup = f"""-- Revoke only this runner's sessions, then delete only its synthetic rows.
-- Delete Storage objects listed in state.json through the Storage API FIRST.
begin;
delete from public.app_sessions where token_hash in ('{digest(c['student_token'])}','{digest(c['admin_token'])}') and user_agent='{MARKER}';
delete from public.content_quiz_attempts where content_id in ('{c['content_id']}','{c['pdf_id']}');
delete from public.content_versions where content_id in ('{c['content_id']}','{c['pdf_id']}');
delete from public.content_audit where content_id in ('{c['content_id']}','{c['pdf_id']}');
delete from public.content_items where id in ('{c['content_id']}','{c['pdf_id']}') and description='{MARKER}';
delete from public.app_users where id='{c['student_id']}' and login_id='{c['student_login']}';
commit;
"""
    (directory / 'cleanup.sql').write_text(cleanup)
    (directory / 'cleanup.sql').chmod(0o600)
    write_private(directory / 'state.json', {'project': PROJECT, 'checks': [], 'storage_paths': []})
    print('Prepared exact-project synthetic fixture; no remote changes made.', flush=True)


def run(directory):
    c = json.loads((directory / 'credentials.json').read_text())
    state = json.loads((directory / 'state.json').read_text())
    if c.get('project') != PROJECT or state.get('project') != PROJECT:
        raise RuntimeError('Exact test project mismatch.')

    def save_state():
        write_private(directory / 'state.json', state)
        # Public verification report contains check labels only, never credentials or paths.
        (directory / 'results.json').write_text(json.dumps({'project': PROJECT, 'checks': state['checks']}, ensure_ascii=False, indent=2))

    def call(action, fields=None, role='admin', expected=200):
        body = dict(fields or {}, action=action)
        if role in ('admin', 'student'):
            body['adminSessionToken' if role == 'admin' else 'studentSessionToken'] = c[f'{role}_token']
        req = urllib.request.Request(BASE, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'Origin': 'https://chemtea.github.io'}, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                status, data = response.status, json.load(response)
        except urllib.error.HTTPError as error:
            status = error.code
            try:
                data = json.loads(error.read())
            except (ValueError, UnicodeError):
                data = {}
        except (urllib.error.URLError, TimeoutError) as error:
            raise RuntimeError(f'{action}: transport failure ({type(error).__name__}); no automatic retry') from None
        valid = expected if isinstance(expected, tuple) else (expected,)
        if status not in valid:
            state.setdefault('unexpected_responses', []).append({'action': action, 'status': status, 'expected': list(valid), 'code': data.get('code')})
            save_state()
            raise RuntimeError(f'{action}: HTTP {status}; expected {valid}; code={data.get("code")}')
        return status, data

    def fetch(action, fields=None, role='admin', expected=200):
        return call(action, fields, role, expected)[1]

    def step(name, task):
        if name in state['checks']:
            return
        task()
        state['checks'].append(name)
        save_state()
        print('PASS:', name, flush=True)

    def save(fields):
        status, result = call('save_content', fields, expected=(200, 409))
        if status == 200:
            return result['item']
        # Resume only an exact same saved payload after a prior response/checkpoint
        # interruption. Never overwrite an unexpected version or silently retry.
        found = fetch('get_editable', {'id': fields['id']})
        assert found['item']['version'] == fields['expected_version'] + 1, 'Unresolved save conflict'
        for key in ['id', 'title', 'kind', 'format', 'unit_id', 'lesson_id', 'description']:
            assert found['item'].get(key) == fields.get(key), f'Unresolved save conflict: {key}'
        if fields['format'] != 'pdf':
            assert found['content'] == fields['content'], 'Unresolved content conflict'
            assert found['quiz_data'] == fields.get('quiz_data', []), 'Unresolved grading conflict'
        else:
            stored = fetch('get_content', {'id': fields['id']})
            assert stored['file_base64'] == fields['file_base64'], 'Unresolved PDF conflict'
        return found['item']

    private_quiz = [{'correct': 2, 'choices': 2, 'explanation': 'Synthetic private explanation only'}]
    pack = {
        'schema': 'science-lesson/v2', 'title': 'Synthetic editable experiment',
        'originalLessonId': 'editor_synthetic_lesson',
        'steps': [{'title': '관찰', 'html': '<p>원래 합성 수업 본문</p>'}],
        'quiz': [{'question': '합성 확인 문항', 'choices': ['보기 1', '보기 2']}],
        'simulation': {'html': '<canvas id="syntheticCanvas"></canvas>', 'css': 'canvas {width: 100%;}', 'js': 'document.querySelector("canvas").dataset.test="original";', 'dependencies': [], 'microphone': True},
    }
    original_fields = {'id': c['content_id'], 'expected_version': 0, 'kind': 'lesson', 'format': 'lesson-pack', 'title': 'Synthetic editor original', 'description': MARKER, 'unit_id': 'editor_synthetic_unit', 'unit_title': 'Synthetic verification', 'lesson_id': 'editor_synthetic_lesson', 'content': pack, 'quiz_data': private_quiz, 'published': True, 'student_access': True}

    def ready():
        health = fetch('health', role='anonymous')
        assert health['project'] == PROJECT and health.get('contentEditorEnabled') and health.get('serverExperimentsEnabled')
        assert fetch('catalog')['role'] == 'admin'
    step('Exact test content editor and temporary teacher session ready', ready)

    def create():
        saved = save(original_fields)
        assert saved['version'] == 1
        state['lesson_version'] = saved['version']
    step('New server experiment created through authenticated content API', create)

    def private_access():
        editable = fetch('get_editable', {'id': c['content_id']})
        assert editable['content'] == pack and editable['quiz_data'] == private_quiz
        student = fetch('get_content', {'id': c['content_id']}, role='student')
        assert student['content'] == pack and 'quiz_data' not in student
        assert 'Synthetic private explanation only' not in json.dumps(student)
        for action in ['get_editable', 'list_versions', 'get_version', 'restore_version']:
            for role in ['student', 'anonymous']:
                fetch(action, {'id': c['content_id'], 'version': 1, 'expected_version': 1, 'target_version': 1}, role=role, expected=403)
    step('Teacher sees editable answers; student and anonymous editor/history calls denied', private_access)

    replacement_pack = json.loads(json.dumps(pack))
    replacement_pack['steps'][0]['html'] = '<p>수정된 합성 수업 본문</p>'
    replacement_pack['simulation']['js'] = 'document.querySelector("canvas").dataset.test="replacement";'
    replacement_quiz = [{'correct': 1, 'choices': 2, 'explanation': 'Synthetic changed private explanation'}]

    def edit():
        saved = save(dict(original_fields, expected_version=1, title='Synthetic editor revised', content=replacement_pack, quiz_data=replacement_quiz))
        assert saved['version'] == 2
        state['lesson_version'] = saved['version']
    step('Server editor saves changed body, experiment and private grading as a new version', edit)

    def history_check():
        versions = fetch('list_versions', {'id': c['content_id']})['versions']
        latest = versions[0]['version']
        assert latest in (2, 3)
        assert [row['version'] for row in versions] == list(range(latest, 0, -1))
        assert all(set(row) == {'version', 'created_at', 'title', 'kind', 'format'} for row in versions)
        previous = fetch('get_version', {'id': c['content_id'], 'version': 1})
        assert previous['item']['version'] == latest
        assert previous['snapshot']['id'] == c['content_id'] and previous['snapshot']['version'] == 1
        assert previous['snapshot']['content'] == pack and previous['snapshot']['quiz_data'] == private_quiz
        fetch('get_version', {'id': c['content_id'], 'version': 98765}, expected=404)
        fetch('restore_version', {'id': c['content_id'], 'expected_version': latest-1, 'target_version': 1}, expected=409)
        fetch('restore_version', {'id': c['content_id'], 'expected_version': latest, 'target_version': '1'}, expected=400)
        fetch('restore_version', {'id': c['content_id'], 'expected_version': latest, 'target_version': 98765}, expected=404)
    step('Private snapshots and safe version list verified; missing, malformed and stale restores rejected', history_check)

    def restore():
        current = fetch('get_editable', {'id': c['content_id']})
        if current['item']['version'] == 2:
            current = fetch('restore_version', {'id': c['content_id'], 'expected_version': 2, 'target_version': 1})
        assert current['item']['version'] == 3 and current['item']['student_access'] is False
        editable = fetch('get_editable', {'id': c['content_id']})
        assert editable['content'] == pack and editable['quiz_data'] == private_quiz
        fetch('get_content', {'id': c['content_id']}, role='student', expected=403)
        assert [v['version'] for v in fetch('list_versions', {'id': c['content_id']})['versions']] == [3, 2, 1]
        state['lesson_version'] = 3
    step('Actual database restore keeps the original ID and answers and creates teacher-only version three', restore)

    pdf_bytes = [b'%PDF-1.4\n% synthetic content editor old document\n%%EOF\n', b'%PDF-1.4\n% synthetic content editor new document\n%%EOF\n']
    pdf_fields = {'id': c['pdf_id'], 'kind': 'worksheet', 'format': 'pdf', 'title': 'Synthetic PDF history', 'description': MARKER, 'unit_id': 'editor_synthetic_unit', 'unit_title': 'Synthetic verification', 'lesson_id': 'editor_synthetic_lesson', 'quiz_data': [], 'published': True, 'student_access': False}

    def pdf_save(index):
        saved = save(dict(pdf_fields, expected_version=index, file_base64=base64.b64encode(pdf_bytes[index]).decode()))
        assert saved['version'] == index + 1
        state['pdf_version'] = saved['version']
        snapshot = fetch('get_version', {'id': c['pdf_id'], 'version': index + 1})['snapshot']
        assert snapshot['content'] is None and snapshot['storage_path'].startswith(c['pdf_id'] + '/')
        if snapshot['storage_path'] not in state['storage_paths']:
            state['storage_paths'].append(snapshot['storage_path'])
        save_state()
        actual = fetch('get_content', {'id': c['pdf_id']})
        assert base64.b64decode(actual['file_base64']) == pdf_bytes[index]
    step('Initial private PDF uploaded and downloaded byte-for-byte', lambda: pdf_save(0))
    step('Replacement PDF uses a separate private object and version', lambda: pdf_save(1))

    def pdf_restore():
        previous = fetch('get_version', {'id': c['pdf_id'], 'version': 1})['snapshot']
        assert previous['storage_path'] == state['storage_paths'][0]
        current = fetch('get_editable', {'id': c['pdf_id']})
        if current['item']['version'] == 2:
            current = fetch('restore_version', {'id': c['pdf_id'], 'expected_version': 2, 'target_version': 1})
        assert current['item']['version'] == 3
        assert base64.b64decode(fetch('get_content', {'id': c['pdf_id']})['file_base64']) == pdf_bytes[0]
        # The other version also remains available and can be restored again.
        current = fetch('restore_version', {'id': c['pdf_id'], 'expected_version': 3, 'target_version': 2})
        assert current['item']['version'] == 4
        assert base64.b64decode(fetch('get_content', {'id': c['pdf_id']})['file_base64']) == pdf_bytes[1]
        state['pdf_version'] = 4
    step('Historical PDF bytes survive replacement and both versions restore correctly', pdf_restore)

    print(f'Completed {len(state["checks"])} live integration checks; narrow fixture cleanup remains required.', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'run'])
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    try:
        (prepare if args.action == 'prepare' else run)(args.directory.resolve())
    except (AssertionError, RuntimeError) as error:
        print('FAIL:', str(error) or type(error).__name__, file=sys.stderr)
        sys.exit(1)
