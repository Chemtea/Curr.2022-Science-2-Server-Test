import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, RestStore, createHandler } from '../supabase/functions/content-api/index.ts';

const projectUrl = 'https://rerykeslgwhamreoskgx.supabase.co';
const fakeServiceKey = 'synthetic_service_key_do_not_log';
const sensitive = [fakeServiceKey, 'synthetic_student_token', 'synthetic_private_answer', 'synthetic_row_id', 'synthetic_query_field'];
const diagnosticFields = ['backendCode', 'httpStatus', 'kind', 'operation', 'retried'];
const diagnosticOperations = new Set(['settings_read', 'sessions_read', 'accounts_read', 'content_read', 'versions_read', 'quiz_rpc', 'content_save_rpc', 'content_restore_rpc', 'rest_read', 'rest_write']);
const response = (status, body = { code: 'PGRST000', message: 'synthetic_private_answer' }) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const settingsQuery = { select: 'setting_value', setting_key: 'eq.lock_states' };

function safeDiagnostic(value, expected = {}) {
  assert.ok(value && typeof value === 'object', 'a safe diagnostic is available');
  assert.deepEqual(Object.keys(value).sort(), diagnosticFields);
  assert.ok(diagnosticOperations.has(value.operation), 'operation uses a fixed diagnostic label');
  assert.ok(['http', 'network', 'timeout', 'invalid_response'].includes(value.kind));
  assert.equal(typeof value.httpStatus, 'number');
  assert.ok(Number.isInteger(value.httpStatus) && value.httpStatus >= 0 && value.httpStatus <= 599);
  assert.equal(typeof value.retried, 'boolean');
  assert.ok(value.backendCode === null || /^(?:PGRST\d{3}|[0-9A-Z]{5})$/.test(value.backendCode));
  for (const [key, result] of Object.entries(expected)) assert.equal(value[key], result, key);
  assertSafeOutput(value);
}

function assertSafeOutput(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const marker of sensitive) assert.equal(serialized.includes(marker), false, 'diagnostics omit request and backend secrets');
  for (const marker of ['Authorization', 'Bearer ', '/rest/v1/', 'https://', 'token_hash', 'quiz_data']) {
    assert.equal(serialized.includes(marker), false, 'diagnostics omit headers, URL and private payload fields');
  }
}

async function captureFailure(promise) {
  let failed;
  try { await promise; } catch (error) { failed = error; }
  assert.ok(failed instanceof HttpError, 'backend failures become controlled HttpError values');
  assertSafeOutput({ message: failed.message, code: failed.code, diagnostic: failed.diagnostic });
  return failed;
}

test('GET retries one transient 503 and returns the second valid response', async () => {
  const calls = [], logs = [];
  const db = new RestStore(projectUrl, fakeServiceKey, async (url, init) => {
    calls.push({ url, init });
    return calls.length === 1 ? response(503) : response(200, [{ setting_value: { ready: true } }]);
  }, { log: entry => logs.push(entry) });
  const result = await db.request('app_settings', settingsQuery);
  assert.deepEqual(result, [{ setting_value: { ready: true } }]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.init.method === 'GET' && call.init.body === undefined));
  assert.equal(String(calls[0].url), String(calls[1].url));
  for (const entry of logs) safeDiagnostic(entry, { operation: 'settings_read' });
});

test('GET never retries 401 and retains only its safe PostgREST error code', async () => {
  let calls = 0;
  const logs = [];
  const db = new RestStore(projectUrl, fakeServiceKey, async () => {
    calls++;
    return response(401, { code: 'PGRST301', message: 'synthetic_student_token', details: 'synthetic_private_answer' });
  }, { log: entry => logs.push(entry) });
  const error = await captureFailure(db.request('app_settings', settingsQuery));
  assert.equal(calls, 1);
  safeDiagnostic(error.diagnostic, { operation: 'settings_read', kind: 'http', httpStatus: 401, backendCode: 'PGRST301', retried: false });
  assert.ok(logs.length > 0);
  for (const entry of logs) safeDiagnostic(entry);
});

