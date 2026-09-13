import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, hash, HttpError, RestStore, UNIT_APPEARANCE_ICONS } from '../supabase/functions/content-api/index.ts';

const now = Date.parse('2026-09-13T12:00:00Z');
const adminToken = 'adm_' + 'b'.repeat(96), studentToken = 'stu_' + 'a'.repeat(96);
const adminHash = await hash(adminToken), studentHash = await hash(studentToken);
const env = key => ({SUPABASE_URL: 'https://rerykeslgwhamreoskgx.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-unit-style-test'})[key];
const appearance = {icon: 'galaxy', color_start: '#312E81', color_end: '#7C3AED', mode: 'gradient', angle: 135};
const base = {id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', kind: 'lesson', unit_id: 'unit8', lesson_id: 'u8_l1', title: '1차시 — 별까지의 거리', version: 1, archived_at: null, published: false, student_access: false, content: {privateFixture: true}, quiz_data: [{correct: 1}]};
function fixture({rows = [base], styles = [], sessionChange = {}, unavailable = false} = {}) {
  const calls = [], writes = [], savedStyles = new Map(styles.map(s => [s.unit_id, structuredClone(s)]));
  const db = {
    async one(table, query) {
      calls.push({table, query});
      if (table === 'app_sessions') {
        if (![adminHash, studentHash].some(h => query.token_hash === `eq.${h}`)) return null;
        const admin = query.token_hash === `eq.${adminHash}`;
        return {account_id: admin ? 'teacher-fixture' : 'student-fixture', account_type: admin ? 'admin' : 'student', session_type: admin ? 'admin' : 'student', login_id: admin ? 'admin' : '2301', expires_at: '2026-09-13T13:00:00Z', ...sessionChange};
      }
      if (table === 'app_users') {
        const admin = query.id === 'eq.teacher-fixture';
        return {id: admin ? 'teacher-fixture' : 'student-fixture', login_id: admin ? 'admin' : '2301', account_type: admin ? 'admin' : 'student', status: '등록완료'};
      }
      if (table === 'app_settings') return {setting_value: {}};
      if (table === 'content_items') return rows.find(r => r.unit_id === query.unit_id.slice(3) && r.kind === 'lesson' && !r.archived_at) ?? null;
      throw new Error(`Unexpected ${table}`);
    },
    async request(table, query = {}, body) {
      calls.push({table, query, body});
      if (table === 'content_items') {
        return rows.filter(r => !r.archived_at && (query.published !== 'eq.true' || r.published) && (query.student_access !== 'eq.true' || r.student_access) && (query.kind !== 'in.(lesson,worksheet)' || ['lesson','worksheet'].includes(r.kind)) && (query.kind !== 'neq.answer' || r.kind !== 'answer'));
      }
      if (table === 'unit_appearances') {
        if (unavailable) throw new HttpError('자료 서버에 연결할 수 없습니다.', 503, 'BACKEND_UNAVAILABLE', {operation: 'unit_appearances_read', kind: 'http', httpStatus: 404, backendCode: 'PGRST205', retried: false});
        return [...savedStyles.values()];
      }
      if (table === 'rpc/unit_appearance_save_atomic') {
        const old = savedStyles.get(body.p_unit_id);
        if ((old?.version ?? 0) !== body.p_expected_version) throw new HttpError('다른 작업에서 수정되었습니다.', 409, 'VERSION_CONFLICT');
        const saved = {unit_id: body.p_unit_id, ...structuredClone(body.p_appearance), version: (old?.version ?? 0) + 1, updated_at: '2026-09-13', private_audit_actor: body.p_actor};
        savedStyles.set(body.p_unit_id, saved); writes.push(body);
        return saved;
      }
      throw new Error(`Unexpected ${table}`);
    },
  };
  const handler = createHandler({env, now: () => now, store: db});
  const call = async body => {
    const result = await handler(new Request('https://example.test', {method: 'POST', headers: {'content-type': 'application/json', origin: 'https://chemtea.github.io'}, body: JSON.stringify(body)}));
    return {status: result.status, body: await result.json()};
  };
  return {call, calls, writes, savedStyles};
}
const save = extra => ({action: 'set_unit_appearance', unit_id: 'unit8', appearance, expected_version: 0, adminSessionToken: adminToken, ...extra});

test('verified admin saves only appearance and verified actor, without changing lesson publication or quiz data', async () => {
  const rows = [structuredClone(base)], original = structuredClone(rows), f = fixture({rows});
  const result = await f.call(save({appearance: {...appearance, color_start: '#aabbcc'}, p_actor: 'forged', published: true, student_access: true}));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.appearance, {unit_id: 'unit8', ...appearance, color_start: '#AABBCC', version: 1});
  assert.equal(f.writes[0].p_actor, 'admin');
  assert.deepEqual(Object.keys(f.writes[0]).sort(), ['p_actor','p_appearance','p_expected_version','p_unit_id']);
  assert.deepEqual(rows, original);
  assert.equal(f.calls.some(c => /quiz|points|content_save|storage/.test(c.table)), false);
});

