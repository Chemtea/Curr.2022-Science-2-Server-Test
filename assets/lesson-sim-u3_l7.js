window.addEventListener('lesson-step-change', event => { const stepNum = event.detail;

            if (stepNum === 2) updateStep2Sim();
            if (stepNum === 3) updateStep3Data();
            
});
        
        
        
        

        
/* ML:EDIT:QUIZ_DATA:END */;

        

        

/* ML:EDIT:SIMULATION_JS:START */
// Scientific model only. Shared authentication, locks and point submission are unchanged.
const wave7Lesson = {
  amplitude:2, frequency:1, speed:4, time:0, rate:0.5, playing:true,
  frame:0, last:null, initialized:false,
  compareFrequency:0.5, view:'space'
};
function wave7El(id) { return document.getElementById(id); }
function wave7Number(n) { return Number(n.toFixed(3)).toString(); }
function wave7Read(id,fallback) { const e=wave7El(id); return e && Number.isFinite(Number(e.value)) ? Number(e.value) : fallback; }
function wave7Displacement(x,t,amplitude,frequency) { return amplitude*Math.sin(2*Math.PI*(frequency*t-x*frequency/wave7Lesson.speed)); }
function wave7Text(x,y,text,color='#cbd5e1',size=16,anchor='start') { return `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" text-anchor="${anchor}">${text}</text>`; }
function wave7Line(x1,y1,x2,y2,color='#475569',extra='') { return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" ${extra}/>`; }
function wave7Path(fn,max,x0,y0,xscale,yscale) {
  const points=[]; for(let i=0;i<=480;i++){const x=max*i/480;points.push(`${i?'L':'M'}${(x0+x*xscale).toFixed(2)},${(y0-fn(x)*yscale).toFixed(2)}`);} return points.join(' ');
}
function initStep2() {
  if (!wave7El('wave7-wave-svg')) return;
  if (!wave7Lesson.initialized) {
    wave7Lesson.initialized=true;
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) wave7Lesson.playing=false;
    document.addEventListener('visibilitychange',()=>{wave7Lesson.last=null;if(document.hidden)wave7StopFrame();else wave7Schedule();});
    window.addEventListener('pagehide',()=>{wave7StopFrame();wave7Lesson.last=null;});
    window.addEventListener('pageshow',()=>wave7Schedule());
    window.addEventListener('resize',()=>{updateStep2Sim();updateStep3Data();});
  }
  updateStep2Sim();
}
function wave7Change2() {
  wave7Lesson.amplitude=Math.max(0.5,Math.min(3,wave7Read('wave7-amplitude',2)));
  wave7Lesson.frequency=Math.max(0.5,Math.min(2,wave7Read('wave7-frequency',1)));
  wave7Lesson.time=0;wave7Lesson.last=null;updateStep2Sim();
}
function wave7StopFrame() { if(wave7Lesson.frame)cancelAnimationFrame(wave7Lesson.frame);wave7Lesson.frame=0; }
function wave7Active() { return currentActiveStep===2 && !document.hidden && !!wave7El('wave7-wave-svg') && wave7Lesson.playing; }
function wave7Schedule() { if(wave7Active()&&!wave7Lesson.frame)wave7Lesson.frame=requestAnimationFrame(wave7Frame); }
function wave7Frame(timestamp) {
  wave7Lesson.frame=0;
  if(!wave7Active()){wave7Lesson.last=null;return;}
  if(wave7Lesson.last!==null)wave7Lesson.time+=Math.max(0,Math.min(0.1,(timestamp-wave7Lesson.last)/1000))*wave7Lesson.rate;
  wave7Lesson.last=timestamp;wave7Draw2();wave7Schedule();
}
function animStep2() { wave7Schedule(); }
function wave7TogglePlay() { wave7Lesson.playing=!wave7Lesson.playing;wave7Lesson.last=null;if(!wave7Lesson.playing)wave7StopFrame();updateStep2Sim(); }
function updateStep2Sim() { wave7Draw2();wave7Schedule(); }
function wave7Draw2() {
  const svg=wave7El('wave7-wave-svg');if(!svg)return;
  const width=Math.max(360,Math.min(760,svg.clientWidth||760)),compact=width<600;
  svg.setAttribute('viewBox',`0 0 ${width} 400`);
  const s=wave7Lesson,lambda=s.speed/s.frequency,x0=compact?50:75,plotWidth=width-x0-25,xscale=plotWidth/12,center=196,yscale=29;
  let h='<title>오른쪽으로 진행하는 파동과 위아래로 진동하는 매질의 점</title>';
  h+=wave7Text(24,24,'진동 중심에서 벗어난 정도 (cm)','#cbd5e1',compact?14:16);
  const arrowStart=width*0.53,arrowEnd=width-25;
  h+=wave7Line(arrowStart,60,arrowEnd,60,'#e879f9','stroke-width="2"')+`<polygon points="${arrowEnd},60 ${arrowEnd-10},55 ${arrowEnd-10},65" fill="#e879f9"/>`;
  h+=wave7Text((arrowStart+arrowEnd)/2,48,compact?'파동의 전달 방향':'파동·에너지의 전달 방향','#f0abfc',compact?13:15,'middle');
  for(const y of [-3,-2,-1,0,1,2,3]){const yy=center-y*yscale;h+=wave7Line(x0,yy,x0+plotWidth,yy,y===0?'#94a3b8':'#233047',y===0?'stroke-dasharray="6 5"':'');h+=wave7Text(x0-15,yy+5,String(y),'#94a3b8',14,'end');}
  for(let x=0;x<=12;x+=2){h+=wave7Line(x0+x*xscale,center-94,x0+x*xscale,center+96,'#233047');h+=wave7Text(x0+x*xscale,315,String(x),'#cbd5e1',15,'middle');}
  h+=wave7Text(width-25,340,'위치 (m)','#cbd5e1',16,'end');
  h+=wave7Line(x0+6*xscale,90,x0+6*xscale,center+94,'#fbbf24','stroke-dasharray="5 5"');
  h+=`<path d="${wave7Path(x=>wave7Displacement(x,s.time,s.amplitude,s.frequency),12,x0,center,xscale,yscale)}" fill="none" stroke="#38bdf8" stroke-width="3"/>`;
  for(let i=0;i<=48;i++){const x=i/4,y=wave7Displacement(x,s.time,s.amplitude,s.frequency);h+=`<circle cx="${x0+x*xscale}" cy="${center-y*yscale}" r="3" fill="#7dd3fc"/>`;}
  const first=((lambda*(s.frequency*s.time-0.25))%lambda+lambda)%lambda;
  for(let x=first;x<=12+1e-8;x+=lambda)h+=`<circle cx="${x0+x*xscale}" cy="${center-s.amplitude*yscale}" r="10" fill="none" stroke="#e879f9" stroke-width="2.5"/>`;
  const y=wave7Displacement(6,s.time,s.amplitude,s.frequency);
  h+=`<circle cx="${x0+6*xscale}" cy="${center-y*yscale}" r="8" fill="#fbbf24" stroke="#0f172a" stroke-width="2"/>`;
  h+=wave7Text(x0+6*xscale,80,'같은 매질의 점: 위치 6 m','#fde68a',16,'middle');
  h+=wave7Text(24,367,compact?'● 파란 점: 매질':'● 파란 점: 매질의 여러 점','#7dd3fc',15)+wave7Text(compact?185:354,367,compact?'● 노란 점: 한 점':'● 노란 점: 관찰할 한 점','#fde68a',15);
  h+=wave7Text(24,390,compact?'○ 분홍 고리: 마루 · 매질 입자가 아님':'○ 분홍 고리: 마루의 위치 · 같은 매질 입자가 아님','#f0abfc',compact?14:15);
  svg.innerHTML=h;
  wave7El('wave7-amplitude-label').textContent=wave7Number(s.amplitude)+' cm';
  wave7El('wave7-frequency-label').textContent=wave7Number(s.frequency)+' Hz';
  wave7El('wave7-play').textContent=s.playing?'⏸ 일시정지':'▶ 재생';
  wave7El('wave7-play').setAttribute('aria-pressed',String(s.playing));
}
function initStep3() { updateStep3Data(); }
function animStep3() { /* Graphs update only when a control changes. */ }

