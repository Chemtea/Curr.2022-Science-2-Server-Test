import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const managerSource = source('assets/content-manager.js');
const index = source('index.html');
const start = index.indexOf('        function createUnitCard(key, unit) {');
const end = index.indexOf('        function renderLessonCards(unit) {', start);
assert.ok(start >= 0 && end > start);
const hubSource = index.slice(start, end);
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const clone = value => JSON.parse(JSON.stringify(value));
const newLesson = {id:'12345678-1234-4234-8234-123456789012', kind:'lesson', format:'lesson-pack', unit_id:'unit8',
  unit_title:'8단원 별과 우주', lesson_id:'u8_l1', title:'1차시 — 별까지의 거리', description:'시차로 읽는 거리', published:false, student_access:false, version:1};
const custom = (unit_id = 'unit8', overrides = {}) => ({unit_id, icon:'sun', color_start:'#0ea5e9', color_end:'#4338ca', mode:'gradient', angle:120, version:1, ...overrides});

// Run the shipped manager init, catalog handlers and index card functions.
// Only the transport, DOM and appearance component boundary are fixtures.
// This exercises integration control flow; it is not browser or remote QA.
function harness({mode=true, auth={adminSessionToken:'teacher-fixture'}, role='admin', items=[newLesson], styles=[], realAppearance=false, coldAssets=false} = {}) {
  const nodes = new Map(), events = new Map(), calls = [], enters = [], timers = new Map();
  let timerId = 0, identity = auth, catalog = {success:true, role, items:clone(items), unit_appearances:clone(styles)};
  let responder = async (action, body) => {
    if (action === 'catalog') return clone(catalog);
    assert.equal(action, 'set_unit_appearance');
    const saved = {...body.appearance, unit_id:body.unit_id, version:body.expected_version+1};
    catalog.unit_appearances = [saved]; return {success:true, appearance:clone(saved)};
  };
  class Element {
    constructor(tag='div') { this.tagName=tag.toUpperCase(); this.attributes={}; this.dataset={}; this.children=[]; this.handlers={}; this.hidden=false; this.disabled=false; this.open=false; this.value=''; this.textContent=''; this.style={setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}}; this.local=new Map(); const names=new Set(); this.classList={add:name=>names.add(name),contains:name=>names.has(name)}; }
    set id(value) {this._id=value; nodes.set(value,this);} get id(){return this._id;}
    set innerHTML(html) {this.html=html;this.children=[];this.local.clear();
      for(const m of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {const child=new Element(m[1]);child.id=m[3];const v=m[2].match(/\bvalue="([^"]*)"/);child.value=v?.[1] || (m[3]==='scmKind'?'lesson':'');this.local.set('#'+child.id,child);}
      for(const name of ['unit-entry-header','unit-entry-icon','unit-entry-btn','unit-entry-title']) {
        const found=html.match(new RegExp('<([a-z][a-z0-9]*) class="'+name+'">([\\s\\S]*?)</\\1>'));
        if(found){const child=new Element(found[1]);child.html=found[2];child.textContent=found[2].replace(/<[^>]+>/g,'');this.local.set('.'+name,child);}
      }
    }
    get innerHTML(){return this.html || '';}
    setAttribute(k,v){this.attributes[k]=String(v);} getAttribute(k){return this.attributes[k];}
    append(...children){this.children.push(...children);} appendChild(child){this.append(child);return child;}
    prepend(...children){this.children.unshift(...children);} replaceChildren(...children){this.children=[...children];}
    insertBefore(child){this.children.push(child);} addEventListener(name,fn){(this.handlers[name] ||= []).push(fn);}
    querySelector(selector){return this.local.get(selector) || null;}
    querySelectorAll(selector){const tags=selector.split(',').map(tag=>tag.trim().toUpperCase());return this.children.flatMap(child=>[...(tags.includes(child.tagName)?[child]:[]),...child.querySelectorAll(selector)]);}
    focus(){} reset(){} close(){this.open=false;} showModal(){this.open=true;}
    async fire(name,event={}) {for(const fn of this.handlers[name] || [])await fn(event);}
  }
  const adminActions=new Element();
  for(const id of ['regularUnitGrid','evalUnitGrid','adminToolsBtn']){const node=new Element();node.id=id;}
  const appearance={rows:new Map(), received:[], clearCount:0, closeCount:0, opened:[], isOpen:false, config:null,
    configure(config){this.config=config;},
    receiveCatalog(rows){this.received.push(clone(rows));this.rows=new Map(rows.map(row=>[row.unit_id,clone(row)]));},
    clear(){this.rows.clear();this.clearCount++;this.close();},
    close(){this.isOpen=false;this.closeCount++;},
    open(unit){if(!this.config.canManage())return false;this.opened.push(unit);this.isOpen=true;return true;},
    iconHTML(unit){const iconId=this.rows.get(unit)?.icon || ({unit3:'light',unit7:'lightning',unit8:'galaxy'}[unit] || 'book');return window.ScienceUnitIcons.get(iconId)?.svg || '';},
    decorateCard(card,unit){card.dataset.appearanceUnit=unit;card.dataset.fixtureStyle=this.rows.has(unit)?JSON.stringify(this.rows.get(unit)):'default';}
  };
  const window={ScienceUnitAppearance:appearance,
    addEventListener(name,fn){events.set(name,fn);},
    ScienceContentClient:{auth:()=>identity,contentUrl:item=>'lesson.html?id='+item.id,
      async request(action,body){calls.push({action,body});return responder(action,body);}}};
  const unit=(id,title,theme,icon)=>({id,title,category:'regular',isLocked:false,lessons:[],desc:'기본 수업',themeClass:theme,icon,badgeClass:'badge-'+id});
  const curriculum={unit3:unit('unit3','3단원. 빛과 파동','theme-light','legacy-light'),unit7:unit('unit7','7단원. 전기와 자기','theme-electric','legacy-lightning')};
  const body=new Element('body'),head=new Element('head'),loaded=[];
  head.append=(node)=>{head.children.push(node);if(node.tagName==='SCRIPT'){const match=node.src.match(/^\.\/assets\/(unit-icons|unit-appearance|unit-banner-integration)\.js\?v=[a-z0-9-]+$/);assert.ok(match,'loader must only request the fixed local banner assets');Promise.resolve().then(()=>{loaded.push(match[1]);vm.runInContext(source('assets/'+match[1]+'.js'),context);node.onload();});}};
  const context=vm.createContext({window,isAdminMode:mode,defaultCurriculum:curriculum,
    document:{getElementById:id=>nodes.get(id)||null,createElement:tag=>new Element(tag),querySelector:selector=>selector==='#adminModeBanner .admin-banner-actions'?adminActions:null,body,head},
    evalHallVisibilityMode:'hidden',getAdminSessionToken:()=>identity.adminSessionToken || '',
    updateEvalHallAdminControls(){},renderFloatingBarStatus(){},enterUnit:key=>enters.push(key),
    loadLocksFromCloud:fn=>fn(true),alert(){},
    setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}});
  if(!coldAssets)vm.runInContext(source('assets/unit-icons.js'),context);
  if(realAppearance && !coldAssets)vm.runInContext(source('assets/unit-appearance.js'),context);
  vm.runInContext(hubSource,context);
  if(!coldAssets)vm.runInContext(source('assets/unit-banner-integration.js'),context);
  if(coldAssets)delete window.ScienceUnitAppearance;
  vm.runInContext(managerSource,context);
  return {window,context,get appearance(){return realAppearance?window.ScienceUnitAppearance:appearance;},body,head,loaded,curriculum,nodes,calls,enters,adminActions,manager:window.ScienceContentManager,
    setCatalog(value){catalog={...catalog,...clone(value)};},handle(fn){responder=fn;},setAuth(value){identity=value;},
    card(unitId){return realAppearance?nodes.get('regularUnitGrid').children[Object.keys(curriculum).indexOf(unitId)]:nodes.get('regularUnitGrid').children.find(card=>card.dataset.appearanceUnit===unitId);},
    async settle(){await tick();},async saved(){return appearance.config.onSaved();}};
}

