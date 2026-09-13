import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {handle, activationCode, normalizeCode, sha256} from '../supabase/functions/activation-api/index.ts';
const request = (body, headers={}) => new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const admin = 'adm_'+'a'.repeat(96);
const accountId = '550e8400-e29b-41d4-a716-446655440000';

test('activation code has 128 random bits and normalization permits copy formatting',()=>{
  const values = Array.from({length:100},activationCode);
  assert.equal(new Set(values).size,100);
  for(const code of values) assert.match(code,/^[A-F0-9]{8}(-[A-F0-9]{8}){3}$/);
  assert.equal(normalizeCode(' ABCD-Ef01  '),'abcdef01');
});
test('teacher actions reject missing or student credentials before DB access',async()=>{
  for(const action of ['list','issue','revoke']) {
    let called=false;const response=await handle(request({action,accountId,adminSessionToken:'stu_'+'a'.repeat(96)}),async()=>{called=true;});
    assert.equal(response.status,401);assert.equal(called,false);
  }
});
test('code issuing delegates administrator verification to DB and never persists raw code/token',async()=>{
  let params;const response=await handle(request({action:'issue',accountId,adminSessionToken:admin}),async(name,body)=>{
    assert.equal(name,'activation_admin');params=body;return {success:true,expires_at:'2026-09-14T12:00:00Z'};
  });const data=await response.json();
  assert.equal(response.status,200);assert.equal(params.p_admin_token_hash,await sha256(admin));
  assert.equal(params.p_code_hash,await sha256(normalizeCode(data.code)));
  assert.equal(params.p_account_id,accountId);assert.equal(JSON.stringify(params).includes(data.code),false);
});
test('denied teacher session receives no generated code',async()=>{
  const response=await handle(request({action:'issue',accountId,adminSessionToken:admin}),async()=>({success:false,status:403,message:'denied'}));
  assert.equal(response.status,403);assert.equal((await response.json()).code,undefined);
});
test('redemption hashes server-validated password, uses header IP and ignores forged score/session role',async()=>{
  let params;const password='Synthetic-password-45';const code=activationCode();
  const response=await handle(request({action:'redeem',studentId:'2301',schoolYear:2026,code,password,ip:'forged',isAdmin:true},{'x-forwarded-for':'192.0.2.1, 192.0.2.2'}),async(name,body)=>{assert.equal(name,'activation_redeem');params=body;return {success:true};});
  assert.equal(response.status,200);assert.equal(params.p_password_hash,await sha256(password));
  assert.equal(params.p_code_hash,await sha256(normalizeCode(code)));
  assert.equal(params.p_ip_hash,await sha256('activation-ip:192.0.2.1'));
  assert.equal(JSON.stringify(params).includes(password),false);
});
test('invalid activation code still reaches server attempt limit; 429 is preserved',async()=>{
  let called=false;const response=await handle(request({action:'redeem',studentId:'2301',schoolYear:2026,password:'Synthetic-valid',code:'bad'}),async()=>{called=true;return {success:false,status:429,cooldownSeconds:900,message:'retry later'};});
  assert.equal(called,true);assert.equal(response.status,429);
});
test('short/whitespace password and wildcard login fail before database writes',async()=>{
  for(const override of [{password:'short'},{password:' valid-password '},{studentId:'%'}]) {
    let called=false;const response=await handle(request({action:'redeem',studentId:'2301',schoolYear:2026,password:'Synthetic-valid',code:'valid',...override}),async()=>{called=true;});
    assert.equal(response.status,400);assert.equal(called,false);
  }
});
test('bounded body read rejects oversized POST independent of declared size',async()=>{
  let called=false;const response=await handle(request({action:'redeem',padding:'x'.repeat(18000)}),async()=>{called=true;});
  assert.equal(response.status,413);assert.equal(called,false);
});
test('backend errors never echo database details or submitted credentials',async()=>{
  const response=await handle(request({action:'list',adminSessionToken:admin}),async()=>{throw new Error('private details '+admin);});
  assert.equal(response.status,503);assert.equal((await response.text()).includes(admin),false);
});
test('legacy platform registration endpoint is closed and pending login exposes no roster identity',async()=>{
  const source=await readFile(new URL('../supabase/functions/platform-api/index.ts',import.meta.url),'utf8');
  assert.match(source,/if\(action==="register_initial_password"\) return json\([^\n]+,410\)/);
  assert.doesNotMatch(source,/isFirstLogin:true/);
  assert.match(source,/supabaseUrl!==TEST_PROJECT_URL/);
  assert.match(source,/supabase-js@2\.95\.0/);
});
