import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
import {publicPack, quizData} from '../supabase/functions/content-api/index.ts';

function setup() {
  const original=fs.readFileSync(new URL('../assets/content-editor.js',import.meta.url),'utf8');
  const window={ScienceContentClient:{auth:()=>({adminSessionToken:'test'})}};
  const source=original.replace('\n  init();\n','\n  window.__test = {state, validatePack, buildPayload, capture, renumberV3, setRefs: value => { refs = value; }};\n');
  vm.runInNewContext(source,{window,document:{},isAdminMode:true});return window.__test;
}
const value=value=>({value});
function data() {
  const content={schema:'science-lesson/v3',title:'Original page title',display:{titleHtml:'<b>Header</b>',headerTag:'Classification',subtitleHtml:'<em>Subtitle</em>',footerHtml:'Footer',contentMaxWidth:950,tabs:['Stage 1','Stage 2','Stage 3','Quiz']},steps:[1,2,3].map(n=>({id:'step'+n,title:'Stage '+n,html:'<canvas id="lab'+n+'"></canvas>'})),quiz:[{id:'q1',promptHtml:'<b>Question</b>',contextHtml:'<blockquote>Context</blockquote>',choices:[{id:'q1-c1',html:'<b>One</b>'},{id:'q1-c2',html:'Two'}],review:{stepId:'step2',label:'Review stage 2'}}],simulation:{html:'',css:'#lab2{height:20px}',js:'window.scientificValue=7;',dependencies:[],hostContract:'science-experiment-content/v1',microphone:true}};
  const keys=[{questionId:'q1',correct:2,choices:2,explanation:'<b>Explanation</b>',explanationHtml:'<b>Explanation</b>',correctTitleHtml:'Correct',wrongHintHtml:'Hint',wrongReasons:{'q1-c1':'Reason'}}];
  return {content,keys};
}
function prime(t, content, keys) {
  t.state.item={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',version:3,kind:'lesson',format:'lesson-pack',title:'Stored title',unit_id:'unit7',unit_title:'Unit 7',lesson_id:'new_lesson'};t.state.content=structuredClone(content);t.state.keys=structuredClone(keys);
  t.setRefs({title:value('Stored title'),unit:value('unit7'),unitTitle:value('Unit 7'),lesson:value('new_lesson'),description:value('Description'),pageTitle:value(content.title),display:Object.fromEntries(Object.entries(content.display).filter(([k])=>k!=='tabs').map(([k,v])=>[k,value(v)])),quizTab:value(content.display.tabs[3]),steps:content.steps.map(s=>({title:value(s.title),html:value(s.html)})),quiz:content.quiz.map((q,i)=>({question:value(q.promptHtml),context:value(q.contextHtml),choices:q.choices.map(c=>value(c.html)),correct:value(keys[i].correct),explanation:value(keys[i].explanationHtml),correctTitle:value(keys[i].correctTitleHtml),wrongHint:value(keys[i].wrongHintHtml),reviewStep:value(q.review.stepId),reviewLabel:value(q.review.label),wrongReasons:q.choices.map(c=>value(keys[i].wrongReasons[c.id]||''))})),simulation:Object.fromEntries(['html','css','js'].map(k=>[k,value(content.simulation[k])]))});
}
test('opening and saving a v3 rich lesson keeps contexts, feedback, review links, display and simulation unchanged',()=>{
  const t=setup(),{content,keys}=data();prime(t,content,keys);t.capture();const payload=t.buildPayload();
  assert.deepEqual(JSON.parse(JSON.stringify(payload.content)),content);assert.deepEqual(JSON.parse(JSON.stringify(payload.quiz_data)),keys);
  assert.equal(payload.expected_version,3);assert.equal(payload.student_access,false);assert.equal(payload.content.schema,'science-lesson/v3');
  publicPack(payload.content,quizData(payload.quiz_data),'new_lesson');
});
test('v3 cannot save missing choice feedback or delete a required learning stage',()=>{
  const t=setup(),{content,keys}=data();t.validatePack(content,keys);
  assert.throws(()=>t.validatePack({...content,steps:content.steps.slice(1)},keys),/3단계/);
  assert.throws(()=>t.validatePack(content,[{...keys[0],wrongReasons:{}}]),/오답 이유/);
  assert.throws(()=>t.validatePack(content,[{...keys[0],explanationHtml:''}]),/상세 해설/);
});
test('deleting a middle question renumbers its retained feedback by choice identity',()=>{
  const t=setup(),{content,keys}=data();const question=structuredClone(content.quiz[0]),key=structuredClone(keys[0]);question.id='q2';question.choices.forEach((c,n)=>c.id='q2-c'+(n+1));key.questionId='q2';key.wrongReasons={'q2-c1':'Retained second reason'};
  t.state.content={...content,quiz:[question]};t.state.keys=[key];t.renumberV3();
  assert.equal(t.state.content.quiz[0].id,'q1');assert.equal(t.state.keys[0].questionId,'q1');assert.equal(t.state.keys[0].wrongReasons['q1-c1'],'Retained second reason');publicPack(t.state.content,quizData(t.state.keys),'new_lesson');
});
