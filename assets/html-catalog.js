/* HTML-first server catalog. The production card and worksheet renderers remain in index.html. */
(() => {
  'use strict';
  const client = window.ScienceContentClient;
  const kinds = Object.freeze({lesson: '수업 HTML', worksheet: '학습지 PDF', assessment: '수행평가', answer: '교사용 답안'});
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const unitPattern = /^unit([1-9]\d{0,2})(_eval)?$/;
  const identity = () => JSON.stringify(client.auth());
  const clone = value => JSON.parse(JSON.stringify(value));
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const byId = id => document.getElementById(id);
  const state = {items: [], archived: [], role: 'anonymous', ready: false, loading: false, error: '', generation: 0, archiveGeneration: 0, archiveLoading: false, archiveError: '', view: 'active', editing: null, newId: null, busy: false};
  const baseline = typeof defaultCurriculum === 'undefined' ? {} : clone(defaultCurriculum);
  const baselineWorksheets = typeof worksheetCurriculum === 'undefined' ? {units: []} : clone(worksheetCurriculum);
  let fingerprint = identity(), refreshTimer = null, queuedRefresh = false;

  function checkedItems(rows, archived = false) {
    return (Array.isArray(rows) ? rows : []).filter(item => item && uuid.test(item.id) && Object.hasOwn(kinds, item.kind)
      && unitPattern.test(item.unit_id) && (!item.lesson_id || /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(item.lesson_id))
      && Boolean(item.archived_at) === archived);
  }
  function number(item) { return Number(unitPattern.exec(item.unit_id)?.[1] || 0); }
  function lessonNumber(item) { return Number(/_l(\d+)$/.exec(item.lesson_id || '')?.[1] || /^(\d+)차시/.exec(item.title || '')?.[1] || 0); }
  function contentUrl(item, worksheet) {
    if (!uuid.test(item?.id)) throw new Error('자료 번호를 확인해 주세요.');
    const url = new URL('html-lesson.html', 'https://catalog.invalid/');
    url.searchParams.set('id', item.id);
    if (worksheet) {
      if (!uuid.test(worksheet.id)) throw new Error('학습지 번호를 확인해 주세요.');
      url.searchParams.set('worksheet', '1'); url.searchParams.set('worksheetId', worksheet.id);
    }
    return url.pathname.slice(1) + url.search;
  }
  function latestTitle(items, key, fallback) {
    const latest = items.filter(item => item.unit_id === key && item.unit_title).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
    return String(latest?.unit_title || fallback || `${Number(unitPattern.exec(key)?.[1])}단원`);
  }
  function buildSnapshot(items, original, current, worksheets) {
    const curriculum = {};
    const groups = new Map();
    for (const item of items) {
      if (item.kind === 'worksheet') continue;
      if (!groups.has(item.unit_id)) groups.set(item.unit_id, []);
      groups.get(item.unit_id).push(item);
    }
    for (const [key, rows] of [...groups].sort(([a], [b]) => a.localeCompare(b, undefined, {numeric: true}))) {
      const base = original[key], previous = current[key];
      const category = /_eval$/.test(key) ? 'eval' : 'regular';
      const unit = {...(base || {id: key, category, icon: category === 'eval' ? '📋' : '📘', desc: '', themeClass: 'theme-custom', barThemeClass: '', statusClass: '', bannerClass: '', badgeClass: '', cardClass: '', btnClass: ''})};
      unit.title = escape(latestTitle(items, key, base?.title));
      unit.isLocked = previous?.isLocked ?? base?.isLocked ?? (category === 'eval');
      unit.lessons = rows.sort((a, b) => lessonNumber(a) - lessonNumber(b) || String(a.title).localeCompare(String(b.title), 'ko')).map(item => {
        const old = base?.lessons?.find(lesson => lesson.id === item.lesson_id);
        const lock = previous?.lessons?.find(lesson => lesson.id === item.lesson_id);
        const n = lessonNumber(item);
        const title = String(item.title || '').replace(/^\d+차시\s*[—–\-.:]?\s*/, '');
        return {...(old || {}), id: item.lesson_id || ('content_' + item.id.replaceAll('-', '')), contentId: item.id,
          dashboardLessonKey: item.lesson_id, chasi: old?.chasi || (n ? `${n}차시` : kinds[item.kind]),
          title: escape(title || item.title), desc: escape(item.description || old?.desc || ''), file: contentUrl(item),
          tags: (old?.tags || []).map(escape), isLocked: lock?.isLocked ?? old?.isLocked ?? (category === 'eval'),
          adminOnly: item.kind === 'answer' || (!item.published || !item.student_access), published: item.published, studentAccess: item.student_access};
      });
      curriculum[key] = unit;
    }
    const wsGroups = new Map();
    for (const item of items.filter(item => item.kind === 'worksheet')) {
      const n = number(item); if (!wsGroups.has(n)) wsGroups.set(n, []); wsGroups.get(n).push(item);
    }
    const units = [...wsGroups].sort(([a], [b]) => a - b).map(([n, rows]) => {
      const previous = worksheets.units.find(unit => unit.unitNum === n);
      const source = baselineWorksheets.units.find(unit => unit.unitNum === n);
      return {unitNum: n, unitTitle: escape(latestTitle(items, `unit${n}`, source?.unitTitle)), icon: original[`unit${n}`]?.icon || '📘',
        isLocked: previous?.isLocked ?? source?.isLocked ?? true,
        items: rows.sort((a, b) => lessonNumber(a) - lessonNumber(b)).map(item => {
          const lesson = items.find(candidate => candidate.kind === 'lesson' && candidate.unit_id === item.unit_id && candidate.lesson_id === item.lesson_id);
          const id = 'ws_' + (item.lesson_id || item.id.replaceAll('-', ''));
          return {id, worksheetId: item.id, contentId: item.id, lessonId: item.lesson_id, name: escape(item.title),
            pdf: contentUrl(lesson || item, lesson ? item : null), isLocked: previous?.items?.find(row => row.id === id)?.isLocked ?? source?.items?.find(row => row.id === id)?.isLocked ?? true,
            adminOnly: !item.published || !item.student_access};
        })};
    });
    return {curriculum, worksheets: {isLocked: worksheets.isLocked ?? false, units}};
  }
  function teacherMode() { return typeof isAdminMode !== 'undefined' && isAdminMode === true && Boolean(client.auth().adminSessionToken); }
  function canManage() { return teacherMode() && state.ready && state.role === 'admin'; }
  function showMessage(text, error = false) { const node = byId('hcMessage'); if (node) { node.textContent = text; node.dataset.error = String(error); } }
  function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
  function button(text, handler, primary = false) { const node = el('button', 'hc-button' + (primary ? ' hc-primary' : ''), text); node.type = 'button'; node.addEventListener('click', handler); return node; }
  function syncCurriculum() {
    if (typeof defaultCurriculum === 'undefined' || typeof worksheetCurriculum === 'undefined') return;
    const visible = canManage() ? state.items : state.items.filter(item => item.kind !== 'answer' && item.published === true && item.student_access === true);
    const next = buildSnapshot(visible, baseline, defaultCurriculum, worksheetCurriculum);
    Object.keys(defaultCurriculum).forEach(key => delete defaultCurriculum[key]); Object.assign(defaultCurriculum, next.curriculum);
    worksheetCurriculum.units = next.worksheets.units;
    if (window.ScienceLatestLocks && typeof applyCloudLocks === 'function') applyCloudLocks(window.ScienceLatestLocks);
  }
  function syncAdminUi() {
    for (const id of ['hcAdminTab', 'hcAppearanceTab']) {
      const node = byId(id); if (node) { node.hidden = !canManage(); node.disabled = state.loading; node.setAttribute('aria-busy', String(state.loading)); }
    }
    if (!canManage()) { byId('hcManager')?.close(); window.ScienceUnitAppearance?.close(true); }
    byId('hcAdminTab')?.setAttribute('aria-expanded', String(Boolean(byId('hcManager')?.open)));
  }
  function renderAll() {
    syncAdminUi();
    if (typeof renderUnitHub === 'function') renderUnitHub();
    if (typeof currentUnitKey !== 'undefined' && currentUnitKey) {
      if (defaultCurriculum[currentUnitKey] && typeof renderLessonCards === 'function') renderLessonCards(defaultCurriculum[currentUnitKey]);
      else if (typeof backToHub === 'function') backToHub();
    }
    if (byId('worksheetView')?.style.display === 'block' && typeof renderWorksheetList === 'function') renderWorksheetList();
    if (byId('assessmentView')?.style.display === 'block' && typeof renderAssessmentView === 'function') renderAssessmentView();
    const status = byId('hcCatalogStatus');
    if (status) status.textContent = state.loading ? '자료 목록 확인 중…' : state.error || (state.ready ? `등록 자료 ${state.items.length}개` : '자료 서버 확인이 필요합니다.');
    const publicStatus = byId('hcPublicStatus');
    if (publicStatus) { publicStatus.hidden = state.ready && !state.error; publicStatus.textContent = state.error || (state.loading ? '수업 목록을 불러오고 있습니다…' : ''); }
    renderList();
  }
  async function refresh() {
    if (refreshTimer !== null) { clearTimeout(refreshTimer); refreshTimer = null; }
    queuedRefresh = false;
    const generation = ++state.generation, who = identity();
    const current = () => state.generation === generation && identity() === who;
    state.loading = true; state.error = ''; renderAll();
    try {
      const response = await client.request('catalog'); if (!current()) return false;
      state.role = ['admin', 'student'].includes(response.role) ? response.role : 'anonymous';
      state.items = checkedItems(response.items).filter(item => state.role === 'admin' || (item.kind !== 'answer' && item.published === true && item.student_access === true));
      state.ready = true; window.ScienceUnitAppearance?.receiveCatalog(response.unit_appearances || []); syncCurriculum(); updateUnitOptions(); return true;
    } catch (error) {
      if (!current()) return false;
      state.ready = false; state.role = 'anonymous'; state.items = []; state.error = error.message;
      window.ScienceUnitAppearance?.clear(); syncCurriculum(); return false;
    } finally {
      if (current()) { state.loading = false; renderAll(); if (queuedRefresh) locksChanged(); }
    }
  }
  function locksChanged() { if (state.loading) { queuedRefresh = true; return; } if (refreshTimer !== null) clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 120); }
  function authChanged() {
    const next = identity(); if (next === fingerprint) { syncCurriculum(); renderAll(); return; }
    fingerprint = next; state.generation++; state.archiveGeneration++; state.ready = false; state.loading = false; state.role = 'anonymous'; state.items = []; state.archived = []; state.view = 'active'; state.busy = false;
    if (refreshTimer !== null) { clearTimeout(refreshTimer); refreshTimer = null; }
    queuedRefresh = false; window.ScienceUnitAppearance?.clear(); syncCurriculum(); resetForm(); renderAll(); Promise.resolve().then(refresh);
  }
  function appearanceUnits() { return Object.entries(defaultCurriculum).filter(([, unit]) => unit.category !== 'eval').map(([id]) => ({id, title: latestTitle(state.items, id, baseline[id]?.title), category: 'regular'})); }
  async function openUnitAppearance(id) { const who = identity(); if (!canManage()) return false; if (!await refresh() || who !== identity() || !canManage()) return false; return window.ScienceUnitAppearance?.open(id) || false; }
  function renderList() {
    const target = byId('hcItems'); if (!target) return; target.replaceChildren();
    if (!canManage()) return;
    if (state.view === 'archived' && (state.archiveLoading || state.archiveError)) { target.append(el('p', 'hc-empty', state.archiveLoading ? '보관함을 확인하고 있습니다…' : state.archiveError)); return; }
    const filter = byId('hcFilter')?.value || 'all';
    const rows = (state.view === 'archived' ? state.archived : state.items).filter(item => filter === 'all' || item.kind === filter);
    if (!rows.length) { target.append(el('p', 'hc-empty', state.view === 'archived' ? '보관한 자료가 없습니다.' : '등록된 자료가 없습니다. 위에서 파일을 등록해 주세요.')); return; }
    for (const item of rows) {
      const row = el('article', 'hc-row'), info = el('div', 'hc-row-info'), actions = el('div', 'hc-row-actions');
      info.append(el('strong', '', item.title), el('small', '', `${number(item)}단원 · ${kinds[item.kind]} · v${item.version} · ${item.kind === 'answer' ? '교사 전용' : item.published && item.student_access ? '학생 공개' : '교사 전용 초안'}`));
      if (state.view === 'archived') actions.append(button('교사 전용으로 복원', () => mutate('restore_content', item, {}, '교사 전용으로 복원했습니다. 확인한 뒤 학생 공개를 선택하세요.')));
      else {
        const preview = el('a', 'hc-button', '미리보기'); preview.href = contentUrl(item); preview.target = '_blank'; preview.rel = 'noopener'; actions.append(preview);
        if (item.kind === 'worksheet') {
          const lesson = state.items.find(row => row.kind === 'lesson' && row.unit_id === item.unit_id && row.lesson_id === item.lesson_id);
          if (lesson) { const panel = el('a', 'hc-button', '수업 패널에서 보기'); panel.href = contentUrl(lesson, item); panel.target = '_blank'; panel.rel = 'noopener'; actions.append(panel); }
        }
        actions.append(button('정보·파일 수정', () => edit(item)));
        if (item.kind !== 'answer') actions.append(button(item.published && item.student_access ? '학생 비공개' : '학생 공개', () => publish(item)));
        actions.append(button('보관', () => { if (confirm(`「${item.title}」을 보관할까요? 원본은 보관함에서 다시 꺼낼 수 있습니다.`)) mutate('delete_content', item, {}, '보관함으로 옮겼습니다.'); }));
      }
      actions.querySelectorAll('button').forEach(node => { node.disabled = state.busy; }); row.append(info, actions); target.append(row);
    }
  }
  async function mutate(action, item, values, success) {
    if (!canManage() || state.busy) return false;
    const who = identity(); state.busy = true; renderList();
    try {
      await client.request(action, {id: item.id, expected_version: item.version, ...values}); if (who !== identity() || !canManage()) return false;
      if (state.editing?.id === item.id) resetForm(); await refresh(); if (state.view === 'archived') await refreshArchive(); showMessage(success); return true;
    } catch (error) { if (who === identity()) showMessage(error.message, true); return false; }
    finally { if (who === identity()) { state.busy = false; renderList(); } }
  }
  function publish(item) {
    const next = !(item.published && item.student_access);
    if (next && !confirm(`「${item.title}」을 학생에게 공개할까요? 단원·차시와 학습지의 잠금은 별도로 적용됩니다.`)) return;
    return mutate('set_publication', item, {published: true, student_access: next}, next ? '학생 공개로 저장했습니다. 기존 잠금도 확인해 주세요.' : '교사 전용으로 변경했습니다.');
  }
  async function refreshArchive() {
    if (!canManage()) return;
    const generation = ++state.archiveGeneration, who = identity(); state.archiveLoading = true; state.archiveError = ''; state.archived = []; renderList();
    const current = () => generation === state.archiveGeneration && who === identity() && canManage();
    try { const response = await client.request('list_archived'); if (current()) state.archived = checkedItems(response.items, true); }
    catch (error) { if (current()) state.archiveError = error.message; }
    finally { if (current()) { state.archiveLoading = false; renderList(); } }
  }
  function selectView(view) {
    state.view = view; byId('hcForm').hidden = view === 'archived';
    byId('hcActiveTab').setAttribute('aria-pressed', String(view === 'active')); byId('hcArchiveTab').setAttribute('aria-pressed', String(view === 'archived'));
    if (view === 'archived') { showMessage('복원한 자료는 교사 전용 상태로 돌아갑니다.'); refreshArchive(); } else { showMessage(''); renderList(); }
  }
  function unitChoices() {
    const map = new Map();
    for (const item of state.items) if (!/_eval$/.test(item.unit_id)) map.set(number(item), latestTitle(state.items, item.unit_id, baseline[item.unit_id]?.title));
    for (const [key, unit] of Object.entries(baseline)) if (!/_eval$/.test(key) && !map.has(number({unit_id: key}))) map.set(number({unit_id: key}), unit.title);
    return [...map].sort(([a], [b]) => a - b);
  }
  function updateUnitOptions() {
    const select = byId('hcUnit'); if (!select) return;
    const old = select.value; select.replaceChildren();
    unitChoices().forEach(([n, title]) => { const node = el('option', '', title); node.value = String(n); select.append(node); });
    const create = el('option', '', '+ 새 단원 만들기'); create.value = 'new'; select.append(create);
    if ([...select.options].some(option => option.value === old)) select.value = old;
    const rename = byId('hcRenameUnit');
    if (rename) {
      const selected = rename.value; rename.replaceChildren();
      appearanceUnits().forEach(unit => { const node = el('option', '', unit.title); node.value = unit.id; rename.append(node); });
      if ([...rename.options].some(option => option.value === selected)) rename.value = selected;
      updateRenameTitle();
    }
    if (!state.editing) unitChanged(false);
  }
  function unitChanged(setNext = true) {
    const isNew = byId('hcUnit').value === 'new'; byId('hcNewUnitFields').hidden = !isNew;
    const n = Number(byId('hcUnit').value);
    if (isNew && setNext) {
      byId('hcUnitNumber').value = String(Math.max(0, ...unitChoices().map(([value]) => value)) + 1);
      byId('hcUnitTitle').value = ''; byId('hcLessonNumber').value = '1';
    } else if (!isNew) {
      byId('hcUnitNumber').value = String(n); byId('hcUnitTitle').value = unitChoices().find(([value]) => value === n)?.[1] || `${n}단원`;
      if (setNext && !state.editing) {
        const numbers = state.items.filter(item => item.kind === byId('hcKind').value && number(item) === n).map(lessonNumber);
        byId('hcLessonNumber').value = String(Math.max(0, ...numbers) + 1);
      }
    }
    updateHint();
  }
  function updateHint() {
    const kind = byId('hcKind').value;
    byId('hcFile').accept = kind === 'worksheet' ? '.pdf' : kind === 'lesson' ? '.html,.htm' : '.html,.htm,.pdf';
    const notes = {lesson: '완성한 수업 HTML을 그대로 등록합니다. 직접 작성하거나 신뢰하는 HTML만 올려 주세요. 등록 후에는 교사 전용 초안으로 확인합니다.',
      worksheet: '연결할 수업과 같은 단원·차시 번호를 선택하세요. 학습지함과 수업의 학습지 패널에 함께 연결됩니다.', assessment: '수행평가관에 등록하며 처음에는 교사 전용입니다. 학생 공개와 평가관 잠금을 각각 설정합니다.', answer: '교사용 답안은 학생에게 공개되지 않습니다.'};
    byId('hcKindHint').textContent = notes[kind];
  }
  function resetForm() {
    state.editing = null; state.newId = null;
    const form = byId('hcForm'); if (!form) return;
    form.reset(); byId('hcFile').required = true; byId('hcKind').disabled = false; byId('hcUnit').disabled = false; byId('hcLessonNumber').disabled = false;
    byId('hcCancelEdit').hidden = true; byId('hcSave').textContent = '교사 전용 초안으로 등록'; byId('hcFile').value = ''; updateUnitOptions(); unitChanged();
  }
  function edit(item) {
    if (!canManage() || state.busy) return; state.editing = item; state.newId = null; selectView('active');
    byId('hcKind').value = item.kind; byId('hcKind').disabled = true; byId('hcUnit').value = String(number(item));
    if (byId('hcUnit').value !== String(number(item))) { const option = el('option', '', item.unit_title); option.value = String(number(item)); byId('hcUnit').prepend(option); byId('hcUnit').value = option.value; }
    byId('hcUnit').disabled = true; byId('hcNewUnitFields').hidden = true; byId('hcUnitNumber').value = String(number(item)); byId('hcUnitTitle').value = item.unit_title;
    byId('hcLessonNumber').value = String(lessonNumber(item) || 1); byId('hcLessonNumber').disabled = true;
    byId('hcTitle').value = String(item.title).replace(/^\d+차시\s*[—–\-.:]?\s*/, ''); byId('hcDescription').value = item.description || '';
    byId('hcFile').required = false; byId('hcFile').value = ''; byId('hcCancelEdit').hidden = false; byId('hcSave').textContent = '수정하고 교사 전용으로 저장'; updateHint();
    showMessage('차시 연결을 유지하기 위해 단원·차시 번호는 고정됩니다. 파일을 선택하지 않으면 기존 HTML/PDF를 유지합니다. 저장 후 학생 공개를 다시 선택해 주세요.');
    byId('hcForm').scrollIntoView({block: 'start', behavior: 'smooth'}); byId('hcTitle').focus();
  }
  async function filePayload(file, kind) {
    if (file.size > 10 * 1024 * 1024) throw new Error('파일은 10MB 이하로 올려 주세요.');
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'pdf' && kind !== 'lesson') {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw new Error('올바른 PDF 파일을 선택해 주세요.');
      let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return {format: 'pdf', mime: 'application/pdf', file_base64: btoa(binary)};
    }
    if (['html', 'htm'].includes(ext) && kind !== 'worksheet') {
      const content = await file.text(); if (!/<(?:!doctype\s+html|html|body|head)\b/i.test(content)) throw new Error('완성된 HTML 문서 파일을 선택해 주세요.');
      return {format: 'html', content};
    }
    throw new Error('수업은 HTML, 학습지는 PDF 파일로 등록해 주세요.');
  }
  async function save(event) {
    event.preventDefault(); if (!canManage() || state.busy) return;
    const who = identity(), editing = state.editing; state.busy = true; byId('hcSave').disabled = true; renderList();
    const current = () => who === identity() && canManage();
    try {
      const kind = byId('hcKind').value, n = Number(byId('hcUnitNumber').value), l = Number(byId('hcLessonNumber').value);
      if (!Number.isInteger(n) || n < 1 || n > 999 || !Number.isInteger(l) || l < 1 || l > 999) throw new Error('단원과 차시 번호는 1~999 사이의 정수로 입력해 주세요.');
      const title = byId('hcTitle').value.trim().replace(/^\d+차시\s*[—–\-.:]?\s*/, ''); if (!title) throw new Error('차시 제목을 입력해 주세요.');
      let unitTitle = byId('hcUnitTitle').value.trim(); if (!unitTitle) throw new Error('새 단원의 이름을 입력해 주세요.');
      if (!/^(?:\d+단원(?:[.\s]|$)|Unit\s+\d+)/i.test(unitTitle)) unitTitle = `${n}단원. ${unitTitle}`;
      const evaluation = kind === 'assessment' || kind === 'answer';
      const payload = {kind, unit_id: editing?.unit_id || `unit${n}${evaluation ? '_eval' : ''}`, unit_title: unitTitle,
        lesson_id: editing?.lesson_id || `u${n}${evaluation ? 'e' : ''}_l${l}`, title: `${l}차시 — ${title}`, description: byId('hcDescription').value.trim(), published: false, student_access: false};
      if (state.items.some(item => item.id !== editing?.id && item.kind === kind && item.unit_id === payload.unit_id && item.lesson_id === payload.lesson_id)) throw new Error('같은 단원·차시에 이 종류의 자료가 이미 있습니다. 기존 자료에서 정보·파일 수정을 선택하거나 다른 차시 번호를 입력해 주세요.');
      const file = byId('hcFile').files[0];
      if (file) Object.assign(payload, await filePayload(file, kind));
      else if (editing) {
        payload.format = editing.format;
        if (editing.format === 'html') { const existing = await client.request('get_content', {id: editing.id}); if (!current()) return; payload.content = existing.content; }
      } else throw new Error('등록할 HTML 또는 PDF 파일을 선택해 주세요.');
      if (!current()) return;
      if (editing) { payload.id = editing.id; payload.expected_version = editing.version; }
      else { state.newId ||= crypto.randomUUID(); payload.id = state.newId; payload.expected_version = 0; }
      showMessage('교사 전용으로 저장하고 있습니다…'); await client.request('save_content', payload); if (!current()) return;
      resetForm(); const ok = await refresh(); showMessage(ok ? '교사 전용으로 저장했습니다. 목록에서 미리보기를 확인한 뒤 학생 공개를 선택하세요.' : '저장은 완료됐습니다. 목록 새로고침 후 확인해 주세요.', !ok);
    } catch (error) { if (who === identity()) showMessage(error.code === 'CONTENT_IDENTITY_CONFLICT' ? '이 단원·차시의 자료가 이미 등록되어 있습니다. 목록을 새로고침한 뒤 기존 자료를 수정하세요.' : error.message, true); }
    finally { if (who === identity()) { state.busy = false; byId('hcSave').disabled = false; renderList(); } }
  }
  async function openManager() {
    if (!canManage()) return false;
    const dialog = byId('hcManager'); if (!dialog.open) dialog.showModal(); syncAdminUi(); return true;
  }
  function updateRenameTitle() {
    const select = byId('hcRenameUnit'), input = byId('hcRenameTitle'); if (!select || !input) return;
    input.value = select.value ? latestTitle(state.items, select.value, baseline[select.value]?.title) : '';
    byId('hcRenameSave').disabled = !select.value || state.busy;
  }
  async function renameUnit(event) {
    event.preventDefault(); if (!canManage() || state.busy) return;
    const unitId = byId('hcRenameUnit').value, newTitle = byId('hcRenameTitle').value.trim();
    const expected = latestTitle(state.items, unitId, baseline[unitId]?.title);
    if (!unitPattern.test(unitId) || !newTitle || newTitle === expected) return;
    const who = identity(); state.busy = true; byId('hcRenameSave').disabled = true;
    try {
      await client.request('rename_unit', {unit_id: unitId, unit_title: newTitle, expected_title: expected});
      if (who !== identity() || !canManage()) return;
      resetForm(); await refresh(); showMessage('단원 이름을 변경했습니다. 같은 단원의 수업·학습지에 함께 반영됩니다.');
    } catch (error) { if (who === identity()) showMessage(error.message, true); }
    finally { if (who === identity()) { state.busy = false; updateRenameTitle(); renderList(); } }
  }
  function init() {
    if (!client || byId('hcManager')) return;
    const host = document.querySelector('#adminModeBanner .admin-banner-actions');
    const tab = button('📚 자료 관리', openManager); tab.id = 'hcAdminTab'; tab.className = 'hc-admin-tab'; tab.hidden = true; tab.setAttribute('aria-haspopup', 'dialog'); tab.setAttribute('aria-controls', 'hcManager');
    const appearance = button('🎨 단원 꾸미기', () => openUnitAppearance()); appearance.id = 'hcAppearanceTab'; appearance.className = 'hc-admin-tab'; appearance.hidden = true; appearance.setAttribute('aria-haspopup', 'dialog');
    if (host) { host.insertBefore(tab, byId('adminToolsBtn')); host.insertBefore(appearance, byId('adminToolsBtn')); }
    const status = el('p', 'hc-public-status'); status.id = 'hcPublicStatus'; status.setAttribute('role', 'status'); byId('regularUnitGrid')?.before(status);
    const dialog = el('dialog', 'hc-dialog'); dialog.id = 'hcManager'; dialog.setAttribute('aria-labelledby', 'hcTitleLabel');
    dialog.innerHTML = `<header class="hc-dialog-header"><div><h2 id="hcTitleLabel">자료 관리</h2><p>HTML을 올리고 단원·차시를 정하면 배너와 카드에 연결됩니다.</p><p id="hcCatalogStatus" role="status"></p></div><button type="button" class="hc-button" id="hcClose">닫기</button></header>
      <div class="hc-tabs" role="group" aria-label="자료 목록"><button type="button" class="hc-button" id="hcActiveTab" aria-pressed="true">사용 중</button><button type="button" class="hc-button" id="hcArchiveTab" aria-pressed="false">보관함</button></div>
      <form id="hcForm" class="hc-form"><label>자료 종류<select id="hcKind"><option value="lesson">수업 HTML</option><option value="worksheet">학습지 PDF</option><option value="assessment">수행평가</option><option value="answer">교사용 답안</option></select></label><label>단원<select id="hcUnit"></select></label>
      <div id="hcNewUnitFields" class="hc-wide hc-new-unit" hidden><label>새 단원 번호<input id="hcUnitNumber" type="number" min="1" max="999" value="8" required></label><label>새 단원 이름<input id="hcUnitTitle" maxlength="120" placeholder="별과 우주" required></label></div>
      <label>차시 번호<input id="hcLessonNumber" type="number" min="1" max="999" value="1" required></label><label>차시 제목<input id="hcTitle" maxlength="140" required placeholder="별까지의 거리"></label>
      <label class="hc-wide">카드 설명<textarea id="hcDescription" rows="2" maxlength="2000" placeholder="이 수업에서 어떤 활동을 하는지 적어 주세요."></textarea></label>
      <label class="hc-wide">파일 선택<input id="hcFile" type="file" accept=".html,.htm" required></label><p class="hc-wide hc-help" id="hcKindHint"></p>
      <div class="hc-wide hc-actions"><button type="submit" id="hcSave" class="hc-button hc-primary">교사 전용 초안으로 등록</button><button type="button" id="hcCancelEdit" class="hc-button" hidden>수정 취소</button></div></form>
      <details class="hc-unit-settings"><summary>단원 이름 변경</summary><form id="hcRenameForm" class="hc-rename-form"><label>단원<select id="hcRenameUnit"></select></label><label>단원 이름<input id="hcRenameTitle" maxlength="120" required></label><button type="submit" id="hcRenameSave" class="hc-button">단원 이름 저장</button></form></details>
      <p id="hcMessage" class="hc-message" role="status" aria-live="polite"></p><div class="hc-list-toolbar"><label>목록 종류<select id="hcFilter"><option value="all">전체 자료</option><option value="lesson">수업 HTML</option><option value="worksheet">학습지 PDF</option><option value="assessment">수행평가</option><option value="answer">교사용 답안</option></select></label><button type="button" id="hcRefresh" class="hc-button">목록 새로고침</button></div><div id="hcItems" class="hc-items"></div>`;
    document.body.append(dialog);
    byId('hcClose').addEventListener('click', () => dialog.close()); dialog.addEventListener('close', syncAdminUi);
    byId('hcActiveTab').addEventListener('click', () => selectView('active')); byId('hcArchiveTab').addEventListener('click', () => selectView('archived'));
    byId('hcRefresh').addEventListener('click', () => state.view === 'archived' ? refreshArchive() : refresh()); byId('hcFilter').addEventListener('change', renderList);
    byId('hcKind').addEventListener('change', () => { updateHint(); unitChanged(); }); byId('hcUnit').addEventListener('change', () => unitChanged());
    byId('hcCancelEdit').addEventListener('click', resetForm); byId('hcForm').addEventListener('submit', save);
    byId('hcRenameUnit').addEventListener('change', updateRenameTitle); byId('hcRenameForm').addEventListener('submit', renameUnit);
    window.ScienceUnitAppearance?.configure({getUnits: appearanceUnits, canManage, onSaved: refresh});
    resetForm(); syncCurriculum(); refresh();
    window.addEventListener('online', locksChanged); window.addEventListener('science-content-changed', locksChanged); window.addEventListener('storage', authChanged); window.addEventListener('focus', authChanged);
  }
  window.ScienceHtmlCatalogModel = Object.freeze({checkedItems, contentUrl, buildSnapshot});
  window.ScienceContentManager = Object.freeze({authChanged, locksChanged, refresh, canManage, openManager, openUnitAppearance});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true}); else init();
})();
