import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../assets/content-manager.js', import.meta.url), 'utf8');
const tick = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
const lesson = (overrides = {}) => ({id: '12345678-1234-4234-8234-123456789012', kind: 'lesson', format: 'lesson-pack',
  title: '새 차시', unit_id: 'new_science_unit', unit_title: '새 단원', lesson_id: 'new_science_lesson', published: true, student_access: true, version: 1, ...overrides});

function setup({mode = true, role = 'admin'} = {}) {
  const node = () => ({dataset: {}, value: 'lesson', hidden: false, open: false, children: [], style: {},
    setAttribute() {}, reset() {}, close() { this.open = false; }, showModal() { this.open = true; },
    append(...children) { this.children.push(...children); }, appendChild(child) { this.append(child); },
    replaceChildren(...children) { this.children = children; }, addEventListener() {}, querySelectorAll() { return []; }});
  const ids = Object.fromEntries(['scmAdminTab', 'scmManager', 'scmLibrary', 'scmForm', 'scmFile', 'scmSave', 'scmCancelEdit', 'scmKind', 'scmKindHint', 'scmMessage', 'scmTitle', 'scmDescription', 'scmUnit', 'scmUnitTitle', 'scmLessonId'].map(id => [id, node()]));
  ids.scmUnit.value = 'unit3';
  let auth = mode ? {adminSessionToken: 'teacher-test'} : {studentSessionToken: 'student-test'};
  let handler = async () => ({success: true, role, items: []}), nextTimer = 0, opened = 0;
  const requests = [], timers = new Map(), events = new Map(), importedFiles = [];
  const window = {addEventListener(name, fn) { events.set(name, fn); },
    ScienceContentImporter: {open: async file => { opened++; importedFiles.push(file); }},
    ScienceContentClient: {auth: () => auth, contentUrl: item => 'lesson.html?id=' + item.id,
      request(action) { requests.push(action); return handler(action); }}};
  const curriculum = {unit3: {id: 'unit3', category: 'regular', lessons: []}, unit7: {id: 'unit7', category: 'regular', title: '전기와 자기', lessons: []}};
  const context = vm.createContext({window, isAdminMode: mode, defaultCurriculum: curriculum,
    document: {getElementById: id => ids[id] || null, createElement: node},
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); }, alert() {}});
  vm.runInContext(source.replace('\n  init();\n', '\n  window.__test = {state, syncUnits, openImporter, save, readFile}; authFingerprint = JSON.stringify(client.auth());\n'), context);
  Object.assign(window.__test.state, {ready: true, role});
  return {context, window, ids, requests, timers, events, importedFiles, curriculum, manager: window.ScienceContentManager, ...window.__test,
    handle(fn) { handler = fn; }, setAuth(value) { auth = value; }, get opened() { return opened; },
    async runTimers() { const due = [...timers.values()]; timers.clear(); for (const fn of due) fn(); await tick(); }};
}

test('lock bursts coalesce and one in-flight change produces only one follow-up read', async () => {
  const app = setup({mode: false, role: 'student'});
  let release;
  app.handle(() => new Promise(resolve => { release = resolve; }));
  app.manager.locksChanged(); app.manager.locksChanged(); app.manager.locksChanged();
  assert.equal(app.timers.size, 1);
  await app.runTimers();
  assert.deepEqual(app.requests, ['catalog']);
  app.manager.locksChanged(); app.manager.locksChanged();
  assert.equal(app.timers.size, 0, 'never start parallel reads for the same lock burst');
  release({success: true, role: 'student', items: [lesson()]}); await tick();
  assert.equal(app.timers.size, 1, 'a lock change during a request cannot be dropped');
  app.handle(async () => ({success: true, role: 'student', items: []}));
  await app.runTimers();
  assert.equal(app.requests.length, 2);
  assert.equal(app.timers.size, 0, 'rendering the refreshed catalog must not request it again');
  assert.equal(app.state.items.length, 0, 'newly locked lessons disappear');
});

