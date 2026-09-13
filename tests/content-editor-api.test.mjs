import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, hash, HttpError, publicPack, RestStore } from '../supabase/functions/content-api/index.ts';

const now = Date.parse('2026-09-13T12:00:00Z');
const id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const otherId = 'b47164e7-822c-47eb-a2ad-9b80276d8c05';
const accountId = '550e8400-e29b-41d4-a716-446655440000';
const adminToken = 'adm_' + 'b'.repeat(96);
const studentToken = 'stu_' + 'a'.repeat(96);
const adminHash = await hash(adminToken);
const studentHash = await hash(studentToken);
const clone = value => structuredClone(value);
const env = key => ({ SUPABASE_URL: 'https://rerykeslgwhamreoskgx.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'unit-test-placeholder-only' })[key];
const privateQuiz = [{ correct: 2, choices: 2, explanation: 'Private teacher grading explanation' }];
const pack = {
  schema: 'science-lesson/v2', title: '서버 실험 수업', originalLessonId: 'u3_l1',
  steps: [{ title: '탐구', html: '<p>거울에 비친 모습을 관찰합니다.</p>' }],
  quiz: [{ question: '빛의 반사를 설명하는 것은?', choices: ['선택 1', '선택 2'] }],
  simulation: {
    html: '<canvas id="experiment"></canvas><button onclick="observe()">관찰</button>',
    css: '#experiment { width: 100%; border: 1px solid #ccc; }',
    js: 'function observe() { document.querySelector("canvas").dataset.observed = "true"; }',
    dependencies: [], microphone: true,
  },
};
const item = {
  id, kind: 'lesson', format: 'lesson-pack', title: '현재 수업', description: '설명',
  unit_id: 'unit3', unit_title: '빛과 파동', lesson_id: 'u3_l1', version: 8,
  published: true, student_access: true, archived_at: null, has_quiz: true,
  created_at: '2026-09-10T10:00:00Z', updated_at: '2026-09-13T10:00:00Z',
  content: pack, quiz_data: privateQuiz, storage_path: null,
};
const old = { ...clone(item), title: '이전 수업', version: 3, updated_at: '2026-09-11T10:00:00Z', content: { ...clone(pack), title: '이전 본문' } };
const locks = { unit3: { isLocked: false, lessons: { u3_l1: false } } };
const privateRead = call => ['content_items', 'content_versions'].includes(call.table) || call.table.startsWith('rpc/');
const request = body => new Request('https://example.test', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://chemtea.github.io' }, body: JSON.stringify(body),
});

function fixture({ current = item, snapshots = [old], rpcError, sessionChange = {} } = {}) {
  const rows = new Map(current ? [[current.id, clone(current)]] : []);
  const history = snapshots.map(snapshot => ({ content_id: snapshot.id, version: snapshot.version, created_at: snapshot.updated_at, snapshot: clone(snapshot), extra_private_field: 'must never be listed' }));
  const calls = [], storageCalls = [];
  let lastRole;
  const db = {
    async one(table, query) {
      calls.push({ method: 'one', table, query: clone(query) });
      if (table === 'app_sessions') {
        lastRole = query.token_hash === `eq.${adminHash}` ? 'admin' : query.token_hash === `eq.${studentHash}` ? 'student' : null;
        if (!lastRole) return null;
        return { account_id: accountId, account_type: lastRole, session_type: lastRole, login_id: lastRole === 'admin' ? 'admin' : 'test_student', expires_at: '2026-09-13T13:00:00Z', ...sessionChange };
      }
      if (table === 'app_users') return { id: accountId, login_id: lastRole === 'admin' ? 'admin' : 'test_student', account_type: lastRole, status: '등록완료' };
      if (table === 'app_settings') return { setting_value: clone(locks) };
      if (table === 'content_items') return clone(rows.get(query.id.slice(3)) ?? null);
      if (table === 'content_versions') return clone(history.find(row => query.content_id === `eq.${row.content_id}` && query.version === `eq.${row.version}`) ?? null);
      throw new Error(`Unexpected read: ${table}`);
    },
    async request(table, query = {}, body) {
      calls.push({ method: body === undefined ? 'GET' : 'POST', table, query: clone(query), body: clone(body) });
      if (table === 'content_versions') return clone(history.filter(row => query.content_id === `eq.${row.content_id}`).sort((a, b) => b.version - a.version));
      if (table === 'rpc/content_restore_version') {
        if (rpcError) throw rpcError;
        const present = rows.get(body.p_content_id);
        const previous = history.find(row => row.content_id === body.p_content_id && row.version === body.p_target_version);
        if (body.p_expected_version !== present?.version) throw new HttpError('Version conflict', 409, 'VERSION_CONFLICT');
        if (!previous) throw new HttpError('Version not found', 404, 'VERSION_NOT_FOUND');
        const saved = { ...clone(previous.snapshot), id: present.id, version: present.version + 1, created_at: present.created_at, published: true, student_access: false, archived_at: null };
        rows.set(saved.id, saved);
        return clone(saved);
      }
      if (table === 'rpc/content_save_atomic') {
        if (rpcError) throw rpcError;
        const present = rows.get(body.p_item.id);
        if (body.p_expected_version !== (present?.version ?? 0)) throw new HttpError('Version conflict', 409, 'VERSION_CONFLICT');
        const saved = { ...clone(body.p_item), version: (present?.version ?? 0) + 1 };
        rows.set(saved.id, saved);
        return clone(saved);
      }
      throw new Error(`Unexpected request: ${table}`);
    },
    async storage(path, bytes) { storageCalls.push({ method: bytes ? 'upload' : 'download', path, bytes }); },
    async remove(path) { storageCalls.push({ method: 'remove', path }); },
  };
  const handler = createHandler({ env, now: () => now, store: db });
  const call = async body => { const response = await handler(request(body)); return { status: response.status, body: await response.json() }; };
  return { rows, history, calls, storageCalls, call };
}

test('editor and every history operation deny students and anonymous users before private queries', async () => {
  for (const action of ['get_editable', 'list_versions', 'get_version', 'restore_version']) {
    for (const auth of [{}, { studentSessionToken: studentToken }, { studentSessionToken: studentToken, isAdmin: true, role: 'admin' }]) {
      const f = fixture();
      const result = await f.call({ action, id, version: 3, target_version: 3, expected_version: 8, ...auth });
      assert.equal(result.status, 403, action);
      assert.equal(f.calls.some(privateRead), false, action);
      assert.equal(f.storageCalls.length, 0);
    }
  }
});

test('expired or revoked teacher sessions cannot access editor history', async () => {
  for (const sessionChange of [{ expires_at: '2026-09-13T12:00:00Z' }, { revoked_at: '2026-09-13T11:59:00Z' }]) {
    const f = fixture({ sessionChange });
    assert.equal((await f.call({ action: 'get_editable', id, adminSessionToken: adminToken })).status, 401);
    assert.equal(f.calls.some(privateRead), false);
  }
});

test('archived content blocks editing, version reads and version restoration until archive restore', async () => {
  for (const action of ['get_editable', 'list_versions', 'get_version', 'restore_version']) {
    const f = fixture({ current: { ...clone(item), archived_at: '2026-09-13T11:00:00Z' } });
    const result = await f.call({ action, id, version: 3, target_version: 3, expected_version: 8, adminSessionToken: adminToken });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'CONTENT_ARCHIVED');
    assert.equal(f.calls.some(call => call.table === 'content_versions' || call.table.startsWith('rpc/')), false);
  }
});

