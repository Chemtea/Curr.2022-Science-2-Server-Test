import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const runtimeSource = read('assets/lesson-preview-runtime.js'), quizSource = read('assets/lesson-quiz.js'), navigationSource = read('assets/lesson-navigation.js');
const clone = value => JSON.parse(JSON.stringify(value));
const CHANNEL = '945b647a-12ce-45a2-89ab-dcf0aa6e26d0', ID = '96fd013b-b592-42bd-89e5-3577bb78a464';
function payload() {
  return {item: {id: ID, version: 3, format: 'lesson-pack', title: '교사용 실험'}, label: '편집 중 미리보기', content: {
    schema: 'science-lesson/v3', title: '교사용 실험', steps: [1,2,3].map(i => ({id: 'step'+i, title: i+'단계', html: '<p>탐구 내용</p>'})),
    simulation: {html: '', css: '', js: '', dependencies: []},
    quiz: [1,2].map(i => ({id: 'q'+i, promptHtml: '어느 답일까요?', contextHtml: '<p>보기 문장</p>', choices: [{id: 'q'+i+'-a', html: '첫 답'}, {id: 'q'+i+'-b', html: '둘째 답'}], review: {stepId: 'step2', label: '실험 다시 보기'}}))
  }, quiz_data: [1,2].map(i => ({questionId:'q'+i, correct:2, choices:2, correctTitleHtml:'맞았습니다', explanationHtml:'정답 설명', explanation:'정답 설명', wrongHintHtml:'탐구를 다시 확인하세요', wrongReasons:{['q'+i+'-a']:'첫 답의 오개념'}}))};
}
function harness({saved = false, getEditable, auth = {adminSessionToken: 'adm_fixture'}} = {}) {
  const events = new Map(), timers = new Map(), messages = [], calls = [], nodes = new Map(), pointEvents = [], balances = [];
  let serial = 0, session = auth;
  class Element {
    constructor() {this.children=[]; this.style={}; this.attributes={}; this.handlers={}; this.disabled=false; this.hidden=false; this.textContent=''; const names=new Set(); this.classList={toggle:(key,on)=>on?names.add(key):names.delete(key), remove:(...keys)=>keys.forEach(key=>names.delete(key)), contains:key=>names.has(key)};}
    append(...children) {this.children.push(...children);} prepend(...children) {this.children.unshift(...children);} replaceChildren(...children) {this.children=children;}
    setAttribute(k,v) {this.attributes[k]=v;} addEventListener(k,fn) {this.handlers[k]=fn;} remove() {this.removed=true;}
    querySelectorAll(selector) {return selector==='.quiz-opt'?this.options||[]:[];}
  }
  const document = {body:new Element(), getElementById:id=>nodes.get(id), createElement:()=>new Element(), querySelectorAll(selector) {
    if (selector === '.quiz-feedback-box') return [1,2].map(q=>nodes.get('fb-'+q)).filter(Boolean);
    if (selector === '.quiz-opt') return [1,2].flatMap(q=>nodes.get('quiz-block-'+q)?.options||[]);
    if (selector === '.step-btn') return [1,2,3,4].map(n=>nodes.get('tab'+n)).filter(Boolean);
    if (selector === '.step-content') return [1,2,3,4].map(n=>nodes.get('step'+n)).filter(Boolean);
    return [];
  }};
  const parent = {postMessage:(data,origin)=>messages.push({data,origin})};
  const window = {parent, ScienceContentClient:{auth:()=>session, request:async(action, body)=>{calls.push({action,body}); if(action!=='get_editable')throw new Error('Forbidden network action: '+action); return getEditable?getEditable():payload();}},
    addEventListener(type, listener) {if(!events.has(type))events.set(type,new Set());events.get(type).add(listener);},
    removeEventListener(type,listener){events.get(type)?.delete(listener);},
    dispatchEvent(event){if(event.type==='science-points-updated')pointEvents.push(event);for(const listener of [...events.get(event.type)||[]])listener(event);},
    StudentPointBalance:{setBalance:value=>balances.push(value)},scrollTo:()=>{}
  };
  if(saved)window.parent=window;
  const context = vm.createContext({window,document,location:{origin:'https://school.example',search:saved?'?id='+ID:'?channel='+CHANNEL},URLSearchParams,crypto:{randomUUID:()=>`fixture-${++serial}`},
    Event:class{constructor(type){this.type=type;}},CustomEvent:class{constructor(type,{detail}={}){this.type=type;this.detail=detail;}},
    setTimeout:(fn)=>{const key=++serial;timers.set(key,fn);return key;},setInterval:(fn)=>{const key=++serial;timers.set(key,fn);return key;},clearTimeout:key=>timers.delete(key),clearInterval:key=>timers.delete(key),console});
  vm.runInContext(runtimeSource,context);
  const preview=window.ScienceLessonPreview;
  function send({source=parent,origin='https://school.example',channel=CHANNEL,value=payload()}={}) {window.dispatchEvent({type:'message',source,origin,data:{type:'science-preview-data',channel,payload:value}});}
  function render(content) {
    nodes.clear();for(const id of ['quiz-status','quizSubmitBtn','quiz-result-summary','studentIdInput','studentNameInput'])nodes.set(id,new Element());
    for(let n=1;n<=4;n++){nodes.set('step'+n,new Element());nodes.set('tab'+n,new Element());}
    for(let q=1;q<=content.quiz.length;q++){const block=new Element();block.options=content.quiz[q-1].choices.map(()=>new Element());nodes.set('quiz-block-'+q,block);for(const name of ['fb-','fb-title-','fb-content-'])nodes.set(name+q,new Element());}
  }
  async function mountQuiz() {
    const data=await preview.ready;window.SCIENCE_LESSON_RECORD=data;render(data.content);
    window.ScienceLessonView={safeFragment:html=>html,renderSnapshot(content){window.SCIENCE_LESSON_RECORD.content=content;render(content);}};
    vm.runInContext(navigationSource,context);preview.bindShell();vm.runInContext(quizSource,context);window.dispatchEvent({type:'science-common-ready'});return data;
  }
  return {window,preview,nodes,calls,messages,timers,balances,pointEvents,send,mountQuiz,changeAccount(next={}){session=next;window.dispatchEvent({type:'science-account-change'});},runTimers(){for(const fn of [...timers.values()])fn();}};
}

