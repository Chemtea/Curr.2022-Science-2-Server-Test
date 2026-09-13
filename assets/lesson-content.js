/* Server-backed lesson and PDF lookup. Never sends a credential into uploaded content. */
(() => {
  'use strict';
  const storage=window.platformSessionStorage;
  function identity(){try{return JSON.parse(storage.getItem('current_student') || 'null');}catch{return null;}}
  const request=(action,payload={})=>window.ScienceContentClient.request(action,payload);
  async function catalog(){const data=await request('catalog');return data.items || [];}
  let recordPromise;
  async function lessonRecord(){
    if(recordPromise)return recordPromise;
    recordPromise=(async()=>{
      const params=new URLSearchParams(location.search);let id=params.get('content_id') || params.get('id');
      if(!id){const records=await catalog();id=records.find(r=>r.kind==='lesson' && r.lesson_id===window.LESSON_CONFIG?.lessonKey)?.id;}
      if(!id)throw new Error('아직 이 차시를 테스트 서버에 등록하지 않았습니다.');
      return request('get_content',{id});
    })().catch(error=>{recordPromise=null;throw error;});
    return recordPromise;
  }
  async function worksheetAvailable(lesson_id){
    if(!identity())return false;
    const items=await catalog();return items.some(r=>r.kind==='worksheet' && r.lesson_id===lesson_id && r.format==='pdf');
  }
  async function worksheet(lesson_id){
    const items=(await catalog()).filter(r=>r.kind==='worksheet' && r.lesson_id===lesson_id && r.format==='pdf');
    items.sort((a,b)=>String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    if(!items.length)throw new Error('공개된 차시 학습지가 없습니다. 선생님이 자료 관리에서 PDF를 등록하면 여기에 연결됩니다.');
    const data=await request('get_content',{id:items[0].id});
    if(!data.file_base64 || data.mime!=='application/pdf')throw new Error('학습지 PDF를 읽을 수 없습니다.');
    const bytes=Uint8Array.from(atob(data.file_base64),c=>c.charCodeAt(0));
    return new File([bytes],(data.item?.title || items[0].title || '학습지')+'.pdf',{type:'application/pdf'});
  }
  function noteOwner(){const user=identity();return user ? String(user.isAdmin ? 'teacher' : (user.schoolYear || '')+':'+(user.studentId || '')) : 'guest';}
  window.LessonContent=Object.freeze({request,catalog,lessonRecord,worksheet,worksheetAvailable,noteOwner,identity});
})();
