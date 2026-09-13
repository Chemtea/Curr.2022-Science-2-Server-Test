/* First-answer quiz lifecycle. The server owns answers, grading and point awards. */
(() => {
  'use strict';
  if(!window.SCIENCE_LESSON_RECORD?.content)return;
  if(window.SCIENCE_LESSON_RECORD?.content?.schema!=='science-lesson/v3'){installLegacyQuiz();return;}
  const preview=window.ScienceLessonPreview || null;
  let attempt=null,beginPromise=null,busy=false,epoch=0,reviewChoices={},reviewFeedback={},submitRequest=crypto.randomUUID();
  let lastError='';
  let owner=JSON.stringify(window.ScienceContentClient.auth());
  const request=(action,payload)=>preview?preview.request(action,payload):window.LessonContent.request(action,payload);
  const record=()=>window.SCIENCE_LESSON_RECORD;
  const identity=()=>window.LessonContent?.identity() || null;
  const student=()=>{if(preview)return preview.isActive();const user=identity();return user&&user.isAdmin!==true&&String(user.studentSessionToken||'').startsWith('stu_');};
  function status(text){const el=document.getElementById('quiz-status');if(el)el.textContent=text;}
  function fragment(html){return window.ScienceLessonView.safeFragment(html);}
  function renderFeedback(q,result,isReview=false){
    if(!result)return;
    const block=document.getElementById('quiz-block-'+q),box=document.getElementById('fb-'+q),title=document.getElementById('fb-title-'+q),body=document.getElementById('fb-content-'+q);if(!block||!box)return;
    box.style.display='block';box.className='quiz-feedback-box '+(result.correct?'is-correct':'is-incorrect');title.className='fb-header '+(result.correct?'correct':'incorrect');title.replaceChildren(fragment(result.titleHtml || (result.correct?'✅ 정답입니다!':'다시 살펴보세요')));body.replaceChildren();
    const detail=(html,cls)=>{if(!html)return;const el=document.createElement('div');el.className='fb-detail-card '+cls;el.append(fragment(html));body.append(el);};
    if(result.correct)detail(result.explanationHtml || result.explanation,'fb-expl');else{detail(result.reasonHtml,'fb-reason');detail(result.hintHtml,'fb-hint');if(!result.reasonHtml&&!result.hintHtml)detail(result.explanationHtml || result.explanation,'fb-expl');}
    const review=result.review || record()?.content?.quiz?.[q-1]?.review;
    if(review&&/^step[123]$/.test(review.stepId)){const button=document.createElement('button');button.type='button';button.className='goto-sim-btn';button.textContent=review.label || '관련 단계에서 다시 확인';button.addEventListener('click',()=>window.trySwitchStep(Number(review.stepId.slice(4))));body.append(button);}
    if(isReview){const note=document.createElement('p');note.className='quiz-review-note';note.textContent=Number.isInteger(attempt.answers[q-1])?'복습 중 · 제출한 답 '+attempt.answers[q-1]+'번과 기존 점수·포인트는 그대로 유지됩니다.':'복습 중 · 이전에 제출한 기록과 포인트는 그대로 유지됩니다.';body.append(note);}
    const selected=isReview?reviewChoices[q]:attempt.answers[q-1];block.querySelectorAll('.quiz-opt').forEach((option,index)=>{const chosen=index+1===selected;option.classList.toggle('correct',chosen&&result.correct);option.classList.toggle('incorrect',chosen&&!result.correct);option.setAttribute('aria-pressed',String(chosen));});
  }
  function updateControls(){
    const questions=record()?.content?.quiz || [];
    questions.forEach((q,index)=>{const block=document.getElementById('quiz-block-'+(index+1));if(block)block.querySelectorAll('.quiz-opt').forEach(option=>{option.disabled=busy||!!beginPromise||(!attempt?.submitted&&Number.isInteger(attempt?.answers?.[index]));});});
    const button=document.getElementById('quizSubmitBtn');if(!button)return;
    const answered=(attempt?.answers||[]).filter(Number.isInteger).length;
    button.disabled=busy||!!beginPromise||!!attempt?.submitted||answered!==questions.length||!questions.length||!student();button.textContent=(busy||beginPromise)?(preview?'⏳ 미리보기 풀이 확인 중…':'⏳ 서버 기록 확인 중…'):attempt?.submitted?(preview?'✅ 제출 연습 완료 · 복습할 답을 골라 보세요':'✅ 제출 완료 · 복습할 답을 골라 보세요'):(preview?'✓ 제출 연습 · 점수 확인':'📤 문제풀이 결과 교사에게 제출');
    if(!student())status(identity()?.isAdmin?'교사용 보기입니다. 실제 풀이와 포인트 지급은 학생 계정으로 확인하세요.':'학생 계정으로 로그인하면 답과 제출 결과를 기록할 수 있습니다.');
    else if(beginPromise)status(preview?'미리보기 풀이를 준비하고 있습니다…':'기존 풀이 기록과 문항 버전을 확인하고 있습니다…');
    else if(attempt?.submitted)status(preview?'제출 연습 완료 · 실제 기록·포인트 변화 없이 답을 다시 골라 복습할 수 있습니다.':'제출 완료 · 자유롭게 답을 다시 골라 복습할 수 있습니다.');
    else if(attempt)status(answered+'/'+questions.length+'문항 기록 완료 · 처음 선택한 답은 제출 전 변경할 수 없습니다.');
    else if(preview)status('교사용 연습입니다. 답을 고르면 실제 수업과 같은 피드백이 나타납니다.');
    if(lastError)status(lastError);
    const summary=document.getElementById('quiz-result-summary');
    if(summary){summary.hidden=!attempt?.submitted;if(attempt?.submitted){const result=attempt.result||{};summary.textContent=preview?'미리보기 결과 '+Number(result.score||0)+' / '+Number(result.total||questions.length)+'점 · 실제 지급 0P · 학생 기록은 저장하지 않았습니다.':'제출 결과 '+Number(result.score||0)+' / '+Number(result.total||questions.length)+'점 · 제출 지급 기록 '+Number(result.awardedPoints||0)+'P'+(Number.isFinite(Number(result.currentPoints))?' · 현재 잔액 '+Number(result.currentPoints)+'P':'')+(result.duplicate?' · 이미 처리된 제출을 다시 불러왔습니다.':'');}}
  }
  function adopt(data){
    const next=data.attempt;if(!next)throw new Error('형성평가 기록을 불러오지 못했습니다.');
    const changed=next.content&&JSON.stringify(next.content)!==JSON.stringify(record().content);
    if(changed||(attempt&&(next.id!==attempt.id||next.contentVersion!==attempt.contentVersion))){reviewChoices={};reviewFeedback={};}
    attempt=next;
    if(changed)window.ScienceLessonView.renderSnapshot(next.content);
    for(const [index,feedback] of (attempt.feedback||[]).entries())renderFeedback(index+1,feedback);
    if(attempt.submitted)for(const [question,feedback] of Object.entries(reviewFeedback))renderFeedback(Number(question),feedback,true);
    updateControls();
  }
  function checkOwner(){const next=JSON.stringify(window.ScienceContentClient.auth());if(next!==owner){reset();owner=next;throw new Error('로그인 계정이 바뀌었습니다. 화면을 새로고침해 주세요.');}}
  async function begin(){
    checkOwner();if(attempt)return attempt;if(beginPromise)return beginPromise;if(!student())throw new Error('학생 계정으로 로그인한 뒤 문제를 풀어 주세요.');
    const generation=epoch;
    beginPromise=(async()=>{const current=record();const data=await request('begin_quiz',{id:current.item.id,version:current.item.version,request_id:crypto.randomUUID()});if(epoch!==generation)return null;checkOwner();adopt(data);return attempt;})().finally(()=>{if(epoch===generation){beginPromise=null;updateControls();}});updateControls();return beginPromise;
  }
  async function handleQuiz(q,element,choice){
    if(busy||beginPromise||!Number.isInteger(q)||!Number.isInteger(choice))return;
    if(!student()){status('학생 계정으로 로그인한 뒤 문제를 풀어 주세요.');window.openPageLoginModal?.();return;}
    const generation=epoch,clickedContent=JSON.stringify(record().content),clickedVersion=attempt?.contentVersion??record().item.version;lastError='';busy=true;updateControls();
    try{
      const current=await begin();if(!current||generation!==epoch)return;
      if(current.contentVersion!==clickedVersion||JSON.stringify(record().content)!==clickedContent){lastError='이전에 풀던 문항 버전을 복원했습니다. 바뀐 문항과 선택지를 확인한 뒤 답을 다시 골라 주세요.';return;}
      if(q<1||q>current.answers.length)throw new Error('문항 구성이 바뀌었습니다. 새로고침해 주세요.');
      if(!current.submitted&&Number.isInteger(current.answers[q-1])){status('이미 처음 선택한 답이 기록되었습니다. 제출한 뒤 다시 선택하며 복습할 수 있습니다.');return;}
      const data=await request(current.submitted?'review_quiz':'answer_quiz',{id:record().item.id,version:current.contentVersion,attempt_id:current.id,question:q,choice,request_id:crypto.randomUUID()});
      if(generation!==epoch)return;checkOwner();adopt(data);
      if(current.submitted){reviewChoices[q]=choice;reviewFeedback[q]=data.feedback;renderFeedback(q,data.feedback,true);}
    }catch(error){if(generation===epoch){lastError=error.message||'답을 기록하지 못했습니다. 같은 답을 다시 눌러 확인해 주세요.';if(['QUIZ_ANSWER_LOCKED','QUIZ_ALREADY_SUBMITTED'].includes(error.code)){try{const recovered=await request('begin_quiz',{id:record().item.id,version:record().item.version,request_id:crypto.randomUUID()});if(generation===epoch){checkOwner();adopt(recovered);}}catch{}}}}
    finally{if(generation===epoch){busy=false;updateControls();}}
  }
  async function submitQuizResults(){
    if(busy||attempt?.submitted)return;const generation=epoch;lastError='';busy=true;updateControls();
    try{
      const current=await begin();if(!current||generation!==epoch)return;if(current.answers.some(answer=>!Number.isInteger(answer)))throw new Error('모든 문항의 답을 선택해 주세요.');
      const data=await request('submit_quiz',{id:record().item.id,version:current.contentVersion,attempt_id:current.id,request_id:submitRequest});
      if(generation!==epoch)return;checkOwner();adopt(data);const result=attempt.result||data;
      if(!preview){
        if(typeof window.StudentPointBalance?.setBalance==='function'&&Number.isFinite(Number(result.currentPoints)))window.StudentPointBalance.setBalance(Number(result.currentPoints));
        window.dispatchEvent(new CustomEvent('science-points-updated',{detail:{currentPoints:result.currentPoints,awardedPoints:result.duplicate?0:result.awardedPoints,duplicate:result.duplicate===true}}));
      }
    }catch(error){if(generation===epoch)lastError=error.message||'제출 상태를 확인하지 못했습니다. 같은 제출 버튼으로 다시 확인해 주세요.';}
    finally{if(generation===epoch){busy=false;updateControls();}}
  }
  function reset(){epoch++;lastError='';attempt=null;beginPromise=null;busy=false;reviewChoices={};reviewFeedback={};submitRequest=crypto.randomUUID();for(const box of document.querySelectorAll('.quiz-feedback-box'))box.style.display='none';for(const option of document.querySelectorAll('.quiz-opt')){option.classList.remove('correct','incorrect');option.setAttribute('aria-pressed','false');}updateControls();}
  async function restore(){if(!student()||busy||attempt)return;try{await begin();}catch(error){lastError=error.message;}updateControls();}
  function installLegacyQuiz(){
    const current=window.SCIENCE_LESSON_RECORD,questions=current.content.quiz||[];
    let answers=questions.map(()=>null),result=null,busy=false,epoch=0,owner=JSON.stringify(window.ScienceContentClient.auth()),requestId=crypto.randomUUID();
    const status=text=>{const el=document.getElementById('quiz-status');if(el)el.textContent=text;};
    const student=()=>{const user=window.LessonContent.identity();return user&&user.isAdmin!==true&&String(user.studentSessionToken||'').startsWith('stu_');};
    function controls(){const button=document.getElementById('quizSubmitBtn');button.disabled=busy||!!result||answers.some(value=>!Number.isInteger(value))||!student();button.textContent=busy?'⏳ 서버에서 채점 중…':result?'✅ 제출 완료 · 복습할 답을 골라 보세요':'📤 문제풀이 결과 교사에게 제출';}
    function paint(q,choice,feedback){const block=document.getElementById('quiz-block-'+q);if(!block)return;block.querySelectorAll('.quiz-opt').forEach((option,index)=>{const selected=index+1===choice;option.setAttribute('aria-pressed',String(selected));option.style.outline=selected&&!feedback?'2px solid #38bdf8':'';option.classList.toggle('correct',selected&&!!feedback&&choice===feedback.correctChoice);option.classList.toggle('incorrect',selected&&!!feedback&&choice!==feedback.correctChoice);});if(!feedback)return;const box=document.getElementById('fb-'+q);box.style.display='block';box.className='quiz-feedback-box '+(choice===feedback.correctChoice?'is-correct':'is-incorrect');document.getElementById('fb-title-'+q).textContent=choice===feedback.correctChoice?'✅ 정답입니다!':'다시 살펴보세요';document.getElementById('fb-content-'+q).replaceChildren(window.ScienceLessonView.safeFragment(feedback.explanation||''));}
    async function choose(q,el,choice){if(busy||!Number.isInteger(q)||!Number.isInteger(choice)||q<1||q>questions.length||choice<1||choice>questions[q-1].choices.length)return;if(!student()){status('학생 계정으로 로그인해 주세요.');window.openPageLoginModal?.();return;}if(!result){answers[q-1]=choice;paint(q,choice,null);status('답을 선택했습니다. 모든 문항을 선택하고 제출하면 채점합니다.');}else{paint(q,choice,result.feedback?.find(item=>item.question===q));status('복습 중 · 제출한 답과 점수·포인트는 바뀌지 않습니다.');}controls();}
    async function submit(){if(busy||result||!student()||answers.some(value=>!Number.isInteger(value)))return;const generation=epoch;busy=true;controls();try{const data=await window.LessonContent.request('submit_quiz',{id:current.item.id,answers,requestId});if(generation!==epoch||owner!==JSON.stringify(window.ScienceContentClient.auth()))return;result=data;for(const feedback of data.feedback||[])paint(feedback.question,feedback.selected,feedback);const summary=document.getElementById('quiz-result-summary');summary.hidden=false;summary.textContent='제출 결과 '+data.score+' / '+data.total+'점 · 제출 지급 기록 '+Number(data.awardedPoints||0)+'P'+(data.duplicate?' · 이미 처리된 제출입니다.':'');if(typeof window.StudentPointBalance?.setBalance==='function'&&Number.isFinite(Number(data.currentPoints)))window.StudentPointBalance.setBalance(Number(data.currentPoints));status('제출 완료 · 답을 다시 골라 복습할 수 있습니다.');}catch(error){if(generation===epoch)status(error.message||'제출하지 못했습니다. 같은 버튼으로 다시 확인해 주세요.');}finally{if(generation===epoch){busy=false;controls();}}}
    function reset(){epoch++;answers=questions.map(()=>null);result=null;busy=false;requestId=crypto.randomUUID();owner=JSON.stringify(window.ScienceContentClient.auth());for(const box of document.querySelectorAll('.quiz-feedback-box'))box.style.display='none';const summary=document.getElementById('quiz-result-summary');if(summary)summary.hidden=true;controls();}
    window.handleQuiz=choose;window.submitQuizResults=submit;window.ScienceQuiz=Object.freeze({reset,state:()=>({answers,submitted:!!result,result})});window.addEventListener('science-common-ready',controls);window.addEventListener('science-account-change',reset);controls();
  }
  window.handleQuiz=handleQuiz;window.submitQuizResults=submitQuizResults;window.ScienceQuiz=Object.freeze({begin,reset,restore,state:()=>attempt});
  window.addEventListener('lesson-step-change',event=>{if(event.detail===4)restore();});window.addEventListener('science-common-ready',updateControls);window.addEventListener('science-account-change',()=>{if(JSON.stringify(window.ScienceContentClient.auth())!==owner)reset();});updateControls();
})();