test('teacher editor receives private keys separately; ordinary student content never includes them', async () => {
  const f = fixture();
  const teacher = await f.call({ action: 'get_editable', id, adminSessionToken: adminToken });
  assert.equal(teacher.status, 200);
  assert.deepEqual(teacher.body.content, pack);
  assert.deepEqual(teacher.body.quiz_data, privateQuiz);
  for (const key of ['content', 'quiz_data', 'storage_path']) assert.equal(key in teacher.body.item, false);
  const student = await f.call({ action: 'get_content', id, studentSessionToken: studentToken });
  assert.equal(student.status, 200);
  assert.deepEqual(student.body.content, pack);
  assert.equal(JSON.stringify(student.body).includes('Private teacher grading explanation'), false);
  assert.equal('quiz_data' in student.body, false);
});

test('version list scopes the selected resource and returns an explicit metadata whitelist', async () => {
  const f = fixture({ snapshots: [old, { ...clone(old), id: otherId, title: 'Different private resource' }, { ...clone(old), version: 7, title: 'Recent saved version' }] });
  const result = await f.call({ action: 'list_versions', id, adminSessionToken: adminToken });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.versions.map(row => row.version), [7, 3]);
  for (const row of result.body.versions) assert.deepEqual(Object.keys(row).sort(), ['version', 'created_at', 'title', 'kind', 'format'].sort());
  assert.equal(JSON.stringify(result.body).includes('Private teacher grading explanation'), false);
  assert.equal(JSON.stringify(result.body).includes('Different private resource'), false);
  const read = f.calls.find(call => call.table === 'content_versions');
  assert.equal(read.query.content_id, `eq.${id}`);
  assert.equal(read.query.order, 'version.desc');
});

