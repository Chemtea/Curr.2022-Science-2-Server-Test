import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../assets/html-catalog.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; };
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = (n, extra = {}) => ({id: id(n), kind: 'lesson', format: 'html', unit_id: 'unit3', unit_title: '3단원. 빛과 파동', lesson_id: `u3_l${n}`, title: `${n}차시 — 실험 ${n}`, description: '카드 설명', published: true, student_access: true, version: 1, updated_at: '2026-09-13T12:00:00Z', archived_at: null, ...extra});
const original = {unit3: {id: 'unit3', category: 'regular', title: '3단원. 빛과 파동', icon: '🌟', themeClass: 'theme-unit3', cardClass: 'unit-3-card', badgeClass: 'badge-unit3', isLocked: false, lessons: [{id: 'u3_l1', chasi: '1차시', title: '원래 제목', desc: '원래 설명', tags: ['반사 법칙', '평면거울'], file: 'old.html', isLocked: false}]}};

function harness({items = [item(1)], role = 'admin', auth = {adminSessionToken: 'fixture'}, mode = true, init = true} = {}) {
  const nodes = new Map(), calls = [], events = new Map(); let identity = auth, catalog = {success: true, role, items: copy(items), unit_appearances: []};
  let responder = async action => { assert.equal(action, 'catalog'); return copy(catalog); };
  class Element {
    constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.handlers = {}; this.attributes = {}; this.style = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.open = false; this._value = ''; this.files = []; this.textContent = ''; }
    set id(value) {this._id = value; nodes.set(value, this);} get id() {return this._id;}
    get options() {return this.children.filter(node => node.tagName === 'OPTION');}
    get value() {return this.tagName === 'SELECT' ? (this.options.find(option => option._value === this._value)?.value ?? this.options[0]?.value ?? '') : this._value;}
    set value(value) {this._value = String(value); if (this.type === 'file' && value === '') this.files = [];}
    set innerHTML(html) {
      this.html = html;
      for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
        const node = new Element(match[1]); node.id = match[3]; node.type = match[2].match(/\btype="([^"]+)"/)?.[1];
        node.value = match[2].match(/\bvalue="([^"]*)"/)?.[1] || ''; node.initialValue = node.value;
        node.hidden = /\bhidden\b/.test(match[2]); this.children.push(node);
        if (node.tagName === 'SELECT') {
          const segment = html.slice(match.index + match[0].length).split('</select>')[0];
          for (const option of segment.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)) { const child = new Element('option'); child.value = option[1]; child.textContent = option[2]; node.append(child); }
        }
      }
    }
    get innerHTML() {return this.html || '';}
    append(...nodes) {this.children.push(...nodes);} prepend(...nodes) {this.children.unshift(...nodes);} before() {}
    insertBefore(node) {this.children.push(node);} replaceChildren(...nodes) {this.children = [...nodes]; this._value = '';}
    setAttribute(key, value) {this.attributes[key] = String(value);} addEventListener(key, fn) {(this.handlers[key] ||= []).push(fn);}
    querySelectorAll(selectors) {const tags = selectors.split(',').map(tag => tag.trim().toUpperCase()); return this.children.flatMap(node => [...(tags.includes(node.tagName) ? [node] : []), ...node.querySelectorAll(selectors)]);}
    close() {this.open = false;} showModal() {this.open = true;} focus() {} scrollIntoView() {}
    reset() {for (const [id, node] of nodes) if (id.startsWith('hc') && ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)) node.value = node.initialValue || '';}
    async fire(name, event = {}) {for (const fn of this.handlers[name] || []) await fn(event);}
  }
  const host = new Element(), body = new Element('body');
  for (const id of ['regularUnitGrid', 'adminToolsBtn']) {const node = new Element(); node.id = id;}
  const appearance = {configure() {}, receiveCatalog() {}, clear() {}, close() {}, open() {return true;}};
  const window = {ScienceUnitAppearance: appearance, addEventListener: (name, fn) => events.set(name, fn), ScienceContentClient: {
    auth: () => identity, request: (action, payload = {}) => {calls.push({action, payload: copy(payload)}); return responder(action, payload);}
  }};
  const curriculum = copy(original), worksheets = {isLocked: false, units: []};
  const context = vm.createContext({window, defaultCurriculum: curriculum, worksheetCurriculum: worksheets, isAdminMode: mode,
    document: {readyState: init ? 'complete' : 'loading', addEventListener() {}, createElement: tag => new Element(tag), getElementById: id => nodes.get(id) || null, querySelector: () => host, body},
    URL, Uint8Array, btoa: text => Buffer.from(text, 'binary').toString('base64'), crypto: {randomUUID: () => id(999)}, confirm: () => true,
    setTimeout: () => 1, clearTimeout() {}, renderUnitHub() {}, applyCloudLocks(data) { for (const [key, unit] of Object.entries(curriculum)) if (data[key]) {unit.isLocked = data[key].isLocked; for (const lesson of unit.lessons) lesson.isLocked = data[key].lessons[lesson.id] === true;} }
  });
  vm.runInContext(source, context);
  return {window, context, nodes, calls, curriculum, worksheets, model: window.ScienceHtmlCatalogModel, api: window.ScienceContentManager,
    handle(fn) {responder = fn;}, catalog(value) {catalog = {...catalog, ...copy(value)};}, auth(value) {identity = value;}, async settle() {await tick();}};
}

