import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/content-preview.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../assets/content-preview.css', import.meta.url), 'utf8');
const fixture = () => ({
  item: {id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '거울 탐구', kind: 'lesson', format: 'lesson-pack', lesson_id: 'demo_lesson', version: 3, adminSessionToken: 'never-copy-token'},
  content: {schema: 'science-lesson/v3', title: '거울 탐구', steps: [{id: 'step1', html: '<p>본문</p>'}], quiz: [{id: 'q1', promptHtml: '질문'}], simulation: {html: '', css: '', js: ''}},
  quiz_data: [{correct: 2, choices: 2, explanation: '비공개 해설', requestSecret: 'never-copy-secret'}],
  label: '수정 중인 수업'
});
function setup({mode = true, auth = {adminSessionToken: 'teacher-test-token'}} = {}) {
  const elements = [], messages = [], calls = [], alerts = [], listeners = new Map(), timers = new Map();
  let authentication = auth, request = async () => ({role: 'admin'}), uuid = 0;
  const document = {body: null, activeElement: {isConnected: true, focus() { this.focused = true; }}, createElement, addEventListener() {}};
  function createElement(tag) {
    const events = new Map();
    const element = {tagName: tag.toUpperCase(), children: [], dataset: {}, attrs: {}, isConnected: true, open: false, hidden: false, disabled: false, textContent: '', value: '', parentElement: null,
      append(...children) { for (const child of children) { this.children.push(child); child.parentElement = this; } },
      replaceChildren(...children) { this.children = []; this.append(...children); },
      addEventListener(type, fn) { events.set(type, fn); },
      fire(type, value = {}) { return events.get(type)?.({preventDefault() {}, ...value}); },
      setAttribute(name, value) { this.attrs[name] = value; },
      showModal() { this.open = true; },
      close() { this.open = false; this.fire('close'); },
      focus() { document.activeElement = this; },
      remove() { this.isConnected = false; if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
    };
    if (tag === 'iframe') element.contentWindow = {postMessage: (packet, origin) => messages.push({packet: structuredClone(packet), origin, frame: element})};
    elements.push(element); return element;
  }
  document.body = createElement('body');
  const window = {location: {href: 'https://school.example/test/index.html', origin: 'https://school.example'}, ScienceContentClient: {auth: () => authentication, request: action => { calls.push(action); return request(action); }}, addEventListener: (type, fn) => listeners.set(type, fn)};
  let timerId = 0;
  const context = vm.createContext({window, document, isAdminMode: mode, alert: text => alerts.push(text), URL, crypto: {randomUUID: () => `bbbbbbbb-bbbb-4bbb-8bbb-${String(++uuid).padStart(12, '0')}`}, MutationObserver: class { observe() {} }, setInterval() {}, setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, {fn: () => { timers.delete(id); fn(); }, delay}); return id; }, clearTimeout: id => timers.delete(id)});
  vm.runInContext(source, context);
  const node = label => elements.find(element => element.textContent === label);
  const currentFrame = () => elements.filter(element => element.tagName === 'IFRAME' && element.isConnected).at(-1);
  function emit(type = 'science-preview-ready', values = {}) {
    const frame = currentFrame();
    listeners.get('message')?.({source: frame?.contentWindow, origin: window.location.origin, data: {type, channel: frame ? new URL(frame.src).searchParams.get('channel') : '', ...values.data}, ...values});
  }
  return {api: window.ScienceContentPreview, context, elements, document, calls, alerts, messages, node, currentFrame, emit, timers, emitWindow: type => listeners.get(type)?.(), setAuth: value => { authentication = value; }, setRequest: fn => { request = fn; }};
}

test('students and exited teacher mode cannot open or request preview data', async () => {
  for (const options of [{mode: false}, {auth: {studentSessionToken: 'student-token'}}]) {
    const app = setup(options); assert.equal(await app.api.open(fixture()), false); assert.equal(app.calls.length, 0); assert.equal(app.currentFrame(), undefined);
  }
});

test('server authorization is required before creating a preview frame or sending private keys', async () => {
  const app = setup(); app.setRequest(async () => ({role: 'student'}));
  assert.equal(await app.api.open(fixture()), false); assert.deepEqual(app.calls, ['catalog']); assert.equal(app.currentFrame(), undefined); assert.equal(app.messages.length, 0); assert.match(app.alerts[0], /교사 권한/);
});

