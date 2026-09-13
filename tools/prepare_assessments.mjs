/** Convert the owner's legacy assessment HTML to isolated, server-hosted activity documents.
 * Sources/output are private directories supplied explicitly; never add generated records to Git.
 * Function boundaries are checked by the JS parser; source text is never executed by this tool.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('Usage: node tools/prepare_assessments.mjs PRIVATE_SOURCE_DIR PRIVATE_OUTPUT_DIR');
fs.mkdirSync(output,{recursive:true});
function uuid5(name){const ns=Buffer.from('6ba7b8119dad11d180b400c04fd430c8','hex');const b=crypto.createHash('sha1').update(Buffer.concat([ns,Buffer.from(name)])).digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');}
function replaceFunction(source,name,replacement){
  const pattern=new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\('),match=pattern.exec(source);if(!match)return source;
  const start=match.index;let end=source.indexOf('}',start),done=false;
  while(end>=0){try{new vm.Script(source.slice(start,end+1));done=true;break;}catch{}end=source.indexOf('}',end+1);}
  if(!done)throw new Error('Cannot safely find function '+name);
  return source.slice(0,start)+replacement+source.slice(end+1);
}
const memoryPrelude=`const frameMemory=(()=>{const values=new Map();return{getItem:k=>values.get(String(k))??null,setItem:(k,v)=>values.set(String(k),String(v)),removeItem:k=>values.delete(String(k)),clear:()=>values.clear()};})();window.__assessmentIdentity=null;`;
function cleanCommon(source){return source.replace(/\b(?:sessionStorage|localStorage)\b/g,'frameMemory').replace(/https:\/\/[^\s"'`<>]+/g,'').replace(/window\.open\([^;]+;/g,'');}
function legacyAdapter(source){
  for(const name of ['verifyUnlockAuth','verifyTeacherAuth','fetchStudentFromSheet','openTeacherAuthModal','openUnlockModal','executeSubmitData','openSubmitModal'])source=replaceFunction(source,name,`function ${name}(){alert('페이지 위쪽의 공통 제출·교사 수합 기능을 사용해 주세요.');}`);
  source=replaceFunction(source,'verifyPassword',"function verifyPassword(){isGraphUnlocked=true;isGraphVisible=true;document.getElementById('pwdPanel').style.display='none';document.getElementById('graphContainer').style.display='block';renderGraph();}");
  return source+`\nwindow.ScienceAssessmentDocument={init(info){window.__assessmentIdentity=info;stuId.value=info.studentId;stuName.value=info.name;stuId.readOnly=true;stuName.readOnly=true;isStudentLocked=true;btnRecord.disabled=false;btnLockStudent.style.display='none';btnUnlockStudent.style.display='none';},export(){return{schema:'science-circuit-assessment/v1',logs:JSON.parse(JSON.stringify(logs))};},restore(data){if(Array.isArray(data.logs)){logs=JSON.parse(JSON.stringify(data.logs));renderTable();}},lock(value){isSubmitted=value===true;btnRecord.disabled=isSubmitted;btnClearLogs.disabled=isSubmitted;}};`;
}
function soundAdapter(source){
  source=source.replace(/^init\(\);\s*$/m,'');
  source=replaceFunction(source,'getStoredUser','function getStoredUser(){return window.__assessmentIdentity?{studentId:window.__assessmentIdentity.studentId,name:window.__assessmentIdentity.name,isAdmin:false}:null;}');
  source=replaceFunction(source,'applyAuth','async function applyAuth(){}');
  source=replaceFunction(source,'loadRuntimeState','async function loadRuntimeState(){runtimeStateLoaded=true;renderSoundState();}');
  source=replaceFunction(source,'loadStudentAssessmentState','async function loadStudentAssessmentState(){}');
  source=replaceFunction(source,'ensureCurrentSchoolYear','async function ensureCurrentSchoolYear(){return CURRENT_SCHOOL_YEAR;}');
  source=replaceFunction(source,'persistDraft',"function persistDraft(){setDraftStatus('기기 임시저장 · 최종 제출은 위쪽 공통 버튼 사용');}");
  for(const name of ['saveServerDraft','queueServerDraftSave','executeSubmit','openSubmitModal','submitLogin','verifyProtectedLogout','authenticateInlineAdmin','loadInlineStudentStatus','toggleInlineResubmission','toggleInlineGlobalMute'])source=replaceFunction(source,name,`function ${name}(){return;}`);
  source=source.replace(/fetch\("https:\/\/api\.ipify\.org\?format=json"\)[^\n]+/,'clientIpAddress="";');
  return 'const ASSESSMENT_CONFIG={UNIT_KEY:"unit3_eval",LESSON_ID:"u3e_l3",MODE:"summative",FALLBACK_SCHOOL_YEAR:2026};\n'+source+`\nwindow.ScienceAssessmentDocument={init(info){window.__assessmentIdentity=info;CURRENT_SCHOOL_YEAR=Number(info.schoolYear)||2026;$('stuId').value=info.studentId;$('stuName').value=info.name;$('stuId').readOnly=true;$('stuName').readOnly=true;$('assessmentGate').style.display='none';$('loginStatus').textContent=info.studentId+' '+info.name;isStudentSession=true;remoteStateLoaded=true;serverAvailable=true;teacherSoundMuted=info.soundMuted!==false;renderVariableButtons();renderProcedureSteps();renderAll();drawWave();renderSoundState();},export(){return snapshotForServer();},restore(payload){applySnapshot(payload);renderAll();},lock(value){isSubmitted=value===true;if(isSubmitted)stopSound();renderAll();},sound(muted){teacherSoundMuted=muted!==false;renderSoundState();},beforePrint(){stopSound();}};`;
}
function worksheetAdapter(source){
  source=replaceFunction(source,'worksheetCanEdit','function worksheetCanEdit(){return Boolean(worksheetIdentity&&WorksheetOnline.canEdit);}');
  source=replaceFunction(source,'refreshWorksheetOnlineState','async function refreshWorksheetOnlineState(){}');
  source=replaceFunction(source,'submitWorksheet',"async function submitWorksheet(){alert('페이지 위쪽의 활동 내용 제출을 사용해 주세요.');}");
  source=replaceFunction(source,'switchStudent','function switchStudent(){}');
  source=replaceFunction(source,'saveNow',"function saveNow(){worksheetStatus('기기 임시저장 · 최종 제출은 위쪽 공통 버튼 사용','saved');}");
  return source+`\nwindow.ScienceAssessmentDocument={init(info){window.__assessmentIdentity=info;WorksheetOnline.student={studentId:info.studentId,name:info.name,schoolYear:info.schoolYear};WorksheetOnline.canEdit=true;WorksheetOnline.canSubmit=true;worksheetIdentity={sid:info.studentId,name:info.name,schoolYear:info.schoolYear};document.getElementById('sid').value=info.studentId;document.getElementById('name').value=info.name;worksheetSetEditing(true);syncPrintAnswers();worksheetStatus('활동 완료 후 페이지 위쪽의 공통 제출 버튼을 눌러 주세요.','info');},export(){worksheetCommitSketch();return collect();},restore(payload){const restored={...payload,identity:worksheetIdentity,fields:{...payload.fields,sid:worksheetIdentity.sid,name:worksheetIdentity.name}};worksheetApplyRecord(worksheetValidateRecord(restored));},lock(value){WorksheetOnline.canEdit=value!==true;worksheetSetEditing(value!==true);},beforePrint(){worksheetCommitSketch();syncPrintAnswers();}};`;
}
function printAdapter(source){
  for(const name of ['applyAuth','authenticateTeacher','ensureCurrentSchoolYear','loadRuntimeState','fetchAllStudents','toggleGlobalSoundMute'])source=replaceFunction(source,name,`async function ${name}(){return;}`);
  source=source.replace(/^applyAuth\(\);.*$/m,'');
  return 'const PRINT_CONFIG={UNIT_KEY:"unit3_eval",LESSON_ID:"u3e_l2",FALLBACK_SCHOOL_YEAR:2026};\n'+source+`\nwindow.ScienceAssessmentPrint={render(records){const students=records.map(entry=>{const r=entry.submission,p=entry.payload,studentId=String(r.canonical_code).replace(/^([1-3])0([1-9][0-9]{2})$/,'$1$2'),record={payload:p,studentId,studentName:r.student_name,attemptNo:r.revision,submissionId:r.id,submittedAt:r.created_at,schoolYear:2026};return{ok:true,studentId,studentName:r.student_name,versions:[normalizeVersion(record,record)],selectedAttemptNo:r.revision,selected:true};});buildPrintArea(students);document.querySelectorAll('.screen,.modal').forEach(el=>el.style.display='none');}};`;
}
const resources=[
 ['01_formative_circuit_lab.html','assessment','unit3_eval','u3e_l1','legacy'],
 ['02_assessment_report_form.html','assessment','unit3_eval','u3e_l2','static'],
 ['03_summative_circuit_lab.html','assessment','unit3_eval','u3e_l3','legacy'],
 ['Unit3_01_assessment_wavelength_lab.html','assessment','unit3_eval','u3e_l3','sound'],
 ['Unit3_02_assessment_report_wavelength_lab.html','answer','unit3_eval','u3e_l2','print'],
 ['unit4_lesson1_two_session.html','assessment','unit4_eval','u4e_l1','worksheet'],
 ['unit4_lesson2_two_session.html','assessment','unit4_eval','u4e_l2','worksheet']
];
const manifest=[];
for(const [name,kind,unit,lesson,mode] of resources){
  const original=fs.readFileSync(path.join(input,name),'utf8'),title=original.match(/<title>(.*?)<\/title>/s)?.[1]||name;
  const scripts=[...original.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
  let html=original.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  let source=mode==='static'?'':scripts.at(-1);
  if(mode==='legacy')source=legacyAdapter(source);
  if(mode==='sound')source=soundAdapter(source);
  if(mode==='worksheet')source=worksheetAdapter(source);
  if(mode==='print')source=printAdapter(source);
  source=memoryPrelude+'\n'+cleanCommon(source);new vm.Script(source,{filename:name});
  const hide=`<style>.submit-bar,#btnSubmitFinal,#btnConfirmSubmit,#teacherGradingPanel,#modalTeacherAuth,#modalUnlockStudent,#teacherPanel,#loginBtn,#logoutBtn,#adminModeBtn,#submitBtn,#submitTeacherBtn,#restoreLatestBtn,#switchStudentBtn,#adminModeModal,#loginModal,#logoutModal,#pwdPanel{display:none!important}button[onclick*=Teacher],button[onclick*=Backup],button[onclick*=Preserved],button[onclick*=downloadWorksheet]{display:none!important}@media print{body{background:#fff!important;color:#000!important}}</style>`;
  html=html.replace('</body>',hide+'<script>'+source.replace(/<\/script/gi,'<\\/script')+'</script></body>');
  html=html.replaceAll('구글 시트 연동','서버 공통 제출').replaceAll('구글 시트','플랫폼 서버');
  const namespace=name.startsWith('0')?'science-platform-test:legacy:':'science-platform-test:assessment:';
  const id=uuid5(namespace+name);
  const record={id,kind,title,description:mode==='print'?'교사 전용 원자료 기반 인쇄 양식':'서버에서 관리하는 수행평가 활동 · 공통 제출·수합 사용',unit_id:unit,unit_title:unit==='unit4_eval'?'Unit 4 수행평가':'Unit 3 수행평가',lesson_id:lesson,format:'html',content:html,published:false,student_access:false};
  fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(record,null,2));
  manifest.push({id,name,kind,unit_id:unit,lesson_id:lesson,mode,bytes:Buffer.byteLength(html)});
}
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify(manifest,null,2));