test('catalog appearance data reaches fresh cards and replaces the previous catalog cache',async()=>{
  const app=harness({styles:[custom()]});await app.settle();
  assert.ok(app.appearance.received.length>=1);
  assert.equal(app.appearance.rows.get('unit8').icon,'sun');
  assert.match(app.card('unit8').innerHTML,/시차|별과 우주/);
  assert.ok(app.card('unit8').querySelector('.unit-entry-icon').innerHTML.includes(app.window.ScienceUnitIcons.get('sun').svg));
  assert.equal(app.curriculum.unit8.themeClass,'theme-custom');
  assert.notEqual(app.curriculum.unit8.themeClass,app.curriculum.unit7.themeClass);
  assert.notEqual(app.curriculum.unit8.icon,app.curriculum.unit7.icon);
  assert.equal(app.curriculum.unit8.lessons[0].dashboardLessonKey,'u8_l1');
  app.setCatalog({unit_appearances:[]});await app.manager.refresh();
  assert.equal(app.appearance.rows.size,0);
  assert.ok(app.card('unit8').querySelector('.unit-entry-icon').innerHTML.includes(app.window.ScienceUnitIcons.get('galaxy').svg));
  assert.equal(app.card('unit8').dataset.fixtureStyle,'default');
});

test('the top-level appearance tab requires a server-verified teacher in administrator mode',async()=>{
  for(const options of [
    {mode:false,auth:{},role:'anonymous'},
    {mode:true,auth:{studentSessionToken:'student-fixture'},role:'student'},
    {mode:true,auth:{adminSessionToken:'spoofed-fixture'},role:'student'},
    {mode:false,auth:{adminSessionToken:'teacher-fixture'},role:'admin'}
  ]){const app=harness(options);await app.settle();assert.equal(app.nodes.get('scmUnitAppearanceTab').hidden,true);assert.equal(app.card('unit7').querySelector('.unit-entry-header').children.length,0);assert.equal(await app.manager.openUnitAppearance('unit7'),false);assert.equal(app.appearance.opened.length,0);}
  const app=harness();await app.settle();assert.equal(app.nodes.get('scmUnitAppearanceTab').hidden,false);
  assert.equal(await app.manager.openUnitAppearance('unit8'),true);assert.deepEqual(app.appearance.opened,['unit8']);
  app.setCatalog({role:'student'});assert.equal(await app.manager.openUnitAppearance('unit8'),false);
  assert.equal(app.nodes.get('scmUnitAppearanceTab').hidden,true);assert.equal(app.appearance.isOpen,false);
});

