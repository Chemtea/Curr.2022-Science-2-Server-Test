import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../assets/html-lesson.js', import.meta.url), 'utf8');
const lesson = {id:'11111111-1111-4111-8111-111111111111',kind:'lesson',format:'html',unit_id:'unit8',lesson_id:'u8_l9',title:'새 수업'};
const worksheet = {id:'22222222-2222-4222-8222-222222222222',kind:'worksheet',format:'pdf',unit_id:'unit8',lesson_id:'u8_l9',title:'학습지'};
const pdf = item => ({success:true,item,file_base64:Buffer.from('%PDF-1.7\nfixture').toString('base64'),mime:'application/pdf'});
const copy = value => JSON.parse(JSON.stringify(value));
const tick = async () => {for(let n=0;n<24;n++)await Promise.resolve();};

function harness({query=`id=${lesson.id}`,request}={}) {
  const calls=[], adapted=[],configured=[],writes=[],blobs=[],revoked=[],events={},documentEvents={};
  let auth={adminSessionToken:'fixture'};
  class Element {
    constructor(tag='div'){this.tagName=tag;this.style={};this.children=[];this.hidden=true;this.textContent='';this.events={};}
    addEventListener(name,fn){this.events[name]=fn;}
    closest(){return main;}
    append(...items){this.children.push(...items);for(const item of items)item.parent=this;}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(item=>item!==this);}
  }
  const main=new Element('main');
  const nodes={htmlLessonStatus:new Element(),htmlLessonTitle:new Element(),htmlLessonRetry:new Element('button')};
  class BrowserURL extends URL {
    static createObjectURL(blob){blobs.push(blob);return 'blob:https://test.example/private-'+blobs.length;}
    static revokeObjectURL(url){revoked.push(url);}
  }
  const document={visibilityState:'visible',getElementById:id=>nodes[id],createElement:tag=>new Element(tag),
    addEventListener(name,fn){(documentEvents[name]||=[]).push(fn);},open(){writes.push('open');},write(html){writes.push(html);},close(){writes.push('close');}};
  const location={href:'https://test.example/html-lesson.html?'+query,search:'?'+query,reloaded:0,reload(){this.reloaded++;}};
  const context={window:null,document,location,URL:BrowserURL,URLSearchParams,Uint8Array,Blob,JSON,atob,
    history:{replaceState(_state,_title,url){location.href=String(url);location.search=new URL(url).search;}},
    addEventListener(name,fn){(events[name]||=[]).push(fn);},
    fetch:async url=>({ok:true,async text(){return '<!doctype html><html><head></head><body>worksheet shell</body></html>';}}),
    ScienceContentClient:{auth:()=>auth,async request(action,payload={}){calls.push({action,payload:copy(payload)});return request(action,payload);}},
    LegacyHTMLAdapter:{prepare(content,item,options){adapted.push({content,item:copy(item),options:copy(options)});return {html:'adapted source'};},configure(config){configured.push(copy(config));},installRuntime(){writes.push('runtime');}}
  };
  context.window=context;vm.runInNewContext(source,context);
  return {calls,adapted,configured,writes,blobs,revoked,events,documentEvents,main,nodes,location,
    auth(value){auth=value;},settle:tick,async fire(name,event={}){for(const fn of events[name]||[])await fn(event);}};
}

test('standalone worksheet links, including old worksheet=1 links, use the PDF own access check',async()=>{
  for(const suffix of ['', '&worksheet=1']) {
    const app=harness({query:`id=${worksheet.id}${suffix}`,request:async()=>pdf(worksheet)});await app.settle();
    assert.deepEqual(app.calls,[{action:'get_content',payload:{id:worksheet.id}}]);
    assert.equal(app.adapted[0].item.kind,'lesson');assert.equal(app.configured[0].item.kind,'worksheet');
    assert.equal(new URL(app.location.href).searchParams.get('worksheet'),'1');
    assert.deepEqual(app.writes,['runtime','open','adapted source','close']);
  }
});

