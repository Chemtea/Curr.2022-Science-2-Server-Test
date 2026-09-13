import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, canRead, catalogVisible, canReadWorksheetLesson, validateLessonIdentity, RestStore, HttpError, hash } from '../supabase/functions/content-api/index.ts';

const now = Date.parse('2026-09-13T12:00:00Z');
const ids = ['f47ac10b-58cc-4372-a567-0e02b2c3d479','550e8400-e29b-41d4-a716-446655440000','b47164e7-822c-47eb-a2ad-9b80276d8c05'];
const studentToken = 'stu_' + 'a'.repeat(96), adminToken = 'adm_' + 'b'.repeat(96);
const adminHash = await hash(adminToken);
const env = key => ({ SUPABASE_URL: 'https://rerykeslgwhamreoskgx.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-placeholder' })[key];
const source = '<!doctype html><html lang="ko"><body><canvas></canvas><script>window.lesson = "원본";</script></body></html>';
const lesson = { id: ids[0], kind: 'lesson', format: 'html', unit_id: 'unit3', unit_title: '빛과 파동', lesson_id: 'u3_l1', title: '1차시 — 빛의 반사', version: 1, published: true, student_access: true, archived_at: null, content: source, quiz_data: [], storage_path: null };
const worksheet = { ...lesson, id: ids[1], kind: 'worksheet', format: 'pdf', content: null, storage_path: `${ids[1]}/${ids[2]}.pdf` };
const locks = { unit3: { isLocked: true, lessons: { u3_l1: true } }, worksheetCurriculum: { isLocked: false, units: { '3': { isLocked: false, items: { ws_u3_l1: false } } } } };
function fixture({ rows = [lesson, worksheet], lockState = locks, revoked = false, saveError } = {}) {
  const calls = [], saved = [];
  let role;
  const db = {
    async one(table, query) {
      calls.push([table, query]);
      if (table === 'app_sessions') {
        role = query.token_hash === `eq.${adminHash}` ? 'admin' : 'student';
        return { account_id: ids[2], account_type: role, session_type: role, login_id: role, expires_at: '2026-09-13T13:00:00Z', revoked_at: revoked ? '2026-09-13' : null };
      }
      if (table === 'app_users') return { id: ids[2], login_id: role, account_type: role, status: '등록완료' };
      if (table === 'app_settings') return { setting_value: lockState };
      if (table === 'content_items') return rows.find(row => query.id === `eq.${row.id}` || query.unit_id === `eq.${row.unit_id}`) ?? null;
      throw Error(`Unexpected read ${table}`);
    },
    async request(path, query, body) {
      calls.push([path, query, body]);
      if (path === 'content_items') return rows;
      if (path === 'unit_appearances') return [];
      if (path === 'rpc/content_save_atomic') {
        if (saveError) throw saveError;
        const result = { ...body.p_item, version: body.p_expected_version + 1 };
        saved.push(result); return result;
      }
      if (path === 'rpc/content_rename_unit') return { unit_id: body.p_unit_id, unit_title: body.p_unit_title, updated_count: 2 };
      throw Error(`Unexpected operation ${path}`);
    },
    async storage(path, bytes) { calls.push(['storage', path, bytes]); return bytes ? undefined : new TextEncoder().encode('%PDF-1.7\nfixture'); },
    async remove(path) { calls.push(['remove', path]); },
  };
  const handler = createHandler({ env, now: () => now, store: db });
  return { calls, saved, async call(body, origin = 'https://chemtea.github.io') {
    const response = await handler(new Request('https://example.test', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json(), headers: response.headers };
  }};
}

test('worksheet authorization is independent of its locked lesson', () => {
  assert.equal(canRead(lesson, 'student', locks), false);
  assert.equal(canRead(worksheet, 'student', locks), true);
  assert.equal(canReadWorksheetLesson(lesson, worksheet, 'student', locks), true);
  for (const broken of [{}, { worksheetCurriculum: {} }, { ...locks, worksheetCurriculum: { ...locks.worksheetCurriculum, isLocked: true } }]) assert.equal(canRead(worksheet, 'student', broken), false);
});

test('worksheet mode never grants source for a mismatched, archived, private or answer item', () => {
  for (const changed of [{ ...worksheet, unit_id: 'unit7' }, { ...worksheet, lesson_id: 'u3_l2' }, { ...worksheet, published: false }, { ...worksheet, student_access: false }, { ...worksheet, archived_at: '2026-09-13' }, { ...worksheet, kind: 'answer' }, null]) assert.equal(canReadWorksheetLesson(lesson, changed, 'student', locks), false);
  for (const changed of [{ ...lesson, kind: 'answer' }, { ...lesson, published: false }, { ...lesson, student_access: false }, { ...lesson, archived_at: '2026-09-13' }]) assert.equal(canReadWorksheetLesson(changed, worksheet, 'student', locks), false);
  assert.equal(canReadWorksheetLesson(lesson, worksheet, 'anonymous', locks), false);
});

test('catalog retains locked public metadata while hiding drafts and answer keys', async () => {
  const privateRows = [{ ...lesson, id: ids[2], kind: 'answer', content: 'PRIVATE ANSWER' }, { ...lesson, id: ids[2], published: false, title: 'PRIVATE DRAFT' }, { ...lesson, id: ids[2], student_access: false }, { ...lesson, id: ids[2], archived_at: '2026-09-13' }];
  for (const token of [{}, { studentSessionToken: studentToken }]) {
    const response = await fixture({ rows: [lesson, worksheet, ...privateRows] }).call({ action: 'catalog', ...token });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.items.map(x => x.id), [ids[0], ids[1]]);
    assert.equal(JSON.stringify(response.body).includes('PRIVATE'), false);
    assert.equal(JSON.stringify(response.body).includes('<canvas>'), false);
    assert.ok(!('content' in response.body.items[0]));
  }
  assert.equal(catalogVisible({ ...lesson, kind: 'assessment', unit_id: 'unit3_eval', lesson_id: 'u3_e1' }, 'student', locks), false);
});

