/* Teacher source data → shared lesson engine. Imported HTML/JS never runs here. */
(() => {
  'use strict';
  const MAX_INPUT = 8 * 1024 * 1024, MAX_TOTAL = 12 * 1024 * 1024, MAX_ENTRY = 2 * 1024 * 1024, MAX_ENTRIES = 256;
  const utf8 = new TextDecoder('utf-8', {fatal: true});
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const object = o => !!o && typeof o === 'object' && !Array.isArray(o);
  const fail = message => { throw new Error(message); };
  function path(value) {
    if (typeof value !== 'string' || !value || value.length > 240 || /[\\:\x00-\x1f]/.test(value) || value.startsWith('/') || value.split('/').some(s => !s || s === '.' || s === '..' || ['__proto__', 'prototype', 'constructor'].includes(s))) fail('파일 경로가 올바르지 않습니다. 상위 폴더·절대 경로는 사용할 수 없습니다.');
    return value;
  }
  function text(value, label, max = 10000, empty = false) {
    if (typeof value !== 'string' || value.includes('\0') || value.length > max || (!empty && !value.trim())) fail(label + ' 형식을 확인해 주세요.');
    return value;
  }
  function id(value, label = 'ID') { if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) fail(label + '는 영문자로 시작하는 영문·숫자·밑줄 형식이어야 합니다.'); return value; }
  function json(value, label) { try { return JSON.parse(value); } catch (_) { fail(label + '의 JSON 문법을 확인해 주세요.'); } }
  function validateFiles(files) {
    if (!object(files) || Object.keys(files).length > MAX_ENTRIES) fail('파일 목록은 최대 256개까지 지원합니다.');
    let size = 0;
    for (const [name, value] of Object.entries(files)) { path(name); text(value, name, MAX_ENTRY, true); const bytes = new TextEncoder().encode(value).length; if (bytes > MAX_ENTRY || (size += bytes) > MAX_TOTAL) fail('압축을 푼 자료의 크기가 제한을 초과했습니다. 파일당 2MB, 전체 12MB까지 지원합니다.'); }
    return files;
  }
  function convertSource(manifest, files) {
    validateFiles(files);
    if (!object(manifest) || manifest.schema !== 'science-lesson-source/v1' || manifest.kind !== 'lesson' || manifest.profile !== 'four-stage-inquiry' || manifest.requiredEngineContract !== 'science-common/parity-1') fail('공통 수업 자료 형식(science-lesson-source/v1)을 선택해 주세요. 기존 소단원 HTML 파일은 먼저 학습 내용 형식으로 변환해야 합니다.');
    const lessonId = id(manifest.lessonId, '수업 ID');
    const read = name => { path(name); if (!own(files, name)) fail('필수 파일이 없습니다: ' + name); return files[name]; };
    const meta = manifest.metadata;
    if (!object(meta)) fail('수업 기본 정보(metadata)가 없습니다.');
    const unit = id(meta.unitKey, '단원 ID');
    const title = text(meta.lessonName || meta.pageTitle, '수업 제목', 160);
    if (!Array.isArray(manifest.stages) || manifest.stages.length !== 3) fail('학습 본문은 step1, step2, step3의 세 단계로 작성해 주세요. 형성평가는 공통 화면에서 네 번째 단계로 구성합니다.');
    const steps = manifest.stages.map((s, i) => { if (!object(s) || s.id !== 'step' + (i + 1)) fail('단계 ID는 step1, step2, step3 순서여야 합니다.'); return {id: s.id, title: text(s.title, '단계 제목', 200), html: text(read(s.htmlFile), '단계 본문', 400000, true)}; });
    if (manifest.quiz?.stageId !== 'step4') fail('형성평가 단계 ID는 step4여야 합니다.');
    const publicQuiz = json(read(manifest.quiz.file), '공개 문항');
    const privateQuiz = json(read(manifest.teacher?.file), '교사용 정답');
    if (manifest.teacher?.visibility !== 'teacher-only' || publicQuiz.schema !== 'science-quiz-content/v1' || privateQuiz.schema !== 'science-quiz-teacher/v1' || publicQuiz.lessonId !== lessonId || privateQuiz.lessonId !== lessonId || publicQuiz.instructionsProfile !== 'first-choice-feedback-submit-review') fail('공개 문항과 교사용 정답의 형식·수업 ID를 확인해 주세요.');
    if (!Array.isArray(publicQuiz.questions) || publicQuiz.questions.length < 1 || publicQuiz.questions.length > 5 || !Array.isArray(privateQuiz.answers) || privateQuiz.answers.length !== publicQuiz.questions.length) fail('형성평가는 1~5문항이며 교사용 정답 수와 같아야 합니다.');
    const questionIds = new Set();
    const quiz = publicQuiz.questions.map((q, i) => {
      if (!object(q)) fail('문항 형식을 확인해 주세요.');
      const qid = id(q.id, '문항 ID'); if (questionIds.has(qid) || qid !== 'q' + (i + 1)) fail('문항 ID는 q1, q2 순서로 작성해 주세요.'); questionIds.add(qid);
      if (Object.keys(q).some(k => !['id','promptHtml','contextHtml','choices','review'].includes(k))) fail('공개 문항에는 문제·보기·선택지·복습 연결만 넣어 주세요. 정답과 피드백은 교사용 파일에 분리해 주세요.');
      if (!Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 6) fail(`문항 ${i + 1}은 선택지 2~6개가 필요합니다.`);
      const ids = new Set(); const choices = q.choices.map((c, n) => { const cid = id(c?.id, '선택지 ID'); if (ids.has(cid) || cid !== qid + '-c' + (n + 1) || Object.keys(c).some(k => !['id','html'].includes(k))) fail('선택지 ID는 q1-c1, q1-c2처럼 문항과 순서에 맞춰 주세요.'); ids.add(cid); return {id: cid, html: text(c.html, '선택지', 4000)}; });
      if (!object(q.review) || !steps.some(s => s.id === q.review.stepId)) fail('문항의 복습 연결은 step1~step3 중 하나여야 합니다.');
      return {id: qid, promptHtml: text(q.promptHtml, '문제', 10000), contextHtml: text(q.contextHtml ?? '', '보기', 10000, true), choices, review: {stepId: q.review.stepId, label: text(q.review.label, '복습 연결 이름', 200)}};
    });
    const answerIds = new Set();
    for (const answer of privateQuiz.answers) { if (!object(answer) || answerIds.has(answer.questionId) || !questionIds.has(answer.questionId)) fail('교사용 정답의 문항 ID가 중복되었거나 공개 문항과 다릅니다.'); answerIds.add(answer.questionId); }
    const quiz_data = quiz.map(q => {
      const answer = privateQuiz.answers.find(a => a.questionId === q.id); const correct = q.choices.findIndex(c => c.id === answer.correctChoiceId) + 1;
      if (!correct) fail('교사용 정답이 공개 선택지와 일치하지 않습니다: ' + q.id);
      const wrongReasons = {};
      if (!object(answer.wrongReasons)) fail('선택지별 오답 피드백이 필요합니다: ' + q.id);
      for (const [key, value] of Object.entries(answer.wrongReasons)) { if (!q.choices.some(c => c.id === key)) fail('오답 피드백의 선택지 ID를 확인해 주세요.'); wrongReasons[key] = text(value, '선택지별 피드백', 10000, true); }
      for (const choice of q.choices) if (choice.id !== answer.correctChoiceId && !wrongReasons[choice.id]?.trim()) fail('오답 선택지의 피드백이 없습니다: ' + choice.id);
      const explanationHtml = text(answer.explanationHtml, '상세 해설', 10000);
      return {questionId: q.id, correct, choices: q.choices.length, explanation: explanationHtml, correctTitleHtml: text(answer.correctTitleHtml, '정답 피드백 제목', 10000), explanationHtml, wrongHintHtml: text(answer.wrongHintHtml, '오답 힌트', 10000), wrongReasons};
    });
    if (manifest.experiment?.hostContract !== 'science-experiment-content/v1') fail('실험 연결 형식을 확인해 주세요.');
    const deps = json(read(manifest.experiment.dependenciesFile), '실험 연결 정보');
    if (deps.contract !== 'science-experiment-content/v1' || !Array.isArray(deps.externalLibraries) || deps.externalLibraries.length || (deps.network && deps.network !== 'none') || (deps.accountAccess && deps.accountAccess !== 'none') || (deps.gradeSubmission && deps.gradeSubmission !== 'none')) fail('실험은 외부 라이브러리·네트워크·계정·직접 제출에 접근할 수 없습니다. 공통 엔진의 실험 연결 규격을 사용해 주세요.');
    const rawWidth = meta.sourceContainerMaxWidths?.[0] ?? '1050px'; const width = typeof rawWidth === 'number' ? rawWidth : Number(String(rawWidth).replace(/px$/, ''));
    if (!Number.isInteger(width) || width < 700 || width > 1400) fail('본문 최대 너비는 700~1400px로 지정해 주세요.');
    const content = {schema: 'science-lesson/v3', title: text(meta.pageTitle || title, '페이지 제목', 300), display: {titleHtml: text(meta.titleHtml || title, '화면 제목', 10000), headerTag: text(meta.headerTag ?? '', '상단 분류', 10000, true), subtitleHtml: text(meta.subtitleHtml ?? '', '부제목', 10000, true), footerHtml: text(meta.footerHtml ?? '', '하단 문구', 10000, true), contentMaxWidth: width, tabs: [...steps.map(s => s.title), text(manifest.quiz.tabTitle || publicQuiz.title || '형성평가', '형성평가 탭 이름', 200)]}, steps, quiz, simulation: {html: '', css: text(read(manifest.experiment.styleFile), '실험 CSS', 900000, true), js: text(read(manifest.experiment.scriptFile), '실험 JavaScript', 900000, true), dependencies: [], hostContract: 'science-experiment-content/v1', microphone: (deps.outgoingEvents || []).includes('science-microphone-request')}};
    if (new TextEncoder().encode(JSON.stringify(content)).length > MAX_ENTRY) fail('한 차시의 공개 수업 내용은 2MB 이내여야 합니다.');
    const warnings = [];
    if (manifest.attachments?.sourceWorksheetReference) warnings.push('기존 학습지 경로는 새 파일 업로드가 아닙니다. 학습지가 필요하면 자료 관리에서 PDF를 올리고 이 수업 ID에 연결하세요.');
    if (manifest.attachments?.worksheets?.length) warnings.push('첨부 학습지는 이 가져오기에서 자동 등록되지 않습니다. 자료 관리의 학습지 업로드에서 별도로 등록하세요.');
    if (privateQuiz.sourceNotes?.length) warnings.push('원본 정답 자료의 참고 사항 ' + privateQuiz.sourceNotes.length + '건이 있습니다. 교사용 원본 파일에서 확인해 주세요.');
    return {metadata: {title, unit_id: unit, unit_title: String(meta.unitTitle || meta.headerTag || unit).slice(0, 200), lesson_id: lessonId, description: String(meta.description || '').slice(0, 2000)}, content, quiz_data, warnings};
  }
  const crcTable = Array.from({length: 256}, (_, n) => { for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0); return n >>> 0; });
  function crc32(bytes) { let n = 0xffffffff; for (const b of bytes) n = (n >>> 8) ^ crcTable[(n ^ b) & 255]; return (n ^ 0xffffffff) >>> 0; }
  async function unzip(buffer) {
    const bytes = new Uint8Array(buffer); if (bytes.length < 22 || bytes.length > MAX_INPUT) fail('ZIP 파일은 8MB 이내여야 합니다.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), u16 = p => view.getUint16(p, true), u32 = p => view.getUint32(p, true);
    let end = -1; for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === bytes.length) { end = p; break; }
    if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) fail('분할·손상된 ZIP은 지원하지 않습니다.');
    const count = u16(end + 10), centralSize = u32(end + 12), centralOffset = u32(end + 16);
    if (!count || count > MAX_ENTRIES || centralOffset + centralSize !== end) fail('ZIP 파일 목록을 확인해 주세요. 최대 256개 파일과 일반 ZIP 형식만 지원합니다.');
    const files = Object.create(null), names = new Set(); let p = centralOffset, total = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > end || u32(p) !== 0x02014b50) fail('ZIP 파일 목록이 손상되었습니다.');
      const flags = u16(p + 8), method = u16(p + 10), crc = u32(p + 16), packed = u32(p + 20), size = u32(p + 24), nameLen = u16(p + 28), extraLen = u16(p + 30), commentLen = u16(p + 32), local = u32(p + 42);
      if (p + 46 + nameLen + extraLen + commentLen > end || flags & 1 || ![0, 8].includes(method) || u16(p + 34) || packed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) fail('암호화·ZIP64·지원하지 않는 압축 형식입니다. 일반 ZIP 또는 단일 JSON으로 준비해 주세요.');
      const rawName = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen)), directory = rawName.endsWith('/'), name = path(directory ? rawName.slice(0, -1) : rawName);
      if (names.has(name)) fail('ZIP에 같은 파일 경로가 두 번 있습니다.'); names.add(name);
      // Symlinks are not followed or imported.
      if (((u32(p + 38) >>> 16) & 0xf000) === 0xa000) fail('ZIP의 심볼릭 링크는 지원하지 않습니다.');
      if (size > MAX_ENTRY || (total += size) > MAX_TOTAL) fail('압축 해제 용량이 제한을 초과했습니다. 파일당 2MB, 전체 12MB까지 지원합니다.');
      if (local + 30 > centralOffset || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) fail('ZIP 파일 헤더가 손상되었습니다.');
      const start = local + 30 + u16(local + 26) + u16(local + 28);
      if (start + packed > centralOffset || utf8.decode(bytes.subarray(local + 30, local + 30 + u16(local + 26))) !== rawName) fail('ZIP 파일 경로 또는 데이터가 손상되었습니다.');
      let data = bytes.subarray(start, start + packed);
      if (method === 8) {
        let stream; try { stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')); } catch (_) { fail('이 브라우저는 ZIP 압축 해제를 지원하지 않습니다. 최신 Chrome·Edge를 사용하거나 단일 JSON 파일을 선택해 주세요.'); }
        const reader = stream.getReader(), chunks = []; let length = 0;
        try { while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > size || length > MAX_ENTRY) { await reader.cancel(); fail('ZIP의 실제 압축 해제 크기가 올바르지 않습니다.'); } chunks.push(part.value); } } catch (error) { fail('ZIP 압축을 풀지 못했습니다. 파일을 다시 준비해 주세요. ' + error.message); }
        data = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
      }
      if (data.length !== size || crc32(data) !== crc) fail('ZIP 파일 검증값이 일치하지 않습니다. 파일을 다시 준비해 주세요.');
      if (!directory) { try { files[name] = utf8.decode(data); } catch (_) { if (/\.(json|html?|js|css)$/i.test(name)) fail('수업 파일은 UTF-8 텍스트여야 합니다: ' + name); } }
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (p !== end) fail('ZIP 파일 목록 길이가 일치하지 않습니다.');
    return files;
  }
  function sourcesFromFiles(files) {
    const candidates = Object.keys(files).filter(name => /(^|\/)lesson\.json$/.test(name));
    if (!candidates.length) fail('ZIP에 lesson.json이 없습니다. 기존 HTML 모음은 학습 내용 형식으로 먼저 변환해 주세요.');
    return candidates.map(name => { const prefix = name.slice(0, -'lesson.json'.length), local = Object.create(null); for (const [key, value] of Object.entries(files)) if (key.startsWith(prefix) && key !== name) local[key.slice(prefix.length)] = value; return {name, manifest: json(files[name], name), files: local}; });
  }
  async function parseFile(file) {
    if (!file || file.size > MAX_INPUT) fail('가져올 파일은 8MB 이내의 수업 ZIP 또는 JSON이어야 합니다.');
    if (/\.zip$/i.test(file.name)) return sourcesFromFiles(await unzip(await file.arrayBuffer()));
    if (!/\.json$/i.test(file.name)) fail('수업 ZIP 또는 단일 JSON 파일을 선택해 주세요. PDF는 자료 관리의 학습지 업로드에서 등록합니다.');
    const pack = json(await file.text(), '가져오기 파일');
    if (pack.schema !== 'science-lesson-import/v1' || !object(pack.manifest)) fail('단일 JSON은 science-lesson-import/v1 형식이어야 하며 manifest와 files를 포함해야 합니다.');
    validateFiles(pack.files); return [{name: file.name, manifest: pack.manifest, files: pack.files}];
  }
  function blankTemplate() {
    const lessonId = 'new_lesson', titles = ['1단계: 개념 학습', '2단계: 탐구 활동', '3단계: 적용과 정리'];
    return {schema: 'science-lesson-import/v1', manifest: {schema: 'science-lesson-source/v1', kind: 'lesson', lessonId, profile: 'four-stage-inquiry', requiredEngineContract: 'science-common/parity-1', metadata: {unitKey: 'unit3', unitTitle: '단원 이름을 입력하세요', lessonName: '새 수업 제목', pageTitle: '새 수업 제목', titleHtml: '새 수업 제목', headerTag: '', subtitleHtml: '', footerHtml: '', sourceContainerMaxWidths: ['1000px']}, stages: titles.map((title, i) => ({id: 'step' + (i + 1), title, htmlFile: 'stages/step' + (i + 1) + '.html'})), quiz: {stageId: 'step4', tabTitle: '4단계: 형성평가', file: 'quiz.public.json'}, experiment: {scriptFile: 'experiment/experiment.js', styleFile: 'experiment/experiment.css', dependenciesFile: 'experiment/dependencies.json', hostContract: 'science-experiment-content/v1'}, teacher: {file: 'teacher/quiz.private.json', visibility: 'teacher-only'}, attachments: {worksheets: []}}, files: {'stages/step1.html': '<p>개념 학습 내용을 작성하세요.</p>', 'stages/step2.html': '<p>탐구 내용을 작성하세요.</p>', 'stages/step3.html': '<p>적용과 정리 내용을 작성하세요.</p>', 'experiment/experiment.js': '', 'experiment/experiment.css': '', 'experiment/dependencies.json': JSON.stringify({contract: 'science-experiment-content/v1', externalLibraries: [], network: 'none', accountAccess: 'none', gradeSubmission: 'none', outgoingEvents: []}, null, 2), 'quiz.public.json': JSON.stringify({schema: 'science-quiz-content/v1', lessonId, instructionsProfile: 'first-choice-feedback-submit-review', title: '형성평가', questions: [{id: 'q1', promptHtml: '', contextHtml: '', choices: [1,2,3,4].map(n => ({id: 'q1-c' + n, html: ''})), review: {stepId: 'step1', label: '관련 단계 복습'}}]}, null, 2), 'teacher/quiz.private.json': JSON.stringify({schema: 'science-quiz-teacher/v1', lessonId, answers: [{questionId: 'q1', correctChoiceId: '', correctTitleHtml: '', explanationHtml: '', wrongHintHtml: '', wrongReasons: {'q1-c1': '', 'q1-c2': '', 'q1-c3': '', 'q1-c4': ''}}], sourceNotes: []}, null, 2)}};
  }
  function downloadTemplate() {
    if (!teacher()) return false;
    const url = URL.createObjectURL(new Blob([JSON.stringify(blankTemplate(), null, 2)], {type: 'application/json;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = 'science-new-lesson-blank.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return true;
  }
  let ui = null, generation = 0, sessionIdentity = '', selected = null, requestId = null, busy = false;
  const client = () => window.ScienceContentClient;
  const identity = () => JSON.stringify(client()?.auth() || {});
  const teacher = () => typeof isAdminMode !== 'undefined' && isAdminMode === true && !!client()?.auth().adminSessionToken;
  const active = g => ui?.dialog.open && g === generation && teacher() && identity() === sessionIdentity;
  const node = (tag, cls, label) => { const e = document.createElement(tag); if (cls) e.className = cls; if (label != null) e.textContent = label; return e; };
  function close() { generation++; selected = null; requestId = null; busy = false; sessionIdentity = ''; if (ui) { ui.dialog.close(); ui.form.replaceChildren(); ui.file.value = ''; ui.pick.replaceChildren(); ui.pick.onchange = null; ui.status.textContent = ''; ui.save.disabled = true; } }
  function status(message, error = false) { ui.status.textContent = message; ui.status.dataset.error = String(error); }
  function authChanged() { if (ui?.dialog.open && (!teacher() || identity() !== sessionIdentity)) close(); }
  function setBusy(value) { busy = value; ui.file.disabled = value; ui.pick.disabled = value; ui.save.disabled = value || !selected; ui.dialog.setAttribute('aria-busy', String(value)); for (const e of ui.form.querySelectorAll('input,textarea,button')) e.disabled = value; }
  function field(parent, label, value, max) { const wrap = node('label', 'sce-field'), input = node('input'); input.value = value; if (max) input.maxLength = max; wrap.append(node('span', '', label), input); parent.append(wrap); return input; }
  function selectSource(source) {
    ui.form.replaceChildren(); selected = null; requestId = crypto.randomUUID(); ui.save.disabled = true;
    try {
      const data = convertSource(source.manifest, source.files), grid = node('div', 'sce-grid');
      const title = field(grid, '자료 제목', data.metadata.title, 160), unit = field(grid, '단원 ID', data.metadata.unit_id, 64), unitTitle = field(grid, '단원 이름', data.metadata.unit_title, 200), lesson = field(grid, '수업 ID', data.metadata.lesson_id, 64);
      ui.form.append(grid, node('p', 'sce-help', `학습 ${data.content.steps.length}단계 · 형성평가 ${data.content.quiz.length}문항 · 선택지별 피드백·복습 연결 포함`));
      const list = node('ol', 'sci-stages'); for (const step of data.content.steps) list.append(node('li', '', step.title)); list.append(node('li', '', data.content.display.tabs[3])); ui.form.append(list);
      for (const warning of data.warnings) ui.form.append(node('p', 'sci-notice', warning));
      const preview = node('button', 'sce-button', '본문 모양 미리보기'); preview.type = 'button'; preview.addEventListener('click', () => {
        const target = ui.form.querySelector('.sci-preview-wrap') || node('div', 'sci-preview-wrap'); target.replaceChildren();
        const frame = node('iframe', 'sce-preview'); frame.title = '가져올 수업 본문 미리보기'; frame.setAttribute('sandbox', ''); frame.referrerPolicy = 'no-referrer';
        const css = data.content.simulation.css.replace(/<\/style/gi, '<\\/style');
        frame.srcdoc = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src data:; form-action \'none\'; base-uri \'none\'"><style>body{font:16px/1.6 system-ui;padding:20px;background:#fff;color:#17243a}section{margin:24px 0}' + css + '</style></head><body>' + data.content.steps.map(s => '<section>' + s.html + '</section>').join('') + '</body></html>';
        target.append(node('p', 'sce-help', '본문만 표시합니다. 실험·마이크는 등록 후 수업에서 확인하세요.'), frame); ui.form.append(target);
      }); ui.form.append(preview);
      selected = {data, title, unit, unitTitle, lesson}; ui.save.disabled = false; status('자료 형식 검증을 마쳤습니다. 제목과 연결 정보를 확인한 뒤 교사 전용으로 등록하세요.');
    } catch (error) { status(error.message, true); }
  }
  async function save() {
    const g = generation; if (!active(g) || busy || !selected) return;
    let payload;
    try { const s = selected; payload = {id: requestId, expected_version: 0, kind: 'lesson', format: 'lesson-pack', title: text(s.title.value.trim(), '자료 제목', 160), unit_id: id(s.unit.value.trim(), '단원 ID'), unit_title: s.unitTitle.value.trim(), lesson_id: id(s.lesson.value.trim(), '수업 ID'), description: s.data.metadata.description, content: s.data.content, quiz_data: s.data.quiz_data, published: true, student_access: false}; }
    catch (error) { status(error.message, true); return; }
    setBusy(true); status('교사 권한과 기존 수업을 확인하고 있습니다…');
    try {
      const catalog = await client().request('catalog'); if (!active(g)) return; if (catalog.role !== 'admin') throw new Error('교사 권한이 필요합니다.');
      const duplicate = (catalog.items || []).find(item => item.lesson_id === payload.lesson_id && item.kind === 'lesson');
      if (duplicate) throw new Error('이미 같은 수업 ID가 있습니다. 새 차시는 다른 수업 ID를 입력하세요. 기존 수업을 바꾸려면 자료 목록의 본문·버전 관리를 이용해 주세요.');
      status('수업과 비공개 정답을 서버에 저장하고 있습니다…');
      const response = await client().request('save_content', payload); if (!active(g)) return;
      const item = response.item; selected = null; setBusy(false); ui.form.replaceChildren(node('p', 'sci-success', '교사 전용으로 등록했습니다. 수업에서 실험과 형성평가를 확인한 뒤 자료 관리에서 학생 공개를 선택하세요.'));
      if (item) { const edit = node('button', 'sce-button', '본문·피드백 편집'); edit.type = 'button'; edit.addEventListener('click', () => { close(); window.ScienceContentEditor?.open(item); }); const link = node('a', 'sce-button', '등록한 수업 열기'); link.href = client().contentUrl(item); link.target = '_blank'; link.rel = 'noopener'; ui.form.append(edit, link); }
      status('새 수업 등록을 완료했습니다.'); window.dispatchEvent(new CustomEvent('science-content-changed')); await window.ScienceContentManager?.refresh();
    } catch (error) { if (active(g)) status(error.status === 409 ? '같은 등록 요청이 이미 저장되었거나 같은 ID가 있습니다. 자료 목록을 새로고침해 확인해 주세요.' : error.message, true); }
    finally { if (active(g)) setBusy(false); }
  }
  function init() {
    if (ui) return;
    const dialog = node('dialog', 'sce-dialog sci-dialog'); dialog.id = 'sciDialog'; dialog.setAttribute('aria-labelledby', 'sciTitle');
    const header = node('header', 'sce-header'), title = node('h2', '', '수업자료 가져오기'); title.id = 'sciTitle';
    const dismiss = node('button', 'sce-button', '닫기'); dismiss.type = 'button'; dismiss.addEventListener('click', close); header.append(title, dismiss);
    const help = node('p', 'sce-help', '학습 내용 ZIP 또는 단일 JSON을 선택하세요. 공통 화면·잠금·형성평가·포인트 기능은 자동으로 연결됩니다. 교사용 정답이 포함된 원본 파일은 학생에게 공유하지 마세요.');
    const label = node('label', 'sce-field'), file = node('input'); file.type = 'file'; file.accept = '.zip,.json,application/zip,application/json'; label.append(node('span', '', '수업 원본 파일'), file);
    const pick = node('select', 'sci-picker'); pick.setAttribute('aria-label', '가져올 차시'); pick.hidden = true;
    const statusNode = node('p', 'sce-status'); statusNode.setAttribute('role', 'status'); statusNode.setAttribute('aria-live', 'polite');
    const form = node('section', 'sce-section'), saveButton = node('button', 'sce-button sce-primary', '교사 전용으로 새 차시 등록'); saveButton.type = 'button'; saveButton.disabled = true; saveButton.addEventListener('click', save);
    dialog.append(header, help, label, pick, statusNode, form, saveButton); document.body.append(dialog); ui = {dialog, file, pick, status: statusNode, form, save: saveButton};
    file.addEventListener('change', () => loadFile(file.files[0]));
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    window.addEventListener('storage', authChanged); window.addEventListener('focus', authChanged); document.addEventListener('visibilitychange', authChanged); setInterval(authChanged, 1000);
  }
  async function loadFile(file) {
    const g = ++generation; selected = null; ui.form.replaceChildren(); ui.pick.replaceChildren(); ui.pick.hidden = true; setBusy(true); status('수업 파일을 확인하고 있습니다…');
    try { const sources = await parseFile(file); if (!active(g)) return; for (const [i, source] of sources.entries()) { const option = node('option', '', source.manifest.metadata?.lessonName || source.name); option.value = String(i); ui.pick.append(option); } ui.pick.hidden = sources.length < 2; ui.pick.onchange = () => selectSource(sources[Number(ui.pick.value)]); selectSource(sources[0]); }
    catch (error) { if (active(g)) status(error.message, true); }
    finally { if (active(g)) setBusy(false); }
  }
  async function open(file = null) {
    if (!teacher()) return false; init(); close(); sessionIdentity = identity(); const g = generation; ui.dialog.showModal(); setBusy(true); status('교사 권한을 확인하고 있습니다…');
    try { const catalog = await client().request('catalog'); if (!active(g)) return false; if (catalog.role !== 'admin') fail('교사 권한이 필요합니다.'); status('수업 원본 파일을 선택해 주세요.'); if (file) await loadFile(file); return true; }
    catch (error) { if (active(g)) status(error.message, true); return false; }
    finally { if (active(g)) setBusy(false); }
  }
  window.ScienceContentImporter = Object.freeze({open, close, authChanged, parseFile, convertSource, unzip, downloadTemplate});
})();
