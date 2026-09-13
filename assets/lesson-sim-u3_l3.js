window.addEventListener('lesson-step-change', event => { const stepNum = event.detail;

            if (stepNum === 2) updateStep2Sim();
            if (stepNum === 3) updateStep3Data();
            
});
        
        
        
        

        
/* ML:EDIT:QUIZ_DATA:END */;

        

        

/* ML:EDIT:SIMULATION_JS:START */
// Lesson-only interaction. Existing platform authentication, locks and submission stay unchanged.
const seeingLesson = {
  s2: {points: [], visible: false, rays: true, playing: true},
  s3: {points: [], playing: true, light: true},
  records2: [], records3: [], order: [], running: false, initialized2: false, initialized3: false
};
function seeingEl(id) { return document.getElementById(id); }
function seeingText(id, value) { seeingEl(id).textContent = value; }
function seeingAttr(id, name, value) { seeingEl(id).setAttribute(name, String(value)); }
function seeingArrowDefs(prefix) {
  return `<defs><marker id="${prefix}-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#fbbf24"/></marker></defs>`;
}
function seeingLines(points, prefix) {
  return points.slice(1).map((p, i) => {
    const from=points[i], length=Math.hypot(p.x-from.x,p.y-from.y);
    const ux=(p.x-from.x)/length, uy=(p.y-from.y)/length;
    const mx=from.x+(p.x-from.x)*.56, my=from.y+(p.y-from.y)*.56;
    const head=`${mx+ux*10},${my+uy*10} ${mx-ux*6-uy*6},${my-uy*6+ux*6} ${mx-ux*6+uy*6},${my-uy*6-ux*6}`;
    return `<line x1="${from.x}" y1="${from.y}" x2="${p.x}" y2="${p.y}" stroke="#fbbf24" stroke-width="4"/><polygon points="${head}" fill="#fbbf24"/>`;
  }).join('');
}
function seeingLamp(x, y, on) {
  return `<g transform="translate(${x} ${y})"><circle r="34" fill="${on ? '#fbbf2428' : '#334155'}"/><circle r="20" fill="${on ? '#fde68a' : '#64748b'}" stroke="#fbbf24" stroke-width="2"/><path d="M-10 19 v13 h20 V19 M-8 38 h16" fill="none" stroke="#94a3b8" stroke-width="5"/></g>`;
}
function seeingEye(x, y, open) {
  return `<g transform="translate(${x} ${y})">${open ? '<path d="M-33 0 Q0 -29 33 0 Q0 29 -33 0" fill="#f8fafc" stroke="#94a3b8" stroke-width="2"/><circle r="12" fill="#38bdf8"/><circle r="6" fill="#0f172a"/>' : '<path d="M-33 0 Q0 26 33 0" fill="none" stroke="#cbd5e1" stroke-width="5"/><path d="M-22 8 l-5 9 M0 13 v10 M22 8 l5 9" stroke="#cbd5e1" stroke-width="3"/>'}</g>`;
}
function seeingLabel(x, y, text, color = '#e2e8f0') {
  return `<text x="${x}" y="${y}" text-anchor="middle" fill="${color}" font-size="19" font-weight="600">${text}</text>`;
}
function initStep2() {
  if (seeingLesson.initialized2) return;
  seeingLesson.initialized2 = true;
  updateStep2Sim();
}
function updateStep2Sim() {
  const target = seeingEl('seeing-target').value;
  const light = seeingEl('seeing-light').checked;
  const eyes = seeingEl('seeing-eye').checked;
  const shield = target === 'book' ? seeingEl('seeing-shield').value : 'none';
  const rays = seeingEl('seeing-rays2').checked;
  const L = {x:110,y:90}, B = {x:390,y:265}, E = {x:725,y:90};
  let points = [], visible = false, reason;
  if (!light) {
    reason = target === 'book' ? '다른 빛이 없는 방입니다. 책에 도달해 반사될 빛이 없어 책을 볼 수 없습니다.' : '다른 빛이 없는 방에서 전등도 꺼져 있어 전등을 볼 수 없습니다.';
  } else if (target === 'lamp') {
    points = [L, E]; visible = eyes;
    reason = eyes ? '광원인 전등에서 나온 빛이 눈으로 직접 들어와 전등이 보입니다.' : '전등은 빛을 내지만, 눈을 감아 빛이 눈 안으로 들어오지 못합니다.';
  } else if (shield === 'before') {
    points = [L,{x:250,y:177.5}];
    reason = '전등에서 책으로 가는 빛이 가림막에서 막힙니다. 책에 도달할 빛이 없어 책이 보이지 않습니다.';
  } else if (shield === 'after') {
    points = [L,B,{x:557.5,y:177.5}];
    reason = '빛이 책까지 도달해 반사되지만, 눈으로 가는 빛이 가림막에서 막혀 책이 보이지 않습니다.';
  } else {
    points = [L,B,E]; visible = eyes;
    reason = eyes ? '전등에서 나온 빛이 책에서 반사된 뒤 눈에 들어와 책이 보입니다.' : '빛이 책에서 반사되어도 눈을 감으면 눈 안으로 들어오지 못해 책이 보이지 않습니다.';
  }
  seeingEl('seeing-shield').disabled = target !== 'book';
  seeingText('seeing-shield-note', target === 'book' ? '가림막으로 빛이 끊기는 위치를 비교하세요.' : '가림막은 책을 관찰할 때 사용합니다. 지금은 전등 자체를 봅니다.');
  Object.assign(seeingLesson.s2, {target, light, eyes, shield, rays, points, visible, reason});
  const book = `<g transform="translate(390 265)"><path d="M-50 5 L-9 -16 L0 -8 L9 -16 L50 5 L50 30 L0 13 L-50 30 Z" fill="${light && shield !== 'before' ? '#f8fafc' : '#334155'}" stroke="#38bdf8" stroke-width="3"/><path d="M0 -8 V13" stroke="#64748b" stroke-width="2"/></g>`;
  const shade = shield === 'none' ? '' : `<g transform="translate(${shield === 'before' ? 250 : 557.5} 177.5)"><rect x="-9" y="-57" width="18" height="114" rx="3" fill="#94a3b8" stroke="#f8fafc"/><text x="0" y="-70" text-anchor="middle" fill="#fda4af" font-size="18">가림막</text></g>`;
  seeingEl('seeing-scene2').innerHTML = `<title>전등과 책을 보는 빛의 경로 모형</title>${seeingArrowDefs('seeing2')}<rect width="840" height="370" rx="14" fill="#0f172a"/>
    <g id="seeing-static2" ${rays ? '' : 'visibility="hidden"'}>${seeingLines(points,'seeing2')}</g>
    ${target === 'book' ? book : ''}${seeingLamp(L.x,L.y,light)}${seeingEye(E.x,E.y,eyes)}${shade}
    ${seeingLabel(110,155,light ? '전등 켜짐' : '전등 꺼짐')}${seeingLabel(725,143,eyes ? '뜬 눈' : '감은 눈')}
    ${target === 'book' ? seeingLabel(390,329,'책 · 스스로 빛을 내지 않음') : seeingLabel(420,250,'전등 자체를 보는 경우')}
    <circle id="seeing-dot2" r="7" fill="#fff7c2" visibility="hidden"/>
    <text x="24" y="350" fill="#94a3b8" font-size="16">${rays ? '화살표: 빛이 진행하는 방향' : '빛의 경로를 숨긴 상태'}</text>`;
  seeingText('seeing-result2', visible ? (target === 'book' ? '책이 보임' : '전등이 보임') : '보이지 않음');
  seeingAttr('seeing-result2','data-visible',visible);
  seeingText('seeing-reason2',reason);
  seeingText('seeing-record-hint', '조건을 바꾸어 비교한 뒤 학습지에 빛의 경로와 까닭을 정리하세요.');
}
function seeingToggleMotion(step) {
  const state = seeingLesson['s'+step]; state.playing = !state.playing;
  seeingText('seeing-motion'+step,state.playing ? '⏸ 빛 이동 멈추기' : '▶ 빛 이동 재생');
  seeingAttr('seeing-motion'+step,'aria-pressed',state.playing);
  if (!state.playing) seeingAttr('seeing-dot'+step,'visibility','hidden');
}
function seeingRecord2() {
  const s = seeingLesson.s2;
  const row = [s.target === 'book' ? '책' : '전등',s.light ? '켜짐' : '꺼짐',s.eyes ? '뜸' : '감음',{'none':'없음','before':'전등 → 책','after':'책 → 눈'}[s.shield],s.visible ? '보임' : '안 보임'];
  if (seeingLesson.records2.some(r => r.join('|') === row.join('|'))) { seeingText('seeing-record-hint','이미 기록한 조건입니다. 다른 조건으로 바꾸어 비교하세요.'); return; }
  seeingLesson.records2.push(row);
  seeingRenderTable('seeing-records2',seeingLesson.records2);
  seeingText('seeing-record-hint','관찰 조건을 기록했습니다. 학습지에는 왜 그렇게 보이는지도 함께 적으세요.');
}
function seeingRenderTable(id, rows) {
  const body = seeingEl(id); body.replaceChildren();
  rows.forEach(values => { const tr = document.createElement('tr'); values.forEach(value => { const td = document.createElement('td'); td.textContent = value; tr.appendChild(td); }); body.appendChild(tr); });
}
function seeingClearRecords(step) {
  if (!seeingLesson['records'+step].length || !confirm('이 화면의 관찰 기록을 지울까요? 학습지 필기는 지워지지 않습니다.')) return;
  seeingLesson['records'+step] = []; seeingRenderTable('seeing-records'+step,[]);
}
// Solve the air/water crossing by Fermat's stationary optical path (n_air=1, n_water=4/3).
// No calculation is required from students. Each endpoint remains on its stated side.
function seeingCrossing(top, bottom, surface = 190) {
  let lo = Math.min(top.x,bottom.x), hi = Math.max(top.x,bottom.x);
  const airHeight = surface-top.y, waterDepth = bottom.y-surface;
  for (let i=0; i<60; i++) {
    const x = (lo+hi)/2;
    const f = (x-top.x)/Math.hypot(x-top.x,airHeight) + (4/3)*(x-bottom.x)/Math.hypot(x-bottom.x,waterDepth);
    if (f>0) hi=x; else lo=x;
  }
  return {x:(lo+hi)/2,y:surface};
}
function initStep3() {
  if (seeingLesson.initialized3) return;
  seeingLesson.initialized3=true;
  seeingRenderOrder(); updateStep3Data();
}
function updateStep3Data() {
  const eyeX = Number(seeingEl('seeing-eye-x').value), depth = Number(seeingEl('seeing-fish-depth').value);
  const light = seeingEl('seeing-light3').checked, rays = seeingEl('seeing-rays3').checked, normals = seeingEl('seeing-normals3').checked;
  const L = {x:100,y:65}, F = {x:355,y:190+depth}, E = {x:eyeX,y:65};
  const A = seeingCrossing(L,F), B = seeingCrossing(E,F), points = light ? [L,A,F,B,E] : [];
  Object.assign(seeingLesson.s3,{eyeX,depth,light,rays,points,entry:A,exit:B,fish:F,eye:E,lamp:L});
  seeingText('seeing-eye-value',`${eyeX < 645 ? '왼쪽' : '오른쪽'} (${eyeX})`);
  seeingText('seeing-depth-value',`${depth < 125 ? '얕음' : '깊음'} (${depth})`);
  const normalLines = [A,B].map(p => `<line x1="${p.x}" y1="145" x2="${p.x}" y2="235" stroke="#cbd5e1" stroke-dasharray="6 5" stroke-width="2"/>`).join('');
  const sites = [A,B].map((p,i) => `<circle cx="${p.x}" cy="190" r="6" fill="#38bdf8"/><text x="${p.x}" y="132" text-anchor="middle" fill="#7dd3fc" font-size="18">${i ? '③ 굴절' : '① 굴절'}</text>`).join('');
  seeingEl('seeing-scene3').innerHTML = `<title>물고기를 볼 때 두 경계면에서 굴절하고 물고기에서 반사되는 빛</title>${seeingArrowDefs('seeing3')}
    <rect width="840" height="440" rx="14" fill="#0f172a"/><path d="M0 190 H840 V426 Q840 440 826 440 H14 Q0 440 0 426 Z" fill="#0c4a6e66"/>
    <line x1="0" y1="190" x2="840" y2="190" stroke="#38bdf8" stroke-width="3"/>
    <text x="20" y="169" fill="#e2e8f0" font-size="18">공기</text><text x="20" y="218" fill="#7dd3fc" font-size="18">물</text>
    <g ${rays && light ? '' : 'visibility="hidden"'}>${normals ? normalLines : ''}${seeingLines(points,'seeing3')}${sites}</g>
    ${seeingLamp(L.x,L.y,light)}${seeingEye(E.x,E.y,true)}${seeingLabel(100,25,'광원')}${seeingLabel(E.x,25,'관찰자의 눈')}
    <g transform="translate(${F.x} ${F.y})"><path d="M-25 0 L-53 -22 L-53 22 Z" fill="${light ? '#fb923c' : '#475569'}"/><ellipse rx="34" ry="20" fill="${light ? '#fbbf24' : '#64748b'}" stroke="#f8fafc" stroke-width="2"/><circle cx="19" cy="-5" r="4" fill="#0f172a"/></g>
    ${seeingLabel(F.x,F.y+43,light && rays ? '② 물고기에서 반사' : '물고기')}
    <circle id="seeing-dot3" r="7" fill="#fff7c2" visibility="hidden"/>`;
  seeingText('seeing-reason3',light ? '광원에서 나온 빛은 물에 들어갈 때 굴절하고, 물고기에서 반사된 뒤 물에서 공기로 나올 때 다시 굴절하여 눈에 들어옵니다.' : '다른 광원이 없는 조건입니다. 물고기에서 반사되어 눈으로 들어올 빛이 없어 물고기를 볼 수 없습니다.');
  seeingText('seeing-path-note3',rays && light ? '①·③에서는 굴절, ②에서는 반사입니다. 물고기는 여러 방향으로 빛을 반사하며, 그림에는 눈에 들어오는 한 경로만 나타냈습니다.' : '물고기의 위치를 알 수 있도록 모형 그림은 남겨 두었습니다. 실제로 보이는지와 모형에 그려진 것은 구별하세요.');
}
function seeingRecord3() {
  const s=seeingLesson.s3;
  const row=[String(s.eyeX),String(s.depth),s.light ? '켜짐' : '꺼짐',s.light ? '굴절 → 반사 → 굴절' : '눈에 들어오는 빛 없음'];
  const duplicate = seeingLesson.records3.some(r=>r.join('|')===row.join('|'));
  if (duplicate) { seeingText('seeing-record-hint3','이미 기록한 조건입니다. 눈의 위치나 물고기 깊이를 바꾸어 보세요.'); return; }
  seeingLesson.records3.push(row); seeingRenderTable('seeing-records3',seeingLesson.records3);
  seeingText('seeing-record-hint3','기록했습니다. 숫자는 모형 위치를 구별하는 값이며 실제 거리 단위는 아닙니다. 경로의 모양은 학습지에 그리세요.');
}
const seeingOrderItems = {source:'광원',into:'공기 → 물 경계 · 굴절',fish:'물고기 · 반사',out:'물 → 공기 경계 · 굴절',eye:'눈'};
function seeingPickOrder(key) {
  if (!(key in seeingOrderItems) || seeingLesson.order.includes(key)) return;
  seeingLesson.order.push(key); seeingRenderOrder();
}
function seeingUndoOrder() { seeingLesson.order.pop(); seeingRenderOrder(); }
function seeingResetOrder() { seeingLesson.order=[]; seeingRenderOrder(); }
function seeingRenderOrder() {
  seeingEl('seeing-order').replaceChildren();
  seeingLesson.order.forEach(key=> { const li=document.createElement('li'); li.textContent=seeingOrderItems[key]; seeingEl('seeing-order').appendChild(li); });
  document.querySelectorAll('[data-seeing-order]').forEach(button=> {button.disabled=seeingLesson.order.includes(button.dataset.seeingOrder);});
  seeingText('seeing-order-feedback',seeingLesson.order.length ? '선택한 순서대로 빛의 이동을 설명해 보세요.' : '빛의 출발점부터 도착점까지 아래 카드를 차례로 누르세요.');
}
function seeingCheckOrder() {
  const correct=['source','into','fish','out','eye'];
  if (seeingLesson.order.length!==5) { seeingText('seeing-order-feedback','다섯 카드를 모두 골라 경로를 완성하세요.'); return; }
  const mismatch=seeingLesson.order.findIndex((v,i)=>v!==correct[i]);
  seeingText('seeing-order-feedback',mismatch===-1 ? '경로를 완성했습니다! 두 경계에서는 굴절, 물고기에서는 반사입니다. 이 순서로 학습지에 화살표를 그리세요.' : `${mismatch+1}번째 위치부터 다시 생각해 보세요. 빛은 광원에서 출발하며, 물고기에 닿기 전 물속으로 들어가야 합니다. ‘한 칸 되돌리기’로 수정할 수 있습니다.`);
}
function seeingPointAlong(points,fraction) {
  const lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y));
  let target=lengths.reduce((sum,v)=>sum+v,0)*fraction;
  for (let i=0;i<lengths.length;i++) {
    if (target<=lengths[i] || i===lengths.length-1) { const t=lengths[i] ? target/lengths[i] : 0; return {x:points[i].x+(points[i+1].x-points[i].x)*t,y:points[i].y+(points[i+1].y-points[i].y)*t}; }
    target-=lengths[i];
  }
  return points[0] || {x:0,y:0};
}
function seeingAnimationFrame(time) {
  if (!seeingEl('seeing-scene2')) { seeingLesson.running=false; return; }
  const reduced=window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  [2,3].forEach(step=> {
    const s=seeingLesson['s'+step],dot=seeingEl('seeing-dot'+step);
    if (!dot) return;
    const active = currentActiveStep===step && !document.hidden && s.playing && s.rays && s.points.length>1 && !reduced;
    dot.setAttribute('visibility',active ? 'visible' : 'hidden');
    if (active) { const p=seeingPointAlong(s.points,(time%3600)/3600); dot.setAttribute('cx',p.x); dot.setAttribute('cy',p.y); }
  });
  requestAnimationFrame(seeingAnimationFrame);
}
function animStep2() { if (!seeingLesson.running) { seeingLesson.running=true; requestAnimationFrame(seeingAnimationFrame); } }
function animStep3() { animStep2(); }
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