test('handshake accepts only the exact parent window, origin and one-use UUID channel',async()=>{
  const h=harness();assert.equal(h.messages[0].data.type,'science-preview-ready');assert.equal(h.messages[0].origin,'https://school.example');
  h.send({source:{}});h.send({origin:'https://other.example'});h.send({channel:'wrong'});assert.equal(h.preview.isActive(),false);
  h.send();const data=await h.preview.ready;assert.equal(data.content.title,'교사용 실험');assert.equal(data.quiz_data,undefined);assert.equal(JSON.stringify(data).includes('첫 답의 오개념'),false);
  const replacement=payload();replacement.content.title='Unexpected replacement';h.send({value:replacement});assert.equal((await h.preview.ready).content.title,'교사용 실험');assert.equal(h.calls.length,0);h.preview.destroy();
});

test('shared quiz UI exercises frozen first choice, feedback, review jump and final score without network or point writes',async()=>{
  const h=harness();h.send();await h.mountQuiz();assert.match(h.nodes.get('quizSubmitBtn').textContent,/제출 연습/);
  await h.window.handleQuiz(1,null,1);assert.equal(h.window.ScienceQuiz.state().answers[0],1);assert.ok(h.nodes.get('quiz-block-1').options.every(option=>option.disabled));
  assert.match(h.nodes.get('fb-content-1').children[0].children.join(''),/첫 답의 오개념/);
  h.nodes.get('fb-content-1').children.find(child=>child.handlers?.click).handlers.click();assert.equal(h.window.currentActiveStep,2);assert.equal(h.nodes.get('step2').classList.contains('active'),true);
  await h.window.handleQuiz(1,null,2);assert.equal(h.window.ScienceQuiz.state().answers[0],1);
  await h.window.submitQuizResults();assert.match(h.nodes.get('quiz-status').textContent,/모든 문항/);
  await h.window.handleQuiz(2,null,2);await h.window.submitQuizResults();assert.match(h.nodes.get('quiz-result-summary').textContent,/1 \/ 2점 · 실제 지급 0P/);
  await h.window.handleQuiz(1,null,2);assert.equal(h.window.ScienceQuiz.state().answers[0],1);assert.equal(h.nodes.get('quiz-block-1').options[1].attributes['aria-pressed'],'true');
  await h.window.submitQuizResults();assert.deepEqual(h.calls,[]);assert.deepEqual(h.balances,[]);assert.deepEqual(h.pointEvents,[]);h.preview.destroy();
});

test('preview transport itself rejects mutation actions, version mixups and first-choice changes',async()=>{
  const h=harness();h.send();const data=await h.preview.ready,base={id:data.item.id,version:3};
  await assert.rejects(h.preview.request('save_content',base),{code:'PREVIEW_ACTION'});
  await assert.rejects(h.preview.request('begin_quiz',{...base,version:4}),{code:'PREVIEW_VERSION'});
  const {attempt}=await h.preview.request('begin_quiz',base);const current={...base,attempt_id:attempt.id};
  await assert.rejects(h.preview.request('review_quiz',{...current,question:1,choice:2}),{code:'QUIZ_NOT_SUBMITTED'});
  await h.preview.request('answer_quiz',{...current,question:1,choice:1});
  await assert.rejects(h.preview.request('answer_quiz',{...current,question:1,choice:2}),{code:'QUIZ_ANSWER_LOCKED'});
  await assert.rejects(h.preview.request('answer_quiz',{...current,question:1,choice:3}),{code:'QUIZ_INVALID_ANSWERS'});
  assert.deepEqual(h.calls,[]);h.preview.destroy();
});

