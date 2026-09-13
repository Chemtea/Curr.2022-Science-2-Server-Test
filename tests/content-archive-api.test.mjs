import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, hash, HttpError } from '../supabase/functions/content-api/index.ts';

const now = Date.parse('2026-09-13T12:00:00Z');
const id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const activeId = 'b47164e7-822c-47eb-a2ad-9b80276d8c05';
const accountId = '550e8400-e29b-41d4-a716-446655440000';
const adminToken = 'adm_' + 'b'.repeat(96);
const studentToken = 'stu_' + 'a'.repeat(96);
const adminHash = await hash(adminToken);
const studentHash = await hash(studentToken);
const env = key => ({ SUPABASE_URL: 'https://rerykeslgwhamreoskgx.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'unit-test-placeholder-only' })[key];
const clone = value => structuredClone(value);
const archived = {
  id, kind: 'lesson', format: 'lesson-pack', title: '보관한 수업', description: '보관 설명',
  unit_id: 'unit3', unit_title: '빛과 파동', lesson_id: 'u3_l1', version: 8,
  published: false, student_access: false, archived_at: '2026-09-12T10:00:00Z',
  created_at: '2026-09-10T10:00:00Z', updated_at: '2026-09-12T10:00:00Z', has_quiz: true,
  content: { schema: 'science-lesson/v1', builtin_id: 'u3_l1' },
  quiz_data: [{ correct: 2, choices: 4, explanation: '비공개 정답 해설' }], storage_path: null,
};
const active = { ...clone(archived), id: activeId, title: '활성 수업', archived_at: null, published: true, student_access: true };
const locks = { unit3: { isLocked: false, lessons: { u3_l1: false } } };
const request = body => new Request('https://example.test', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://chemtea.github.io' }, body: JSON.stringify(body),
});

/** Stateful mock honors the same row filters and optimistic version boundary as REST/RPC. */
function fixture({ records = [archived, active], sessionChange = {}, beforeSave } = {}) {
  const rows = new Map(records.map(row => [row.id, clone(row)]));
  const calls = [], audit = [], storageCalls = [];
  const db = {
    async one(table, query) {
      calls.push({ method: 'one', table, query: clone(query) });
      if (table === 'app_sessions') {
        const admin = query.token_hash === `eq.${adminHash}`;
        const student = query.token_hash === `eq.${studentHash}`;
        if (!admin && !student) return null;
        return { account_id: accountId, account_type: admin ? 'admin' : 'student', session_type: admin ? 'admin' : 'student', login_id: admin ? 'admin' : 'test_student', expires_at: '2026-09-13T13:00:00Z', ...sessionChange };
      }
      if (table === 'app_users') {
        const lastSession = [...calls].reverse().find(call => call.table === 'app_sessions');
        const admin = lastSession.query.token_hash === `eq.${adminHash}`;
        return { id: accountId, login_id: admin ? 'admin' : 'test_student', account_type: admin ? 'admin' : 'student', status: '등록완료' };
      }
      if (table === 'app_settings') return { setting_value: clone(locks) };
      if (table === 'content_items') return clone(rows.get(String(query.id).replace(/^eq\./, '')) ?? null);
      throw new Error(`Unexpected read: ${table}`);
    },
    async request(path, query = {}, body, method) {
      calls.push({ method: method ?? (body === undefined ? 'GET' : 'POST'), table: path, query: clone(query), body: clone(body) });
      if (path === 'unit_appearances') return [];
      if (path === 'content_items') {
        assert.equal(body, undefined, 'Catalog must not write content rows');
        let found = [...rows.values()];
        if (query.archived_at === 'is.null') found = found.filter(row => row.archived_at == null);
        if (query.archived_at === 'not.is.null') found = found.filter(row => row.archived_at != null);
        if (query.published === 'eq.true') found = found.filter(row => row.published === true);
        if (query.student_access === 'eq.true') found = found.filter(row => row.student_access === true);
        if (query.kind === 'neq.answer') found = found.filter(row => row.kind !== 'answer');
        if (query.kind === 'in.(lesson,worksheet)') found = found.filter(row => ['lesson', 'worksheet'].includes(row.kind));
        return found.map(row => query.select && query.select !== '*' ? Object.fromEntries(query.select.split(',').map(key => [key, clone(row[key])])) : clone(row));
      }
      if (path === 'rpc/content_save_atomic') {
        if (beforeSave) beforeSave(rows, body);
        const existing = rows.get(body.p_item.id);
        if (body.p_expected_version !== (existing?.version ?? 0)) throw new HttpError('Version conflict', 409, 'VERSION_CONFLICT');
        const saved = { ...clone(body.p_item), version: (existing?.version ?? 0) + 1, updated_at: new Date(now).toISOString() };
        rows.set(saved.id, saved);
        audit.push({ id: saved.id, action: existing ? 'update' : 'create', version: saved.version, actor: body.p_actor });
        return clone(saved);
      }
      throw new Error(`Unexpected write: ${path}`);
    },
    async storage(...args) { storageCalls.push(['storage', ...args]); throw new Error('Restoring must not access object storage'); },
    async remove(...args) { storageCalls.push(['remove', ...args]); throw new Error('Restoring must not delete object storage'); },
  };
  const handler = createHandler({ env, now: () => now, store: db });
  const call = async body => { const response = await handler(request(body)); return { status: response.status, body: await response.json() }; };
  return { rows, calls, audit, storageCalls, call };
}

test('administrator archive catalog returns only archived metadata without private payloads', async () => {
  const f = fixture();
  const result = await f.call({ action: 'list_archived', adminSessionToken: adminToken });
  assert.equal(result.status, 200);
  assert.equal(result.body.role, 'admin');
  assert.deepEqual(result.body.items.map(item => item.id), [id]);
  assert.equal(result.body.items[0].archived_at, archived.archived_at);
  for (const key of ['content', 'quiz_data', 'storage_path', 'token_hash']) assert.equal(key in result.body.items[0], false);
  const read = f.calls.find(call => call.table === 'content_items');
  assert.equal(read.query.archived_at, 'not.is.null');
  assert.notEqual(read.query.select, '*');
  assert.equal(f.audit.length, 0);
});

test('anonymous and student archive operations are denied before reading content records', async () => {
  for (const action of ['list_archived', 'restore_content']) {
    for (const auth of [{}, { studentSessionToken: studentToken }, { studentSessionToken: studentToken, isAdmin: true, role: 'admin' }]) {
      const f = fixture();
      const result = await f.call({ action, id, expected_version: 8, ...auth });
      assert.equal(result.status, 403, JSON.stringify({ action, auth }));
      assert.equal(f.calls.some(call => call.table === 'content_items' || call.table.startsWith('rpc/')), false);
      assert.deepEqual(f.rows.get(id), archived);
    }
  }
});

test('expired, revoked, forged, and wrong-role administrator tokens cannot list or restore', async () => {
  for (const action of ['list_archived', 'restore_content']) {
    for (const setup of [
      { token: 'adm_' + 'c'.repeat(96), change: {} },
      { token: adminToken, change: { expires_at: '2026-09-13T12:00:00Z' } },
      { token: adminToken, change: { revoked_at: '2026-09-13T11:59:00Z' } },
      { token: adminToken, change: { session_type: 'student', account_type: 'student' } },
      { token: 'admin', change: {} },
    ]) {
      const f = fixture({ sessionChange: setup.change });
      const result = await f.call({ action, id, expected_version: 8, adminSessionToken: setup.token });
      assert.equal(result.status, 401);
      assert.equal(f.calls.some(call => call.table === 'content_items' || call.table.startsWith('rpc/')), false);
      assert.equal(f.audit.length, 0);
    }
  }
});

test('restore retains the same resource, payload, answer keys, and submission reference identity', async () => {
  const f = fixture();
  const result = await f.call({ action: 'restore_content', id, expected_version: 8, adminSessionToken: adminToken });
  assert.equal(result.status, 200);
  assert.equal(result.body.item.id, id);
  assert.equal(result.body.item.version, 9);
  const saved = f.rows.get(id);
  assert.equal(f.rows.size, 2, 'Restore must update the original row rather than copy it');
  for (const key of ['id', 'kind', 'format', 'title', 'description', 'unit_id', 'lesson_id', 'content', 'quiz_data', 'storage_path', 'created_at']) assert.deepEqual(saved[key], archived[key], key);
  assert.equal(saved.archived_at, null);
  assert.equal(saved.published, true);
  assert.equal(saved.student_access, false);
  assert.deepEqual(f.audit, [{ id, action: 'update', version: 9, actor: 'admin' }]);
  const writes = f.calls.filter(call => call.table.startsWith('rpc/'));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].table, 'rpc/content_save_atomic');
  assert.equal(writes[0].body.p_expected_version, 8);
  assert.equal(f.storageCalls.length, 0);
  for (const key of ['content', 'quiz_data', 'storage_path']) assert.equal(key in result.body.item, false);
});

