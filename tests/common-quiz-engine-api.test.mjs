import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler, publicPack, quizData, RestStore} from '../supabase/functions/content-api/index.ts';
const id='4c51668f-f273-43bd-a6a8-c64076ef4d13',account='8218c95a-8a9b-4d8d-908b-a9fd6405672c',attempt='1233e55e-bc41-45a7-9e60-9d6021d10238';
const token='stu_'+'a'.repeat(96), now=Date.parse('2026-09-13T12:00:00Z');
const env=key=>({SUPABASE_URL:'https://rerykeslgwhamreoskgx.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-key'})[key];
const keys=[{correct:2,choices:2,explanation:'Original explanation',questionId:'q1',correctTitleHtml:'<b>Correct!</b>',explanationHtml:'<b>Explanation.</b>',wrongHintHtml:'<b>Hint.</b>',wrongReasons:{'q1-c1':'<b>Specific reason.</b>'}}];
const pack={schema:'science-lesson/v3',title:'Synthetic common lesson',display:{titleHtml:'<b>Lesson</b>',headerTag:'Test unit',subtitleHtml:'<em>Inquiry</em>',footerHtml:'Test',contentMaxWidth:900,tabs:['A','B','C','D']},steps:[1,2,3].map(n=>({id:`step${n}`,title:`Stage ${n}`,html:'<p>Learning content</p>'})),quiz:[{id:'q1',promptHtml:'<b>Question</b>',contextHtml:'<blockquote>Required context</blockquote>',choices:[{id:'q1-c1',html:'Option 1'},{id:'q1-c2',html:'Option 2'}],review:{stepId:'step2',label:'Review stage 2'}}],simulation:{html:'',css:'',js:'',dependencies:[],hostContract:'science-experiment-content/v1',microphone:false}};
const item={id,kind:'lesson',format:'lesson-pack',unit_id:'testunit',lesson_id:'newlesson',title:pack.title,published:true,student_access:true,version:3,content:pack,quiz_data:keys};
const req=body=>new Request('https://test.invalid',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://chemtea.github.io'},body:JSON.stringify({id,studentSessionToken:token,...body})});
function setup(overrides={}){
 const calls=[],reads=[];
 const store={async one(table,query){
  reads.push({table,query});
  if(table==='app_sessions')return {account_id:account,account_type:'student',session_type:'student',expires_at:'2026-09-13T13:00:00Z'};
  if(table==='app_users')return {id:account,login_id:'synthetic',account_type:'student',status:'등록완료',...(overrides.user||{})};
  if(table==='app_settings')return {setting_value:overrides.locks||{}};
  if(table==='content_items')return {...item,...(overrides.item||{})};
  if(table==='content_quiz_sessions')return overrides.frozen ?? null;
  throw Error(table);
 },async request(path,query,body){calls.push({path,body});return {attempt:{id:attempt,contentVersion:3,content:pack,answers:[null],feedback:[null],submitted:false,result:null}};}};
 return {handler:createHandler({env,store,now:()=>now}),calls,reads};
}
test('v3 roundtrip preserves required context, display, review links and private rich feedback separately',()=>{
 assert.deepEqual(publicPack(pack,quizData(keys),'newlesson'),pack);
 assert.deepEqual(quizData(keys),keys);
 const publicJSON=JSON.stringify(publicPack(pack,quizData(keys),'newlesson'));
 for(const secret of ['correctTitleHtml','wrongReasons','Specific reason','Original explanation'])assert.equal(publicJSON.includes(secret),false);
});
test('v3 malformed question IDs, invalid review destinations, hidden keys and executable feedback fail',()=>{
 for(const mutate of [p=>p.quiz[0].correct=2,p=>p.quiz[0].id='q2',p=>p.quiz[0].choices[0].id='x',p=>p.quiz[0].review.stepId='step4',p=>p.steps.push({id:'step4',title:'X',html:''}),p=>p.display.titleHtml='<img src=x onerror=alert(1)>',p=>p.simulation.dependencies.push('https://evil.invalid/script')]){
  const value=structuredClone(pack);mutate(value);assert.throws(()=>publicPack(value,quizData(keys),'newlesson'));
 }
 assert.throws(()=>quizData([{...keys[0],wrongReasons:{'q1-c1':'<script>bad</script>'}}]));
 assert.throws(()=>publicPack(pack,quizData([{...keys[0],wrongReasons:{}}]),'newlesson'));
 assert.throws(()=>publicPack(pack,quizData([{...keys[0],wrongHintHtml:''}]),'newlesson'));
});
test('begin uses authenticated account and loaded version, and never sends caller scores or keys',async()=>{
 const {handler,calls}=setup();const response=await handler(req({action:'begin_quiz',version:3,account_id:'forged',score:999,quiz_data:[{correct:1}]}));
 assert.equal(response.status,200);assert.equal(calls[0].path,'rpc/content_quiz_engine');
 assert.equal(calls[0].body.p_account_id,account);assert.equal(calls[0].body.p_content_version,3);
 assert.equal('score' in calls[0].body,false);assert.equal('quiz_data' in calls[0].body,false);
});
test('v3 submit requires an attempt and forwards no editable browser answers or score',async()=>{
 const {handler,calls}=setup();
 assert.equal((await handler(req({action:'submit_quiz',version:3,answers:[2]}))).status,409);
 const response=await handler(req({action:'submit_quiz',version:3,attempt_id:attempt,answers:[2],score:999}));
 assert.equal(response.status,200);assert.equal(calls.length,1);
 assert.equal(calls[0].body.p_action,'submit_quiz');assert.equal('p_answers' in calls[0].body,false);assert.equal('p_result' in calls[0].body,false);
});
test('invalid indexes/version/attempt, manager, disabled account and active step lock never reach grading RPC',async()=>{
 for(const bad of [{question:0},{question:6},{choice:0},{choice:7},{choice:true},{version:0},{attempt_id:account.slice(1)}]){
  const {handler,calls}=setup();assert.notEqual((await handler(req({action:'answer_quiz',version:3,attempt_id:attempt,question:1,choice:1,...bad}))).status,200);assert.equal(calls.length,0);
 }
 for(const override of [{user:{account_type:'manager'}},{user:{status:'등록대기'}},{locks:{step_locks:{newlesson:{4:true}}}},{item:{student_access:false}}]){
  const {handler,calls}=setup(override);assert.equal((await handler(req({action:'begin_quiz',version:3}))).status,403);assert.equal(calls.length,0);
 }
});
test('stable SQL first-choice/version/incomplete errors map to reviewable API responses',async()=>{
 for(const [message,status] of [['QUIZ_ANSWER_LOCKED',409],['QUIZ_ATTEMPT_VERSION_CONFLICT',409],['QUIZ_CONTENT_LOCKED',403],['QUIZ_INCOMPLETE',400]]){
  const db=new RestStore('https://test.invalid','synthetic',async()=>new Response(JSON.stringify({message}),{status:400}));
  await assert.rejects(()=>db.request('rpc/content_quiz_engine',{},{}),e=>e.code===message&&e.status===status);
 }
});

const legacyPack={schema:'science-lesson/v2',title:'Restored older schema',steps:[{title:'Old stage',html:'<p>Old lesson</p>'}],quiz:[{question:'Old question',choices:['A','B']}],simulation:{html:'',css:'',js:'',dependencies:[],microphone:false}};
test('student get_content keeps a started v3 snapshot after teacher restores a v2 format, with only public scoped columns',async()=>{
 const {handler,reads}=setup({item:{version:4,content:legacyPack},frozen:{id:attempt,public_snapshot:pack,content_version:3,private_keys:keys,answers:[1],result:{score:0}}});
 const response=await handler(req({action:'get_content',account_id:'forged-other-account'}));
 assert.equal(response.status,200);const result=await response.json();
 assert.deepEqual(result.content,pack);assert.equal(result.item.version,4);assert.equal(result.contentVersion,3);assert.equal(result.frozenQuizVersion,true);
 const frozenRead=reads.find(r=>r.table==='content_quiz_sessions');
 assert.deepEqual(frozenRead.query,{select:'public_snapshot,content_version',account_id:`eq.${account}`,content_id:`eq.${id}`});
 for(const secret of ['private_keys','Specific reason','Original explanation','answers','score'])assert.equal(JSON.stringify(result).includes(secret),false);
});
test('legacy submit cannot bypass the first-choice lock after a v3 attempt exists, even after a schema restore',async()=>{
 const {handler,calls,reads}=setup({item:{version:4,content:legacyPack},frozen:{id:attempt}});
 const response=await handler(req({action:'submit_quiz',answers:[2],score:999}));
 assert.equal(response.status,409);assert.equal((await response.json()).code,'QUIZ_ATTEMPT_REQUIRED');assert.equal(calls.length,0);
 assert.deepEqual(reads.find(r=>r.table==='content_quiz_sessions').query,{select:'id',account_id:`eq.${account}`,content_id:`eq.${id}`});
});
test('v1/v2 students with no frozen v3 session retain legacy reads and submissions',async()=>{
 for(const schema of ['science-lesson/v1','science-lesson/v2']){
  const older={...legacyPack,schema};
  const {handler,calls}=setup({item:{version:4,content:older}});
  const contentResponse=await handler(req({action:'get_content'}));assert.equal(contentResponse.status,200);assert.deepEqual((await contentResponse.json()).content,older);
  const submitResponse=await handler(req({action:'submit_quiz',answers:[2]}));assert.equal(submitResponse.status,200);
  assert.equal(calls.length,1);assert.equal(calls[0].path,'rpc/content_record_quiz');assert.deepEqual(calls[0].body.p_answers,[2]);
 }
});
test('current permissions still block frozen content before its snapshot is read',async()=>{
 const {handler,reads}=setup({item:{student_access:false},frozen:{public_snapshot:pack,content_version:3}});
 assert.equal((await handler(req({action:'get_content'}))).status,403);
 assert.equal(reads.some(r=>r.table==='content_quiz_sessions'),false);
});