test('POST failure makes one attempt so an uncertain write is never repeated', async () => {
  let calls = 0;
  const logs = [];
  const db = new RestStore(projectUrl, fakeServiceKey, async (_url, init) => {
    calls++;
    assert.equal(init.method, 'POST');
    return response(503, { code: '08006', message: 'synthetic_private_answer' });
  }, { log: entry => logs.push(entry) });
  const error = await captureFailure(db.request('rpc/content_save_atomic', {}, {
    p_item: { id: 'synthetic_row_id', quiz_data: 'synthetic_private_answer' }, p_actor: 'synthetic_student_token',
  }));
  assert.equal(calls, 1);
  safeDiagnostic(error.diagnostic, { kind: 'http', httpStatus: 503, backendCode: '08006', retried: false });
  for (const entry of logs) safeDiagnostic(entry);
});

test('GET does not enable retries for an RPC or any request carrying a body', async () => {
  for (const [path, body] of [['rpc/content_save_atomic', undefined], ['content_items', { private: 'synthetic_private_answer' }]]) {
    let calls = 0;
    const logs = [];
    const db = new RestStore(projectUrl, fakeServiceKey, async (_url, init) => {
      calls++;
      assert.equal(init.method, 'GET');
      return response(503);
    }, { log: entry => logs.push(entry) });
    const error = await captureFailure(db.request(path, {}, body, 'GET'));
    assert.equal(calls, 1);
    safeDiagnostic(error.diagnostic, { kind: 'http', httpStatus: 503, retried: false });
    for (const entry of logs) safeDiagnostic(entry);
  }
});

test('two failing GET requests stop after the one permitted retry', async () => {
  let calls = 0;
  const logs = [];
  const db = new RestStore(projectUrl, fakeServiceKey, async () => {
    calls++;
    return response(calls === 1 ? 502 : 504, { code: 'PGRST002', message: 'synthetic_private_answer' });
  }, { log: entry => logs.push(entry) });
  const error = await captureFailure(db.request('app_settings', settingsQuery));
  assert.equal(calls, 2);
  safeDiagnostic(error.diagnostic, { operation: 'settings_read', kind: 'http', httpStatus: 504, backendCode: 'PGRST002', retried: true });
  for (const entry of logs) safeDiagnostic(entry);
});

test('a GET network error can recover once without logging transport error text', async () => {
  let calls = 0;
  const logs = [];
  const db = new RestStore(projectUrl, fakeServiceKey, async () => {
    if (++calls === 1) throw new TypeError(`Network error at ${projectUrl}/rest/v1/app_settings?token_hash=synthetic_student_token`);
    return response(200, [{ setting_value: {} }]);
  }, { log: entry => logs.push(entry) });
  assert.deepEqual(await db.request('app_settings', settingsQuery), [{ setting_value: {} }]);
  assert.equal(calls, 2);
  for (const entry of logs) safeDiagnostic(entry, { operation: 'settings_read' });
});

test('an uncertain POST network failure is not retried', async () => {
  let calls = 0;
  const logs = [];
  const db = new RestStore(projectUrl, fakeServiceKey, async () => {
    calls++;
    throw new Error('synthetic_private_answer synthetic_student_token');
  }, { log: entry => logs.push(entry) });
  const error = await captureFailure(db.request('rpc/content_save_atomic', {}, { private: 'synthetic_private_answer' }));
  assert.equal(calls, 1);
  safeDiagnostic(error.diagnostic, { kind: 'network', httpStatus: 0, backendCode: null, retried: false });
  for (const entry of logs) safeDiagnostic(entry);
});

test('backend body, arbitrary code, query values and credentials never enter diagnostics or logs', async () => {
  const logs = [];
  const db = new RestStore(projectUrl, fakeServiceKey, async () => response(400, {
    code: 'synthetic_private_answer',
    message: 'synthetic_student_token',
    details: { Authorization: `Bearer ${fakeServiceKey}`, row: 'synthetic_row_id' },
    hint: `https://secret.example/rest/v1/app_users?token_hash=synthetic_student_token`,
    quiz_data: 'synthetic_private_answer',
  }), { log: entry => logs.push(entry) });
  const error = await captureFailure(db.request('synthetic_private_answer', {
    synthetic_query_field: 'eq.synthetic_row_id', token_hash: 'eq.synthetic_student_token',
  }));
  safeDiagnostic(error.diagnostic, { kind: 'http', httpStatus: 400, backendCode: null, retried: false });
  assert.ok(logs.length > 0);
  for (const entry of logs) safeDiagnostic(entry);
  assertSafeOutput(logs);
});

