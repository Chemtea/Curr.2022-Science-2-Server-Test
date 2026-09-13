(() => {
  'use strict';
  const status = document.getElementById('contentStatus');
  const frame = document.getElementById('contentFrame');
  const title = document.getElementById('contentTitle');
  const pdfLink = document.getElementById('openPdf');
  let objectUrl = null;
  let generation = 0;
  function clear() {
    frame.hidden = true; frame.removeAttribute('src'); frame.removeAttribute('srcdoc');
    pdfLink.hidden = true; pdfLink.removeAttribute('href');
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  }
  async function load() {
    const current = ++generation;
    clear(); status.dataset.error = 'false'; status.textContent = '현재 세션과 자료 공개 상태를 서버에서 확인합니다.';
    try {
      const id = new URLSearchParams(location.search).get('id');
      if (!id || !/^[a-z0-9_-]{1,80}$/i.test(id)) throw new Error('자료 주소가 올바르지 않습니다. 자료실에서 다시 선택해 주세요.');
      const data = await window.ScienceContentClient.request('get_content', {id});
      if (current !== generation) return;
      if (!data.item) throw new Error('자료 정보를 확인할 수 없습니다.');
      title.textContent = data.item.title; document.title = data.item.title + ' · 과학 플랫폼 테스트'; frame.title = data.item.title;
      if (data.item.format === 'lesson-pack') { location.replace(window.ScienceContentClient.contentUrl(data.item)); return; }
      if (data.item.format === 'pdf') {
        const binary = atob(data.file_base64 || '');
        if (!binary.startsWith('%PDF-')) throw new Error('올바른 PDF 응답이 아닙니다.');
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        objectUrl = URL.createObjectURL(new Blob([bytes], {type: 'application/pdf'}));
        frame.removeAttribute('sandbox'); frame.src = objectUrl;
        pdfLink.href = objectUrl; pdfLink.hidden = false;
        status.textContent = '서버 접근 확인을 완료했습니다. 화면이 보이지 않으면 PDF 새 창 열기를 눌러 주세요.';
      } else if (data.item.format === 'html' && typeof data.content === 'string') {
        // Opaque-origin sandbox: uploaded scripts cannot read parent storage, cookies, or authentication tokens.
        // Fetch/XHR, remote assets, nested frames and form submission are denied. No postMessage capability is granted.
        const protectedDocument = ['assessment', 'answer'].includes(data.item.kind);
        frame.setAttribute('sandbox', protectedDocument ? '' : 'allow-scripts');
        const scriptPolicy = protectedDocument ? "'none'" : "'unsafe-inline'";
        const policy = "default-src 'none'; script-src " + scriptPolicy + "; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
        frame.srcdoc = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + policy + '">' + data.content;
        status.textContent = protectedDocument ? '보호된 문서입니다. 내용만 열람할 수 있으며 문서에 포함된 스크립트는 실행하지 않습니다.' : '독립된 수업자료입니다. 외부 로그인·업로드·마이크 기능이 필요한 자료는 공통 수업팩으로 등록해 주세요.';
      } else throw new Error('지원하지 않는 자료 형식입니다.');
      frame.hidden = false;
    } catch (error) {
      if (current !== generation) return;
      clear(); title.textContent = '자료를 열 수 없습니다'; status.dataset.error = 'true'; status.textContent = error.message + ' 로그인 또는 공개 상태를 확인한 뒤 다시 시도해 주세요.';
    }
  }
  document.getElementById('contentRetry').addEventListener('click', load);
  // Pages restored from back-forward cache re-check access before rendering a protected payload.
  window.addEventListener('pagehide', () => { generation++; clear(); });
  window.addEventListener('pageshow', event => { if (event.persisted) load(); });
  load();
})();
