/* Shared unit artwork and teacher-only editor. Appearance never changes lesson access. */
(() => {
  'use strict';
  const unitPattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
  const colorPattern = /^#[0-9a-fA-F]{6}$/;
  const icons = () => window.ScienceUnitIcons;
  const clone = value => ({...value});
  const presets = [
    ['3단원 기본', '#f59e0b', '#ec4899'], ['7단원 기본', '#38bdf8', '#818cf8'],
    ['별과 우주', '#8b5cf6', '#ec4899'], ['바다', '#06b6d4', '#2563eb'],
    ['숲', '#34d399', '#15803d'], ['새싹', '#a3e635', '#14b8a6'],
    ['노을', '#fb923c', '#e11d48'], ['꽃', '#f472b6', '#a855f7'],
    ['모래', '#facc15', '#ea580c'], ['은하', '#6366f1', '#06b6d4'],
    ['청록', '#2dd4bf', '#0d9488'], ['차분한 회색', '#94a3b8', '#475569']
  ];
  let config = {getUnits: () => [], canManage: () => false, onSaved: async () => {}};
  let cache = new Map(), refs = null;
  const state = {generation: 0, session: false, identity: '', unitId: '', draft: null, version: 0, dirty: false, busy: false, conflict: false};
  const identity = () => JSON.stringify(window.ScienceContentClient?.auth?.() || {});
  const manageable = () => { try { return config.canManage() === true; } catch (_) { return false; } };
  const current = generation => state.session && generation === state.generation && manageable() && state.identity === identity();
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  const button = (text, className, handler) => { const node = el('button', className, text); node.type = 'button'; node.addEventListener('click', handler); return node; };

  function defaults(unitId) {
    const base = {icon: 'element', color_start: '#2dd4bf', color_end: '#0d9488', mode: 'gradient', angle: 90, version: 0, unit_id: unitId};
    if (unitId === 'unit3') Object.assign(base, {icon: 'star', color_start: '#f59e0b', color_end: '#ec4899'});
    else if (unitId === 'unit7') Object.assign(base, {icon: 'lightning', color_start: '#38bdf8', color_end: '#818cf8'});
    else if (unitId === 'unit8') Object.assign(base, {icon: 'galaxy', color_start: '#8b5cf6', color_end: '#ec4899'});
    return base;
  }
  function normalize(value) {
    if (!value || typeof value !== 'object' || typeof value.icon !== 'string' || !icons()?.get(value.icon)
      || typeof value.color_start !== 'string' || typeof value.color_end !== 'string' || !colorPattern.test(value.color_start) || !colorPattern.test(value.color_end)
      || !['solid', 'gradient'].includes(value.mode) || !Number.isInteger(value.angle) || value.angle < 0 || value.angle > 359) return null;
    return {icon: value.icon, color_start: value.color_start.toLowerCase(), color_end: value.color_end.toLowerCase(), mode: value.mode, angle: value.angle};
  }
  function get(unitId) { return clone(cache.get(unitId) || defaults(unitId)); }
  function receiveCatalog(rows) {
    const next = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const appearance = normalize(row);
      if (!appearance || typeof row.unit_id !== 'string' || !unitPattern.test(row.unit_id) || !Number.isSafeInteger(row.version) || row.version < 1) continue;
      next.set(row.unit_id, {...appearance, unit_id: row.unit_id, version: row.version});
    }
    cache = next;
  }
  function cssVariables(value) {
    const appearance = normalize(value) || defaults('unit');
    const end = appearance.mode === 'solid' ? appearance.color_start : appearance.color_end;
    return {'--sua-start': appearance.color_start, '--sua-end': end, '--sua-angle': appearance.angle + 'deg',
      '--sua-paint': `linear-gradient(${appearance.angle}deg, ${appearance.color_start}, ${end})`};
  }
  function decorateCard(card, unitId) {
    if (!card?.style) return;
    card.classList.add('sua-card');
    for (const [name, value] of Object.entries(cssVariables(get(unitId)))) card.style.setProperty(name, value);
  }
  function iconHTML(unitId) { return icons()?.get(get(unitId).icon)?.svg || ''; }
  function units() {
    const seen = new Set();
    return (config.getUnits() || []).filter(unit => {
      if (!unit || typeof unit.id !== 'string' || !unitPattern.test(unit.id) || typeof unit.title !== 'string' || seen.has(unit.id)) return false;
      seen.add(unit.id); return true;
    });
  }
  function status(message, isError = false) {
    if (!refs) return;
    refs.status.textContent = message; refs.status.dataset.error = String(isError);
  }
  function clear() {
    state.generation++; state.session = false; state.identity = ''; state.unitId = ''; state.draft = null;
    state.version = 0; state.dirty = false; state.busy = false; state.conflict = false; cache.clear();
    if (refs) { refs.dialog.close(); refs.select.replaceChildren(); refs.preview.replaceChildren(); status(''); }
  }
  function close(force = false) {
    if (state.busy && !force) return;
    state.generation++; state.session = false; state.identity = ''; state.draft = null; state.dirty = false;
    state.busy = false; state.conflict = false;
    refs?.dialog.close();
  }
  function syncBusy() {
    if (!refs) return;
    refs.dialog.setAttribute('aria-busy', String(state.busy));
    for (const input of refs.dialog.querySelectorAll('input, select, button')) input.disabled = state.busy;
    refs.save.disabled = state.busy || !state.dirty || state.conflict;
    refs.save.textContent = state.busy ? '저장 중…' : '변경사항 저장';
    refs.reload.hidden = !state.conflict;
    refs.endGroup.hidden = state.draft?.mode !== 'gradient';
    refs.angleGroup.hidden = state.draft?.mode !== 'gradient';
  }
  function updatePreview() {
    if (!refs || !state.draft) return;
    const appearance = normalize(state.draft);
    if (!appearance) { status('색상은 # 뒤에 여섯 자리 숫자·영문(A~F)으로 입력해 주세요.', true); return; }
    for (const [name, value] of Object.entries(cssVariables(appearance))) refs.preview.style.setProperty(name, value);
    const unit = units().find(item => item.id === state.unitId);
    refs.preview.replaceChildren();
    const top = el('div', 'sua-preview-head');
    const badge = el('span', 'sua-preview-badge', '과학 탐구');
    const icon = el('span', 'sua-preview-icon'); icon.innerHTML = icons().get(appearance.icon).svg;
    top.append(badge, icon);
    refs.preview.append(top, el('h3', '', unit?.title || '새 단원'), el('p', '', '이 단원의 수업을 선택하고 탐구를 시작하세요.'), el('span', 'sua-preview-cta', '단원 살펴보기 →'));
    refs.previewName.textContent = icons().get(appearance.icon).label;
  }
  function markDirty() {
    state.dirty = true; status('미리보기에만 적용된 상태입니다. 저장하면 전체 단원 화면에 반영됩니다.');
    syncBusy(); updatePreview();
  }
  function syncControls() {
    const value = state.draft;
    for (const [key, pair] of Object.entries(refs.colors)) { pair.picker.value = value[key]; pair.hex.value = value[key]; }
    for (const [mode, btn] of Object.entries(refs.modes)) btn.setAttribute('aria-pressed', String(mode === value.mode));
    for (const [id, btn] of refs.iconButtons) btn.setAttribute('aria-pressed', String(id === value.icon));
    refs.angle.value = String(value.angle); refs.angleValue.textContent = value.angle + '°';
    syncBusy(); updatePreview();
  }
  function loadUnit(unitId) {
    state.unitId = unitId; const saved = get(unitId); state.draft = normalize(saved); state.version = saved.version;
    state.dirty = false; state.conflict = false; refs.select.value = unitId; status('문양과 색상을 고른 뒤 저장하세요.'); syncControls();
  }
  async function save() {
    const generation = state.generation;
    if (!current(generation)) { clear(); return; }
    if (state.busy || !state.dirty || state.conflict) return;
    const appearance = normalize(state.draft);
    if (!appearance) { status('문양·색상·그라데이션 방향을 확인해 주세요. 색상은 # 뒤 여섯 자리로 입력합니다.', true); return; }
    if (!units().some(unit => unit.id === state.unitId)) { status('현재 목록에 없는 단원입니다. 창을 닫고 단원 목록을 새로 불러오세요.', true); return; }
    const selectedUnit = state.unitId;
    state.busy = true; syncBusy(); status('단원 꾸미기를 저장하고 있습니다.');
    try {
      const result = await window.ScienceContentClient.request('set_unit_appearance', {unit_id: selectedUnit, appearance, expected_version: state.version});
      if (!current(generation)) { if (generation === state.generation) clear(); return; }
      const saved = result?.appearance, checked = normalize(saved);
      if (!result?.success || !checked || saved.unit_id !== selectedUnit || !Number.isSafeInteger(saved.version) || saved.version <= state.version) throw new Error('저장 결과를 확인할 수 없습니다. 창을 다시 열어 최신 상태를 확인해 주세요.');
      cache.set(selectedUnit, {...checked, unit_id: selectedUnit, version: saved.version});
      state.version = saved.version; state.draft = checked; state.dirty = false;
      try { await config.onSaved(); }
      catch (_) { if (current(generation)) status('저장했습니다. 단원 목록은 화면을 새로고침하면 반영됩니다.'); return; }
      if (current(generation)) { syncControls(); status('저장했습니다. 단원 배너에 적용되었습니다.'); }
    } catch (error) {
      if (!current(generation)) { if (generation === state.generation) clear(); return; }
      if (error.status === 409 || error.code === 'version_conflict') {
        state.conflict = true;
        status('다른 화면에서 이 단원의 꾸미기가 변경되었습니다. ‘최신 설정 불러오기’를 누른 뒤 다시 수정하세요.', true);
      } else status(error.message || '저장하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.', true);
    } finally { if (current(generation)) { state.busy = false; syncBusy(); } }
  }
  async function reload() {
    const generation = state.generation;
    if (!current(generation) || state.busy) return;
    state.busy = true; syncBusy(); status('최신 설정을 불러오고 있습니다.');
    try {
      await config.onSaved();
      if (current(generation)) loadUnit(state.unitId);
    } catch (error) { if (current(generation)) status('최신 설정을 불러오지 못했습니다. ' + (error.message || ''), true); }
    finally { if (current(generation)) { state.busy = false; syncBusy(); } }
  }
  function colorField(parent, key, label) {
    const wrap = el('div', 'sua-color-field'); const title = el('label', '', label); title.htmlFor = 'sua-' + key;
    const pair = el('div', 'sua-color-pair'); const picker = el('input', 'sua-color-picker'); picker.type = 'color'; picker.id = 'sua-' + key;
    picker.setAttribute('aria-label', label + ' 선택');
    const hex = el('input', 'sua-hex'); hex.type = 'text'; hex.maxLength = 7; hex.setAttribute('aria-label', label + ' 코드'); hex.spellcheck = false; hex.autocomplete = 'off';
    picker.addEventListener('input', () => { state.draft[key] = picker.value; hex.value = picker.value; markDirty(); });
    hex.addEventListener('input', () => { state.draft[key] = hex.value.trim(); if (colorPattern.test(state.draft[key])) picker.value = state.draft[key]; markDirty(); });
    pair.append(picker, hex); wrap.append(title, pair); parent.append(wrap); refs.colors[key] = {picker, hex}; return wrap;
  }
  function build() {
    if (refs) return;
    refs = {colors: {}, modes: {}, iconButtons: new Map()};
    const dialog = el('dialog', 'sua-dialog'); dialog.id = 'suaDialog'; dialog.setAttribute('aria-labelledby', 'suaTitle'); refs.dialog = dialog;
    const header = el('header', 'sua-header'); const heading = el('div'); heading.append(el('p', 'sua-eyebrow', '관리자 · 단원 설정'));
    const title = el('h2', '', '단원 꾸미기'); title.id = 'suaTitle'; heading.append(title, el('p', 'sua-help', '단원의 문양과 색상을 골라 나만의 수업 공간을 만드세요.'));
    const exit = button('×', 'sua-close', () => close()); exit.setAttribute('aria-label', '꾸미기 닫기'); header.append(heading, exit);
    const body = el('div', 'sua-body'); const controls = el('div', 'sua-controls');
    const selectLabel = el('label', 'sua-field-label', '꾸밀 단원'); selectLabel.htmlFor = 'suaUnit';
    refs.select = el('select', 'sua-select'); refs.select.id = 'suaUnit';
    refs.select.addEventListener('change', () => loadUnit(refs.select.value)); controls.append(selectLabel, refs.select);
    const iconSection = el('section', 'sua-section'); iconSection.append(el('h3', '', '문양 선택'));
    const iconGrid = el('div', 'sua-icon-grid'); iconGrid.setAttribute('role', 'group'); iconGrid.setAttribute('aria-label', '단원 문양');
    for (const icon of icons()?.all || []) {
      const btn = button('', 'sua-icon-choice', () => { state.draft.icon = icon.id; syncControls(); markDirty(); }); btn.dataset.icon = icon.id;
      const image = el('span', 'sua-choice-image'); image.innerHTML = icon.svg; btn.append(image, el('span', '', icon.label));
      btn.setAttribute('aria-pressed', 'false'); refs.iconButtons.set(icon.id, btn); iconGrid.append(btn);
    }
    iconSection.append(iconGrid); controls.append(iconSection);
    const colors = el('section', 'sua-section'); colors.append(el('h3', '', '색상과 그라데이션'));
    const palettes = el('div', 'sua-palettes'); palettes.setAttribute('aria-label', '추천 색상');
    for (const [label, start, end] of presets) {
      const swatch = button('', 'sua-palette', () => { Object.assign(state.draft, {color_start: start, color_end: end, mode: 'gradient', angle: 90}); syncControls(); markDirty(); });
      swatch.title = label; swatch.setAttribute('aria-label', label + ' 색상'); swatch.style.setProperty('--sua-swatch', `linear-gradient(90deg, ${start}, ${end})`);
      const sample = el('span', 'sua-swatch'); sample.setAttribute('aria-hidden', 'true'); swatch.append(sample, el('span', '', label)); palettes.append(swatch);
    }
    colors.append(palettes);
    const modes = el('div', 'sua-segment'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '색상 방식');
    for (const [mode, label] of [['solid', '단색'], ['gradient', '그라데이션']]) {
      const btn = button(label, '', () => { state.draft.mode = mode; syncControls(); markDirty(); }); refs.modes[mode] = btn; modes.append(btn);
    }
    colors.append(modes); const pair = el('div', 'sua-colors'); colors.append(pair);
    colorField(pair, 'color_start', '첫 번째 색상'); refs.endGroup = colorField(pair, 'color_end', '두 번째 색상');
    refs.angleGroup = el('label', 'sua-angle'); const angleLabel = el('span', '', '그라데이션 방향'); refs.angleValue = el('output', '', '90°');
    refs.angle = el('input'); refs.angle.type = 'range'; refs.angle.min = '0'; refs.angle.max = '359'; refs.angle.step = '1'; refs.angle.setAttribute('aria-label', '그라데이션 방향 각도');
    refs.angle.addEventListener('input', () => { state.draft.angle = Number(refs.angle.value); refs.angleValue.textContent = state.draft.angle + '°'; markDirty(); });
    refs.angleGroup.append(angleLabel, refs.angleValue, refs.angle); colors.append(refs.angleGroup); controls.append(colors);
    const previewColumn = el('aside', 'sua-preview-column'); previewColumn.append(el('h3', '', '배너 미리보기'));
    refs.preview = el('div', 'sua-preview-card'); refs.previewName = el('p', 'sua-preview-name'); previewColumn.append(refs.preview, refs.previewName, el('p', 'sua-help', '색상과 문양은 모든 사용자에게 함께 적용됩니다. 수업 공개 상태와 잠금 설정은 별도로 유지됩니다.'));
    body.append(controls, previewColumn);
    const footer = el('footer', 'sua-footer'); refs.status = el('p', 'sua-status'); refs.status.setAttribute('role', 'status'); refs.status.setAttribute('aria-live', 'polite');
    const actions = el('div', 'sua-actions'); refs.reload = button('최신 설정 불러오기', 'sua-button', reload); refs.reload.hidden = true;
    refs.cancel = button('닫기', 'sua-button', () => close()); refs.save = button('변경사항 저장', 'sua-button sua-primary', save); actions.append(refs.reload, refs.cancel, refs.save);
    footer.append(refs.status, actions); dialog.append(header, body, footer); document.body.append(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('click', event => { if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); });
  }
  function open(unitId) {
    if (!manageable() || !icons()?.all?.length) return false;
    const available = units(); if (!available.length) return false;
    build(); if (state.busy) return false;
    state.generation++; state.session = true; state.identity = identity();
    refs.select.replaceChildren();
    for (const unit of available) { const option = el('option', '', unit.title); option.value = unit.id; refs.select.append(option); }
    loadUnit(available.some(unit => unit.id === unitId) ? unitId : available[0].id);
    if (!refs.dialog.open) refs.dialog.showModal(); refs.select.focus(); return true;
  }
  function configure(options = {}) {
    for (const key of ['getUnits', 'canManage', 'onSaved']) if (typeof options[key] === 'function') config[key] = options[key];
  }
  window.ScienceUnitAppearance = Object.freeze({configure, receiveCatalog, clear, close: () => close(true), open, get, decorateCard, iconHTML, cssVariables});
})();
