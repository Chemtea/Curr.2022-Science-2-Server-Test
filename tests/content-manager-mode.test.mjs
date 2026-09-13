import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../assets/content-manager.js', import.meta.url), 'utf8');
// Exercise the shipped access/event handlers with isolated DOM and API doubles.
// No browser session or deployed account is altered by these unit tests.
function setup({mode = false, auth = {}, role = 'anonymous'} = {}) {
  const node = () => ({hidden: true, open: false, dataset: {}, attributes: {}, value: 'lesson',
    setAttribute(key, value) { this.attributes[key] = value; }, close() { this.open = false; },
    showModal() { this.open = true; }, reset() {}, querySelectorAll() { return []; }});
  const ids = Object.fromEntries(['scmAdminTab', 'scmManager', 'scmLibrary', 'scmForm', 'scmFile', 'scmSave', 'scmCancelEdit', 'scmKind', 'scmKindHint'].map(id => [id, node()]));
  const requests = [], alerts = [];
  let identity = auth, serverRole = role;
  const window = {addEventListener() {}, ScienceContentClient: {
    auth: () => identity,
    request: async action => { requests.push(action); return {success: true, items: [], role: serverRole}; }
  }};
  const context = vm.createContext({window, isAdminMode: mode, document: {getElementById: id => ids[id] || null}, alert: text => alerts.push(text)});
  const instrumented = source.replace('\n  init();\n', '\n  window.__test = {state, syncAdminUi}; authFingerprint = JSON.stringify(client.auth());\n');
  assert.notEqual(instrumented, source, 'test hook must only replace initial DOM construction');
  vm.runInContext(instrumented, context);
  Object.assign(window.__test.state, {ready: true, role});
  window.__test.syncAdminUi();
  return {context, ids, requests, alerts, manager: window.ScienceContentManager,
    setIdentity(value) { identity = value; }, setRole(value) { serverRole = value; }};
}

test('only server-verified teachers in administrator mode see the compact tab', () => {
  for (const values of [
    {mode: false, role: 'anonymous'},
    {mode: true, auth: {studentSessionToken: 'student-unit-test'}, role: 'student'},
    {mode: true, auth: {adminSessionToken: 'unverified-unit-test'}, role: 'student'},
    {mode: false, auth: {adminSessionToken: 'teacher-unit-test'}, role: 'admin'}
  ]) assert.equal(setup(values).ids.scmAdminTab.hidden, true);
  assert.equal(setup({mode: true, auth: {adminSessionToken: 'teacher-unit-test'}, role: 'admin'}).ids.scmAdminTab.hidden, false);
});

test('administrator mode exit closes dialogs even with an unchanged teacher login', async () => {
  const app = setup({mode: true, auth: {adminSessionToken: 'teacher-unit-test'}, role: 'admin'});
  assert.equal(await app.manager.openManager(), true);
  assert.equal(app.ids.scmManager.open, true);
  app.ids.scmLibrary.showModal();
  const calls = app.requests.length;
  app.context.isAdminMode = false;
  app.manager.authChanged();
  assert.equal(app.ids.scmAdminTab.hidden, true);
  assert.equal(app.ids.scmManager.open, false);
  assert.equal(app.ids.scmLibrary.open, false);
  assert.equal(app.requests.length, calls, 'mode-only change does not reload the same identity');
  app.context.isAdminMode = true;
  app.manager.authChanged();
  assert.equal(app.ids.scmAdminTab.hidden, false);
});

test('temporary teacher session removal clears the manager immediately', async () => {
  const app = setup({mode: true, auth: {adminSessionToken: 'temporary-unit-test'}, role: 'admin'});
  await app.manager.openManager();
  app.context.isAdminMode = false;
  app.setIdentity({studentSessionToken: 'student-unit-test'}); app.setRole('student');
  app.manager.authChanged();
  assert.equal(app.ids.scmManager.open, false);
  assert.equal(app.ids.scmAdminTab.hidden, true);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(app.ids.scmAdminTab.hidden, true);
});

test('opening the popup revalidates a revoked server role and refuses access', async () => {
  const app = setup({mode: true, auth: {adminSessionToken: 'expired-unit-test'}, role: 'admin'});
  app.setRole('anonymous');
  assert.equal(await app.manager.openManager(), false);
  assert.deepEqual(app.requests, ['catalog']);
  assert.equal(app.ids.scmManager.open, false);
  assert.equal(app.ids.scmAdminTab.hidden, true);
});

test('calling manager directly outside administrator mode never starts privileged UI', async () => {
  const app = setup({mode: false, auth: {adminSessionToken: 'teacher-unit-test'}, role: 'admin'});
  assert.equal(await app.manager.openManager(), false);
  assert.equal(app.requests.length, 0);
  assert.equal(app.ids.scmManager.open, false);
});
