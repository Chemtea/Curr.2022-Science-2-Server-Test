/* Teacher-only in-memory preview host. Lesson content never travels in URLs or browser storage. */
(() => {
  'use strict';
  const client = () => window.ScienceContentClient;
  const identity = () => JSON.stringify(client()?.auth() || {});
  const teacher = () => typeof isAdminMode !== 'undefined' && isAdminMode === true && !!client()?.auth().adminSessionToken;
  const state = {generation: 0, active: false, identity: '', payload: null, frame: null, channel: '', delivered: false, onSave: null, busy: false, focus: null, loadTimer: null};
  let ui = null;
  const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text != null) element.textContent = text; return element; };
  const active = generation => state.active && generation === state.generation && teacher() && state.identity === identity();
  function status(message, error = false) { if (ui) { ui.status.textContent = message; ui.status.dataset.error = String(error); } }
  const copy = value => JSON.parse(JSON.stringify(value));
  function pick(value, fields) { const result = {}; for (const field of fields) if (value?.[field] !== undefined) result[field] = copy(value[field]); return result; }
  function snapshot(options) {
    if (options?.content?.schema !== 'science-lesson/v3') throw new Error('전체 수업 미리보기는 공통 엔진 수업에서 사용할 수 있습니다. 기존 HTML 자료는 수업 화면에서 확인해 주세요.');
    if (!Array.isArray(options.content.steps) || !Array.isArray(options.content.quiz) || !Array.isArray(options.quiz_data)) throw new Error('미리볼 수업 내용과 교사용 정답을 확인해 주세요.');
    return {
      item: pick(options.item, ['id', 'version', 'kind', 'format', 'title', 'unit_id', 'unit_title', 'lesson_id', 'description', 'published', 'student_access', 'archived_at']),
      content: pick(options.content, ['schema', 'title', 'display', 'steps', 'quiz', 'simulation', 'originalLessonId']),
      quiz_data: options.quiz_data.map(key => pick(key, ['correct', 'choices', 'explanation', 'questionId', 'correctTitleHtml', 'explanationHtml', 'wrongHintHtml', 'wrongReasons'])),
      label: String(options.label || options.item?.title || options.content.title || '수업 미리보기').slice(0, 240)
    };
  }
  function clearFrame() {
    clearTimeout(state.loadTimer); state.loadTimer = null;
    if (state.frame) { state.frame.src = 'about:blank'; state.frame.remove(); }
    state.frame = null; state.channel = ''; state.delivered = false; ui?.stage.replaceChildren();
  }
  function close() {
    const focus = state.focus;
    state.generation++; state.active = false; state.payload = null; state.onSave = null; state.identity = ''; state.busy = false; state.focus = null;
    clearFrame();
    if (ui) { if (ui.dialog.open) ui.dialog.close(); ui.title.textContent = '수업 미리보기'; ui.save.hidden = true; ui.save.disabled = false; ui.reset.disabled = true; status(''); }
    if (focus?.isConnected !== false && typeof focus?.focus === 'function') focus.focus();
  }
  function authChanged() { if (state.active && (!teacher() || state.identity !== identity())) close(); }
  function mountFrame() {
    const generation = state.generation; if (!active(generation) || !state.payload) return false;
    clearFrame(); state.channel = crypto.randomUUID();
    const frame = node('iframe', 'scp-frame'); frame.title = state.payload.label; frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('allow', "microphone; camera 'none'; geolocation 'none'");
    const url = new URL('lesson-preview.html', window.location.href); url.searchParams.set('channel', state.channel);
    frame.src = url.href; state.frame = frame; ui.stage.append(frame); ui.reset.disabled = false;
    status('수업 화면을 불러오고 있습니다…');
    state.loadTimer = setTimeout(() => { state.loadTimer = null; if (active(generation) && state.frame === frame) status('미리보기 연결이 늦어지고 있습니다. 연결 상태를 확인한 뒤 처음부터 다시 확인을 눌러 주세요.', true); }, 25000);
    return true;
  }
  function receive(event) {
    if (!active(state.generation) || !state.frame || event.source !== state.frame.contentWindow || event.origin !== window.location.origin || event.data?.channel !== state.channel) return;
    if (event.data.type === 'science-preview-ready' && !state.delivered) {
      state.delivered = true;
      state.frame.contentWindow.postMessage({type: 'science-preview-data', channel: state.channel, payload: state.payload}, window.location.origin);
      status('본문·실험·형성평가를 차례로 확인해 보세요.');
    } else if (event.data.type === 'science-preview-loaded' && state.delivered) {
      clearTimeout(state.loadTimer); state.loadTimer = null;
      status('미리보기입니다. 학생 제출 기록과 실제 포인트는 변경되지 않습니다.');
    } else if (event.data.type === 'science-preview-error' && state.delivered) {
      clearTimeout(state.loadTimer); state.loadTimer = null;
      status('수업 미리보기를 열지 못했습니다. 편집 화면에서 자료를 확인하거나 처음부터 다시 확인해 주세요.', true);
    } else if (event.data.type === 'science-preview-dismiss' && state.delivered) {
      close();
    }
  }
  async function save() {
    const generation = state.generation;
    if (!active(generation) || state.busy || typeof state.onSave !== 'function') return;
    state.busy = true; ui.save.disabled = true;
    try {
      const catalog = await client().request('catalog'); if (!active(generation)) return;
      if (catalog.role !== 'admin') { close(); throw new Error('교사 권한이 필요합니다.'); }
      const result = await state.onSave(); if (active(generation) && result !== false) close();
    } catch (error) { if (active(generation)) status(error.message || '저장을 완료하지 못했습니다.', true); }
    finally { if (active(generation)) { state.busy = false; ui.save.disabled = false; } }
  }
  function init() {
    if (ui) return;
    const dialog = node('dialog', 'scp-dialog'); dialog.id = 'scpDialog'; dialog.setAttribute('aria-labelledby', 'scpTitle'); dialog.setAttribute('aria-describedby', 'scpDescription');
    const header = node('header', 'scp-header'), heading = node('div', 'scp-heading');
    const tag = node('span', 'scp-tag', '교사 전용 미리보기'), title = node('h2', '', '수업 미리보기'); title.id = 'scpTitle'; heading.append(tag, title);
    const back = node('button', 'scp-button scp-back', '편집으로 돌아가기'); back.type = 'button'; back.addEventListener('click', close); header.append(heading, back);
    const toolbar = node('div', 'scp-toolbar'), controls = node('div', 'scp-controls');
    const widthLabel = node('label', 'scp-width-label', '화면 너비'), width = node('select', 'scp-width'); width.setAttribute('aria-label', '미리보기 화면 너비');
    for (const [value, text] of [['desktop', '넓은 화면'], ['tablet', '태블릿 · 820px'], ['mobile', '휴대폰 · 390px']]) { const option = node('option', '', text); option.value = value; width.append(option); }
    width.addEventListener('change', () => { ui.stage.dataset.width = width.value; }); widthLabel.append(width);
    const reset = node('button', 'scp-button', '처음부터 다시 확인'); reset.type = 'button'; reset.disabled = true; reset.addEventListener('click', mountFrame);
    const saveButton = node('button', 'scp-button scp-primary', '확인한 내용 저장'); saveButton.type = 'button'; saveButton.hidden = true; saveButton.addEventListener('click', save);
    controls.append(widthLabel, reset, saveButton); const description = node('p', 'scp-description', '본문·실험·형성평가를 직접 조작할 수 있습니다. 미리보기의 답안과 점수는 저장되지 않습니다.'); description.id = 'scpDescription'; toolbar.append(controls, description);
    const statusNode = node('p', 'scp-status'); statusNode.setAttribute('role', 'status'); statusNode.setAttribute('aria-live', 'polite');
    const stage = node('div', 'scp-stage'); stage.dataset.width = 'desktop';
    dialog.append(header, toolbar, statusNode, stage); document.body.append(dialog); ui = {dialog, title, stage, status: statusNode, save: saveButton, reset, width, back};
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => { if (state.active) close(); });
    window.addEventListener('message', receive); window.addEventListener('storage', authChanged); window.addEventListener('focus', authChanged); window.addEventListener('science-auth-changed', authChanged); window.addEventListener('science-account-change', authChanged); document.addEventListener('visibilitychange', authChanged);
    new MutationObserver(authChanged).observe(document.body, {attributes: true, subtree: true, attributeFilter: ['style', 'class', 'hidden']});
    setInterval(authChanged, 1000);
  }
  async function open(options) {
    if (!teacher()) return false;
    let payload; try { payload = snapshot(options); } catch (error) { alert(error.message); return false; }
    init(); close();
    state.active = true; state.identity = identity(); state.focus = document.activeElement;
    const generation = state.generation; ui.dialog.showModal(); ui.title.textContent = payload.label; ui.width.value = 'desktop'; ui.stage.dataset.width = 'desktop'; status('교사 권한을 확인하고 있습니다…');
    try {
      const catalog = await client().request('catalog'); if (!active(generation)) return false;
      if (catalog.role !== 'admin') throw new Error('교사 권한이 필요합니다.');
      state.payload = payload; payload = null; state.onSave = typeof options.onSave === 'function' ? options.onSave : null; ui.save.hidden = !state.onSave;
      return mountFrame();
    } catch (error) { if (active(generation)) { close(); alert(error.message || '미리보기를 열지 못했습니다.'); } return false; }
  }
  function savedUrl(item) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(item?.id || ''))) return '';
    const url = new URL('lesson-preview.html', window.location.href); url.searchParams.set('id', item.id); return url.href;
  }
  async function openSaved(item) {
    if (!teacher() || !savedUrl(item)) return false;
    init(); close(); state.active = true; state.identity = identity(); state.focus = document.activeElement;
    const generation = state.generation; ui.title.textContent = String(item.title || '저장된 수업 미리보기'); ui.dialog.showModal(); status('교사용 수업 원본을 불러오고 있습니다…');
    try {
      const response = await client().request('get_editable', {id: item.id}); if (!active(generation)) return false;
      if (response.item?.id !== item.id) throw new Error('요청한 수업 원본을 확인하지 못했습니다.');
      const opened = await open({item: response.item, content: response.content, quiz_data: response.quiz_data, label: response.item.title || '저장된 수업 미리보기'});
      if (!opened && active(generation)) close(); return opened;
    } catch (error) { if (active(generation)) { close(); alert(error.message || '교사용 수업 원본을 불러오지 못했습니다.'); } return false; }
  }
  window.ScienceContentPreview = Object.freeze({open, openSaved, close, authChanged, savedUrl});
})();