test('restart rebuilds the same shared quiz and permits a different first answer with no retained score',async()=>{
  const h=harness();h.send();await h.mountQuiz();for(let q=1;q<=2;q++)await h.window.handleQuiz(q,null,2);await h.window.submitQuizResults();const first=h.window.ScienceQuiz.state().id;
  h.preview.reset();assert.equal(h.window.ScienceQuiz.state(),null);assert.equal(h.nodes.get('quiz-result-summary').hidden,true);assert.equal(h.window.currentActiveStep,1);
  await h.window.handleQuiz(1,null,1);assert.notEqual(h.window.ScienceQuiz.state().id,first);assert.equal(h.window.ScienceQuiz.state().answers[0],1);assert.match(h.nodes.get('fb-content-1').children[0].children.join(''),/첫 답의/);assert.deepEqual(h.balances,[]);h.preview.destroy();
});

test('saved preview link reads only administrator get_editable and surfaces backend rejection',async()=>{
  const allowed=harness({saved:true});await allowed.preview.ready;assert.deepEqual(clone(allowed.calls),[{action:'get_editable',body:{id:ID}}]);allowed.preview.destroy();
  const denied=harness({saved:true,auth:{studentSessionToken:'stu_fixture'},getEditable:()=>{throw new Error('관리자 권한이 필요합니다.');}});await assert.rejects(denied.preview.ready,/관리자 권한/);assert.equal(denied.preview.isActive(),false);assert.equal(denied.calls.length,1);denied.preview.destroy();
});

test('account change clears the trusted preview and rejects all future grading or stale responses',async()=>{
  const h=harness();h.send();await h.mountQuiz();await h.window.handleQuiz(1,null,1);h.changeAccount();assert.equal(h.preview.isActive(),false);assert.equal(h.window.SCIENCE_LESSON_RECORD,null);assert.equal(h.window.ScienceQuiz.state(),null);
  await assert.rejects(h.preview.request('begin_quiz',{id:ID,version:3}),{code:'PREVIEW_CLOSED'});assert.deepEqual(h.calls,[]);assert.deepEqual(h.pointEvents,[]);
  let release;const pending=harness({saved:true,getEditable:()=>new Promise(resolve=>{release=resolve;})});const result=assert.rejects(pending.preview.ready,/미리보기/);pending.changeAccount();release(payload());await result;await Promise.resolve();assert.equal(pending.preview.isActive(),false);
});

test('invalid grading metadata cannot start a misleading preview',async()=>{
  const h=harness(),value=payload();value.quiz_data[0].correct=3;const rejected=assert.rejects(h.preview.ready,/비공개 정답/);h.send({value});await rejected;assert.equal(h.preview.isActive(),false);assert.deepEqual(h.calls,[]);h.preview.destroy();
});

test('preview entry uses shared loader and avoids student login, point, lock and worksheet modules',()=>{
  const page=read('lesson-preview.html'),loader=read('assets/lesson-loader.js');
  assert.match(page,/lesson-preview-runtime\.js/);assert.match(page,/lesson-loader\.js/);assert.doesNotMatch(page,/quiz_data|adm_|stu_|lesson-core\.js|lesson-locks\.js|admin-quick-points\.js/);
  assert.match(loader,/if\(preview\)\{preview\.bindShell\(\);await script\('\.\/assets\/lesson-quiz\.js'\)/);
  assert.doesNotMatch(runtimeSource,/setItem\(|localStorage|sessionStorage|fetch\(/);
  assert.match(read('assets/lesson-sandbox.js'),/setAttribute\('sandbox','allow-scripts'\)/);
});

test('logout while a shared script is loading cannot remount a discarded lesson or experiment',async()=>{
  const events=new Map(),scripts=[],failures=[];let active=true,mounted=0,registeredBeforeFetch=false;
  const status={textContent:''},data=payload();
  const window={ScienceContentClient:{auth:()=>({adminSessionToken:'adm_fixture'})},ScienceLessonPreview:{ready:Promise.resolve({item:data.item,content:data.content}),isActive:()=>active,fail:cause=>failures.push(cause.message)},ScienceLessonSandbox:{mount(){mounted++;throw new Error('stale experiment remounted');}},addEventListener(type,listener){events.set(type,listener);}};
  const document={body:{innerHTML:'',append:element=>scripts.push(element)},getElementById:id=>id==='lesson-status'?status:null,createElement:()=>({})};
  const completion=vm.runInNewContext(read('assets/lesson-loader.js'),{window,document,location:{search:'?channel='+CHANNEL},URLSearchParams,fetch:async()=>{registeredBeforeFetch=events.has('science-preview-close');return {ok:true,text:async()=>'<p>shell or css</p>'};}});
  for(let i=0;i<30&&!scripts.length;i++)await Promise.resolve();assert.equal(scripts.length,1);assert.equal(registeredBeforeFetch,true);
  active=false;events.get('science-preview-close')();scripts[0].onload();await completion;
  assert.equal(mounted,0);assert.equal(scripts.length,1);assert.match(failures.join(' '),/미리보기가 종료/);assert.equal(window.SCIENCE_LESSON_RECORD,undefined);
});
