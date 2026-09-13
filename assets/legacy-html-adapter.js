/* Trusted teacher HTML compatibility adapter.
 * This preserves a complete lesson document; it is NOT an untrusted HTML sandbox.
 * Stored originals are never changed. Only the execution copy is adapted.
 */
((root, factory) => {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.defineProperty(root, 'LegacyHTMLAdapter', {value: Object.freeze(api)});
})(typeof window === 'object' ? window : globalThis, root => {
  'use strict';
  const TEST_REF = 'rerykeslgwhamreoskgx';
  const TEST_BASE = 'https://' + TEST_REF + '.supabase.co';
  const PRODUCTION_REF = 'jypvtvvozxmsposxllri';
  const PRODUCTION_SITE = 'https://chemtea.github.io/Curr.2022-Science-2/';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const jsValue = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const attribute = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  let runtime = null;

  function validLesson(item) {
    const unit = /^unit([1-9]\d*)$/.exec(String(item.unit_id || ''));
    const lesson = /^u([1-9]\d*)_l([1-9]\d*)$/.exec(String(item.lesson_id || ''));
    if (!unit || !lesson || unit[1] !== lesson[1]) throw new Error('단원과 차시 번호를 확인해 주세요. 예: unit8 / u8_l1');
    return {unit: item.unit_id, lesson: item.lesson_id};
  }

  function inspect(source) {
    if (typeof source !== 'string' || source.length < 40) throw new Error('수업 HTML 내용이 비어 있습니다.');
    const marker = /\/\*\s*ML:EDIT:CONFIG:START\s*\*\/([\s\S]*?)\/\*\s*ML:EDIT:CONFIG:END\s*\*\//;
    const master = marker.exec(source);
    if (master) {
      let config;
      try { config = JSON.parse(master[1].trim()); } catch { throw new Error('수업 설정 JSON을 읽을 수 없습니다.'); }
      return {profile: 'master', config, marker, worksheetPath: String(config.worksheetPath || '')};
    }
    const literal = name => new RegExp('\\b(?:const|let|var)\\s+' + name + '\\s*=\\s*(["\'])([^"\']*)\\1').exec(source)?.[2];
    const unit = literal('THIS_UNIT_KEY'), lesson = literal('THIS_LESSON_KEY') || literal('THIS_LESSON_ID');
    const drawer = /<[^>]+\bid=["']ctw-root["'][^>]*>/i.exec(source)?.[0] || '';
    const worksheetPath = /\bdata-pdf=["']([^"']*)["']/i.exec(drawer)?.[1] || '';
    const partial = /\b(?:THIS_UNIT_KEY|THIS_LESSON_KEY|THIS_LESSON_ID|MASTER_LESSON_CONFIG)\s*=/.test(source);
    return {profile: unit && lesson ? 'legacy' : partial ? 'incomplete' : 'standalone', unit, lesson, worksheetPath};
  }

  function prepare(source, item, options = {}) {
    if (!item || !['lesson', 'assessment', 'answer'].includes(item.kind)) throw new Error('HTML 수업자료의 종류를 확인해 주세요.');
    if (typeof source !== 'string' || source.length > 10 * 1024 * 1024) throw new Error('HTML 파일 크기를 확인해 주세요.');
    const sourceInfo = inspect(source);
    const siteBase = new URL('./', options.pageUrl || 'https://chemtea.github.io/Curr.2022-Science-2-Server-Test/html-lesson.html').href;
    if (siteBase === PRODUCTION_SITE) throw new Error('정식 운영 주소에서는 테스트 HTML을 실행하지 않습니다.');
    let html = source, warnings = [];
    const worksheet = options.worksheet || null;
    const virtualWorksheetPath = worksheet || sourceInfo.worksheetPath ? 'worksheets/' + String(item.lesson_id || 'worksheet').replace(/[^a-z0-9_-]/gi, '_') + '.pdf' : '';
    if (item.kind === 'lesson') {
      const ids = validLesson(item);
      if (sourceInfo.profile === 'incomplete') throw new Error('HTML의 플랫폼 단원·차시 설정이 일부 빠져 있습니다. THIS_UNIT_KEY와 THIS_LESSON_KEY 또는 MASTER_LESSON_CONFIG를 확인해 주세요.');
      if (sourceInfo.profile === 'standalone') warnings.push('독립 HTML입니다. 포함된 수업 내용은 그대로 표시하며, 파일에 없는 로그인·형성평가·포인트 기능을 새로 추가하지 않습니다.');
      if (sourceInfo.profile === 'master') {
        const config = {...sourceInfo.config, templateMode: false, unitKey: ids.unit, lessonKey: ids.lesson,
          lessonName: String(item.title), worksheetPath: virtualWorksheetPath,
          worksheetTitle: String(worksheet?.title || sourceInfo.config.worksheetTitle || '차시 학습지')};
        html = html.replace(sourceInfo.marker, '/* ML:EDIT:CONFIG:START */\n' + jsValue(config) + '\n/* ML:EDIT:CONFIG:END */');
        // The first master revision required a nonempty PDF path even for a lesson
        // without a worksheet. Normalize only this known configuration predicate.
        html = html.replace(/\^worksheets\\\/\[A-Za-z0-9_\.\/\-\]\+\\\.pdf\$\/i\.test\(config\.worksheetPath \|\| ''\)/g,
          '^worksheets\\/[A-Za-z0-9_./-]+\\.pdf$/i.test(config.worksheetPath || \'worksheets/none.pdf\')');
      } else if (sourceInfo.profile === 'legacy') {
        for (const [name, value] of Object.entries({THIS_UNIT_KEY: ids.unit, THIS_LESSON_ID: ids.lesson, THIS_LESSON_KEY: ids.lesson, LESSON_NAME: String(item.title)})) {
          html = html.replace(new RegExp('(\\b(?:const|let|var)\\s+' + name + '\\s*=\\s*)(["\'])([^"\']*)\\2', 'g'), (_, prefix) => prefix + jsValue(value));
        }
      }
      html = html.replace(/(<[^>]+\bid=["']ctw-root["'][^>]*>)/i, tag => tag
        .replace(/\bdata-lesson=["'][^"']*["']/i, 'data-lesson="' + attribute(ids.lesson) + '"')
        .replace(/\bdata-pdf=["'][^"']*["']/i, 'data-pdf="' + attribute(virtualWorksheetPath) + '"'));
      if (sourceInfo.profile !== 'standalone' && (sourceInfo.worksheetPath || worksheet)) {
        const original = /const input = file \? \{data:new Uint8Array\(await file\.arrayBuffer\(\)\)\} : \{url:defaultURL\};/;
        if (!original.test(html)) throw new Error('이 HTML의 학습지 연결 양식을 확인해야 합니다. 원본 PDF 경로를 임의로 공개하지 않았습니다.');
        html = html.replace(original, 'const input = file ? {data:new Uint8Array(await file.arrayBuffer())} : {data:await window.LegacyHTMLAdapter.worksheetBytes()};');
      }
      // The original drawer already supplies the exact changed path/value and
      // delegates step buttons to the same writer. Keep the fresh verification,
      // but send only that change to TEST's atomic patch endpoint.
      html = html.replace(/\{action:'save_locks',adminKey,locks\}/g,
        "{action:'save_locks',adminKey,patches:[{path,value:value===true}]}");
    }
    if (item.kind === 'answer') {
      // This particular teacher-only original predates Supabase. The content
      // endpoint already verified the admin; keep ongoing verification on TEST.
      html = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi, (tag, script) =>
        /const LOCK_SCRIPT_URL\s*=\s*["']https:\/\/script\.google\.com\//.test(script)
          && /action:\s*["']get_locks["']/.test(script)
          ? '<script>window.LegacyHTMLAdapter.watchProtectedContent();<\/script>' : tag);
    }
    // Runtime is preloaded by html-lesson.html; re-evaluating the nonconfigurable
    // PLATFORM_CONFIG would fail. Preserve the parser order for all OTHER scripts.
    html = html.replace(/<script\b[^>]*\bsrc=["'](?:[^"']*\/)?platform-config\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script\s*>/gi, '<!-- TEST platform configuration already loaded -->');
    html = html.replace(/document\.write\([^;\n]*platform-config\.js[^;\n]*\);?/g, '/* TEST platform configuration already loaded */');
    html = html.replaceAll(PRODUCTION_REF + '.supabase.co', TEST_REF + '.supabase.co').replaceAll(PRODUCTION_SITE, siteBase);
    const unknownProjects = html.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/gi) || [];
    if (unknownProjects.some(url => new URL(url).hostname !== TEST_REF + '.supabase.co')) throw new Error('HTML에 다른 Supabase 프로젝트 주소가 있습니다. 테스트 연결을 확인해 주세요.');
    // Native document navigation retains ?worksheet=1 and gives microphone/PDF
    // workers a real HTTPS origin. This is intentionally a trusted executable.
    const bootstrap = '<script>window.LegacyHTMLAdapter.installRuntime();<\/script>';
    if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, tag => tag + '\n' + bootstrap);
    else html = '<!doctype html><head><meta charset="utf-8">' + bootstrap + '</head>' + html.replace(/<!doctype[^>]*>/i, '');
    return {html, warnings, sourceProfile: sourceInfo.profile, sourceWorksheetPath: sourceInfo.worksheetPath, worksheetPath: virtualWorksheetPath};
  }

  function mapUrl(value, pageUrl) {
    const url = new URL(String(value), pageUrl || root.location.href);
    if (url.hostname === PRODUCTION_REF + '.supabase.co') url.hostname = TEST_REF + '.supabase.co';
    if (/\.supabase\.co$/i.test(url.hostname) && url.hostname !== TEST_REF + '.supabase.co') throw new Error('다른 서버로의 요청을 막았습니다. 테스트 서버 연결을 확인해 주세요.');
    if (url.href.startsWith(PRODUCTION_SITE)) return new URL(url.href.slice(PRODUCTION_SITE.length), new URL('./', pageUrl || root.location.href)).href;
    if (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com') throw new Error('이전 운영 서버로의 요청은 테스트 화면에서 실행하지 않습니다.');
    return url.href;
  }

  function configure(context) {
    if (runtime) throw new Error('수업을 다시 불러와 주세요.');
    if (root.PLATFORM_CONFIG?.projectRef !== TEST_REF || root.PLATFORM_CONFIG?.baseUrl !== TEST_BASE) throw new Error('테스트 서버 설정이 아닙니다. 실행을 중단했습니다.');
    runtime = {...context, installed: false, fetchingWorksheet: null};
  }

  function installRuntime() {
    if (!runtime) throw new Error('수업 실행 정보를 확인할 수 없습니다.');
    if (runtime.installed) { bindDocument(); return; }
    const session = root.platformSessionStorage, local = root.platformLocalStorage;
    if (!session || !local) throw new Error('테스트 전용 저장 공간을 확인할 수 없습니다.');
    // Original JS and dynamically loaded common JS use these native names.
    // The test wrappers already captured the real Storage objects beforehand.
    Object.defineProperty(root, 'sessionStorage', {value: session, configurable: true});
    Object.defineProperty(root, 'localStorage', {value: local, configurable: true});
    const originalFetch = root.fetch.bind(root);
    root.fetch = (input, init) => {
      const isRequest = typeof root.Request === 'function' && input instanceof root.Request;
      let mapped;
      try { mapped = mapUrl(isRequest ? input.url : input); } catch (error) { return Promise.reject(error); }
      if (new URL(mapped).hostname === 'api.ipify.org') return Promise.resolve(new root.Response(JSON.stringify({ip: '테스트 환경'}), {status: 200, headers: {'Content-Type': 'application/json'}}));
      return originalFetch(isRequest ? new root.Request(mapped, input) : mapped, init);
    };
    if (root.XMLHttpRequest?.prototype) {
      const originalOpen = root.XMLHttpRequest.prototype.open;
      root.XMLHttpRequest.prototype.open = function(method, url, ...args) { return originalOpen.call(this, method, mapUrl(url), ...args); };
    }
    if (root.WebSocket) {
      const OriginalSocket = root.WebSocket;
      root.WebSocket = class extends OriginalSocket { constructor(url, protocols) { super(mapUrl(url), ...(protocols === undefined ? [] : [protocols])); } };
    }
    if (root.navigator?.sendBeacon) {
      const send = root.navigator.sendBeacon.bind(root.navigator);
      try { root.navigator.sendBeacon = (url, data) => send(mapUrl(url), data); } catch (_) {}
    }
    runtime.installed = true;
    bindDocument();
  }

  function bindDocument() {
    root.addEventListener('pageshow', event => { if (event.persisted) root.location.reload(); });
    // Listener is registered after document.open (which removes old listeners).
    root.addEventListener('DOMContentLoaded', () => {
      const title = root.document.getElementById('ctw-title');
      if (title && runtime.worksheet) title.textContent = runtime.worksheet.title;
      if (runtime.item.kind === 'lesson') root.document.title = runtime.item.title;
      if (runtime.item.kind === 'lesson' && runtime.worksheet && !root.document.getElementById('ctw-root')) {
        const link = root.document.createElement('a'); link.textContent = '📑 연결 학습지 열기';
        link.href = 'html-lesson.html?id=' + encodeURIComponent(runtime.worksheet.id);
        link.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:99999;padding:11px 16px;border:1px solid #64748b;border-radius:10px;background:#173857;color:#fff;text-decoration:none;font:600 15px system-ui;';
        root.document.body.append(link);
      }
    }, {once: true});
  }

  function watchProtectedContent() {
    if (!runtime || runtime.item.kind !== 'answer') throw new Error('교사용 자료의 서버 확인이 필요합니다.');
    let checking = false;
    const verify = async () => {
      if (checking || root.document.visibilityState === 'hidden') return;
      checking = true;
      try { await root.ScienceContentClient.request('get_content', {id: runtime.item.id}); }
      catch (_) {
        root.document.body.textContent = '교사용 자료의 접근 권한을 확인할 수 없습니다. 메뉴로 돌아가 다시 로그인해 주세요.';
        const link = root.document.createElement('a'); link.href = './index.html'; link.textContent = ' 메뉴로 돌아가기'; root.document.body.append(link);
      } finally { checking = false; }
    };
    root.addEventListener('focus', verify); root.addEventListener('online', verify);
    root.document.addEventListener('visibilitychange', verify);
  }

  async function worksheetBytes() {
    if (!runtime) throw new Error('수업자료 연결을 다시 확인해 주세요.');
    if (runtime.fetchingWorksheet) return runtime.fetchingWorksheet;
    runtime.fetchingWorksheet = (async () => {
      let worksheet = runtime.worksheet;
      if (!worksheet) {
        const catalog = await root.ScienceContentClient.request('catalog');
        worksheet = (catalog.items || []).filter(item => item.kind === 'worksheet' && item.format === 'pdf' && item.unit_id === runtime.item.unit_id && item.lesson_id === runtime.item.lesson_id)
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id))[0];
      }
      if (!worksheet || !UUID.test(worksheet.id)) throw new Error('연결된 학습지가 없거나 아직 공개되지 않았습니다. 자료 목록에서 연결 상태를 확인해 주세요.');
      const result = await root.ScienceContentClient.request('get_content', {id: worksheet.id});
      if (result.item?.id !== worksheet.id || result.item.kind !== 'worksheet' || result.item.format !== 'pdf' || result.item.lesson_id !== runtime.item.lesson_id || result.item.unit_id !== runtime.item.unit_id) throw new Error('다른 차시의 학습지 응답을 받았습니다. 다시 확인해 주세요.');
      const binary = root.atob(result.file_base64 || '');
      if (!binary.startsWith('%PDF-')) throw new Error('학습지 PDF 파일을 확인할 수 없습니다.');
      runtime.worksheet = worksheet;
      return Uint8Array.from(binary, char => char.charCodeAt(0));
    })().finally(() => { runtime.fetchingWorksheet = null; });
    return runtime.fetchingWorksheet;
  }
  return {TEST_REF, TEST_BASE, inspect, prepare, mapUrl, configure, installRuntime, worksheetBytes, watchProtectedContent};
});