function wave7ChangeFrequency3() {
  wave7Lesson.compareFrequency=Math.max(0.5,Math.min(2,wave7Read('wave7-compare-frequency',0.5)));
  updateStep3Data();
}
function wave7SetView(view) {
  if(!['space','time'].includes(view))return;
  wave7Lesson.view=view;updateStep3Data();
}
function wave7Graph(spacing,max,isTime,viewWidth) {
  const compact=viewWidth<600,x0=compact?50:75,width=viewWidth-x0-25;
  const center=190,yscale=28,xscale=width/max,top=96,bottom=273,amplitude=2;
  const color=isTime?'#fbbf24':'#38bdf8';
  let h=wave7Text(x0,25,isTime?'한 위치에서 시간이 흐르면':'한순간에 여러 위치를 보면',color,compact?16:18);
  h+=wave7Text(x0,49,'진동 중심에서 벗어난 정도 (cm)','#94a3b8',compact?12:14);
  const left=x0+spacing/4*xscale,right=x0+spacing*1.25*xscale;
  h+=`<rect x="${left}" y="${top}" width="${right-left}" height="${bottom-top}" fill="${color}" opacity="0.09"/>`;
  for(const y of [-2,0,2]) {
    h+=wave7Line(x0,center-y*yscale,x0+width,center-y*yscale,y===0?'#94a3b8':'#334155',y===0?'stroke-dasharray="5 4"':'');
    h+=wave7Text(x0-13,center-y*yscale+5,String(y),'#94a3b8',14,'end');
  }
  const ticks=6;
  for(let i=0;i<=ticks;i++) {
    const value=max*i/ticks,xx=x0+width*i/ticks;
    h+=wave7Line(xx,top,xx,bottom,'#233047');
    h+=wave7Text(xx,bottom+21,wave7Number(value),'#cbd5e1',14,'middle');
  }
  h+=`<path d="${wave7Path(x=>amplitude*Math.sin(2*Math.PI*x/spacing),max,x0,center,xscale,yscale)}" fill="none" stroke="${color}" stroke-width="3"/>`;
  const barY=109;
  for(const xx of [left,right]) {
    h+=wave7Line(xx,barY,xx,bottom,color,'stroke-width="1.5" stroke-dasharray="5 4"');
    h+=`<circle cx="${xx}" cy="${center-amplitude*yscale}" r="6" fill="${color}" stroke="#0f172a" stroke-width="2"/>`;
  }
  h+=wave7Line(left,barY,right,barY,color,'stroke-width="3"')+wave7Line(left,barY-5,left,barY+5,color)+wave7Line(right,barY-5,right,barY+5,color);
  const textWidth=compact?Math.min(width,190):220;
  const labelX=Math.max(x0+textWidth/2,Math.min(x0+width-textWidth/2,(left+right)/2));
  h+=wave7Text(labelX,85,(isTime?'주기 T = ':'파장 λ = ')+wave7Number(spacing)+(isTime?' s':' m'),color,20,'middle');
  h+=wave7Text(x0+width,bottom+50,isTime?'시간 (s)':'위치 (m)','#e2e8f0',17,'end');
  return h;
}
function updateStep3Data() {
  const svg=wave7El('wave7-measure-svg');if(!svg)return;
  const f=wave7Lesson.compareFrequency,isTime=wave7Lesson.view==='time';
  const spacing=isTime?1/f:wave7Lesson.speed/f;
  const width=Math.max(360,Math.min(760,svg.clientWidth||760));
  svg.setAttribute('viewBox',`0 0 ${width} 340`);
  svg.innerHTML='<title>'+(isTime?'한 점이 한 번 진동하는 시간, 주기':'이웃한 두 마루 사이의 거리, 파장')+'</title>'+wave7Graph(spacing,isTime?3:12,isTime,width);
  for(const view of ['space','time'])wave7El('wave7-view-'+view).setAttribute('aria-pressed',String(view===wave7Lesson.view));
  wave7El('wave7-compare-frequency-label').textContent=wave7Number(f)+' Hz';
  wave7El('wave7-compare-note').textContent=isTime?'한 점이 같은 움직임을 되풀이하는 시간 → 주기. 빠르게 흔들수록 짧아집니다.':'이웃한 마루 사이의 거리 → 파장. 파동 속력이 같다면 빠르게 흔들수록 짧아집니다.';
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
