window.addEventListener('lesson-step-change', event => { const stepNum = event.detail;

            if (stepNum === 2) updateStep2Sim();
            if (stepNum === 3) updateStep3Data();
            
});
        
        
        
        

        
/* ML:EDIT:QUIZ_DATA:END */;

        

        

/* ML:EDIT:SIMULATION_JS:START */
// 짧은 비교·적용 활동. 두 대표 거리로 상을 비교하며 활동 응답을 저장하지 않습니다.
const opticLesson = {
  initialized2: false, initialized3: false,
  s2: {model: null},
  s3: {caseKey: '', caseIndex: 0}
};
const opticDevices = {
  planemirror: {name: '평면거울', description: '빛을 반사하며 실제 물체와 같은 크기의 상을 만듭니다.'},
  convexmirror: {name: '볼록 거울', f: -1, description: '빛을 반사하며 바로 선 작은 상을 만들고 넓은 범위를 볼 수 있습니다.'},
  concavemirror: {name: '오목 거울', f: 1, description: '아주 가까운 물체는 바로 선 큰 상으로 보입니다. 충분히 멀리 놓으면 작고 거꾸로 선 상을 만듭니다.'},
  convexlens: {name: '볼록 렌즈', f: 1, description: '빛을 모으는 렌즈입니다. 가까운 물체는 바로 선 큰 상으로, 충분히 먼 물체는 작고 거꾸로 선 상으로 보입니다.'},
  concavelens: {name: '오목 렌즈', f: -1, description: '빛을 퍼뜨리는 렌즈이며 바로 선 작은 상을 만듭니다.'}
};
const opticCases = {
  fullmirror: {title: '🪞 전신 거울', description: '옷차림을 살펴보려고 합니다. 실제와 같은 크기의 상을 비추려면?', device: 'planemirror', hint: '확대하거나 축소하지 않고, 빛을 반사하는 도구를 찾아보세요.', explanation: '평면거울은 실제 물체와 같은 크기의 상을 만듭니다.'},
  road: {title: '🚗 굽은 도로의 거울', description: '모퉁이 너머의 차량을 확인해야 합니다. 작게 보여도 넓은 범위를 한눈에 보려면?', device: 'convexmirror', hint: '바로 선 작은 상을 만들고 넓은 범위를 비추는 거울이 필요합니다.', explanation: '볼록 거울은 바로 선 작은 상을 만들며 넓은 범위를 비춥니다. 도로에서는 넓게 보는 성질이 도움이 됩니다.'},
  detailmirror: {title: '🔍 거울로 작은 무늬 확대하기', description: '작은 모형을 거울에 아주 가까이 댑니다. 비친 무늬를 바로 선 큰 상으로 보려면?', device: 'concavemirror', hint: '아주 가까운 물체를 크게 비추는 거울을 찾아보세요.', explanation: '오목 거울에 물체를 아주 가까이 두면 바로 선 큰 상이 생깁니다. 충분히 멀리 두면 작고 거꾸로 선 상이 됩니다.'},
  magnifier: {title: '🍃 돋보기로 잎맥 보기', description: '잎을 렌즈에 가까이 대고 들여다봅니다. 잎맥을 바로 선 큰 상으로 보려면?', device: 'convexlens', hint: '빛을 통과시키며, 가까운 물체를 확대하는 렌즈가 필요합니다.', explanation: '볼록 렌즈 가까이에 물체를 두면 바로 선 큰 상이 생깁니다. 돋보기는 이 성질을 이용합니다.'},
  myopia: {title: '👓 근시 교정용 안경', description: '근시를 교정하려면 눈에 들어가기 전의 빛을 퍼뜨려야 합니다. 어떤 렌즈를 쓸까요?', device: 'concavelens', hint: '가운데가 얇고 빛을 퍼뜨리는 렌즈를 찾아보세요.', explanation: '오목 렌즈는 빛을 퍼뜨려 근시를 교정합니다. 안경은 눈 안에서 상이 알맞게 맺히도록 돕습니다.'},
  hyperopia: {title: '👓 원시 교정용 안경', description: '원시를 교정하려면 눈에 들어가기 전의 빛을 모아 주어야 합니다. 어떤 렌즈를 쓸까요?', device: 'convexlens', hint: '가운데가 두껍고 빛을 모으는 렌즈를 찾아보세요.', explanation: '볼록 렌즈는 빛을 모아 원시를 교정합니다. 안경은 눈 안에서 상이 알맞게 맺히도록 돕습니다.'}
};
function opticEl(id) { return document.getElementById(id); }
function opticText(id, value) { const element = opticEl(id); if (element) element.textContent = value; }
function opticSvgNode(parent, tag, attributes, label) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attributes || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (label !== undefined) node.textContent = label;
  parent.appendChild(node);
  return node;
}
function opticLabel(parent, x, y, label, className) {
  return opticSvgNode(parent, 'text', {x, y, 'class': className || 'optic-scene-label'}, label);
}
function opticFlag(parent, x, y, magnitude, direction, color) {
  const group = opticSvgNode(parent, 'g', {transform: 'translate(' + x + ' ' + y + ') scale(' + magnitude + ' ' + (direction * magnitude) + ')'});
  opticSvgNode(group, 'path', {d: 'M-5 0 V-53 H-14 L0 -72 L14 -53 H5 V0 Z', fill: color});
  opticSvgNode(group, 'path', {d: 'M5 -49 H27 L21 -40 L27 -31 H5 Z', fill: color, opacity: '.8'});
  opticSvgNode(group, 'circle', {cx: -14, cy: -15, r: 5, fill: color});
  return group;
}
function opticTool(parent, type, x, y) {
  const group = opticSvgNode(parent, 'g', {transform: 'translate(' + x + ' ' + y + ')'});
  if (type === 'convexmirror' || type === 'concavemirror') {
    const bend = type === 'convexmirror' ? -43 : 43;
    opticSvgNode(group, 'path', {d: 'M8 -58 Q' + (bend + 8) + ' 0 8 58', fill: 'none', stroke: '#64748b', 'stroke-width': 13});
    opticSvgNode(group, 'path', {d: 'M0 -58 Q' + bend + ' 0 0 58', fill: 'none', stroke: '#7dd3fc', 'stroke-width': 5});
  } else {
    const path = type === 'convexlens' ? 'M0 -58 Q-41 0 0 58 Q41 0 0 -58 Z' : 'M-24 -58 Q-3 0 -24 58 L24 58 Q3 0 24 -58 Z';
    opticSvgNode(group, 'path', {d: path, fill: '#38bdf833', stroke: '#7dd3fc', 'stroke-width': 3});
  }
}
function opticModel(type, distance) {
  const safeType = ['convexmirror', 'concavemirror', 'convexlens', 'concavelens'].includes(type) ? type : 'convexmirror';
  const safeDistance = distance === 'far' ? 'far' : 'near';
  const device = opticDevices[safeType], d = safeDistance === 'near' ? 0.6 : 3;
  const m = device.f / (device.f - d), magnitude = Math.abs(m);
  const direction = m > 0 ? 'upright' : 'inverted';
  const size = magnitude < 1 - 1e-8 ? 'smaller' : magnitude > 1 + 1e-8 ? 'larger' : 'same';
  return {type: safeType, distance: safeDistance, d, f: device.f, m, magnitude, direction, size};
}
function opticDirectionName(direction) { return direction === 'upright' ? '바로 선 상' : '거꾸로 선 상'; }
function opticSizeName(size) { return size === 'smaller' ? '물체보다 작다' : size === 'larger' ? '물체보다 크다' : '물체와 같다'; }
function opticDistanceName(distance) { return distance === 'near' ? '아주 가까이' : '충분히 멀리'; }
function opticDrawComparison2(model) {
  const svg = opticEl('optic-comparison2');
  svg.replaceChildren();
  const description = '물체와 같은 척도로 비교한 상: ' + opticDirectionName(model.direction) + ', ' + opticSizeName(model.size);
  svg.setAttribute('aria-label', description);
  opticSvgNode(svg, 'title', {}, description);
  opticLabel(svg, 170, 32, '실제 물체');
  opticLabel(svg, 550, 32, '거울·렌즈가 만든 상');
  [170, 550].forEach(x => {
    opticSvgNode(svg, 'line', {x1: x - 116, y1: 240, x2: x + 116, y2: 240, stroke: '#64748b', 'stroke-width': 2});
    opticSvgNode(svg, 'line', {x1: x - 116, y1: 168, x2: x + 116, y2: 168, stroke: '#475569', 'stroke-width': 1, 'stroke-dasharray': '5 5'});
  });
  opticFlag(svg, 170, 240, 1, 1, '#fbbf24');
  const image = opticFlag(svg, 550, 240, model.magnitude, model.direction === 'upright' ? 1 : -1, '#38bdf8');
  image.setAttribute('data-optic-image', 'true');
  image.setAttribute('data-magnification', String(model.m));
  opticSvgNode(svg, 'rect', {x: 300, y: 84, width: 110, height: 164, rx: 16, fill: '#0f172a', stroke: '#334155'});
  opticTool(svg, model.type, 355, 163);
  opticLabel(svg, 355, 273, opticDevices[model.type].name, 'optic-scene-note');
  opticLabel(svg, 170, 311, '물체 크기는 그대로', 'optic-scene-note');
  opticLabel(svg, 550, 311, opticDirectionName(model.direction), 'optic-scene-key');
}
function initStep2() {
  if (opticLesson.initialized2 || !opticEl('optic-device2')) return;
  opticLesson.initialized2 = true;
  updateStep2Sim();
}
function animStep2() {}
function updateStep2Sim() {
  if (!opticEl('optic-device2')) return;
  const model = opticModel(opticEl('optic-device2').value, opticEl('optic-distance2').value);
  opticLesson.s2.model = model;
  opticDrawComparison2(model);
  opticText('optic-result2', opticDevices[model.type].name + ' · ' + opticDistanceName(model.distance) + ': ' + opticDirectionName(model.direction) + ', ' + opticSizeName(model.size));
}
function initStep3() {
  if (opticLesson.initialized3 || !opticEl('optic-case-title3')) return;
  opticLesson.initialized3 = true;
  updateStep3Data();
}
function animStep3() {}
function updateStep3Data() {
  if (!opticEl('optic-case-title3')) return;
  const selected = Object.keys(opticCases)[opticLesson.s3.caseIndex];
  const key = Object.prototype.hasOwnProperty.call(opticCases, selected) ? selected : 'fullmirror';
  const item = opticCases[key];
  if (opticLesson.s3.caseKey !== key) {
    opticLesson.s3.caseKey = key;
    document.querySelectorAll('#ml-step3-content .optic-tool-choice').forEach(button => button.setAttribute('aria-pressed', 'false'));
    opticEl('optic-result3').removeAttribute('data-correct');
    opticText('optic-result3', '어떤 도구가 알맞을까요?');
    opticText('optic-reason3', '');
  }
  opticText('optic-case-index3', '상황 ' + (opticLesson.s3.caseIndex + 1) + ' / ' + Object.keys(opticCases).length);
  opticText('optic-case-title3', item.title);
  opticText('optic-case-description3', item.description);
}
function opticChoose3(selectedDevice) {
  if (!Object.prototype.hasOwnProperty.call(opticDevices, selectedDevice)) return;
  if (!opticLesson.s3.caseKey) updateStep3Data();
  const item = opticCases[opticLesson.s3.caseKey];
  const correct = selectedDevice === item.device;
  document.querySelectorAll('#ml-step3-content .optic-tool-choice').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.device === selectedDevice)));
  opticEl('optic-result3').dataset.correct = String(correct);
  if (correct) {
    opticText('optic-result3', '해결! 알맞은 도구는 ' + opticDevices[selectedDevice].name + '입니다.');
    opticText('optic-reason3', item.explanation);
  } else {
    opticText('optic-result3', '한 번 더 골라 볼까요?');
    opticText('optic-reason3', item.hint);
  }
}
function opticNextCase3() {
  const cases = Object.keys(opticCases);
  const next = (cases.indexOf(opticLesson.s3.caseKey) + 1) % cases.length;
  opticLesson.s3.caseIndex = next;
  updateStep3Data();
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
