import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../assets/lesson-sandbox.js',import.meta.url),'utf8');
function harness(){
  const listeners=new Map(),sent=[];
  class Element {
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.style={};this.events={};this.isConnected=true;this.hidden=false;this.contentWindow={postMessage(message){sent.push(message);}};}
    append(...children){this.children.push(...children);}
    setAttribute(name,value){this.attributes[name]=value;}
    addEventListener(name,fn){this.events[name]=fn;}
    remove(){this.isConnected=false;}
  }
  const document={hidden:false,createElement:tag=>new Element(tag),createTextNode:text=>text,addEventListener(){},removeEventListener(){}};
  const window={addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}};
  class DOMParser {parseFromString(html){return {querySelectorAll:()=>[],body:{innerHTML:html}};}}
  vm.runInNewContext(source,{window,document,DOMParser,console,setInterval,clearInterval,setTimeout,clearTimeout,isSecureContext:true,navigator:{}});
  const host=new Element('div');
  const pack={schema:'science-lesson/v2',steps:[{html:'<p>내용</p>'},{html:''},{html:''}],simulation:{js:'window.example=1;',css:'',dependencies:[]}};
  return {api:window.ScienceLessonSandbox,host,pack,listeners,sent};
}

test('editable experiments receive scripts permission only and cannot capture devices',()=>{
  const h=harness();const runtime=h.api.mount(h.pack,h.host);const frame=h.host.children.find(x=>x.tagName==='IFRAME');
  assert.equal(frame.attributes.sandbox,'allow-scripts');
  assert.match(frame.attributes.allow,/microphone 'none'/);
  assert.match(frame.attributes.allow,/camera 'none'/);
  assert.match(frame.srcdoc,/connect-src 'none'/);
  assert.match(frame.srcdoc,/form-action 'none'/);
  assert.doesNotMatch(frame.srcdoc,/allow-same-origin/);
  runtime.destroy();
});

test('unrelated windows and nonopaque origins cannot operate the runtime bridge',()=>{
  const h=harness();h.api.mount(h.pack,h.host);const frame=h.host.children.find(x=>x.tagName==='IFRAME');
  const receive=h.listeners.get('message');
  receive({source:{},origin:'null',data:{channel:'science-experiment/v3',type:'ready'}});
  receive({source:frame.contentWindow,origin:'https://attacker.example',data:{channel:'science-experiment/v3',type:'ready'}});
  assert.equal(h.sent.length,0);
  receive({source:frame.contentWindow,origin:'null',data:{channel:'science-experiment/v3',type:'ready'}});
  assert.equal(h.sent.length,1);
  assert.deepEqual(Object.keys(h.sent[0]).sort(),['channel','step','type']);
});

test('bridge ignores attempted submission/auth actions and clamps layout heights',()=>{
  const h=harness();h.api.mount(h.pack,h.host);const frame=h.host.children.find(x=>x.tagName==='IFRAME');const receive=h.listeners.get('message');
  const event=data=>({source:frame.contentWindow,origin:'null',data:{channel:'science-experiment/v3',...data}});
  receive(event({type:'submit_quiz',answers:[1,2,3,4]}));receive(event({type:'get_session'}));
  assert.equal(h.sent.length,0);
  receive(event({type:'height',height:1e10}));assert.equal(frame.style.height,'24000px');
  receive(event({type:'height',height:NaN}));assert.equal(frame.style.height,'24000px');
});

test('external experiment dependencies and HTML script breakouts are rejected or escaped',()=>{
  const h=harness();
  assert.throws(()=>h.api.documentSource({...h.pack,simulation:{dependencies:['https://attacker.example/a.js']}}),/외부/);
  const html=h.api.documentSource({...h.pack,simulation:{js:'const text="</script><script>parent.secret()</script>";',css:'a:after{content:"</style>"}',dependencies:[]}});
  assert.ok(html.includes('<\\/script>'));
  assert.ok(html.includes('<\\/style>'));
  assert.equal((html.match(/<\/script>/g)||[]).length,2);
});

