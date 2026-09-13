window.addEventListener('lesson-step-change', event => { const stepNum = event.detail;

            if (stepNum === 2) updateStep2Sim();
            if (stepNum === 3) updateStep3Data();
            
});
        
        
        
        

        

        

        

        // ==========================================
        // STEP 2: 도선 굵기/길이 & 저항 시뮬레이션
        // ==========================================
        const canvas2 = document.getElementById('simCanvas2');
        const ctx2 = canvas2.getContext('2d');
        let electrons2 = [];
        let showGraphVI = false;
        let showGraphRI = false;

        function toggleGraphVI() {
            showGraphVI = !showGraphVI;
            document.getElementById('graphToggleBtnVI').innerText = showGraphVI ? "🙈 전압-전류 그래프 감추기" : "📊 전압-전류 그래프 보이기";
            updateCanvas2Height();
        }

        function toggleGraphRI() {
            showGraphRI = !showGraphRI;
            document.getElementById('graphToggleBtnRI').innerText = showGraphRI ? "🙈 저항-전류 그래프 감추기" : "📊 저항-전류 그래프 보이기";
            updateCanvas2Height();
        }

        function updateCanvas2Height() {
            let h = 220;
            if (showGraphVI) h += 380;
            if (showGraphRI) h += 380;
            canvas2.height = h;
            updateStep2Sim();
        }

        function initStep2() {
            electrons2 = [];
            for (let i = 0; i < 30; i++) {
                electrons2.push({
                    x: Math.random() * 200 + 100,
                    y: Math.random() * 40 + 80,
                    vx: (Math.random() - 0.5) * 1.5,
                    vy: (Math.random() - 0.5) * 1.5
                });
            }
            updateStep2Sim();
        }

        function updateStep2Sim() {
            const lenStep = parseInt(document.getElementById('step2Length').value);
            const thickStep = parseInt(document.getElementById('step2Thick').value);
            const voltVal = parseFloat(document.getElementById('step2Voltage').value);

            document.getElementById('lenVal').innerText = `x${lenStep}`;
            document.getElementById('thickVal').innerText = `x${thickStep}`;
            document.getElementById('voltVal2').innerText = voltVal.toFixed(1) + " V";

            const resistance = 10 * (lenStep / thickStep);
            const currentA = voltVal / resistance;
            const currentmA = currentA * 1000;

            document.getElementById('s2ResistLabel').innerText = `${resistance.toFixed(1)} Ω`;
            document.getElementById('s2CurrentLabel').innerText = `${Math.round(currentmA)} mA (${currentA.toFixed(2)} A)`;
        }

        function animStep2() {
            if (document.getElementById('step2').classList.contains('active')) {
                ctx2.clearRect(0, 0, canvas2.width, canvas2.height);

                const lenStep = parseInt(document.getElementById('step2Length').value);
                const thickStep = parseInt(document.getElementById('step2Thick').value);
                const voltVal = parseFloat(document.getElementById('step2Voltage').value);
                const resistance = 10 * (lenStep / thickStep);

                const wireWidth = 150 + lenStep * 120;
                const wireHeight = 25 + thickStep * 20;
                const startX = (850 - wireWidth) / 2;
                const startY = 110 - wireHeight / 2;

                ctx2.fillStyle = "#1e293b"; ctx2.fillRect(15, 15, 820, 190);
                ctx2.strokeStyle = "#334155"; ctx2.lineWidth = 2; ctx2.strokeRect(15, 15, 820, 190);

                ctx2.fillStyle = "#0f172a"; ctx2.fillRect(startX, startY, wireWidth, wireHeight);
                ctx2.strokeStyle = "#38bdf8"; ctx2.lineWidth = 3; ctx2.strokeRect(startX, startY, wireWidth, wireHeight);

                const driftSpeed = (voltVal / resistance) * 1.5;

                electrons2.forEach(e => {
                    e.vx += (Math.random() - 0.5) * 0.4;
                    e.vy += (Math.random() - 0.5) * 0.4;

                    e.vx = Math.max(-1.2, Math.min(1.2, e.vx));
                    e.vy = Math.max(-1.2, Math.min(1.2, e.vy));

                    e.x += e.vx + driftSpeed;
                    e.y += e.vy;

                    if (e.y < startY + 6) { e.y = startY + 6; e.vy *= -1; }
                    if (e.y > startY + wireHeight - 6) { e.y = startY + wireHeight - 6; e.vy *= -1; }

                    if (e.x > startX + wireWidth - 6) {
                        e.x = startX + 6;
                        e.y = startY + Math.random() * (wireHeight - 12) + 6;
                    }
                    if (e.x < startX + 6) e.x = startX + 6;

                    ctx2.fillStyle = "#38bdf8";
                    ctx2.beginPath(); ctx2.arc(e.x, e.y, 4, 0, Math.PI * 2); ctx2.fill();
                });

                let gyOffset = 220;

                // 전압-전류 관계 그래프
                if (showGraphVI) {
                    const gx = 15, gy = gyOffset, gw = 820, gh = 360;
                    ctx2.fillStyle = "#1e293b"; ctx2.fillRect(gx, gy, gw, gh);
                    ctx2.strokeStyle = "#38bdf8"; ctx2.lineWidth = 1.5; ctx2.strokeRect(gx, gy, gw, gh);

                    ctx2.fillStyle = "#38bdf8"; ctx2.font = "bold 14px sans-serif"; ctx2.textAlign = "left";
                    ctx2.fillText("📊 [ 전압 - 전류 관계 그래프 ] (저항이 일정할 때)", gx + 25, gy + 35);

                    const ox = gx + 80, oy = gy + 290;
                    const axisW = 680; 
                    const axisH = 220; 

                    ctx2.strokeStyle = "#cbd5e1"; ctx2.lineWidth = 2;
                    ctx2.beginPath();
                    ctx2.moveTo(ox, oy); ctx2.lineTo(ox + axisW, oy);
                    ctx2.moveTo(ox, oy); ctx2.lineTo(ox, oy - axisH);
                    ctx2.stroke();

                    ctx2.fillStyle = "#cbd5e1"; ctx2.font = "12px sans-serif"; ctx2.textAlign = "center";
                    const maxV = 9.0;
                    for (let vStep = 0.0; vStep <= 9.0; vStep += 1.5) {
                        const tickX = ox + (vStep / maxV) * (axisW - 40);
                        ctx2.strokeStyle = "#64748b"; ctx2.lineWidth = 1;
                        ctx2.beginPath(); ctx2.moveTo(tickX, oy); ctx2.lineTo(tickX, oy + 6); ctx2.stroke();
                        ctx2.fillText(`${vStep.toFixed(1)}V`, tickX, oy + 22);
                    }
                    ctx2.font = "bold 12px sans-serif";
                    ctx2.fillText("전압 (V)", ox + axisW - 10, oy + 42);

                    ctx2.textAlign = "right"; ctx2.font = "12px sans-serif";
                    const maxI = 4.0;
                    for (let iStep = 0; iStep <= maxI; iStep += 1.0) {
                        const tickY = oy - (iStep / maxI) * axisH;
                        ctx2.strokeStyle = "#64748b"; ctx2.lineWidth = 1;
                        ctx2.beginPath(); ctx2.moveTo(ox - 6, tickY); ctx2.lineTo(ox, tickY); ctx2.stroke();
                        ctx2.fillText(`${iStep.toFixed(1)}A`, ox - 10, tickY + 4);
                    }
                    ctx2.font = "bold 12px sans-serif";
                    ctx2.fillText("전류 (A)", ox - 10, oy - axisH - 12);

                    const curI = voltVal / resistance;
                    const endV = 9.0;
                    const endI = endV / resistance;

                    const lineEndX = ox + (endV / maxV) * (axisW - 40);
                    const lineEndY = oy - (endI / maxI) * axisH;

                    if (lineEndX >= ox) {
                        ctx2.strokeStyle = "#f59e0b"; ctx2.lineWidth = 2.5;
                        ctx2.beginPath(); ctx2.moveTo(ox, oy); ctx2.lineTo(lineEndX, lineEndY); ctx2.stroke();
                    }

                    const curX = ox + (voltVal / maxV) * (axisW - 40);
                    const curY = oy - (curI / maxI) * axisH;

                    ctx2.setLineDash([4, 4]);
                    ctx2.strokeStyle = "#38bdf8"; ctx2.lineWidth = 1.5;
                    ctx2.beginPath();
                    ctx2.moveTo(curX, oy); ctx2.lineTo(curX, curY); ctx2.lineTo(ox, curY);
                    ctx2.stroke();
                    ctx2.setLineDash([]);

                    ctx2.fillStyle = "#38bdf8"; 
                    ctx2.beginPath(); ctx2.arc(curX, curY, 7, 0, Math.PI * 2); ctx2.fill();
                    ctx2.strokeStyle = "#ffffff"; ctx2.lineWidth = 2; ctx2.stroke();
                    
                    gyOffset += 380;
                }

                // 저항-전류 관계 그래프
                if (showGraphRI) {
                    const gx = 15, gy = gyOffset, gw = 820, gh = 360;
                    ctx2.fillStyle = "#1e293b"; ctx2.fillRect(gx, gy, gw, gh);
                    ctx2.strokeStyle = "#38bdf8"; ctx2.lineWidth = 1.5; ctx2.strokeRect(gx, gy, gw, gh);

                    ctx2.fillStyle = "#38bdf8"; ctx2.font = "bold 14px sans-serif"; ctx2.textAlign = "left";
                    ctx2.fillText("📊 [ 저항 - 전류 관계 그래프 ] (전압이 일정할 때)", gx + 25, gy + 35);

                    const ox = gx + 80, oy = gy + 290;
                    const axisW = 680; 
                    const axisH = 220; 

                    ctx2.strokeStyle = "#cbd5e1"; ctx2.lineWidth = 2;
                    ctx2.beginPath();
                    ctx2.moveTo(ox, oy); ctx2.lineTo(ox + axisW, oy);
                    ctx2.moveTo(ox, oy); ctx2.lineTo(ox, oy - axisH);
                    ctx2.stroke();

                    ctx2.fillStyle = "#cbd5e1"; ctx2.font = "12px sans-serif"; ctx2.textAlign = "center";
                    const maxR = 40;
                    for (let rStep = 0; rStep <= 40; rStep += 10) {
                        const tickX = ox + (rStep / maxR) * (axisW - 40);
                        ctx2.strokeStyle = "#64748b"; ctx2.lineWidth = 1;
                        ctx2.beginPath(); ctx2.moveTo(tickX, oy); ctx2.lineTo(tickX, oy + 6); ctx2.stroke();
                        ctx2.fillText(`${rStep}Ω`, tickX, oy + 22);
                    }
                    ctx2.font = "bold 12px sans-serif";
                    ctx2.fillText("저항 (Ω)", ox + axisW - 10, oy + 42);

                    ctx2.textAlign = "right"; ctx2.font = "12px sans-serif";
                    const maxI = 4.0;
                    for (let iStep = 0; iStep <= maxI; iStep += 1.0) {
                        const tickY = oy - (iStep / maxI) * axisH;
                        ctx2.strokeStyle = "#64748b"; ctx2.lineWidth = 1;
                        ctx2.beginPath(); ctx2.moveTo(ox - 6, tickY); ctx2.lineTo(ox, tickY); ctx2.stroke();
                        ctx2.fillText(`${iStep.toFixed(1)}A`, ox - 10, tickY + 4);
                    }
                    ctx2.font = "bold 12px sans-serif";
                    ctx2.fillText("전류 (A)", ox - 10, oy - axisH - 12);

                    if (voltVal > 0) {
                        ctx2.strokeStyle = "#10b981"; ctx2.lineWidth = 2.5;
                        ctx2.beginPath();
                        let started = false;
                        for (let rPlot = 2.5; rPlot <= 40; rPlot += 0.5) {
                            let iPlot = voltVal / rPlot;
                            if (iPlot > maxI) continue;
                            let px = ox + (rPlot / maxR) * (axisW - 40);
                            let py = oy - (iPlot / maxI) * axisH;
                            if (!started) {
                                ctx2.moveTo(px, py);
                                started = true;
                            } else {
                                ctx2.lineTo(px, py);
                            }
                        }
                        ctx2.stroke();

                        const curX = ox + (resistance / maxR) * (axisW - 40);
                        const curY = oy - ((voltVal / resistance) / maxI) * axisH;

                        ctx2.setLineDash([4, 4]);
                        ctx2.strokeStyle = "#10b981"; ctx2.lineWidth = 1.5;
                        ctx2.beginPath();
                        ctx2.moveTo(curX, oy); ctx2.lineTo(curX, curY); ctx2.lineTo(ox, curY);
                        ctx2.stroke();
                        ctx2.setLineDash([]);

                        ctx2.fillStyle = "#10b981"; 
                        ctx2.beginPath(); ctx2.arc(curX, curY, 7, 0, Math.PI * 2); ctx2.fill();
                        ctx2.strokeStyle = "#ffffff"; ctx2.lineWidth = 2; ctx2.stroke();
                    }
                }
            }
            requestAnimationFrame(animStep2);
        }

        // ==========================================
        // STEP 3: 회로 & 그래프 시뮬레이션
        // ==========================================
        const canvas3 = document.getElementById('simCanvas3');
        const ctx3 = canvas3.getContext('2d');
        let showGraph3 = false;
        let electrons3 = [];
        let isDraggingBattery = false;

        function toggleGraph3() {
            showGraph3 = !showGraph3;
            document.getElementById('graphToggleBtn3').innerText = showGraph3 ? "🙈 그래프 감추기" : "📊 그래프 보이기";
            document.getElementById('allResGraphOption').style.display = showGraph3 ? 'block' : 'none';
        }

        function initStep3() {
            electrons3 = [];
            for (let i = 0; i < 24; i++) {
                electrons3.push({ pos: i * 30 });
            }
            
            canvas3.addEventListener('mousedown', onMouseDown3);
            canvas3.addEventListener('mousemove', onMouseMove3);
            canvas3.addEventListener('mouseup', () => isDraggingBattery = false);

            canvas3.addEventListener('touchstart', onTouchStart3, { passive: false });
            canvas3.addEventListener('touchmove', onTouchMove3, { passive: false });
            canvas3.addEventListener('touchend', () => isDraggingBattery = false);

            updateStep3Data();
        }

        function onMouseDown3(e) {
            const rect = canvas3.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            if (mx >= 40 && mx <= 240 && my >= 130 && my <= 310) {
                isDraggingBattery = true;
            }
        }

        function onMouseMove3(e) {
            if (!isDraggingBattery) return;
            const rect = canvas3.getBoundingClientRect();
            const my = e.clientY - rect.top;

            let newV = (280 - my) / 12;
            newV = Math.max(0, Math.min(9, newV));
            newV = Math.round(newV / 1.5) * 1.5;

            document.getElementById('voltageSlider3').value = newV;
            updateStep3Data();
        }

        function onTouchStart3(e) {
            const rect = canvas3.getBoundingClientRect();
            const touch = e.touches[0];
            const mx = touch.clientX - rect.left;
            const my = touch.clientY - rect.top;

            if (mx >= 40 && mx <= 240 && my >= 130 && my <= 310) {
                isDraggingBattery = true;
                e.preventDefault();
            }
        }

        function onTouchMove3(e) {
            if (!isDraggingBattery) return;
            const rect = canvas3.getBoundingClientRect();
            const touch = e.touches[0];
            const my = touch.clientY - rect.top;

            let newV = (280 - my) / 12;
            newV = Math.max(0, Math.min(9, newV));
            newV = Math.round(newV / 1.5) * 1.5;

            document.getElementById('voltageSlider3').value = newV;
            updateStep3Data();
            e.preventDefault();
        }

        function updateStep3Data() {
            const v = parseFloat(document.getElementById('voltageSlider3').value);
            document.getElementById('sliderVal3').innerText = v.toFixed(1) + " V";

            const selectedR = parseFloat(document.querySelector('input[name="resRadio"]:checked').value);
            const mainI = v / selectedR;
            document.getElementById('largeAmpVal').innerText = `${mainI.toFixed(2)} A`;
        }

        function animStep3() {
            if (document.getElementById('step3').classList.contains('active')) {
                ctx3.clearRect(0, 0, canvas3.width, canvas3.height);

                const v = parseFloat(document.getElementById('voltageSlider3').value);
                const selectedR = parseFloat(document.querySelector('input[name="resRadio"]:checked').value);
                const currentI = v / selectedR;

                const circuitWidth = showGraph3 ? 410 : 810;

                ctx3.fillStyle = "#1e293b"; ctx3.fillRect(15, 15, circuitWidth, 350);
                ctx3.strokeStyle = "#334155"; ctx3.lineWidth = 2; ctx3.strokeRect(15, 15, circuitWidth, 350);

                ctx3.fillStyle = "#38bdf8"; ctx3.font = "bold 13px sans-serif"; ctx3.textAlign = "left";
                ctx3.fillText("⚡ [ 실시간 작동 전기 회로 ]", 30, 42);

                const left = showGraph3 ? 65 : 150;
                const right = showGraph3 ? 340 : 650;
                const top = 85;
                const bottom = 295;
                const circuitLength = 2 * (right - left) + 2 * (bottom - top);

                ctx3.strokeStyle = "#475569"; ctx3.lineWidth = 6;
                ctx3.strokeRect(left, top, right - left, bottom - top);

                const batX = left;
                const batY = (top + bottom) / 2;
                
                ctx3.fillStyle = "#0f172a"; ctx3.fillRect(batX - 25, batY - 40, 50, 80);
                ctx3.strokeStyle = "#38bdf8"; ctx3.lineWidth = 2; ctx3.strokeRect(batX - 25, batY - 40, 50, 80);

                ctx3.fillStyle = "#ef4444"; ctx3.fillRect(batX - 20, batY - 35, 40, 30);
                ctx3.fillStyle = "#fff"; ctx3.font = "bold 16px sans-serif"; ctx3.textAlign = "center";
                ctx3.fillText("+", batX, batY - 15);

                ctx3.fillStyle = "#3b82f6"; ctx3.fillRect(batX - 20, batY + 5, 40, 30);
                ctx3.fillStyle = "#fff"; ctx3.fillText("-", batX, batY + 25);

                ctx3.fillStyle = "#f59e0b"; ctx3.font = "bold 12px sans-serif";
                ctx3.fillText(`${v.toFixed(1)} V`, batX, batY + 55);

                const resX = right;
                const resY = (top + bottom) / 2;
                ctx3.strokeStyle = "#f59e0b"; ctx3.lineWidth = 5;
                ctx3.beginPath();
                ctx3.moveTo(resX, resY - 30);
                ctx3.lineTo(resX - 10, resY - 20); ctx3.lineTo(resX + 10, resY - 10);
                ctx3.lineTo(resX - 10, resY); ctx3.lineTo(resX + 10, resY + 10);
                ctx3.lineTo(resX - 10, resY + 20); ctx3.lineTo(resX, resY + 30);
                ctx3.stroke();

                ctx3.fillStyle = "#f59e0b"; ctx3.textAlign = "center";
                ctx3.fillText(`${selectedR} Ω`, resX + (showGraph3 ? -35 : 45), resY);

                if (v > 0) {
                    const eSpeed = 2.0;
                    electrons3.forEach(e => {
                        e.pos = (e.pos + eSpeed) % circuitLength;
                        let ex = 0, ey = 0;

                        if (e.pos < (right - left) / 2) {
                            ex = left + (right - left) / 2 + e.pos; ey = bottom;
                        } else if (e.pos < (right - left) / 2 + (bottom - top)) {
                            ex = right; ey = bottom - (e.pos - (right - left) / 2);
                        } else if (e.pos < (right - left) * 1.5 + (bottom - top)) {
                            ex = right - (e.pos - ((right - left) / 2 + (bottom - top))); ey = top;
                        } else if (e.pos < (right - left) * 1.5 + 2 * (bottom - top)) {
                            ex = left; ey = top + (e.pos - ((right - left) * 1.5 + (bottom - top)));
                        } else {
                            ex = left + (e.pos - ((right - left) * 1.5 + 2 * (bottom - top))); ey = bottom;
                        }

                        ctx3.fillStyle = "#38bdf8";
                        ctx3.beginPath(); ctx3.arc(ex, ey, 5, 0, Math.PI * 2); ctx3.fill();
                    });
                }

                if (showGraph3) {
                    const gx = 440, gy = 15, gw = 395, gh = 350;
                    ctx3.fillStyle = "#1e293b"; ctx3.fillRect(gx, gy, gw, gh);
                    ctx3.strokeStyle = "#38bdf8"; ctx3.lineWidth = 1.5; ctx3.strokeRect(gx, gy, gw, gh);

                    ctx3.fillStyle = "#38bdf8"; ctx3.font = "bold 13px sans-serif"; ctx3.textAlign = "left";
                    ctx3.fillText("📊 [ 전압 - 전류 관계 그래프 ]", gx + 15, gy + 28);

                    const ox = gx + 50, oy = gy + 280;
                    const axisW = 270;
                    const axisH = 210;

                    ctx3.strokeStyle = "#cbd5e1"; ctx3.lineWidth = 1.5;
                    ctx3.beginPath();
                    ctx3.moveTo(ox, oy); ctx3.lineTo(ox + axisW + 20, oy);
                    ctx3.moveTo(ox, oy); ctx3.lineTo(ox, oy - axisH - 10);
                    ctx3.stroke();

                    ctx3.fillStyle = "#cbd5e1"; ctx3.font = "11px sans-serif"; ctx3.textAlign = "center";
                    for (let voltStep = 0; voltStep <= 9; voltStep += 1.5) {
                        const tickX = ox + (voltStep / 9) * axisW;
                        ctx3.strokeStyle = "#64748b"; ctx3.lineWidth = 1;
                        ctx3.beginPath(); ctx3.moveTo(tickX, oy); ctx3.lineTo(tickX, oy + 4); ctx3.stroke();
                        ctx3.fillText(`${voltStep}`, tickX, oy + 16);
                    }
                    ctx3.fillText("전압(V)", ox + axisW + 10, oy + 32);

                    ctx3.textAlign = "right";
                    const maxAxisI = 1.8;
                    for (let ampStep = 0; ampStep <= maxAxisI; ampStep += 0.4) {
                        const tickY = oy - (ampStep / maxAxisI) * axisH;
                        ctx3.strokeStyle = "#64748b"; ctx3.lineWidth = 1;
                        ctx3.beginPath(); ctx3.moveTo(ox - 4, tickY); ctx3.lineTo(ox, tickY); ctx3.stroke();
                        ctx3.fillText(`${ampStep.toFixed(1)}`, ox - 7, tickY + 4);
                    }
                    ctx3.fillText("전류(A)", ox - 5, oy - axisH - 12);

                    const showAll = document.getElementById('showAllResCheck').checked;
                    const rList = showAll ? [5, 10, 15, 20] : [selectedR];
                    const colors = { 5: '#ef4444', 10: '#f59e0b', 15: '#10b981', 20: '#818cf8' };

                    rList.forEach(rVal => {
                        const endI = 9 / rVal;
                        const lineEndX = ox + axisW;
                        const lineEndY = oy - (endI / maxAxisI) * axisH;

                        ctx3.strokeStyle = colors[rVal] || '#38bdf8';
                        ctx3.lineWidth = (rVal === selectedR) ? 3 : 1.5;
                        ctx3.beginPath(); ctx3.moveTo(ox, oy); ctx3.lineTo(lineEndX, lineEndY); ctx3.stroke();

                        ctx3.fillStyle = colors[rVal];
                        ctx3.font = "bold 11px sans-serif";
                        ctx3.textAlign = "left";
                        ctx3.fillText(`${rVal}Ω`, lineEndX + 4, lineEndY + 4);

                        if (v > 0) {
                            const curIVal = v / rVal;
                            const curX = ox + (v / 9) * axisW;
                            const curY = oy - (curIVal / maxAxisI) * axisH;
                            ctx3.fillStyle = colors[rVal];
                            ctx3.beginPath(); ctx3.arc(curX, curY, (rVal === selectedR) ? 6 : 4, 0, Math.PI * 2); ctx3.fill();
                        }
                    });
                }
            }
            requestAnimationFrame(animStep3);
        }

        // 초기 구동
        window.addEventListener('DOMContentLoaded', () => {
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
