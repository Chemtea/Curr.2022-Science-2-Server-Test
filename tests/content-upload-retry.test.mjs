import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';

const code = name => fs.readFileSync(new URL('../assets/' + name, import.meta.url), 'utf8');

test('all content actions allow resumed-project latency without automatic retries', async () => {
  const deadlines = [], requests = [];
  const window = {PLATFORM_CONFIG: {CONTENT_API: 'https://example.test/content'}};
  const context = vm.createContext({window, AbortController,
    setTimeout(callback, delay) { deadlines.push(delay); return deadlines.length; }, clearTimeout() {},
    fetch: async (url, options) => { requests.push(JSON.parse(options.body)); return {ok: true, json: async () => ({success: true})}; }
  });
  vm.runInContext(code('content-client.js'), context);
  for (const action of ['catalog', 'save_content', 'get_content', 'submit_quiz', 'set_publication', 'delete_content']) await window.ScienceContentClient.request(action);
  assert.deepEqual(deadlines, Array(6).fill(60000));
  assert.equal(requests.length, 6);
});

function editor() {
  const node = value => ({value, dataset: {}, hidden: false, open: false, reset() {}, close() {}, setAttribute() {}});
  const ids = Object.fromEntries(['scmForm', 'scmFile', 'scmSave', 'scmCancelEdit', 'scmKindHint', 'scmMessage', 'scmTitle', 'scmDescription', 'scmUnit', 'scmUnitTitle', 'scmLessonId', 'scmKind'].map(id => [id, node('')]));
  ids.scmKind.value = 'lesson'; ids.scmTitle.value = 'Upload unit test'; ids.scmUnit.value = 'unit3';
  ids.scmFile.files = [{name: 'lesson.html', size: 12, text: async () => '<p>Lesson</p>'}];
  const saves = [];
  let outcome = 'timeout', idCount = 0;
  const window = {addEventListener() {}, ScienceContentClient: {
    auth: () => ({adminSessionToken: 'isolated-unit-test'}),
    request: async (action, payload) => {
      if (action === 'catalog') return {success: true, role: 'admin', items: []};
      assert.equal(action, 'save_content'); saves.push({...payload});
      if (outcome === 'timeout') throw new Error('timeout');
      if (outcome === 'conflict') throw Object.assign(new Error('version conflict'), {code: 'VERSION_CONFLICT', status: 409});
      return {success: true};
    }
  }};
  const context = vm.createContext({window, isAdminMode: true, document: {getElementById: id => ids[id] || null},
    crypto: {randomUUID: () => `11111111-1111-4111-8111-${String(++idCount).padStart(12, '0')}`}
  });
  vm.runInContext(code('content-manager.js').replace('\n  init();\n', '\n  window.__test = {state, save, resetEditor};\n'), context);
  Object.assign(window.__test.state, {ready: true, role: 'admin'});
  return {ids, saves, state: window.__test.state, save: () => window.__test.save({preventDefault() {}}),
    outcome(value) { outcome = value; }, get idCount() { return idCount; }};
}

test('uncertain new saves retain their UUID and never overwrite a committed retry', async () => {
  const app = editor();
  await app.save();
  app.outcome('conflict'); await app.save();
  assert.equal(app.saves[0].id, app.saves[1].id);
  assert.equal(app.saves[0].expected_version, 0);
  assert.equal(app.saves[1].expected_version, 0);
  assert.equal(app.idCount, 1);
  assert.match(app.ids.scmMessage.textContent, /새로고침/);
  assert.equal(app.state.newContentId, app.saves[0].id, 'conflict preserves the pending identity');
  app.outcome('success'); await app.save();
  assert.equal(app.state.newContentId, null, 'a confirmed save resets the new-content identity');
  await app.save();
  assert.notEqual(app.saves.at(-1).id, app.saves[0].id);
});

test('editing a conflicting version keeps the original expected version', async () => {
  const app = editor();
  app.state.editing = {id: '22222222-2222-4222-8222-222222222222', version: 7, published: true, student_access: true};
  app.outcome('conflict'); await app.save(); await app.save();
  assert.deepEqual(app.saves.map(item => item.expected_version), [7, 7]);
  assert.equal(app.idCount, 0);
  assert.match(app.ids.scmMessage.textContent, /새로고침/);
});
