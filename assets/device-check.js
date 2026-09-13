/* Local device diagnostics only. No fetch, recording, local storage, or telemetry. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const drawing = byId('drawingCanvas'), wave = byId('waveCanvas'), rotation = byId('rotationCanvas');
  const drawingContext = drawing.getContext('2d'), waveContext = wave.getContext('2d'), rotationContext = rotation.getContext('2d');
  const report = {pointerSupported: 'PointerEvent' in window, inputTypes: new Set(), penPressureMin: null, penPressureMax: null, strokeCount: 0, mic: '미실시', micPeak: 0, rotationTouched: false, rotationFrames: 0, rotationElapsed: 0};
  let tool = 'pen', drawingPointer = null, currentStroke = null, strokes = [];
  let micStream = null, audioContext = null, analyser = null, waveform = null, micFrame = 0, micTimer = 0, micGeneration = 0;
  let rotationFrame = 0, rotating = false, angle = 25, rotationPointer = null, dragX = 0, previousTime = 0;
  const dimensions = canvas => ({width: canvas.clientWidth, height: canvas.clientHeight});
  function sizeCanvas(canvas) {
    const {width, height} = dimensions(canvas), dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.max(1, Math.round(width * dpr)); canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function point(event) {
    const bounds = drawing.getBoundingClientRect();
    return {x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)), pressure: event.pressure || 0.5};
  }
  function segment(stroke, from, to) {
    if (!drawingContext) return;
    const {width, height} = dimensions(drawing);
    drawingContext.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    drawingContext.strokeStyle = '#7dd3fc'; drawingContext.lineCap = 'round'; drawingContext.lineJoin = 'round';
    drawingContext.lineWidth = stroke.tool === 'eraser' ? 27 : stroke.type === 'pen' ? 1.5 + to.pressure * 6 : 3;
    drawingContext.beginPath(); drawingContext.moveTo(from.x * width, from.y * height); drawingContext.lineTo(to.x * width + 0.01, to.y * height + 0.01); drawingContext.stroke();
  }
  function redraw() {
    if (!drawingContext) return;
    drawingContext.clearRect(0, 0, drawing.clientWidth, drawing.clientHeight);
    for (const stroke of strokes) { if (stroke.points[0]) segment(stroke, stroke.points[0], stroke.points[0]); for (let i = 1; i < stroke.points.length; i++) segment(stroke, stroke.points[i - 1], stroke.points[i]); }
  }
  function describePointer(event) {
    report.inputTypes.add(event.pointerType || '알 수 없음');
    if (event.pointerType === 'pen') { report.penPressureMin = Math.min(report.penPressureMin ?? 1, event.pressure); report.penPressureMax = Math.max(report.penPressureMax ?? 0, event.pressure); }
    byId('penSupport').textContent = '입력 감지됨';
    byId('pointerInfo').textContent = `입력: ${{pen: '펜', touch: '터치', mouse: '마우스'}[event.pointerType] || event.pointerType} · 현재 필압: ${Number(event.pressure || 0).toFixed(2)} · 그린 횟수: ${report.strokeCount}`;
  }
  drawing.addEventListener('pointerdown', event => {
    if (!drawingContext || drawingPointer !== null || (event.pointerType === 'touch' && !byId('allowTouch').checked)) return;
    event.preventDefault(); drawingPointer = event.pointerId; drawing.setPointerCapture(event.pointerId);
    currentStroke = {tool, type: event.pointerType, points: [point(event)]}; strokes.push(currentStroke); report.strokeCount++;
    if (strokes.length > 300) { strokes.shift(); redraw(); }
    segment(currentStroke, currentStroke.points[0], currentStroke.points[0]); describePointer(event);
  });
  drawing.addEventListener('pointermove', event => {
    if (event.pointerId !== drawingPointer || !currentStroke) return;
    event.preventDefault(); const samples = event.getCoalescedEvents?.() || [event];
    for (const sample of samples.length ? samples : [event]) { const next = point(sample); segment(currentStroke, currentStroke.points.at(-1), next); currentStroke.points.push(next); if (currentStroke.points.length > 10000) currentStroke.points.splice(1, 1); }
    describePointer(event);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) drawing.addEventListener(name, event => { if (event.pointerId === drawingPointer) { drawingPointer = null; currentStroke = null; } });
  for (const [id, selected] of [['penTool', 'pen'], ['eraserTool', 'eraser']]) byId(id).addEventListener('click', () => { tool = selected; byId('penTool').setAttribute('aria-pressed', String(tool === 'pen')); byId('eraserTool').setAttribute('aria-pressed', String(tool === 'eraser')); });
  byId('clearDrawing').addEventListener('click', () => { strokes = []; drawingPointer = null; currentStroke = null; redraw(); });
  byId('penSupport').textContent = report.pointerSupported && drawingContext ? '입력 대기' : '이 브라우저에서 지원 확인 필요';

  function idleWave() {
    if (!waveContext) return;
    const {width, height} = dimensions(wave); waveContext.clearRect(0, 0, width, height); waveContext.strokeStyle = '#3a5873'; waveContext.lineWidth = 1;
    waveContext.beginPath(); waveContext.moveTo(0, height / 2); waveContext.lineTo(width, height / 2); waveContext.stroke();
  }
  function stopMic(reason = '마이크를 껐습니다.') {
    micGeneration++; cancelAnimationFrame(micFrame); clearTimeout(micTimer);
    micStream?.getTracks().forEach(track => track.stop()); micStream = null;
    if (audioContext) audioContext.close().catch(() => {}); audioContext = null; analyser = null; waveform = null;
    byId('startMic').disabled = false; byId('stopMic').disabled = true; byId('micBadge').textContent = '꺼짐'; byId('micInfo').textContent = reason; idleWave();
  }
  function drawWave() {
    if (!analyser || !waveform || !waveContext) return;
    analyser.getByteTimeDomainData(waveform); const {width, height} = dimensions(wave);
    waveContext.clearRect(0, 0, width, height); waveContext.strokeStyle = '#67e8f9'; waveContext.lineWidth = 2; waveContext.beginPath(); let peak = 0;
    for (let i = 0; i < waveform.length; i++) { const amplitude = (waveform[i] - 128) / 128, x = i / (waveform.length - 1) * width, y = height / 2 + amplitude * height * .45; peak = Math.max(peak, Math.abs(amplitude)); if (!i) waveContext.moveTo(x, y); else waveContext.lineTo(x, y); }
    waveContext.stroke(); report.micPeak = Math.max(report.micPeak, peak); micFrame = requestAnimationFrame(drawWave);
  }
  byId('startMic').addEventListener('click', async () => {
    if (!navigator.mediaDevices?.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) { report.mic = '지원되지 않음'; byId('micInfo').textContent = 'HTTPS로 연 최신 브라우저에서 마이크 지원을 확인해 주세요.'; return; }
    const generation = ++micGeneration; byId('startMic').disabled = true; byId('stopMic').disabled = false; byId('micBadge').textContent = '허용 대기'; byId('micInfo').textContent = '브라우저의 마이크 사용 허용을 기다리고 있습니다.';
    try {
      const localContext = new (window.AudioContext || window.webkitAudioContext)(); audioContext = localContext;
      const resume = localContext.resume().then(() => true, () => false);
      const stream = await navigator.mediaDevices.getUserMedia({audio: true, video: false});
      if (generation !== micGeneration || document.hidden) { stream.getTracks().forEach(track => track.stop()); return; }
      micStream = stream;
      micTimer = setTimeout(() => stopMic('60초가 지나 마이크를 자동으로 껐습니다.'), 60000);
      const resumed = await resume;
      if (generation !== micGeneration || document.hidden) return;
      if (!resumed) throw new Error('AUDIO_CONTEXT_UNAVAILABLE');
      analyser = localContext.createAnalyser(); analyser.fftSize = 2048; waveform = new Uint8Array(analyser.fftSize);
      localContext.createMediaStreamSource(stream).connect(analyser); // Intentionally no speaker output and no recorder.
      report.mic = '마이크 연결 성공'; byId('micBadge').textContent = '켜짐'; byId('micInfo').textContent = '소리를 내며 파형 변화를 확인하세요. 마이크 끄기로 바로 중지할 수 있습니다.'; drawWave();
      stream.getTracks().forEach(track => track.addEventListener('ended', () => { if (generation === micGeneration) stopMic('마이크 연결이 종료되었습니다.'); }));
    } catch (error) { if (generation !== micGeneration) return; report.mic = error.name === 'NotAllowedError' ? '권한 거부' : error.name === 'NotFoundError' ? '입력 기기 없음' : '마이크 연결 실패'; stopMic(report.mic + ' · 브라우저의 사이트 권한과 연결된 마이크를 확인해 주세요.'); }
  });
  byId('stopMic').addEventListener('click', () => stopMic());

  const vertices = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
  const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  function drawRotation() {
    if (!rotationContext) { byId('rotationBadge').textContent = 'Canvas 2D 지원 확인 필요'; return; }
    const {width,height} = dimensions(rotation), radians = angle * Math.PI / 180, scale = Math.min(width,height) * .28;
    rotationContext.clearRect(0,0,width,height);
    const projected = vertices.map(([x,y,z]) => { const rx = x * Math.cos(radians) + z * Math.sin(radians), rz = z * Math.cos(radians) - x * Math.sin(radians), ry = y * Math.cos(.45) - rz * Math.sin(.45), depth = y * Math.sin(.45) + rz * Math.cos(.45), perspective = 4 / (4 + depth); return [width / 2 + rx * scale * perspective,height / 2 + ry * scale * perspective,depth]; });
    for (const [a,b] of edges) { rotationContext.strokeStyle = projected[a][2] + projected[b][2] > 0 ? '#476a8b' : '#7dd3fc'; rotationContext.lineWidth = 3; rotationContext.beginPath(); rotationContext.moveTo(projected[a][0],projected[a][1]); rotationContext.lineTo(projected[b][0],projected[b][1]); rotationContext.stroke(); }
    for (const [x,y] of projected) { rotationContext.fillStyle = '#e0f2fe'; rotationContext.beginPath(); rotationContext.arc(x,y,4,0,Math.PI*2); rotationContext.fill(); }
    byId('rotationAngle').value = String(Math.round(angle)); byId('angleValue').textContent = Math.round(angle) + '°';
  }
  function animate(time) { if (!rotating) return; if (previousTime) { const elapsed = time - previousTime; angle = (angle + Math.min(elapsed,100) * .025) % 360; report.rotationFrames++; report.rotationElapsed += elapsed; } previousTime = time; drawRotation(); rotationFrame = requestAnimationFrame(animate); }
  function stopRotation() { rotating = false; previousTime = 0; cancelAnimationFrame(rotationFrame); byId('toggleRotation').textContent = '자동 회전 시작'; byId('toggleRotation').setAttribute('aria-pressed','false'); }
  byId('rotationAngle').addEventListener('input', event => { angle = Number(event.target.value); report.rotationTouched = true; byId('rotationBadge').textContent = '각도 조절 감지됨'; drawRotation(); });
  byId('toggleRotation').addEventListener('click', () => { if (rotating) { stopRotation(); return; } rotating = true; report.rotationTouched = true; byId('toggleRotation').textContent = '자동 회전 멈춤'; byId('toggleRotation').setAttribute('aria-pressed','true'); byId('rotationBadge').textContent = '회전 중'; rotationFrame = requestAnimationFrame(animate); });
  rotation.addEventListener('pointerdown', event => { if (rotationPointer !== null) return; event.preventDefault(); rotationPointer = event.pointerId; dragX = event.clientX; rotation.setPointerCapture(event.pointerId); });
  rotation.addEventListener('pointermove', event => { if (rotationPointer !== event.pointerId) return; angle = (angle + (event.clientX - dragX) * .6 + 360) % 360; dragX = event.clientX; report.rotationTouched = true; byId('rotationBadge').textContent = '드래그 감지됨'; drawRotation(); });
  for (const name of ['pointerup','pointercancel','lostpointercapture']) rotation.addEventListener(name,event => { if (event.pointerId === rotationPointer) rotationPointer = null; });
  function resize() { for (const canvas of [drawing,wave,rotation]) sizeCanvas(canvas); redraw(); if (!analyser) idleWave(); drawRotation(); }
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopMic('화면을 떠나 마이크를 자동으로 껐습니다.'); stopRotation(); } });
  window.addEventListener('pagehide', () => { stopMic(); stopRotation(); });
  byId('copyReport').addEventListener('click', async () => {
    const pressure = report.penPressureMin == null ? '펜 입력 미실시' : `${report.penPressureMin.toFixed(2)}~${report.penPressureMax.toFixed(2)}`;
    const fps = report.rotationElapsed > 1000 ? (report.rotationFrames / report.rotationElapsed * 1000).toFixed(1) : '자동 회전 1초 이상 확인 필요';
    const text = ['과학 플랫폼 기기 점검', `화면: ${window.innerWidth}×${window.innerHeight}`, `Pointer Events: ${report.pointerSupported ? '지원' : '미지원'}`, `입력 종류: ${[...report.inputTypes].join(', ') || '미실시'}`, `펜 필압 범위: ${pressure}`, `필기 직접 확인: ${byId('penConfirmed').checked ? '확인함' : '미확인'}`, `마이크: ${report.mic} / 최대 파형 크기 ${report.micPeak.toFixed(3)}`, `파형 직접 확인: ${byId('micConfirmed').checked ? '확인함' : '미확인'}`, `Canvas 2D 회전: ${report.rotationTouched ? '조작함' : '미실시'} / 관측 FPS ${fps}`, `회전 직접 확인: ${byId('rotationConfirmed').checked ? '확인함' : '미확인'}`, `메모: ${byId('deviceNotes').value.trim() || '없음'}`, '이 결과는 실제 사용자의 점검이며 모든 수업 실험의 동작을 자동 보증하지 않습니다.'].join('\n');
    try { await navigator.clipboard.writeText(text); byId('copyStatus').textContent = '복사했습니다. 대화에 붙여 넣어 주세요.'; }
    catch { const fallback = byId('reportFallback'); fallback.hidden = false; fallback.value = text; fallback.focus(); fallback.select(); byId('copyStatus').textContent = '아래 결과를 길게 눌러 복사하거나 Ctrl+C를 눌러 주세요.'; }
  });
  resize();
})();