test('production cards retain original chasi, tags, classes and independent lock state', () => {
  const app = harness({init: false}); const current = copy(original); current.unit3.isLocked = true; current.unit3.lessons[0].isLocked = true;
  const next = app.model.buildSnapshot([item(1)], original, current, {isLocked: false, units: []});
  const unit = next.curriculum.unit3, lesson = unit.lessons[0];
  assert.equal(unit.themeClass, 'theme-unit3'); assert.equal(unit.cardClass, 'unit-3-card'); assert.equal(unit.isLocked, true);
  assert.equal(lesson.chasi, '1차시'); assert.equal(lesson.title, '실험 1'); assert.deepEqual(copy(lesson.tags), ['반사 법칙', '평면거울']); assert.equal(lesson.isLocked, true);
  assert.equal(lesson.file, `html-lesson.html?id=${id(1)}`);
});

test('new unit and lesson are metadata; HTML-specific card content is escaped', () => {
  const app = harness({init: false}); const row = item(3, {unit_id: 'unit8', unit_title: '8단원. <img onerror=x>', lesson_id: 'u8_l2', title: '2차시 — <script>bad</script>', description: '<img src=x>'});
  const next = app.model.buildSnapshot([row], original, original, {units: []});
  assert.deepEqual(Object.keys(next.curriculum), ['unit8']); assert.equal(next.curriculum.unit8.themeClass, 'theme-custom');
  assert.match(next.curriculum.unit8.title, /&lt;img/); assert.equal(next.curriculum.unit8.lessons[0].chasi, '2차시'); assert.doesNotMatch(next.curriculum.unit8.lessons[0].title, /<script>/);
});

test('worksheet links preserve the lesson query and use an explicit private PDF identity', () => {
  const app = harness({init: false}), ws = item(2, {kind: 'worksheet', format: 'pdf', lesson_id: 'u3_l1'});
  const next = app.model.buildSnapshot([item(1), ws], original, original, {isLocked: false, units: []});
  const row = next.worksheets.units[0].items[0], url = new URL(row.pdf, 'https://example.org/test/');
  assert.equal(url.searchParams.get('id'), id(1)); assert.equal(url.searchParams.get('worksheet'), '1'); assert.equal(url.searchParams.get('worksheetId'), id(2));
  assert.equal((row.pdf.match(/\?/g) || []).length, 1); assert.equal(row.id, 'ws_u3_l1'); assert.equal(next.worksheets.units[0].unitNum, 3); assert.equal(row.isLocked, true);
  const independent = app.model.buildSnapshot([ws], original, {}, {units: []}).worksheets.units[0].items[0];
  assert.equal(independent.pdf, `html-lesson.html?id=${id(2)}`);
});

test('assessment and teacher answer PDFs use their own authenticated loader identity', () => {
  const app = harness({init: false});
  for (const kind of ['assessment', 'answer']) {
    const row = item(4, {kind, format: 'pdf', unit_id: 'unit3_eval', lesson_id: 'u3e_l4'});
    const next = app.model.buildSnapshot([row], original, {}, {units: []});
    const card = next.curriculum.unit3_eval.lessons[0];
    assert.equal(card.file, `html-lesson.html?id=${id(4)}`);
    assert.equal(card.adminOnly, kind === 'answer');
  }
});

test('restoring metadata never keeps an absent private unit and rejects malformed identities', () => {
  const app = harness({init: false});
  assert.deepEqual(copy(app.model.checkedItems([item(1), item(2, {unit_id: '__proto__'}), item(3, {id: 'javascript:alert(1)'}), item(4, {archived_at: '2026-09-13'})])), [item(1)]);
  assert.deepEqual(copy(app.model.buildSnapshot([], original, {unit8: {}}, {units: []})), {curriculum: {}, worksheets: {isLocked: false, units: []}});
  assert.throws(() => app.model.contentUrl({id: '../answer.html'}));
});

test('administrator tab stays visible while the same verified session refreshes and dialog is modal', async () => {
  const app = harness(); await app.settle(); assert.equal(app.api.canManage(), true); assert.equal(app.nodes.get('hcAdminTab').hidden, false);
  await app.api.openManager(); assert.equal(app.nodes.get('hcManager').open, true);
  const pending = deferred(); app.handle(() => pending.promise); const refresh = app.api.refresh();
  assert.equal(app.nodes.get('hcAdminTab').hidden, false); assert.equal(app.nodes.get('hcAdminTab').disabled, true);
  pending.resolve({success: true, role: 'admin', items: [item(1)], unit_appearances: []}); await refresh;
  assert.equal(app.nodes.get('hcManager').open, true); assert.equal(app.nodes.get('hcAdminTab').disabled, false);
});

