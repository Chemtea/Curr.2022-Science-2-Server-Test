import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/unit-appearance.js', import.meta.url), 'utf8');
const iconSource = fs.readFileSync(new URL('../assets/unit-icons.js', import.meta.url), 'utf8');
const row = {unit_id: 'unit8', icon: 'galaxy', color_start: '#a855f7', color_end: '#fb7185', mode: 'gradient', angle: 135, version: 3};
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
const copy = value => JSON.parse(JSON.stringify(value));
function setup() {
  const node = tag => ({tagName: tag.toUpperCase(), children: [], attributes: {}, dataset: {}, listeners: {}, value: '', open: false, hidden: false, disabled: false,
    style: {values: {}, setProperty(name, value) { this.values[name] = value; }}, classList: {values: new Set(), add(value) { this.values.add(value); }},
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; }, addEventListener(name, fn) { this.listeners[name] = fn; },
    showModal() { this.open = true; }, close() { this.open = false; }, focus() { this.focused = true; },
    getBoundingClientRect() { return {top: 20, bottom: 800, left: 20, right: 1000}; },
    querySelectorAll(selectors) { const tags = selectors.split(',').map(value => value.trim().toUpperCase()); return walk(this).filter(child => child !== this && tags.includes(child.tagName)); }
  });
  const body = node('body'), calls = [];
  let admin = true, identity = {adminSessionToken: 'unit-test-admin'}, refreshes = 0;
  let handle = async (action, payload) => ({success: true, appearance: {...payload.appearance, unit_id: payload.unit_id, version: payload.expected_version + 1}});
  let refresh = async () => { refreshes++; };
  const window = {ScienceContentClient: {auth: () => identity, request: (action, payload) => { calls.push({action, payload: copy(payload)}); return handle(action, payload); }}};
  vm.runInNewContext(iconSource + '\n' + source, {window, document: {body, createElement: node}});
  const api = window.ScienceUnitAppearance;
  api.configure({getUnits: () => [{id: 'unit3', title: '3단원. 빛과 파동'}, {id: 'unit7', title: '7단원. 전기와 자기'}, {id: 'unit8', title: '8단원. 별과 우주'}], canManage: () => admin, onSaved: () => refresh()});
  return {api, body, calls, node, find(predicate) { return walk(body).find(predicate); }, all(predicate) { return walk(body).filter(predicate); },
    role(value) { admin = value; }, auth(value) { identity = value; }, handle(fn) { handle = fn; }, refresh(fn) { refresh = fn; }, get refreshes() { return refreshes; }};
}
function walk(node) { return [node, ...node.children.flatMap(walk)]; }
const button = (app, label) => app.find(node => node.tagName === 'BUTTON' && node.textContent === label);
const click = node => node.listeners.click({target: node});
function input(node, value) { node.value = value; return node.listeners.input({target: node}); }
const icon = (app, id) => app.find(node => node.dataset.icon === id);
const status = app => app.find(node => node.className === 'sua-status').textContent;
const dialog = app => app.find(node => node.tagName === 'DIALOG');

test('known palettes are preserved; new units have distinct defaults; catalog values are sanitized', () => {
  const app = setup();
  assert.equal(app.api.get('unit3').color_start, '#f59e0b'); assert.equal(app.api.get('unit7').color_end, '#818cf8');
  assert.equal(app.api.get('unit8').icon, 'galaxy'); assert.equal(app.api.get('unit9').icon, 'element');
  app.api.receiveCatalog([row, {...row, unit_id: 'unit7', icon: '<script>'}, {...row, unit_id: 'unit3', color_start: 'red;background:url(https://x)'}, {...row, unit_id: ['unit9']}]);
  assert.equal(app.api.get('unit8').version, 3); assert.equal(app.api.get('unit7').version, 0); assert.equal(app.api.get('unit9').version, 0);
  const appearance = app.api.get('unit8'); appearance.icon = 'car'; assert.equal(app.api.get('unit8').icon, 'galaxy');
  const card = app.node('article'); app.api.decorateCard(card, 'unit8'); assert.equal(card.style.values['--sua-paint'], 'linear-gradient(135deg, #a855f7, #fb7185)');
  assert.match(app.api.iconHTML('unit8'), /^<svg/); assert.doesNotMatch(app.api.iconHTML('unit8'), /script/);
  app.api.receiveCatalog([]); assert.equal(app.api.get('unit8').version, 0, 'catalog replacement removes stale rows');
});

