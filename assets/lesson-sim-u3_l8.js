window.addEventListener('lesson-step-change', event => { const stepNum = event.detail;

            if (stepNum === 2) updateStep2Sim();
            if (stepNum === 3) updateStep3Data();
            
});
        
        
        
        

        
/* ML:EDIT:QUIZ_DATA:END */;

        

        

/* ML:EDIT:SIMULATION_JS:START */
// Lesson-local controls. No activity records, uploads, or additional point rules.
const sndTone={ready:false,amplitude:.3,frequency:200,shape:'pure',context:null,source:null,gain:null,epoch:0,timer:0};
const sndMic={ready:false,pending:false,epoch:0,context:null,stream:null,source:null,analyser:null,data:null,frame:0,lastFrame:0,lastMetric:-Infinity,zoom:5,demo:null};
const sndComplexPeak=(()=>{let peak=0;for(let i=0;i<16384;i++){const p=2*Math.PI*i/16384;peak=Math.max(peak,Math.abs(Math.sin(p)+.35*Math.sin(2*p)+.2*Math.sin(3*p)));}return peak;})();
function sndEl(id){return document.getElementById(id);}
function sndActive(step){return currentActiveStep===step&&!document.hidden&&!!sndEl(step===2?'snd-tone-svg':'snd-mic-svg')&&(isAdminActive||!stepLocks[step]);}
function sndClose(ctx){if(ctx&&ctx.state!=='closed')try{const p=ctx.close();if(p&&p.catch)p.catch(()=>{});}catch(_){}}
function sndSample(t,signal){const p=Math.PI*2*signal.frequency*t;return signal.amplitude*(signal.shape==='complex'?(Math.sin(p)+.35*Math.sin(2*p)+.2*Math.sin(3*p))/sndComplexPeak:Math.sin(p));}
function sndNode(tag,attrs,root,text){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;root.appendChild(n);return n;}
function sndAxes(id,title,limit=1){
 const svg=sndEl(id);if(!svg)return;svg.replaceChildren();svg.dataset.yMax=String(limit);svg.dataset.yMin=String(-limit);svg.dataset.windowMs='20';
 sndNode('title',{},svg,title);sndNode('text',{x:65,y:29,fill:'#e2e8f0','font-size':17},svg,title);
 for(const v of [-1,-.5,0,.5,1]){const y=135-v*72;sndNode('line',{x1:65,x2:710,y1:y,y2:y,stroke:v===0?'#64748b':'#334155','stroke-dasharray':v===0?'0':'3 5'},svg);sndNode('text',{x:52,y:y+5,'text-anchor':'end',fill:'#a8b8cc','font-size':14},svg,Number((v*limit).toFixed(2)));}
 for(let i=0;i<=4;i++){const x=65+i*645/4;sndNode('line',{x1:x,x2:x,y1:63,y2:207,stroke:'#334155'},svg);sndNode('text',{x,y:231,'text-anchor':'middle',fill:'#cbd5e1','font-size':14},svg,i*5);}
 sndNode('text',{x:710,y:259,'text-anchor':'end',fill:'#cbd5e1','font-size':15},svg,'시간 (ms)');sndNode('text',{x:65,y:50,fill:'#a8b8cc','font-size':14},svg,'상대 신호');
 sndNode('path',{d:'M65 135 L710 135',fill:'none',stroke:'#38bdf8','stroke-width':2.5,'stroke-linejoin':'round','data-snd-path':'true'},svg);
}
function sndPlot(id,read,limit=1,color='#38bdf8'){
 const path=sndEl(id)?.querySelector('[data-snd-path]');if(!path)return;let d='';for(let i=0;i<=1200;i++){const raw=read(i/1200);const v=Number.isFinite(raw)?Math.max(-1,Math.min(1,raw/limit)):0;d+=(i?' L':'M')+(65+i*645/1200).toFixed(2)+' '+(135-v*72).toFixed(2);}path.setAttribute('d',d);path.setAttribute('stroke',color);
}
function sndToneDraw(){sndAxes('snd-tone-svg','내가 만든 소리');sndPlot('snd-tone-svg',x=>sndSample(x*.02,sndTone));}
function sndSetWave(oscillator,context){
 if(sndTone.shape==='pure'){oscillator.type='sine';return;}
 const real=new Float32Array(4),imag=new Float32Array([0,1/sndComplexPeak,.35/sndComplexPeak,.2/sndComplexPeak]);oscillator.setPeriodicWave(context.createPeriodicWave(real,imag,{disableNormalization:true}));
}
function updateStep2Sim(){
 if(!sndEl('snd-amplitude'))return;
 sndTone.amplitude=Math.min(.7,Math.max(.1,Number(sndEl('snd-amplitude').value)||.3));sndTone.frequency=Math.min(800,Math.max(100,Number(sndEl('snd-frequency').value)||200));sndTone.shape=sndEl('snd-shape').value==='complex'?'complex':'pure';
 sndEl('snd-amplitude-value').textContent=sndTone.amplitude.toFixed(2);sndEl('snd-frequency-value').textContent=sndTone.frequency+' Hz';sndToneDraw();
 sndEl('snd-tone-note').textContent='진폭은 기준선에서 최대로 벗어나는 크기입니다. 진동수는 같은 시간의 반복 횟수와 연결됩니다.'+(sndTone.shape==='complex'?' 작은 굴곡을 모두 세지 말고 전체 무늬가 반복되는 간격을 보세요.':'');
 if(sndTone.source&&sndTone.context){const ctx=sndTone.context;sndTone.source.frequency.setTargetAtTime(sndTone.frequency,ctx.currentTime,.02);sndTone.gain.gain.setTargetAtTime(sndTone.amplitude*.12,ctx.currentTime,.02);sndSetWave(sndTone.source,ctx);}
}
function sndStopTone(message='소리를 멈췄습니다.'){
 sndTone.epoch++;if(sndTone.timer)clearTimeout(sndTone.timer);sndTone.timer=0;
 const source=sndTone.source;sndTone.source=null;if(source){try{source.stop();}catch(_){}try{source.disconnect();}catch(_){}}
 if(sndTone.gain)try{sndTone.gain.disconnect();}catch(_){}sndTone.gain=null;const ctx=sndTone.context;sndTone.context=null;sndClose(ctx);
 if(sndEl('snd-listen')){sndEl('snd-listen').textContent='▶ 소리 켜기';sndEl('snd-listen').setAttribute('aria-pressed','false');sndEl('snd-tone-status').textContent=message;}
}
async function sndToggleTone(){
 if(sndTone.context){sndStopTone();return;}if(!sndActive(2))return;
 const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx){sndEl('snd-tone-status').textContent='소리 재생을 지원하지 않는 환경입니다. 슬라이더로 파형을 바꿔 보세요.';return;}
 const epoch=++sndTone.epoch;let ctx=null;
 try{ctx=new AudioCtx();sndTone.context=ctx;sndEl('snd-listen').textContent='■ 소리 끄기';sndEl('snd-listen').setAttribute('aria-pressed','true');await ctx.resume();if(epoch!==sndTone.epoch||!sndActive(2)){sndClose(ctx);return;}
  const osc=ctx.createOscillator(),gain=ctx.createGain();sndSetWave(osc,ctx);osc.frequency.value=sndTone.frequency;gain.gain.value=0;gain.gain.setTargetAtTime(sndTone.amplitude*.12,ctx.currentTime,.02);osc.connect(gain);gain.connect(ctx.destination);sndTone.source=osc;sndTone.gain=gain;osc.start();
  sndTone.timer=setTimeout(()=>sndStopTone('12초 재생을 마쳤습니다. 다시 켜서 이어서 바꿔 볼 수 있습니다.'),12000);sndEl('snd-tone-status').textContent='조절하면 소리가 바로 달라집니다. 12초 후 자동으로 멈춥니다.';
 }catch(_){sndClose(ctx);if(epoch===sndTone.epoch)sndStopTone('소리를 켜지 못했습니다. 버튼을 다시 누르거나 파형으로 살펴보세요.');}
}
function sndMicStatus(text){if(sndEl('snd-mic-status'))sndEl('snd-mic-status').textContent=text;}
function sndMicButtons(){if(sndEl('snd-mic-start')){sndEl('snd-mic-start').disabled=sndMic.pending||!!sndMic.stream;sndEl('snd-mic-stop').disabled=!sndMic.pending&&!sndMic.stream;}}
function sndStopMic(message='마이크를 껐습니다.'){
 ++sndMic.epoch;sndMic.pending=false;if(sndMic.frame)cancelAnimationFrame(sndMic.frame);sndMic.frame=0;
 const stream=sndMic.stream,ctx=sndMic.context;sndMic.stream=null;sndMic.context=null;
 for(const node of [sndMic.source,sndMic.analyser])if(node)try{node.disconnect();}catch(_){}sndMic.source=sndMic.analyser=null;
 if(stream)stream.getTracks().forEach(t=>t.stop());sndClose(ctx);if(sndMic.data)sndMic.data.fill(0);sndMic.data=null;sndMic.demo=null;
 sndAxes('snd-mic-svg','마이크 꺼짐',1/sndMic.zoom);if(sndEl('snd-mic-metrics'))sndEl('snd-mic-metrics').textContent='소리를 내면 진폭과 진동수의 변화가 이곳에 나타납니다.';sndMicStatus(message);sndMicButtons();
}
async function sndStartMic(){
 if(sndMic.pending||sndMic.stream||!sndActive(3))return;
 const AudioCtx=window.AudioContext||window.webkitAudioContext;
 if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||!AudioCtx){sndMicStatus('마이크는 HTTPS 수업 페이지와 사용 권한이 필요합니다. 아래 ‘마이크 없이 파형 보기’도 이용할 수 있습니다.');return;}
 sndStopMic('마이크 사용 허용을 기다리는 중입니다. 마이크 끄기로 취소할 수 있습니다.');const epoch=sndMic.epoch;sndMic.pending=true;sndMicButtons();let ctx=null,stream=null;
 try{
  ctx=new AudioCtx();sndMic.context=ctx;const resume=ctx.resume();if(resume?.catch)resume.catch(()=>{});
  stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,autoGainControl:false,echoCancellation:false,noiseSuppression:false},video:false});
  if(epoch!==sndMic.epoch||!sndActive(3)){stream.getTracks().forEach(t=>t.stop());sndClose(ctx);return;}
  sndMic.stream=stream;const analyser=ctx.createAnalyser();analyser.fftSize=Math.min(32768,Math.max(8192,2**Math.ceil(Math.log2(ctx.sampleRate*.1))));
  const source=ctx.createMediaStreamSource(stream);source.connect(analyser); // No output connection: the mic is never played through speakers.
  sndMic.source=source;sndMic.analyser=analyser;sndMic.data=new Float32Array(analyser.fftSize);await ctx.resume();
  if(epoch!==sndMic.epoch||!sndActive(3)){stream.getTracks().forEach(t=>t.stop());sndClose(ctx);return;}
  sndMic.pending=false;sndMic.lastFrame=0;sndMic.lastMetric=-Infinity;sndMicButtons();sndAxes('snd-mic-svg','지금 내 목소리',1/sndMic.zoom);
  stream.getAudioTracks().forEach(t=>t.addEventListener('ended',()=>{if(sndMic.stream===stream)sndStopMic('마이크 연결이 끝났습니다.');},{once:true}));
  ctx.onstatechange=()=>{if(sndMic.context===ctx&&ctx.state==='suspended'&&!sndMic.pending)sndStopMic('마이크가 일시 중단되었습니다. 다시 켜서 이어갈 수 있습니다.');};
  const settings=stream.getAudioTracks()[0]?.getSettings?.()||{};sndMicStatus('마이크가 켜졌습니다. 같은 거리에서 편안하게 목소리를 바꿔 보세요.'+(settings.autoGainControl===false?'':' 기기의 자동 입력 보정이 적용될 수 있습니다.'));animStep3();
 }catch(e){if(stream)stream.getTracks().forEach(t=>t.stop());sndClose(ctx);if(epoch!==sndMic.epoch)return;sndStopMic(e.name==='NotAllowedError'?'마이크 사용이 허용되지 않았습니다. 사이트 권한을 확인하거나 예시 파형을 이용하세요.':'마이크를 켜지 못했습니다. 연결을 확인하거나 예시 파형을 이용하세요.');}
}
function sndMicMetrics(data,rate){
 let peak=0;const n=Math.round(rate*.02),start=Math.max(0,data.length-n);for(let i=start;i<data.length;i++)peak=Math.max(peak,Math.abs(data[i]));
 const pitch=sndPitch(data.subarray(Math.max(0,data.length-Math.round(rate*.08))),rate);
 return {peak,pitch};
}
function sndShowMetrics(m){if(sndEl('snd-mic-metrics'))sndEl('snd-mic-metrics').textContent='상대 진폭 '+m.peak.toFixed(3)+' · '+(m.pitch?'추정 기본진동수 약 '+Math.round(m.pitch.frequency)+' Hz':'진동수: 뚜렷한 반복을 찾는 중')+(m.peak>=.98?' · 입력이 일부 잘립니다.':m.peak>1/sndMic.zoom?' · 그림 범위를 넘었습니다. 세로 확대를 줄여 보세요.':'');}
function sndFrame(time){
 sndMic.frame=0;if(!sndMic.stream)return;if(!sndActive(3)){sndStopMic();return;}
 if(time-sndMic.lastFrame>=33){sndMic.lastFrame=time;const data=sndMic.data,rate=sndMic.context.sampleRate;sndMic.analyser.getFloatTimeDomainData(data);const count=Math.round(rate*.02),start=Math.max(0,data.length-count);sndPlot('snd-mic-svg',x=>data[Math.min(data.length-1,start+Math.round(x*(count-1)))],1/sndMic.zoom);
  if(time-sndMic.lastMetric>=250){sndMic.lastMetric=time;sndShowMetrics(sndMicMetrics(data,rate));}}
 sndMic.frame=requestAnimationFrame(sndFrame);
}
function sndChangeMicScale(){sndMic.zoom=[1,5,10].includes(Number(sndEl('snd-mic-scale').value))?Number(sndEl('snd-mic-scale').value):5;sndAxes('snd-mic-svg',sndMic.demo?'예시 파형 · 마이크 입력 아님':sndMic.stream?'지금 내 목소리':'마이크 꺼짐',1/sndMic.zoom);if(sndMic.demo)sndDrawDemo();}
function sndDrawDemo(){const signal=sndMic.demo;if(!signal)return;sndPlot('snd-mic-svg',x=>sndSample(x*.02,signal),1/sndMic.zoom,'#fbbf24');sndShowMetrics({peak:signal.amplitude,pitch:{frequency:signal.frequency}});}
function sndDemo(kind){sndStopMic();sndMic.demo={amplitude:kind==='soft'?.06:.16,frequency:kind==='high'?400:200,shape:'pure'};sndAxes('snd-mic-svg','예시 파형 · 마이크 입력 아님',1/sndMic.zoom);sndDrawDemo();sndMicStatus('직접 만든 예시 신호입니다. 작은 소리·큰 소리는 높이가 같고, 높은 소리는 큰 소리와 진폭이 같습니다.');}
function sndGuard(){if(!sndActive(2)&&sndTone.context)sndStopTone();if(!sndActive(3)&&(sndMic.context||sndMic.pending||sndMic.stream))sndStopMic('단계를 벗어나 마이크를 껐습니다.');}
function initStep2(){if(sndTone.ready)return;sndTone.ready=true;updateStep2Sim();const observer=new MutationObserver(sndGuard);for(const id of ['step2','step3'])if(sndEl(id))observer.observe(sndEl(id),{attributes:true,attributeFilter:['class']});observer.observe(document.body,{childList:true});document.addEventListener('visibilitychange',sndGuard);window.addEventListener('pagehide',()=>{sndStopTone();sndStopMic();});}
function animStep2(){}
function initStep3(){if(sndMic.ready)return;sndMic.ready=true;sndAxes('snd-mic-svg','마이크 꺼짐',1/sndMic.zoom);sndMicButtons();}
function animStep3(){if(sndMic.stream&&!sndMic.frame&&sndActive(3))sndMic.frame=requestAnimationFrame(sndFrame);}
function updateStep3Data(){sndGuard();sndMicButtons();animStep3();}