test('restore ignores incoming publication, payload, type, quiz, and storage modifications', async () => {
  const f = fixture();
  const result = await f.call({ action: 'restore_content', id, expected_version: 8, adminSessionToken: adminToken,
    student_access: true, published: false, archived_at: '2099-01-01', title: 'Forged title', kind: 'answer',
    content: 'Forged body', quiz_data: [{ correct: 1 }], storage_path: 'forged.pdf', file_base64: 'forged', version: 99,
  });
  assert.equal(result.status, 200);
  const saved = f.rows.get(id);
  assert.equal(saved.published, true);
  assert.equal(saved.student_access, false);
  assert.equal(saved.archived_at, null);
  assert.equal(saved.version, 9);
  for (const key of ['title', 'kind', 'content', 'quiz_data', 'storage_path']) assert.deepEqual(saved[key], archived[key]);
  assert.equal(f.storageCalls.length, 0);
});

test('PDF restore keeps the original private object path without uploading or deleting a file', async () => {
  const pdf = { ...clone(archived), kind: 'worksheet', format: 'pdf', content: null, quiz_data: [], has_quiz: false, storage_path: `${id}/d03b4e9c-c9b5-4974-b37a-b960ae64d266.pdf` };
  const f = fixture({ records: [pdf] });
  const result = await f.call({ action: 'restore_content', id, expected_version: 8, adminSessionToken: adminToken });
  assert.equal(result.status, 200);
  assert.equal(f.rows.get(id).storage_path, pdf.storage_path);
  assert.equal(f.storageCalls.length, 0);
});

