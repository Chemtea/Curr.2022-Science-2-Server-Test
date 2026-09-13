window.addEventListener('lesson-step-change', event => { const stepNum = event.detail;

            if (stepNum === 2) updateStep2Sim();
            if (stepNum === 3) initStep3();
            
});
        
        
        
        

        

        

        

        function toggleDeepDive() {
            const box = document.getElementById('seriesDeepDive');
            box.classList.toggle('show');
            const btn = document.getElementById('deepDiveToggleBtn');
            btn.innerText = box.classList.contains('show') ? "✕ 심화 설명 닫기" : "🔍 심화: 직렬 밝기(25%) 원리 보기";
        }

        function getPathPos(pts, dist) {
            let total = 0;
            for (let i = 0; i < pts.length - 1; i++) {
                let dx = pts[i+1].x - pts[i].x;
                let dy = pts[i+1].y - pts[i].y;
                let len = Math.hypot(dx, dy);
                if (dist <= total + len) {
                    let ratio = len === 0 ? 0 : (dist - total) / len;
                    return { x: pts[i].x + dx * ratio, y: pts[i].y + dy * ratio };
                }
                total += len;
            }
            return pts[pts.length - 1];
        }

        function getPathLen(pts) {
            let total = 0;
            for (let i = 0; i < pts.length - 1; i++) {
                total += Math.hypot(pts[i+1].x - pts[i].x, pts[i+1].y - pts[i].y);
            }
            return total;
        }

        function drawSafeRoundRect(ctx, x, y, w, h, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.closePath();
        }

        // ==========================================
        // STEP 2: 전구 연결 시뮬레이션 & 스위치 상호작용
        // ==========================================
        const canvas2 = document.getElementById('simCanvas2');
        const ctx2 = canvas2.getContext('2d');
        let electrons2 = [];
        
        let s2SwitchTop = true;
        let s2SwitchMid = true;

        const mainLeft = 140;
        const mainRight = 710;
        const mainTop = 80;
        const mainMid = 185;
        const mainBottom = 300;
        const bx2 = 425;

        const pathTop = [
            {x: bx2 - 25, y: mainBottom},
            {x: mainLeft, y: mainBottom},
            {x: mainLeft, y: mainTop},
            {x: mainRight, y: mainTop},
            {x: mainRight, y: mainBottom},
            {x: bx2 + 25, y: mainBottom}
        ];
        const lenTop = getPathLen(pathTop);

        const pathMid = [
            {x: bx2 - 25, y: mainBottom},
            {x: mainLeft, y: mainBottom},
            {x: mainLeft, y: mainMid},
            {x: mainRight, y: mainMid},
            {x: mainRight, y: mainBottom},
            {x: bx2 + 25, y: mainBottom}
        ];
        const lenMid = getPathLen(pathMid);

        canvas2.addEventListener('click', function(e) {
            const rect = canvas2.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;
            const mode = document.querySelector('input[name="circuitType"]:checked').value;

            if (mode === 'single' || mode === 'series') {
                if (Math.hypot(clickX - 230, clickY - mainTop) < 30) {
                    s2SwitchTop = !s2SwitchTop;
                }
            } else if (mode === 'parallel') {
                if (Math.hypot(clickX - 230, clickY - mainTop) < 30) {
                    s2SwitchTop = !s2SwitchTop;
                }
                if (Math.hypot(clickX - 230, clickY - mainMid) < 30) {
                    s2SwitchMid = !s2SwitchMid;
                }
            }
        });

        canvas2.addEventListener('mousemove', function(e) {
            const rect = canvas2.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const mode = document.querySelector('input[name="circuitType"]:checked').value;

            let overSwitch = false;
            if (Math.hypot(mouseX - 230, mouseY - mainTop) < 25) overSwitch = true;
            if (mode === 'parallel' && Math.hypot(mouseX - 230, mouseY - mainMid) < 25) overSwitch = true;

            canvas2.style.cursor = overSwitch ? 'pointer' : 'default';
        });

        function updateStep2Sim() {
            const mode = document.querySelector('input[name="circuitType"]:checked').value;
            electrons2 = [];
            
            if (mode === 'single' || mode === 'series') {
                for (let i = 0; i < 30; i++) {
                    electrons2.push({ dist: (lenTop / 30) * i, pType: 1 });
                }
            } else if (mode === 'parallel') {
                for (let i = 0; i < 22; i++) {
                    electrons2.push({ dist: (lenTop / 22) * i, pType: 1 });
                }
                for (let i = 0; i < 22; i++) {
                    electrons2.push({ dist: (lenMid / 22) * i, pType: 2 });
                }
            }

            let resLabel, curLabel, briLabel;
            if (mode === 'single') {
                resLabel = "기준 1배 (R)"; curLabel = "기준 1배 (I)"; briLabel = "매우 밝음 💡 (100%)";
            } else if (mode === 'series') {
                resLabel = "2배로 증가 (2R)"; curLabel = "0.5배로 감소 (0.5I)"; briLabel = "확실하게 어두움 🔅 (25%)";
            } else {
                resLabel = "0.5배로 감소 (0.5R)"; curLabel = "2배로 증가 (2I)"; briLabel = "1개일 때와 같이 매우 밝음 💡 (100%)";
            }
            document.getElementById('s2ResistLabel').innerText = resLabel;
            document.getElementById('s2CurrentLabel').innerText = curLabel;
            document.getElementById('s2BrightnessLabel').innerText = briLabel;
        }

        function drawCircuitSwitch(ctx, x, y, isClosed, label) {
            ctx.fillStyle = "#38bdf8";
            ctx.beginPath(); ctx.arc(x - 22, y, 5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(x + 22, y, 5, 0, Math.PI * 2); ctx.fill();

            ctx.strokeStyle = isClosed ? "#10b981" : "#ef4444";
            ctx.lineWidth = 5;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(x - 22, y);
            if (isClosed) {
                ctx.lineTo(x + 22, y);
            } else {
                ctx.lineTo(x + 15, y - 24);
            }
            ctx.stroke();

            ctx.font = "bold 11px sans-serif";
            ctx.fillStyle = isClosed ? "#34d399" : "#f87171";
            ctx.textAlign = "center";
            ctx.fillText(isClosed ? "스위치 [ON]" : "스위치 [OFF]", x, y + 22);
            ctx.fillStyle = "#94a3b8";
            ctx.font = "10px sans-serif";
            ctx.fillText("(👆클릭 토글)", x, y + 34);
        }

        function drawBulbEnhanced(ctx, x, y, isOn, brightLevel) {
            ctx.fillStyle = "#64748b";
            ctx.fillRect(x - 12, y + 12, 24, 14);

            if (isOn && brightLevel > 0) {
                if (brightLevel > 0.6) {
                    const grad = ctx.createRadialGradient(x, y - 2, 8, x, y - 2, 55);
                    grad.addColorStop(0, "rgba(255, 255, 255, 0.95)");
                    grad.addColorStop(0.25, "rgba(254, 240, 138, 0.7)");
                    grad.addColorStop(0.6, "rgba(250, 204, 21, 0.3)");
                    grad.addColorStop(1, "rgba(250, 204, 21, 0)");
                    ctx.fillStyle = grad;
                    ctx.beginPath(); ctx.arc(x, y - 2, 55, 0, Math.PI * 2); ctx.fill();

                    ctx.strokeStyle = "rgba(253, 224, 71, 0.6)";
                    ctx.lineWidth = 2;
                    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
                        ctx.beginPath();
                        ctx.moveTo(x + Math.cos(a) * 24, y - 2 + Math.sin(a) * 24);
                        ctx.lineTo(x + Math.cos(a) * 38, y - 2 + Math.sin(a) * 38);
                        ctx.stroke();
                    }

                    ctx.beginPath(); ctx.arc(x, y - 2, 19, 0, Math.PI * 2);
                    ctx.fillStyle = "#fef08a"; ctx.fill();
                    ctx.strokeStyle = "#ca8a04"; ctx.lineWidth = 2; ctx.stroke();

                    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.5;
                    ctx.beginPath();
                    ctx.moveTo(x - 6, y + 12); ctx.lineTo(x - 4, y - 4);
                    ctx.lineTo(x + 4, y - 4); ctx.lineTo(x + 6, y + 12);
                    ctx.stroke();

                } else {
                    const grad = ctx.createRadialGradient(x, y - 2, 4, x, y - 2, 24);
                    grad.addColorStop(0, "rgba(245, 158, 11, 0.5)");
                    grad.addColorStop(0.8, "rgba(217, 119, 6, 0.15)");
                    grad.addColorStop(1, "rgba(217, 119, 6, 0)");
                    ctx.fillStyle = grad;
                    ctx.beginPath(); ctx.arc(x, y - 2, 24, 0, Math.PI * 2); ctx.fill();

                    ctx.beginPath(); ctx.arc(x, y - 2, 19, 0, Math.PI * 2);
                    ctx.fillStyle = "#b45309"; ctx.fill();
                    ctx.strokeStyle = "#78350f"; ctx.lineWidth = 2; ctx.stroke();

                    ctx.strokeStyle = "#fed7aa"; ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(x - 6, y + 12); ctx.lineTo(x - 4, y - 4);
                    ctx.lineTo(x + 4, y - 4); ctx.lineTo(x + 6, y + 12);
                    ctx.stroke();
                }
            } else {
                ctx.beginPath(); ctx.arc(x, y - 2, 19, 0, Math.PI * 2);
                ctx.fillStyle = "#334155"; ctx.fill();
                ctx.strokeStyle = "#475569"; ctx.lineWidth = 2; ctx.stroke();

                ctx.strokeStyle = "#64748b"; ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(x - 6, y + 12); ctx.lineTo(x - 4, y - 4);
                ctx.lineTo(x + 4, y - 4); ctx.lineTo(x + 6, y + 12);
                ctx.stroke();
            }
        }

        function animStep2() {
            if (!document.getElementById('step2').classList.contains('active')) {
                requestAnimationFrame(animStep2);
                return;
            }
            ctx2.clearRect(0, 0, canvas2.width, canvas2.height);

            const mode = document.querySelector('input[name="circuitType"]:checked').value;

            ctx2.strokeStyle = "#475569";
            ctx2.lineWidth = 6;
            ctx2.lineCap = "round";

            if (mode === 'single' || mode === 'series') {
                ctx2.beginPath();
                ctx2.moveTo(bx2 - 25, mainBottom);
                ctx2.lineTo(mainLeft, mainBottom);
                ctx2.lineTo(mainLeft, mainTop);
                ctx2.lineTo(mainRight, mainTop);
                ctx2.lineTo(mainRight, mainBottom);
                ctx2.lineTo(bx2 + 25, mainBottom);
                ctx2.stroke();
            } else if (mode === 'parallel') {
                ctx2.beginPath();
                ctx2.moveTo(bx2 - 25, mainBottom);
                ctx2.lineTo(mainLeft, mainBottom);
                ctx2.lineTo(mainLeft, mainTop);
                ctx2.lineTo(mainRight, mainTop);
                ctx2.lineTo(mainRight, mainBottom);
                ctx2.lineTo(bx2 + 25, mainBottom);
                ctx2.stroke();

                ctx2.beginPath();
                ctx2.moveTo(mainLeft, mainMid);
                ctx2.lineTo(mainRight, mainMid);
                ctx2.stroke();
            }

            // 배터리
            ctx2.fillStyle = "#0f172a";
            ctx2.fillRect(bx2 - 40, mainBottom - 20, 80, 40);
            ctx2.fillStyle = "#818cf8"; ctx2.fillRect(bx2 - 40, mainBottom - 16, 22, 32);
            ctx2.fillStyle = "#ef4444"; ctx2.fillRect(bx2 + 18, mainBottom - 16, 22, 32);

            ctx2.fillStyle = "#fff"; ctx2.font = "bold 14px sans-serif"; ctx2.textAlign = "center"; ctx2.textBaseline = "middle";
            ctx2.fillText("-", bx2 - 29, mainBottom); ctx2.fillText("+", bx2 + 29, mainBottom);
            ctx2.font = "12px sans-serif"; ctx2.fillStyle = "#94a3b8";
            ctx2.fillText("전지 (배터리)", bx2, mainBottom + 32);

            let speedTop = 2.0;
            let speedMid = 2.0;

            if (mode === 'single') {
                drawCircuitSwitch(ctx2, 230, mainTop, s2SwitchTop, "스위치");
                let isOn = s2SwitchTop;
                speedTop = isOn ? 2.0 : 0;
                drawBulbEnhanced(ctx2, 500, mainTop, isOn, 1.0);
            } else if (mode === 'series') {
                drawCircuitSwitch(ctx2, 230, mainTop, s2SwitchTop, "스위치");
                let isOn = s2SwitchTop;
                let bright = isOn ? 0.25 : 0;
                speedTop = isOn ? 1.0 : 0;
                drawBulbEnhanced(ctx2, 400, mainTop, isOn, bright);
                drawBulbEnhanced(ctx2, 580, mainTop, isOn, bright);
            } else if (mode === 'parallel') {
                drawCircuitSwitch(ctx2, 230, mainTop, s2SwitchTop, "상단 스위치");
                drawCircuitSwitch(ctx2, 230, mainMid, s2SwitchMid, "하단 스위치");
                
                speedTop = s2SwitchTop ? 2.0 : 0;
                speedMid = s2SwitchMid ? 2.0 : 0;

                drawBulbEnhanced(ctx2, 480, mainTop, s2SwitchTop, 1.0);
                drawBulbEnhanced(ctx2, 480, mainMid, s2SwitchMid, 1.0);
            }

            electrons2.forEach(e => {
                let curSpeed = (e.pType === 1) ? speedTop : speedMid;
                let curLen = (e.pType === 1) ? lenTop : lenMid;
                let curPath = (e.pType === 1) ? pathTop : pathMid;

                if (curSpeed > 0) {
                    e.dist = (e.dist + curSpeed) % curLen;
                    let pos = getPathPos(curPath, e.dist);

                    ctx2.fillStyle = "#38bdf8";
                    ctx2.beginPath(); ctx2.arc(pos.x, pos.y, 5, 0, Math.PI * 2); ctx2.fill();
                    ctx2.fillStyle = "#0f172a"; ctx2.font = "bold 9px sans-serif"; ctx2.textAlign = "center"; ctx2.textBaseline = "middle";
                    ctx2.fillText("-", pos.x, pos.y);
                }
            });

            requestAnimationFrame(animStep2);
        }

        // ==========================================
        // STEP 3: 멀티탭 분해 & 개별 스위치 조작
        // ==========================================
        const canvas3 = document.getElementById('simCanvas3');
        const ctx3 = canvas3.getContext('2d');
        let isCaseOpen = false;
        let s3Sockets = [true, true, false];
        let electrons3 = [];

        const s3X = [300, 480, 660];
        const pathS1 = [{x: 40, y: 235}, {x: 300, y: 235}, {x: 300, y: 75}, {x: 280, y: 75}, {x: 280, y: 175}, {x: 40, y: 175}];
        const pathS2 = [{x: 40, y: 235}, {x: 480, y: 235}, {x: 480, y: 75}, {x: 460, y: 75}, {x: 460, y: 175}, {x: 40, y: 175}];
        const pathS3 = [{x: 40, y: 235}, {x: 660, y: 235}, {x: 660, y: 75}, {x: 640, y: 75}, {x: 640, y: 175}, {x: 40, y: 175}];
        const paths3 = [pathS1, pathS2, pathS3];
        const lenS3 = [getPathLen(pathS1), getPathLen(pathS2), getPathLen(pathS3)];

        function toggleCase() {
            isCaseOpen = !isCaseOpen;
            document.getElementById('caseToggleBtn').innerText = isCaseOpen ? "🔒 외관 케이스 닫기" : "🔍 멀티탭 내부 배선 보기";
        }

        function toggleSchematic() {
            const container = document.getElementById('multitapSchematic');
            container.classList.toggle('show');
            const btn = document.getElementById('schematicToggleBtn');
            btn.innerText = container.classList.contains('show') ? "✕ 회로도 닫기" : "📐 멀티탭 전기 회로도 보기";
        }

        function toggleSocket(idx) {
            s3Sockets[idx - 1] = !s3Sockets[idx - 1];
            document.getElementById(`s3Btn${idx}`).innerText = `${idx}번 (${s3Sockets[idx - 1] ? 'ON' : 'OFF'})`;
        }

        canvas3.addEventListener('click', function(e) {
            const rect = canvas3.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;

            for (let i = 0; i < 3; i++) {
                const cx = s3X[i];
                if (Math.hypot(clickX - cx, clickY - 210) < 35 || Math.hypot(clickX - cx, clickY - 250) < 30) {
                    toggleSocket(i + 1);
                    break;
                }
            }
        });

        canvas3.addEventListener('mousemove', function(e) {
            const rect = canvas3.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            let overBtn = false;
            for (let i = 0; i < 3; i++) {
                const cx = s3X[i];
                if (Math.hypot(mouseX - cx, mouseY - 210) < 35 || Math.hypot(mouseX - cx, mouseY - 250) < 30) {
                    overBtn = true;
                    break;
                }
            }
            canvas3.style.cursor = overBtn ? 'pointer' : 'default';
        });

        function initStep3() {
            electrons3 = [];
            for (let i = 0; i < 18; i++) electrons3.push({ dist: (lenS3[0] / 18) * i, pIdx: 0 });
            for (let i = 0; i < 22; i++) electrons3.push({ dist: (lenS3[1] / 22) * i, pIdx: 1 });
            for (let i = 0; i < 26; i++) electrons3.push({ dist: (lenS3[2] / 26) * i, pIdx: 2 });
            for (let i = 1; i <= 3; i++) {
                document.getElementById(`s3Btn${i}`).innerText = `${i}번 (${s3Sockets[i - 1] ? 'ON' : 'OFF'})`;
            }
        }

        function animStep3() {
            if (!document.getElementById('step3').classList.contains('active')) {
                requestAnimationFrame(animStep3);
                return;
            }
            ctx3.clearRect(0, 0, canvas3.width, canvas3.height);

            ctx3.strokeStyle = "#64748b"; ctx3.lineWidth = 14;
            ctx3.beginPath(); ctx3.moveTo(30, 205); ctx3.lineTo(200, 205); ctx3.stroke();
            ctx3.fillStyle = "#38bdf8"; ctx3.font = "bold 12px sans-serif"; ctx3.textAlign = "left";
            ctx3.fillText("220 V 전원 인입 ➔", 40, 190);

            if (isCaseOpen) {
                ctx3.fillStyle = "#1e293b";
                drawSafeRoundRect(ctx3, 190, 140, 560, 130, 20);
                ctx3.fill();
                ctx3.strokeStyle = "#38bdf8"; ctx3.lineWidth = 2; ctx3.stroke();

                ctx3.strokeStyle = "#ef4444"; ctx3.lineWidth = 6;
                ctx3.beginPath(); ctx3.moveTo(40, 175); ctx3.lineTo(700, 175); ctx3.stroke();

                ctx3.strokeStyle = "#3b82f6"; ctx3.lineWidth = 6;
                ctx3.beginPath(); ctx3.moveTo(40, 235); ctx3.lineTo(700, 235); ctx3.stroke();

                ctx3.font = "bold 11px sans-serif";
                ctx3.fillStyle = "#ef4444"; ctx3.fillText("(+) 활선 도선 레일", 50, 163);
                ctx3.fillStyle = "#3b82f6"; ctx3.fillText("(-) 중성선 도선 레일", 50, 255);

                for (let i = 0; i < 3; i++) {
                    const cx = s3X[i];
                    ctx3.strokeStyle = "#94a3b8"; ctx3.lineWidth = 4;
                    ctx3.beginPath(); ctx3.moveTo(cx - 20, 175); ctx3.lineTo(cx - 20, 95); ctx3.stroke();
                    ctx3.beginPath(); ctx3.moveTo(cx, 235); ctx3.lineTo(cx, 95); ctx3.stroke();

                    ctx3.fillStyle = s3Sockets[i] ? "#10b981" : "#ef4444";
                    drawSafeRoundRect(ctx3, cx - 25, 195, 34, 22, 6);
                    ctx3.fill();
                    ctx3.fillStyle = "#ffffff";
                    ctx3.font = "bold 10px sans-serif";
                    ctx3.textAlign = "center";
                    ctx3.fillText(s3Sockets[i] ? "ON" : "OFF", cx - 8, 210);
                }
            } else {
                ctx3.fillStyle = "#fef08a";
                drawSafeRoundRect(ctx3, 190, 140, 560, 130, 20);
                ctx3.fill();
                ctx3.strokeStyle = "#eab308"; ctx3.lineWidth = 3; ctx3.stroke();

                for (let i = 0; i < 3; i++) {
                    const cx = s3X[i];
                    ctx3.fillStyle = "#e2e8f0";
                    ctx3.beginPath(); ctx3.arc(cx, 200, 34, 0, Math.PI * 2); ctx3.fill();

                    ctx3.fillStyle = "#334155";
                    ctx3.beginPath(); ctx3.arc(cx - 10, 200, 5.5, 0, Math.PI * 2); ctx3.fill();
                    ctx3.beginPath(); ctx3.arc(cx + 10, 200, 5.5, 0, Math.PI * 2); ctx3.fill();

                    ctx3.fillStyle = s3Sockets[i] ? "#10b981" : "#ef4444";
                    drawSafeRoundRect(ctx3, cx - 20, 242, 40, 16, 4);
                    ctx3.fill();
                    ctx3.fillStyle = "#ffffff";
                    ctx3.font = "bold 9px sans-serif";
                    ctx3.textAlign = "center";
                    ctx3.fillText(s3Sockets[i] ? "ON (클릭)" : "OFF (클릭)", cx, 254);
                }
            }

            for (let i = 0; i < 3; i++) {
                const cx = s3X[i];
                if (!isCaseOpen) {
                    ctx3.strokeStyle = "#475569"; ctx3.lineWidth = 6;
                    ctx3.beginPath(); ctx3.moveTo(cx, 166); ctx3.lineTo(cx, 95); ctx3.stroke();
                }
                drawBulbEnhanced(ctx3, cx - 10, 65, s3Sockets[i], 1.0);
                ctx3.fillStyle = "#e2e8f0"; ctx3.font = "bold 12px sans-serif"; ctx3.textAlign = "center";
                ctx3.fillText(`전자기기 ${i + 1}`, cx - 10, 22);
            }

            if (isCaseOpen) {
                electrons3.forEach(e => {
                    let speed = s3Sockets[e.pIdx] ? 1.0 : 0;
                    if (speed > 0) {
                        e.dist = (e.dist + speed) % lenS3[e.pIdx];
                        let pos = getPathPos(paths3[e.pIdx], e.dist);

                        ctx3.fillStyle = "#38bdf8";
                        ctx3.beginPath(); ctx3.arc(pos.x, pos.y, 4.5, 0, Math.PI * 2); ctx3.fill();
                        ctx3.fillStyle = "#0f172a"; ctx3.font = "bold 8px sans-serif"; ctx3.textAlign = "center"; ctx3.textBaseline = "middle";
                        ctx3.fillText("-", pos.x, pos.y);
                    }
                });
            }

            requestAnimationFrame(animStep3);
        }

        // 초기 구동
        window.addEventListener('DOMContentLoaded', () => {
            checkAndApplyStudentAuth();
            updateStepLockUI();
            updateStep2Sim();
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
