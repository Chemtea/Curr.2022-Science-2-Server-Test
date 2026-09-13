import test from 'node:test';
import assert from 'node:assert/strict';
import { accountEnabled, validSession, canRead, metadata, quizData, grade, publicPack, decodePdf, createHandler, authenticate } from '../supabase/functions/content-api/index.ts';

const now = Date.parse('2026-09-13T12:00:00Z');
const id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const userId = '550e8400-e29b-41d4-a716-446655440000';
const studentToken = 'stu_' + 'a'.repeat(96);
const adminToken = 'adm_' + 'b'.repeat(96);
const studentSession = { account_id: userId, account_type: 'student', session_type: 'student', login_id: 'test_student', expires_at: '2026-09-13T13:00:00Z' };
const user = { id: userId, login_id: 'test_student', account_type: 'student', status: '등록완료' };
const item = { id, kind: 'lesson', format: 'lesson-pack', unit_id: 'unit3', lesson_id: 'u3_l1', title: 'Test', published: true, student_access: true, version: 1, content: { schema: 'science-lesson/v1', builtin_id: 'u3_l1' }, quiz_data: [{ correct: 2, choices: 4, explanation: 'Private explanation' }] };
const locks = { unit3: { isLocked: false, lessons: { u3_l1: false } }, step_locks: { u3_l1: { '4': false } }, worksheetCurriculum: { isLocked: false, units: { '3': { isLocked: false, items: { ws_u3_l1: false } } } } };
const env = key => ({ SUPABASE_URL: 'https://rerykeslgwhamreoskgx.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-placeholder-only' })[key];
const request = body => new Request('https://example.test', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://chemtea.github.io' }, body: JSON.stringify(body) });
function store(overrides = {}) {
  return {
    async one(table) {
      if (table === 'app_sessions') return studentSession;
      if (table === 'app_users') return user;
      if (table === 'app_settings') return { setting_value: locks };
      if (table === 'content_items') return item;
      throw new Error('Unexpected table');
    },
    async request(path, query, body) {
      if (path === 'rpc/content_record_quiz') return { ...body.p_result, attemptNo: 1 };
      if (path === 'content_items') return [item];
      throw new Error('Unexpected write');
    }, ...overrides,
  };
}

test('expired, invalid-date, revoked and forged admin sessions fail', () => {
  assert.equal(validSession(studentSession, 'stu_', now), true);
  for (const session of [{ ...studentSession, expires_at: 'bad' }, { ...studentSession, expires_at: '2026-09-13T12:00:00Z' }, { ...studentSession, revoked_at: '2026-09-13T11:00:00Z' }]) assert.equal(validSession(session, 'stu_', now), false);
  assert.equal(validSession(studentSession, 'adm_', now), false);
  assert.equal(validSession({ ...studentSession, session_type: 'admin' }, 'adm_', now), false);
});
test('disabled and unapproved users fail even if session has not expired', () => {
  assert.equal(accountEnabled(user), true);
  for (const change of [{ status: '정지' }, { status: 'pending' }, { status: '' }, { is_active: false }, { approval_status: 'pending' }, { deleted_at: '2026-09-13' }]) assert.equal(accountEnabled({ ...user, ...change }), false);
});
test('teacher answers never reach students or anonymous visitors', () => {
  const answer = { ...item, kind: 'answer' };
  assert.equal(canRead(answer, 'student', locks), false);
  assert.equal(canRead(answer, 'anonymous', locks), false);
  assert.equal(canRead(answer, 'admin', locks), true);
});
test('assessment release requires every explicit server lock', () => {
  const assessment = { ...item, kind: 'assessment', unit_id: 'unit3_eval', lesson_id: 'u3e_l3' };
  assert.equal(canRead(assessment, 'student', {}), false);
  const open = { evalHallVisibilityMode: 'all', unit3_eval: { isLocked: false, lessons: { u3e_l3: false } } };
  assert.equal(canRead(assessment, 'student', open), true);
  assert.equal(canRead(assessment, 'student', { ...open, evalHallVisibilityMode: 'admin_only' }), false);
  assert.equal(canRead({ ...assessment, student_access: false }, 'student', open), false);
});
test('builtin lesson and worksheet access fail closed when lock entries are absent', () => {
  assert.equal(canRead(item, 'student', {}), false);
  assert.equal(canRead(item, 'student', locks), true);
  const worksheet = { ...item, kind: 'worksheet', format: 'pdf' };
  assert.equal(canRead(worksheet, 'student', { unit3: locks.unit3 }), false);
  assert.equal(canRead(worksheet, 'student', locks), true);
  assert.equal(canRead(worksheet, 'student', { ...locks, worksheetCurriculum: { ...locks.worksheetCurriculum, isLocked: true } }), false);
  assert.equal(canRead({ ...item, lesson_id: 'new_lesson' }, 'student', {}), true);
});
test('metadata whitelist excludes payload, paths, private answers and credentials', () => {
  const safe = metadata({ ...item, storage_path: 'secret.pdf', token: 'secret', service_role: 'secret' });
  for (const key of ['content', 'storage_path', 'quiz_data', 'token', 'service_role']) assert.equal(key in safe, false);
});
test('grading ignores client scores and rejects booleans/out-of-range/partial answers', () => {
  const questions = quizData(item.quiz_data);
  assert.equal(grade(questions, [1]).score, 0);
  assert.equal(grade(questions, [2]).score, 1);
  for (const answers of [[true], ['2'], [5], [], [2, 2]]) assert.throws(() => grade(questions, answers));
});
test('fake PDF, data URLs and non-PDF payload are rejected', () => {
  assert.throws(() => decodePdf(btoa('<script>bad</script>')));
  assert.throws(() => decodePdf('data:application/pdf;base64,JVBERi0='));
  assert.equal(new TextDecoder().decode(decodePdf(btoa('%PDF-1.7 test'))), '%PDF-1.7 test');
});
test('public lesson schema rejects nested answer keys, mismatched quizzes and unsupported builtins', () => {
  const questions = [{ correct: 1, choices: 2, explanation: 'private' }];
  const pack = { schema: 'science-lesson/v1', steps: [{ title: '학습', html: '<p>내용</p>' }], quiz: [{ question: '문항', choices: ['A', 'B'] }] };
  assert.deepEqual(publicPack(pack, questions, 'new_lesson'), pack);
  for (const key of ['correct', 'answer', 'explanation', 'quizAnswerKey']) {
    assert.throws(() => publicPack({ ...pack, quiz: [{ ...pack.quiz[0], [key]: 'private' }] }, questions, 'new_lesson'));
  }
  assert.throws(() => publicPack(pack, [], 'new_lesson'));
  assert.throws(() => publicPack({ schema: 'science-lesson/v1', builtin_id: 'unknown' }, [], 'unknown'));
});
test('a student cannot upload, publish, archive or read private answers through POST', async () => {
  const handler = createHandler({ env, now: () => now, store: store() });
  for (const action of ['save_content', 'set_publication', 'delete_content']) {
    assert.equal((await handler(request({ action, id, studentSessionToken: studentToken, isAdmin: true }))).status, 403);
  }
  const denied = createHandler({ env, now: () => now, store: store({ async one(table, query) { return table === 'content_items' ? { ...item, kind: 'answer' } : store().one(table, query); } }) });
  assert.equal((await denied(request({ action: 'get_content', id, studentSessionToken: studentToken }))).status, 403);
});
test('get_content never returns private quiz keys', async () => {
  const handler = createHandler({ env, now: () => now, store: store() });
  const response = await handler(request({ action: 'get_content', id, studentSessionToken: studentToken }));
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(text.includes('Private explanation'), false);
  assert.equal(text.includes('quiz_data'), false);
});
test('real step_locks path gates submissions and missing builtin step4 remains locked', async () => {
  for (const step of [undefined, true]) {
    let writes = 0;
    const blocked = store({ async one(table, query) { return table === 'app_settings' ? { setting_value: { ...locks, step_locks: { u3_l1: { '4': step } } } } : store().one(table, query); }, async request() { writes++; } });
    const handler = createHandler({ env, now: () => now, store: blocked });
    const response = await handler(request({ action: 'submit_quiz', id, studentSessionToken: studentToken, answers: [2], score: 999 }));
    assert.equal(response.status, 403); assert.equal(writes, 0);
  }
  const handler = createHandler({ env, now: () => now, store: store() });
  const response = await handler(request({ action: 'submit_quiz', id, studentSessionToken: studentToken, answers: [1], score: 999 }));
  const result = await response.json();
  assert.equal(result.score, 0); assert.equal(result.awardedPoints, 0);
});
test('legacy null-account admin session needs existing server credential', async () => {
  const admin = { ...studentSession, account_id: null, account_type: 'admin', session_type: 'admin', login_id: 'admin' };
  const ok = store({ async one(table) { return table === 'app_sessions' ? admin : { setting_value: { hash: 'c'.repeat(64) } }; } });
  assert.equal((await authenticate({ adminSessionToken: adminToken }, ok, now)).role, 'admin');
  const removed = store({ async one(table) { return table === 'app_sessions' ? admin : null; } });
  await assert.rejects(authenticate({ adminSessionToken: adminToken }, removed, now));
});
test('production environment and opaque iframe origin are rejected', async () => {
  const bad = createHandler({ env: key => key === 'SUPABASE_URL' ? 'https://wrong-project.supabase.co' : 'test', store: store() });
  assert.equal((await bad(request({ action: 'health' }))).status, 503);
  const handler = createHandler({ env, store: store() });
  const req = new Request('https://example.test', { method: 'POST', headers: { Origin: 'null' }, body: '{"action":"health"}' });
  assert.equal((await handler(req)).status, 403);
});