test('student, manager-style forged role and anonymous callers cannot save', async () => {
  for (const auth of [{adminSessionToken: undefined}, {adminSessionToken: undefined, studentSessionToken: studentToken}, {adminSessionToken: undefined, studentSessionToken: studentToken, role: 'admin', isAdmin: true}]) {
    const f = fixture(), result = await f.call(save(auth));
    assert.equal(result.status, 403); assert.equal(result.body.code, 'PERMISSION_DENIED');
    assert.equal(f.calls.some(c => c.table === 'content_items' || c.table.startsWith('rpc/')), false);
    assert.equal(f.writes.length, 0);
  }
});

test('expired, revoked and wrong-role admin sessions cannot save', async () => {
  for (const sessionChange of [{expires_at: '2026-09-13T12:00:00Z'}, {revoked_at: '2026-09-13'}, {session_type: 'student'}, {login_id: 'another-admin'}]) {
    const f = fixture({sessionChange}), result = await f.call(save());
    assert.equal(result.status, 401); assert.equal(f.writes.length, 0);
  }
  const f = fixture(); assert.equal((await f.call(save({adminSessionToken: 'adm_' + 'c'.repeat(96)}))).status, 401);
});

test('all documented icon IDs and endpoint angle values are accepted', async () => {
  for (const icon of UNIT_APPEARANCE_ICONS) {
    const f = fixture(), result = await f.call(save({appearance: {...appearance, icon, angle: icon === 'car' ? 0 : 359}}));
    assert.equal(result.status, 200, icon);
  }
});

test('CSS, HTML, arbitrary icons, unexpected fields and malformed colors are rejected before saving', async () => {
  const patches = [
    {icon: '<svg onload=alert(1)>'}, {icon: 'url(https://example.test/x)'}, {icon: 'not-an-icon'},
    {color_start: 'red'}, {color_start: '#fff'}, {color_end: '#000000; background:url(x)'}, {color_end: '#12345678'},
    {color_start: ' #123456'}, {color_start: '#12345g'}, {color_start: null},
    {mode: 'linear-gradient'}, {mode: ['solid']}, {angle: '135'}, {angle: 2.5}, {angle: -1}, {angle: 360},
    {angle: null}, {css: 'background: red'}, {html: '<img src=x>'}, {constructor: {}},
  ];
  for (const patch of patches) {
    const f = fixture(), result = await f.call(save({appearance: {...appearance, ...patch}}));
    assert.equal(result.status, 400, JSON.stringify(patch)); assert.equal(f.writes.length, 0);
  }
  for (const value of [null, [], 'gradient', {}, {icon: 'galaxy'}]) {
    const f = fixture(); assert.equal((await f.call(save({appearance: value}))).status, 400);
  }
});

