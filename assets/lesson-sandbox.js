/* Opaque lesson document: no credentials, network, storage or grading bridge.
 * Media requests are bounded and require a separate trusted host button. */
(() => {
  'use strict';
  const CHANNEL='science-experiment/v3';
  const CSP="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  function boundedHTML(html){
    const doc=new DOMParser().parseFromString(String(html || ''),'text/html');doc.querySelectorAll('script,iframe,frame,object,embed,link,meta,base,form').forEach(el=>el.remove());
    doc.querySelectorAll('*').forEach(el=>{for(const attribute of [...el.attributes]){const name=attribute.name.toLowerCase();if(['src','href','xlink:href','action','formaction','srcdoc','poster','srcset','target','ping'].includes(name)){if(name==='src'&&el.tagName==='IMG'&&/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(attribute.value))continue;el.removeAttribute(attribute.name);}}});return doc.body.innerHTML;
  }
  const scriptText=source=>String(source||'').replace(/<\/script/gi,'<\\/script');
  const styleText=source=>String(source||'').replace(/<\/style/gi,'<\\/style');
  function documentSource(pack,sharedCSS=''){
    if((pack.simulation?.dependencies||[]).length)throw new Error('이 수업 런타임은 외부 실험 스크립트를 허용하지 않습니다.');
    const sections=pack.steps.slice(0,3).map((step,i)=>'<section id="step'+(i+1)+'" class="step-content">'+boundedHTML(step.html)+'</section>').join('');
    const bridge=`
var currentActiveStep=0,isAdminActive=false,stepLocks={1:false,2:false,3:false,4:false};
window.MasterLessonRuntime=Object.freeze({preview:false});
(()=>{let activeStep=0;
const announce=(type,extra={})=>parent.postMessage({channel:${JSON.stringify(CHANNEL)},type,...extra},'*');
const resize=()=>{const el=document.querySelector('.step-content.active');announce('height',{height:Math.max(320,Math.ceil(el?el.getBoundingClientRect().height:0)+24)});};
Object.defineProperty(window,'ScienceLessonBridge',{value:Object.freeze({getActiveStep:()=>activeStep,isStepActive:step=>activeStep===step}),writable:false,configurable:false});
function applyStep(step){activeStep=step;currentActiveStep=step;document.querySelectorAll('.step-content').forEach((el,i)=>el.classList.toggle('active',i+1===step));window.dispatchEvent(new CustomEvent('science-step-change',{detail:{step}}));window.dispatchEvent(new CustomEvent('lesson-step-change',{detail:step}));requestAnimationFrame(resize);}
window.addEventListener('message',event=>{if(event.source!==parent||event.data?.channel!==${JSON.stringify(CHANNEL)})return;const data=event.data;
 if(data.type==='step'&&Number.isInteger(data.step)&&data.step>=0&&data.step<=4)applyStep(data.step);
 if(data.type==='microphone'&&activeStep===3&&Array.isArray(data.samples)&&data.samples.length<=32768&&Number.isFinite(data.rate)&&data.rate>=8000&&data.rate<=192000&&data.samples.every(x=>Number.isFinite(x)&&Math.abs(x)<=1))window.dispatchEvent(new CustomEvent('science-microphone-samples',{detail:{requestId:data.requestId,samples:data.samples,rate:data.rate}}));
 if(data.type==='media-state'&&['science-tone-state','science-microphone-state'].includes(data.event))window.dispatchEvent(new CustomEvent(data.event,{detail:data.detail}));
});
for(const eventName of ['science-tone-request','science-microphone-request'])window.addEventListener(eventName,event=>{const d=event.detail||{};announce('media-request',{event:eventName,detail:{action:d.action,requestId:d.requestId,frequency:d.frequency,gain:d.gain,wave:d.wave,durationMs:d.durationMs}});});
window.addEventListener('science-stop-microphone',()=>announce('microphone-stop'));
window.addEventListener('error',event=>announce('error',{message:String(event.message||'실험 오류').slice(0,200)}));
window.addEventListener('DOMContentLoaded',()=>{if(window.ResizeObserver)new ResizeObserver(resize).observe(document.body);window.dispatchEvent(new Event('science-lesson-ready'));announce('ready');resize();},{once:true});
})();`;
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="'+CSP+'"><style>'+styleText(sharedCSS)+'\n'+styleText(pack.simulation?.css)+'\nhtml,body{margin:0!important;padding:0!important;background:transparent!important;min-height:0!important}.step-content{display:none!important;margin:0!important}.step-content.active{display:block!important}body>.container{max-width:100%!important;padding:0!important}img,svg,canvas{max-width:100%}button,input,select{font:inherit}@media(max-width:700px){.step-content{padding:16px!important}}</style></head><body>'+boundedHTML(pack.simulation?.html)+sections+'<script>'+scriptText(bridge)+'</script><script>'+scriptText(pack.simulation?.js)+'</script></body></html>';
  }
  function mount(pack,host,{sharedCSS=''}={}){
    const frame=document.createElement('iframe');frame.title='수업 내용과 실험';frame.className='science-experiment-frame';frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('allow',"microphone 'none'; camera 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");frame.referrerPolicy='no-referrer';frame.style.cssText='display:block;width:100%;height:600px;border:0;background:transparent;';
    const error=document.createElement('p');error.setAttribute('role','status');error.hidden=true;error.style.cssText='padding:12px;color:#fbbf24;';
    function controls(startText,stopText){const box=document.createElement('div');box.className='science-common-media';box.hidden=true;const start=document.createElement('button');start.type='button';start.className='sim-btn';start.textContent=startText;const stop=document.createElement('button');stop.type='button';stop.className='sim-btn secondary';stop.textContent=stopText;stop.disabled=true;const status=document.createElement('p');status.setAttribute('role','status');box.append(start,stop,status);host.append(box);return{box,start,stop,status};}
    const toneUI=controls('▶ 요청한 소리 재생','소리 끄기'),micUI=controls('🎤 마이크 사용 허용','마이크 끄기');micUI.status.textContent='실험의 마이크 켜기를 누른 뒤 이 버튼으로 허용하세요. 파형만 표시하며 녹음하거나 서버에 저장하지 않습니다.';host.append(error,frame);
    let activeStep=1,ready=false,destroyed=false,stream=null,micAudio=null,analyser=null,micTimer=0,micEpoch=0,micRequest=null;
    let toneAudio=null,oscillator=null,gainNode=null,toneTimer=0,toneRequest=null,toneEpoch=0,toneStep=0;
    const post=data=>{if(!destroyed&&frame.contentWindow)frame.contentWindow.postMessage({channel:CHANNEL,...data},'*');};
    const mediaState=(event,requestId,state,message)=>{if(requestId!==null&&requestId!==undefined)post({type:'media-state',event,detail:{requestId,state,message}});};
    const visible=()=>!destroyed&&!document.hidden&&host.isConnected&&!host.hidden;
    const micAllowed=()=>visible()&&activeStep===3&&pack.simulation?.microphone===true;
    const toneAllowed=()=>visible()&&activeStep>=1&&activeStep<=3;
    function stopMic(message='마이크를 껐습니다.',requestId=micRequest){
      micEpoch++;if(micTimer)clearInterval(micTimer);micTimer=0;if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;if(micAudio)micAudio.close().catch(()=>{});micAudio=null;analyser=null;micUI.start.disabled=false;micUI.stop.disabled=true;micUI.status.textContent=message;mediaState('science-microphone-state',requestId,'stopped',message);
    }
    async function startMic(event){
      if(!event?.isTrusted||!micAllowed()||stream)return;
      const AudioContext=window.AudioContext||window.webkitAudioContext;if(!isSecureContext||!navigator.mediaDevices?.getUserMedia||!AudioContext){micUI.status.textContent='HTTPS와 마이크를 지원하는 브라우저가 필요합니다. 예시 파형을 이용할 수 있습니다.';mediaState('science-microphone-state',micRequest,'error',micUI.status.textContent);return;}
      // v3 requests carry the current experiment epoch. v2 uses this host control directly.
      if(pack.schema==='science-lesson/v3'&&micRequest===null){micUI.status.textContent='먼저 아래 실험의 마이크 켜기를 눌러 주세요.';return;}
      const generation=++micEpoch,requestId=micRequest;micUI.start.disabled=true;micUI.stop.disabled=false;micUI.status.textContent='브라우저의 마이크 사용 허용을 기다리고 있습니다.';mediaState('science-microphone-state',requestId,'pending',micUI.status.textContent);let requestedStream=null,context=null;
      try{
        context=new AudioContext();micAudio=context;await context.resume();requestedStream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,autoGainControl:false,echoCancellation:false,noiseSuppression:false},video:false});
        if(generation!==micEpoch||!micAllowed()){requestedStream.getTracks().forEach(track=>track.stop());await context.close().catch(()=>{});return;}
        stream=requestedStream;analyser=context.createAnalyser();analyser.fftSize=16384;context.createMediaStreamSource(stream).connect(analyser);const samples=new Float32Array(analyser.fftSize);
        micTimer=setInterval(()=>{if(!micAllowed()){stopMic('단계를 벗어나 마이크를 껐습니다.');return;}analyser.getFloatTimeDomainData(samples);post({type:'microphone',requestId,rate:context.sampleRate,samples:Array.from(samples,x=>Math.max(-1,Math.min(1,x)))});},80);
        stream.getAudioTracks().forEach(track=>track.addEventListener('ended',()=>{if(stream===requestedStream)stopMic('마이크 연결이 끝났습니다.');},{once:true}));micUI.status.textContent='마이크 입력을 실험에 파형으로만 전달하고 있습니다.';mediaState('science-microphone-state',requestId,'active',micUI.status.textContent);
      }catch(cause){if(requestedStream)requestedStream.getTracks().forEach(track=>track.stop());if(context&&context.state!=='closed')context.close().catch(()=>{});if(generation===micEpoch){stopMic(cause.name==='NotAllowedError'?'마이크 사용이 허용되지 않았습니다. 브라우저 권한을 확인하거나 예시 파형을 이용하세요.':'마이크를 켜지 못했습니다. 기기 연결을 확인해 주세요.',requestId);mediaState('science-microphone-state',requestId,'error',micUI.status.textContent);}}
    }
    function stopTone(message='소리를 멈췄습니다.',requestId=toneRequest?.requestId){
      toneEpoch++;if(toneTimer)clearTimeout(toneTimer);toneTimer=0;if(oscillator){try{oscillator.stop();oscillator.disconnect();}catch{}}oscillator=null;gainNode=null;if(toneAudio)toneAudio.close().catch(()=>{});toneAudio=null;toneUI.start.disabled=false;toneUI.stop.disabled=true;toneUI.status.textContent=message;mediaState('science-tone-state',requestId,'stopped',message);
    }
    function toneParameters(data){
      if(!Number.isFinite(data.frequency)||!Number.isFinite(data.gain))return null;
      let wave={type:'sine'};const source=data.wave;
      if(source&&['sine','square','sawtooth','triangle'].includes(source.type))wave={type:source.type};
      else if(source&&Array.isArray(source.real)&&Array.isArray(source.imag)&&source.real.length===source.imag.length&&source.real.length>=2&&source.real.length<=32&&[...source.real,...source.imag].every(x=>Number.isFinite(x)&&Math.abs(x)<=1))wave={real:source.real,imag:source.imag,disableNormalization:false};
      return{requestId:data.requestId,frequency:Math.max(80,Math.min(2000,data.frequency)),gain:Math.max(0,Math.min(.084,data.gain)),wave,durationMs:Math.max(250,Math.min(12000,Number(data.durationMs)||12000))};
    }
    function updateTone(params){if(!toneAudio||!oscillator||!gainNode)return;oscillator.frequency.setTargetAtTime(params.frequency,toneAudio.currentTime,.015);gainNode.gain.setTargetAtTime(params.gain,toneAudio.currentTime,.015);if(params.wave.type)oscillator.type=params.wave.type;else oscillator.setPeriodicWave(toneAudio.createPeriodicWave(new Float32Array(params.wave.real),new Float32Array(params.wave.imag),{disableNormalization:false}));}
    async function startTone(event){
      if(!event?.isTrusted||!toneAllowed()||!toneRequest||oscillator)return;const AudioContext=window.AudioContext||window.webkitAudioContext;if(!AudioContext){toneUI.status.textContent='이 브라우저는 소리 재생을 지원하지 않습니다.';return;}
      const generation=++toneEpoch,params=toneRequest;let context=null;
      try{context=new AudioContext();toneAudio=context;await context.resume();if(generation!==toneEpoch||!toneAllowed()){context.close().catch(()=>{});return;}toneStep=activeStep;oscillator=context.createOscillator();gainNode=context.createGain();oscillator.connect(gainNode);gainNode.connect(context.destination);gainNode.gain.value=0;updateTone(params);oscillator.start();toneUI.start.disabled=true;toneUI.stop.disabled=false;toneUI.status.textContent='소리를 재생합니다. 최대 12초 뒤 자동으로 멈춥니다.';mediaState('science-tone-state',params.requestId,'playing',toneUI.status.textContent);toneTimer=setTimeout(()=>stopTone('12초 제한으로 소리를 멈췄습니다.',params.requestId),params.durationMs);}
      catch{if(context)context.close().catch(()=>{});if(generation===toneEpoch){stopTone('소리를 재생하지 못했습니다.',params.requestId);mediaState('science-tone-state',params.requestId,'error',toneUI.status.textContent);}}
    }
    function setStep(number){activeStep=Number.isInteger(number)&&number>=1&&number<=4?number:0;host.hidden=activeStep===0||activeStep===4;micUI.box.hidden=!(pack.simulation?.microphone===true&&activeStep===3);if(!micAllowed())stopMic('다른 단계로 이동하여 마이크를 껐습니다.');if(!toneAllowed()||toneStep&&toneStep!==activeStep){stopTone('다른 단계로 이동하여 소리를 멈췄습니다.');toneUI.box.hidden=true;toneRequest=null;}if(ready)post({type:'step',step:document.hidden?0:activeStep});}
    function receive(event){
      if(event.source!==frame.contentWindow||event.origin!=='null'||event.data?.channel!==CHANNEL)return;const data=event.data;
      if(data.type==='ready'){ready=true;post({type:'step',step:document.hidden?0:activeStep});}
      else if(data.type==='height'&&Number.isFinite(data.height))frame.style.height=Math.max(320,Math.min(24000,Math.ceil(data.height)))+'px';
      else if(data.type==='error'){error.hidden=false;error.textContent='실험을 표시하는 중 오류가 발생했습니다. 새로고침 후에도 계속되면 선생님께 알려 주세요.';console.warn('Isolated experiment error:',String(data.message||'').slice(0,200));}
      else if(data.type==='microphone-stop'&&pack.simulation?.microphone===true)stopMic();
      else if(data.type==='media-request'){
        const d=data.detail||{};if(!(Number.isSafeInteger(d.requestId)||typeof d.requestId==='string'&&d.requestId.length<=80))return;
        if(data.event==='science-microphone-request'&&pack.simulation?.microphone===true){
          if(d.action==='stop'){micRequest=d.requestId;stopMic(undefined,d.requestId);}
          else if(d.action==='start'&&micAllowed()){stopMic('위의 마이크 사용 허용 버튼을 눌러 주세요.',d.requestId);micRequest=d.requestId;micUI.box.hidden=false;mediaState('science-microphone-state',micRequest,'pending',micUI.status.textContent);}
        }else if(data.event==='science-tone-request'){
          if(d.action==='stop'){stopTone(undefined,d.requestId);toneRequest=null;}
          else if((d.action==='start'||d.action==='update')&&toneAllowed()){
            const params=toneParameters(d);if(!params)return;
            if(d.action==='update'){if(toneRequest?.requestId===params.requestId&&oscillator){toneRequest=params;updateTone(params);}return;}
            stopTone('위의 요청한 소리 재생 버튼을 눌러 주세요.',params.requestId);toneRequest=params;toneStep=activeStep;toneUI.box.hidden=false;mediaState('science-tone-state',params.requestId,'stopped',toneUI.status.textContent);
          }
        }
      }
    }
    const onStep=event=>setStep(event.detail);
    function visibility(){if(document.hidden){stopMic('화면을 벗어나 마이크를 껐습니다.');stopTone('화면을 벗어나 소리를 멈췄습니다.');}post({type:'step',step:document.hidden?0:activeStep});}
    function destroy(){if(destroyed)return;stopMic();stopTone();destroyed=true;window.removeEventListener('message',receive);window.removeEventListener('lesson-step-change',onStep);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',destroy);frame.remove();}
    micUI.start.addEventListener('click',startMic);micUI.stop.addEventListener('click',()=>stopMic());toneUI.start.addEventListener('click',startTone);toneUI.stop.addEventListener('click',()=>stopTone());window.addEventListener('message',receive);window.addEventListener('lesson-step-change',onStep);document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',destroy,{once:true});frame.srcdoc=documentSource(pack,sharedCSS);setStep(1);return Object.freeze({setStep,destroy});
  }
  window.ScienceLessonSandbox=Object.freeze({mount,documentSource});
})();
