(() => {
  'use strict';
  async function request(action, values = {}) {
    const url = window.PLATFORM_CONFIG?.baseUrl + '/functions/v1/assessment-api';
    if (!url.startsWith('https://rerykeslgwhamreoskgx.supabase.co/')) throw new Error('테스트 서버 설정을 확인해 주세요.');
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...values,action,...window.ScienceContentClient.auth()}),signal:controller.signal,credentials:'omit',cache:'no-store'});
      const data = await response.json().catch(()=>null);
      if (!response.ok || !data?.success) { const error = new Error(data?.message || '수행평가 요청을 처리하지 못했습니다.'); error.code=data?.code; error.status=response.status; throw error; }
      return data;
    } catch(error) {
      if(error.name==='AbortError') throw new Error('서버 응답을 기다리는 시간이 길어졌습니다. 같은 제출 버튼을 다시 누르면 중복 없이 결과를 확인합니다.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function toBlob(encoded,type='application/pdf') { const raw=atob(encoded),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));return new Blob([bytes],{type}); }
  async function base64(file) { const bytes=new Uint8Array(await file.arrayBuffer());let str='';for(let i=0;i<bytes.length;i+=32768)str+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(str); }
  window.ScienceAssessmentClient=Object.freeze({request,toBlob,base64});
})();