test('restored answers stay inaccessible to students and cannot be published to them', async () => {
  const answer = { ...clone(archived), kind: 'answer', format: 'html', content: '<p>교사 전용 답안</p>', quiz_data: [], has_quiz: false };
  const f = fixture({ records: [answer] });
  assert.equal((await f.call({ action: 'restore_content', id, expected_version: 8, student_access: true, adminSessionToken: adminToken })).status, 200);
  assert.equal((await f.call({ action: 'get_content', id, studentSessionToken: studentToken })).status, 403);
  const catalog = await f.call({ action: 'catalog', studentSessionToken: studentToken });
  assert.deepEqual(catalog.body.items, []);
  const publication = await f.call({ action: 'set_publication', id, expected_version: 9, published: true, student_access: true, adminSessionToken: adminToken });
  assert.equal(publication.status, 403);
  assert.equal(f.rows.get(id).student_access, false);
  assert.equal((await f.call({ action: 'get_content', id, adminSessionToken: adminToken })).status, 200);
});

test('archived bodies remain inaccessible even to an administrator until explicit restore', async () => {
  for (const auth of [{ adminSessionToken: adminToken }, { studentSessionToken: studentToken }]) {
    const f = fixture();
    const result = await f.call({ action: 'get_content', id, ...auth });
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'CONTENT_LOCKED');
    assert.equal(f.storageCalls.length, 0);
    assert.equal(f.audit.length, 0);
  }
});

test('saving or publishing archived rows cannot implicitly restore or overwrite them', async () => {
  for (const action of ['save_content', 'set_publication']) {
    const f = fixture();
    const result = await f.call({ ...clone(archived), action, id, expected_version: 8, archived_at: null, published: true, student_access: true, adminSessionToken: adminToken });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'CONTENT_ARCHIVED');
    assert.deepEqual(f.rows.get(id), archived);
    assert.equal(f.calls.some(call => call.table.startsWith('rpc/')), false);
    assert.equal(f.storageCalls.length, 0);
  }
});

test('restore rejects absent, mismatched, and already-active versions without writes', async () => {
  for (const fields of [{ id, expected_version: 7 }, { id }, { id, expected_version: '8' }, { id: activeId, expected_version: 8 }]) {
    const f = fixture();
    const result = await f.call({ action: 'restore_content', ...fields, adminSessionToken: adminToken });
    assert.equal(result.status, 409);
    assert.equal(f.calls.some(call => call.table.startsWith('rpc/')), false);
    assert.equal(f.audit.length, 0);
  }
  const f = fixture({ records: [] });
  assert.equal((await f.call({ action: 'restore_content', id, expected_version: 8, adminSessionToken: adminToken })).status, 404);
});

test('optimistic restore conflict leaves the newer archived row intact', async () => {
  const f = fixture({ beforeSave(rows) { rows.set(id, { ...rows.get(id), title: '새 작업에서 수정', version: 9 }); } });
  const result = await f.call({ action: 'restore_content', id, expected_version: 8, adminSessionToken: adminToken });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'VERSION_CONFLICT');
  assert.equal(f.rows.get(id).archived_at, archived.archived_at);
  assert.equal(f.rows.get(id).title, '새 작업에서 수정');
  assert.equal(f.audit.length, 0);
  assert.equal(f.storageCalls.length, 0);
});

test('restore transfers the same resource from archive catalog to teacher-only active catalog', async () => {
  const f = fixture({ records: [archived] });
  assert.equal((await f.call({ action: 'catalog', adminSessionToken: adminToken })).body.items.length, 0);
  assert.equal((await f.call({ action: 'restore_content', id, expected_version: 8, adminSessionToken: adminToken })).status, 200);
  assert.equal((await f.call({ action: 'list_archived', adminSessionToken: adminToken })).body.items.length, 0);
  const teacher = await f.call({ action: 'catalog', adminSessionToken: adminToken });
  assert.deepEqual(teacher.body.items.map(item => item.id), [id]);
  assert.equal(teacher.body.items[0].student_access, false);
  for (const auth of [{}, { studentSessionToken: studentToken }]) {
    assert.equal((await f.call({ action: 'catalog', ...auth })).body.items.length, 0);
  }
  assert.equal((await f.call({ action: 'set_publication', id, expected_version: 9, published: true, student_access: true, adminSessionToken: adminToken })).status, 200);
  assert.deepEqual((await f.call({ action: 'catalog', studentSessionToken: studentToken })).body.items.map(item => item.id), [id]);
});