test('editor has all icons; local choices preview without writes and close discards the draft', () => {
  const app = setup(); app.api.receiveCatalog([row]); assert.equal(app.api.open('unit8'), true);
  assert.equal(app.all(node => node.dataset.icon).length, 21);
  assert.equal(button(app, '변경사항 저장').disabled, true);
  click(icon(app, 'flask')); click(button(app, '단색'));
  const color = app.find(node => node.attributes['aria-label'] === '첫 번째 색상 코드'); input(color, '#224466');
  assert.equal(app.calls.length, 0); assert.equal(app.api.get('unit8').icon, 'galaxy');
  assert.equal(app.find(node => node.className === 'sua-preview-card').style.values['--sua-paint'], 'linear-gradient(135deg, #224466, #224466)');
  click(button(app, '닫기')); assert.equal(dialog(app).open, false);
  app.api.open('unit8'); assert.equal(icon(app, 'galaxy').attributes['aria-pressed'], 'true'); assert.equal(app.api.get('unit8').version, 3);
});

test('save sends only validated appearance and expected version, then refreshes catalog once', async () => {
  const app = setup(); app.api.receiveCatalog([row]); app.api.open('unit8'); click(icon(app, 'car'));
  await click(button(app, '변경사항 저장'));
  assert.equal(app.calls.length, 1); assert.equal(app.calls[0].action, 'set_unit_appearance');
  assert.deepEqual(app.calls[0].payload, {unit_id: 'unit8', appearance: {icon: 'car', color_start: '#a855f7', color_end: '#fb7185', mode: 'gradient', angle: 135}, expected_version: 3});
  assert.equal(app.refreshes, 1); assert.equal(app.api.get('unit8').version, 4); assert.equal(button(app, '변경사항 저장').disabled, true); assert.match(status(app), /저장했습니다/);
});

test('invalid colors never enter requests, and failed writes retain the editable draft', async () => {
  const app = setup(); app.api.open('unit8');
  const color = app.find(node => node.attributes['aria-label'] === '첫 번째 색상 코드'); input(color, '#12xz34');
  await click(button(app, '변경사항 저장')); assert.equal(app.calls.length, 0); assert.match(status(app), /색상/);
  input(color, '#123456'); app.handle(async () => { throw new Error('연결 실패'); });
  await click(button(app, '변경사항 저장')); assert.equal(app.calls.length, 1); assert.equal(dialog(app).open, true);
  assert.equal(color.value, '#123456'); assert.equal(button(app, '변경사항 저장').disabled, false); assert.match(status(app), /연결 실패/);
});

test('leaving teacher mode prevents writes; pending response cannot modify a later account', async () => {
  const app = setup(); app.role(false); assert.equal(app.api.open('unit8'), false); assert.equal(app.calls.length, 0);
  app.role(true); app.api.open('unit8'); click(icon(app, 'car'));
  const pending = deferred(); app.handle(() => pending.promise); const task = click(button(app, '변경사항 저장'));
  assert.equal(app.calls.length, 1); app.api.clear(); app.auth({adminSessionToken: 'second-teacher'}); app.api.receiveCatalog([{...row, icon: 'sun', version: 9}]); app.api.open('unit8');
  pending.resolve({success: true, appearance: {...row, icon: 'car', version: 1}}); await task;
  assert.equal(dialog(app).open, true); assert.equal(app.api.get('unit8').icon, 'sun'); assert.equal(app.api.get('unit8').version, 9); assert.equal(app.refreshes, 0);
  app.role(false); await click(button(app, '변경사항 저장')); assert.equal(dialog(app).open, false); assert.equal(app.calls.length, 1);
});

test('public close cancels pending editor state but retains appearance cache', async () => {
  const app = setup(); app.api.receiveCatalog([row]); app.api.open('unit8'); click(icon(app, 'car'));
  const pending = deferred(); app.handle(() => pending.promise); const task = click(button(app, '변경사항 저장'));
  app.api.close(); assert.equal(dialog(app).open, false); assert.equal(app.api.get('unit8').version, 3);
  pending.resolve({success: true, appearance: {...row, icon: 'car', version: 4}}); await task;
  assert.equal(app.api.get('unit8').icon, 'galaxy'); assert.equal(app.refreshes, 0);
});

test('conflicting changes require an explicit reload and never retry writes automatically', async () => {
  const app = setup(); app.api.receiveCatalog([row]); app.api.open('unit8'); click(icon(app, 'car'));
  app.handle(async () => { throw Object.assign(new Error('conflict'), {status: 409}); });
  await click(button(app, '변경사항 저장')); assert.equal(app.calls.length, 1); assert.equal(button(app, '변경사항 저장').disabled, true);
  assert.equal(button(app, '최신 설정 불러오기').hidden, false); assert.match(status(app), /다른 화면/);
  await click(button(app, '변경사항 저장')); assert.equal(app.calls.length, 1);
  app.refresh(async () => app.api.receiveCatalog([{...row, icon: 'flower', version: 8}]));
  await click(button(app, '최신 설정 불러오기')); assert.equal(icon(app, 'flower').attributes['aria-pressed'], 'true');
  app.handle(async (action, payload) => ({success: true, appearance: {...payload.appearance, unit_id: payload.unit_id, version: 9}}));
  click(icon(app, 'leaf')); await click(button(app, '변경사항 저장')); assert.equal(app.calls[1].payload.expected_version, 8);
});