test('pending teacher response cannot restore private cards after logout or a newer account', async () => {
  const privateLesson = item(8, {unit_id: 'unit8', unit_title: '8단원. 교사 초안', lesson_id: 'u8_l1', published: false, student_access: false});
  const app = harness({items: [privateLesson]}); await app.settle(); assert.ok(app.curriculum.unit8);
  const pending = deferred(); let reads = 0; app.handle(() => ++reads === 1 ? pending.promise : Promise.resolve({success: true, role: 'anonymous', items: [], unit_appearances: []}));
  const refresh = app.api.refresh(); app.auth({}); app.context.isAdminMode = false; app.api.authChanged();
  assert.deepEqual(Object.keys(app.curriculum), []); assert.equal(app.nodes.get('hcAdminTab').hidden, true);
  pending.resolve({success: true, role: 'admin', items: [privateLesson], unit_appearances: []}); await refresh; await app.settle();
  assert.deepEqual(Object.keys(app.curriculum), []); assert.equal(app.api.canManage(), false);
});

test('leaving administrator mode hides private units even if the teacher login token remains', async () => {
  const app = harness({items: [item(1), item(8, {unit_id: 'unit8', lesson_id: 'u8_l1', published: false, student_access: false})]}); await app.settle();
  assert.ok(app.curriculum.unit8); app.context.isAdminMode = false; app.api.authChanged();
  assert.equal(app.curriculum.unit8, undefined); assert.ok(app.curriculum.unit3); assert.equal(app.nodes.get('hcAdminTab').hidden, true);
});

test('locks received before catalog are reapplied to the actual server lesson rows', async () => {
  const app = harness(); await app.settle();
  app.window.ScienceLatestLocks = {unit3: {isLocked: true, lessons: {u3_l1: true}}}; await app.api.refresh();
  assert.equal(app.curriculum.unit3.isLocked, true); assert.equal(app.curriculum.unit3.lessons[0].isLocked, true);
});

test('registering a new HTML unit sends a draft with metadata and preserves the exact document', async () => {
  const app = harness(); await app.settle();
  app.nodes.get('hcUnit').value = 'new'; await app.nodes.get('hcUnit').fire('change');
  app.nodes.get('hcUnitNumber').value = '8'; app.nodes.get('hcUnitTitle').value = '별과 우주'; app.nodes.get('hcLessonNumber').value = '1'; app.nodes.get('hcTitle').value = '별까지의 거리';
  const html = '<!doctype html><html><head><title>별</title></head><body><script>const experiment = 1;</script></body></html>';
  app.nodes.get('hcFile').files = [{name: 'stars.html', size: Buffer.byteLength(html), async text() {return html;}}];
  let saved; app.handle(async (action, payload) => {
    if (action === 'save_content') {saved = copy(payload); return {success: true};}
    assert.equal(action, 'catalog'); return {success: true, role: 'admin', items: [item(1), item(999, {...saved, version: 1})], unit_appearances: []};
  });
  await app.nodes.get('hcForm').fire('submit', {preventDefault() {}});
  assert.equal(saved.unit_id, 'unit8'); assert.equal(saved.lesson_id, 'u8_l1'); assert.equal(saved.unit_title, '8단원. 별과 우주');
  assert.equal(saved.format, 'html'); assert.equal(saved.content, html); assert.equal(saved.published, false); assert.equal(saved.student_access, false); assert.equal(saved.expected_version, 0);
  assert.ok(app.curriculum.unit8); assert.equal(app.curriculum.unit8.lessons[0].file, `html-lesson.html?id=${id(999)}`);
});

test('duplicate lesson registration is rejected before sending a mutation', async () => {
  const app = harness(); await app.settle(); app.nodes.get('hcLessonNumber').value = '1'; app.nodes.get('hcTitle').value = '중복';
  await app.nodes.get('hcForm').fire('submit', {preventDefault() {}});
  assert.equal(app.calls.filter(call => call.action === 'save_content').length, 0); assert.match(app.nodes.get('hcMessage').textContent, /이미 있습니다/);
});

test('a failed catalog clears previously verified management and private metadata', async () => {
  const app = harness(); await app.settle(); app.handle(async () => {throw new Error('연결 실패');});
  assert.equal(await app.api.refresh(), false); assert.equal(app.api.canManage(), false); assert.deepEqual(Object.keys(app.curriculum), []); assert.match(app.nodes.get('hcPublicStatus').textContent, /연결 실패/);
});
