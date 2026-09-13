window.addEventListener('lesson-step-change', event => { const stepNum = event.detail;

            if (stepNum === 2) updateStep2Sim();
            if (stepNum === 3) updateStep3Data();
            
});
        
        
        
        

        
/* ML:EDIT:QUIZ_DATA:END */;

        

        

/* ML:EDIT:SIMULATION_JS:START */
// RGB values are display-control values; region colors are calculated explicitly.
const mixChannels2 = ['r', 'g', 'b'];
const mixChallenges2 = [
  {name:'주황빛',rgb:[255,128,0],hint:'빨강을 밝게 켜고, 초록을 조금씩 더해 보세요. 파랑은 꺼 두세요.'},
  {name:'회색빛',rgb:[128,128,128],hint:'세 빛의 값을 같게 맞춘 뒤 함께 낮춰 보세요.'},
  {name:'연한 자홍빛',rgb:[255,128,255],hint:'빨강과 파랑을 밝게 켜고, 초록을 조금씩 더해 보세요.'}
];
let mixChallengeIndex2 = 0;
function mixEl2(id) { return document.getElementById(id); }
function mixClamp(value) { return Math.max(0, Math.min(255, Math.round(Number(value) || 0))); }
function mixCss(rgb) { return 'rgb(' + rgb.map(mixClamp).join(', ') + ')'; }
function mixShadeName(base, maximum) {
  return maximum === 255 ? base : (maximum < 128 ? '어두운 ' : '') + base + ' 계열';
}
function mixName(rgb) {
  const [r, g, b] = rgb.map(mixClamp);
  const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b);
  if (maximum === 0) return '검은색 · 빛 없음';
  if (r === g && g === b) return r === 255 ? '흰색' : (r < 96 ? '어두운 회색' : '회색');
  if (g === 0 && b === 0) return mixShadeName('빨간색', maximum);
  if (r === 0 && b === 0) return mixShadeName('초록색', maximum);
  if (r === 0 && g === 0) return mixShadeName('파란색', maximum);
  if (r === g && b === 0) return mixShadeName('노란색', maximum);
  if (r === b && g === 0) return mixShadeName('자홍색', maximum);
  if (g === b && r === 0) return mixShadeName('청록색', maximum);
  const delta = maximum - minimum;
  let hue;
  if (maximum === r) hue = 60 * (((g - b) / delta) % 6);
  else if (maximum === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  if (hue < 0) hue += 360;
  let base = hue < 15 || hue >= 345 ? '빨간색' : hue < 45 ? '주황색' : hue < 70 ? '노란색' : hue < 100 ? '연두색' : hue < 165 ? '초록색' : hue < 195 ? '청록색' : hue < 255 ? '파란색' : hue < 285 ? '보라색' : hue < 320 ? '자홍색' : '분홍색';
  if (r > g && r > b && minimum > 100 && b >= g) base = '분홍색';
  const shade = maximum < 128 ? '어두운 ' : delta / maximum < 0.28 ? '옅은 ' : '';
  return shade + base + ' 계열';
}
function mixValues2() {
  return mixChannels2.map(channel => mixClamp(mixEl2('mix-' + channel + '2').value));
}
function mixPreset2(key) {
  if (!['r', 'g', 'b', 'rg', 'rb', 'gb', 'rgb', 'off'].includes(key)) return;
  mixChannels2.forEach(channel => {
    mixEl2('mix-' + channel + '2').value = String(key !== 'off' && key.includes(channel) ? 255 : 0);
  });
  updateStep2Sim();
}
function mixTextColor2(rgb) {
  const linear = rgb.map(value => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722 > 0.179 ? '#000000' : '#ffffff';
}
function initStep2() {
  updateStep2Sim();
}
function animStep2() {}
function updateStep2Sim() {
  if (!mixEl2('mix-scene2')) return;
  const rgb = mixValues2();
  const [r, g, b] = rgb;
  const regions = { r:[r,0,0], g:[0,g,0], b:[0,0,b], rg:[r,g,0], rb:[r,0,b], gb:[0,g,b], rgb:rgb };
  Object.keys(regions).forEach(key => {
    mixEl2('mix-region-' + key + '2').setAttribute('fill', mixCss(regions[key]));
    mixEl2('mix-label-' + key + '2').setAttribute('fill', mixTextColor2(regions[key]));
  });
  mixChannels2.forEach((channel, index) => {
    mixEl2('mix-' + channel + '-value2').textContent = String(rgb[index]);
  });
  const name = mixName(rgb);
  mixEl2('mix-result-name2').textContent = name;
  mixEl2('mix-svg-desc2').textContent = '각 원에 도달하는 빛을 합친 모형입니다. 실제 R ' + r + ', G ' + g + ', B ' + b + '. 세 빛이 겹치는 가운데는 ' + name + '입니다.';
  mixUpdateChallenge2(rgb);
}
function mixUpdateChallenge2(rgb) {
  const challenge = mixChallenges2[mixChallengeIndex2];
  const success = rgb.every((value,index) => Math.abs(value - challenge.rgb[index]) <= 14);
  mixEl2('mix-target-swatch2').style.backgroundColor = mixCss(challenge.rgb);
  mixEl2('mix-target-swatch2').setAttribute('aria-label', challenge.name);
  mixEl2('mix-target-name2').textContent = challenge.name;
  const feedback = mixEl2('mix-challenge-feedback2');
  feedback.textContent = success ? '✨ 색이 닮았어요! 다른 색에도 도전해 보세요.' : challenge.hint;
  feedback.style.color = success ? '#6ee7b7' : '#cbd5e1';
}
function mixNextChallenge2() {
  mixChallengeIndex2 = (mixChallengeIndex2 + 1) % mixChallenges2.length;
  mixUpdateChallenge2(mixValues2());
}

// 조명의 RGB 성분과 물체가 반사하는 성분을 비교하는 수업용 모형.
const mix3Lights = {white:[255,255,255],red:[255,0,0],green:[0,255,0],blue:[0,0,255],yellow:[255,255,0],cyan:[0,255,255],magenta:[255,0,255],off:[0,0,0]};
const mix3Materials = {
 white:{name:'흰색',mask:[1,1,1]},red:{name:'빨간색',mask:[1,0,0]},green:{name:'초록색',mask:[0,1,0]},blue:{name:'파란색',mask:[0,0,1]},
 yellow:{name:'노란색',mask:[1,1,0]},cyan:{name:'청록색',mask:[0,1,1]},magenta:{name:'자홍색',mask:[1,0,1]},black:{name:'검은색',mask:[0,0,0]}
};
const mix3State = {initialized:false,custom:[255,0,0],rgb:[255,255,255],material:'red'};
function mix3El(id) { return document.getElementById(id); }
function mix3Text(id,text) { const e=mix3El(id); if(e) e.textContent=text; }
function mix3Clamp(rgb) { return rgb.map(v=>Number.isFinite(Number(v))?Math.max(0,Math.min(255,Math.round(Number(v)))):0); }
function mix3Components(rgb) { return ['R','G','B'].filter((_,i)=>rgb[i]>0).join('')||'none'; }
function mix3ComponentName(key) { return key==='none'?'빛 없음':key.split('').join(' + '); }
function mix3Model(rgb,material) { const mask=mix3Materials[material].mask; return {reflected:rgb.map((v,i)=>v*mask[i]),absorbed:rgb.map((v,i)=>v*(1-mask[i]))}; }
function mix3Node(parent,tag,attrs,text) { const n=document.createElementNS('http://www.w3.org/2000/svg',tag); Object.entries(attrs||{}).forEach(([k,v])=>n.setAttribute(k,String(v))); if(text!==undefined)n.textContent=text; parent.appendChild(n); return n; }
function mix3Label(parent,x,y,text,cls='mix3-label') { return mix3Node(parent,'text',{x,y,'class':cls},text); }
function mix3Arrow(parent,x1,x2,y,rgb,label) {
 const active=rgb.some(v=>v>0), color=active?mixCss(rgb):'#64748b';
 mix3Node(parent,'path',{d:`M${x1} ${y} H${x2-13}`,'stroke':color,'stroke-width':7,'stroke-dasharray':active?'none':'6 5',fill:'none'});
 mix3Node(parent,'path',{d:`M${x2} ${y} L${x2-16} ${y-9} V${y+9} Z`,fill:color});
 mix3Label(parent,(x1+x2)/2,y-25,label,'mix3-note');
}
function mix3DrawPixels() {
 const svg=mix3El('mix3-pixels'),rgb=mix3State.rgb; svg.replaceChildren();
 const name=mixName(rgb); svg.setAttribute('aria-label',`${name} 화면과 RGB ${rgb.join(', ')} 화소 모형`);
 mix3Node(svg,'title',{},`${name} 화면과 확대된 RGB 부분`);
 mix3Label(svg,145,31,'합쳐 보이는 화면','mix3-key');
 mix3Node(svg,'rect',{x:44,y:55,width:202,height:145,rx:12,fill:mixCss(rgb),stroke:'#94a3b8','stroke-width':2,'data-mix3-screen':'true'});
 mix3Label(svg,145,228,name);
 mix3Label(svg,520,31,'한 화소의 RGB 부분을 확대','mix3-key');
 const names=['R','G','B'];
 for(let i=0;i<3;i++) {
  const channel=[0,0,0];channel[i]=rgb[i];
  mix3Node(svg,'rect',{x:368+i*100,y:55,width:88,height:145,rx:4,fill:mixCss(channel),stroke:'#475569','stroke-width':2,'data-mix3-subpixel':names[i]});
  mix3Label(svg,412+i*100,226,names[i]+' '+rgb[i]);
 }
 mix3Label(svg,302,126,'→','mix3-key');
 const component=mix3ComponentName(mix3Components(rgb));
 mix3Text('mix3-pixel-note',rgb.some(v=>v>0)?`${component} 부분에서 나온 빛이 함께 눈에 들어와 ${name}으로 보입니다. 수치는 각 RGB 부분의 화면 조절값입니다.`:'R·G·B가 모두 0이므로 화면의 빛이 꺼져 검게 보입니다. 검은색 빛을 켠 것이 아닙니다.');
}
function mix3DrawReflection() {
 const svg=mix3El('mix3-reflection'),rgb=mix3State.rgb,material=mix3Materials[mix3State.material],model=mix3Model(rgb,mix3State.material);
 svg.replaceChildren(); svg.setAttribute('aria-label',`${mixName(rgb)} 조명에서 ${material.name} 물체의 반사빛: ${mix3ComponentName(mix3Components(model.reflected))}`);
 mix3Node(svg,'title',{},'조명 → 물체 → 눈');
 mix3Label(svg,85,34,'조명','mix3-key');mix3Label(svg,372,34,'물체','mix3-key');mix3Label(svg,680,34,'눈','mix3-key');
 mix3Node(svg,'rect',{x:43,y:95,width:84,height:100,rx:13,fill:mixCss(rgb),stroke:'#94a3b8','stroke-width':2});
 mix3Label(svg,85,227,rgb.some(v=>v>0)?mixName(rgb):'꺼짐');
 mix3Arrow(svg,145,311,145,rgb,rgb.some(v=>v>0)?'비추는 빛':'비추는 빛 없음');
 mix3Node(svg,'circle',{cx:372,cy:145,r:51,fill:mixCss(model.reflected),stroke:'#94a3b8','stroke-width':2,'data-mix3-object':'true'});
 mix3Label(svg,372,225,`${material.name} 물체`);
 mix3Label(svg,372,250,'(백색광에서의 기준 색)','mix3-note');
 mix3Arrow(svg,435,620,145,model.reflected,mix3Components(model.reflected)==='none'?'반사빛 없음':mix3ComponentName(mix3Components(model.reflected))+' 반사');
 mix3Node(svg,'path',{d:'M640 145 Q680 110 720 145 Q680 180 640 145 Z',fill:'#e2e8f0',stroke:'#94a3b8','stroke-width':2});
 mix3Node(svg,'circle',{cx:680,cy:145,r:14,fill:'#334155'});mix3Node(svg,'circle',{cx:680,cy:145,r:7,fill:'#0f172a'});
 mix3Label(svg,680,226,'반사빛을 봄','mix3-note');
}
function initStep3() { if(mix3State.initialized||!mix3El('mix3-light'))return; mix3State.initialized=true; updateStep3Data(); }
function animStep3() {}
function updateStep3Data() {
 if(!mix3El('mix3-light'))return;
 const light=mix3El('mix3-light').value,raw=light==='custom'?mix3State.custom:(mix3Lights[light]||mix3Lights.white);
 const selected=mix3El('mix3-material').value,material=Object.prototype.hasOwnProperty.call(mix3Materials,selected)?selected:'white';
 const rgb=mix3Clamp(raw);
 Object.assign(mix3State,{rgb,material});
 mix3DrawPixels();mix3DrawReflection();mix3ShowResult();
}
function mix3Import() {
 mix3State.custom=mix3Clamp(mixValues2());mix3El('mix3-custom-option').disabled=false;mix3El('mix3-light').value='custom';
 mix3Text('mix3-import-status','가져온 RGB: '+mix3State.custom.join(' · '));updateStep3Data();
}
function mix3ShowResult() {
 const model=mix3Model(mix3State.rgb,mix3State.material),actual=mix3Components(model.reflected),absorbed=mix3Components(model.absorbed),name=mixName(model.reflected);
 mix3Text('mix3-result',actual==='none'?'눈에 오는 반사빛이 없어 검게 보입니다.':`${mix3ComponentName(actual)} 빛이 반사되어 ${name}으로 보입니다.`);
 const absorption=absorbed==='none'?'':`${mix3ComponentName(absorbed)} 빛은 물체에 흡수됩니다. `;
 mix3Text('mix3-reason',absorption.trim());
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
