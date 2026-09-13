const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const native = process.binding('natives'), mod = {exports: {}};
new Function('exports', 'require', 'module', native['internal/deps/acorn/acorn/dist/acorn'])(mod.exports, require, mod);
const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const functions = new Map();
for (const script of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc\s*=/.test(script[1])) continue;
  for (const node of mod.exports.parse(script[2], {ecmaVersion: 'latest'}).body) {
    if (node.type === 'FunctionDeclaration') functions.set(node.id.name, script[2].slice(node.start, node.end));
  }
}
const ids = {collectionCenter: '1d8c1730-ab65-48a6-9bdb-8df5a73584ab', selfStudy: 'a9d66a4e-09b4-4898-a2b1-d2383e840f37'};
const metadata = key => ({id: ids[key], kind: 'answer', format: 'html', archived_at: null});
function navigation({token = 'teacher', role = 'admin', items = Object.keys(ids).map(metadata)} = {}) {
  let activeToken = token, requestCount = 0;
  let response = async () => ({role, items});
  const alerts = [], popup = {closed: false, document: {body: {}}, location: {replace(url) {popup.url = url;}}, close() {this.closed = true;}};
  const location = {href: 'https://example.org/test/index.html'};
  const window = {location, PLATFORM_CONFIG: {resourceContentIds: ids}, open() {popup.opened = true; return popup;}, ScienceContentClient: {request: async action => {assert.equal(action, 'catalog'); requestCount++; return response();}}};
  const context = vm.createContext({window, location, URL, getAdminSessionToken: () => activeToken, alert: value => alerts.push(value), openAuthModal(...args) {window.authModal = args;}});
  for (const name of ['openTeacherResource', 'openAssessmentCollectionCenter', 'openSelfStudy']) vm.runInContext(functions.get(name), context);
  return {context, popup, alerts, window, location, requestCount: () => requestCount, setToken(value) {activeToken = value;}, respond(fn) {response = fn;}};
}

test('collection and self-study use the exact authorized catalog IDs through the server loader', async () => {
  const app = navigation();
  assert.equal(await app.context.openAssessmentCollectionCenter(), true);
  let url = new URL(app.location.href);
  assert.equal(url.pathname, '/test/html-lesson.html');
  assert.equal(url.searchParams.get('id'), ids.collectionCenter);
  assert.equal(await app.context.openSelfStudy(), true);
  url = new URL(app.popup.url);
  assert.equal(url.searchParams.get('id'), ids.selfStudy);
  assert.equal(url.searchParams.get('autopip'), 'true');
  assert.equal(app.requestCount(), 2);
  assert.doesNotMatch(functions.get('openSelfStudy'), /21234|Self_study\.html/);
  assert.doesNotMatch(functions.get('openAssessmentCollectionCenter'), /Assessment_Collection_Center\.html/);
});

test('teacher tools deny missing sessions and unverifiable catalog roles without static fallback', async () => {
  const anonymous = navigation({token: ''});
  await anonymous.context.openSelfStudy();
  assert.equal(anonymous.window.authModal.length, 2);
  assert.equal(anonymous.requestCount(), 0);
  assert.equal(anonymous.popup.opened, undefined);
  for (const response of [{role: 'student'}, {items: []}, {items: [{...metadata('collectionCenter'), kind: 'lesson'}]}, {items: [{...metadata('collectionCenter'), archived_at: '2026-09-13'}]}]) {
    const app = navigation(response), original = app.location.href;
    assert.equal(await app.context.openAssessmentCollectionCenter(), false);
    assert.equal(app.location.href, original);
    assert.equal(app.alerts.length, 1);
  }
});

test('a session change while a popup is loading closes it before any teacher content navigation', async () => {
  const app = navigation(); let release;
  app.respond(() => new Promise(resolve => {release = resolve;}));
  const pending = app.context.openSelfStudy();
  assert.equal(app.popup.opened, true);
  app.setToken(''); release({role: 'admin', items: [metadata('selfStudy')]});
  assert.equal(await pending, false);
  assert.equal(app.popup.closed, true);
  assert.equal(app.popup.url, undefined);
});

test('unit and lesson cards survive their catalog unit disappearing during lock refresh', () => {
  const cards = [], alerts = [], location = {href: 'https://example.org/test/'};
  const unit = {id: 'unit8', isLocked: false, title: '8단원. 별', lessons: [{id: 'u8_l1', title: '별', tags: [], file: 'html-lesson.html?id=one'}]};
  const curriculum = {unit8: unit};
  let pending, back = 0, entered = 0;
  const context = vm.createContext({window: {location}, defaultCurriculum: curriculum, currentUnitKey: 'unit8', isAdminMode: false,
    document: {createElement() {return {};}, getElementById() {return {appendChild(card) {cards.push(card);}};}},
    loadLocksFromCloud(callback) {pending = callback;}, renderUnitHub() {}, enterUnit() {entered++;}, backToHub() {back++;}, alert: message => alerts.push(message)});
  vm.runInContext(functions.get('createUnitCard'), context);
  vm.runInContext(functions.get('renderLessonCards'), context);
  const card = context.createUnitCard('unit8', unit); card.onclick(); delete curriculum.unit8;
  assert.doesNotThrow(() => pending(true)); assert.equal(entered, 0);
  curriculum.unit8 = unit; context.renderLessonCards(unit); cards[0].onclick(); delete curriculum.unit8;
  assert.doesNotThrow(() => pending(true)); assert.equal(back, 1); assert.equal(alerts.length, 2);
});

test('unsaved production banner retains exact original DOM; custom saved and new banners receive accents', () => {
  const appearanceSource = fs.readFileSync(path.join(__dirname, '../assets/unit-appearance.js'), 'utf8');
  const integrationSource = fs.readFileSync(path.join(__dirname, '../assets/unit-banner-integration.js'), 'utf8');
  const icon = {svg: '<svg></svg>'}, window = {ScienceUnitIcons: {get: () => icon}, ScienceContentManager: {canManage: () => false}};
  const cards = [];
  const context = vm.createContext({window, document: {createElement: () => ({})}, createUnitCard() {
    const node = {className: 'production', styles: {}, icon: {innerHTML: '🌟'}, entry: {textContent: 'original'}, title: {textContent: '3단원. 빛'}, classList: {add(value) {node.className += ' ' + value;}}, style: {setProperty(key, value) {node.styles[key] = value;}}, querySelector(selector) {return {'.unit-entry-icon': node.icon, '.unit-entry-btn': node.entry, '.unit-entry-title': node.title}[selector];}};
    node.entry.replaceChildren = (...nodes) => {node.replaced = nodes;}; cards.push(node); return node;
  }});
  vm.runInContext(appearanceSource, context); vm.runInContext(integrationSource, context);
  let card = context.createUnitCard('unit3', {themeClass: 'theme-unit3', isLocked: false});
  assert.equal(card.className, 'production'); assert.equal(card.icon.innerHTML, '🌟'); assert.deepEqual(card.styles, {}); assert.equal(card.replaced, undefined);
  window.ScienceUnitAppearance.receiveCatalog([{unit_id: 'unit3', icon: 'star', color_start: '#f59e0b', color_end: '#ec4899', mode: 'gradient', angle: 90, version: 1}]);
  card = context.createUnitCard('unit3', {themeClass: 'theme-unit3', isLocked: false});
  assert.match(card.className, /sua-card/); assert.equal(card.icon.innerHTML, '<svg></svg>'); assert.equal(card.replaced.length, 2);
  card = context.createUnitCard('unit8', {themeClass: 'theme-custom', isLocked: false});
  assert.match(card.className, /sua-card/);
});
