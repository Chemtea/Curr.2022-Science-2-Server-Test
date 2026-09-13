import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const loader=readFileSync(new URL('../assets/lesson-loader.js',import.meta.url),'utf8');
const core=readFileSync(new URL('../assets/lesson-core.js',import.meta.url),'utf8');
const helper=loader.match(/function requiresLegacyStepLocks\(item\)\{[^\n]+\}/)[0];
function setup(lessonId){
 const alerts=[];const element={addEventListener(){},classList:{toggle(){}},style:{}};
 const context=vm.createContext({window:{PLATFORM_CONFIG:{},LESSON_CONFIG:{lessonKey:lessonId,trustedBuiltin:false},dispatchEvent(){},scrollTo(){}},document:{getElementById:()=>element,querySelectorAll:()=>[]},CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},Event:class{},alert:message=>alerts.push(message),console});
 vm.runInContext(helper+`;window.LESSON_CONFIG.trustedBuiltin=requiresLegacyStepLocks({lesson_id:${JSON.stringify(lessonId)}});`,context);
 vm.runInContext(core+'\nglobalThis.check={trySwitchStep,locks:stepLocks,getStep:()=>currentActiveStep};',context);
 return{...context.check,trustedBuiltin:context.window.LESSON_CONFIG.trustedBuiltin,alerts};
}
test('server-recognized legacy lessons stay closed without a successful lock fetch even as v3 packs',()=>{
 const app=setup('u7_l4');assert.equal(app.trustedBuiltin,true);assert.equal(app.locks[1],false);assert.equal(app.locks[4],true);app.trySwitchStep(4);assert.equal(app.getStep(),1);assert.match(app.alerts[0],/잠겨/);
});
test('new lessons use normal open defaults without matching a particular demo key',()=>{
 for(const id of ['demo_light_path','teacher_new_2027','u7_l9']){const app=setup(id);assert.equal(app.trustedBuiltin,false);app.trySwitchStep(4);assert.equal(app.getStep(),4);assert.equal(app.alerts.length,0);}
});