test('uploaded lessons create new units and retain stable dashboard keys without engine edits', async () => {
  const app = setup();
  const imported = lesson({unit_title: '<img src=x onerror=alert(1)> 새 단원'});
  app.handle(async () => ({success: true, role: 'admin', items: [imported]}));
  await app.manager.refresh();
  assert.equal(app.curriculum.new_science_unit.lessons.length, 1);
  assert.equal(app.curriculum.new_science_unit.lessons[0].dashboardLessonKey, 'new_science_lesson');
  assert.equal(app.curriculum.new_science_unit.lessons[0].file, 'lesson.html?id=' + imported.id);
  assert.match(app.curriculum.new_science_unit.title, /^&lt;img/);
  app.handle(async () => ({success: true, role: 'admin', items: []}));
  await app.manager.refresh();
  assert.equal(app.curriculum.new_science_unit, undefined, 'archived units cannot leave orphan cards');
  assert.ok(app.curriculum.unit7, 'original unit definitions remain');
});

test('account change clears generated private unit metadata and rejects the old response', async () => {
  const app = setup();
  app.state.items = [lesson()]; app.syncUnits();
  let release;
  app.handle(() => new Promise(resolve => { release = resolve; }));
  const prior = app.manager.refresh();
  app.setAuth({studentSessionToken: 'another-account'}); app.context.isAdminMode = false;
  app.handle(async () => ({success: true, role: 'student', items: []}));
  app.manager.authChanged();
  assert.equal(app.curriculum.new_science_unit, undefined, 'erase metadata before fetching the new account');
  release({success: true, role: 'admin', items: [lesson()]});
  await prior; await tick();
  assert.equal(app.state.role, 'student');
  assert.equal(app.state.items.length, 0);
  assert.equal(app.curriculum.new_science_unit, undefined);
});

test('import UI opens only for a server-verified teacher in administrator mode', async () => {
  const app = setup();
  assert.equal(await app.openImporter(), true);
  assert.equal(app.opened, 1);
  app.context.isAdminMode = false;
  assert.equal(await app.openImporter(), false);
  app.context.isAdminMode = true; app.state.role = 'student';
  assert.equal(await app.openImporter(), false);
  assert.equal(app.opened, 1);
});

test('an explicit refresh absorbs a pending content change and does not double-fetch', async () => {
  const app = setup();
  app.events.get('science-content-changed')();
  assert.equal(app.timers.size, 1);
  await app.manager.refresh();
  assert.equal(app.timers.size, 0);
  assert.deepEqual(app.requests, ['catalog']);
});

test('new source JSON and ZIP hand off the selected file and never send their private bundle as raw content', async () => {
  for (const filename of ['lesson.json', 'lessons.zip']) {
    const app = setup();
    const file = {name: filename, size: 100, text: async () => JSON.stringify({schema: 'science-lesson-import/v1', files: {'teacher/quiz.private.json': {answers: []}}})};
    app.ids.scmFile.files = [file];
    await app.save({preventDefault() {}});
    assert.equal(app.importedFiles[0], file);
    assert.equal(app.requests.length, 0, 'only the importer may construct and save the split public/private payload');
    assert.equal(app.ids.scmSave.disabled, false);
  }
});

test('source import cannot silently create a duplicate while replacing an existing lesson', async () => {
  const app = setup(); app.state.editing = lesson();
  app.ids.scmFile.files = [{name: 'lesson.zip', size: 100}];
  await app.save({preventDefault() {}});
  assert.equal(app.opened, 0);
  assert.equal(app.requests.length, 0);
  assert.match(app.ids.scmMessage.textContent, /본문·버전 관리/);
});

test('execution v3 JSON directs authors to the version editor without dropping rich fields', async () => {
  const app = setup();
  await assert.rejects(app.readFile({name: 'runtime.json', size: 100,
    text: async () => JSON.stringify({content: {schema: 'science-lesson/v3'}, quiz_data: []})}, 'lesson'), /본문·버전 관리/);
  assert.equal(app.requests.length, 0);
});