test('version preview returns current item metadata plus the selected private historical snapshot', async () => {
  const f = fixture({ snapshots: [old, { ...clone(old), id: otherId, title: 'Wrong item', version: 6 }] });
  const result = await f.call({ action: 'get_version', id, version: 3, adminSessionToken: adminToken });
  assert.equal(result.status, 200);
  assert.equal(result.body.item.id, id);
  assert.equal(result.body.item.title, item.title);
  assert.equal(result.body.item.version, 8);
  assert.deepEqual(result.body.snapshot, old);
  assert.deepEqual(result.body.snapshot.quiz_data, privateQuiz);
  const read = f.calls.find(call => call.table === 'content_versions');
  assert.deepEqual(read.query, { select: 'snapshot', content_id: `eq.${id}`, version: 'eq.3' });
  const unrelated = await f.call({ action: 'get_version', id, version: 6, adminSessionToken: adminToken });
  assert.equal(unrelated.status, 404);
  assert.equal(unrelated.body.code, 'VERSION_NOT_FOUND');
});

test('version restore sends only identity, expected version, target version and server actor to private RPC', async () => {
  const f = fixture();
  const result = await f.call({ action: 'restore_version', id, expected_version: 8, target_version: 3, adminSessionToken: adminToken,
    p_actor: 'forged', student_access: true, snapshot: { id: otherId, title: 'Forged', quiz_data: [] }, content: 'Forged content' });
  assert.equal(result.status, 200);
  const rpc = f.calls.find(call => call.table === 'rpc/content_restore_version');
  assert.deepEqual(rpc.body, { p_content_id: id, p_expected_version: 8, p_target_version: 3, p_actor: 'admin' });
  assert.equal(result.body.item.id, id);
  assert.equal(result.body.item.version, 9);
  assert.equal(result.body.item.student_access, false);
  assert.equal(result.body.item.title, old.title);
  for (const key of ['content', 'quiz_data', 'storage_path']) assert.equal(key in result.body.item, false);
  assert.deepEqual(f.rows.get(id).quiz_data, privateQuiz);
  assert.equal(f.rows.size, 1);
  assert.equal(f.storageCalls.length, 0);
});