function sndPitch(samples, rate) {
  if(!samples || samples.length<rate*.045)return null;
  const stride=Math.max(1,Math.floor(rate/12000)), fs=rate/stride, n=Math.min(1800,Math.floor(samples.length/stride));
  const x=new Float64Array(n);let mean=0;
  for(let i=0;i<n;i++){let sum=0;for(let k=0;k<stride;k++)sum+=samples[i*stride+k]||0;x[i]=sum/stride;mean+=x[i];}mean/=n;
  let energy=0;for(let i=0;i<n;i++){x[i]-=mean;energy+=x[i]*x[i];}
  if(Math.sqrt(energy/n)<.004)return null;
  const minTau=Math.max(2,Math.floor(fs/1000)), maxTau=Math.min(Math.floor(fs/60),Math.floor(n/3)), width=n-maxTau;
  if(maxTau<=minTau+2)return null;
  const diff=new Float64Array(maxTau+1);diff[0]=1;let cumulative=0;
  for(let tau=1;tau<=maxTau;tau++){let d=0;for(let i=0;i<width;i++){const a=x[i]-x[i+tau];d+=a*a;}cumulative+=d;diff[tau]=cumulative>0?d*tau/cumulative:1;}
  let best=-1;
  for(let tau=minTau;tau<maxTau;tau++){if(diff[tau]<.12){while(tau+1<=maxTau&&diff[tau+1]<diff[tau])tau++;best=tau;break;}}
  if(best<0){for(let tau=minTau;tau<=maxTau;tau++)if(best<0||diff[tau]<diff[best])best=tau;if(diff[best]>.20)return null;}
  let cross=0, e1=0,e2=0;for(let i=0;i<width;i++){cross+=x[i]*x[i+best];e1+=x[i]*x[i];e2+=x[i+best]*x[i+best];}
  if(cross/Math.sqrt(e1*e2)<.78)return null;
  let refined=best;
  if(best>1&&best<maxTau){const a=diff[best-1],b=diff[best],c=diff[best+1],den=a-2*b+c;if(Math.abs(den)>1e-12)refined+=Math.max(-.5,Math.min(.5,.5*(a-c)/den));}
  const frequency=fs/refined;if(!Number.isFinite(frequency)||frequency<60||frequency>1000)return null;
  return {frequency, confidence:Math.max(0,Math.min(1,1-diff[best]))};
}
/* ML:EDIT:SIMULATION_JS:END */

        // 초기 구동
        window.addEventListener('DOMContentLoaded', () => {
            if (window.MasterLessonRuntime.preview) stepLocks = {1:false,2:false,3:false,4:false};
            checkAndApplyStudentAuth();
            updateStepLockUI();
            initStep2();
            animStep2();
            initStep3();
            animStep3();

            const pageLoginId = document.getElementById('pageLoginId');
            const pageLoginPw = document.getElementById('pageLoginPw');
            if (pageLoginId) {
                pageLoginId.addEventListener('keydown', e => {
                    if (e.key === 'Enter') submitPageLogin();
                    if (e.key === 'Escape') closePageLoginModal();
                });
            }
            if (pageLoginPw) {
                pageLoginPw.addEventListener('keydown', e => {
                    if (e.key === 'Enter') submitPageLogin();
                    if (e.key === 'Escape') closePageLoginModal();
                });
            }
        });
    
        ensureCurrentSchoolYear();