test('leaving experimental steps hides the frame and sends a bounded step message',()=>{
  const h=harness();const runtime=h.api.mount(h.pack,h.host);const frame=h.host.children.find(x=>x.tagName==='IFRAME');
  h.listeners.get('message')({source:frame.contentWindow,origin:'null',data:{channel:'science-experiment/v3',type:'ready'}});
  runtime.setStep(4);assert.equal(h.host.hidden,true);assert.equal(h.sent.at(-1).step,4);
  runtime.setStep(3);assert.equal(h.host.hidden,false);assert.equal(h.sent.at(-1).step,3);
  runtime.setStep(-100);assert.equal(h.host.hidden,true);assert.equal(h.sent.at(-1).step,0);
  runtime.destroy();assert.equal(h.listeners.has('message'),false);
});

test('v3 content receives its readonly bridge, ready event once, and authorized step changes',()=>{
 const h=harness();const html=h.api.documentSource({...h.pack,schema:'science-lesson/v3'});
 const bridge=html.match(/<script>([\s\S]*?)<\/script>/)[1];const listeners=new Map(),seen=[];const elements=Array.from({length:3},()=>({classList:{toggle(){}},getBoundingClientRect:()=>({height:400})}));
 const parent={postMessage:message=>seen.push(message)};
 const window={addEventListener(name,fn,options){listeners.set(name,{fn,options});},dispatchEvent(event){listeners.get(event.type)?.fn(event);}};
 const document={querySelectorAll:()=>elements,querySelector:()=>elements[0]};
 vm.runInNewContext(bridge,{window,document,parent,Object,Number,Array,Math,String,Event:class{constructor(type){this.type=type;}},CustomEvent:class{constructor(type,{detail}={}){this.type=type;this.detail=detail;}},requestAnimationFrame:fn=>fn()});
 let readyCount=0,lastStep=null;window.addEventListener('science-lesson-ready',()=>readyCount++);window.addEventListener('science-step-change',event=>{lastStep=event.detail.step;});
 assert.equal(Object.getOwnPropertyDescriptor(window,'ScienceLessonBridge').writable,false);assert.equal(window.ScienceLessonBridge.getActiveStep(),0);
 assert.equal(listeners.get('DOMContentLoaded').options.once,true);listeners.get('DOMContentLoaded').fn();assert.equal(readyCount,1);assert.ok(seen.some(x=>x.type==='ready'));
 listeners.get('message').fn({source:parent,data:{channel:'science-experiment/v3',type:'step',step:3}});assert.equal(lastStep,3);assert.equal(window.ScienceLessonBridge.isStepActive(3),true);
 listeners.get('message').fn({source:{},data:{channel:'science-experiment/v3',type:'step',step:1}});assert.equal(window.ScienceLessonBridge.getActiveStep(),3);
});

test('an isolated microphone request only opens the trusted host prompt and cannot itself call capture',async()=>{
 const h=harness();const runtime=h.api.mount({...h.pack,schema:'science-lesson/v3',simulation:{...h.pack.simulation,microphone:true}},h.host);const frame=h.host.children.find(x=>x.tagName==='IFRAME');runtime.setStep(3);
 h.listeners.get('message')({source:frame.contentWindow,origin:'null',data:{channel:'science-experiment/v3',type:'media-request',event:'science-microphone-request',detail:{action:'start',requestId:7}}});
 const mic=h.host.children[1];assert.equal(mic.hidden,false);assert.match(mic.children[2].textContent,/허용 버튼/);assert.equal(h.sent.at(-1).detail.state,'pending');
 await mic.children[0].events.click({isTrusted:false});assert.equal(h.sent.at(-1).detail.state,'pending','synthetic click cannot grant capture');runtime.destroy();
});

test('tone changes cannot create sound from a frame message or synthetic host click',async()=>{
 const h=harness();const runtime=h.api.mount({...h.pack,schema:'science-lesson/v3'},h.host);const frame=h.host.children.find(x=>x.tagName==='IFRAME');runtime.setStep(2);
 h.listeners.get('message')({source:frame.contentWindow,origin:'null',data:{channel:'science-experiment/v3',type:'media-request',event:'science-tone-request',detail:{action:'start',requestId:4,frequency:500,gain:100,durationMs:999999,wave:{type:'sine'}}}});
 const tone=h.host.children[0];assert.equal(tone.hidden,false);assert.equal(h.sent.at(-1).detail.state,'stopped');await tone.children[0].events.click({isTrusted:false});assert.equal(h.sent.at(-1).detail.state,'stopped');runtime.destroy();
});
