/* Editable experiments run in an opaque frame. Only the common shell owns login,
 * grade submission, storage and microphone permission. No credential bridge. */
(() => {
  'use strict';
  const CHANNEL='science-experiment/v2';
  const CSP="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  function boundedHTML(html){
    const doc=new DOMParser().parseFromString(String(html || ''),'text/html');
    doc.querySelectorAll('script,iframe,frame,object,embed,link,meta,base,form').forEach(el=>el.remove());
    doc.querySelectorAll('*').forEach(el=>{
      for(const attribute of [...el.attributes]){
        const name=attribute.name.toLowerCase();
        if(['src','href','xlink:href','action','formaction','srcdoc','poster','srcset','target','ping'].includes(name)){
          if(name==='src' && el.tagName==='IMG' && /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(attribute.value))continue;
          el.removeAttribute(attribute.name);
        }
      }
    });
    return doc.body.innerHTML;
  }
  function scriptText(source){return String(source || '').replace(/<\/script/gi,'<\\/script');}
  function styleText(source){return String(source || '').replace(/<\/style/gi,'<\\/style');}
  function documentSource(pack){
    if((pack.simulation?.dependencies || []).length)throw new Error('이 수업 런타임은 외부 실험 스크립트를 허용하지 않습니다.');
    const sections=pack.steps.slice(0,3).map((step,i)=>'<section id="step'+(i+1)+'" class="step-content">'+boundedHTML(step.html)+'</section>').join('');
    const bridge=`
var currentActiveStep=0,isAdminActive=false,stepLocks={1:false,2:false,3:false,4:false};
window.MasterLessonRuntime=Object.freeze({preview:false});
function announce(type,extra={}){parent.postMessage({channel:${JSON.stringify(CHANNEL)},type,...extra},'*');}
function resize(){const active=document.querySelector('.step-content.active');announce('height',{height:Math.max(320,Math.ceil(active?active.getBoundingClientRect().height:0)+24)});}
function applyStep(step){currentActiveStep=step;document.querySelectorAll('.step-content').forEach((el,i)=>el.classList.toggle('active',i+1===step));window.dispatchEvent(new CustomEvent('lesson-step-change',{detail:step}));requestAnimationFrame(resize);}
window.addEventListener('message',event=>{if(event.source!==parent||event.data?.channel!==${JSON.stringify(CHANNEL)})return;const data=event.data;
 if(data.type==='step'&&Number.isInteger(data.step)&&data.step>=0&&data.step<=4)applyStep(data.step);
 if(data.type==='microphone'&&currentActiveStep===3&&Array.isArray(data.samples)&&data.samples.length<=16384&&Number.isFinite(data.rate)&&data.rate>=8000&&data.rate<=192000&&data.samples.every(x=>Number.isFinite(x)&&Math.abs(x)<=1))window.dispatchEvent(new CustomEvent('science-microphone-samples',{detail:{samples:data.samples,rate:data.rate}}));
});
window.addEventListener('science-stop-microphone',()=>announce('microphone-stop'));
window.addEventListener('error',event=>announce('error',{message:String(event.message||'실험 오류').slice(0,200)}));
window.addEventListener('DOMContentLoaded',()=>{new ResizeObserver(resize).observe(document.body);announce('ready');resize();});
`;
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="'+CSP+'"><style>'+styleText(pack.simulation?.css)+'\nhtml,body{margin:0!important;padding:0!important;background:transparent!important;min-height:0!important}.step-content{display:none!important;margin:0!important}.step-content.active{display:block!important}body>.container{max-width:100%!important;padding:0!important}img,svg,canvas{max-width:100%}button,input,select{font:inherit} @media(max-width:700px){.step-content{padding:16px!important}}</style></head><body>'+boundedHTML(pack.simulation?.html)+sections+'<script>'+scriptText(bridge)+'</script><script>'+scriptText(pack.simulation?.js)+'</script></body></html>';
  }
  function mount(pack,host){
    const frame=document.createElement('iframe');frame.title='수업 내용과 실험';frame.className='science-experiment-frame';
    frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('allow',"microphone 'none'; camera 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");frame.referrerPolicy='no-referrer';
    frame.style.cssText='display:block;width:100%;height:600px;border:0;background:transparent;';
    const error=document.createElement('p');error.setAttribute('role','status');error.hidden=true;error.style.cssText='padding:12px;color:#fbbf24;';
    const mic=document.createElement('div');mic.className='science-common-microphone';mic.hidden=true;mic.style.cssText='margin-bottom:14px;padding:14px;border:1px solid #475569;border-radius:12px;background:#172033;';
    const start=document.createElement('button');start.type='button';start.className='sim-btn';start.textContent='🎤 마이크 켜기';
    const stop=document.createElement('button');stop.type='button';stop.className='sim-btn secondary';stop.textContent='마이크 끄기';stop.disabled=true;
    const micStatus=document.createElement('p');micStatus.textContent='이 기기에서 파형만 표시합니다. 녹음하거나 서버에 저장하지 않습니다.';
    mic.append(start,document.createTextNode(' '),stop,micStatus);host.append(mic,error,frame);
    let activeStep=1,ready=false,destroyed=false,stream=null,audio=null,analyser=null,timer=0,epoch=0;
    function post(data){if(!destroyed && frame.contentWindow)frame.contentWindow.postMessage({channel:CHANNEL,...data},'*');}
    function stopMic(message='마이크를 껐습니다.'){
      epoch++;if(timer)clearInterval(timer);timer=0;if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;
      if(audio)audio.close().catch(()=>{});audio=null;analyser=null;start.disabled=false;stop.disabled=true;micStatus.textContent=message;
    }
    function stepAllowed(){return activeStep===3&&!document.hidden&&host.isConnected&&!host.hidden&&pack.simulation?.microphone===true;}
    async function startMic(){
      if(!stepAllowed()||stream)return;
      const AudioContext=window.AudioContext||window.webkitAudioContext;
      if(!isSecureContext||!navigator.mediaDevices?.getUserMedia||!AudioContext){micStatus.textContent='HTTPS와 마이크를 지원하는 브라우저가 필요합니다. 실험의 예시 파형을 이용할 수 있습니다.';return;}
      const requestEpoch=++epoch;start.disabled=true;stop.disabled=false;micStatus.textContent='마이크 사용 허용을 기다리고 있습니다.';
      let requestedStream=null,context=null;
      try{
        context=new AudioContext();audio=context;await context.resume();
        requestedStream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,autoGainControl:false,echoCancellation:false,noiseSuppression:false},video:false});
        if(requestEpoch!==epoch||!stepAllowed()){requestedStream.getTracks().forEach(t=>t.stop());await context.close().catch(()=>{});return;}
        stream=requestedStream;analyser=context.createAnalyser();analyser.fftSize=8192;
        context.createMediaStreamSource(stream).connect(analyser); // No speaker output, no recording.
        const samples=new Float32Array(analyser.fftSize);
        timer=setInterval(()=>{if(!stepAllowed()){stopMic('단계를 벗어나 마이크를 껐습니다.');return;}analyser.getFloatTimeDomainData(samples);post({type:'microphone',rate:context.sampleRate,samples:Array.from(samples,x=>Math.max(-1,Math.min(1,x)))});},80);
        stream.getAudioTracks().forEach(track=>track.addEventListener('ended',()=>{if(stream===requestedStream)stopMic('마이크 연결이 끝났습니다.');},{once:true}));
        micStatus.textContent='마이크가 켜졌습니다. 입력은 아래 실험에 파형으로만 전달됩니다.';
      }catch(cause){if(requestedStream)requestedStream.getTracks().forEach(t=>t.stop());if(context&&context.state!=='closed')context.close().catch(()=>{});if(requestEpoch===epoch)stopMic(cause.name==='NotAllowedError'?'마이크 사용이 허용되지 않았습니다. 브라우저 권한을 확인하거나 예시 파형을 이용하세요.':'마이크를 켜지 못했습니다. 기기 연결을 확인해 주세요.');}
    }
    function setStep(number){
      activeStep=Number.isInteger(number)&&number>=1&&number<=4?number:0;
      host.hidden=activeStep===0||activeStep===4;mic.hidden=!(pack.simulation?.microphone===true&&activeStep===3);
      if(!stepAllowed())stopMic('다른 단계로 이동하여 마이크를 껐습니다.');
      if(ready)post({type:'step',step:document.hidden?0:activeStep});
    }
    function receive(event){
      if(event.source!==frame.contentWindow||event.origin!=='null'||event.data?.channel!==CHANNEL)return;
      const data=event.data;
      if(data.type==='ready'){ready=true;post({type:'step',step:document.hidden?0:activeStep});}
      else if(data.type==='height'&&Number.isFinite(data.height))frame.style.height=Math.max(320,Math.min(24000,Math.ceil(data.height)))+'px';
      else if(data.type==='error'){error.hidden=false;error.textContent='실험을 표시하는 중 오류가 발생했습니다. 새로고침 후에도 계속되면 선생님께 알려 주세요.';console.warn('Isolated experiment error:',String(data.message || '').slice(0,200));}
      else if(data.type==='microphone-stop'&&pack.simulation?.microphone===true)stopMic();
    }
    function onStep(event){setStep(event.detail);}
    function visibility(){if(document.hidden)stopMic('화면을 벗어나 마이크를 껐습니다.');post({type:'step',step:document.hidden?0:activeStep});}
    function destroy(){stopMic();destroyed=true;window.removeEventListener('message',receive);window.removeEventListener('lesson-step-change',onStep);document.removeEventListener('visibilitychange',visibility);frame.remove();}
    start.addEventListener('click',startMic);stop.addEventListener('click',()=>stopMic());window.addEventListener('message',receive);window.addEventListener('lesson-step-change',onStep);document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',destroy,{once:true});
    frame.srcdoc=documentSource(pack);setStep(1);return Object.freeze({setStep,destroy});
  }
  window.ScienceLessonSandbox=Object.freeze({mount,documentSource});
})();