test('malformed, stale and missing versions fail without a restore write', async () => {
  for (const change of [{ expected_version: 7 }, { expected_version: '8' }, { expected_version: null }, { target_version: 0 }, { target_version: 1.5 }, { target_version: '3' }]) {
    const f = fixture();
    const result = await f.call({ action: 'restore_version', id, expected_version: 8, target_version: 3, adminSessionToken: adminToken, ...change });
    assert.equal(result.status, change.expected_version === 7 ? 409 : 400);
    assert.equal(f.calls.some(call => call.table.startsWith('rpc/')), false);
  }
  for (const version of [undefined, null, '3', 0, -1, 2.5]) {
    const f = fixture();
    assert.equal((await f.call({ action: 'get_version', id, version, adminSessionToken: adminToken })).status, 400);
    assert.equal(f.calls.some(call => call.table === 'content_versions'), false);
  }
  const missing = fixture({ current: null });
  assert.equal((await missing.call({ action: 'get_editable', id, adminSessionToken: adminToken })).status, 404);
  assert.equal(missing.calls.some(call => call.table === 'content_versions'), false);
});

test('atomic restore conflict propagates without a second write or storage deletion', async () => {
  const f = fixture({ rpcError: new HttpError('Concurrent change', 409, 'VERSION_CONFLICT') });
  const result = await f.call({ action: 'restore_version', id, expected_version: 8, target_version: 3, adminSessionToken: adminToken });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'VERSION_CONFLICT');
  assert.deepEqual(f.rows.get(id), item);
  assert.equal(f.calls.filter(call => call.table.startsWith('rpc/')).length, 1);
  assert.equal(f.storageCalls.length, 0);
});

test('database version failure messages map to stable API status codes', async () => {
  for (const [message, status, code] of [
    ['CONTENT_VERSION_CONFLICT', 409, 'VERSION_CONFLICT'], ['CONTENT_ARCHIVED', 409, 'CONTENT_ARCHIVED'],
    ['CONTENT_VERSION_NOT_FOUND', 404, 'VERSION_NOT_FOUND'], ['CONTENT_NOT_FOUND', 404, 'VERSION_NOT_FOUND'],
    ['CONTENT_VERSION_INVALID', 400, 'INVALID_REQUEST'],
  ]) {
    const db = new RestStore('https://rerykeslgwhamreoskgx.supabase.co', 'placeholder', async () => new Response(JSON.stringify({ message }), { status: 400 }));
    await assert.rejects(db.request('rpc/content_restore_version', {}, {}), error => error instanceof HttpError && error.status === status && error.code === code);
  }
});

test('v2 packs preserve HTML, CSS, JavaScript and explicit microphone permission through server save', async () => {
  assert.deepEqual(publicPack(pack, privateQuiz, 'u3_l1'), pack);
  const f = fixture();
  const result = await f.call({ ...clone(item), action: 'save_content', expected_version: 8, adminSessionToken: adminToken });
  assert.equal(result.status, 200);
  assert.deepEqual(f.rows.get(id).content, pack);
  assert.deepEqual(f.rows.get(id).quiz_data, privateQuiz);
  assert.equal(JSON.stringify(f.rows.get(id).content).includes('Private teacher grading explanation'), false);
});

test('v2 schema rejects external dependency declarations, original-ID spoofing and hidden answer fields', () => {
  const cases = [
    { ...clone(pack), simulation: { ...clone(pack.simulation), dependencies: ['https://example.test/external.js'] } },
    { ...clone(pack), simulation: { ...clone(pack.simulation), dependencies: null } },
    { ...clone(pack), simulation: { ...clone(pack.simulation), microphone: 'true' } },
    { ...clone(pack), simulation: { ...clone(pack.simulation), allowedOrigin: '*' } },
    { ...clone(pack), simulation: { ...clone(pack.simulation), js: null } },
    { ...clone(pack), simulation: { ...clone(pack.simulation), css: 'x'.repeat(900001) } },
    { ...clone(pack), originalLessonId: 'u7_l8' },
    { ...clone(pack), builtin_id: 'u3_l1' },
    { ...clone(pack), quiz_data: privateQuiz },
    { ...clone(pack), steps: [{ ...clone(pack.steps[0]), correct: 2 }] },
    { ...clone(pack), quiz: [{ ...clone(pack.quiz[0]), explanation: 'Private explanation' }] },
  ];
  for (const candidate of cases) assert.throws(() => publicPack(candidate, privateQuiz, 'u3_l1'), HttpError);
  const optionalMic = clone(pack); delete optionalMic.simulation.microphone;
  assert.deepEqual(publicPack(optionalMic, privateQuiz, 'u3_l1'), optionalMic);
});

