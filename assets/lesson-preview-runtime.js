/* Teacher preview transport. Private grading data stays in this window's memory.
 * Uses the shared quiz UI without calling answer, submit, points or content mutation APIs. */
(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const channel = params.get('channel'), id = params.get('id');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const embedded = window.parent !== window && uuid.test(channel || '');
  const copy = value => JSON.parse(JSON.stringify(value));
  const fingerprint = () => JSON.stringify(window.ScienceContentClient.auth());
  const owner = fingerprint();
  let pack = null, keys = [], item = null, attempt = null, label = '', active = false, disposed = false;
  let timeout = null, ownerTimer = null, settle, rejectReady;
  const ready = new Promise((resolve, reject) => {settle = resolve; rejectReady = reject;});
  function error(message, code) { const value = new Error(message); value.code = code; return value; }
  function announce(type, extra = {}) { if (embedded) window.parent.postMessage({type, channel, ...extra}, location.origin); }
  function checkOwner() {
    if (disposed || fingerprint() !== owner) { destroy(); throw error('로그인 계정이 바뀌어 미리보기를 닫았습니다. 자료 관리에서 다시 열어 주세요.', 'PREVIEW_CLOSED'); }
  }
  function accept(payload) {
    checkOwner();
    if (active) return;
    if (!payload || payload.item?.format !== 'lesson-pack' || payload.content?.schema !== 'science-lesson/v3') throw error('전체 수업 미리보기는 공통 엔진 수업(v3)을 지원합니다. 수업자료 가져오기로 변환한 뒤 열어 주세요.', 'PREVIEW_FORMAT');
    const content = payload.content, grading = payload.quiz_data;
    if (!Array.isArray(content.steps) || content.steps.length !== 3 || !Array.isArray(content.quiz) || content.quiz.length > 5 || !Array.isArray(grading) || grading.length !== content.quiz.length) throw error('학습 단계와 형성평가 정답 구성을 확인해 주세요.', 'PREVIEW_INVALID');
    for (let i = 0; i < content.quiz.length; i++) {
      const question = content.quiz[i], key = grading[i];
      if (!Array.isArray(question.choices) || question.choices.length < 2 || question.choices.length > 6 || !Number.isInteger(key?.correct) || key.correct < 1 || key.correct > question.choices.length || key.choices !== question.choices.length || key.questionId !== question.id) throw error((i + 1) + '번 문항의 선택지와 비공개 정답이 일치하지 않습니다.', 'PREVIEW_INVALID');
    }
    pack = copy(content); keys = copy(grading); item = copy(payload.item);
    item.id = item.id || 'preview-' + crypto.randomUUID(); item.version = Number.isInteger(item.version) ? item.version : 1;
    label = String(payload.label || '교사용 수업 미리보기').slice(0, 160); active = true;
    if (timeout) clearTimeout(timeout); window.removeEventListener('message', receive);
    // Do not retain the private keys in a resolved Promise or the public lesson record.
    settle({item: copy(item), content: copy(pack)});
  }
  function fail(cause) { active = false; pack = null; keys = []; item = null; attempt = null; if (timeout) clearTimeout(timeout); if (ownerTimer) clearInterval(ownerTimer); window.removeEventListener('message', receive); rejectReady(cause); announce('science-preview-error', {message: cause.message || '미리보기를 준비하지 못했습니다.'}); }
  function receive(event) {
    if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== 'science-preview-data' || event.data.channel !== channel) return;
    try { accept(event.data.payload); } catch (cause) { fail(cause); }
  }
  function feedback(question, choice, reveal = false) {
    const publicQuestion = pack.quiz[question - 1], key = keys[question - 1], correct = choice === key.correct;
    const selectedId = publicQuestion.choices[choice - 1].id;
    const value = {question, questionId: publicQuestion.id, selected: choice, selectedId, correct,
      titleHtml: correct ? key.correctTitleHtml || '정답입니다!' : '다시 생각해 보세요.',
      explanationHtml: correct || reveal ? key.explanationHtml || key.explanation || '' : '',
      explanation: correct || reveal ? key.explanation || '' : '',
      hintHtml: correct ? '' : key.wrongHintHtml || '', reasonHtml: correct ? '' : key.wrongReasons?.[selectedId] || '', review: publicQuestion.review};
    if (correct || reveal) value.correctChoice = key.correct;
    return value;
  }
  function beginAttempt() {
    if (!attempt) attempt = {id: crypto.randomUUID(), contentVersion: item.version, content: copy(pack), answers: pack.quiz.map(() => null), feedback: pack.quiz.map(() => null), submitted: false, result: null};
    return attempt;
  }
  async function request(action, payload = {}) {
    checkOwner(); if (!active) throw error('미리보기 준비가 끝나지 않았습니다.', 'PREVIEW_NOT_READY');
    if (!['begin_quiz', 'answer_quiz', 'submit_quiz', 'review_quiz'].includes(action)) throw error('미리보기에서는 이 작업을 실행하지 않습니다.', 'PREVIEW_ACTION');
    if (payload.id !== item.id || payload.version !== item.version) throw error('미리보기 수업 버전이 바뀌었습니다. 다시 열어 주세요.', 'PREVIEW_VERSION');
    const current = beginAttempt();
    if (action === 'begin_quiz') return {success: true, attempt: copy(current)};
    if (payload.attempt_id !== current.id) throw error('이 미리보기의 풀이 기록이 아닙니다.', 'PREVIEW_ATTEMPT');
    if (action === 'submit_quiz') {
      if (!current.answers.length || current.answers.some(answer => !Number.isInteger(answer))) throw error('모든 문항의 답을 선택해 주세요.', 'QUIZ_INCOMPLETE');
      if (!current.submitted) {
        current.submitted = true;
        current.result = {score: current.answers.filter((answer, index) => answer === keys[index].correct).length, total: keys.length, awardedPoints: 0, duplicate: false, preview: true};
      }
      return {success: true, attempt: copy(current)};
    }
    const q = payload.question, choice = payload.choice;
    if (!Number.isInteger(q) || q < 1 || q > pack.quiz.length || !Number.isInteger(choice) || choice < 1 || choice > pack.quiz[q - 1].choices.length) throw error('문항과 선택지를 확인해 주세요.', 'QUIZ_INVALID_ANSWERS');
    if (action === 'review_quiz') {
      if (!current.submitted) throw error('미리보기 제출을 마친 뒤 자유롭게 복습할 수 있습니다.', 'QUIZ_NOT_SUBMITTED');
      return {success: true, attempt: copy(current), feedback: feedback(q, choice, true)};
    }
    if (current.submitted) throw error('이미 제출을 연습했습니다. 복습할 답을 다시 골라 보세요.', 'QUIZ_ALREADY_SUBMITTED');
    if (Number.isInteger(current.answers[q - 1]) && current.answers[q - 1] !== choice) throw error('처음 선택한 답은 제출 전 변경할 수 없습니다.', 'QUIZ_ANSWER_LOCKED');
    current.answers[q - 1] = choice; current.feedback[q - 1] = feedback(q, choice);
    return {success: true, attempt: copy(current), feedback: copy(current.feedback[q - 1])};
  }
  function reset() {
    checkOwner(); attempt = null; window.ScienceQuiz?.reset();
    window.ScienceLessonView?.renderSnapshot(copy(pack)); window.trySwitchStep?.(1);
    decorateIdentity(); window.dispatchEvent(new Event('science-common-ready'));
  }
  function decorateIdentity() {
    for (const [id, value] of [['studentIdInput', '미리보기'], ['studentNameInput', '교사용 연습']]) {
      const input = document.getElementById(id); if (input) {input.value = value; input.readOnly = true;}
    }
    if (embedded) document.querySelectorAll('footer a').forEach(link => {if(link.dataset.sciencePreviewClose)return;link.dataset.sciencePreviewClose='1';link.textContent = '미리보기 닫기'; link.setAttribute('href', '#'); link.addEventListener('click', event => {event.preventDefault(); announce('science-preview-dismiss');});});
  }
  function bindShell() {
    checkOwner();
    document.querySelectorAll('#adminStepBar,.admin-float-btn,#adminModal,#pageLoginModal,#ctw-root,.header-login-area').forEach(node => node.remove());
    document.querySelectorAll('.step-btn').forEach(node => node.classList.remove('is-locked'));
    document.querySelectorAll('.lock-badge-icon').forEach(node => {node.textContent = '';});
    const banner = document.createElement('aside'); banner.className = 'science-preview-banner'; banner.setAttribute('aria-label', '교사용 미리보기 안내');
    const info = document.createElement('div'), title = document.createElement('strong'), description = document.createElement('p');
    title.textContent = label; description.textContent = '수업의 모든 단계를 직접 확인하세요. 답·제출은 이 화면에서만 연습하며, 학생 기록과 실제 포인트는 바뀌지 않습니다.'; info.append(title, description);
    const actions = document.createElement('div'); actions.className = 'science-preview-actions';
    if (!embedded) {
      const restart = document.createElement('button'); restart.type = 'button'; restart.textContent = '처음부터 다시 확인'; restart.addEventListener('click', reset); actions.append(restart);
      const back = document.createElement('a'); back.href = 'index.html'; back.textContent = '자료 관리로 돌아가기'; actions.append(back);
    }
    banner.append(info, actions); document.body.prepend(banner); decorateIdentity();
    window.trySwitchStep = window.switchStep = step => { if (disposed || !Number.isInteger(step) || step < 1 || step > 4) return; window.currentActiveStep = step; window.ScienceLessonNavigation.show(step); };
    window.currentActiveStep = 1; window.trySwitchStep(1);
    window.addEventListener('science-common-ready', () => announce('science-preview-loaded'), {once: true});
  }
  function destroy() {
    if (disposed) return; disposed = true; active = false; pack = null; keys = []; item = null; attempt = null;
    if (timeout) clearTimeout(timeout); if (ownerTimer) clearInterval(ownerTimer);
    window.removeEventListener('message', receive); window.dispatchEvent(new Event('science-preview-close'));
    window.ScienceQuiz?.reset(); window.SCIENCE_LESSON_RECORD = null;
    const main = document.createElement('main'); main.className = 'science-preview-expired';
    const text = document.createElement('p'); text.textContent = '미리보기가 종료되었습니다. 로그인 상태를 확인하고 자료 관리에서 다시 열어 주세요.';
    const back = document.createElement('a'); back.href = 'index.html'; back.textContent = '과학 플랫폼으로 돌아가기'; main.append(text, back); document.body.replaceChildren(main);
    rejectReady(error('미리보기가 종료되었습니다.', 'PREVIEW_CLOSED'));
  }
  window.ScienceLessonPreview = Object.freeze({ready, request, reset, destroy, bindShell, decorateIdentity, isActive: () => active && !disposed, fail});
  window.addEventListener('science-account-change', () => { if (fingerprint() !== owner) destroy(); });
  window.addEventListener('storage', () => { if (fingerprint() !== owner) destroy(); });
  window.addEventListener('focus', () => { if (fingerprint() !== owner) destroy(); });
  window.addEventListener('pagehide', destroy, {once: true});
  ownerTimer = setInterval(() => { if (fingerprint() !== owner) destroy(); }, 1000);
  if (embedded && !id) {
    window.addEventListener('message', receive); timeout = setTimeout(() => fail(error('미리보기 자료를 받지 못했습니다. 창을 닫고 다시 열어 주세요.', 'PREVIEW_TIMEOUT')), 20000); announce('science-preview-ready');
  } else if (!channel && uuid.test(id || '') && window.parent === window) {
    // This server action requires an active administrator session; never trusts a local role flag.
    window.ScienceContentClient.request('get_editable', {id}).then(data => accept({...data, label: '교사용 수업 미리보기 · 저장된 버전'})).catch(fail);
  } else fail(error('자료 관리의 수업 미리보기 버튼으로 다시 열어 주세요.', 'PREVIEW_URL'));
})();
