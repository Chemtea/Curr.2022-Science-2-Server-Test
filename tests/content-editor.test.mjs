import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../assets/content-editor.js', import.meta.url), 'utf8');
const item = {id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', version: 8, title: '실험 수업', kind: 'lesson', format: 'lesson-pack', unit_id: 'unit7', unit_title: '전기와 자기', lesson_id: 'u7_l1', description: '', published: true, student_access: true};
const pack = () => ({schema: 'science-lesson/v2', originalLessonId: 'u7_l1', steps: [{title: '실험', html: '<div id="canvas-area">본문</div>'}], quiz: [{question: '질문', choices: ['가', '나']}], simulation: {html: '', css: '#canvas-area{color:blue}', js: 'window.example=1', dependencies: [], microphone: true}});
const keys = () => [{correct: 2, explanation: '비공개 해설', choices: 2}];
const value = value => ({value});
function setup({mode = true, auth = {adminSessionToken: 'unit-teacher'}} = {}) {
  const n = () => ({open: false, hidden: false, dataset: {}, textContent: '', attrs: {}, replaceChildren(...children) { this.children = children; }, close() { this.open = false; }, showModal() { this.open = true; }, setAttribute(k, v) { this.attrs[k] = v; }});
  const ids = Object.fromEntries(['sceDialog', 'sceTitle', 'sceStatus', 'sceForm', 'sceVersions', 'scePreviewArea', 'sceSave'].map(id => [id, n()]));
  let authentication = auth, requestImpl = async () => { throw new Error('offline unit-test'); }, idCount = 0;
  const requests = [], alerts = [];
  const window = {ScienceContentClient: {auth: () => authentication, request: (action, payload) => { requests.push({action, payload}); return requestImpl(action, payload); }}, dispatchEvent() {}};
  const context = vm.createContext({window, isAdminMode: mode, document: {getElementById: id => ids[id]}, confirm: () => true, alert: message => alerts.push(message), crypto: {randomUUID: () => `bbbbbbbb-bbbb-4bbb-8bbb-${String(++idCount).padStart(12,'0')}`}});
  const code = source.replace('\n  init();\n', '\n  window.__test = {state, validatePack, buildPayload, capture, saveCurrent, restoreVersion, previewDocument, setRefs: value => { refs = value; }};\n');
  assert.notEqual(code, source);
  vm.runInContext(code, context);
  const t = window.__test;
  function prime() {
    Object.assign(t.state, {item: structuredClone(item), content: pack(), keys: keys(), session: true, identity: JSON.stringify(authentication), busy: false});
    t.setRefs({title: value('수정한 제목'), unit: value('unit7'), unitTitle: value('전기와 자기'), lesson: value('u7_l1'), description: value('수정 설명'), steps: [{title: value('편집된 실험'), html: value('<div id="canvas-area">새 본문</div>')}], quiz: [{question: value('수정 질문'), choices: [value('가'),value('나')], correct: value('2'), explanation: value('비공개 해설')}], simulation: {html: value(''), css: value('div{color:red}'), js: value('window.example=2')}, dependencies: value('')});
  }
  return {t, context, ids, requests, alerts, api: window.ScienceContentEditor, prime, setAuth(v) { authentication = v; }, setRequest(fn) { requestImpl = fn; }};
}

test('opening from student or exited administrator mode never requests private data', async () => {
  for (const options of [{mode: false}, {auth: {studentSessionToken: 'student'}}]) {
    const app = setup(options); assert.equal(await app.api.open(item), false); assert.equal(app.requests.length, 0); assert.equal(app.ids.sceDialog.open, false);
  }
});

test('a delayed private read cannot reinsert answers after mode exit', async () => {
  const app = setup(); let release; app.setRequest(() => new Promise(resolve => { release = resolve; }));
  const pending = app.api.open(item); assert.equal(app.requests[0].action, 'get_editable');
  app.context.isAdminMode = false; app.api.authChanged();
  release({success: true, item, content: pack(), quiz_data: keys()});
  assert.equal(await pending, false); assert.equal(app.ids.sceDialog.open, false); assert.equal(app.t.state.content, null); assert.equal(app.t.state.keys.length, 0);
});

test('unchanged token mode exit clears already loaded answer keys and UI', () => {
  const app = setup(); app.prime(); app.ids.sceDialog.open = true; app.context.isAdminMode = false; app.api.authChanged();
  assert.equal(app.t.state.keys.length, 0); assert.equal(app.t.state.item, null); assert.equal(app.ids.sceDialog.open, false); assert.deepEqual(app.ids.sceForm.children, []);
});

test('v2 edits retain microphone, original lesson ID and element identity while saving teacher-only', () => {
  const app = setup(); app.prime(); app.t.capture(); const payload = app.t.buildPayload();
  assert.equal(payload.expected_version, 8); assert.equal(payload.published, true); assert.equal(payload.student_access, false);
  assert.equal(payload.content.originalLessonId, 'u7_l1'); assert.equal(payload.content.simulation.microphone, true);
  assert.equal(payload.content.steps[0].html, '<div id="canvas-area">새 본문</div>'); assert.equal(payload.content.simulation.js, 'window.example=2');
  assert.equal(payload.quiz_data[0].correct, 2); assert.equal(payload.content.quiz[0].correct, undefined);
});

test('malformed or mismatched keys and unsupported step counts cannot be saved', () => {
  const app = setup(); const valid = pack(); app.t.validatePack(valid, keys());
  assert.throws(() => app.t.validatePack(valid, []), /문항/);
  assert.throws(() => app.t.validatePack(valid, [{correct: 3, choices: 2}]), /정답/);
  assert.throws(() => app.t.validatePack({...valid, steps: []}, keys()), /단계/);
  assert.throws(() => app.t.validatePack({...valid, steps: Array(5).fill(valid.steps[0])}, keys()), /단계/);
});

test('uncertain saves and conflicts retain the new UUID, original version and edited body', async () => {
  const app = setup(); app.prime(); app.t.state.item.version = 0; app.t.state.newId = app.t.state.item.id;
  await app.t.saveCurrent(); const first = app.requests[0].payload;
  app.setRequest(async () => { throw Object.assign(new Error('changed'), {status: 409}); });
  await app.t.saveCurrent(); const second = app.requests[1].payload;
  assert.equal(first.id, second.id); assert.equal(first.expected_version, 0); assert.equal(second.expected_version, 0);
  assert.equal(app.t.state.content.steps[0].html, '<div id="canvas-area">새 본문</div>'); assert.match(app.ids.sceStatus.textContent, /최신/);
});

test('version restore sends optimistic version and cannot run outside teacher mode', async () => {
  const app = setup(); app.prime(); app.setRequest(async () => { throw Object.assign(new Error('changed'), {status: 409}); });
  await app.t.restoreVersion(3); assert.equal(app.requests[0].action, 'restore_version');
  assert.equal(app.requests[0].payload.target_version, 3); assert.equal(app.requests[0].payload.expected_version, 8);
  app.context.isAdminMode = false; await app.t.restoreVersion(2); assert.equal(app.requests.length, 1);
});

test('preview CSP prevents code execution and network access even with imported scripts', () => {
  const app = setup(); const doc = app.t.previewDocument('<script>fetch("https://example.test")</script>');
  assert.match(doc, /script-src 'none'/); assert.match(doc, /connect-src 'none'/); assert.match(doc, /form-action 'none'/);
  assert.ok(doc.indexOf('Content-Security-Policy') < doc.indexOf('<script>'));
});

test('unapplied raw JSON edits are explicitly blocked instead of silently discarded', () => {
  const app = setup(); app.t.setRefs({rawDirty: true}); assert.throws(() => app.t.capture(), /JSON.*적용/);
});
