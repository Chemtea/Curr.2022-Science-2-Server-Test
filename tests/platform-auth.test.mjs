import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
import * as guards from '../supabase/functions/platform-api/auth-guards.ts';

const userId='550e8400-e29b-41d4-a716-446655440000';
const adminId='660e8400-e29b-41d4-a716-446655440000';
const passwordHash='c'.repeat(64);
const studentToken='stu_'+'a'.repeat(96),adminToken='adm_'+'b'.repeat(96);
const hash=async s=>Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const student={id:userId,login_id:'2301',name:'Synthetic learner',account_type:'student',school_year:2026,status:'등록완료',password_hash:passwordHash,manager_permissions:[]};
const teacher={id:adminId,login_id:'admin',name:'Synthetic teacher',account_type:'',school_year:null,status:'등록대기',password_hash:'',manager_permissions:[]};
const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/platform-api/index.ts',import.meta.url),'utf8').replace(/^import .+;\n/gm,''),{mode:'strip'});
async function app(overrides={}){
  const users=overrides.users??[{...student},{...teacher}];
  const tables={app_users:users,app_settings:[{setting_key:'admin_password_hash',setting_value:{hash:passwordHash}}],app_sessions:[
    {token_hash:await hash(studentToken),account_id:userId,session_type:'student',account_type:'student',login_id:'2301',expires_at:new Date(Date.now()+60000).toISOString()},
    {token_hash:await hash(adminToken),account_id:adminId,session_type:'admin',account_type:'admin',login_id:'admin',expires_at:new Date(Date.now()+60000).toISOString()}
  ],point_balances:[],...overrides.tables};
  if(overrides.studentSession)Object.assign(tables.app_sessions[0],overrides.studentSession);
  if(overrides.adminSession)Object.assign(tables.app_sessions[1],overrides.adminSession);
  const writes=[];
  class Query{
    constructor(table){this.table=table;this.filters=[];}
    select(){return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}
    ilike(k,v){this.filters.push(r=>String(r[k]).toLowerCase()===v.toLowerCase());return this;}
    limit(){return this;}update(value){this.mutation={kind:'update',value};return this;}
    insert(value){this.mutation={kind:'insert',value};return this;}delete(){this.mutation={kind:'delete'};return this;}
    result(single=false){const rows=(tables[this.table]||[]).filter(r=>this.filters.every(f=>f(r)));
      if(this.mutation){writes.push({table:this.table,...this.mutation});
        if(this.mutation.kind==='insert')(tables[this.table]??=[]).push(this.mutation.value);
        if(this.mutation.kind==='update')rows.forEach(r=>Object.assign(r,this.mutation.value));
      }
      return {data:single?rows[0]??null:rows,error:null};
    }
    maybeSingle(){return Promise.resolve(this.result(true));}
    then(resolve,reject){return Promise.resolve(this.result()).then(resolve,reject);}
  }
  let handler;
  const context=vm.createContext({...guards,Request,Response,URL,TextEncoder,crypto:webcrypto,Date,createClient:()=>({from:table=>new Query(table),rpc:async name=>({data:name==='get_current_school_year'?2026:{blocked:false},error:null})}),Deno:{env:{get:key=>({SUPABASE_URL:'https://rerykeslgwhamreoskgx.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-only'})[key]},serve:fn=>{handler=fn;}}});
  vm.runInContext(source,context);
  return {writes,tables,call:async body=>{const response=await handler(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));return {status:response.status,data:await response.json()};}};
}
const login={action:'student_login',studentId:'2301',schoolYear:2026,passwordHash,passwordLength:12};