test('GET source requires auth; verified worksheet route returns original HTML exactly', async () => {
  const f = fixture();
  assert.equal((await f.call({ action: 'get_content', id: ids[0] })).status, 401);
  assert.equal((await f.call({ action: 'get_content', id: ids[0], studentSessionToken: studentToken })).status, 403);
  const result = await f.call({ action: 'get_content', id: ids[0], worksheet_mode: true, worksheet_id: ids[1], studentSessionToken: studentToken });
  assert.equal(result.status, 200); assert.equal(result.body.content, source);
  assert.equal(result.headers.get('cache-control'), 'no-store, private');
  const pdf = await f.call({ action: 'get_content', id: ids[1], studentSessionToken: studentToken });
  assert.equal(pdf.status, 200); assert.ok(atob(pdf.body.file_base64).startsWith('%PDF-'));
  assert.equal(JSON.stringify(pdf.body).includes('storage_path'), false);
  assert.equal((await f.call({ action: 'get_content', id: ids[0], worksheet_mode: true, studentSessionToken: studentToken })).status, 400);
});

test('forged admin flag, revoked session and an opaque origin cannot change content', async () => {
  for (const action of ['save_content', 'rename_unit', 'set_unit_appearance', 'set_publication', 'restore_content', 'restore_version']) assert.equal((await fixture().call({ action, id: ids[0], isAdmin: true, studentSessionToken: studentToken })).status, 403);
  assert.equal((await fixture({ revoked: true }).call({ action: 'get_content', id: ids[0], adminSessionToken: adminToken })).status, 401);
  assert.equal((await fixture().call({ action: 'health' }, 'null')).status, 403);
});

test('new lesson IDs agree with their unit and imported HTML stays byte-for-byte', async () => {
  for (const [unit, id] of [['unit8','u7_l1'], ['unit0','u0_l1'], ['unit8','u8_l0'], ['unit8','u8_l01'], ['unit8','__proto__']]) assert.throws(() => validateLessonIdentity(unit, id));
  validateLessonIdentity('unit8', 'u8_l1');
  const f = fixture();
  const result = await f.call({ action: 'save_content', kind: 'lesson', format: 'html', title: '1차시 — 새 수업', unit_id: 'unit8', unit_title: '별과 우주', lesson_id: 'u8_l1', content: source, adminSessionToken: adminToken });
  assert.equal(result.status, 200); assert.equal(f.saved[0].content, source);
  assert.equal(f.saved[0].student_access, false); assert.equal(f.saved[0].published, false);
  assert.deepEqual(f.saved[0].quiz_data, []);
  assert.equal((await f.call({ action: 'save_content', kind: 'lesson', format: 'lesson-pack', adminSessionToken: adminToken })).status, 400);
});

test('HTML accepts up to 10MB and rejects oversized source before writing', async () => {
  const base = { action: 'save_content', kind: 'lesson', format: 'html', title: '1차시', unit_id: 'unit8', unit_title: '별과 우주', lesson_id: 'u8_l1', adminSessionToken: adminToken };
  const f = fixture();
  assert.equal((await f.call({ ...base, content: 'x'.repeat(10 * 1024 * 1024) })).status, 200);
  assert.equal((await f.call({ ...base, content: 'x'.repeat(10 * 1024 * 1024 + 1) })).status, 413);
  assert.equal(f.saved.length, 1);
});

test('database identity conflicts are returned as actionable 409 errors', async () => {
  for (const payload of [{ code: 'P0001', message: 'CONTENT_IDENTITY_CONFLICT' }, { code: '23505', message: 'duplicate key value violates unique constraint "content_active_lesson_identity"' }]) {
    const store = new RestStore(env('SUPABASE_URL'), 'test-only', async () => new Response(JSON.stringify(payload), { status: 409 }), { log: () => {} });
    await assert.rejects(store.request('rpc/content_save_atomic', {}, {}), error => error instanceof HttpError && error.status === 409 && error.code === 'CONTENT_IDENTITY_CONFLICT');
  }
  const f = fixture({ saveError: new HttpError('Duplicate', 409, 'CONTENT_IDENTITY_CONFLICT') });
  assert.equal((await f.call({ action: 'save_content', kind: 'lesson', format: 'html', title: '1차시', unit_id: 'unit3', unit_title: '빛과 파동', lesson_id: 'u3_l1', content: source, adminSessionToken: adminToken })).status, 409);
});

test('unit rename passes an expected title to one audited atomic RPC', async () => {
  const f = fixture();
  const result = await f.call({ action: 'rename_unit', unit_id: 'unit3', unit_title: '새 이름', expected_title: '빛과 파동', adminSessionToken: adminToken });
  assert.equal(result.status, 200); assert.equal(result.body.updated_count, 2);
  const rpc = f.calls.find(x => x[0] === 'rpc/content_rename_unit');
  assert.deepEqual(rpc[2], { p_unit_id: 'unit3', p_unit_title: '새 이름', p_expected_title: '빛과 파동', p_actor: 'admin' });
});

test('health describes raw HTML mode and does not advertise the retired pack engine', async () => {
  const result = await fixture().call({ action: 'health' });
  assert.equal(result.body.mode, 'legacy-html-catalog');
  assert.equal(result.body.maxFileBytes, 10485760);
  assert.equal(result.body.commonQuizEngineEnabled, undefined);
  assert.equal((await fixture().call({ action: 'begin_quiz' })).status, 400);
});
