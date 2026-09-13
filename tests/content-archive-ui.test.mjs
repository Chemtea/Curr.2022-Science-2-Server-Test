import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../assets/content-manager.js', import.meta.url), 'utf8');
const archived = {id: '12345678-1234-1234-1234-123456789012', title: '보관한 학습지', kind: 'worksheet', version: 3, archived_at: '2026-09-13T02:00:00Z'};
const active = {id: '22345678-1234-1234-1234-123456789012', title: '사용 중 수업', kind: 'lesson', version: 1};
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; }

function setup() {
  const node = tagName => ({tagName, hidden: false, open: false, dataset: {}, attributes: {}, children: [], value: 'lesson', listeners: {}, style: {},
    setAttribute(key, value) { this.attributes[key] = value; }, close() { this.open = false; }, showModal() { this.open = true; }, reset() {},
    append(...children) { this.children.push(...children); }, appendChild(child) { this.append(child); }, replaceChildren(...children) { this.children = children; },
    addEventListener(name, fn) { this.listeners[name] = fn; }, querySelectorAll() { return []; }, focus() {}});
  const ids = Object.fromEntries(['scmAdminTab','scmManager','scmLibrary','scmForm','scmFile','scmSave','scmCancelEdit','scmKind','scmKindHint',
    'scmMessage','scmManageItems','scmArchiveItems','scmArchivePanel','scmActiveTab','scmArchiveTab','scmBrowseLibrary'].map(id => [id, node('div')]));
  const requests = [];
  let identity = {adminSessionToken: 'teacher-unit-test'}, role = 'admin';
  let handler = async action => ({success: true, role, items: action === 'list_archived' ? [archived] : [active]});
  const window = {addEventListener() {}, ScienceContentClient: {auth: () => identity, contentUrl: item => 'lesson.html?id=' + item.id,
    request: (action, payload) => { requests.push({action, payload}); return handler(action, payload); }}};
  const context = vm.createContext({window, isAdminMode: true, document: {getElementById: id => ids[id] || null, createElement: node}, alert() {}, confirm: () => true});
  const instrumented = source.replace('\n  init();\n', '\n  window.__test = {state, selectManagerView, refreshArchive, restore}; authFingerprint = JSON.stringify(client.auth());\n');
  assert.notEqual(instrumented, source);
  vm.runInContext(instrumented, context);
  Object.assign(window.__test.state, {ready: true, role: 'admin', items: [active]});
  ids.scmManager.showModal();
  return {ids, context, requests, manager: window.ScienceContentManager, ...window.__test,
    handle(fn) { handler = fn; }, identity(value, nextRole) { identity = value; role = nextRole; }};
}

test('archive tab loads a separate administrator list with only restore actions', async () => {
  const app = setup();
  await app.selectManagerView('archived');
  assert.equal(app.state.items.length, 1);
  assert.equal(app.state.items[0].id, active.id, 'archived metadata cannot enter the active/student catalog');
  assert.equal(app.state.archivedItems[0].id, archived.id);
  assert.deepEqual(app.requests.map(call => call.action), ['list_archived']);
  assert.equal(app.ids.scmForm.hidden, true);
  assert.equal(app.ids.scmArchivePanel.hidden, false);
  assert.equal(app.ids.scmArchiveTab.attributes['aria-pressed'], 'true');
  const row = app.ids.scmArchiveItems.children[0];
  assert.equal(row.children.length, 2);
  assert.equal(row.children[1].textContent, '교사 전용으로 복원');
  assert.match(row.children[0].children[1].textContent, /보관일/);
  await app.selectManagerView('active');
  assert.equal(app.ids.scmForm.hidden, false);
  assert.equal(app.ids.scmArchivePanel.hidden, true);
});

test('restore keeps the same identity/version contract and blocks duplicate clicks while pending', async () => {
  const app = setup(); await app.selectManagerView('archived');
  const pending = deferred();
  app.handle(action => action === 'restore_content' ? pending.promise : Promise.resolve({success: true, role: 'admin', items: action === 'catalog' ? [{...archived, archived_at: null, published: true, student_access: false, version: 4}] : []}));
  const task = app.restore(archived);
  assert.equal(app.ids.scmArchiveItems.children[0].children[1].disabled, true);
  await app.restore(archived);
  assert.equal(app.requests.filter(call => call.action === 'restore_content').length, 1);
  const payload = app.requests.find(call => call.action === 'restore_content').payload;
  assert.equal(payload.id, archived.id); assert.equal(payload.expected_version, 3);
  pending.resolve({success: true}); await task;
  assert.equal(app.state.items[0].id, archived.id);
  assert.equal(app.state.items[0].student_access, false);
  assert.equal(app.state.archivedItems.length, 0);
  assert.equal(app.state.restoring, null);
  assert.match(app.ids.scmMessage.textContent, /교사 전용으로 복원/);
  assert.deepEqual(app.requests.map(call => call.action), ['list_archived', 'restore_content', 'catalog', 'list_archived']);
});

test('leaving administrator mode discards a delayed archive response and clears private rows', async () => {
  const app = setup(); const pending = deferred(); app.handle(() => pending.promise);
  const task = app.selectManagerView('archived');
  app.context.isAdminMode = false; app.manager.authChanged();
  pending.resolve({success: true, role: 'admin', items: [archived]}); await task;
  assert.equal(app.ids.scmManager.open, false);
  assert.equal(app.state.archivedItems.length, 0);
  assert.equal(app.ids.scmArchiveItems.children.length, 0);
  assert.equal(app.state.managerView, 'active');
  assert.equal(app.state.archiveReady, false);
  const count = app.requests.length; await app.selectManagerView('archived'); await app.restore(archived);
  assert.equal(app.requests.length, count, 'privileged actions do not run outside administrator mode');
});

test('server role revalidation rejects a revoked teacher role', async () => {
  const app = setup(); app.handle(async () => ({success: true, role: 'student', items: [archived]}));
  await app.selectManagerView('archived');
  assert.equal(app.ids.scmManager.open, false);
  assert.equal(app.ids.scmAdminTab.hidden, true);
  assert.equal(app.state.archivedItems.length, 0);
});

test('switching accounts drops a late restore result without reloading teacher data', async () => {
  const app = setup(); await app.selectManagerView('archived');
  const pending = deferred();
  app.handle(action => action === 'restore_content' ? pending.promise : Promise.resolve({success: true, role: 'student', items: []}));
  const task = app.restore(archived);
  app.identity({studentSessionToken: 'student-unit-test'}, 'student'); app.manager.authChanged();
  pending.resolve({success: true}); await task;
  await Promise.resolve(); await Promise.resolve();
  assert.equal(app.state.archivedItems.length, 0);
  assert.equal(app.state.restoring, null);
  assert.equal(app.ids.scmManager.open, false);
  assert.equal(app.state.role, 'student');
  assert.equal(app.requests.filter(call => call.action === 'list_archived').length, 1);
  assert.doesNotMatch(app.ids.scmMessage.textContent || '', /교사 전용으로 복원했습니다/);
});

test('restore conflicts refresh both lists without retrying the write', async () => {
  const app = setup(); await app.selectManagerView('archived');
  app.handle(async action => {
    if (action === 'restore_content') throw Object.assign(new Error('conflict'), {status: 409});
    return {success: true, role: 'admin', items: []};
  });
  await app.restore(archived);
  assert.deepEqual(app.requests.map(call => call.action), ['list_archived', 'restore_content', 'catalog', 'list_archived']);
  assert.match(app.ids.scmMessage.textContent, /다른 작업에서/);
  assert.equal(app.state.restoring, null);
});