test('account guards reject disabled, deleted, unapproved and guardian-unverified current users',()=>{
  assert.equal(guards.platformStudentAllowed(student),true);
  for(const delta of [{status:'정지'},{disabled_at:'2026-09-13'},{deleted_at:'2026-09-13'},{is_active:false},{active:false},{approval_status:'pending'},{guardian_consent_required:true,guardian_consent_verified:false},{login_id:'admin'}])assert.equal(guards.platformStudentAllowed({...student,...delta}),false);
  assert.equal(guards.platformStudentAllowed({...student,guardian_consent_required:true,guardian_consent_verified:true}),true);
});
test('expired, invalid-date, revoked and mismatched-role sessions fail closed',()=>{
  const base={account_id:userId,login_id:'2301',account_type:'student',session_type:'student',expires_at:'2099-01-01T00:00:00Z'};
  for(const delta of [{expires_at:'bad'},{expires_at:null},{expires_at:'2000-01-01'},{revoked_at:'2026-09-13'},{account_type:'admin'},{session_type:'admin'}])assert.equal(guards.platformSessionLive({...base,...delta},'student'),false);
  assert.equal(guards.platformSessionLive(base,'student'),true);
});
test('teacher legacy pending status requires current configured credential and active linked account',()=>{
  assert.equal(guards.platformAdminAllowed(teacher,true),true);
  for(const [row,configured] of [[teacher,false],[{...teacher,status:'정지'},true],[{...teacher,is_active:false},true],[{...teacher,deleted_at:'2026-09-13'},true],[{...teacher,guardian_consent_required:true},true]])assert.equal(guards.platformAdminAllowed(row,configured),false);
});
test('actual login route issues sessions for enabled student, external and manager accounts',async()=>{
  for(const accountType of ['student','external','manager']){
    const a=await app({users:[{...student,account_type:accountType,school_year:accountType==='student'?2026:null}]});
    const result=await a.call(login);assert.equal(result.status,200);assert.equal(result.data.success,true);assert.equal(result.data.accountType,accountType);
    assert.equal(a.writes.filter(w=>w.table==='app_sessions'&&w.kind==='insert').length,1);
  }
});
test('actual login route cannot issue sessions to stopped or guardian-unverified users even with correct password',async()=>{
  for(const delta of [{status:'정지'},{guardian_consent_required:true,guardian_consent_verified:false},{is_active:false}]){
    const a=await app({users:[{...student,...delta}]});const result=await a.call(login);
    assert.equal(result.status,403);assert.equal(result.data.success,false);assert.equal(a.writes.some(w=>w.table==='app_sessions'),false);
  }
});
test('current-user route rejects previously valid sessions after account status or role changes',async()=>{
  for(const delta of [{status:'정지'},{guardian_consent_required:true},{account_type:'manager'},{login_id:'changed'}]){
    const a=await app({users:[{...student,...delta}]});const result=await a.call({action:'get_current_user_role',studentSessionToken:studentToken});
    assert.equal(result.data.success,false);assert.equal(result.data.sessionExpired,true);
  }
});
test('admin session verification and admin password login both reject a stopped linked teacher',async()=>{
  const a=await app({users:[{...teacher,status:'정지'}]});
  let result=await a.call({action:'verifyAuth',adminKey:adminToken});assert.equal(result.data.success,false);
  result=await a.call({...login,studentId:'admin'});assert.equal(result.status,403);assert.equal(a.writes.some(w=>w.table==='app_sessions'),false);
});
test('legacy teacher row can log in normally while revoked admin sessions are rejected',async()=>{
  const a=await app({adminSession:{revoked_at:'2026-09-13'}});
  let result=await a.call({action:'verifyAuth',adminKey:adminToken});assert.equal(result.data.success,false);
  result=await a.call({...login,studentId:'admin'});assert.equal(result.data.success,true);assert.match(result.data.adminSessionToken,/^adm_[0-9a-f]{96}$/);
});
test('legacy full lock snapshots are blocked without any database mutation',async()=>{
  const a=await app();const result=await a.call({action:'save_locks',adminKey:adminToken,locks:{evil:true}});
  assert.equal(result.status,410);assert.equal(a.writes.length,0);
});
