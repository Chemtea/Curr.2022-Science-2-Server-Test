import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../assets/lesson-quiz.js',import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
function harness({schema='science-lesson/v3'}={}){
  const nodes=new Map(),events=new Map(),sent=[],pointBalances=[],pointEvents=[];let session='stu_first',pending=null,failAnswer=false;
  class Element{constructor(){this.children=[];this.style={};this.attributes={};this.handlers={};this.disabled=false;this.hidden=false;this.textContent='';const names=new Set();this.classList={toggle:(name,on)=>on?names.add(name):names.delete(name),contains:name=>names.has(name)};}
    append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;}setAttribute(k,v){this.attributes[k]=v;}addEventListener(k,fn){this.handlers[k]=fn;}querySelectorAll(selector){return selector==='.quiz-opt'?this.options||[]:[];}}
  const content={schema,title:'새 차시',quiz:Array.from({length:4},(_,i)=>({id:'q'+(i+1),promptHtml:'문제 '+i,choices:[{id:'a',html:'첫 답'},{id:'b',html:'둘째 답'}],review:{stepId:'step2',label:'관련 탐구'}}))};
  const record={item:{id:'content-id',version:3},content};let activeStep=4;
  function render(){nodes.clear();for(const id of ['quiz-status','quizSubmitBtn','quiz-result-summary'])nodes.set(id,new Element());for(let q=1;q<=4;q++){const block=new Element();block.options=[new Element(),new Element()];nodes.set('quiz-block-'+q,block);for(const name of ['fb-','fb-title-','fb-content-'])nodes.set(name+q,new Element());}}
  render();
  let saved={id:'attempt-id',contentVersion:3,content:clone(content),answers:[null,null,null,null],feedback:[null,null,null,null],submitted:false,result:null};
  function feedback(q,choice){return{question:q,selected:choice,correct:choice===2,titleHtml:choice===2?'정답 제목':'다시 살펴보세요',explanationHtml:'정답 설명',hintHtml:'힌트',reasonHtml:choice===2?'':'선택지별 이유',review:{stepId:'step2',label:'관련 탐구'}};}
  async function request(action,payload){sent.push({action,payload});if(pending)return new Promise(resolve=>{pending.release=resolve;});if(action==='begin_quiz')return{success:true,attempt:clone(saved)};if(action==='answer_quiz'){if(failAnswer)throw new Error('연결 오류');const i=payload.question-1;if(saved.answers[i]!==null&&saved.answers[i]!==payload.choice)throw new Error('최초 선택 고정');saved.answers[i]=payload.choice;saved.feedback[i]=feedback(payload.question,payload.choice);return{success:true,attempt:clone(saved),feedback:clone(saved.feedback[i])};}if(action==='submit_quiz'&&!payload.attempt_id)return{success:true,score:3,total:4,awardedPoints:15,currentPoints:42,feedback:payload.answers.map((choice,i)=>({question:i+1,selected:choice,correctChoice:2,explanation:'이전 설명'}))};if(action==='submit_quiz'){if(saved.answers.some(x=>x===null))throw new Error('모든 문항');saved.submitted=true;saved.result={score:3,total:4,awardedPoints:15,currentPoints:42,duplicate:false};return{success:true,attempt:clone(saved)};}if(action==='review_quiz')return{success:true,attempt:clone(saved),feedback:feedback(payload.question,payload.choice)};throw new Error(action);}
  const window={SCIENCE_LESSON_RECORD:record,ScienceContentClient:{auth:()=>({studentSessionToken:session})},LessonContent:{request,identity:()=>({studentSessionToken:session})},ScienceLessonView:{safeFragment:html=>html,renderSnapshot(snapshot){record.content=snapshot;render();}},StudentPointBalance:{setBalance:n=>pointBalances.push(n)},trySwitchStep:n=>{activeStep=n;},addEventListener(name,fn){events.set(name,fn);},dispatchEvent(event){if(event.type==='science-points-updated')pointEvents.push(event.detail);events.get(event.type)?.(event);}};
  const document={getElementById:id=>nodes.get(id),createElement:()=>new Element(),querySelectorAll:selector=>selector==='.quiz-feedback-box'?[1,2,3,4].map(q=>nodes.get('fb-'+q)):[]};
  let uuid=0;vm.runInNewContext(source,{window,document,crypto:{randomUUID:()=>`request-${++uuid}`},CustomEvent:class{constructor(type,{detail}={}){this.type=type;this.detail=detail;}},console});
  return{window,nodes,sent,pointBalances,pointEvents,events,saved,getStep:()=>activeStep,hold(){pending={};return pending;},unhold(){pending=null;},setSession(value){session=value;},fail(value){failAnswer=value;},setSaved(value){saved=value;}};
}
test('first choice is sent once, immediately shows authored wrong reason and disables all options',async()=>{
 const h=harness();await h.window.handleQuiz(1,null,1);assert.deepEqual(h.sent.map(x=>x.action),['begin_quiz','answer_quiz']);assert.equal(h.sent[0].payload.version,3);assert.equal(h.saved.answers[0],1);assert.ok(h.nodes.get('quiz-block-1').options.every(x=>x.disabled));assert.match(h.nodes.get('fb-content-1').children[0].children.join(''),/선택지별 이유/);await h.window.handleQuiz(1,null,2);assert.equal(h.sent.length,2);assert.equal(h.saved.answers[0],1);h.nodes.get('fb-content-1').children.find(x=>x.handlers?.click).handlers.click();assert.equal(h.getStep(),2);
});
test('final submission enables only after all answers; review cannot change initial answers or award again',async()=>{
 const h=harness();await h.window.handleQuiz(1,null,1);assert.equal(h.nodes.get('quizSubmitBtn').disabled,true);for(let q=2;q<=4;q++)await h.window.handleQuiz(q,null,2);assert.equal(h.nodes.get('quizSubmitBtn').disabled,false);await h.window.submitQuizResults();assert.equal(h.saved.submitted,true);assert.deepEqual(h.pointBalances,[42]);assert.match(h.nodes.get('quiz-result-summary').textContent,/15P/);assert.ok(h.nodes.get('quiz-block-1').options.every(x=>!x.disabled));await h.window.handleQuiz(1,null,2);assert.equal(h.sent.at(-1).action,'review_quiz');assert.equal(h.saved.answers[0],1);assert.deepEqual(h.pointBalances,[42]);assert.match(h.nodes.get('fb-content-1').children.at(-1).textContent,/기존 점수·포인트/);await h.window.submitQuizResults();assert.equal(h.sent.filter(x=>x.action==='submit_quiz').length,1);
});
test('failed recording leaves choices available and keeps a visible error for retry',async()=>{
 const h=harness();h.fail(true);await h.window.handleQuiz(1,null,1);assert.equal(h.saved.answers[0],null);assert.ok(h.nodes.get('quiz-block-1').options.every(x=>!x.disabled));assert.match(h.nodes.get('quiz-status').textContent,/연결 오류/);h.fail(false);await h.window.handleQuiz(1,null,1);assert.equal(h.saved.answers[0],1);
});
test('an old account submission response cannot update the new account balance or render its feedback',async()=>{
 const h=harness();for(let q=1;q<=4;q++)await h.window.handleQuiz(q,null,2);const pending=h.hold();const submitting=h.window.submitQuizResults();for(let i=0;i<6;i++)await Promise.resolve();h.setSession('stu_second');h.events.get('science-account-change')();pending.release({success:true,attempt:{...h.saved,submitted:true,result:{score:4,total:4,awardedPoints:20,currentPoints:99}}});await submitting;assert.deepEqual(h.pointBalances,[]);assert.equal(h.window.ScienceQuiz.state(),null);assert.equal(h.nodes.get('quiz-result-summary').hidden,true);
});
test('restoring a submitted historical attempt permits review without claiming a new point award',async()=>{
 const h=harness();h.setSaved({...h.saved,submitted:true,historicalSubmission:true,answers:[null,null,null,null],result:{score:4,total:4,awardedPoints:20,currentPoints:20,duplicate:true}});await h.window.ScienceQuiz.restore();assert.equal(h.nodes.get('quizSubmitBtn').disabled,true);assert.match(h.nodes.get('quiz-result-summary').textContent,/이미 처리된/);assert.deepEqual(h.pointBalances,[]);await h.window.handleQuiz(1,null,2);assert.match(h.nodes.get('fb-content-1').children.at(-1).textContent,/이전에 제출한 기록/);
});

