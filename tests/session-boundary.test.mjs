import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';

// Independent review: production and test share chemtea.github.io's origin.
// Verify that test code does not adopt, transmit, or erase production state.
const site = new URL('../', import.meta.url);
const code = name => fs.readFileSync(new URL(name, site), 'utf8');
function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: key => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: key => values.delete(String(key)),
    clear: () => values.clear(), key: index => [...values.keys()][index] ?? null,
    get length() { return values.size; }
  };
}
function context() {
  const requests = [];
  const window = {
    sessionStorage: memoryStorage({current_student: JSON.stringify({studentSessionToken: 'production-session-sentinel'}), current_admin_key: 'production-admin-sentinel'}),
    localStorage: memoryStorage({'ctw:notes:v1:production': 'keep-production-notes'})
  };
  const sandbox = vm.createContext({window, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => { requests.push({url, options, body: JSON.parse(options.body)}); return {ok: true, json: async () => ({success:true, items:[]})}; }
  });
  vm.runInContext(code('platform-config.js'), sandbox);
  vm.runInContext(code('assets/content-client.js'), sandbox);
  return {window, requests};
}

test('test bootstrap never adopts same-origin production sessions', async () => {
  const {window, requests} = context();
  assert.equal(window.platformSessionStorage.getItem('current_student'), null);
  await window.ScienceContentClient.request('catalog');
  assert.equal(requests[0].body.studentSessionToken, undefined);
  assert.equal(requests[0].body.adminSessionToken, undefined);
  assert.equal(requests[0].url, 'https://rerykeslgwhamreoskgx.supabase.co/functions/v1/content-api');
  assert.equal(requests[0].options.credentials, 'omit');
});

test('test logout/clear retains production sessions and notes', () => {
  const {window} = context();
  window.platformSessionStorage.setItem('current_student', '{}');
  window.platformLocalStorage.setItem('ctw:notes:v1:student-test', 'test-notes');
  assert.equal(window.platformSessionStorage.length, 1);
  window.platformSessionStorage.clear(); window.platformLocalStorage.clear();
  assert.equal(window.platformSessionStorage.length, 0);
  assert.equal(window.sessionStorage.getItem('current_admin_key'), 'production-admin-sentinel');
  assert.equal(window.localStorage.getItem('ctw:notes:v1:production'), 'keep-production-notes');
});

test('transport derives current test identity rather than trusting caller role fields', async () => {
  const {window, requests} = context();
  window.platformSessionStorage.setItem('current_student', JSON.stringify({studentSessionToken:'stu_test-sentinel', isAdmin:false}));
  await window.ScienceContentClient.request('catalog', {studentSessionToken:'forged-sentinel'});
  assert.equal(requests.at(-1).body.studentSessionToken, 'stu_test-sentinel');
  window.platformSessionStorage.setItem('temporary_admin_mode', '1');
  window.platformSessionStorage.setItem('current_admin_key', 'adm_test-sentinel');
  await window.ScienceContentClient.request('catalog');
  assert.equal(requests.at(-1).body.adminSessionToken, 'adm_test-sentinel');
  assert.equal(requests.at(-1).body.studentSessionToken, undefined);
});