test('individual unit editing stops the card navigation and rechecks authorization',async()=>{
  const app=harness();await app.settle();const card=app.card('unit8');
  const button=card.querySelector('.unit-entry-header').children.find(node=>node.className==='sua-card-edit');
  assert.ok(button);assert.equal(button.attributes['aria-haspopup'],'dialog');
  let stopped=false;await button.fire('click',{stopPropagation(){stopped=true;}});if(!stopped)card.onclick();await app.settle();
  assert.equal(stopped,true);assert.deepEqual(app.enters,[]);assert.deepEqual(app.appearance.opened,['unit8']);
  assert.equal(app.calls.length,2,'opening rechecks catalog after the initial page load');
  const choices=app.appearance.config.getUnits();assert.deepEqual(Array.from(choices,x=>x.id),['unit3','unit7','unit8']);
});

test('exiting administrator mode closes appearance without reloading an unchanged identity',async()=>{
  const app=harness();await app.settle();await app.manager.openUnitAppearance('unit8');const count=app.calls.length;
  app.context.isAdminMode=false;app.manager.authChanged();
  assert.equal(app.appearance.isOpen,false);assert.equal(app.nodes.get('scmUnitAppearanceTab').hidden,true);assert.equal(app.calls.length,count);
  assert.equal(app.card('unit8').querySelector('.unit-entry-header').children.length,0);
});

test('a delayed teacher catalog cannot restore appearance data after account change',async()=>{
  const app=harness({styles:[custom()]});await app.settle();let resolveTeacher;
  app.handle(()=>new Promise(resolve=>{resolveTeacher=resolve;}));const pending=app.manager.refresh();
  app.setAuth({studentSessionToken:'different-account'});app.context.isAdminMode=false;
  app.handle(async()=>({success:true,role:'student',items:[],unit_appearances:[custom('unit3',{icon:'light'})]}));
  app.manager.authChanged();assert.equal(app.appearance.rows.size,0);assert.equal(app.curriculum.unit8,undefined);
  await app.settle();resolveTeacher({success:true,role:'admin',items:[newLesson],unit_appearances:[custom()]});
  assert.equal(await pending,false);await app.settle();assert.equal(app.appearance.rows.has('unit8'),false);assert.equal(app.appearance.rows.get('unit3').icon,'light');
  assert.equal(app.curriculum.unit8,undefined);assert.equal(app.nodes.get('scmUnitAppearanceTab').hidden,true);
});

