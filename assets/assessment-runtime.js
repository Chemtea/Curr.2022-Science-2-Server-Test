(() => {
  'use strict';
  const $=id=>document.getElementById(id), api=window.ScienceAssessmentClient;
  const id=new URLSearchParams(location.search).get('id');
  let item=null,state=null,channel='',pdfUrl=null,generation=0,working=false,frameReady=false,historicalView=false;
  const pending=new Map(), exports=new Map();
  function draftKey(){return 'assessment-work:'+id+':'+(state?.student?.id||'teacher');}
  function allowed(slot){return !historicalView&&state?.role==='student'&&(!state.submissions.some(s=>s.slot===slot)||state.permissions.some(p=>p.slot===slot&&p.allowed));}
  function note(text,error=false){$('assessmentStatus').textContent=text;$('assessmentStatus').className=error?'assessment-error':'';}
  function controls(){ $('assessmentSubmitData').disabled=working||!frameReady||!allowed('data');$('assessmentSubmitPdf').disabled=working||!allowed('pdf')||!$('assessmentPdf').files.length;$('assessmentPdf').disabled=working||!allowed('pdf');$('assessmentPrint').disabled=!frameReady;$('assessmentCollectionLink').hidden=state?.role!=='admin'; }
  function clear(){frameReady=false;channel=crypto.randomUUID();$('assessmentFrame').hidden=true;$('assessmentFrame').removeAttribute('srcdoc');$('assessmentFrame').removeAttribute('src');if(pdfUrl)URL.revokeObjectURL(pdfUrl);pdfUrl=null;for(const waiter of exports.values()){clearTimeout(waiter.timer);waiter.reject(new Error('활동 화면이 새로 열렸습니다.'));}exports.clear();controls();}
  function send(type,extra={}){$('assessmentFrame').contentWindow?.postMessage({channel,type,...extra},'*');}
  function exportData(){return new Promise((resolve,reject)=>{const requestId=crypto.randomUUID();const timer=setTimeout(()=>{exports.delete(requestId);reject(new Error('활동 내용을 읽지 못했습니다. 활동 화면을 확인해 주세요.'));},5000);exports.set(requestId,{resolve,reject,timer});send('export',{requestId});});}
  function bridgeSource(){return `(()=>{'use strict';const channel=${JSON.stringify(channel)};let context=null;function generic(){const fields={};document.querySelectorAll('input:not([type=password]),textarea,select').forEach((el,i)=>{if(el.id||el.name)fields[el.id||el.name]=el.type==='checkbox'?el.checked:el.value;});return{fields};}window.addEventListener('message',async event=>{if(event.source!==parent||event.data?.channel!==channel)return;const m=event.data;const adapter=window.ScienceAssessmentDocument;if(m.type==='init'){context=m.context;adapter?.init?.(context);if(m.payload)adapter?.restore?.(m.payload);adapter?.lock?.(m.locked);parent.postMessage({channel,type:'ready'},'*');}if(m.type==='export'){try{parent.postMessage({channel,type:'export-result',requestId:m.requestId,payload:adapter?.export?.()||generic()},'*');}catch(error){parent.postMessage({channel,type:'export-result',requestId:m.requestId,error:'활동 내용을 읽지 못했습니다.'},'*');}}if(m.type==='lock'){adapter?.lock?.(m.locked);adapter?.sound?.(m.soundMuted);}if(m.type==='print'){adapter?.beforePrint?.();window.print();}});})();`;}
  function safeDocument(content){
    const parsed=new DOMParser().parseFromString(content,'text/html');
    // Every active document has an opaque origin; no authentication is supplied to it.
    parsed.querySelectorAll('base,meta[http-equiv],iframe,frame,object,embed,link').forEach(el=>el.remove());
    parsed.querySelectorAll('script[src]').forEach(el=>el.remove());
    parsed.querySelectorAll('form').forEach(el=>el.removeAttribute('action'));
    const policy="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    return '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+policy+'">'+parsed.documentElement.outerHTML+'<script>'+bridgeSource()+'<\/script>';
  }
  async function renderReceipts(){
    const root=$('assessmentReceipts');root.replaceChildren();
    for(const slot of ['data','pdf']){const records=state.submissions.filter(s=>s.slot===slot);if(!records.length)continue;const latest=records[0],p=document.createElement('p');p.textContent=(slot==='data'?'활동 내용':'PDF')+': 제'+latest.revision+'차 제출 완료 · '+new Date(latest.created_at).toLocaleString('ko-KR')+(allowed(slot)?' · 재제출 가능':'');const b=document.createElement('button');b.textContent='내 제출본 받기';b.onclick=()=>download(latest);p.append(' ',b);root.append(p);}
  }
  async function download(record){try{const d=await api.request('get_submission',{submission_id:record.id}),blob=d.file_base64?api.toBlob(d.file_base64):new Blob([JSON.stringify(d.payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=record.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){note(e.message,true);}}
  async function load(){const run=++generation;clear();note('로그인과 평가 공개 상태를 확인합니다.');try{
    const data=await window.ScienceContentClient.request('get_content',{id});if(run!==generation)return;if(data.item?.kind!=='assessment')throw new Error('수행평가 자료가 아닙니다.');item=data.item;state=await api.request('status',{id});if(run!==generation)return;
    $('assessmentTitle').textContent=item.title;document.title=item.title+' · 과학 플랫폼 테스트';$('assessmentCollectionLink').href='assessment-collection.html?id='+encodeURIComponent(id);
    await renderReceipts();const frame=$('assessmentFrame');
    if(item.format==='pdf'){pdfUrl=URL.createObjectURL(api.toBlob(data.file_base64));frame.removeAttribute('sandbox');frame.src=pdfUrl;frame.hidden=false;note('평가 PDF를 확인하고 완성한 보고서를 위에서 제출하세요.');controls();return;}
    if(item.format!=='html'||typeof data.content!=='string')throw new Error('지원하지 않는 평가 형식입니다.');
    let initial=null;const latest=state.submissions.find(s=>s.slot==='data');
    if(latest)initial=(await api.request('get_submission',{submission_id:latest.id})).payload;
    const selectedSubmission=new URLSearchParams(location.search).get('submission');let historical=null;historicalView=!!selectedSubmission;
    if(selectedSubmission){historical=await api.request('get_submission',{submission_id:selectedSubmission});if(historical.submission.content_id!==id||historical.submission.slot!=='data')throw new Error('이 평가의 활동 제출본이 아닙니다.');initial=historical.payload;}
    if(allowed('data')&&!historical){try{const saved=JSON.parse(window.platformLocalStorage.getItem(draftKey())||'null');if(saved?.version===item.version&&saved?.baseRevision===(latest?.revision||0))initial=saved.payload;}catch{}}
    if(run!==generation)return;frame.setAttribute('sandbox','allow-scripts allow-modals');frame.setAttribute('allow','autoplay');frame.onload=()=>send('init',{context:historical?{soundMuted:state.soundMuted,studentId:String(historical.submission.canonical_code).replace(/^([1-3])0([1-9][0-9]{2})$/,'$1$2'),name:historical.submission.student_name,schoolYear:2026}:{...(state.student||{studentId:'교사 미리보기',name:'교사',schoolYear:2026}),soundMuted:state.soundMuted},payload:initial,locked:!!historical||(state.role==='student'&&!allowed('data'))});frame.srcdoc=safeDocument(data.content);frame.hidden=false;note(historical?'선택한 제출본 열람입니다. 활동지 인쇄 / PDF 저장을 사용할 수 있습니다.':state.role==='admin'?'교사 미리보기입니다. 제출물은 교사 제출물 수합에서 확인하세요.':'활동 내용은 이 기기에 임시저장됩니다. 마무리한 뒤 활동 내용 제출을 눌러 주세요.');controls();
  }catch(error){if(run!==generation)return;clear();note(error.message,true);}}
  window.addEventListener('message',event=>{if(event.source!==$('assessmentFrame').contentWindow||event.origin!=='null'||event.data?.channel!==channel)return;const m=event.data;if(m.type==='ready'){frameReady=true;controls();}if(m.type==='export-result'){const waiter=exports.get(m.requestId);if(!waiter)return;exports.delete(m.requestId);clearTimeout(waiter.timer);if(m.error||!m.payload||typeof m.payload!=='object'||Array.isArray(m.payload)||JSON.stringify(m.payload).length>524288)waiter.reject(new Error(m.error||'활동 데이터가 너무 큽니다.'));else waiter.resolve(m.payload);}});
  async function submit(slot){if(working||!allowed(slot))return;if(!pending.has(slot)&&!confirm((slot==='data'?'활동 내용':'PDF')+'을 최종 제출할까요? 제출 후 수정은 교사 허용이 필요합니다.'))return;working=true;controls();try{
    if(!pending.has(slot)){const values=slot==='data'?{payload:await exportData()}:{file_base64:await api.base64($('assessmentPdf').files[0])};pending.set(slot,{id,slot,content_version:item.version,request_id:crypto.randomUUID(),...values});}
    const data=await api.request('submit',pending.get(slot));pending.delete(slot);state=await api.request('status',{id});await renderReceipts();if(slot==='data'){window.platformLocalStorage.removeItem(draftKey());send('lock',{locked:true});}note('제'+data.submission.revision+'차 '+(slot==='data'?'활동 내용':'PDF')+' 제출을 서버에서 확인했습니다.');
  }catch(error){note(error.message,true);}finally{working=false;controls();}}
  $('assessmentSubmitData').onclick=()=>submit('data');$('assessmentSubmitPdf').onclick=()=>submit('pdf');$('assessmentPdf').onchange=()=>{if($('assessmentPdf').files[0]?.size>10*1024*1024){note('PDF는 10MB 이내로 선택해 주세요.',true);$('assessmentPdf').value='';}controls();};$('assessmentRefresh').onclick=load;$('assessmentPrint').onclick=()=>send('print');
  setInterval(async()=>{if(!frameReady||working||!allowed('data')||document.visibilityState!=='visible')return;try{const payload=await exportData();window.platformLocalStorage.setItem(draftKey(),JSON.stringify({version:item.version,baseRevision:state.submissions.find(s=>s.slot==='data')?.revision||0,payload}));}catch{}},5000);
  // Opening/focusing a restored page revalidates authorization before protected content remains visible.
  window.addEventListener('pagehide',()=>{generation++;clear();});window.addEventListener('pageshow',e=>{if(e.persisted)load();});
  document.addEventListener('visibilitychange',async()=>{if(document.visibilityState!=='visible'||!item)return;try{state=await api.request('status',{id});send('lock',{locked:historicalView||(state.role==='student'&&!allowed('data')),soundMuted:state.soundMuted});controls();}catch(e){clear();note(e.message,true);}});
  let statusBusy=false;setInterval(async()=>{if(!item||statusBusy||working||document.visibilityState!=='visible')return;statusBusy=true;try{state=await api.request('status',{id});send('lock',{locked:historicalView||(state.role==='student'&&!allowed('data')),soundMuted:state.soundMuted});controls();}catch(e){clear();note(e.message,true);}finally{statusBusy=false;}},15000);
  load();
})();
