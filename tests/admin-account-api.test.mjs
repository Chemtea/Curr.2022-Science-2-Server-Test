import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, createHandler } from '../supabase/functions/admin-account-api/index.ts';

const now=Date.parse('2026-09-13T12:00:00Z');
const token='adm_'+'a'.repeat(96);
const accountId='550e8400-e29b-41d4-a716-446655440000';
const session={account_id:accountId,login_id:'admin',account_type:'admin',session_type:'admin',expires_at:'2026-09-13T13:00:00Z'};
const user={id:accountId,login_id:'admin',status:'등록대기'};
const request=body=>new Request('https://example.test',{method:'POST',body:JSON.stringify(body)});
const payload={action:'admin_create_student_account',adminKey:token,studentId:'2901',name:'검증용 학생'};
function database(options={}){
  const queries=[],writes=[];
  return {queries,writes,async request(path,query,body){
    queries.push(path);
    if(path==='app_sessions')return [options.session??session];
    if(path==='app_settings')return options.configured===false?[]:[{setting_value:{hash:'b'.repeat(64)}}];
    if(path==='rpc/get_current_school_year')return 2026;
    if(path==='app_users'&&query.id)return [options.user??user];
    if(path==='app_users'&&body){writes.push(body);return [{id:accountId,...body}];}
    if(path==='app_users')return options.existing?[{id:accountId}]:[];
    throw new Error('unexpected database operation');
  }};
}

test('verified legacy admin creates only a pending student for the server school year',async()=>{
  const db=database();const response=await handle(request({...payload,account_type:'admin',schoolYear:2099,password_hash:'attacker'}),db,now);
  assert.equal(response.status,200);const data=await response.json();
  assert.equal(data.requiresActivationCode,true);
  assert.equal(db.writes.length,1);
  assert.equal(db.writes[0].status,'등록대기');assert.equal(db.writes[0].password_hash,'');
  assert.equal(db.writes[0].account_type,'student');assert.equal(db.writes[0].school_year,2026);
  assert.equal('password_hash' in data.account,false);
});

test('student credentials cannot create accounts or read administrator records',async()=>{
  const db=database();const response=await handle(request({...payload,adminKey:'stu_'+'a'.repeat(96)}),db,now);
  assert.equal(response.status,401);assert.equal(db.queries.length,0);
});

test('expired, revoked, malformed and incorrectly typed admin sessions are denied',async()=>{
  for(const invalid of [{expires_at:'2026-09-13T11:00:00Z'},{expires_at:'invalid'},{revoked_at:'2026-09-13T11:00:00Z'},{session_type:'student'},{account_type:'student'},{login_id:'student'}]){
    const db=database({session:{...session,...invalid}});
    assert.equal((await handle(request(payload),db,now)).status,401);assert.equal(db.writes.length,0);
  }
});

test('a disabled linked admin cannot use a still unexpired token',async()=>{
  for(const invalid of [{status:'disabled'},{disabled_at:'2026-09-13T11:00:00Z'},{active:false},{login_id:'student'},{approval_status:'rejected'}]){
    const db=database({user:{...user,...invalid}});
    assert.equal((await handle(request(payload),db,now)).status,403);assert.equal(db.writes.length,0);
  }
});

test('both unbound and pending legacy admin sessions require a real server credential',async()=>{
  for(const account_id of [accountId,null]){
    const db=database({configured:false,session:{...session,account_id}});
    assert.equal((await handle(request(payload),db,now)).status,403);assert.equal(db.writes.length,0);
  }
});

test('duplicate student IDs return a conflict and never replace existing records',async()=>{
  const db=database({existing:true});const response=await handle(request(payload),db,now);
  assert.equal(response.status,409);assert.equal(db.writes.length,0);assert.equal((await response.json()).duplicate,true);
});

test('wrong project configuration fails before any database request',async()=>{
  let calls=0;
  const handler=createHandler(key=>key==='SUPABASE_URL'?'https://other-project.supabase.co':'fake-unit-test',async()=>{calls++;throw new Error('no request expected');});
  assert.equal((await handler(request(payload))).status,503);assert.equal(calls,0);
});

test('actual body length is limited even without a content-length header',async()=>{
  const db=database();const response=await handle(request({...payload,name:'x'.repeat(17000)}),db,now);
  assert.equal(response.status,413);assert.equal(db.queries.length,0);
});
