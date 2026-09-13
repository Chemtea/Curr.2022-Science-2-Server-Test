import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {crc32, deflateRawSync} from 'node:zlib';
import converter from './convert-source.cjs';
import {publicPack, quizData} from '../supabase/functions/content-api/index.ts';

function fixture() {
  const manifest = {schema:'science-lesson-source/v1',kind:'lesson',lessonId:'synthetic',profile:'four-stage-inquiry',requiredEngineContract:'science-common/parity-1',metadata:{unitKey:'unit_test',lessonName:'Synthetic lesson',pageTitle:'Synthetic page',titleHtml:'<b>Lesson</b>',headerTag:'Test',subtitleHtml:'<em>Subtitle</em>',footerHtml:'Footer',sourceContainerMaxWidths:['950px']},stages:[1,2,3].map(n=>({id:'step'+n,title:'Stage '+n,htmlFile:'stages/step'+n+'.html'})),quiz:{stageId:'step4',tabTitle:'Assessment',file:'quiz.public.json'},experiment:{scriptFile:'experiment/experiment.js',styleFile:'experiment/experiment.css',dependenciesFile:'experiment/dependencies.json',hostContract:'science-experiment-content/v1'},teacher:{file:'teacher/quiz.private.json',visibility:'teacher-only'}};
  const question = {id:'q1',promptHtml:'<b>Question</b>',contextHtml:'<blockquote>Context remains visible</blockquote>',choices:[{id:'q1-c1',html:'One'},{id:'q1-c2',html:'Two'}],review:{stepId:'step2',label:'Review stage 2'}};
  const key = {questionId:'q1',correctChoiceId:'q1-c2',correctTitleHtml:'Correct feedback',explanationHtml:'<b>Private explanation</b>',wrongHintHtml:'Private hint',wrongReasons:{'q1-c1':'Private reason'}};
  return {schema:'science-lesson-import/v1',manifest,files:{'stages/step1.html':'<p id="concept">Concept</p>','stages/step2.html':'<canvas id="simulation"></canvas>','stages/step3.html':'<p>Apply</p>','experiment/experiment.js':'window.scientificValue=7;','experiment/experiment.css':'#simulation{height:100px}','experiment/dependencies.json':JSON.stringify({contract:'science-experiment-content/v1',externalLibraries:[],network:'none',accountAccess:'none',gradeSubmission:'none',outgoingEvents:[]}),'quiz.public.json':JSON.stringify({schema:'science-quiz-content/v1',lessonId:'synthetic',instructionsProfile:'first-choice-feedback-submit-review',questions:[question]}),'teacher/quiz.private.json':JSON.stringify({schema:'science-quiz-teacher/v1',lessonId:'synthetic',answers:[key]})}};
}
function zip(entries, method=8) {
  const locals=[], centrals=[];let offset=0;
  for (const [name,value] of entries) { const filename=Buffer.from(name), raw=Buffer.from(value), data=method===8?deflateRawSync(raw):raw, local=Buffer.alloc(30), central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(method,8);local.writeUInt32LE(crc32(raw),14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(filename.length,26);
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(method,10);central.writeUInt32LE(crc32(raw),16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
    locals.push(local,filename,data);centrals.push(central,filename);offset+=local.length+filename.length+data.length;
  }
  const directory=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}
const asFile=(name,data)=>({name,size:data.length,arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),text:async()=>data.toString('utf8')});

test('single source JSON runs exact server validation and separates every private feedback field', async()=>{
  const api=converter.importer(), source=fixture(), [parsed]=await api.parseFile(asFile('lesson.json',Buffer.from(JSON.stringify(source))));
  const converted=api.convertSource(parsed.manifest,parsed.files), result=publicPack(converted.content,quizData(converted.quiz_data),'synthetic');
  assert.deepEqual(JSON.parse(JSON.stringify(result)),JSON.parse(JSON.stringify(converted.content)));
  assert.equal(result.display.contentMaxWidth,950);assert.equal(result.steps[1].html,source.files['stages/step2.html']);assert.match(result.quiz[0].contextHtml,/Context/);
  assert.equal(converted.quiz_data[0].correct,2);assert.equal(converted.quiz_data[0].wrongReasons['q1-c1'],'Private reason');
  for(const secret of ['Private explanation','Private reason','Private hint','correctChoiceId','wrongReasons']) assert.equal(JSON.stringify(result).includes(secret),false);
});
test('stored and deflated ZIP imports preserve UTF-8 text and support choosing a lesson in a bundle',async()=>{
  const api=converter.importer(), source=fixture();
  for(const method of [0,8]) {const entries=[['bundle/lessons/test/lesson.json',JSON.stringify(source.manifest)],...Object.entries(source.files).map(([k,v])=>['bundle/lessons/test/'+k,v]),['bundle/안내.txt','테스트 안내']]; const sources=await api.parseFile(asFile('bundle.zip',zip(entries,method)));assert.equal(sources.length,1);assert.equal(api.convertSource(sources[0].manifest,sources[0].files).content.title,'Synthetic page');}
});
test('ZIP rejects traversal, duplicates, corrupt checksums, encrypted files and oversized output',async()=>{
  const api=converter.importer();
  await assert.rejects(()=>api.unzip(zip([['../lesson.json','{}']])),/경로/);
  await assert.rejects(()=>api.unzip(zip([['a.txt','one'],['a.txt','two']])),/두 번/);
  for(const mode of ['crc','encrypted','size']) {const bytes=zip([['a.txt','data']]), central=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));if(mode==='crc')bytes.writeUInt32LE(0,central+16);if(mode==='encrypted')bytes.writeUInt16LE(0x801,central+8);if(mode==='size')bytes.writeUInt32LE(3*1024*1024,central+24);await assert.rejects(()=>api.unzip(bytes),/검증값|암호화|용량/);}
});
test('missing feedback, unresolved files, hidden public keys and malformed review IDs fail before save',()=>{
  const api=converter.importer();
  for(const mutation of [s=>delete s.files['stages/step2.html'],s=>{const q=JSON.parse(s.files['quiz.public.json']);q.questions[0].correct=2;s.files['quiz.public.json']=JSON.stringify(q);},s=>{const q=JSON.parse(s.files['quiz.public.json']);q.questions[0].review.stepId='step4';s.files['quiz.public.json']=JSON.stringify(q);},s=>{const q=JSON.parse(s.files['teacher/quiz.private.json']);q.answers[0].wrongReasons={};s.files['teacher/quiz.private.json']=JSON.stringify(q);},s=>s.manifest.metadata.sourceContainerMaxWidths=['1700px'],s=>s.manifest.stages[1].htmlFile='../secret']) {const source=fixture();mutation(source);assert.throws(()=>api.convertSource(source.manifest,source.files));}
});
test('non-teacher open and blank-template download never request private content or create a file',async()=>{
  let requests=0;const window={ScienceContentClient:{auth:()=>({studentSessionToken:'synthetic'}),request:()=>{requests++;}}};
  vm.runInNewContext(fs.readFileSync(new URL('../assets/content-importer.js',import.meta.url),'utf8'),{window,isAdminMode:false,TextDecoder,TextEncoder});
  assert.equal(await window.ScienceContentImporter.open(),false);assert.equal(window.ScienceContentImporter.downloadTemplate(),false);assert.equal(requests,0);
});
test('delivered original lessons all pass importer and exact API validation when source kit is present', t=>{
  const directory=path.resolve('..','..','content-kit-work','bundle','lessons');if(!fs.existsSync(directory))return t.skip('Private source kit is not included in the public checkout.');
  let questions=0,contexts=0,reasons=0;
  for(const lesson of fs.readdirSync(directory)){const converted=converter.convert(path.join(directory,lesson));const result=publicPack(converted.content,quizData(converted.quiz_data),lesson);questions+=result.quiz.length;contexts+=result.quiz.filter(q=>q.contextHtml).length;reasons+=converted.quiz_data.reduce((n,k)=>n+Object.keys(k.wrongReasons).length,0);}
  assert.equal(questions,60);assert.equal(contexts,4);assert.equal(reasons,182);
});