test('only actual regular lesson units or built-in units can be styled', async () => {
  for (const unit_id of ['unit99', 'unit3_eval', 'evalHall', '__proto__', 'constructor', 'unit8"),id.not.is.null', '<script>']) {
    const f = fixture(), result = await f.call(save({unit_id}));
    assert.ok([400,404].includes(result.status), unit_id); assert.equal(f.writes.length, 0);
  }
  for (const kind of ['assessment','worksheet','answer']) {
    const f = fixture({rows: [{...base, kind}]}); assert.equal((await f.call(save())).status, 404);
  }
  const archived = fixture({rows: [{...base, archived_at: '2026-09-13'}]}); assert.equal((await archived.call(save())).status, 404);
  for (const unit_id of ['unit3', 'unit7']) assert.equal((await fixture({rows: []}).call(save({unit_id}))).status, 200);
});

test('version is mandatory and stale create/update does not overwrite newer appearance', async () => {
  for (const expected_version of [undefined, '0', -1, 1.5, 2147483647]) {
    const f = fixture(); assert.equal((await f.call(save({expected_version}))).status, 400); assert.equal(f.writes.length, 0);
  }
  const f = fixture(); assert.equal((await f.call(save())).status, 200);
  const conflict = await f.call(save({appearance: {...appearance, icon: 'sun'}}));
  assert.equal(conflict.status, 409); assert.equal(conflict.body.code, 'VERSION_CONFLICT');
  assert.equal(f.savedStyles.get('unit8').icon, 'galaxy'); assert.equal(f.writes.length, 1);
  assert.equal((await f.call(save({expected_version: 1, appearance: {...appearance, mode: 'solid', icon: 'sun'}}))).body.appearance.version, 2);
});

test('catalog returns appearance only for returned regular lesson units, without draft unit or audit leakage', async () => {
  const rows = [base, {...base, id: 'public', unit_id: 'unit1', published: true, student_access: true}, {...base, id: 'assessment', unit_id: 'unit3_eval', kind: 'assessment', published: true, student_access: true}];
  const styles = ['unit8','unit1','unit5','unit3_eval'].map(unit_id => ({unit_id, ...appearance, version: 2, updated_at: 'private', actor: 'private'}));
  for (const [auth, expected] of [[{}, ['unit1']], [{studentSessionToken: studentToken}, ['unit1']], [{adminSessionToken: adminToken}, ['unit8', 'unit1']]]) {
    const f = fixture({rows, styles}), result = await f.call({action: 'catalog', ...auth});
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.unit_appearances.map(s => s.unit_id), expected);
    for (const item of result.body.items) for (const key of ['content','quiz_data']) assert.equal(key in item, false);
    for (const style of result.body.unit_appearances) assert.deepEqual(Object.keys(style).sort(), ['angle','color_end','color_start','icon','mode','unit_id','version']);
  }
});

test('catalog returns diagnosed real error when the appearance table cannot be read', async () => {
  const f = fixture({unavailable: true}), result = await f.call({action: 'catalog'});
  assert.equal(result.status, 503); assert.equal(result.body.code, 'BACKEND_UNAVAILABLE');
  assert.equal(result.body.diagnostic.operation, 'unit_appearances_read');
  assert.equal(result.body.diagnostic.backendCode, 'PGRST205');
  assert.equal('unit_appearances' in result.body, false);
});

test('REST maps version races and missing unit SQL exceptions to stable HTTP errors without retrying writes', async () => {
  for (const [message, status, code] of [['UNIT_APPEARANCE_VERSION_CONFLICT',409,'VERSION_CONFLICT'], ['UNIT_APPEARANCE_UNIT_NOT_FOUND',404,'UNIT_NOT_FOUND'], ['UNIT_APPEARANCE_INVALID',400,'INVALID_REQUEST']]) {
    let calls = 0;
    const db = new RestStore('https://example.test', 'synthetic', async () => { calls++; return new Response(JSON.stringify({message, code: 'P0001'}), {status: 400}); }, {log() {}});
    await assert.rejects(db.request('rpc/unit_appearance_save_atomic', {}, {}), e => e.status === status && e.code === code);
    assert.equal(calls, 1);
  }
});