test('mode exit during appearance authorization never reopens the dialog',async()=>{
  const app=harness();await app.settle();let release;
  app.handle(()=>new Promise(resolve=>{release=resolve;}));const opening=app.manager.openUnitAppearance('unit8');await app.settle();
  assert.equal(app.nodes.get('scmUnitAppearanceTab').hidden,false);assert.equal(app.nodes.get('scmUnitAppearanceTab').disabled,true);
  app.context.isAdminMode=false;app.manager.authChanged();release({success:true,role:'admin',items:[newLesson],unit_appearances:[]});
  assert.equal(await opening,false);assert.equal(app.appearance.isOpen,false);assert.deepEqual(app.appearance.opened,[]);
});

test('a failed catalog discards stale appearance values and teacher edit controls',async()=>{
  const app=harness({styles:[custom()]});await app.settle();app.handle(async()=>{throw new Error('fixture unavailable');});
  assert.equal(await app.manager.refresh(),false);assert.equal(app.appearance.rows.size,0);assert.equal(app.nodes.get('scmUnitAppearanceTab').hidden,true);
  assert.equal(app.appearance.isOpen,false);assert.equal(app.curriculum.unit8,undefined);
});

test('onSaved refresh and a separate fresh client receive the same persisted catalog style',async()=>{
  const app=harness();await app.settle();const changed=custom('unit8',{icon:'earth',color_start:'#15803d',color_end:'#84cc16',version:2});
  app.setCatalog({unit_appearances:[changed]});await app.saved();
  const fresh=harness({styles:[changed]});await fresh.settle();
  assert.equal(app.card('unit8').dataset.fixtureStyle,fresh.card('unit8').dataset.fixtureStyle);
  assert.ok(app.card('unit8').querySelector('.unit-entry-icon').innerHTML.includes(app.window.ScienceUnitIcons.get('earth').svg));
  assert.ok(fresh.card('unit8').querySelector('.unit-entry-icon').innerHTML.includes(fresh.window.ScienceUnitIcons.get('earth').svg));
});

test('real artwork component supplies distinct unit8 defaults and preserved unit3/unit7 palette colors',async()=>{
  const app=harness({realAppearance:true});await app.settle();
  const expected={unit3:['star','#f59e0b','#ec4899'],unit7:['lightning','#38bdf8','#818cf8'],unit8:['galaxy','#8b5cf6','#ec4899']};
  for(const [key,[icon,start,end]] of Object.entries(expected)){
    const card=app.card(key);assert.ok(card.classList.contains('sua-card'));
    assert.ok(card.querySelector('.unit-entry-icon').innerHTML.includes(app.window.ScienceUnitIcons.get(icon).svg));
    assert.equal(card.style['--sua-start'],start);assert.equal(card.style['--sua-end'],end);
    assert.equal(app.appearance.get(key).version,0);
  }
  app.setCatalog({unit_appearances:[custom('unit8',{icon:'earth',mode:'solid',color_start:'#112233',color_end:'#AABBCC'})]});
  await app.manager.refresh();assert.equal(app.appearance.get('unit8').icon,'earth');
  assert.equal(app.card('unit8').style['--sua-start'],'#112233');assert.equal(app.card('unit8').style['--sua-end'],'#112233');
  app.setCatalog({unit_appearances:[]});await app.manager.refresh();
  assert.equal(app.appearance.get('unit8').icon,'galaxy');assert.equal(app.card('unit8').style['--sua-start'],'#8b5cf6');
});

test('real artwork dialog saves a chosen icon and triggers actual manager refresh across fresh clients',async()=>{
  const app=harness({realAppearance:true});await app.settle();assert.equal(await app.manager.openUnitAppearance('unit8'),true);
  const dialog=app.nodes.get('suaDialog');assert.equal(dialog.open,true);
  const controls=dialog.querySelectorAll('button');
  assert.equal(controls.filter(button=>button.dataset.icon).length,21);
  await controls.find(button=>button.dataset.icon==='flower').fire('click');
  assert.equal(app.appearance.get('unit8').icon,'galaxy','an unsaved preview leaves public catalog appearance untouched');
  await controls.find(button=>button.className==='sua-button sua-primary').fire('click');
  const writes=app.calls.filter(call=>call.action==='set_unit_appearance');assert.equal(writes.length,1);
  assert.equal(writes[0].body.unit_id,'unit8');assert.equal(writes[0].body.expected_version,0);
  assert.equal(writes[0].body.appearance.icon,'flower');assert.equal(app.appearance.get('unit8').version,1);
  assert.ok(app.card('unit8').querySelector('.unit-entry-icon').innerHTML.includes(app.window.ScienceUnitIcons.get('flower').svg));
  assert.equal(app.calls.at(-1).action,'catalog');
  const fresh=harness({realAppearance:true,styles:[clone(app.appearance.get('unit8'))]});await fresh.settle();
  assert.equal(fresh.appearance.get('unit8').icon,'flower');
  assert.equal(fresh.card('unit8').style['--sua-paint'],app.card('unit8').style['--sua-paint']);
});

