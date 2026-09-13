(() => {
  'use strict';
  const $=id=>document.getElementById(id),api=window.ScienceAssessmentClient;
  let rows=[],permissions=[],items=[],busy=false,url=null,soundMuted=true;
  const selected=new Set();
  function note(text,error=false){$('collectionStatus').textContent=text;$('collectionStatus').className=error?'assessment-error':'';}
  function controls(){for(const id of ['collectionRefresh','collectionAssessment','collectionPrint','collectionDownload'])$(id).disabled=busy||!items.length;}
  function currentId(){return $('collectionAssessment').value;}
  function shownRows(){if($('collectionHistory').checked)return rows;const seen=new Set();return rows.filter(r=>{const key=r.account_id+':'+r.slot;if(seen.has(key))return false;seen.add(key);return true;});}
  function button(text,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;return b;}
  function render(){$('collectionSound').hidden=currentId()!=='9b67cc1e-c6ba-598e-8b64-298e8a3ea250';$('collectionUnit3Print').hidden=currentId()!=='9b67cc1e-c6ba-598e-8b64-298e8a3ea250';$('collectionSound').textContent=soundMuted?'소리 허용':'전체 음소거';const tbody=$('collectionRows');tbody.replaceChildren();selected.clear();$('collectionSelectAll').checked=false;
    for(const record of shownRows()){const tr=document.createElement('tr'),check=document.createElement('input');check.type='checkbox';check.setAttribute('aria-label',record.filename+' 선택');check.onchange=()=>check.checked?selected.add(record.id):selected.delete(record.id);const td=document.createElement('td');td.append(check);tr.append(td);
      const display=String(record.canonical_code).replace(/^([1-3])0([1-9][0-9]{2})$/,'$1$2');for(const text of [display+' '+record.student_name,record.slot==='data'?'활동 내용':'PDF','제'+record.revision+'차',new Date(record.created_at).toLocaleString('ko-KR')]){const cell=document.createElement('td');cell.textContent=text;tr.append(cell);}
      const actions=document.createElement('td');actions.append(button('열기',()=>preview(record)),button('파일 받기',()=>download(record)));
      if(record.slot==='data'){const a=document.createElement('a');a.href='assessment.html?id='+encodeURIComponent(record.content_id)+'&submission='+encodeURIComponent(record.id);a.textContent='활동지 열기';a.target='_blank';a.rel='noopener';actions.append(a);}
      const permission=permissions.find(p=>p.account_id===record.account_id&&p.slot===record.slot)?.allowed===true;
      actions.append(button(permission?'재제출 허용 취소':'재제출 허용',()=>setPermission(record,!permission)));tr.append(actions);tbody.append(tr);
    }
    note('총 '+rows.length+'개 제출본 · 현재 '+shownRows().length+'개 표시');controls();
  }
  async function load(){if(busy)return;busy=true;controls();note('평가별 제출물을 불러옵니다.');try{let offset=0,all=[],perms=[];do{const d=await api.request('list_submissions',{id:currentId(),offset});all.push(...d.submissions);perms=d.permissions;soundMuted=d.soundMuted!==false;offset=d.next_offset;}while(offset!==null);rows=all;permissions=perms;render();}catch(e){rows=[];$('collectionRows').replaceChildren();note(e.message,true);}finally{busy=false;controls();}}
  async function setPermission(record,allowed){if(!confirm(record.student_name+' 학생의 '+(record.slot==='data'?'활동 내용':'PDF')+' 재제출을 '+(allowed?'허용':'취소')+'할까요?'))return;try{await api.request('set_resubmit',{id:record.content_id,account_id:record.account_id,slot:record.slot,allowed});await load();}catch(e){note(e.message,true);}}
  async function file(record){const d=await api.request('get_submission',{submission_id:record.id});return{data:d,blob:d.file_base64?api.toBlob(d.file_base64):new Blob([JSON.stringify(d.payload,null,2)],{type:'application/json'})};}
  async function download(record){try{const {blob}=await file(record),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=record.filename;a.click();setTimeout(()=>URL.revokeObjectURL(u),1500);}catch(e){note(e.message,true);}}
  function close(){if($('collectionPreview').open)$('collectionPreview').close();$('collectionPreviewBody').replaceChildren();if(url)URL.revokeObjectURL(url);url=null;}
  async function preview(record){try{close();const {blob,data}=await file(record);url=URL.createObjectURL(blob);$('collectionPreviewTitle').textContent=record.filename;$('collectionPreviewDownload').hidden=false;$('collectionPreviewDownload').href=url;$('collectionPreviewDownload').download=record.filename;const el=document.createElement(record.slot==='pdf'?'iframe':'pre');if(record.slot==='pdf'){el.src=url;el.title=record.filename;}else{el.className='assessment-preview-data';el.textContent=JSON.stringify(data.payload,null,2);}$('collectionPreviewBody').append(el);$('collectionPreview').showModal();}catch(e){note(e.message,true);}}
  async function printSelected(){const chosen=rows.filter(r=>selected.has(r.id)&&r.slot==='data');if(!chosen.length){note('인쇄할 활동 내용 제출본을 선택해 주세요. PDF는 열기에서 인쇄합니다.',true);return;}busy=true;controls();const area=$('assessmentPrintArea');area.replaceChildren();try{for(const record of chosen){const d=await api.request('get_submission',{submission_id:record.id}),section=document.createElement('section'),heading=document.createElement('h2'),meta=document.createElement('p'),pre=document.createElement('pre');section.className='assessment-print-record';heading.textContent=record.filename;meta.textContent=items.find(i=>i.id===record.content_id)?.title||'';pre.textContent=JSON.stringify(d.payload,null,2);section.append(heading,meta,pre);area.append(section);}window.print();}catch(e){note(e.message,true);}finally{busy=false;controls();}}
  async function downloadSelected(){const chosen=rows.filter(r=>selected.has(r.id));if(!chosen.length){note('받을 제출본을 선택해 주세요.',true);return;}busy=true;controls();try{for(const r of chosen)await download(r);note(chosen.length+'개 다운로드를 요청했습니다. 브라우저의 여러 파일 다운로드 허용을 확인해 주세요.');}finally{busy=false;controls();}}
  async function unit3Print(){
    const chosen=rows.filter(r=>selected.has(r.id)&&r.slot==='data');
    if(!chosen.length){note('보고서 양식을 만들 활동 내용 제출본을 선택해 주세요.',true);return;}
    busy=true;controls();
    try {
      const template=await window.ScienceContentClient.request('get_content',{id:'79405cd7-afa6-5255-bed7-76d356dd136c'});
      if(template.item?.kind!=='answer'||typeof template.content!=='string')throw new Error('교사용 보고서 양식을 확인할 수 없습니다.');
      const records=[];for(const record of chosen)records.push(await api.request('get_submission',{submission_id:record.id}));
      close();const frame=document.createElement('iframe'),channel=crypto.randomUUID();frame.title='선택한 학생의 Unit 3 보고서';frame.setAttribute('sandbox','allow-scripts allow-modals');
      const documentCopy=new DOMParser().parseFromString(template.content,'text/html');documentCopy.querySelectorAll('base,meta[http-equiv],script[src],iframe,object,embed,link').forEach(e=>e.remove());
      const policy="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
      const script=`window.addEventListener('message',event=>{if(event.source!==parent||event.data?.channel!==${JSON.stringify(channel)})return;if(event.data.type==='render'){window.ScienceAssessmentPrint.render(event.data.records);document.getElementById('printArea').style.display='block';}if(event.data.type==='print')window.print();});`;
      frame.onload=()=>frame.contentWindow.postMessage({channel,type:'render',records},'*');
      frame.srcdoc='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+policy+'">'+documentCopy.documentElement.outerHTML+'<script>'+script+'<\/script>';
      $('collectionPreviewTitle').textContent='Unit 3 보고서 양식 · '+records.length+'개 제출본';$('collectionPreviewDownload').hidden=true;
      const print=button('이 양식 인쇄 / PDF 저장',()=>frame.contentWindow.postMessage({channel,type:'print'},'*'));$('collectionPreviewBody').append(print,frame);$('collectionPreview').showModal();
    }catch(e){note(e.message,true);}finally{busy=false;controls();}
  }
  $('collectionUnit3Print').onclick=unit3Print;
  $('collectionSound').onclick=async()=>{try{await api.request('set_runtime_state',{id:currentId(),soundMuted:!soundMuted});await load();}catch(e){note(e.message,true);}};
  $('collectionAssessment').onchange=load;$('collectionRefresh').onclick=load;$('collectionHistory').onchange=render;$('collectionPrint').onclick=printSelected;$('collectionDownload').onclick=downloadSelected;$('collectionClose').onclick=close;$('collectionPreview').addEventListener('close',()=>{if(url)URL.revokeObjectURL(url);url=null;});$('collectionSelectAll').onchange=()=>{$('collectionRows').querySelectorAll('input[type=checkbox]').forEach(c=>{c.checked=$('collectionSelectAll').checked;c.dispatchEvent(new Event('change'));});};
  window.addEventListener('pagehide',()=>{close();rows=[];$('collectionRows').replaceChildren();$('assessmentPrintArea').replaceChildren();});window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
  (async()=>{try{const data=await window.ScienceContentClient.request('catalog');if(data.role!=='admin')throw new Error('교사 관리자 로그인이 필요합니다.');items=data.items.filter(i=>i.kind==='assessment');const archived=await window.ScienceContentClient.request('list_archived');items.push(...archived.items.filter(i=>i.kind==='assessment'));for(const item of items){const opt=document.createElement('option');opt.value=item.id;opt.textContent=(item.archived_at?'[보관] ':'')+item.unit_title+' · '+item.title;$('collectionAssessment').append(opt);}const wanted=new URLSearchParams(location.search).get('id');if(items.some(i=>i.id===wanted))$('collectionAssessment').value=wanted;controls();if(items.length)await load();else note('등록된 수행평가가 없습니다.');}catch(e){note(e.message,true);}})();
})();
