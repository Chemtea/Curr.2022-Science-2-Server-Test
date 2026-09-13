/* Authenticated TEST-only catalog transport for trusted teacher-authored HTML. */
(() => {
  'use strict';
  function auth() {
    const storage = window.platformSessionStorage;
    if (!storage) return {};
    let user = null;
    try { user = JSON.parse(storage.getItem('current_student') || 'null'); } catch (_) {}
    const admin = storage.getItem('current_admin_key');
    if (admin && (user?.isAdmin === true || storage.getItem('temporary_admin_mode') === '1')) {
      return {adminSessionToken: admin};
    }
    return user?.studentSessionToken ? {studentSessionToken: user.studentSessionToken} : {};
  }
  async function request(action, values = {}) {
    const url = window.PLATFORM_CONFIG?.CONTENT_API;
    if (!url) throw new Error('자료 서버 주소가 설정되지 않았습니다.');
    const controller = new AbortController();
    // A resumed Free project can take tens of seconds even for a catalog read.
    // Keep one bounded deadline for all actions; mutations are never auto-retried.
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(url, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...values, action, ...auth()}),
        signal: controller.signal, cache: 'no-store', credentials: 'omit'
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        const error = new Error(data?.error?.message || data?.message || (typeof data?.error === 'string' ? data.error : '') || '자료 서버 요청을 처리하지 못했습니다.');
        error.code = data?.code || data?.error?.code || '';
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) {
        throw new Error('자료 서버에 연결할 수 없습니다. 서버 재개·연결 상태를 확인한 뒤 다시 시도해 주세요.');
      }
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function contentUrl(item) {
    if (!item || !['html', 'pdf'].includes(item.format)) throw new Error('지원하는 HTML 또는 PDF 자료를 선택해 주세요.');
    return 'html-lesson.html?id=' + encodeURIComponent(item.id);
  }
  window.ScienceContentClient = Object.freeze({auth, request, contentUrl});
})();