test('a five-character SQLSTATE remains useful while nested or malformed codes are discarded', async () => {
  for (const [code, expected] of [['42501', '42501'], ['PGRST301', 'PGRST301'], ['PGRST301 synthetic_private_answer', null], [{ token: 'synthetic_student_token' }, null]]) {
    const logs = [];
    const db = new RestStore(projectUrl, fakeServiceKey, async () => response(403, { code, message: 'synthetic_private_answer' }), { log: entry => logs.push(entry) });
    const error = await captureFailure(db.request('app_settings', settingsQuery));
    safeDiagnostic(error.diagnostic, { operation: 'settings_read', kind: 'http', httpStatus: 403, backendCode: expected, retried: false });
    for (const entry of logs) safeDiagnostic(entry);
  }
});

test('a transport ignoring AbortSignal still settles within the total request budget', { timeout: 1000 }, async () => {
  let calls = 0;
  const logs = [];
  const db = new RestStore(projectUrl, fakeServiceKey, () => {
    calls++;
    return new Promise(() => {});
  }, { requestBudgetMs: 30, log: entry => logs.push(entry) });
  const started = performance.now();
  const error = await captureFailure(db.request('app_settings', settingsQuery));
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 500, `request exceeded its bounded budget (${Math.round(elapsed)}ms)`);
  assert.ok(calls >= 1 && calls <= 2);
  safeDiagnostic(error.diagnostic, { operation: 'settings_read', kind: 'timeout', httpStatus: 0, backendCode: null });
  for (const entry of logs) safeDiagnostic(entry);
});

test('the retry shares the total budget after the first request consumes time', { timeout: 1000 }, async () => {
  let calls = 0;
  const logs = [];
  const db = new RestStore(projectUrl, fakeServiceKey, async () => {
    if (++calls === 1) {
      await new Promise(resolve => setTimeout(resolve, 20));
      return response(503);
    }
    return new Promise(() => {});
  }, { requestBudgetMs: 40, log: entry => logs.push(entry) });
  const started = performance.now();
  const error = await captureFailure(db.request('app_settings', settingsQuery));
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 500, `read retry was unbounded (${Math.round(elapsed)}ms)`);
  assert.equal(calls, 2);
  safeDiagnostic(error.diagnostic, { operation: 'settings_read', kind: 'timeout', httpStatus: 0, backendCode: null, retried: true });
  for (const entry of logs) safeDiagnostic(entry);
});

test('a successful status with invalid JSON fails explicitly instead of returning null', async () => {
  let calls = 0;
  const logs = [];
  const db = new RestStore(projectUrl, fakeServiceKey, async () => {
    calls++;
    return new Response('{"broken": synthetic_private_answer', { status: 200 });
  }, { log: entry => logs.push(entry) });
  const error = await captureFailure(db.request('app_settings', settingsQuery));
  assert.equal(calls, 1);
  safeDiagnostic(error.diagnostic, { operation: 'settings_read', kind: 'invalid_response', httpStatus: 200, backendCode: null, retried: false });
  for (const entry of logs) safeDiagnostic(entry);
});

test('an HTTP handler returns the safe diagnostic without backend details', async () => {
  let calls = 0;
  const logs = [];
  const db = new RestStore(projectUrl, fakeServiceKey, async () => {
    calls++;
    return response(503, { code: 'PGRST002', message: 'synthetic_private_answer', details: 'synthetic_student_token' });
  }, { log: entry => logs.push(entry) });
  const handler = createHandler({
    env: key => ({ SUPABASE_URL: projectUrl, SUPABASE_SERVICE_ROLE_KEY: fakeServiceKey })[key],
    store: db,
  });
  const result = await handler(new Request('https://example.test', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://chemtea.github.io' },
    body: JSON.stringify({ action: 'catalog' }),
  }));
  const body = await result.json();
  assert.equal(calls, 2);
  assert.equal(result.status, 503);
  assert.equal(body.success, false);
  safeDiagnostic(body.diagnostic, { operation: 'settings_read', kind: 'http', httpStatus: 503, backendCode: 'PGRST002', retried: true });
  assertSafeOutput(body);
  for (const entry of logs) safeDiagnostic(entry);
});
