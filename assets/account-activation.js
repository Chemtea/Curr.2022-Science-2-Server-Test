/* Teacher-issued, one-time first-account activation. Load after the index application script. */
(() => {
  'use strict';
  if (window.PLATFORM_CONFIG?.projectRef !== 'rerykeslgwhamreoskgx') return;
  const endpoint = `${window.PLATFORM_CONFIG.baseUrl}/functions/v1/activation-api`;
  const $ = id => document.getElementById(id);
  let adminDialog, studentDialog, adminTokenAtOpen = '';
  function auth() { return window.ScienceContentClient?.auth() || {}; }
  function teacherMode() { return typeof isAdminMode !== 'undefined' && isAdminMode === true && !!auth().adminSessionToken; }
  async function request(action, data = {}, admin = false) {
    const token = admin ? auth().adminSessionToken : '';
    if (admin && (!teacherMode() || !token)) throw new Error('교사 관리자 모드에서 이용해 주세요.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...data, action, ...(admin ? {adminSessionToken: token} : {})}),
        signal: controller.signal, credentials: 'omit', cache: 'no-store'});
      const result = await response.json();
      if (admin && (!teacherMode() || token !== auth().adminSessionToken)) throw new Error('관리자 로그인이 바뀌었습니다. 다시 열어 주세요.');
      if (!response.ok || !result.success) {
        if (admin && (response.status === 401 || response.status === 403)) adminDialog?.close();
        throw new Error(result.message || '요청을 처리하지 못했습니다.');
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('응답 확인 시간이 지났습니다. 코드 발급은 목록 확인 후 재발급하고, 활성화는 설정한 비밀번호로 먼저 로그인을 시도해 주세요.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  function dialog(id, title) {
    const node = document.createElement('dialog'); node.id = id; node.className = 'account-activation-dialog';
    node.setAttribute('aria-labelledby', id + 'Title');
    node.innerHTML = `<header><h2 id="${id}Title"></h2><button type="button" aria-label="닫기">✕</button></header><div class="activation-body"></div>`;
    node.querySelector('h2').textContent = title;
    node.querySelector('header button').onclick = () => node.close();
    document.body.append(node); return node;
  }
  function notice(target, text, error = false) { target.textContent = text; target.classList.toggle('activation-error', error); }
  function displayId(value) { return /^[1-3]0[1-9][0-9]{2}$/.test(String(value)) ? String(value)[0] + String(value).slice(2) : String(value); }
  async function refreshAdmin() {
    const status = $('activationAdminStatus'); const list = $('activationAccounts');
    notice(status, '최초 등록 대기 계정을 불러오는 중입니다.');
    const result = await request('list', {}, true);
    if (!adminDialog.open) return;
    list.replaceChildren();
    for (const account of result.items) {
      const row = document.createElement('div'); row.className = 'activation-account';
      const info = document.createElement('div');
      const label = document.createElement('strong'); label.textContent = `${account.school_year || '공통'} · ${displayId(account.login_id)} ${account.name || ''}`;
      const state = document.createElement('small'); state.textContent = account.guardian_consent_required && !account.guardian_consent_verified ? '보호자 동의 확인 필요' : account.code_expires_at ? `코드 유효: ${new Date(account.code_expires_at).toLocaleString('ko-KR')}까지` : '사용 가능한 코드 없음';
      info.append(label, state);
      const actions = document.createElement('div'); actions.className = 'activation-actions';
      for (const [action, text] of [['issue', account.code_expires_at ? '코드 재발급' : '코드 발급'], ['revoke', '코드 폐기']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
        button.disabled = (action === 'revoke' && !account.code_expires_at) || (action === 'issue' && account.guardian_consent_required && !account.guardian_consent_verified);
        button.onclick = async () => {
          if (!teacherMode()) return syncMode();
          if (action === 'revoke' && !confirm('이 계정에 발급된 미사용 코드를 폐기할까요?')) return;
          row.querySelectorAll('button').forEach(b => b.disabled = true);
          $('activationIssuedCode').replaceChildren();
          try {
            const data = await request(action, {accountId: account.id}, true);
            await refreshAdmin();
            if (!adminDialog.open) return;
            if (action === 'issue') {
              const label = document.createElement('p'); label.textContent = `${displayId(account.login_id)} ${account.name || ''} · 아래 코드는 이번 화면에서만 확인할 수 있습니다.`;
              const code = document.createElement('code'); code.textContent = data.code;
              const hint = document.createElement('p'); hint.textContent = `학생 본인에게 개별 전달하세요. 학년도 ${account.school_year || '현재 학년도'}, 로그인 ID ${account.login_id}. ${new Date(data.expires_at).toLocaleString('ko-KR')}까지 한 번 사용할 수 있습니다.`;
              const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '코드 복사';
              copy.onclick = async () => { try { await navigator.clipboard.writeText(data.code); notice(status, '코드를 복사했습니다.'); } catch { notice(status, '코드를 직접 선택하여 복사해 주세요.'); } };
              $('activationIssuedCode').append(label, code, hint, copy);
              notice(status, '코드가 발급되었습니다. 이전 미사용 코드는 폐기되었습니다.');
            } else notice(status, '미사용 코드를 폐기했습니다.');
          } catch (error) { notice(status, error.message, true); row.querySelectorAll('button').forEach(b => b.disabled = false); }
        };
        actions.append(button);
      }
      row.append(info, actions); list.append(row);
    }
    notice(status, result.items.length ? `${result.items.length}개 계정이 최초 등록 대기 중입니다.` : '최초 등록 대기 계정이 없습니다.');
  }
  async function openAdmin() {
    if (!teacherMode()) return;
    if (!adminDialog) {
      adminDialog = dialog('accountActivationAdminDialog', '계정 활성화 코드 관리');
      adminDialog.querySelector('.activation-body').innerHTML = '<p>처음 사용하는 계정은 교사가 발급한 코드로 비밀번호를 설정합니다. 코드는 24시간 동안 한 번만 사용할 수 있습니다. 가입 완료 계정의 비밀번호는 바뀌지 않습니다.</p><div id="activationIssuedCode" aria-live="polite"></div><p id="activationAdminStatus" role="status"></p><div id="activationAccounts"></div>';
      adminDialog.addEventListener('close', () => { $('activationIssuedCode').replaceChildren(); $('activationAccounts').replaceChildren(); adminTokenAtOpen = ''; });
    }
    adminTokenAtOpen = auth().adminSessionToken;
    if (!adminDialog.open) adminDialog.showModal();
    try { await refreshAdmin(); } catch (error) { notice($('activationAdminStatus'), error.message, true); }
  }
  async function openStudent() {
    if (typeof closeStudentLoginModal === 'function') closeStudentLoginModal();
    if (!studentDialog) {
      studentDialog = dialog('accountActivationStudentDialog', '처음 사용하는 계정 활성화');
      studentDialog.querySelector('.activation-body').innerHTML = `<p>교사에게 받은 활성화 코드와 새 비밀번호를 입력하세요. 기존 계정은 일반 로그인을 이용하면 됩니다.</p>
        <form id="activationStudentForm">
          <label>학년도<input id="activationYear" type="number" min="2000" max="2100" required></label>
          <label>로그인 ID / 학번<input id="activationLogin" autocomplete="username" maxlength="80" required></label>
          <label>교사가 발급한 활성화 코드<input id="activationCode" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="64" placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX" required></label>
          <label>새 비밀번호<input id="activationPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label>
          <label>새 비밀번호 확인<input id="activationPasswordConfirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label>
          <p id="activationStudentStatus" role="status"></p><button id="activationSubmit" type="submit">계정 활성화</button>
        </form>`;
      studentDialog.addEventListener('close', () => { $('activationStudentForm').reset(); $('activationStudentStatus').textContent = ''; });
      $('activationStudentForm').onsubmit = async event => {
        event.preventDefault(); const status = $('activationStudentStatus'); const password = $('activationPassword').value;
        if (password !== $('activationPasswordConfirm').value) return notice(status, '비밀번호 확인이 일치하지 않습니다.', true);
        const login = $('activationLogin').value.trim(); $('activationSubmit').disabled = true;
        notice(status, '계정을 활성화하는 중입니다.');
        try {
          await request('redeem', {studentId: login, schoolYear: Number($('activationYear').value), code: $('activationCode').value, password});
          studentDialog.close();
          if (typeof openStudentLoginModal === 'function') {
            openStudentLoginModal(); $('loginStudentId').value = login; $('loginStudentPw').focus();
          }
          alert('계정이 활성화되었습니다. 방금 설정한 비밀번호로 로그인하세요.');
        } catch (error) { notice(status, error.message, true); }
        finally { $('activationSubmit').disabled = false; }
      };
    }
    $('activationYear').value = typeof CURRENT_SCHOOL_YEAR !== 'undefined' ? CURRENT_SCHOOL_YEAR : new Date().getFullYear();
    $('activationLogin').value = $('loginStudentId')?.value || '';
    if (!studentDialog.open) studentDialog.showModal();
    $('activationLogin').focus();
  }
  function syncMode() {
    const button = $('accountActivationAdminTab');
    if (button) button.hidden = !teacherMode();
    if (adminDialog?.open && (!teacherMode() || auth().adminSessionToken !== adminTokenAtOpen)) adminDialog.close();
  }
  function init() {
    const style = document.createElement('style');
    style.textContent = `
      dialog.account-activation-dialog{position:fixed!important;inset:0!important;margin:auto!important;padding:0!important;width:min(680px,calc(100vw - 28px));height:fit-content;max-height:calc(100dvh - 32px);overflow:auto;border:2px solid #64748b!important;border-radius:18px;background:#fff;color:#0f172a;box-shadow:0 24px 90px #02061770;z-index:2147483000}
      dialog.account-activation-dialog::backdrop{background:#020617a8;backdrop-filter:blur(3px)}
      .account-activation-dialog header{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #cbd5e1;gap:12px;background:#f8fafc}
      .account-activation-dialog h2{font-size:1.2rem;margin:0;color:#0f172a}
      .account-activation-dialog .activation-body{padding:20px;line-height:1.6}
      .account-activation-dialog p{margin:0 0 14px}
      .account-activation-dialog button,#accountActivationAdminTab,#accountActivationStudentBtn{padding:9px 13px;border:1px solid #64748b;border-radius:9px;background:#e0f2fe;color:#0c4a6e;font:inherit;font-weight:700;cursor:pointer}
      .account-activation-dialog button:disabled{opacity:.55;cursor:wait}
      .account-activation-dialog label{display:grid;gap:4px;margin-bottom:12px;font-weight:700}
      .account-activation-dialog input{box-sizing:border-box;width:100%;padding:11px;border:1px solid #94a3b8;border-radius:8px;color:#0f172a;background:#fff;font:inherit}
      .activation-account{display:flex;justify-content:space-between;gap:14px;padding:14px 0;border-top:1px solid #e2e8f0;flex-wrap:wrap}
      .activation-account small{display:block;color:#475569}.activation-actions{display:flex;gap:7px;align-items:center}
      .account-activation-dialog .activation-error{color:#b91c1c;font-weight:700}
      #activationIssuedCode:not(:empty){padding:16px;border:1px solid #38bdf8;border-radius:10px;background:#f0f9ff;margin-bottom:16px}
      #activationIssuedCode code{display:block;overflow-wrap:anywhere;font-size:1.15rem;user-select:all;margin-bottom:8px;color:#075985}
      #accountActivationAdminTab[hidden]{display:none!important}#accountActivationAdminTab{margin:5px}#accountActivationStudentBtn{margin:6px 0 15px;width:100%}
    `; document.head.append(style);
    const banner = $('adminModeBanner');
    if (banner) {
      const button = document.createElement('button'); button.type = 'button'; button.id = 'accountActivationAdminTab'; button.hidden = true;
      button.textContent = '🔑 계정 활성화'; button.onclick = openAdmin; banner.append(button);
      new MutationObserver(syncMode).observe(banner, {attributes: true, attributeFilter: ['style', 'class']});
    }
    const desc = $('studentLoginDesc');
    if (desc) {
      const button = document.createElement('button'); button.type = 'button'; button.id = 'accountActivationStudentBtn';
      button.textContent = '처음 접속하나요? 계정 활성화'; button.onclick = openStudent; desc.after(button);
      const updateDescription = () => {
        const text = '학교 학생은 현재 학년도의 학번과 설정한 비밀번호로 로그인하세요. 처음 사용하는 계정은 아래 계정 활성화에서 교사에게 받은 코드를 입력하세요. 비밀번호는 8자리 이상입니다.';
        if (desc.textContent !== text) desc.textContent = text;
      };
      new MutationObserver(updateDescription).observe(desc, {childList: true, subtree: true, characterData: true}); updateDescription();
    }
    const area = $('userAuthDisplayArea');
    if (area) new MutationObserver(syncMode).observe(area, {childList: true, subtree: true});
    window.addEventListener('storage', syncMode); document.addEventListener('visibilitychange', syncMode); syncMode();
  }
  window.ScienceAccountActivation = Object.freeze({openAdmin, openStudent});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
