/* Common server-graded formative quiz. No answer keys are shipped in this module. */
const LESSON_NAME=window.LESSON_CONFIG.lessonName;
const TOTAL_QUESTIONS=document.querySelectorAll('[id^="quiz-block-"]').length;
const userQuizState=Object.fromEntries(Array.from({length:TOTAL_QUESTIONS},(_,i)=>['q'+(i+1),null]));
let isSubmitted=false;
const quizRequestId=crypto.randomUUID();
function handleQuiz(qNum,el,optNum){
  if(isSubmitted)return;
  if(!Number.isInteger(qNum) || !Number.isInteger(optNum))return;
  const block=document.getElementById('quiz-block-'+qNum);if(!block)return;
  userQuizState['q'+qNum]=optNum;
  block.querySelectorAll('.quiz-opt').forEach(opt=>{opt.classList.remove('correct','incorrect');opt.style.outline=opt===el?'2px solid #38bdf8':'';opt.setAttribute('aria-pressed',String(opt===el));});
  const box=document.getElementById('fb-'+qNum),title=document.getElementById('fb-title-'+qNum),body=document.getElementById('fb-content-'+qNum);
  if(box){box.style.display='block';box.className='quiz-feedback-box';}
  if(title)title.textContent=optNum+'번을 선택했습니다.';
  if(body)body.textContent='모든 문항을 선택하고 제출하면 서버에서 채점 결과를 알려 줍니다.';
}
async function submitQuizResults(){
  if(isSubmitted)return;
  const user=window.LessonContent.identity();
  if(!user || user.isAdmin===true || !String(user.studentSessionToken || '').startsWith('stu_')){alert('학생 계정으로 로그인한 뒤 제출해 주세요.');if(typeof openPageLoginModal==='function')openPageLoginModal();return;}
  const answers=Array.from({length:TOTAL_QUESTIONS},(_,i)=>userQuizState['q'+(i+1)]);
  if(!answers.length || answers.some(x=>!Number.isInteger(x))){alert('모든 문항의 답을 선택해 주세요.');return;}
  const button=document.getElementById('quizSubmitBtn');button.disabled=true;button.textContent='⏳ 서버에서 채점 중…';
  try{
    const record=await window.LessonContent.lessonRecord();
    const data=await window.LessonContent.request('submit_quiz',{id:record.item.id,answers,requestId:quizRequestId});
    isSubmitted=true;
    for(const result of data.feedback || []){
      const q=result.question,box=document.getElementById('fb-'+q),title=document.getElementById('fb-title-'+q),body=document.getElementById('fb-content-'+q);
      if(box){box.style.display='block';box.className='quiz-feedback-box '+(result.correct?'is-correct':'is-incorrect');}
      if(title)title.textContent=(result.correct?'✅ 정답':'다시 살펴보세요')+' · 선택 '+result.selected+'번 / 정답 '+result.correctChoice+'번';
      if(body){const doc=new DOMParser().parseFromString(String(result.explanation || ''),'text/html');body.textContent=doc.body.textContent;}
    }
    button.textContent='✅ 제출 완료 · '+data.score+'/'+data.total+'점';
    if(window.StudentPointBalance && Number.isFinite(Number(data.currentPoints)))window.StudentPointBalance.setBalance(Number(data.currentPoints));
    alert('서버 채점 결과: '+data.score+'/'+data.total+'점'+(data.pointsEnabled===false?'\n테스트 채점: 포인트 적립은 연결하지 않았습니다.':'\n지급 포인트: '+Number(data.awardedPoints || 0)+'P'));
  }catch(error){button.disabled=false;button.textContent='📤 문제풀이 결과 교사에게 제출';alert(error.message || '제출하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');}
}
