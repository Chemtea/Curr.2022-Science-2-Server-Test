/* Every lesson uses this common shell. Editable v2 experiments run in an opaque
 * iframe; they cannot alter common authentication, grading or worksheet code. */
(async () => {
  'use strict';
  const status=document.getElementById('lesson-status');
  // Fixed tag/attribute policy: no scripts, forms, frames, SVG, styles, URLs or event handlers.
  // Images are supplied via separately authorized material attachments, not arbitrary HTML URLs.
  function safeFragment(html){
    const parsed=new DOMParser().parseFromString(String(html || ''),'text/html');
    const allowed=new Set(['P','BR','HR','DIV','SECTION','H2','H3','H4','B','STRONG','I','EM','U','S','SUB','SUP','UL','OL','LI','BLOCKQUOTE','PRE','CODE','TABLE','THEAD','TBODY','TR','TH','TD','SPAN']);
    const denied=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','TEXTAREA','SELECT','LINK','META','BASE','SVG','MATH','TEMPLATE','IMG','VIDEO','AUDIO']);
    function copy(node){
      if(node.nodeType===Node.TEXT_NODE)return document.createTextNode(node.textContent);
      if(node.nodeType!==Node.ELEMENT_NODE || denied.has(node.tagName))return document.createDocumentFragment();
      const out=allowed.has(node.tagName)?document.createElement(node.tagName.toLowerCase()):document.createDocumentFragment();
      if(out.nodeType===Node.ELEMENT_NODE && ['TD','TH'].includes(node.tagName))for(const attr of ['colspan','rowspan']){const n=Number(node.getAttribute(attr));if(Number.isInteger(n)&&n>0&&n<=10)out.setAttribute(attr,String(n));}
      for(const child of node.childNodes)out.append(copy(child));return out;
    }
    const fragment=document.createDocumentFragment();for(const child of parsed.body.childNodes)fragment.append(copy(child));return fragment;
  }
  function script(path){return new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=path;el.onload=resolve;el.onerror=()=>reject(new Error('공통 수업 기능을 불러오지 못했습니다.'));document.body.append(el);});}
  try{
    const id=new URLSearchParams(location.search).get('id');if(!id)throw new Error('수업 주소에 자료 ID가 없습니다. 메인 목록에서 다시 열어 주세요.');
    const result=await window.ScienceContentClient.request('get_content',{id});
    const item=result.item,pack=result.content;
    if(item?.format!=='lesson-pack' || !pack || !['science-lesson/v1','science-lesson/v2'].includes(pack.schema))throw new Error('지원하는 수업 패키지 형식이 아닙니다.');
    if(pack.builtin_id){
      throw new Error('이전 파일형 수업입니다. 선생님이 자료 관리에서 서버 편집형 수업으로 이관해야 합니다.');
    }
    if(!Array.isArray(pack.steps) || !pack.steps.length || pack.steps.length>4 || !Array.isArray(pack.quiz || []) || (pack.quiz || []).length>5)throw new Error('수업 단계는 1~4개, 형성평가 문항은 최대 5개여야 합니다.');
    const shellResponse=await fetch('./assets/lesson-shell.html',{cache:'no-cache'});if(!shellResponse.ok)throw new Error('공통 수업 화면을 불러오지 못했습니다.');
    document.body.innerHTML=await shellResponse.text();
    const lessonKey=item.lesson_id || 'content_'+id.replaceAll('-', '');
    const serverExperiment=pack.schema==='science-lesson/v2';
    window.LESSON_CONFIG=Object.freeze({lessonKey,unitKey:item.unit_id || '',lessonName:item.title || pack.title || '수업',pageTitle:item.title || pack.title || '수업',worksheetTitle:item.title || pack.title || '차시 학습지',templateMode:false,worksheetPath:'',trustedBuiltin:serverExperiment&&pack.originalLessonId===lessonKey});window.MASTER_LESSON_CONFIG=window.LESSON_CONFIG;
    document.title=window.LESSON_CONFIG.pageTitle;
    document.getElementById('lesson-title').textContent=window.LESSON_CONFIG.lessonName;
    document.querySelector('.header-tag').textContent='과학 플랫폼 · 수업';document.querySelector('.subtitle').textContent='수업 내용과 공통 기능을 분리한 차시입니다.';
    for(let index=0;index<4;index++){
      const step=pack.steps[index],section=document.getElementById('step'+(index+1));
      const heading=document.createElement('h2');heading.textContent=step?.title || (index===3?'형성평가':'수업 단계 '+(index+1));
      if(!serverExperiment||index===3){section.append(heading);if(step)section.append(safeFragment(step.html));}
      else section.style.setProperty('display','none','important');
      document.querySelector('#tabBtn'+(index+1)+' span').textContent=(index+1)+'단계: '+heading.textContent;
    }
    let sandbox;
    if(serverExperiment){
      await script('./assets/lesson-sandbox.js');
      const host=document.createElement('div');host.id='science-server-experiment';host.style.cssText='max-width:1050px;margin:0 auto;padding:0 15px;';
      document.querySelector('.container').before(host);sandbox=window.ScienceLessonSandbox.mount(pack,host);
    }
    const quizArea=document.getElementById('step4');
    for(const [index,q] of (pack.quiz || []).entries()){
      if(typeof q.question!=='string' || !Array.isArray(q.choices) || q.choices.length<2 || q.choices.length>6)throw new Error('문항과 선택지 형식을 확인해 주세요.');
      const block=document.createElement('div');block.className='quiz-item';block.id='quiz-block-'+(index+1);
      const title=document.createElement('div');title.className='quiz-q';title.textContent=(index+1)+'. '+q.question;block.append(title);
      q.choices.forEach((choice,ci)=>{const option=document.createElement('button');option.type='button';option.className='quiz-opt';option.textContent=(ci+1)+'. '+String(choice);option.addEventListener('click',()=>window.handleQuiz(index+1,option,ci+1));block.append(option);});
      const feedback=document.createElement('div');feedback.id='fb-'+(index+1);feedback.className='quiz-feedback-box';const feedbackTitle=document.createElement('div');feedbackTitle.id='fb-title-'+(index+1);const feedbackBody=document.createElement('div');feedbackBody.id='fb-content-'+(index+1);feedback.append(feedbackTitle,feedbackBody);block.append(feedback);quizArea.append(block);
    }
    const identity=document.createElement('div');identity.className='student-info';for(const [id,label]of[['studentIdInput','학번'],['studentNameInput','이름']]){const field=document.createElement('input');field.id=id;field.placeholder=label;field.readOnly=true;identity.append(field);}quizArea.append(identity);
    const submit=document.createElement('button');submit.type='button';submit.id='quizSubmitBtn';submit.className='submit-btn';submit.textContent='📤 선택한 답 제출';submit.addEventListener('click',()=>window.submitQuizResults());submit.hidden=!(pack.quiz || []).length;quizArea.append(submit);
    await script('./assets/lesson-master.js');window.MasterLessonRuntime.bind();
    await script('./assets/lesson-core.js');await script('./assets/lesson-content.js');await script('./assets/lesson-quiz.js');
    await script('./assets/lesson-locks.js');await script('./assets/lesson-worksheet.js');await script('./admin-quick-points.js');
    window.checkAndApplyStudentAuth();window.updateStepLockUI();window.ensureCurrentSchoolYear();
    if(sandbox)sandbox.setStep(typeof currentActiveStep==='number'?currentActiveStep:1);
  }catch(error){
    const target=document.getElementById('lesson-status');if(target)target.textContent=error.message || '수업을 불러오지 못했습니다.';
    else{document.body.replaceChildren();const message=document.createElement('p');message.textContent=error.message || '수업을 불러오지 못했습니다.';const back=document.createElement('a');back.href='index.html';back.textContent='과학 플랫폼으로 돌아가기';document.body.append(message,back);}
  }
})();
