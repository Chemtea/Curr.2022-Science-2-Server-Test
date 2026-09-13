import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';

// Exercise shipped integration handlers; host authorization and engine behavior
// are independently tested by their own suites. No real account is altered.
const read = name => fs.readFileSync(new URL('../assets/' + name + '.js', import.meta.url), 'utf8');
const value = value => ({value});
const plain = value => JSON.parse(JSON.stringify(value));
function node(tag = 'div') {
  return {tagName: tag.toUpperCase(), children: [], events: {}, dataset: {}, style: {}, attrs: {}, open: false, textContent: '',
    append(...children) { this.children.push(...children); }, appendChild(child) { this.children.push(child); }, prepend(...children) { this.children.unshift(...children); },
    replaceChildren(...children) { this.children = children; }, setAttribute(key, value) { this.attrs[key] = value; }, addEventListener(event, handler) { this.events[event] = handler; },
    querySelectorAll() { return []; }, close() { this.open = false; }, showModal() { this.open = true; }};
}
const item = () => ({id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', version: 7, kind: 'lesson', format: 'lesson-pack', title: 'Saved title', unit_id: 'unit7', unit_title: 'Saved unit', lesson_id: 'lesson_test', description: '', published: true, student_access: true});
function data() {
  const content = {schema: 'science-lesson/v3', title: 'Saved page', display: {titleHtml: 'Saved heading', headerTag: 'Test', subtitleHtml: '', footerHtml: '', contentMaxWidth: 1000, tabs: ['Step 1', 'Step 2', 'Step 3', 'Quiz']},
    steps: [1,2,3].map(n => ({id: 'step' + n, title: 'Step ' + n, html: '<p>Stage ' + n + '</p>'})),
    quiz: [{id: 'q1', promptHtml: 'Question', contextHtml: 'Context', choices: [{id: 'q1-c1', html: 'One'}, {id: 'q1-c2', html: 'Two'}], review: {stepId: 'step2', label: 'Review stage'}}],
    simulation: {html: '', css: '', js: 'window.example=1;', dependencies: [], microphone: false, hostContract: 'science-experiment-content/v1'}};
  const keys = [{questionId: 'q1', correct: 2, choices: 2, explanation: 'Current explanation', explanationHtml: 'Current explanation', correctTitleHtml: 'Correct', wrongHintHtml: 'Hint', wrongReasons: {'q1-c1': 'Current reason'}}];
  return {content, keys};
}
function editorRefs(content, keys) {
  return {title: value('Unsaved title'), unit: value('unit_changed'), unitTitle: value('Unsaved unit'), lesson: value('unsaved_lesson'), description: value('Unsaved description'),
    pageTitle: value('Unsaved page'), display: Object.fromEntries(Object.entries(content.display).filter(([key]) => key !== 'tabs').map(([key,v]) => [key,value(v)])), quizTab: value('Unsaved quiz tab'),
    steps: content.steps.map((s,i) => ({title: value(s.title), html: value(i ? s.html : '<p>Unsaved stage content</p>')})),
    quiz: content.quiz.map((q,i) => ({question: value('Unsaved question'), context: value('Unsaved context'), choices: q.choices.map(c => value(c.html)), correct: value(keys[i].correct), explanation: value('Unsaved explanation'), correctTitle: value(keys[i].correctTitleHtml), wrongHint: value(keys[i].wrongHintHtml), reviewStep: value('step3'), reviewLabel: value('Unsaved review'), wrongReasons: q.choices.map(c => value(keys[i].wrongReasons[c.id] || ''))})),
    simulation: Object.fromEntries(['html','css','js'].map(key => [key,value(key === 'js' ? 'window.example=2;' : content.simulation[key])]))};
}
function setupEditor() {
  const ids = Object.fromEntries(['sceStatus','sceDialog','sceForm','sceSave','sceVersions','scePreviewArea'].map(id => [id,node()]));
  let auth = {adminSessionToken: 'synthetic-teacher'}, request = async () => { throw Error('Unexpected API request'); }, preview = async () => true;
  const requests = [], previews = [], savedPreviews = [];
  const window = {ScienceContentClient: {auth: () => auth, request: async (action, payload) => { requests.push({action,payload}); return request(action,payload); }}, ScienceContentPreview: {open: async bundle => { previews.push(bundle); return preview(bundle); }, openSaved: async item => { savedPreviews.push(item); return true; }}};
  const context = vm.createContext({window, isAdminMode: true, document: {getElementById: id => ids[id], createElement: tag => node(tag)}, confirm: () => true, alert() {}});
  vm.runInContext(read('content-editor').replace('\n  init();\n', '\n  window.__test = {state, previewCurrent, previewSaved, inspectVersion, setRefs: value => { refs = value; }};\n'), context);
  const t = window.__test, {content,keys} = data(), refs = editorRefs(content,keys);
  Object.assign(t.state, {item: item(), content, keys, session: true, identity: JSON.stringify(auth), dirty: true}); t.setRefs(refs);
  return {t, context, ids, requests, previews, savedPreviews, refs, setRequest(fn) { request = fn; }, setPreview(fn) { preview = fn; }, setAuth(next) { auth = next; }};
}

test('editor previews unsaved body, metadata, feedback and experiment without save/publication', async () => {
  const a = setupEditor(); assert.equal(await a.t.previewCurrent(), true);
  assert.equal(a.requests.length, 0); assert.equal(a.previews.length, 1); const b = a.previews[0];
  assert.equal(b.item.title, 'Unsaved title'); assert.equal(b.item.unit_id, 'unit_changed'); assert.equal(b.item.lesson_id, 'unsaved_lesson');
  assert.equal(b.content.steps[0].html, '<p>Unsaved stage content</p>'); assert.equal(b.content.quiz[0].promptHtml, 'Unsaved question');
  assert.equal(b.content.quiz[0].review.stepId, 'step3'); assert.equal(b.content.simulation.js, 'window.example=2;'); assert.equal(b.quiz_data[0].explanationHtml, 'Unsaved explanation');
  assert.equal(a.t.state.dirty, true); assert.equal(a.t.state.item.version, 7); assert.equal(a.t.state.item.student_access, true);
  b.content.steps[0].html = 'Preview mutation'; b.quiz_data[0].correct = 1;
  assert.equal(a.t.state.content.steps[0].html, '<p>Unsaved stage content</p>'); assert.equal(a.t.state.keys[0].correct, 2);
});

test('unapplied JSON, invalid feedback and exited teacher mode never launch a misleading preview', async () => {
  const raw = setupEditor(); raw.refs.rawDirty = true;
  assert.equal(await raw.t.previewCurrent(), false); assert.match(raw.ids.sceStatus.textContent, /JSON.*적용/); assert.equal(raw.previews.length, 0);
  const invalid = setupEditor(); invalid.refs.quiz[0].wrongReasons[0].value = '';
  assert.equal(await invalid.t.previewCurrent(), false); assert.equal(invalid.previews.length, 0); assert.equal(invalid.t.state.dirty, true);
  const exited = setupEditor(); exited.context.isAdminMode = false;
  assert.equal(await exited.t.previewCurrent(), false); assert.equal(exited.requests.length, 0); assert.equal(exited.previews.length, 0);
});

test('historical preview uses that version private keys and leaves unsaved edits intact', async () => {
  const a = setupEditor(), old = data(); old.content.title = 'Historical page'; old.keys[0] = {...old.keys[0], correct: 1, explanationHtml: 'Historical explanation', wrongReasons: {'q1-c2': 'Historical wrong reason'}};
  const snapshot = {...item(), version: 2, title: 'Historical title', content: old.content, quiz_data: old.keys, private_storage_path: 'teacher-private-path'};
  a.setRequest(async action => { assert.equal(action, 'get_version'); return {snapshot}; });
  const before = plain(a.t.state); await a.t.inspectVersion(2);
  assert.equal(a.requests.length, 1); assert.equal(a.requests[0].payload.version, 2); assert.equal(a.previews.length, 1);
  const b = a.previews[0]; assert.equal(b.content.title, 'Historical page'); assert.equal(b.quiz_data[0].correct, 1); assert.equal(b.item.version, 2); assert.match(b.label, /v2/);
  assert.equal('quiz_data' in b.item, false); assert.equal('content' in b.item, false); assert.equal('private_storage_path' in b.item, false);
  assert.deepEqual(plain(a.t.state), before); assert.equal(a.refs.title.value, 'Unsaved title');
  b.quiz_data[0].correct = 2; assert.equal(snapshot.quiz_data[0].correct, 1);
});

test('delayed history read after identity change cannot open an old private preview', async () => {
  const a = setupEditor(); let resolve; a.setRequest(() => new Promise(done => { resolve = done; }));
  const pending = a.t.inspectVersion(2); a.setAuth({adminSessionToken: 'other-teacher'});
  const {content,keys} = data(); resolve({snapshot: {...item(), content, quiz_data: keys}}); await pending;
  assert.equal(a.previews.length, 0); assert.equal(a.t.state.dirty, true);
});

test('preview rejection preserves edited source and never falls back to saving', async () => {
  const a = setupEditor(); a.setPreview(async () => false);
  assert.equal(await a.t.previewCurrent(), false); assert.equal(a.requests.length, 0); assert.equal(a.t.state.dirty, true); assert.equal(a.t.state.busy, false);
  assert.match(a.ids.sceStatus.textContent, /열지 못/); assert.equal(a.refs.title.value, 'Unsaved title');
});

test('saved editor preview stays in the authenticated tab and does not capture or discard unsaved fields', async () => {
  const a = setupEditor(), before = plain(a.t.state);
  assert.equal(await a.t.previewSaved(), true); assert.deepEqual(plain(a.savedPreviews), [{id: item().id}]);
  assert.deepEqual(plain(a.t.state), before); assert.equal(a.refs.title.value, 'Unsaved title'); assert.equal(a.requests.length, 0);
});

function setupImporter() {
  const requests = [], previews = [], savedPreviews = [], {content,keys} = data();
  const auth = {adminSessionToken: 'synthetic-teacher'}; let request = async () => { throw Error('Unexpected API request'); };
  const window = {ScienceContentClient: {auth: () => auth, request: async (action,payload) => { requests.push({action,payload}); return request(action,payload); }}, ScienceContentPreview: {open: async bundle => { previews.push(bundle); return true; }, openSaved: async item => { savedPreviews.push(item); return true; }}, dispatchEvent() {}};
  const context = vm.createContext({window, isAdminMode: true, document: {createElement: tag => node(tag)}, TextDecoder, TextEncoder, CustomEvent: class {}});
  vm.runInContext(read('content-importer').replace('  window.ScienceContentImporter =', '  window.__test = {previewSelected, save, prime: (view, selection) => {ui = view; selected = selection; sessionIdentity = identity(); requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";}};\n  window.ScienceContentImporter ='), context);
  const ui = {dialog: node('dialog'), file: node('input'), pick: node('select'), save: node('button'), form: node('section'), status: node('p')}; ui.dialog.open = true;
  const selected = {data: {metadata: {description: 'Description'}, content, quiz_data: keys}, title: value('Current import title'), unit: value('unit_changed'), unitTitle: value('Current import unit'), lesson: value('new_lesson')};
  window.__test.prime(ui,selected);
  return {t: window.__test, ui, context, requests, previews, savedPreviews, selected, setRequest(fn) { request = fn; }};
}

test('import preview reads edited IDs, clones private data, and does not register a lesson', async () => {
  const a = setupImporter(); assert.equal(await a.t.previewSelected(), true); assert.equal(a.requests.length, 0); assert.equal(a.previews.length, 1);
  const b = a.previews[0]; assert.equal(b.item.title, 'Current import title'); assert.equal(b.item.lesson_id, 'new_lesson'); assert.equal(b.item.unit_id, 'unit_changed'); assert.equal(b.item.version, 0);
  b.content.quiz[0].promptHtml = 'Preview mutation'; b.quiz_data[0].correct = 1;
  assert.equal(a.selected.data.content.quiz[0].promptHtml, 'Question'); assert.equal(a.selected.data.quiz_data[0].correct, 2); assert.equal(a.ui.save.disabled, false);
  a.context.isAdminMode = false; assert.equal(await a.t.previewSelected(), false); assert.equal(a.previews.length, 1);
});

test('explicit import save is teacher-only and its preview button keeps tab authentication', async () => {
  const a = setupImporter(); a.setRequest(async (action,payload) => action === 'catalog' ? {role: 'admin', items: []} : {item: {...item(), id: payload.id, published: true, student_access: false}});
  await a.t.save(); assert.deepEqual(a.requests.map(r => r.action), ['catalog','save_content']);
  assert.equal(a.requests[1].payload.student_access, false); assert.equal(a.requests[1].payload.expected_version, 0);
  const preview = a.ui.form.children.find(n => n.textContent === '등록한 수업 미리보기'); assert.equal(preview.tagName, 'BUTTON'); assert.equal(preview.target, undefined);
  await preview.events.click(); assert.equal(a.savedPreviews.length, 1); assert.equal(a.savedPreviews[0].id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.equal(a.requests.length, 2); assert.equal(a.previews.length, 0);
});

test('manager previews are authenticated-tab buttons limited to teacher lesson packs', async () => {
  const ids = Object.fromEntries(['scmSave','scmManageItems','scmActiveTab','scmArchiveTab'].map(id => [id,node()]));
  const saved = [], auth = {adminSessionToken: 'synthetic-teacher'};
  const window = {addEventListener() {}, ScienceContentClient: {auth: () => auth, contentUrl: item => 'lesson.html?id=' + item.id}, ScienceContentPreview: {openSaved: async item => {saved.push(item);}}};
  const context = vm.createContext({window, isAdminMode: true, document: {getElementById: id => ids[id], createElement: tag => node(tag)}});
  vm.runInContext(read('content-manager').replace('\n  init();\n', '\n  window.__test = {state, renderManageList};\n'), context);
  Object.assign(window.__test.state, {ready: true, role: 'admin', items: [item(), {...item(), id: 'other', format: 'html'}]}); window.__test.renderManageList();
  const previews = ids.scmManageItems.children.flatMap(row => row.children[1].children).filter(child => child.textContent === '수업 미리보기');
  assert.equal(previews.length, 1); assert.equal(previews[0].tagName, 'BUTTON'); assert.equal(previews[0].target, undefined);
  await previews[0].events.click(); assert.equal(saved.length, 1); assert.equal(saved[0].id, item().id);
  context.isAdminMode = false; await previews[0].events.click(); assert.equal(saved.length, 1);
  window.__test.renderManageList(); assert.equal(ids.scmManageItems.children.length, 1); assert.match(ids.scmManageItems.children[0].textContent, /교사 권한/);
});