test('restored v1/v2 versions keep the legacy submit endpoint and never call the v3 attempt engine',async()=>{
 const h=harness({schema:'science-lesson/v2'});await h.window.handleQuiz(1,null,1);await h.window.handleQuiz(1,null,2);for(let q=2;q<=4;q++)await h.window.handleQuiz(q,null,2);assert.equal(h.sent.length,0);await h.window.submitQuizResults();assert.deepEqual(h.sent.map(x=>x.action),['submit_quiz']);assert.deepEqual(clone(h.sent[0].payload.answers),[2,2,2,2]);assert.equal(h.sent[0].payload.attempt_id,undefined);assert.deepEqual(h.pointBalances,[42]);await h.window.handleQuiz(1,null,1);assert.equal(h.sent.length,1);assert.match(h.nodes.get('quiz-status').textContent,/복습 중/);
});

test('a first click on newer reordered choices is discarded when begin restores an older snapshot',async()=>{
 const h=harness();const older=clone(h.saved);older.contentVersion=2;older.content.quiz[0].choices.reverse();h.setSaved(older);const held=h.hold();const click=h.window.handleQuiz(1,null,1);assert.ok(h.nodes.get('quiz-block-1').options.every(option=>option.disabled),'choices stay disabled while restoring');for(let i=0;i<4;i++)await Promise.resolve();held.release({success:true,attempt:clone(older)});h.unhold();await click;assert.deepEqual(h.sent.map(entry=>entry.action),['begin_quiz'],'never applies the newer displayed choice to the older question');assert.deepEqual(h.window.ScienceQuiz.state().answers,[null,null,null,null]);assert.match(h.nodes.get('quiz-status').textContent,/선택지를 확인/);assert.equal(h.window.SCIENCE_LESSON_RECORD.content.quiz[0].choices[0].id,'b');await h.window.handleQuiz(1,null,1);assert.equal(h.sent.at(-1).action,'answer_quiz');assert.equal(h.sent.at(-1).payload.version,2);assert.equal(h.window.ScienceQuiz.state().answers[0],1);
});

