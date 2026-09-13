'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash} = require('node:crypto');
const adapterPath = path.join(__dirname, '../assets/legacy-html-adapter.js');
const adapter = require(adapterPath);
const sources = path.join(__dirname, '../../production-source');
const item = {id:'11111111-1111-4111-8111-111111111111', kind:'lesson',format:'html',unit_id:'unit8',lesson_id:'u8_l9',title:'8단원 9차시 — 시험 수업'};
const worksheet = {id:'22222222-2222-4222-8222-222222222222',kind:'worksheet',format:'pdf',unit_id:'unit8',lesson_id:'u8_l9',title:'차시 관찰 학습지'};
const names = fs.readdirSync(sources).filter(name => /^\d\d_/.test(name) && name.endsWith('.html') && !/(assessment|formative|summative)/.test(name));
const scripts = html => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(match => !/\bsrc\s*=/.test(match[1])).map(match => ({attrs:match[1],body:match[2]}));

for (const name of names) test(name + ': execution copy preserves simulations, binds IDs/PDF, retains parser script order', () => {
  const source = fs.readFileSync(path.join(sources, name), 'utf8');
  const hash = createHash('sha256').update(source).digest('hex');
  const result = adapter.prepare(source, item, {worksheet});
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(sources, name))).digest('hex'), hash);
  assert.match(result.html, /LegacyHTMLAdapter\.installRuntime\(\)/);
  assert.doesNotMatch(result.html, /src=["'][^"']*platform-config\.js/);
  assert.doesNotMatch(result.html, /jypvtvvozxmsposxllri/);
  assert.doesNotMatch(result.html, /Curr\.2022-Science-2\//);
  assert.match(result.html, /data-lesson="u8_l9"/);
  assert.match(result.html, /data-pdf="worksheets\/u8_l9.pdf"/);
  assert.match(result.html, /data:await window\.LegacyHTMLAdapter\.worksheetBytes\(\)/);
  assert.match(result.html, /patches:\[\{path,value:value===true\}\]/);
  assert.doesNotMatch(result.html, /action:'save_locks',adminKey,locks/);
  assert.match(result.html, /get\('worksheet'\) === '1'/);
  for (const script of scripts(result.html)) new vm.Script(script.body, {filename: name});
  // Content-specific drawing code is not rewritten by this adapter.
  for (const script of scripts(source).filter(script => !/MASTER_LESSON_CONFIG|PLATFORM_CONFIG|THIS_LESSON_KEY|ctw-script|ctw-root/.test(script.body + script.attrs))) {
    if (!script.body.includes('platform-config.js')) assert.ok(result.html.includes(script.body), 'unrelated script changed');
  }
  if (result.sourceProfile === 'master') {
    const context = {window:null,document:{writes:[],write(value){this.writes.push(value);}},Object,alert(){}};
    context.window = context;
    vm.createContext(context);
    const configScript = scripts(result.html).find(script => /id="ml-config"/.test(script.attrs));
    const runtimeScript = scripts(result.html).find(script => /id="ml-runtime"/.test(script.attrs));
    vm.runInContext(configScript.body, context); vm.runInContext(runtimeScript.body, context);
    assert.equal(context.MASTER_LESSON_CONFIG.unitKey, 'unit8');
    assert.equal(context.MASTER_LESSON_CONFIG.lessonKey, 'u8_l9');
    assert.equal(context.MasterLessonRuntime.preview, false);
    assert.deepEqual(context.document.writes, ['<script src="./lock-realtime-client.js"></script>']);
  } else {
    assert.match(result.html, /const THIS_UNIT_KEY = "unit8"/);
    assert.match(result.html, /const THIS_LESSON_KEY = "u8_l9"/);
  }
});

function storage() {
  const data = new Map();
  return {getItem:key=>data.has(String(key))?data.get(String(key)):null,setItem:(key,value)=>data.set(String(key),String(value)),removeItem:key=>data.delete(String(key)),clear:()=>data.clear(),key:index=>[...data.keys()][index]??null,get length(){return data.size;}};
}
function browser({request} = {}) {
  const session = storage(), local = storage(), requests = [];
  const events = {};
  const context = {window:null,URL,Request,Response,Uint8Array,Promise,Object,JSON,console,
    sessionStorage:session,localStorage:local,
    location:{href:'https://chemtea.github.io/Curr.2022-Science-2-Server-Test/html-lesson.html?id='+item.id+'&worksheet=1',reload(){}},
    document:{getElementById(){return null;}},
    addEventListener(name,fn){(events[name] ||= []).push(fn);},
    navigator:{sendBeacon(url){requests.push({beacon:url});return true;}},
    fetch:async(input,init)=>{requests.push({url:typeof input==='string'?input:input.url,init});return new Response('{}');},
    WebSocket:class {static OPEN=1;constructor(url){this.url=url;}},
    XMLHttpRequest:class {open(method,url){this.method=method;this.url=url;}},
    atob:value=>Buffer.from(value,'base64').toString('binary'),
    ScienceContentClient:{request:request || (async()=>({success:true}))}
  };
  context.window=context; vm.createContext(context);
  const configPath = fs.existsSync(path.join(__dirname,'../platform-config.js')) ? path.join(__dirname,'../platform-config.js') : path.join(__dirname,'../../../test-work/site/platform-config.js');
  vm.runInContext(fs.readFileSync(configPath,'utf8'),context);
  vm.runInContext(fs.readFileSync(adapterPath,'utf8'),context);
  context.LegacyHTMLAdapter.configure({item,worksheet});
  return {context,session,local,requests,events};
}

test('original session names and worksheet notes use TEST storage, never production keys', () => {
  const {context,session,local}=browser();
  session.setItem('current_student','production-placeholder'); local.setItem('ctw:panel-width','777');
  context.LegacyHTMLAdapter.installRuntime();
  assert.equal(context.sessionStorage.getItem('current_student'), null);
  context.sessionStorage.setItem('current_student','test-placeholder');
  context.localStorage.setItem('ctw:notes:v1:u8_l9:test-fingerprint','test-notes');
  assert.equal(session.getItem('current_student'),'production-placeholder');
  assert.equal(session.getItem('science-platform-test:rerykeslgwhamreoskgx:current_student'),'test-placeholder');
  assert.equal(local.getItem('ctw:panel-width'),'777');
  assert.equal(local.getItem('ctw:notes:v1:u8_l9:test-fingerprint'),null);
  assert.equal(local.getItem('science-platform-test:rerykeslgwhamreoskgx:ctw:notes:v1:u8_l9:test-fingerprint'),'test-notes');
  context.sessionStorage.clear(); assert.equal(session.getItem('current_student'),'production-placeholder');
});

test('fetch, Request, XHR and WebSocket route known production references to TEST', async () => {
  const {context,requests}=browser(); context.LegacyHTMLAdapter.installRuntime();
  const production='https://jypvtvvozxmsposxllri.supabase.co/functions/v1/platform-api';
  await context.fetch(production,{method:'POST',body:'{}'});
  await context.fetch(new Request(production,{method:'POST',body:'{}'}));
  assert.ok(requests.every(row=>row.url.startsWith(adapter.TEST_BASE)));
  const xhr=new context.XMLHttpRequest();xhr.open('POST',production);assert.match(xhr.url,/rerykeslgwhamreoskgx/);
  const socket=new context.WebSocket('wss://jypvtvvozxmsposxllri.supabase.co/realtime/v1/websocket');assert.match(socket.url,/rerykeslgwhamreoskgx/);
  assert.equal(context.WebSocket.OPEN,1);
  await assert.rejects(context.fetch('https://foreignproject.supabase.co/functions/v1/platform-api'),/다른 서버/);
  await assert.rejects(context.fetch('https://script.google.com/macros/s/old/exec'),/이전 운영/);
  const count=requests.length; const ip=await(await context.fetch('https://api.ipify.org?format=json')).json();
  assert.equal(requests.length,count);assert.equal(ip.ip,'테스트 환경');
});

test('selected private PDF is loaded on demand and validated against its lesson', async () => {
  const calls=[];
  const {context}=browser({request:async(action,payload)=>{calls.push({action,payload});return {success:true,item:worksheet,file_base64:Buffer.from('%PDF-1.7\nfixture').toString('base64')};}});
  assert.equal(calls.length,0);
  const bytes=await context.LegacyHTMLAdapter.worksheetBytes();
  assert.equal(Buffer.from(bytes).toString(),'%PDF-1.7\nfixture');
  assert.equal(calls[0].action,'get_content');assert.equal(calls[0].payload.id,worksheet.id);
  await context.LegacyHTMLAdapter.worksheetBytes();assert.equal(calls.length,2,'no persistent private PDF cache');
});

test('wrong-lesson PDF cannot be shown in a drawer', async () => {
  const {context}=browser({request:async()=>({success:true,item:{...worksheet,lesson_id:'u8_l8'},file_base64:Buffer.from('%PDF-1.7').toString('base64')})});
  await assert.rejects(context.LegacyHTMLAdapter.worksheetBytes(),/다른 차시/);
});

test('invalid/mismatched IDs and incomplete platform templates stop before execution', () => {
  const original=fs.readFileSync(path.join(sources,names[0]),'utf8');
  assert.throws(()=>adapter.prepare(original,{...item,unit_id:'unit3'}),/단원과 차시/);
  assert.throws(()=>adapter.prepare('<!doctype html><html><head><script>const THIS_UNIT_KEY="unit8";</script></head><body>Incomplete</body></html>',item),/설정이 일부 빠져/);
  assert.throws(()=>adapter.prepare(original,item,{pageUrl:'https://chemtea.github.io/Curr.2022-Science-2/html-lesson.html'}),/정식 운영 주소/);
});

test('standalone teacher HTML preserves its content and receives only the runtime bootstrap', () => {
  const source='<!doctype html><html><head><script>window.demo = 7;</script></head><body><canvas id="experiment"></canvas></body></html>';
  const result=adapter.prepare(source,item,{worksheet});
  assert.equal(result.sourceProfile,'standalone');
  assert.match(result.warnings[0],/독립 HTML/);
  assert.match(result.html,/<canvas id="experiment"><\/canvas>/);
  assert.match(result.html,/<head>\s*<script>window.LegacyHTMLAdapter.installRuntime\(\);<\/script><script>window.demo = 7;<\/script>/);
  assert.doesNotMatch(result.html,/THIS_UNIT_KEY|THIS_LESSON_KEY|data-pdf=/);
  for(const script of scripts(result.html))new vm.Script(script.body);
});

test('standalone worksheet shell binds the registered unit and loads authenticated PDF bytes', () => {
  const source=fs.readFileSync(path.join(__dirname,'../assets/legacy-worksheet-shell.html'),'utf8');
  const result=adapter.prepare(source,{...worksheet,kind:'lesson',format:'html'},{worksheet});
  assert.equal(result.sourceProfile,'legacy');
  assert.match(result.html,/const THIS_UNIT_KEY = "unit8"/);
  assert.match(result.html,/const THIS_LESSON_KEY = "u8_l9"/);
  assert.match(result.html,/data:await window.LegacyHTMLAdapter.worksheetBytes\(\)/);
  for(const script of scripts(result.html))new vm.Script(script.body);
});

test('standalone HTML linked worksheet button points to the PDF own loader route', () => {
  const {context,events}=browser();const links=[];
  context.document.createElement=()=>({style:{}});
  context.document.body={append:link=>links.push(link)};
  context.LegacyHTMLAdapter.installRuntime();events.DOMContentLoaded[0]();
  assert.equal(links.length,1);
  assert.equal(links[0].href,'html-lesson.html?id='+worksheet.id);
});

test('a same-lesson PDF with a different identity is rejected', async () => {
  const {context}=browser({request:async()=>({success:true,item:{...worksheet,id:item.id},file_base64:Buffer.from('%PDF-1.7').toString('base64')})});
  await assert.rejects(context.LegacyHTMLAdapter.worksheetBytes(),/다른 차시/);
});

test('source metadata is escaped and teacher-only assessment content is not remapped to lesson IDs', () => {
  const original=fs.readFileSync(path.join(sources,names[0]),'utf8');
  const prepared=adapter.prepare(original,{...item,title:'제목 </script><script>throw 1</script>'});
  for(const script of scripts(prepared.html))new vm.Script(script.body);
  assert.doesNotMatch(prepared.html,/const LESSON_NAME = "제목 <\/script>/);
  const assessment=fs.readFileSync(path.join(sources,'Unit3_01_assessment_wavelength_lab.html'),'utf8');
  const result=adapter.prepare(assessment,{...item,kind:'assessment',lesson_id:'unit3_assessment_l1'});
  assert.doesNotMatch(result.html,/src=["'][^"']*platform-config\.js/);
  assert.match(result.html,/ASSESSMENT_KEY|ASSESSMENT_ID|assessment/i);
});

test('preflight installs safely once and document bootstrap rebinds BFCache verification', () => {
  const {context,events}=browser();context.LegacyHTMLAdapter.installRuntime();const guardedFetch=context.fetch;
  for(const key of Object.keys(events))delete events[key];
  context.LegacyHTMLAdapter.installRuntime();
  assert.equal(context.fetch,guardedFetch);assert.equal(events.pageshow.length,1);assert.equal(events.DOMContentLoaded.length,1);
});
