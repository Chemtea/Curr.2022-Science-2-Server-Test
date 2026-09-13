import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePatches, createHandler } from '../supabase/functions/lock-realtime-api/index.ts';
const token = 'adm_'+'a'.repeat(96);
const now = Date.parse('2026-09-13T12:00:00Z');
const env = key => ({SUPABASE_URL:'https://rerykeslgwhamreoskgx.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-only-placeholder'})[key];
const req = body => new Request('https://example.test',{method:'POST',headers:{Origin:'https://chemtea.github.io'},body:JSON.stringify(body)});
const fixture = () => {
  let locks = {unit3:{isLocked:false,lessons:{u3_l1:false}},step_locks:{u3_l1:{'1':false,'2':false,'3':true,'4':true}},unrelated:{keep:'existing'}};
  let writes = 0;
  return {
    get locks(){return locks;}, get writes(){return writes;},
    async one(table,query) {
      if (table==='app_sessions') return {session_type:'admin',account_type:'admin',login_id:'admin',account_id:null,expires_at:'2026-09-13T13:00:00Z'};
      if (query.setting_key==='eq.admin_password_hash') return {setting_value:{hash:'b'.repeat(64)}};
      return {setting_value:locks};
    },
    async request(path,query,body) {
      assert.equal(path,'rpc/apply_science_lock_patches'); writes++;
      for(const patch of body.p_patches){let object=locks;for(const part of patch.path.slice(0,-1))object=object[part]??={};object[patch.path.at(-1)]=patch.value;}
      return structuredClone(locks);
    },
    async broadcast(){return true;},
  };
};
test('worksheet patches never erase existing unit, step or unrelated values',async()=>{
  const db=fixture(),handler=createHandler({env,store:db,now:()=>now});
  const response=await handler(req({action:'save_locks',adminKey:token,patches:[{path:['step_locks','u3_l1','4'],value:false}]}));
  assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.locks.step_locks.u3_l1['4'],false);
  assert.equal(result.locks.step_locks.u3_l1['3'],true);
  assert.deepEqual(result.locks.unrelated,{keep:'existing'});assert.equal(result.locks.unit3.isLocked,false);assert.equal(db.writes,1);
});
test('full snapshots, empty patches and malformed patches perform no writes',async()=>{
  for(const change of [{locks:{}},{locks:{unit3:{}},patches:[{path:['unit3','isLocked'],value:false}]},{patches:[]},{patches:[{path:['unit3'],value:{}}]}]){
    const db=fixture(),handler=createHandler({env,store:db,now:()=>now});
    const response=await handler(req({action:'save_locks',adminKey:token,...change}));
    assert.equal(response.status,400);assert.equal(db.writes,0);assert.deepEqual(db.locks.unrelated,{keep:'existing'});
  }
});
test('reserved paths and arbitrary settings cannot be written',()=>{
  for(const path of [['__proto__','isLocked'],['constructor','isLocked'],['unit3','lessons','prototype'],['admin_password_hash'],['step_locks','u3_l1','5']])assert.throws(()=>validatePatches([{path,value:false}]));
  assert.equal(validatePatches([{path:['worksheetCurriculum','units','3','items','ws_u3_l1'],value:false}]).length,1);
  assert.equal(validatePatches([{path:['evalHallVisibilityMode'],value:'admin_only'}]).length,1);
});
test('invalid date and student session cannot modify locks',async()=>{
  for(const session of [{session_type:'admin',account_type:'admin',login_id:'admin',expires_at:'bad'},{session_type:'student',account_type:'student',login_id:'student',expires_at:'2026-09-13T13:00:00Z'}]){
    const db=fixture();const original=db.one.bind(db);db.one=async(table,q)=>table==='app_sessions'?session:original(table,q);
    const handler=createHandler({env,store:db,now:()=>now});
    assert.equal((await handler(req({action:'save_locks',adminKey:token,patches:[{path:['unit3','isLocked'],value:false}]}))).status,403);assert.equal(db.writes,0);
  }
});
test('manager permission must be current in app_users',async()=>{
  for(const permissions of [[],['curriculum_control']]){
    const db=fixture(),original=db.one.bind(db);db.one=async(table,q)=>table==='app_sessions'?{session_type:'manager',account_type:'manager',account_id:'test-id',expires_at:'2026-09-13T13:00:00Z'}:table==='app_users'?{status:'등록완료',account_type:'manager',manager_permissions:permissions,name:'Test manager'}:original(table,q);
    const handler=createHandler({env,store:db,now:()=>now});
    assert.equal((await handler(req({action:'save_locks',managerSessionToken:'stu_'+'b'.repeat(96),patches:[{path:['unit3','isLocked'],value:true}]}))).status,permissions.length?200:403);
  }
});