test('a delayed catalog response cannot reopen a preview after mode exit or account change', async () => {
  for (const change of ['mode', 'identity']) {
    const app = setup(); let finish; app.setRequest(() => new Promise(resolve => { finish = resolve; }));
    const pending = app.api.open(fixture());
    if (change === 'mode') app.context.isAdminMode = false; else app.setAuth({adminSessionToken: 'different-teacher'});
    app.api.authChanged(); finish({role: 'admin'});
    assert.equal(await pending, false); assert.equal(app.currentFrame(), undefined); assert.equal(app.messages.length, 0);
    assert.equal(app.elements.find(e => e.id === 'scpDialog').open, false);
  }
});

test('only the exact preview frame, origin and nonce receive one whitelisted private snapshot', async () => {
  const app = setup(); const input = fixture(); assert.equal(await app.api.open(input), true);
  const frame = app.currentFrame(), nonce = new URL(frame.src).searchParams.get('channel');
  input.content.title = 'later edit'; input.quiz_data[0].correct = 1;
  app.emit('science-preview-ready', {source: {}});
  app.emit('science-preview-ready', {origin: 'https://attacker.example'});
  app.emit('science-preview-ready', {data: {type: 'science-preview-ready', channel: 'wrong-channel'}});
  assert.equal(app.messages.length, 0);
  app.emit(); app.emit(); assert.equal(app.messages.length, 1);
  const {packet, origin} = app.messages[0]; assert.equal(origin, 'https://school.example'); assert.equal(packet.channel, nonce);
  assert.equal(packet.payload.content.title, '거울 탐구'); assert.equal(packet.payload.quiz_data[0].correct, 2);
  assert.equal(packet.payload.item.adminSessionToken, undefined); assert.equal(packet.payload.quiz_data[0].requestSecret, undefined);
  assert.equal(packet.payload.onSave, undefined); assert.equal(frame.src.includes('거울'), false); assert.equal(frame.src.includes('correct'), false);
});

test('reset replaces the frame and nonce, rejects old frame messages and never writes server data', async () => {
  const app = setup(); await app.api.open(fixture()); app.emit(); const oldFrame = app.currentFrame(), oldChannel = new URL(oldFrame.src).searchParams.get('channel');
  await app.node('처음부터 다시 확인').fire('click'); const newFrame = app.currentFrame(); assert.notEqual(newFrame, oldFrame); assert.equal(oldFrame.src, 'about:blank'); assert.equal(oldFrame.isConnected, false);
  app.emit('science-preview-ready', {source: oldFrame.contentWindow, data: {type: 'science-preview-ready', channel: oldChannel}}); assert.equal(app.messages.length, 1);
  app.emit(); assert.equal(app.messages.length, 2); assert.notEqual(app.messages[1].packet.channel, oldChannel); assert.deepEqual(app.calls, ['catalog']);
});

test('close immediately destroys the private preview, ignores late messages and restores focus', async () => {
  const app = setup(); const trigger = app.document.activeElement; await app.api.open(fixture()); const frame = app.currentFrame();
  app.api.close(); assert.equal(frame.src, 'about:blank'); assert.equal(frame.isConnected, false); assert.equal(trigger.focused, true);
  app.emit(); assert.equal(app.messages.length, 0); assert.equal(app.currentFrame(), undefined); assert.equal(app.elements.find(e => e.id === 'scpDialog').open, false);
});

test('an already open preview is destroyed on unchanged-token administrator mode exit', async () => {
  const app = setup(); await app.api.open(fixture()); app.emit(); const frame = app.currentFrame(); app.context.isAdminMode = false; app.api.authChanged();
  assert.equal(frame.isConnected, false); assert.equal(frame.src, 'about:blank'); assert.equal(app.currentFrame(), undefined); app.emit(); assert.equal(app.messages.length, 1);
});