test('real appearance dialog closes on mode exit during saving and ignores the delayed UI result',async()=>{
  const app=harness({realAppearance:true});await app.settle();await app.manager.openUnitAppearance('unit8');
  const dialog=app.nodes.get('suaDialog'),controls=dialog.querySelectorAll('button');
  await controls.find(button=>button.dataset.icon==='sun').fire('click');let finishSave;
  app.handle((action,body)=>{assert.equal(action,'set_unit_appearance');return new Promise(resolve=>{finishSave=()=>resolve({success:true,appearance:{...body.appearance,unit_id:'unit8',version:1}});});});
  const saving=controls.find(button=>button.className==='sua-button sua-primary').fire('click');
  assert.equal(dialog.attributes['aria-busy'],'true');
  app.context.isAdminMode=false;app.manager.authChanged();assert.equal(dialog.open,false);
  finishSave();await saving;assert.equal(dialog.open,false);assert.equal(app.appearance.get('unit8').version,0);
  assert.equal(app.nodes.get('scmUnitAppearanceTab').hidden,true);
});

test('cold assets load through the real manager and preserve a catalog that arrived first',async()=>{
  const saved=custom('unit8',{icon:'cell',color_start:'#007744',color_end:'#88CC22'});
  const app=harness({realAppearance:true,coldAssets:true,styles:[saved]});
  assert.equal(app.window.ScienceUnitAppearance,undefined);
  await app.settle();await app.settle();
  assert.deepEqual(app.loaded,['unit-icons','unit-appearance','unit-banner-integration']);
  assert.equal(app.head.children[0].rel,'stylesheet');
  assert.match(app.head.children[0].href,/^\.\/assets\/unit-appearance\.css\?v=/);
  assert.equal(app.window.ScienceUnitBannerIntegrated,true);
  assert.equal(app.appearance.get('unit8').icon,'cell');
  assert.equal(app.card('unit8').style['--sua-start'],'#007744');
  assert.ok(app.card('unit8').querySelector('.unit-entry-icon').innerHTML.includes(app.window.ScienceUnitIcons.get('cell').svg));
  assert.equal(app.card('unit8').querySelector('.unit-entry-btn').children[1].textContent,'8단원 별과 우주 입장하기 ➔');
  assert.equal(await app.manager.openUnitAppearance('unit8'),true);
  assert.equal(app.nodes.get('suaDialog').open,true);
});

test('loading the narrow banner extension twice does not duplicate edit controls or replace locked navigation',async()=>{
  const app=harness({realAppearance:true});await app.settle();
  vm.runInContext(source('assets/unit-banner-integration.js'),app.context);
  app.curriculum.unit8.isLocked=true;app.context.renderUnitHub();
  const card=app.card('unit8');
  assert.equal(card.querySelector('.unit-entry-header').children.filter(button=>button.className==='sua-card-edit').length,1);
  assert.match(card.querySelector('.unit-entry-btn').innerHTML,/잠김/);
  assert.equal(card.querySelector('.unit-entry-btn').children.length,0);
});

test('superseded authorization cannot open the editor while another catalog check is pending',async()=>{
  const app=harness();await app.settle();const pending=[];
  app.handle(()=>new Promise(resolve=>pending.push(resolve)));
  const opening=app.manager.openUnitAppearance('unit8');await app.settle();
  const background=app.manager.refresh();assert.equal(pending.length,2);
  pending[0]({success:true,role:'admin',items:[newLesson],unit_appearances:[]});
  assert.equal(await opening,false);assert.equal(app.appearance.isOpen,false);
  pending[1]({success:true,role:'student',items:[],unit_appearances:[]});
  await background;assert.equal(app.nodes.get('scmUnitAppearanceTab').hidden,true);
});
