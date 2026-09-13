/* Teacher-only browser editor. Authentication, grading and submissions remain shared code. */
(() => {
  'use strict';
  const client = window.ScienceContentClient;
  const clone = value => JSON.parse(JSON.stringify(value));
  const state = {generation: 0, identity: '', item: null, content: null, keys: [], versions: [], busy: false, dirty: false, session: false, newId: null};
  const byId = id => document.getElementById(id);
  const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; };
  const button = (text, handler, primary = false) => { const n = el('button', 'sce-button' + (primary ? ' sce-primary' : ''), text); n.type = 'button'; n.addEventListener('click', handler); return n; };
  const identity = () => JSON.stringify(client.auth());
  const teacherMode = () => typeof isAdminMode !== 'undefined' && isAdminMode === true && !!client.auth().adminSessionToken;
  const current = generation => state.session && generation === state.generation && teacherMode() && state.identity === identity();
  function status(text, error = false) { const node = byId('sceStatus'); if (node) { node.textContent = text; node.dataset.error = String(error); } }
  function dirty() { state.dirty = true; }
  function setBusy(value) {
    state.busy = value; const n = byId('sceSave'); if (n) n.disabled = value; byId('sceDialog')?.setAttribute('aria-busy', String(value));
    for (const control of byId('sceForm')?.querySelectorAll?.('input, textarea, button') || []) control.disabled = value;
    for (const rich of byId('sceForm')?.querySelectorAll?.('.sce-rich') || []) rich.contentEditable = value ? 'false' : 'true';
  }
  function clear() {
    state.generation++; state.session = false; state.item = null; state.content = null; state.keys = []; state.versions = []; state.newId = null; state.dirty = false; state.busy = false; state.identity = '';
    refs = {}; byId('sceForm')?.replaceChildren(); byId('sceVersions')?.replaceChildren(); byId('scePreviewArea')?.replaceChildren(); status('');
  }
  function close(force = false) { if (!force && state.dirty && !confirm('아직 저장하지 않은 편집 내용이 있습니다. 닫을까요?')) return; byId('sceDialog')?.close(); clear(); }
  function authChanged() { if (state.session && (!teacherMode() || state.identity !== identity())) close(true); }
  function field(parent, label, value = '', {id, multiline = false, rows = 3, max, type = 'text'} = {}) {
    const wrap = el('label', 'sce-field'); const name = el('span', '', label); const input = el(multiline ? 'textarea' : 'input'); if (!multiline) input.type = type;
    input.value = value ?? ''; if (id) input.id = id; if (multiline) input.rows = rows; if (max) input.maxLength = max; input.addEventListener('input', dirty); wrap.append(name, input); parent.append(wrap); return input;
  }
  function section(parent, title, help) { const box = el('section', 'sce-section'); box.append(el('h3', '', title)); if (help) box.append(el('p', 'sce-help', help)); parent.append(box); return box; }
  function safeRich(html) {
    const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const allowed = new Set(['P','BR','HR','DIV','SECTION','H2','H3','H4','B','STRONG','I','EM','U','S','SUB','SUP','UL','OL','LI','BLOCKQUOTE','PRE','CODE','TABLE','THEAD','TBODY','TR','TH','TD','SPAN']);
    const denied = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','TEXTAREA','SELECT','LINK','META','BASE','SVG','MATH','TEMPLATE','IMG','VIDEO','AUDIO']);
    function copy(node) {
      if (node.nodeType === 3) return document.createTextNode(node.textContent);
      if (node.nodeType !== 1 || denied.has(node.tagName)) return document.createDocumentFragment();
      const out = allowed.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : document.createDocumentFragment();
      if (out.nodeType === 1 && ['TD','TH'].includes(node.tagName)) for (const attr of ['colspan','rowspan']) { const v = Number(node.getAttribute(attr)); if (Number.isInteger(v) && v > 0 && v <= 10) out.setAttribute(attr, String(v)); }
      for (const child of node.childNodes) out.append(copy(child)); return out;
    }
    const result = document.createDocumentFragment(); for (const child of parsed.body.childNodes) result.append(copy(child)); return result;
  }
  function htmlField(parent, title, html, richAllowed) {
    const source = field(parent, title + ' HTML', html, {multiline: true, rows: 7}); source.classList.add('sce-code');
    if (richAllowed) {
      const rich = el('div', 'sce-rich'); rich.contentEditable = 'true'; rich.setAttribute('role', 'textbox'); rich.setAttribute('aria-multiline', 'true'); rich.setAttribute('aria-label', title + ' 본문 편집'); rich.append(safeRich(html));
      const tools = el('div', 'sce-actions');
      for (const [label, command] of [['굵게', 'bold'], ['기울임', 'italic'], ['목록', 'insertUnorderedList']]) tools.append(button(label, () => { rich.focus(); document.execCommand(command); source.value = rich.innerHTML; dirty(); }));
      rich.addEventListener('input', () => { source.value = rich.innerHTML; dirty(); });
      rich.addEventListener('paste', event => { event.preventDefault(); document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') || ''); source.value = rich.innerHTML; dirty(); });
      source.addEventListener('input', () => { rich.replaceChildren(safeRich(source.value)); });
      parent.insertBefore(tools, source.parentElement); parent.insertBefore(rich, source.parentElement);
      const details = el('details', 'sce-advanced'); details.append(el('summary', '', 'HTML 직접 편집')); const sourceLabel = source.parentElement; sourceLabel.replaceWith(details); details.append(sourceLabel);
    }
    return source;
  }
  function textOnlyEditor(parent, source) {
    const details = el('details', 'sce-advanced'); details.append(el('summary', '', '문구만 편집 · HTML 구조 유지'));
    details.append(el('p', 'sce-help', '문장·제목·버튼 문구를 바꾸면 연결된 HTML 본문에 반영됩니다. 실험의 ID·버튼 연결·도형 구조는 유지됩니다. 실행 중 자동 갱신되는 숫자·문구는 실험 코드가 다시 표시할 수 있습니다.'));
    const controls = el('div'); details.append(controls); parent.append(details);
    let lastSource = null, parsed = null;
    function fill() {
      if (lastSource === source.value) return;
      parsed = new DOMParser().parseFromString(source.value, 'text/html'); lastSource = source.value; controls.replaceChildren();
      const nodes = [];
      function walk(node) {
        if (node.nodeType === 3 && node.textContent.trim()) { nodes.push(node); return; }
        if (node.nodeType === 1 && ['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT', 'TEMPLATE'].includes(node.tagName)) return;
        for (const child of node.childNodes) walk(child);
      }
      walk(parsed.body);
      if (!nodes.length) controls.append(el('p', 'sce-help', '편집할 문구가 없습니다. HTML 편집에서 본문을 추가하세요.'));
      nodes.forEach((node, index) => {
        const text = field(controls, `${index + 1}. ${node.parentElement?.tagName?.toLowerCase() || '본문'}`, node.textContent, {multiline: true, rows: node.textContent.length > 100 ? 3 : 2});
        text.addEventListener('input', () => {
          if (source.value !== lastSource) { status('HTML 원문이 변경되었습니다. 문구 목록을 다시 열어 최신 내용을 확인해 주세요.', true); return; }
          node.textContent = text.value; source.value = parsed.body.innerHTML; lastSource = source.value; dirty();
        });
      });
    }
    details.addEventListener('toggle', () => { if (details.open) fill(); });
    source.addEventListener('input', () => { if (details.open) fill(); });
    const codeDetails = el('details', 'sce-advanced'); codeDetails.append(el('summary', '', '실험 HTML 원문 편집 (고급)'));
    const sourceLabel = source.parentElement; sourceLabel.replaceWith(codeDetails); codeDetails.append(sourceLabel);
  }
  // Previews deliberately never execute imported script, including prior-version previews.
  function previewDocument(html, css = '') {
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src data: blob:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'"><style>body{font-family:system-ui,sans-serif;line-height:1.6;padding:20px;color:#17243a;background:white;overflow-wrap:anywhere}table{border-collapse:collapse}td,th{border:1px solid #b5c1d1;padding:8px}' + String(css).replace(/<\/style/gi, '<\\/style') + '</style></head><body>' + String(html) + '</body></html>';
  }
  function showPreview(content, title = '저장 전 본문 미리보기') {
    const target = byId('scePreviewArea'); target.replaceChildren(); target.append(el('h3', '', title), el('p', 'sce-help', '본문 모양만 확인합니다. 이 편집기 안에서는 실험 스크립트와 마이크를 실행하지 않습니다. 저장 후 자료 열기에서 실제 실험을 확인하세요.'));
    const frame = el('iframe', 'sce-preview'); frame.title = title; frame.setAttribute('sandbox', ''); frame.referrerPolicy = 'no-referrer';
    const escape = text => String(text || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const html = typeof content === 'string' ? content : (content?.steps || []).map((s, i) => `<section id="step${i + 1}"><h2>${escape(s.title)}</h2>${s.html || ''}</section>`).join('') + (content?.simulation?.html || '');
    frame.srcdoc = previewDocument(html, content?.simulation?.css); target.append(frame); target.hidden = false;
  }
  let refs = {};
  function render() {
    const root = byId('sceForm'); root.replaceChildren(); refs = {steps: [], quiz: [], simulation: {}};
    const item = state.item; byId('sceTitle').textContent = item ? '본문 편집 · ' + item.title : '화면에서 새 수업 작성';
    const metadata = section(root, '기본 정보', '저장하면 교사 전용의 새 버전이 됩니다. 내용을 확인한 뒤 자료 관리에서 학생 공개를 선택하세요.');
    const grid = el('div', 'sce-grid'); metadata.append(grid);
    refs.title = field(grid, '자료 제목', item?.title || '', {max: 160});
    refs.unit = field(grid, '단원 ID', item?.unit_id || 'unit3', {max: 64});
    refs.unitTitle = field(grid, '단원 이름', item?.unit_title || '', {max: 120});
    refs.lesson = field(grid, '수업 ID (선택)', item?.lesson_id || '', {max: 64});
    refs.description = field(metadata, '설명', item?.description || '', {multiline: true, max: 2000, rows: 2});
    if (item?.format === 'pdf') metadata.append(el('p', 'sce-help', 'PDF 본문 편집은 지원하지 않습니다. 제목·연결 정보는 여기서 변경하고, PDF 교체는 자료 관리의 파일 업로드를 이용하세요.'));
    else if (typeof state.content === 'string') refs.html = htmlField(section(root, '문서 본문', 'HTML 원문을 편집할 수 있습니다. 미리보기에서는 스크립트가 실행되지 않습니다.'), '문서', state.content, false);
    else if (state.content?.builtin_id) section(root, '기존 수업', '이 자료는 아직 기존 HTML을 참조합니다. 실험 이관이 끝나면 단계별 본문을 이 화면에서 편집할 수 있습니다. 현재는 기본 정보만 수정됩니다.');
    else if (state.content) {
      const pack = state.content, isV2 = pack.schema === 'science-lesson/v2';
      const steps = section(root, '단계별 수업 본문', isV2 ? '실험과 연결된 HTML의 ID·버튼 호출은 유지해 주세요. 공통 로그인·채점·제출 기능은 이 편집 대상에 포함되지 않습니다.' : '본문을 직접 입력하거나 붙여 넣으세요. 문단·목록·표를 사용할 수 있습니다.');
      (pack.steps || []).forEach((step, index) => {
        const box = el('details', 'sce-stage'); box.open = index === 0; box.append(el('summary', '', `${index + 1}단계 · ${step.title}`)); steps.append(box);
        const title = field(box, '단계 제목', step.title, {max: 200}); const html = htmlField(box, `${index + 1}단계 본문`, step.html, !isV2);
        if (isV2) textOnlyEditor(box, html);
        refs.steps.push({title, html});
        if ((pack.steps || []).length > 1) box.append(button('이 단계 삭제', () => { try { capture(); state.content.steps.splice(index, 1); dirty(); render(); } catch (error) { status(error.message, true); } }));
      });
      if ((pack.steps || []).length < 4) steps.append(button('단계 추가', () => { try { capture(); state.content.steps.push({title: '새 단계', html: '<p>내용을 입력하세요.</p>'}); dirty(); render(); } catch (error) { status(error.message, true); } }));
      const quizzes = section(root, '형성평가 문항과 교사용 정답', '정답·해설은 비공개 서버 데이터로 저장됩니다. 학생에게는 제출한 뒤 서버가 허용한 채점 결과만 전달됩니다.');
      (pack.quiz || []).forEach((q, index) => {
        const box = el('details', 'sce-stage'); box.append(el('summary', '', `문항 ${index + 1}`)); quizzes.append(box);
        const question = field(box, '문제', q.question, {multiline: true, max: 10000});
        const choices = q.choices.map((choice, ci) => field(box, `선택지 ${ci + 1}`, choice, {max: 4000}));
        const correct = field(box, '정답 선택지 번호 (1부터)', state.keys[index]?.correct || 1, {type: 'number'}); correct.min = '1'; correct.max = String(choices.length);
        const explanation = field(box, '제출 후 해설', state.keys[index]?.explanation || '', {multiline: true, max: 10000}); refs.quiz.push({question, choices, correct, explanation});
        box.append(button('문항 삭제', () => { try { capture(); state.content.quiz.splice(index, 1); state.keys.splice(index, 1); dirty(); render(); } catch (error) { status(error.message, true); } }));
        if (choices.length < 6) box.append(button('선택지 추가', () => { try { capture(); state.content.quiz[index].choices.push('새 선택지'); state.keys[index].choices++; dirty(); render(); } catch (error) { status(error.message, true); } }));
      });
      if ((pack.quiz || []).length < 5) quizzes.append(button('문항 추가', () => { try { capture(); state.content.quiz ||= []; state.content.quiz.push({question: '새 문항', choices: ['선택지 1', '선택지 2', '선택지 3', '선택지 4']}); state.keys.push({correct: 1, choices: 4, explanation: ''}); dirty(); render(); } catch (error) { status(error.message, true); } }));
      if (isV2 && pack.simulation) {
        const advanced = el('details', 'sce-advanced'); advanced.append(el('summary', '', '실험 HTML · CSS · JavaScript 편집 (고급)')); root.append(advanced);
        advanced.append(el('p', 'sce-help', '이 차시의 격리된 실험 코드만 편집합니다. 공통 로그인·잠금·채점·제출 코드는 서버와 공통 화면에서 유지됩니다.'));
        for (const [key, label] of [['html', '추가 실험 HTML'], ['css', '실험 CSS'], ['js', '실험 JavaScript']]) { refs.simulation[key] = field(advanced, label, pack.simulation[key] || '', {multiline: true, rows: 8}); refs.simulation[key].classList.add('sce-code'); }
        advanced.append(el('p', 'sce-help', '외부 라이브러리 연결은 지원하지 않습니다. 실험에 필요한 코드는 이 수업팩 안에서 관리합니다.'));
        advanced.append(el('p', 'sce-help', pack.simulation.microphone ? '이 차시는 공통 화면의 마이크 권한 요청 기능을 사용합니다.' : '이 차시는 마이크 권한을 요청하지 않습니다.'));
      }
      const raw = el('details', 'sce-advanced'); raw.append(el('summary', '', '수업팩 JSON 전체 확인 · 편집 (고급)')); root.append(raw);
      refs.raw = field(raw, '수업팩 JSON과 비공개 정답', JSON.stringify({content: pack, quiz_data: state.keys}, null, 2), {multiline: true, rows: 12}); refs.raw.classList.add('sce-code'); refs.rawDirty = false; refs.raw.addEventListener('input', () => { refs.rawDirty = true; });
      raw.append(el('p', 'sce-help', 'JSON을 직접 수정했다면 아래 버튼으로 편집 화면에 적용한 뒤 저장하세요. JSON에 포함된 실험 옵션은 그대로 유지됩니다.'));
      raw.append(button('현재 편집 내용을 JSON에 반영', () => { try { capture(); refs.raw.value = JSON.stringify({content: state.content, quiz_data: state.keys}, null, 2); status('현재 본문 편집 내용을 JSON에 반영했습니다.'); } catch (error) { status(error.message, true); } }));
      raw.append(button('수정한 JSON을 편집 화면에 적용', () => { try { const parsed = JSON.parse(refs.raw.value); validatePack(parsed.content, parsed.quiz_data); captureMetadata(); state.content = clone(parsed.content); state.keys = clone(parsed.quiz_data); dirty(); render(); status('JSON을 편집 화면에 적용했습니다. 저장 버튼을 눌러야 서버에 반영됩니다.'); } catch (error) { status(error.message, true); } }));
    }
    const actions = el('div', 'sce-actions'); root.append(actions);
    const save = button('교사 전용 새 버전으로 저장', saveCurrent, true); save.id = 'sceSave'; save.disabled = state.busy; actions.append(save);
    if (item?.format !== 'pdf') actions.append(button('본문 미리보기', () => { try { capture(); showPreview(state.content); } catch (error) { status(error.message, true); } }));
    actions.append(button('서버 최신 내용 다시 불러오기', async () => { if (!state.item) return; if (state.dirty && !confirm('저장하지 않은 내용을 버리고 서버 최신 버전을 불러올까요?')) return; await open(state.item); }));
    setBusy(state.busy);
  }
  function captureMetadata() {
    const item = state.item || {id: state.newId, version: 0, kind: 'lesson', format: 'lesson-pack'};
    state.item = {...item, title: refs.title.value.trim(), description: refs.description.value, unit_id: refs.unit.value.trim(), unit_title: refs.unitTitle.value.trim(), lesson_id: refs.lesson.value.trim() || null};
  }
  function capture() {
    if (refs.rawDirty) throw new Error('JSON을 직접 수정했습니다. 먼저 ‘수정한 JSON을 편집 화면에 적용’을 눌러 주세요.');
    captureMetadata();
    if (refs.html) state.content = refs.html.value;
    else if (state.content && !state.content.builtin_id && typeof state.content === 'object') {
      state.content.steps = refs.steps.map((r, i) => ({...state.content.steps[i], title: r.title.value, html: r.html.value}));
      state.content.quiz = refs.quiz.map((r, i) => ({...state.content.quiz?.[i], question: r.question.value, choices: r.choices.map(c => c.value)}));
      state.keys = refs.quiz.map((r, i) => ({...state.keys[i], correct: Number(r.correct.value), explanation: r.explanation.value, choices: r.choices.length}));
      if (state.content.simulation) { for (const key of ['html', 'css', 'js']) if (refs.simulation[key]) state.content.simulation[key] = refs.simulation[key].value; if (refs.dependencies) state.content.simulation.dependencies = refs.dependencies.value.split('\n').map(v => v.trim()).filter(Boolean); }
    }
  }
  function validatePack(pack, keys) {
    if (!pack || !['science-lesson/v1', 'science-lesson/v2'].includes(pack.schema)) throw new Error('지원하는 수업팩 형식이 아닙니다.');
    if (pack.builtin_id) return;
    if (!Array.isArray(pack.steps) || pack.steps.length < 1 || pack.steps.length > 4 || pack.steps.some(s => !s || typeof s.title !== 'string' || !s.title.trim() || typeof s.html !== 'string')) throw new Error('수업 단계는 제목과 본문이 있는 1~4개로 작성해 주세요.');
    const quiz = pack.quiz || [];
    if (!Array.isArray(quiz) || quiz.length > 5 || !Array.isArray(keys) || keys.length !== quiz.length) throw new Error('문항은 최대 5개이며 문항 수와 비공개 정답 수가 같아야 합니다.');
    quiz.forEach((q, i) => { const k = keys[i]; if (!q || typeof q.question !== 'string' || !q.question.trim() || !Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 6 || q.choices.some(c => typeof c !== 'string' || !c.trim()) || !k || !Number.isInteger(k.correct) || k.correct < 1 || k.correct > q.choices.length || k.choices !== q.choices.length) throw new Error(`문항 ${i + 1}의 문제·선택지·정답 번호를 확인해 주세요.`); });
    if (pack.schema === 'science-lesson/v2') { const s = pack.simulation; if (!s || ['html', 'css', 'js'].some(k => typeof s[k] !== 'string') || !Array.isArray(s.dependencies)) throw new Error('실험 HTML·CSS·JavaScript 형식을 확인해 주세요.'); if (s.dependencies.length) throw new Error('외부 라이브러리 연결은 지원하지 않습니다. dependencies는 빈 배열이어야 합니다.'); }
  }
  function buildPayload() {
    const item = state.item; if (!item?.title?.trim()) throw new Error('자료 제목을 입력해 주세요.');
    const key = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
    if (!key.test(item.unit_id) || (item.lesson_id && !key.test(item.lesson_id))) throw new Error('단원·수업 ID는 영문자로 시작하는 영문·숫자·밑줄 형식으로 입력해 주세요.');
    if (item.format === 'lesson-pack') validatePack(state.content, state.keys);
    const payload = {id: item.id || state.newId, expected_version: Number(item.version || 0), kind: item.kind, format: item.format, title: item.title, description: item.description || '', unit_id: item.unit_id, unit_title: item.unit_title || '', lesson_id: item.lesson_id || null, published: true, student_access: false};
    if (item.format !== 'pdf') { payload.content = clone(state.content); payload.quiz_data = clone(state.keys); }
    return payload;
  }
  async function changed() { window.dispatchEvent(new CustomEvent('science-content-changed')); await window.ScienceContentManager?.refresh(); }
  async function saveCurrent() {
    const generation = state.generation; if (!current(generation) || state.busy) return;
    let payload; try { capture(); payload = buildPayload(); } catch (error) { status(error.message, true); return; }
    if (state.item?.student_access && !confirm('저장하면 이 자료는 교사 전용으로 바뀝니다. 새 내용을 확인한 뒤 다시 학생 공개할까요?')) return;
    setBusy(true); status('서버에 새 버전을 저장하고 있습니다…');
    try {
      const response = await client.request('save_content', payload); if (!current(generation)) return;
      state.item = response.item || {...state.item, version: payload.expected_version + 1, published: true, student_access: false}; state.dirty = false; state.newId = null;
      status('교사 전용 새 버전을 저장했습니다. 확인 후 자료 관리에서 학생 공개를 선택하세요.');
      await changed(); if (current(generation)) { render(); await loadVersions(generation); }
    } catch (error) { if (current(generation)) handleError(error); }
    finally { if (current(generation)) setBusy(false); }
  }
  function handleError(error) {
    if (error.status === 401 || error.status === 403) { close(true); alert('교사 권한을 확인할 수 없습니다. 다시 로그인해 주세요.'); return; }
    status(error.status === 409 || error.code === 'VERSION_CONFLICT' ? '다른 작업에서 이미 저장했거나 수정한 자료입니다. 편집 내용은 유지됩니다. 서버 최신 내용을 다시 불러온 뒤 확인해 주세요.' : error.message, true);
  }
  async function loadVersions(generation = state.generation) {
    if (!state.item?.id || !state.item?.version || !current(generation)) { byId('sceVersions')?.replaceChildren(el('p', 'sce-help', '처음 저장한 뒤부터 이전 버전을 확인할 수 있습니다.')); return; }
    try {
      const response = await client.request('list_versions', {id: state.item.id}); if (!current(generation)) return;
      state.versions = response.versions || []; const target = byId('sceVersions'); target.replaceChildren(el('h3', '', '이전 내용 버전'));
      target.append(el('p', 'sce-help', '과거 버전은 내용을 확인한 뒤 교사 전용의 새 버전으로 되돌립니다. 현재 버전도 기록에 남습니다. 버전 기록 도입 전의 과거 내용은 복구할 수 없습니다.'));
      if (!state.versions.length) target.append(el('p', 'sce-help', '아직 이전 버전이 없습니다.'));
      for (const version of state.versions) {
        const row = el('div', 'sce-version'); const date = new Date(version.created_at); row.append(el('span', '', `v${version.version} · ${version.title || state.item.title} · ${Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ko-KR')}`));
        const actions = el('div', 'sce-actions'); actions.append(button('내용 확인', () => inspectVersion(version.version)), button('이 버전으로 되돌리기', () => restoreVersion(version.version))); row.append(actions); target.append(row);
      }
    } catch (error) { if (current(generation)) { if (error.status === 401 || error.status === 403) handleError(error); else byId('sceVersions').replaceChildren(el('p', 'sce-help', '버전 목록을 불러오지 못했습니다. 편집 내용을 저장한 뒤 다시 열어 주세요.')); } }
  }
  async function inspectVersion(version) {
    const generation = state.generation; if (!current(generation) || state.busy) return; setBusy(true);
    try { const response = await client.request('get_version', {id: state.item.id, version}); if (!current(generation)) return; const snapshot = response.snapshot; if (!snapshot) throw new Error('이전 내용이 없습니다.'); if (snapshot.format === 'pdf') { byId('scePreviewArea').replaceChildren(el('p', 'sce-help', `v${version} PDF · ${snapshot.title}. PDF 본문은 되돌린 뒤 자료 열기에서 확인할 수 있습니다.`)); } else showPreview(snapshot.content, `v${version} 본문 확인`); status(`v${version} 내용을 확인하고 있습니다. 아직 현재 내용은 바뀌지 않았습니다.`); }
    catch (error) { if (current(generation)) handleError(error); } finally { if (current(generation)) setBusy(false); }
  }
  async function restoreVersion(version) {
    const generation = state.generation; if (!current(generation) || state.busy) return;
    if (!confirm(`v${version}의 내용을 교사 전용 새 버전으로 되돌릴까요?${state.dirty ? ' 아직 저장하지 않은 편집 내용은 닫힙니다.' : ''} 기존 제출 기록은 유지됩니다.`)) return;
    setBusy(true); status('이전 내용을 새 버전으로 복원하고 있습니다…');
    try { const response = await client.request('restore_version', {id: state.item.id, expected_version: state.item.version, target_version: version}); if (!current(generation)) return; const item = response.item || state.item; state.dirty = false; await changed(); if (!current(generation)) return; await open(item); status('이전 내용을 교사 전용 새 버전으로 복원했습니다. 확인 후 별도로 학생 공개하세요.'); }
    catch (error) { if (current(generation)) handleError(error); } finally { if (current(generation)) setBusy(false); }
  }
  async function open(item = null) {
    if (!teacherMode()) return false;
    close(true); state.session = true; state.identity = identity(); state.newId = item?.id || crypto.randomUUID(); const generation = state.generation;
    setBusy(true); byId('sceTitle').textContent = '교사 권한과 자료를 확인하고 있습니다'; byId('sceDialog').showModal(); status('서버에서 편집 권한을 확인하고 있습니다…');
    try {
      if (item?.id) { const response = await client.request('get_editable', {id: item.id}); if (!current(generation)) return false; state.item = response.item; state.content = response.content == null ? null : clone(response.content); state.keys = clone(response.quiz_data || []); }
      else { const response = await client.request('catalog'); if (!current(generation)) return false; if (response.role !== 'admin') throw Object.assign(new Error('교사 권한이 필요합니다.'), {status: 403}); state.item = null; state.content = {schema: 'science-lesson/v1', steps: [{title: '학습 목표', html: '<h2>오늘의 학습 목표</h2><p>수업 내용을 입력하세요.</p>'}], quiz: []}; state.keys = []; }
      render(); status('본문을 편집하고 저장하면 교사 전용의 새 버전이 만들어집니다.'); await loadVersions(generation); return current(generation);
    } catch (error) { if (current(generation)) handleError(error); return false; }
    finally { if (current(generation)) setBusy(false); }
  }
  function init() {
    const dialog = el('dialog', 'sce-dialog'); dialog.id = 'sceDialog'; dialog.setAttribute('aria-labelledby', 'sceTitle');
    const header = el('header', 'sce-header'); const title = el('h2', '', '본문 편집'); title.id = 'sceTitle'; header.append(title, button('닫기', () => close()));
    const statusNode = el('p', 'sce-status'); statusNode.id = 'sceStatus'; statusNode.setAttribute('role', 'status'); statusNode.setAttribute('aria-live', 'polite');
    const form = el('div'); form.id = 'sceForm'; const versions = el('section', 'sce-section'); versions.id = 'sceVersions'; const preview = el('section', 'sce-section'); preview.id = 'scePreviewArea';
    dialog.append(header, statusNode, form, versions, preview); document.body.append(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }); dialog.addEventListener('close', () => { if (!dialog.open && state.session) clear(); });
    new MutationObserver(authChanged).observe(document.body, {attributes: true, subtree: true, attributeFilter: ['style', 'class', 'hidden']});
    window.addEventListener('storage', authChanged); window.addEventListener('focus', authChanged); document.addEventListener('visibilitychange', authChanged); setInterval(authChanged, 1000);
  }
  window.ScienceContentEditor = Object.freeze({open, close, authChanged});
  init();
})();
