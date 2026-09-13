/* Server catalog integration for the existing science index. */
(() => {
  'use strict';
  const client = window.ScienceContentClient;
  const state = {ready: false, loading: false, items: [], role: 'anonymous', error: '', filter: 'all', editing: null, preview: false, generation: 0};
  const labels = {lesson: '수업자료', worksheet: '학습지', assessment: '수행평가', answer: '교사용 답안'};
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  const byId = id => document.getElementById(id);
  const button = (text, handler, primary = false) => { const node = el('button', 'scm-button' + (primary ? ' scm-primary' : ''), text); node.type = 'button'; node.addEventListener('click', handler); return node; };
  const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const safeKey = value => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(String(value)) && !['__proto__', 'prototype', 'constructor'].includes(String(value));
  const unitKey = item => String(item.unit_id || 'unit7');
  const unitTitle = item => item.unit_title || ({unit3: '3단원. 빛과 파동', unit7: '7단원. 전기와 자기', unit3_eval: '3단원 수행평가', unit4_eval: '4단원 수행평가'}[unitKey(item)] || '추가 수업자료');
  const visibility = item => item.kind === 'answer' ? '교사 전용' : !item.published ? '임시저장' : item.student_access ? '학생 공개 · 잠금 상태 별도 확인' : '교사 전용';
  function message(text, error = false) { const node = byId('scmMessage'); if (node) { node.textContent = text; node.dataset.error = String(error); } }
  function empty(container, text) { container.appendChild(el('div', 'scm-empty', text)); }
  function loadingText() { return state.loading ? '서버 자료 목록을 확인하고 있습니다.' : state.error || '등록된 자료가 없습니다.'; }
  function syncUnits() {
    if (typeof defaultCurriculum === 'undefined') return;
    for (const item of state.items.filter(item => item.kind === 'lesson')) {
      const key = unitKey(item);
      if (!safeKey(key) || Object.prototype.hasOwnProperty.call(defaultCurriculum, key)) continue;
      defaultCurriculum[key] = {...defaultCurriculum.unit7, id: key, title: escapeHtml(unitTitle(item)), category: 'regular', isLocked: false, lessons: [], desc: '서버에 등록된 수업자료입니다.'};
    }
    for (const [key, unit] of Object.entries(defaultCurriculum)) {
      if (unit.category === 'eval') continue;
      unit.lessons = state.items.filter(item => item.kind === 'lesson' && unitKey(item) === key).map(item => ({
        id: item.lesson_id || item.id, contentId: item.id, chasi: '수업', title: escapeHtml(item.title), desc: escapeHtml(item.description),
        file: client.contentUrl(item), isLocked: false, tags: ['서버 자료']
      }));
    }
  }
  function renderAll() {
    const status = byId('scmCatalogStatus');
    if (status) { status.textContent = state.ready ? `서버에 등록된 자료 ${state.items.length}개 · ${state.role === 'admin' ? '교사 권한' : state.role === 'student' ? '학생 권한' : '공개 목록'}` : loadingText(); status.dataset.state = state.error ? 'error' : ''; }
    if (typeof renderUnitHub === 'function') renderUnitHub();
    if (typeof currentUnitKey !== 'undefined' && currentUnitKey && defaultCurriculum[currentUnitKey]) renderLessonCards(defaultCurriculum[currentUnitKey]);
    if (byId('worksheetView')?.style.display === 'block') renderWorksheetList();
    if (byId('assessmentView')?.style.display === 'block') renderAssessmentView();
    renderLibrary(); renderManageList();
  }
  async function refresh() {
    const generation = ++state.generation;
    state.loading = true; state.ready = false; state.items = []; state.error = '';
    renderAll();
    try {
      const response = await client.request('catalog');
      if (generation !== state.generation) return;
      state.items = Array.isArray(response.items) ? response.items.filter(item => item && /^[a-f0-9-]{36}$/i.test(item.id) && labels[item.kind]) : [];
      state.role = response.role || 'anonymous'; state.ready = true; syncUnits();
    } catch (error) {
      if (generation !== state.generation) return;
      state.error = error.message; state.role = 'anonymous';
    } finally {
      if (generation === state.generation) { state.loading = false; renderAll(); }
    }
  }
  let authFingerprint = '';
  function authChanged() {
    const next = JSON.stringify(client.auth());
    if (next === authFingerprint) return;
    authFingerprint = next;
    state.ready = false; state.items = []; state.role = 'anonymous';
    byId('scmManager')?.close(); resetEditor();
    // Clear an administrator's old catalog immediately when the session changes.
    renderAll();
    Promise.resolve().then(refresh);
  }
  function card(item) {
    const node = el('article', 'scm-card'); node.dataset.contentId = item.id;
    node.append(el('div', 'scm-meta', `${labels[item.kind]} · ${visibility(item)}`), el('h3', '', item.title), el('p', '', item.description || unitTitle(item)));
    const link = el('a', 'scm-button scm-primary', item.kind === 'worksheet' ? '학습지 열기' : '자료 열기'); link.href = client.contentUrl(item); node.append(link);
    if (state.role === 'admin') node.append(button('자료 설정', () => { openManager(); edit(item); }));
    return node;
  }
  function renderLessons(unit) {
    const container = byId('lessonCardContainer'); if (!container) return true;
    container.replaceChildren();
    if (!state.ready) { empty(container, loadingText()); return true; }
    const items = state.items.filter(item => item.kind === 'lesson' && unitKey(item) === unit.id);
    if (!items.length) empty(container, '공개된 수업자료가 없습니다. 교사는 자료 관리에서 새 수업을 등록할 수 있습니다.');
    items.forEach(item => container.append(card(item)));
    return true;
  }
  function renderWorksheets() {
    const container = byId('worksheetUnitListContainer'); if (!container) return true;
    container.replaceChildren();
    const batch = byId('adminWorksheetBatchBar'); if (batch) batch.style.display = 'none';
    const status = byId('worksheetStatusText'); if (status) status.textContent = '📑 서버 학습지 보관함';
    if (!state.ready) { empty(container, loadingText()); return true; }
    const worksheets = state.items.filter(item => item.kind === 'worksheet');
    if (!worksheets.length) empty(container, '공개된 학습지가 없습니다. 교사 자료 관리에서 PDF를 업로드하면 여기에 추가됩니다.');
    const groups = new Map();
    worksheets.forEach(item => { const key = unitKey(item); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); });
    for (const items of groups.values()) { const section = el('section', 'worksheet-unit-block'); section.append(el('h2', '', unitTitle(items[0]))); const grid = el('div', 'scm-grid'); items.forEach(item => grid.append(card(item))); section.append(grid); container.append(section); }
    return true;
  }
  function renderAssessments() {
    const container = byId('assessmentUnitRows'); if (!container) return true;
    container.replaceChildren();
    if (!state.ready) { empty(container, loadingText()); return true; }
    const grid = el('div', 'scm-grid');
    state.items.filter(item => item.kind === 'assessment' || item.kind === 'answer').forEach(item => grid.append(card(item)));
    if (!grid.children.length) empty(container, '지금 열 수 있는 수행평가가 없습니다. 답안은 교사 인증 후에만 제공됩니다.');
    else container.append(grid);
    return true;
  }
  function renderLibrary() {
    const target = byId('scmLibraryItems'); if (!target) return;
    target.replaceChildren();
    if (!state.ready) { empty(target, loadingText()); return; }
    const items = state.items.filter(item => state.filter === 'all' || item.kind === state.filter);
    items.forEach(item => target.append(card(item)));
    if (!items.length) empty(target, '현재 권한으로 열 수 있는 자료가 없습니다.');
  }
  function openLibrary() { byId('scmLibrary').showModal(); renderLibrary(); }
  function setEditorPreview(preview) {
    state.preview = preview;
    byId('scmForm').querySelectorAll('input,select,textarea,button').forEach(node => { node.disabled = preview && node.id !== 'scmTemplate'; });
    byId('scmSave').disabled = preview || !state.ready || state.role !== 'admin';
  }
  function openPreview() {
    resetEditor(); setEditorPreview(true); byId('scmManager').showModal();
    message('업로드 화면 미리보기입니다. 실제 저장은 자료 서버 연결 후 교사 인증을 완료하면 이용할 수 있습니다.');
    byId('scmManageItems').replaceChildren();
  }
  function openManager() {
    if (!client.auth().adminSessionToken) { alert('교사 계정으로 로그인하거나 교사용 관리자 인증을 먼저 완료해 주세요.'); return; }
    setEditorPreview(false); byId('scmManager').showModal(); message(state.ready ? '자료를 등록하면 서버 저장 후 목록에 자동으로 추가됩니다.' : loadingText(), !state.ready); renderManageList();
    if (state.role !== 'admin') refresh();
  }
  function resetEditor() {
    state.editing = null; byId('scmForm').reset(); byId('scmFile').required = true; byId('scmSave').textContent = '서버에 임시저장'; byId('scmCancelEdit').hidden = true;
    byId('scmKind').disabled = false; kindChanged();
  }
  function edit(item) {
    state.editing = item;
    byId('scmKind').value = item.kind; byId('scmKind').disabled = true;
    byId('scmTitle').value = item.title; byId('scmDescription').value = item.description || '';
    byId('scmUnit').value = item.unit_id; byId('scmUnitTitle').value = item.unit_title || '';
    byId('scmLessonId').value = item.lesson_id || ''; byId('scmFile').value = ''; byId('scmFile').required = false;
    byId('scmSave').textContent = '변경 저장'; byId('scmCancelEdit').hidden = false; kindChanged();
    message('내용을 교체하려면 새 파일을 선택하세요. 파일을 선택하지 않으면 기존 내용을 유지합니다.');
    byId('scmTitle').focus();
  }
  function kindChanged() {
    const kind = byId('scmKind').value;
    byId('scmFile').accept = kind === 'lesson' ? '.json,.html,.htm' : kind === 'worksheet' ? '.pdf' : '.pdf,.html,.htm';
    byId('scmKindHint').textContent = kind === 'answer' ? '답안은 항상 교사 전용으로 저장되며 학생 공개 버튼이 제공되지 않습니다.' : kind === 'assessment' ? '수행평가는 교사 전용으로 저장됩니다. 학생 공개 후에도 평가관·단원·활동의 서버 잠금이 모두 해제되어야 열립니다.' : kind === 'lesson' ? '수업팩 JSON은 공통 화면에서 실행됩니다. 기존 HTML은 독립된 콘텐츠로 열립니다.' : 'PDF를 올리면 학습지 보관함에 자동으로 추가됩니다.';
  }
  async function readFile(file, kind) {
    if (file.size > 10 * 1024 * 1024) throw new Error('파일은 10MB 이하로 올려 주세요.');
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'pdf') {
      if (kind === 'lesson') throw new Error('PDF는 학습지·수행평가·답안으로 등록해 주세요.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('올바른 PDF 파일이 아닙니다.');
      let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return {format: 'pdf', file_base64: btoa(binary), mime: 'application/pdf'};
    }
    if (file.size > 2 * 1024 * 1024) throw new Error('HTML·JSON 수업 파일은 2MB 이하로 올려 주세요.');
    const text = await file.text();
    if (ext === 'json' && kind === 'lesson') {
      let parsed; try { parsed = JSON.parse(text); } catch (_) { throw new Error('수업팩 JSON 문법을 확인해 주세요.'); }
      const content = parsed.content || parsed;
      if (content.schema !== 'science-lesson/v1' || !Array.isArray(content.steps) || content.steps.length < 1 || content.steps.length > 4 || content.builtin_id) throw new Error('새 수업팩에는 science-lesson/v1 형식의 steps 1~4개가 필요합니다.');
      const quiz = content.quiz || [];
      const keys = parsed.quiz_data || [];
      if (!Array.isArray(quiz) || quiz.length > 5 || !Array.isArray(keys) || keys.length !== quiz.length) throw new Error('형성평가 문항과 별도 정답 quiz_data의 개수는 같아야 합니다 (최대 5개).');
      quiz.forEach((q, i) => {
        const key = keys[i];
        if (!q || typeof q.question !== 'string' || !Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 6 || q.choices.some(v => typeof v !== 'string') || Object.keys(q).some(name => !['question','choices'].includes(name))) throw new Error('학생에게 보이는 quiz에는 question과 choices만 넣어 주세요.');
        if (!key || !Number.isInteger(key.correct) || key.correct < 1 || key.correct > q.choices.length || key.choices !== q.choices.length) throw new Error('정답 correct는 1부터 시작하는 선택 번호이며 choices는 선택지 개수입니다.');
      });
      return {format: 'lesson-pack', content, quiz_data: keys};
    }
    if (['html', 'htm'].includes(ext) && kind !== 'worksheet') return {format: 'html', content: text};
    throw new Error('선택한 자료 종류에 맞는 파일을 올려 주세요.');
  }
  async function save(event) {
    event.preventDefault();
    if (state.preview || !client.auth().adminSessionToken) { message('교사 인증이 필요합니다.', true); return; }
    if (!state.ready || state.role !== 'admin') { message('자료 서버 연결과 교사 권한 확인 후 저장할 수 있습니다.', true); return; }
    const saveButton = byId('scmSave'); saveButton.disabled = true;
    try {
      const kind = byId('scmKind').value;
      const payload = {kind, title: byId('scmTitle').value.trim(), description: byId('scmDescription').value.trim(), unit_id: byId('scmUnit').value.trim(), unit_title: byId('scmUnitTitle').value.trim(), lesson_id: byId('scmLessonId').value.trim() || null};
      if (!safeKey(payload.unit_id) || (payload.lesson_id && !safeKey(payload.lesson_id))) throw new Error('단원 ID는 unit3처럼 영문으로 시작하는 영문·숫자·밑줄·하이픈으로 입력해 주세요.');
      if (state.editing) {
        payload.id = state.editing.id; payload.expected_version = state.editing.version;
        payload.published = state.editing.published; payload.student_access = state.editing.student_access;
      } else { payload.published = false; payload.student_access = false; }
      const file = byId('scmFile').files[0];
      if (file) Object.assign(payload, await readFile(file, kind));
      else if (state.editing) {
        const current = await client.request('get_content', {id: state.editing.id});
        payload.format = current.item.format;
        if ('content' in current) payload.content = current.content;
        if (current.file_base64) { payload.file_base64 = current.file_base64; payload.mime = current.mime; }
        // get_content never returns answer keys; omitting quiz_data preserves them on metadata-only updates.
      } else throw new Error('등록할 파일을 선택해 주세요.');
      if (kind === 'answer') payload.student_access = false;
      message('서버에 저장하고 있습니다…');
      await client.request('save_content', payload);
      resetEditor(); await refresh(); message(state.ready ? '서버 저장을 완료했습니다. 목록에서 미리 확인한 뒤 학생 공개를 선택하세요.' : '저장은 완료됐지만 새 목록을 확인하지 못했습니다. 새로고침해 주세요.', !state.ready);
    } catch (error) { message(error.message, true); }
    finally { saveButton.disabled = false; }
  }
  async function publication(item) {
    const next = !(item.published && item.student_access);
    if (next && !confirm(`「${item.title}」을 학생에게 공개할까요? 서버의 단원·활동 잠금도 적용됩니다.`)) return;
    try { await client.request('set_publication', {id: item.id, expected_version: item.version, published: true, student_access: next}); await refresh(); message(next ? '학생 공개 설정을 저장했습니다. 잠긴 단원·활동은 별도 잠금 해제가 필요합니다.' : '교사 전용으로 변경했습니다.'); }
    catch (error) { message(error.message, true); }
  }
  async function archive(item) {
    if (!confirm(`「${item.title}」을 목록에서 보관 처리할까요?`)) return;
    try { await client.request('delete_content', {id: item.id, expected_version: item.version}); await refresh(); message('자료를 목록에서 보관 처리했습니다.'); }
    catch (error) { message(error.message, true); }
  }
  function linkedLocks(item) {
    if (item.kind === 'answer' || !safeKey(item.unit_id) || !safeKey(item.lesson_id)) return null;
    const details = el('details'); details.append(el('summary', 'scm-meta', '기존 단원·활동 잠금 관리'));
    const rows = [
      ['단원', [item.unit_id, 'isLocked']],
      ['활동', [item.unit_id, 'lessons', item.lesson_id]]
    ];
    if (item.kind === 'worksheet') {
      const number = String(item.unit_id).replace(/^unit/, '');
      rows.push(['학습지함 전체', ['worksheetCurriculum', 'isLocked']], ['학습지 단원', ['worksheetCurriculum', 'units', number, 'isLocked']], ['이 학습지', ['worksheetCurriculum', 'units', number, 'items', 'ws_' + item.lesson_id]]);
    }
    const help = el('p', 'scm-help', item.kind === 'assessment' ? '수행평가는 위 관리자 메뉴의 평가관도 전체 공개 상태여야 합니다. 공개 설정과 연결된 잠금이 모두 확인되어야 학생이 열 수 있습니다.' : '공개 설정과 별개로 기존 단원·활동 잠금이 적용됩니다. 열려야 할 범위를 각각 선택하세요.'); details.append(help);
    for (const [label, path] of rows) {
      const row = el('div', 'scm-row-actions'); row.style.marginTop = '7px';
      row.append(el('span', 'scm-meta', label));
      for (const locked of [false, true]) row.append(button(locked ? '잠금' : '해제', async () => {
        if (!client.auth().adminSessionToken || state.role !== 'admin') { message('교사 인증이 필요합니다.', true); return; }
        if (!locked && !confirm(label + ' 잠금을 해제할까요? 이미 학생에게 공개된 같은 범위의 자료에도 적용됩니다.')) return;
        await saveLocksToCloud([{path, value: locked}]);
        await refresh();
        message('서버 목록을 다시 확인했습니다. 개별 자료 열기로 최종 상태를 확인해 주세요.');
      }));
      details.append(row);
    }
    return details;
  }
  function renderManageList() {
    const target = byId('scmManageItems'); if (!target) return;
    target.replaceChildren();
    byId('scmSave').disabled = state.preview || !state.ready || state.role !== 'admin';
    if (state.preview) return;
    if (!state.ready) { empty(target, loadingText()); return; }
    if (state.role !== 'admin') { empty(target, '교사 권한을 확인할 수 없습니다. 관리자 인증 후 다시 열어 주세요.'); return; }
    if (!state.items.length) empty(target, '첫 자료를 업로드해 보세요.');
    for (const item of state.items) {
      const row = el('div', 'scm-manage-row'); const info = el('div'); info.append(el('strong', '', item.title), el('small', '', `${labels[item.kind]} · ${unitTitle(item)} · ${visibility(item)} · v${item.version}`));
      const lockOptions = linkedLocks(item); if (lockOptions) info.append(lockOptions);
      const actions = el('div', 'scm-row-actions');
      const view = el('a', 'scm-button', '열기'); view.href = client.contentUrl(item); actions.append(view, button('수정', () => edit(item)));
      if (item.kind !== 'answer') actions.append(button(item.published && item.student_access ? '교사 전용으로' : '학생 공개', () => publication(item)));
      actions.append(button('보관', () => archive(item))); row.append(info, actions); target.append(row);
    }
  }
  function downloadTemplate() {
    const pack = {content: {schema: 'science-lesson/v1', title: '새 수업 제목', steps: [{title: '학습 목표', html: '<h2>오늘의 학습 목표</h2><p>수업 내용을 넣어 주세요.</p>'}, {title: '개념 학습', html: '<h2>핵심 개념</h2><p>설명을 넣어 주세요.</p>'}, {title: '탐구 활동', html: '<h2>탐구해 봅시다</h2><p>활동 내용을 넣어 주세요.</p>'}, {title: '정리', html: '<p>핵심 내용을 정리해 보세요.</p>'}], quiz: [{question: '새 형성평가 문항', choices: ['선택지 1', '선택지 2', '선택지 3', '선택지 4']}]}, quiz_data: [{correct: 1, explanation: '제출 후에 보여 줄 해설', choices: 4}]};
    const url = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], {type: 'application/json'})); const a = el('a'); a.href = url; a.download = 'science-lesson-template.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function init() {
    const toolbar = el('section', 'scm-toolbar');
    const heading = el('div'); heading.append(el('strong', '', '서버 자료실'), el('p', 'scm-status', '자료 서버 연결 확인 중…')); heading.querySelector('p').id = 'scmCatalogStatus';
    const actions = el('div', 'scm-toolbar-actions'); actions.append(button('새로고침', refresh), button('전체 자료 보기', openLibrary), button('업로드 화면 미리보기', openPreview), button('교사 자료 관리', openManager, true)); toolbar.append(heading, actions);
    byId('unitHubView').prepend(toolbar);
    const dialogs = el('div');
    dialogs.innerHTML = `<dialog class="scm-dialog" id="scmLibrary" aria-labelledby="scmLibraryTitle"><div class="scm-dialog-header"><div><h2 id="scmLibraryTitle">서버 자료실</h2><p>등록된 수업·학습지·평가 자료를 현재 권한에 맞게 보여 줍니다.</p></div><button class="scm-button" type="button" data-close="scmLibrary">닫기</button></div><div class="scm-filter" id="scmFilters"></div><div class="scm-grid" id="scmLibraryItems"></div></dialog>
      <dialog class="scm-dialog" id="scmManager" aria-labelledby="scmManagerTitle"><div class="scm-dialog-header"><div><h2 id="scmManagerTitle">교사 자료 관리</h2><p>파일을 올리고 미리 확인한 뒤 공개하세요. 공통 수업 화면은 그대로 유지됩니다.</p></div><button class="scm-button" type="button" data-close="scmManager">닫기</button></div>
      <form class="scm-editor" id="scmForm"><label>자료 종류<select id="scmKind"><option value="lesson">수업자료</option><option value="worksheet">학습지 PDF</option><option value="assessment">수행평가</option><option value="answer">교사용 모범답안</option></select></label><label>자료 제목<input id="scmTitle" required maxlength="160"></label>
      <label>단원 ID<input id="scmUnit" value="unit3" required maxlength="64" list="scmUnits"><datalist id="scmUnits"><option value="unit3">3단원</option><option value="unit7">7단원</option><option value="unit3_eval">3단원 수행평가</option><option value="unit4_eval">4단원 수행평가</option></datalist></label><label>단원 이름<input id="scmUnitTitle" maxlength="120" placeholder="3단원. 빛과 파동"></label>
      <label class="scm-wide">수업 ID (선택)<input id="scmLessonId" maxlength="64" placeholder="예: u3_l1 · 기존 수업/학습지 잠금과 연결할 때 입력"></label><label class="scm-wide">설명<textarea id="scmDescription" rows="2" maxlength="2000"></textarea></label>
      <label class="scm-wide">자료 파일<input type="file" id="scmFile" required accept=".json,.html,.htm"></label><p class="scm-wide scm-help" id="scmKindHint"></p><div class="scm-wide scm-toolbar-actions"><button class="scm-button scm-primary" id="scmSave" type="submit">서버에 임시저장</button><button class="scm-button" id="scmCancelEdit" type="button" hidden>수정 취소</button><button class="scm-button" id="scmTemplate" type="button">공통 수업팩 양식 받기</button></div></form>
      <p class="scm-message" id="scmMessage" role="status" aria-live="polite"></p><div class="scm-toolbar-actions"><button class="scm-button" type="button" id="scmManagerRefresh">서버 목록 새로고침</button></div><div class="scm-manage-list" id="scmManageItems"></div></dialog>`;
    document.body.append(dialogs);
    dialogs.querySelectorAll('[data-close]').forEach(node => node.addEventListener('click', () => byId(node.dataset.close).close()));
    Object.entries({all: '전체', ...labels}).forEach(([key, label]) => { const node = button(label, () => { state.filter = key; byId('scmFilters').querySelectorAll('button').forEach(child => child.setAttribute('aria-pressed', String(child === node))); renderLibrary(); }); node.setAttribute('aria-pressed', String(key === 'all')); byId('scmFilters').append(node); });
    byId('scmForm').addEventListener('submit', save); byId('scmKind').addEventListener('change', kindChanged); byId('scmTemplate').addEventListener('click', downloadTemplate); byId('scmCancelEdit').addEventListener('click', resetEditor); byId('scmManagerRefresh').addEventListener('click', refresh);
    const adminGrid = document.querySelector('#adminToolsModal .admin-tools-grid'); if (adminGrid) adminGrid.prepend(button('📚 수업자료·학습지 업로드', () => { closeAdminToolsModal(); openManager(); }, true));
    kindChanged(); authFingerprint = JSON.stringify(client.auth()); refresh();
  }
  window.ScienceContentManager = {renderLessons, renderWorksheets, renderAssessments, authChanged, refresh, openManager, openLibrary};
  init();
  window.addEventListener('online', refresh);
})();