test('replacing a PDF or changing its format preserves historical private PDF objects', async () => {
  const pdf = { ...clone(item), kind: 'worksheet', format: 'pdf', content: null, quiz_data: [], has_quiz: false, storage_path: `${id}/d03b4e9c-c9b5-4974-b37a-b960ae64d266.pdf` };
  for (const replacement of [
    { format: 'pdf', file_base64: btoa('%PDF-1.7 synthetic replacement') },
    { format: 'html', content: '<p>새 학습지 본문</p>' },
  ]) {
    const f = fixture({ current: pdf });
    const result = await f.call({ ...clone(pdf), ...replacement, action: 'save_content', expected_version: 8, adminSessionToken: adminToken });
    assert.equal(result.status, 200);
    assert.equal(f.storageCalls.some(call => call.method === 'remove'), false);
    if (replacement.format === 'pdf') {
      assert.equal(f.storageCalls.filter(call => call.method === 'upload').length, 1);
      assert.notEqual(f.rows.get(id).storage_path, pdf.storage_path);
    } else assert.equal(f.rows.get(id).storage_path, null);
  }
});

test('a confirmed failed PDF save removes only its newly uploaded object', async () => {
  const pdf = { ...clone(item), kind: 'worksheet', format: 'pdf', content: null, quiz_data: [], has_quiz: false, storage_path: `${id}/d03b4e9c-c9b5-4974-b37a-b960ae64d266.pdf` };
  const f = fixture({ current: pdf, rpcError: new HttpError('Concurrent update', 409, 'VERSION_CONFLICT') });
  const result = await f.call({ ...clone(pdf), action: 'save_content', expected_version: 8, file_base64: btoa('%PDF-1.7 synthetic new file'), adminSessionToken: adminToken });
  assert.equal(result.status, 409);
  const uploaded = f.storageCalls.find(call => call.method === 'upload');
  const removed = f.storageCalls.filter(call => call.method === 'remove');
  assert.equal(removed.length, 1);
  assert.equal(removed[0].path, uploaded.path);
  assert.notEqual(removed[0].path, pdf.storage_path);
  assert.equal(f.rows.get(id).storage_path, pdf.storage_path);
});

test('an uncertain PDF save failure retains its private upload in case the transaction committed', async () => {
  const pdf = { ...clone(item), kind: 'worksheet', format: 'pdf', content: null, quiz_data: [], has_quiz: false, storage_path: `${id}/d03b4e9c-c9b5-4974-b37a-b960ae64d266.pdf` };
  for (const rpcError of [new HttpError('Response unavailable', 503, 'BACKEND_UNAVAILABLE'), new TypeError('Transport interrupted')]) {
    const f = fixture({ current: pdf, rpcError });
    const result = await f.call({ ...clone(pdf), action: 'save_content', expected_version: 8, file_base64: btoa('%PDF-1.7 synthetic uncertain save'), adminSessionToken: adminToken });
    assert.equal(result.status, rpcError instanceof HttpError ? 503 : 500);
    assert.equal(f.storageCalls.filter(call => call.method === 'upload').length, 1);
    assert.equal(f.storageCalls.some(call => call.method === 'remove'), false);
  }
});
