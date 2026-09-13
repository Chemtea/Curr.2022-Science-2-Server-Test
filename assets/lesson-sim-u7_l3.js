window.addEventListener('lesson-step-change', event => { const stepNum = event.detail;

            if (stepNum === 2) initStep2();
            if (stepNum === 3) initStep3();
            
});
        
        
        
        

        

        

        

        // ==========================================
        // STEP 2: 수류 모형 ↔ 전기회로 시뮬레이션
        // ==========================================
        const canvas2 = document.getElementById('simCanvas2');
        const ctx2 = canvas2.getContext('2d');
        let voltage = 1.5;
        let waterParticles = [];
        let elecParticles = [];
        let wheelAngle = 0;
        let isPaused2 = false;

        function togglePause2() {
            isPaused2 = !isPaused2;
            document.getElementById('pauseBtn2').innerText = isPaused2 ? "▶️ 재개" : "⏸️ 일시정지";
        }

        function initStep2() {
            waterParticles = [];
            elecParticles = [];
            for (let i = 0; i < 20; i++) {
                waterParticles.push({ pos: i * (800 / 20) });
                elecParticles.push({ pos: i * (820 / 20) });
            }
        }

        function updateVoltage() {
            voltage = parseFloat(document.getElementById('voltageSelect').value);
            document.getElementById('vLabel').innerText = voltage + " V";
            document.getElementById('iLabel').innerText = voltage === 0 ? "0 A (전류 없음)" : (voltage + " A");
            
            let lightTxt = "꺼짐";
            if (voltage === 1.5) lightTxt = "보통 밝기 / 보통 회전";
            else if (voltage === 3.0) lightTxt = "밝음 / 빠른 회전";
            else if (voltage === 4.5) lightTxt = "매우 밝음 / 매우 빠른 회전";
            document.getElementById('lightLabel').innerText = lightTxt;
        }

        function drawArrow(ctx, fromx, fromy, tox, toy, color, text, labelX, labelY) {
            const headlen = 10;
            const dx = tox - fromx;
            const dy = toy - fromy;
            const angle = Math.atan2(dy, dx);

            ctx.save();
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 3;

            ctx.beginPath();
            ctx.moveTo(fromx, fromy);
            ctx.lineTo(tox, toy);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(tox, toy);
            ctx.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fill();

            if (text) {
                ctx.font = "bold 12px sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(text, labelX, labelY);
            }
            ctx.restore();
        }

        function animStep2() {
            if (document.getElementById('step2').classList.contains('active')) {
                ctx2.clearRect(0, 0, canvas2.width, canvas2.height);

                ctx2.fillStyle = "#1e293b"; ctx2.fillRect(10, 10, 380, 320);
                ctx2.fillStyle = "#1e293b"; ctx2.fillRect(410, 10, 380, 320);

                ctx2.fillStyle = "#38bdf8"; ctx2.font = "bold 14px sans-serif"; ctx2.textAlign = "left";
                ctx2.fillText("[ 수류 모형 비유 ]", 20, 32);
                ctx2.fillText("[ 실제 전기 회로 ]", 420, 32);

                let headDiff = voltage * 12;
                ctx2.strokeStyle = "#334155"; ctx2.lineWidth = 14;
                ctx2.beginPath();
                ctx2.moveTo(80, 260); ctx2.lineTo(80, 100 - headDiff);
                ctx2.lineTo(320, 100 - headDiff); ctx2.lineTo(320, 260);
                ctx2.lineTo(80, 260);
                ctx2.stroke();

                ctx2.fillStyle = "#f43f5e"; ctx2.beginPath(); ctx2.arc(80, 200, 20, 0, Math.PI*2); ctx2.fill();
                ctx2.fillStyle = "#fff"; ctx2.font = "bold 11px sans-serif"; ctx2.textAlign = "center";
                ctx2.fillText("펌프", 80, 204);

                if (!isPaused2 && voltage > 0) wheelAngle += voltage * 0.02;
                ctx2.save();
                ctx2.translate(320, 180);
                ctx2.rotate(wheelAngle);
                ctx2.strokeStyle = "#f59e0b"; ctx2.lineWidth = 4;
                ctx2.beginPath(); ctx2.arc(0, 0, 18, 0, Math.PI*2); ctx2.stroke();
                for(let a=0; a<Math.PI*2; a+=Math.PI/3) {
                    ctx2.beginPath(); ctx2.moveTo(0,0); ctx2.lineTo(Math.cos(a)*18, Math.sin(a)*18); ctx2.stroke();
                }
                ctx2.restore();
                ctx2.fillStyle = "#fbbf24"; ctx2.fillText("물레방아", 320, 215);

                ctx2.strokeStyle = "#475569"; ctx2.lineWidth = 10;
                ctx2.strokeRect(480, 90, 240, 170);

                ctx2.fillStyle = "#0f172a"; ctx2.fillRect(465, 140, 30, 70);
                ctx2.fillStyle = "#818cf8"; ctx2.fillRect(465, 140, 30, 15);
                ctx2.fillStyle = "#ef4444"; ctx2.fillRect(465, 195, 30, 15);
                ctx2.fillStyle = "#fff"; ctx2.font = "bold 11px sans-serif";
                ctx2.fillText("(-)극", 480, 132); ctx2.fillText("(+)극", 480, 226);
                ctx2.fillText(`전지`, 440, 180);

                if (voltage > 0) {
                    ctx2.fillStyle = `rgba(251, 191, 36, ${0.2 + voltage*0.25})`;
                    ctx2.beginPath(); ctx2.arc(720, 175, 18 + voltage*4, 0, Math.PI*2); ctx2.fill();
                }
                ctx2.fillStyle = voltage > 0 ? "#fbbf24" : "#64748b";
                ctx2.beginPath(); ctx2.arc(720, 175, 16, 0, Math.PI*2); ctx2.fill();
                ctx2.fillStyle = "#1e293b"; ctx2.fillText("전구", 720, 179);

                let showDir = document.getElementById('step2ShowDirections').checked;

                if (voltage > 0 && showDir) {
                    drawArrow(ctx2, 510, 65, 690, 65, "#818cf8", "전자 이동 [(-) ➔ 전구 ➔ (+)]", 600, 52);
                    drawArrow(ctx2, 510, 285, 690, 285, "#f43f5e", "전류 방향 [(+) ➔ 전구 ➔ (-)]", 600, 305);
                }

                if (voltage > 0) {
                    waterParticles.forEach(p => {
                        if (!isPaused2) p.pos = (p.pos + voltage * 0.8) % 800;
                        let x, y, loop = p.pos;
                        if (loop < 240) { x = 80 + loop; y = 100 - headDiff; }
                        else if (loop < 400) { x = 320; y = (100 - headDiff) + (loop-240); }
                        else if (loop < 640) { x = 320 - (loop-400); y = 260; }
                        else { x = 80; y = 260 - (loop-640); }

                        ctx2.fillStyle = "#38bdf8";
                        ctx2.beginPath(); ctx2.arc(x, y, 4, 0, Math.PI*2); ctx2.fill();
                    });

                    elecParticles.forEach(p => {
                        if (!isPaused2) p.pos = (p.pos + voltage * 0.8) % 820;
                        let x, y, loop = p.pos;
                        if (loop < 240) { x = 480 + loop; y = 90; }
                        else if (loop < 410) { x = 720; y = 90 + (loop-240); }
                        else if (loop < 650) { x = 720 - (loop-410); y = 260; }
                        else { x = 480; y = 260 - (loop-650); }

                        ctx2.fillStyle = "#818cf8";
                        ctx2.beginPath(); ctx2.arc(x, y, 5, 0, Math.PI*2); ctx2.fill();
                        ctx2.fillStyle = "#fff"; ctx2.font = "bold 9px sans-serif";
                        ctx2.fillText("-", x, y + 3);
                    });
                }
            }
            requestAnimationFrame(animStep2);
        }

        // ==========================================
        // STEP 3: 회로 스위치 및 전자/전류 방향
        // ==========================================
        const canvas3 = document.getElementById('simCanvas3');
        const ctx3 = canvas3.getContext('2d');
        let switchClosed = false;
        let randomElectrons = [];
        let isPaused3 = false;

        function togglePause3() {
            isPaused3 = !isPaused3;
            document.getElementById('pauseBtn3').innerText = isPaused3 ? "▶️ 재개" : "⏸️ 일시정지";
        }

        function initStep3() {
            randomElectrons = [];
            for (let i = 0; i < 36; i++) {
                let seg = Math.floor(Math.random() * 4);
                let x, y;
                if (seg === 0) { x = 120 + Math.random()*560; y = 60; }
                else if (seg === 1) { x = 680; y = 60 + Math.random()*220; }
                else if (seg === 2) { x = 120 + Math.random()*560; y = 280; }
                else { x = 120; y = 60 + Math.random()*220; }
                
                randomElectrons.push({
                    x: x, y: y, seg: seg,
                    vx: (Math.random() - 0.5) * 1.2,
                    vy: (Math.random() - 0.5) * 1.2
                });
            }
        }

        canvas3.addEventListener('click', function(e) {
            const rect = canvas3.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;

            if (clickX >= 340 && clickX <= 460 && clickY >= 10 && clickY <= 80) {
                switchClosed = !switchClosed;
                updateSwitchUI();
            }
        });

        function updateSwitchUI() {
            document.getElementById('circuitStatus').innerText = switchClosed ? "닫힘 (ON - 스위치 연결됨)" : "열림 (OFF - 터치하여 켜기)";
            document.getElementById('circuitStatus').className = switchClosed ? "badge badge-pos" : "badge badge-neu";
            document.getElementById('electronState').innerText = switchClosed ? "(-)극에서 (+)극으로 일제히 규칙적 이동" : "불규칙한 무작위 운동 (흐름 없음)";
            document.getElementById('electronState').style.color = switchClosed ? "#38bdf8" : "#cbd5e1";
            document.getElementById('bulbStatus').innerText = switchClosed ? "💡 환하게 켜짐!" : "꺼짐";
            document.getElementById('bulbStatus').style.color = switchClosed ? "#f59e0b" : "#a6adc8";
        }

        function animStep3() {
            if (document.getElementById('step3').classList.contains('active')) {
                ctx3.clearRect(0, 0, canvas3.width, canvas3.height);

                ctx3.strokeStyle = "#475569"; ctx3.lineWidth = 14;
                ctx3.strokeRect(120, 60, 560, 220);

                ctx3.fillStyle = "#0f172a"; ctx3.fillRect(105, 130, 30, 80);
                ctx3.fillStyle = "#818cf8"; ctx3.fillRect(105, 130, 30, 18);
                ctx3.fillStyle = "#ef4444"; ctx3.fillRect(105, 192, 30, 18);
                ctx3.fillStyle = "#fff"; ctx3.font = "bold 11px sans-serif"; ctx3.textAlign = "center";
                ctx3.fillText("(-)극", 120, 122); ctx3.fillText("(+)극", 120, 224);

                if (switchClosed) {
                    ctx3.fillStyle = "rgba(251, 191, 36, 0.4)";
                    ctx3.beginPath(); ctx3.arc(680, 170, 32, 0, Math.PI*2); ctx3.fill();
                }
                ctx3.fillStyle = switchClosed ? "#fbbf24" : "#64748b";
                ctx3.beginPath(); ctx3.arc(680, 170, 22, 0, Math.PI*2); ctx3.fill();
                ctx3.fillStyle = "#1e293b"; ctx3.fillText("전구", 680, 174);

                ctx3.fillStyle = "#38bdf8";
                ctx3.beginPath(); ctx3.arc(360, 60, 6, 0, Math.PI*2); ctx3.fill();
                ctx3.beginPath(); ctx3.arc(440, 60, 6, 0, Math.PI*2); ctx3.fill();

                ctx3.strokeStyle = switchClosed ? "#10b981" : "#f87171"; ctx3.lineWidth = 6;
                ctx3.beginPath(); ctx3.moveTo(360, 60);
                if (switchClosed) ctx3.lineTo(440, 60);
                else ctx3.lineTo(430, 25);
                ctx3.stroke();

                ctx3.strokeStyle = "rgba(56, 189, 248, 0.4)"; ctx3.lineWidth = 1;
                ctx3.setLineDash([4, 4]); ctx3.strokeRect(340, 15, 120, 65); ctx3.setLineDash([]);
                ctx3.fillStyle = "#38bdf8"; ctx3.font = "bold 12px sans-serif";
                ctx3.fillText("👆 스위치 (클릭)", 400, 10);

                let showDir3 = document.getElementById('step3ShowDirections').checked;

                if (switchClosed && showDir3) {
                    drawArrow(ctx3, 140, 38, 320, 38, "#818cf8", "전자 이동 [(-)극 ➔ 전구 ➔ (+)극]", 230, 26);
                    drawArrow(ctx3, 180, 305, 620, 305, "#f43f5e", "전류 방향 [(+)극 ➔ 전구 ➔ (-)극]", 400, 323);
                }

                randomElectrons.forEach(e => {
                    if (!isPaused3) {
                        if (!switchClosed) {
                            e.x += e.vx; e.y += e.vy;
                            if (e.seg === 0) { if (e.x < 120 || e.x > 680) e.vx *= -1; e.y = 60; }
                            else if (e.seg === 1) { if (e.y < 60 || e.y > 280) e.vy *= -1; e.x = 680; }
                            else if (e.seg === 2) { if (e.x < 120 || e.x > 680) e.vx *= -1; e.y = 280; }
                            else if (e.seg === 3) { if (e.y < 60 || e.y > 280) e.vy *= -1; e.x = 120; }
                        } else {
                            let speed = 1.5;
                            if (e.seg === 0) {
                                e.x += speed; e.y = 60;
                                if (e.x >= 680) { e.x = 680; e.seg = 1; }
                            } else if (e.seg === 1) {
                                e.y += speed; e.x = 680;
                                if (e.y >= 280) { e.y = 280; e.seg = 2; }
                            } else if (e.seg === 2) {
                                e.x -= speed; e.y = 280;
                                if (e.x <= 120) { e.x = 120; e.seg = 3; }
                            } else if (e.seg === 3) {
                                e.y -= speed; e.x = 120;
                                if (e.y <= 60) { e.y = 60; e.seg = 0; }
                            }
                        }
                    }

                    ctx3.fillStyle = "#818cf8";
                    ctx3.beginPath(); ctx3.arc(e.x, e.y, 5, 0, Math.PI*2); ctx3.fill();
                    ctx3.fillStyle = "#fff"; ctx3.font = "bold 9px sans-serif";
                    ctx3.fillText("-", e.x, e.y + 3);
                });
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