test('explicit linked worksheet mode authorizes lesson HTML and keeps the selected private PDF',async()=>{
  const app=harness({query:`id=${lesson.id}&worksheet=1&worksheetId=${worksheet.id}`,request:async action=>action==='catalog'?{items:[worksheet]}:{item:lesson,content:'lesson HTML'}});await app.settle();
  assert.deepEqual(app.calls[0],{action:'get_content',payload:{id:lesson.id,worksheet_mode:true,worksheet_id:worksheet.id}});
  assert.equal(app.configured[0].worksheet.id,worksheet.id);assert.equal(app.configured[0].worksheetOnly,true);
  assert.equal(app.adapted[0].content,'lesson HTML');
});

test('worksheetId without worksheet mode keeps normal lesson access checks',async()=>{
  const app=harness({query:`id=${lesson.id}&worksheetId=${worksheet.id}`,request:async action=>action==='catalog'?{items:[worksheet]}:{item:lesson,content:'lesson HTML'}});await app.settle();
  assert.deepEqual(app.calls[0].payload,{id:lesson.id});assert.equal(app.configured[0].worksheetOnly,false);
});

for(const kind of ['assessment','answer'])test(`${kind} PDF opens as an in-memory preview with a download link`,async()=>{
  const item={...lesson,kind,format:'pdf',title:'8차시 / PDF'};
  const app=harness({request:async()=>pdf(item)});await app.settle();
  assert.equal(app.blobs.length,1);assert.equal(app.blobs[0].type,'application/pdf');
  assert.equal(await app.blobs[0].text(),'%PDF-1.7\nfixture');
  const [download,frame]=app.main.children;
  assert.equal(download.download,'8차시 _ PDF.pdf');assert.equal(download.href,frame.src);assert.match(frame.src,/^blob:/);
  assert.equal(frame.title,item.title);assert.equal(app.adapted.length,0);assert.equal(app.writes.length,0);
  await app.fire('pagehide');assert.equal(app.main.children.length,0);assert.equal(app.revoked.length,1);
  await app.fire('pageshow',{persisted:true});assert.equal(app.location.reloaded,1);
});

test('PDF access refusal and invalid bytes never create a preview or download',async()=>{
  for(const response of [async()=>{throw new Error('접근 권한 없음');},async()=>({...pdf({...lesson,kind:'answer',format:'pdf'}),file_base64:btoa('not a PDF')})]) {
    const app=harness({request:response});await app.settle();
    assert.equal(app.blobs.length,0);assert.equal(app.main.children.length,0);assert.equal(app.nodes.htmlLessonRetry.hidden,false);
  }
});

test('PDF access is rechecked on focus and a revoked session removes the preview',async()=>{
  let reads=0;const app=harness({request:async()=>{if(++reads>1)throw new Error('권한 만료');return pdf({...lesson,kind:'answer',format:'pdf'});}});await app.settle();
  await app.fire('focus');assert.equal(reads,2);assert.equal(app.revoked.length,1);assert.equal(app.main.children.length,0);
  assert.match(app.nodes.htmlLessonStatus.textContent,/권한 만료/);
});

test('an account change during source retrieval cannot execute another account private HTML',async()=>{
  let resolve;const pending=new Promise(done=>resolve=done);const app=harness({request:()=>pending});
  app.auth({});resolve({item:lesson,content:'private source'});await app.settle();
  assert.equal(app.writes.length,0);assert.equal(app.adapted.length,0);assert.match(app.nodes.htmlLessonStatus.textContent,/로그인 상태가 변경/);
});

test('wrong content identities and missing explicit worksheet links stop before execution',async()=>{
  const wrong=harness({request:async()=>({item:{...lesson,id:worksheet.id},content:'wrong source'})});await wrong.settle();
  assert.equal(wrong.writes.length,0);
  const missing=harness({query:`id=${lesson.id}&worksheet=1&worksheetId=${worksheet.id}`,request:async action=>action==='catalog'?{items:[]}:{item:lesson,content:'lesson source'}});await missing.settle();
  assert.equal(missing.writes.length,0);assert.match(missing.nodes.htmlLessonStatus.textContent,/연결되어 있지/);
});