test('restoring an attempt disables all choices and drops queued clicks until it settles',async()=>{
 const h=harness();const held=h.hold();const restoring=h.window.ScienceQuiz.restore();assert.ok(h.nodes.get('quiz-block-1').options.every(option=>option.disabled));await h.window.handleQuiz(1,null,2);assert.deepEqual(h.sent.map(entry=>entry.action),['begin_quiz']);held.release({success:true,attempt:clone(h.saved)});h.unhold();await restoring;assert.ok(h.nodes.get('quiz-block-1').options.every(option=>!option.disabled));assert.deepEqual(h.window.ScienceQuiz.state().answers,[null,null,null,null]);
});

test('reviewing a second question retains the first question review selection and feedback',async()=>{
 const h=harness();for(let q=1;q<=4;q++)await h.window.handleQuiz(q,null,1);await h.window.submitQuizResults();await h.window.handleQuiz(1,null,2);assert.equal(h.nodes.get('quiz-block-1').options[1].attributes['aria-pressed'],'true');assert.match(h.nodes.get('fb-content-1').children.at(-1).textContent,/복습 중/);await h.window.handleQuiz(2,null,2);assert.equal(h.nodes.get('quiz-block-1').options[1].attributes['aria-pressed'],'true');assert.equal(h.nodes.get('quiz-block-1').options[0].attributes['aria-pressed'],'false');assert.match(h.nodes.get('fb-content-1').children.at(-1).textContent,/복습 중/);assert.equal(h.nodes.get('quiz-block-2').options[1].attributes['aria-pressed'],'true');assert.deepEqual(h.saved.answers,[1,1,1,1]);
});

test('a balance helper without a setter cannot turn a saved submission into an error',async()=>{
 const h=harness();h.window.StudentPointBalance={};for(let q=1;q<=4;q++)await h.window.handleQuiz(q,null,2);await h.window.submitQuizResults();assert.equal(h.window.ScienceQuiz.state().submitted,true);assert.match(h.nodes.get('quiz-status').textContent,/제출 완료/);assert.equal(h.pointEvents.length,1);
});
