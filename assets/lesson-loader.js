/* Shared lesson renderer. Rich learning content runs only in an opaque frame;
 * trusted parent controls identity, locks, quiz records and point submission. */
(async () => {
  'use strict';
  const VERSION='20260913-preview1';
  const preview=window.ScienceLessonPreview || null;
  function safeFragment(html){
    const parsed=new DOMParser().parseFromString(String(html || ''),'text/html');
    const allowed=new Set(['P','BR','HR','DIV','SECTION','H2','H3','H4','B','STRONG','I','EM','U','S','SUB','SUP','UL','OL','LI','BLOCKQUOTE','PRE','CODE','TABLE','THEAD','TBODY','TR','TH','TD','SPAN']);
    const denied=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','TEXTAREA','SELECT','LINK','META','BASE','SVG','MATH','TEMPLATE','IMG','VIDEO','AUDIO']);
    function copy(node){
      if(node.nodeType===Node.TEXT_NODE)return document.createTextNode(node.textContent);
      if(node.nodeType!==Node.ELEMENT_NODE || denied.has(node.tagName))return document.createDocumentFragment();
      const out=allowed.has(node.tagName)?document.createElement(node.tagName.toLowerCase()):document.createDocumentFragment();
      if(out.nodeType===Node.ELEMENT_NODE){
        if(['TD','TH'].includes(node.tagName))for(const attr of ['colspan','rowspan']){const n=Number(node.getAttribute(attr));if(Number.isInteger(n)&&n>0&&n<=10)out.setAttribute(attr,String(n));}
        // Preserve authored emphasis, never positions, URLs, dimensions or host classes.
        for(const prop of ['color','font-weight','font-style','text-decoration','text-align']){const value=node.style?.getPropertyValue(prop);if(value && !/url|var\(|expression/i.test(value))out.style.setProperty(prop,value);}
      }
      for(const child of node.childNodes)out.append(copy(child));return out;
    }
    const fragment=document.createDocumentFragment();for(const child of parsed.body.childNodes)fragment.append(copy(child));return fragment;
  }
  function requiresLegacyStepLocks(item){return /^(u3_l[1235678]|u7_l[1-8])$/.test(String(item?.lesson_id || ''));}
  function tabTitle(tab){return typeof tab==='string'?tab:typeof tab?.title==='string'?tab.title:'';}
  function rich(el,html){el.replaceChildren(safeFragment(html));}
  function script(path){return new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=path+'?v='+VERSION;el.onload=()=>preview&&!preview.isActive()?reject(new Error('미리보기가 종료되었습니다. 자료 관리에서 다시 열어 주세요.')):resolve();el.onerror=()=>reject(new Error('공통 수업 기능을 불러오지 못했습니다.'));document.body.append(el);});}
  let sandbox=null,item=null,pack=null,sharedCSS='';
  if(preview)window.addEventListener('science-preview-close',()=>{if(sandbox)sandbox.destroy();sandbox=null;pack=null;item=null;});
  function quizRender(content){
    const quizArea=document.getElementById('step4');quizArea.replaceChildren();
    const heading=document.createElement('h2');heading.className='section-title';heading.textContent=tabTitle(content.display?.tabs?.[3]) || '📝 핵심 형성평가 & 결과 제출';quizArea.append(heading);
    if(content.schema!=='science-lesson/v3'&&content.steps?.[3]?.html)quizArea.append(safeFragment(content.steps[3].html));
    const guide=document.createElement('div');guide.className='quiz-guide';guide.textContent=content.schema!=='science-lesson/v3'?'이전 버전 수업입니다. 답을 고른 뒤 제출하면 서버에서 채점합니다. 제출 후에는 자유롭게 다시 골라 복습할 수 있으며, 점수와 포인트는 바뀌지 않습니다.':'각 문항은 처음 선택한 답으로 기록됩니다. 정답·오답 피드백을 확인하고, 모든 문제를 푼 뒤 제출하세요. 제출 후에는 답을 자유롭게 다시 골라 복습할 수 있으며, 기록과 포인트는 바뀌지 않습니다.';quizArea.append(guide);
    const status=document.createElement('p');status.id='quiz-status';status.className='quiz-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');quizArea.append(status);
    for(const [index,q] of (content.quiz || []).entries()){
      const richQuestion=typeof q.promptHtml==='string';
      if((!richQuestion&&typeof q.question!=='string') || !Array.isArray(q.choices) || q.choices.length<2 || q.choices.length>6)throw new Error('문항과 선택지 형식을 확인해 주세요.');
      const block=document.createElement('article');block.className='quiz-item';block.id='quiz-block-'+(index+1);
      const title=document.createElement('div');title.className='quiz-q';title.id='quiz-question-'+(index+1);const num=document.createElement('span');num.className='quiz-number';num.textContent=(index+1)+'. ';title.append(num);if(richQuestion)title.append(safeFragment(q.promptHtml));else title.append(document.createTextNode(q.question));block.append(title);
      if(q.contextHtml){const context=document.createElement('div');context.className='quiz-context';rich(context,q.contextHtml);block.append(context);}
      const choices=document.createElement('div');choices.className='quiz-choices';choices.setAttribute('role','group');choices.setAttribute('aria-labelledby',title.id);
      q.choices.forEach((choice,ci)=>{const option=document.createElement('button');option.type='button';option.className='quiz-opt';option.dataset.choice=String(ci+1);option.setAttribute('aria-pressed','false');const number=document.createElement('span');number.className='quiz-choice-number';number.textContent=String(ci+1)+'.';const text=document.createElement('span');if(typeof choice==='object')rich(text,choice.html);else text.textContent=String(choice);option.append(number,text);option.addEventListener('click',()=>window.handleQuiz(index+1,option,ci+1));choices.append(option);});block.append(choices);
      const feedback=document.createElement('div');feedback.id='fb-'+(index+1);feedback.className='quiz-feedback-box';feedback.setAttribute('aria-live','polite');const titleFeedback=document.createElement('div');titleFeedback.id='fb-title-'+(index+1);titleFeedback.className='fb-header';const body=document.createElement('div');body.id='fb-content-'+(index+1);feedback.append(titleFeedback,body);block.append(feedback);quizArea.append(block);
    }
    const identity=document.createElement('div');identity.className='student-info-box';for(const [id,label]of[['studentIdInput','학번'],['studentNameInput','이름']]){const group=document.createElement('div');group.className='student-info-group';const labelEl=document.createElement('label');labelEl.htmlFor=id;labelEl.textContent=label;const field=document.createElement('input');field.id=id;field.placeholder='로그인 후 자동 입력';field.readOnly=true;group.append(labelEl,field);identity.append(group);}
    const submit=document.createElement('button');submit.type='button';submit.id='quizSubmitBtn';submit.className='submit-btn';submit.textContent='📤 문제풀이 결과 교사에게 제출';submit.addEventListener('click',()=>window.submitQuizResults());submit.hidden=!(content.quiz || []).length;identity.append(submit);quizArea.append(identity);
    const summary=document.createElement('div');summary.id='quiz-result-summary';summary.className='quiz-result-summary';summary.hidden=true;summary.setAttribute('role','status');quizArea.append(summary);
    if(preview)preview.decorateIdentity();
    else if(typeof window.checkAndApplyStudentAuth==='function')window.checkAndApplyStudentAuth();
  }
  function renderContent(content){
    if(preview&&!preview.isActive())throw new Error('미리보기가 종료되었습니다. 자료 관리에서 다시 열어 주세요.');
    if(sandbox){sandbox.destroy();sandbox=null;}
    pack=content;const display=content.display || {},serverExperiment=['science-lesson/v2','science-lesson/v3'].includes(content.schema);
    const width=/^(?:[6-9]\d{2}|1[0-4]\d{2})(?:px)?$/.test(String(display.contentMaxWidth || ''))?parseInt(display.contentMaxWidth,10):1050;
    document.documentElement.style.setProperty('--lesson-max-width',width+'px');
    rich(document.getElementById('lesson-title'),display.titleHtml || item.title || content.title || '과학 수업');document.querySelector('.header-tag').textContent=display.headerTag || '과학 플랫폼 · 수업';rich(document.querySelector('.subtitle'),display.subtitleHtml || '탐구와 형성평가');
    const footer=document.querySelector('footer');footer.replaceChildren();if(display.footerHtml){const attribution=document.createElement('div');rich(attribution,display.footerHtml);footer.append(attribution);}const back=document.createElement('a');back.href='index.html';back.textContent='과학 플랫폼으로 돌아가기';footer.append(back);
    for(let index=0;index<3;index++){
      const step=content.steps[index],section=document.getElementById('step'+(index+1));section.replaceChildren();section.style.removeProperty('display');
      const label=tabTitle(display.tabs?.[index]) || step?.title || (index+1)+'단계';document.querySelector('#tabBtn'+(index+1)+' span').textContent=label;
      if(serverExperiment)section.style.setProperty('display','none','important');else if(step){const heading=document.createElement('h2');heading.className='section-title';heading.textContent=step.title;section.append(heading,safeFragment(step.html));}
    }
    document.querySelector('#tabBtn4 span').textContent=tabTitle(display.tabs?.[3]) || '4단계: 형성평가 & 결과 제출';
    quizRender(content);
    let host=document.getElementById('science-server-experiment');if(host)host.remove();
    if(serverExperiment){host=document.createElement('div');host.id='science-server-experiment';host.className='science-server-experiment';document.querySelector('.container').before(host);sandbox=window.ScienceLessonSandbox.mount(content,host,{sharedCSS});sandbox.setStep(typeof currentActiveStep==='number'?currentActiveStep:1);}
    window.SCIENCE_LESSON_RECORD={item,content:pack};
  }
  try{
    let id=new URLSearchParams(location.search).get('id');if(!id&&!preview)throw new Error('수업 주소에 자료 ID가 없습니다. 메인 목록에서 다시 열어 주세요.');
    const result=preview?await preview.ready:await window.ScienceContentClient.request('get_content',{id});item=result.item;pack=result.content;id=item.id || id;
    if(item?.format!=='lesson-pack' || !pack || !['science-lesson/v1','science-lesson/v2','science-lesson/v3'].includes(pack.schema))throw new Error('지원하는 수업 패키지 형식이 아닙니다.');
    if(pack.builtin_id)throw new Error('이전 파일형 수업입니다. 선생님이 자료 관리에서 서버 편집형 수업으로 이관해야 합니다.');
    if(!Array.isArray(pack.steps) || !pack.steps.length || pack.steps.length>4 || (pack.schema==='science-lesson/v3'&&pack.steps.length!==3) || !Array.isArray(pack.quiz || []) || (pack.quiz || []).length>5)throw new Error('학습 단계와 형성평가 문항 구성을 확인해 주세요.');
    const [shellResponse,themeResponse]=await Promise.all([fetch('./assets/lesson-shell.html?v='+VERSION,{cache:'no-cache'}),fetch('./assets/lesson-components.css?v='+VERSION,{cache:'no-cache'})]);if(!shellResponse.ok||!themeResponse.ok)throw new Error('공통 수업 화면을 불러오지 못했습니다.');
    sharedCSS=await themeResponse.text();const shell=await shellResponse.text();if(preview&&!preview.isActive())throw new Error('미리보기가 종료되었습니다. 자료 관리에서 다시 열어 주세요.');document.body.innerHTML=shell;
    const lessonKey=item.lesson_id || 'content_'+id.replaceAll('-','');
    window.LESSON_CONFIG=Object.freeze({lessonKey,unitKey:item.unit_id || '',lessonName:item.title || pack.title || '수업',pageTitle:item.title || pack.title || '수업',worksheetTitle:item.title || pack.title || '차시 학습지',templateMode:false,worksheetPath:'',trustedBuiltin:requiresLegacyStepLocks(item)});window.MASTER_LESSON_CONFIG=window.LESSON_CONFIG;document.title=window.LESSON_CONFIG.pageTitle;
    await script('./assets/lesson-sandbox.js');window.ScienceLessonView=Object.freeze({safeFragment,renderQuiz:quizRender,renderSnapshot:renderContent,getContent:()=>pack});renderContent(pack);
    await script('./assets/lesson-navigation.js');
    if(preview){preview.bindShell();await script('./assets/lesson-quiz.js');if(!preview.isActive())throw new Error('미리보기가 종료되었습니다. 자료 관리에서 다시 열어 주세요.');}
    else{
      await script('./assets/lesson-master.js');window.MasterLessonRuntime.bind();await script('./assets/lesson-core.js');await script('./assets/lesson-content.js');await script('./assets/lesson-quiz.js');await script('./assets/lesson-locks.js');await script('./assets/lesson-worksheet.js');await script('./admin-quick-points.js');
      window.checkAndApplyStudentAuth();window.updateStepLockUI();window.ensureCurrentSchoolYear();
    }
    if(sandbox)sandbox.setStep(typeof currentActiveStep==='number'?currentActiveStep:1);
    let owner=JSON.stringify(window.ScienceContentClient.auth());
    if(!preview)window.addEventListener('science-account-change',()=>{const next=JSON.stringify(window.ScienceContentClient.auth());if(next===owner)return;owner=next;if(sandbox)sandbox.destroy();window.ScienceQuiz?.reset();location.reload();});
    window.dispatchEvent(new Event('science-common-ready'));
  }catch(error){
    if(preview)preview.fail(error);
    const target=document.getElementById('lesson-status');if(target)target.textContent=error.message || '수업을 불러오지 못했습니다.';
    else{if(sandbox)sandbox.destroy();document.body.replaceChildren();const message=document.createElement('p');message.textContent=error.message || '수업을 불러오지 못했습니다.';const back=document.createElement('a');back.href='index.html';back.textContent='과학 플랫폼으로 돌아가기';document.body.append(message,back);}
  }
})();