test('preview never invokes a supplied save callback without an explicit button action', async () => {
  const app = setup(); let saved = 0; await app.api.open({...fixture(), onSave: async () => { saved++; }}); app.emit();
  await app.node('처음부터 다시 확인').fire('click'); assert.equal(saved, 0); assert.deepEqual(app.calls, ['catalog']);
  await app.node('확인한 내용 저장').fire('click'); assert.equal(saved, 1); assert.deepEqual(app.calls, ['catalog', 'catalog']); assert.equal(app.currentFrame(), undefined);
});

test('unsupported lesson formats are rejected without requesting the server or changing the editor', async () => {
  const app = setup(); const input = fixture(); input.content.schema = 'science-lesson/v2'; assert.equal(await app.api.open(input), false); assert.equal(app.calls.length, 0); assert.match(app.alerts[0], /공통 엔진/);
});

test('saved lessons are read and opened in the current authenticated tab without exposing a token in a link', async () => {
  const app = setup(); app.setRequest(async action => action === 'get_editable' ? fixture() : {role: 'admin'});
  assert.equal(await app.api.openSaved(fixture().item), true); assert.deepEqual(app.calls, ['get_editable', 'catalog']); app.emit();
  assert.equal(app.messages[0].packet.payload.quiz_data[0].correct, 2); assert.equal(app.currentFrame().src.includes('token'), false);
});

test('late saved-lesson reads and mismatched content IDs cannot show private previews', async () => {
  const app = setup(); let finish; app.setRequest(() => new Promise(resolve => { finish = resolve; }));
  const pending = app.api.openSaved(fixture().item); app.api.close(); finish(fixture()); assert.equal(await pending, false); assert.equal(app.currentFrame(), undefined); assert.equal(app.messages.length, 0);
  app.setRequest(async () => ({...fixture(), item: {...fixture().item, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}}));
  assert.equal(await app.api.openSaved(fixture().item), false); assert.equal(app.currentFrame(), undefined); assert.match(app.alerts.at(-1), /요청한 수업/);
});

test('saved links contain only a valid content ID and the modal stays centered with a visible border', () => {
  const app = setup(); assert.equal(app.api.savedUrl(fixture().item), 'https://school.example/test/lesson-preview.html?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); assert.equal(app.api.savedUrl({id: 'javascript:alert(1)'}), '');
  assert.match(css, /position: fixed; inset: 0; margin: auto/); assert.match(css, /border: 2px solid/); assert.match(css, /::backdrop/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|createObjectURL|srcdoc|fetch\(/);
});

test('missing preview runtime produces a bounded retry message and lifecycle clears load timers', async () => {
  const app = setup(); await app.api.open(fixture()); assert.equal(app.timers.size, 1); const timer = [...app.timers.values()][0]; assert.equal(timer.delay, 25000); timer.fn();
  assert.match(app.elements.find(e => e.className === 'scp-status').textContent, /연결이 늦어지고/);
  await app.node('처음부터 다시 확인').fire('click'); app.emit(); app.emit('science-preview-loaded');
  assert.match(app.elements.find(e => e.className === 'scp-status').textContent, /실제 포인트/);
  await app.node('처음부터 다시 확인').fire('click'); app.api.close();
  assert.equal(app.currentFrame(), undefined); assert.equal(app.timers.size, 0);
});

test('shared account-change event tears down an open preview immediately', async () => {
  const app = setup(); await app.api.open(fixture()); app.setAuth({studentSessionToken: 'student-token'}); app.emitWindow('science-account-change');
  assert.equal(app.currentFrame(), undefined); assert.equal(app.timers.size, 0);
});

test('embedded footer closes only the authenticated delivered preview and restores editor focus', async () => {
  const app = setup(), trigger = app.document.activeElement; await app.api.open(fixture()); const frame = app.currentFrame();
  app.emit('science-preview-dismiss'); assert.equal(app.currentFrame(), frame);
  app.emit();
  app.emit('science-preview-dismiss', {source: {}});
  app.emit('science-preview-dismiss', {origin: 'https://attacker.example'});
  app.emit('science-preview-dismiss', {data: {type: 'science-preview-dismiss', channel: 'wrong-channel'}});
  assert.equal(app.currentFrame(), frame); assert.equal(trigger.focused, undefined);
  app.emit('science-preview-dismiss'); assert.equal(app.currentFrame(), undefined); assert.equal(frame.src, 'about:blank'); assert.equal(trigger.focused, true); assert.equal(app.timers.size, 0);
});
