(() => {
  'use strict';
  const status = document.getElementById('htmlLessonStatus');
  const title = document.getElementById('htmlLessonTitle');
  const retry = document.getElementById('htmlLessonRetry');
  const client = window.ScienceContentClient;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  retry.addEventListener('click', () => location.reload());
  function failed(error) {
    title.textContent = '수업자료를 열 수 없습니다';
    status.textContent = error.message || '메뉴로 돌아가 로그인과 자료 공개 상태를 확인해 주세요.';
    retry.hidden = false;
  }
  function showPdf(result, ensureCurrent) {
    // The content endpoint returns bytes only after checking this item's own
    // permissions. Keep those bytes in memory; there is no public storage URL.
    const binary = atob(result.file_base64 || '');
    if (!binary.startsWith('%PDF-')) throw new Error('PDF 파일을 확인할 수 없습니다.');
    const pdfUrl = URL.createObjectURL(new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], {type: 'application/pdf'}));
    const preview = document.createElement('iframe'), download = document.createElement('a');
    preview.id = 'htmlLessonPdf'; preview.title = result.item.title || 'PDF 자료'; preview.src = pdfUrl;
    preview.style.cssText = 'display:block;width:100%;height:72vh;margin-top:18px;border:1px solid #405770;border-radius:9px;background:#fff';
    download.textContent = 'PDF 다운로드'; download.href = pdfUrl;
    download.download = String(result.item.title || '자료').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\.pdf$/i, '') + '.pdf';
    const main = title.closest('main'); main.style.maxWidth = '1100px'; main.style.margin = '24px auto';
    title.textContent = result.item.title || 'PDF 자료'; document.title = title.textContent;
    status.textContent = 'PDF를 확인할 수 있습니다. 미리보기가 지원되지 않으면 다운로드해 주세요.';
    main.append(download, preview);
    let active = true, checking = false;
    const dispose = () => { if (!active) return; active = false; preview.remove(); download.remove(); URL.revokeObjectURL(pdfUrl); };
    const verify = async () => {
      if (!active || checking || document.visibilityState === 'hidden') return;
      checking = true;
      try { ensureCurrent(); await client.request('get_content', {id: result.item.id}); ensureCurrent(); }
      catch (error) { dispose(); failed(error); }
      finally { checking = false; }
    };
    window.addEventListener('pagehide', dispose, {once: true});
    window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
    window.addEventListener('focus', verify);
    document.addEventListener('visibilitychange', verify);
  }
  async function open() {
    try {
      const params = new URLSearchParams(location.search), id = params.get('id');
      const worksheetOnly = params.get('worksheet') === '1', worksheetId = params.get('worksheetId');
      if (!id || !UUID.test(id) || (worksheetId && !UUID.test(worksheetId))) throw new Error('자료 주소가 올바르지 않습니다. 메뉴에서 수업을 다시 선택해 주세요.');
      const who = JSON.stringify(client.auth());
      const ensureCurrent = () => { if (who !== JSON.stringify(client.auth())) throw new Error('로그인 상태가 변경되었습니다. 메뉴에서 자료를 다시 열어 주세요.'); };
      // worksheet=1 also appears on the standalone PDF shell. Only an explicit
      // linked worksheet may authorize opening its lesson's HTML in drawer mode.
      const result = await client.request('get_content', {id, ...(worksheetOnly && worksheetId ? {worksheet_mode: true, worksheet_id: worksheetId} : {})});
      ensureCurrent();
      let item = result.item, source = result.content;
      if (!item || item.id !== id) throw new Error('실행할 수업자료를 확인할 수 없습니다.');
      let worksheet = null;
      let executionItem = item;
      if (item.kind === 'worksheet' && item.format === 'pdf') {
        worksheet = item;
        const shell = await fetch('./assets/legacy-worksheet-shell.html', {cache:'no-store'});
        if (!shell.ok) throw new Error('학습지 도구를 불러오지 못했습니다. 다시 확인해 주세요.');
        source = await shell.text();
        executionItem = {...item, kind:'lesson', format:'html'};
        const url = new URL(location.href); url.searchParams.set('worksheet', '1');
        history.replaceState(null, '', url);
      } else if (item.format === 'pdf' && ['assessment', 'answer'].includes(item.kind)) {
        showPdf(result, ensureCurrent); return;
      } else if (item.format !== 'html' || typeof source !== 'string') {
        throw new Error('실행할 HTML 수업자료를 확인할 수 없습니다.');
      } else if (item.kind === 'lesson') {
        // Metadata does not contain file bytes. The drawer obtains the PDF only
        // after its independent worksheet locks have been checked.
        const catalog = await client.request('catalog');
        const linked = (catalog.items || []).filter(row => row.kind === 'worksheet' && row.format === 'pdf' && row.lesson_id === item.lesson_id && row.unit_id === item.unit_id);
        worksheet = worksheetId ? linked.find(row => row.id === worksheetId) : linked.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id))[0];
        if (worksheetId && !worksheet) throw new Error('선택한 학습지가 이 차시에 연결되어 있지 않거나 공개되지 않았습니다.');
      }
      ensureCurrent();
      const adapted = window.LegacyHTMLAdapter.prepare(source, executionItem, {pageUrl: location.href, worksheet});
      window.LegacyHTMLAdapter.configure({item, worksheet, worksheetOnly});
      // Validate storage/network adaptation before any original script can run.
      // The injected bootstrap reattaches document listeners after open().
      window.LegacyHTMLAdapter.installRuntime();
      // Top-level document replacement preserves URL/query, parser-blocking
      // document.write, microphone origin, native dialogs, and worksheet tools.
      document.open(); document.write(adapted.html); document.close();
    } catch (error) { failed(error); }
  }
  open();
})();
