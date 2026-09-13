window.addEventListener('lesson-step-change', event => { const stepNum = event.detail;

            if (stepNum === 1) initConceptAnim();
            if (stepNum === 2) initStep2();
            if (stepNum === 3) initStep3();
            
});
        
        
        
        
        

        

        

        

        // 공통 좌표 계산
        function getPos(e, canvas) {
            const rect = canvas.getBoundingClientRect();
            let cx = e.clientX || (e.touches && e.touches[0].clientX);
            let cy = e.clientY || (e.touches && e.touches[0].clientY);
            return { x: cx - rect.left, y: cy - rect.top };
        }

        // ==========================================
        // STEP 1: Concept Animation
        // ==========================================
        const conceptCanvas = document.getElementById('conceptCanvas');
        const cCtx = conceptCanvas.getContext('2d');
        let cAngle = 0;

        function initConceptAnim() {}

        function drawConceptAnim() {
            if (!document.getElementById('step1').classList.contains('active')) return;
            cCtx.clearRect(0, 0, conceptCanvas.width, conceptCanvas.height);

            cAngle += 0.03;
            let shift = Math.sin(cAngle) * 35;

            // 대전체
            cCtx.fillStyle = '#89b4fa';
            cCtx.beginPath(); cCtx.roundRect(40, 45, 110, 80, 10); cCtx.fill();
            cCtx.fillStyle = '#11111b'; cCtx.font = 'bold 14px sans-serif'; cCtx.textAlign = 'center';
            cCtx.fillText("(-)대전체", 95, 90);

            // 금속 물체
            cCtx.fillStyle = 'rgba(148, 163, 184, 0.2)';
            cCtx.strokeStyle = '#94a3b8'; cCtx.lineWidth = 2;
            cCtx.beginPath(); cCtx.roundRect(230, 45, 360, 80, 10); cCtx.fill(); cCtx.stroke();

            // 원자핵(+) & 전자(-)
            for(let i=0; i<5; i++) {
                let px = 265 + i*72;
                cCtx.fillStyle = '#f38ba8'; cCtx.beginPath(); cCtx.arc(px, 85, 10, 0, Math.PI*2); cCtx.fill();
                cCtx.fillStyle = '#fff'; cCtx.font = 'bold 12px sans-serif'; cCtx.fillText('+', px, 89);

                let ex = px + shift + 18;
                cCtx.fillStyle = '#89b4fa'; cCtx.beginPath(); cCtx.arc(ex, 85, 8, 0, Math.PI*2); cCtx.fill();
                cCtx.fillStyle = '#11111b'; cCtx.font = 'bold 11px sans-serif'; cCtx.fillText('-', ex, 88);
            }

            requestAnimationFrame(drawConceptAnim);
        }
        drawConceptAnim();

        // ==========================================
        // STEP 2: Metal Rod Simulation
        // ==========================================
        const canvas2 = document.getElementById('simCanvas2');
        const ctx2 = canvas2.getContext('2d');

        let charger2 = { x: 40, y: 100, w: 120, h: 70, type: 'neg', isDragging: false, dragOffX: 0, isPresent: false };
        const rod2 = { x: 270, y: 90, w: 420, h: 90 };
        let protons2 = [];
        let electrons2 = [];

        function initStep2() {
            charger2.type = document.getElementById('chargerType2').value;
            charger2.x = 40;
            charger2.isDragging = false;
            charger2.isPresent = false;

            protons2 = [];
            electrons2 = [];

            for (let r = 0; r < 2; r++) {
                for (let c = 0; c < 8; c++) {
                    let hx = rod2.x + 30 + c * 52;
                    let hy = rod2.y + 25 + r * 40;
                    protons2.push({ x: hx, y: hy });
                }
            }

            for (let i = 0; i < 16; i++) {
                electrons2.push({
                    x: rod2.x + 15 + Math.random() * (rod2.w - 30),
                    y: rod2.y + 15 + Math.random() * (rod2.h - 30),
                    vx: (Math.random() - 0.5) * 1.5,
                    vy: (Math.random() - 0.5) * 1.5,
                    radius: 7
                });
            }
        }

        function clampCharger2X(targetX) {
            let minX = 15;
            let maxX = rod2.x - charger2.w - 5;
            return Math.max(minX, Math.min(maxX, targetX));
        }

        function createCharger2() {
            charger2.type = document.getElementById('chargerType2').value;
            charger2.x = 40;
            charger2.isDragging = false;
            charger2.isPresent = true;

            // 전자를 순간이동시키지 않고 현재 위치에서 대전체의 전기력에 자연스럽게 반응하게 합니다.
            electrons2.forEach(e => {
                e.returning = false;
                delete e.returnX;
                delete e.returnY;
            });
        }

        function removeCharger2() {
            if (!charger2.isPresent) return;

            charger2.isPresent = false;
            charger2.isDragging = false;

            // 대전체가 사라지면 전자들이 즉시 튀어오지 않고, 몇 초에 걸쳐 천천히 고르게 재분포하도록 합니다.
            electrons2.forEach((e, i) => {
                const cols = 8;
                const col = i % cols;
                const row = Math.floor(i / cols);
                const baseX = rod2.x + 30 + col * ((rod2.w - 60) / (cols - 1));
                const baseY = row === 0 ? rod2.y + 28 : rod2.y + rod2.h - 28;

                // 너무 기계적인 격자 복귀처럼 보이지 않도록 작은 편차를 줍니다.
                e.returnX = baseX + (Math.random() - 0.5) * 14;
                e.returnY = baseY + (Math.random() - 0.5) * 8;
                e.returning = true;

                // 기존 쏠림 운동의 관성을 부드럽게 줄여 급격한 반동을 방지합니다.
                e.vx *= 0.35;
                e.vy *= 0.35;
            });
        }

        canvas2.addEventListener('mousedown', e => {
            let p = getPos(e, canvas2);
            if (!charger2.isPresent) return;
            if (p.x >= charger2.x && p.x <= charger2.x + charger2.w && p.y >= charger2.y && p.y <= charger2.y + charger2.h) {
                charger2.isDragging = true; charger2.dragOffX = p.x - charger2.x;
            }
        });
        canvas2.addEventListener('mousemove', e => {
            if (!charger2.isDragging) return;
            let p = getPos(e, canvas2);
            charger2.x = clampCharger2X(p.x - charger2.dragOffX);
        });
        window.addEventListener('mouseup', () => charger2.isDragging = false);

        canvas2.addEventListener('touchstart', e => {
            let p = getPos(e, canvas2);
            if (!charger2.isPresent) return;
            if (p.x >= charger2.x && p.x <= charger2.x + charger2.w && p.y >= charger2.y && p.y <= charger2.y + charger2.h) {
                charger2.isDragging = true; charger2.dragOffX = p.x - charger2.x;
            }
        }, {passive: false});
        canvas2.addEventListener('touchmove', e => {
            if (!charger2.isDragging) return;
            let p = getPos(e, canvas2);
            charger2.x = clampCharger2X(p.x - charger2.dragOffX);
            e.preventDefault();
        }, {passive: false});
        window.addEventListener('touchend', () => charger2.isDragging = false);

        function animStep2() {
            if (document.getElementById('step2').classList.contains('active')) {
                ctx2.clearRect(0, 0, canvas2.width, canvas2.height);

                let currentDist = rod2.x - (charger2.x + charger2.w);
                let infl = charger2.isPresent ? Math.max(0, Math.min(1, (220 - currentDist) / 220)) : 0;

                if (charger2.isPresent) {
                    ctx2.fillStyle = charger2.type === 'neg' ? '#89b4fa' : '#f38ba8';
                    ctx2.beginPath(); ctx2.roundRect(charger2.x, charger2.y, charger2.w, charger2.h, 12); ctx2.fill();
                    ctx2.fillStyle = '#11111b'; ctx2.font = 'bold 14px sans-serif'; ctx2.textAlign = 'center';
                    ctx2.fillText(charger2.type === 'neg' ? '(-) 대전체' : '(+) 대전체', charger2.x + charger2.w/2, charger2.y + 40);
                } else {
                    ctx2.fillStyle = '#94a3b8'; ctx2.font = 'bold 14px sans-serif'; ctx2.textAlign = 'center';
                    ctx2.fillText('대전체 없음', 100, charger2.y + 40);
                }

                ctx2.fillStyle = 'rgba(148, 163, 184, 0.15)'; ctx2.strokeStyle = '#94a3b8'; ctx2.lineWidth = 2;
                ctx2.beginPath(); ctx2.roundRect(rod2.x, rod2.y, rod2.w, rod2.h, 12); ctx2.fill(); ctx2.stroke();
                ctx2.fillStyle = '#fff'; ctx2.font = 'bold 13px sans-serif';
                ctx2.fillText("금속 막대 [A]", rod2.x + 45, rod2.y - 10); ctx2.fillText("[B]", rod2.x + rod2.w - 35, rod2.y - 10);

                protons2.forEach(p => {
                    ctx2.fillStyle = '#f38ba8'; ctx2.beginPath(); ctx2.arc(p.x, p.y, 9, 0, Math.PI*2); ctx2.fill();
                    ctx2.fillStyle = '#fff'; ctx2.font = 'bold 10px sans-serif'; ctx2.fillText('+', p.x, p.y + 3);
                });

                let forceX = charger2.type === 'neg' ? infl * 0.25 : -infl * 0.25;

                electrons2.forEach(e => {
                    if (!charger2.isPresent && e.returning) {
                        const dx = e.returnX - e.x;
                        const dy = e.returnY - e.y;

                        // 약한 복원력 + 감쇠를 사용해 약 3~5초 동안 천천히 재분포합니다.
                        e.vx += dx * 0.00020 + (Math.random() - 0.5) * 0.012;
                        e.vy += dy * 0.00028 + (Math.random() - 0.5) * 0.012;
                        e.vx *= 0.975;
                        e.vy *= 0.975;

                        if (Math.hypot(dx, dy) < 10) {
                            e.returning = false;
                            e.vx = (Math.random() - 0.5) * 0.7;
                            e.vy = (Math.random() - 0.5) * 0.7;
                        }
                    } else {
                        e.vx += forceX + (Math.random() - 0.5) * 0.2;
                        e.vy += (Math.random() - 0.5) * 0.2;
                        e.vx *= 0.94;
                        e.vy *= 0.94;
                    }
                    e.x += e.vx; e.y += e.vy;

                    const minX = rod2.x + e.radius + 5;
                    const maxX = rod2.x + rod2.w - e.radius - 5;
                    const minY = rod2.y + e.radius + 5;
                    const maxY = rod2.y + rod2.h - e.radius - 5;

                    if (e.x < minX) { e.x = minX; e.vx *= -0.5; }
                    if (e.x > maxX) { e.x = maxX; e.vx *= -0.5; }
                    if (e.y < minY) { e.y = minY; e.vy *= -0.5; }
                    if (e.y > maxY) { e.y = maxY; e.vy *= -0.5; }

                    ctx2.fillStyle = '#89b4fa'; ctx2.beginPath(); ctx2.arc(e.x, e.y, e.radius, 0, Math.PI*2); ctx2.fill();
                    ctx2.fillStyle = '#11111b'; ctx2.font = 'bold 10px sans-serif'; ctx2.fillText('-', e.x, e.y + 3);
                });

                const sideA = document.getElementById('sideACharge');
                const sideB = document.getElementById('sideBCharge');
                const eMoveL = document.getElementById('eMoveLabel2');

                if (!charger2.isPresent) {
                    sideA.innerText = "중성"; sideA.className = "badge badge-neu";
                    sideB.innerText = "중성"; sideB.className = "badge badge-neu";
                    const isReturning = electrons2.some(e => e.returning);
                    eMoveL.innerText = isReturning ? "대전체 제거 → 전자들이 천천히 고르게 퍼지는 중" : "자유 운동 중 (고르게 분포)";
                } else if (infl > 0.15) {
                    if (charger2.type === 'neg') {
                        sideA.innerText = "(+) 전하 유도"; sideA.className = "badge badge-pos";
                        sideB.innerText = "(-) 전하 유도"; sideB.className = "badge badge-neg";
                        eMoveL.innerText = "전자들이 오른쪽(B)으로 밀려남";
                    } else {
                        sideA.innerText = "(-) 전하 유도"; sideA.className = "badge badge-neg";
                        sideB.innerText = "(+) 전하 유도"; sideB.className = "badge badge-pos";
                        eMoveL.innerText = "전자들이 왼쪽(A)으로 끌려옴";
                    }
                } else {
                    sideA.innerText = "중성"; sideA.className = "badge badge-neu";
                    sideB.innerText = "중성"; sideB.className = "badge badge-neu";
                    eMoveL.innerText = "자유 운동 중 (고르게 분포)";
                }
            }
            requestAnimationFrame(animStep2);
        }
        initStep2(); animStep2();

        // ==========================================
        // STEP 3: Charge Distribution & Attachment
        // ==========================================
        const canvas3 = document.getElementById('simCanvas3');
        const ctx3 = canvas3.getContext('2d');

        let charger3 = { x: 50, y: 105, w: 120, h: 70, type: 'neg', isDragging: false, dragOffX: 0 };
        let object3 = { baseX: 480, curX: 480, y: 105, w: 180, h: 70, isAttached: false };

        function initStep3() {
            charger3.type = document.getElementById('chargerType3').value;
            charger3.x = 50;
            charger3.isDragging = false;
            object3.curX = object3.baseX;
            object3.isAttached = false;
        }

        canvas3.addEventListener('mousedown', e => {
            let p = getPos(e, canvas3);
            if (p.x >= charger3.x && p.x <= charger3.x + charger3.w && p.y >= charger3.y && p.y <= charger3.y + charger3.h) {
                charger3.isDragging = true; charger3.dragOffX = p.x - charger3.x;
            }
        });
        canvas3.addEventListener('mousemove', e => {
            if (!charger3.isDragging) return;
            let p = getPos(e, canvas3);
            charger3.x = Math.max(20, Math.min(360, p.x - charger3.dragOffX));
        });
        window.addEventListener('mouseup', () => charger3.isDragging = false);

        canvas3.addEventListener('touchstart', e => {
            let p = getPos(e, canvas3);
            if (p.x >= charger3.x && p.x <= charger3.x + charger3.w && p.y >= charger3.y && p.y <= charger3.y + charger3.h) {
                charger3.isDragging = true; charger3.dragOffX = p.x - charger3.x;
            }
        }, {passive: false});
        canvas3.addEventListener('touchmove', e => {
            if (!charger3.isDragging) return;
            let p = getPos(e, canvas3);
            charger3.x = Math.max(20, Math.min(360, p.x - charger3.dragOffX));
            e.preventDefault();
        }, {passive: false});
        window.addEventListener('touchend', () => charger3.isDragging = false);

        function animStep3() {
            if (document.getElementById('step3').classList.contains('active')) {
                ctx3.clearRect(0, 0, canvas3.width, canvas3.height);

                let forceTypeEl = document.getElementById('forceType3');
                let attachStateEl = document.getElementById('attachState3');
                let showProtons = document.getElementById('toggleProtons3').checked;

                let dist = object3.curX - (charger3.x + charger3.w);

                if (dist < 110 && !object3.isAttached) {
                    object3.curX += (charger3.x + charger3.w - object3.curX) * 0.25;
                    if (Math.abs(object3.curX - (charger3.x + charger3.w)) < 2) {
                        object3.curX = charger3.x + charger3.w;
                        object3.isAttached = true;
                    }
                } else if (object3.isAttached) {
                    object3.curX = charger3.x + charger3.w;
                } else {
                    object3.curX = object3.baseX;
                }

                ctx3.fillStyle = charger3.type === 'neg' ? '#89b4fa' : '#f38ba8';
                ctx3.beginPath(); ctx3.roundRect(charger3.x, charger3.y, charger3.w, charger3.h, 12); ctx3.fill();
                ctx3.fillStyle = '#11111b'; ctx3.font = 'bold 14px sans-serif'; ctx3.textAlign = 'center';
                ctx3.fillText(charger3.type === 'neg' ? '(-) 대전체' : '(+) 대전체', charger3.x + charger3.w/2, charger3.y + 40);

                ctx3.fillStyle = 'rgba(148, 163, 184, 0.25)'; ctx3.strokeStyle = '#94a3b8'; ctx3.lineWidth = 2;
                ctx3.beginPath(); ctx3.roundRect(object3.curX, object3.y, object3.w, object3.h, 12); ctx3.fill(); ctx3.stroke();
                ctx3.fillStyle = '#fff'; ctx3.font = 'bold 13px sans-serif';
                ctx3.fillText("중성 금속 물체", object3.curX + object3.w/2, object3.y + 25);

                let infl3 = Math.max(0, Math.min(1, (200 - dist) / 200));
                let maxShift = 25;
                let eShift3 = (charger3.type === 'neg' ? 1 : -1) * infl3 * maxShift;

                const eRadius = 7;
                const minAllowedX = object3.curX + eRadius + 4;
                const maxAllowedX = object3.curX + object3.w - eRadius - 4;

                for (let i = 0; i < 4; i++) {
                    let hx = object3.curX + 25 + i * 40;
                    let hy = object3.y + 48;

                    if (showProtons) {
                        ctx3.fillStyle = '#f38ba8'; ctx3.beginPath(); ctx3.arc(hx, hy, 8, 0, Math.PI*2); ctx3.fill();
                        ctx3.fillStyle = '#fff'; ctx3.font = 'bold 9px sans-serif'; ctx3.fillText('+', hx, hy + 3);
                    }

                    let targetEx = hx + eShift3;
                    let ex = Math.max(minAllowedX, Math.min(maxAllowedX, targetEx));

                    ctx3.fillStyle = '#89b4fa'; ctx3.beginPath(); ctx3.arc(ex, hy, eRadius, 0, Math.PI*2); ctx3.fill();
                    ctx3.fillStyle = '#11111b'; ctx3.font = 'bold 9px sans-serif'; ctx3.fillText('-', ex, hy + 3);
                }

                if (dist < 180 || object3.isAttached) {
                    forceTypeEl.innerText = "🧲 인력 (끌어당기는 힘)"; forceTypeEl.className = "badge badge-pos";
                    if (object3.isAttached) {
                        attachStateEl.innerText = "⚡ 딱! 달라붙음!"; attachStateEl.style.color = "#38bdf8";
                        ctx3.fillStyle = '#f9e2af'; ctx3.font = 'bold 15px sans-serif';
                        ctx3.fillText("💥 인력으로 자동 부착!", charger3.x + charger3.w + 10, charger3.y - 15);
                    } else {
                        attachStateEl.innerText = "인력으로 끌려오는 중..."; attachStateEl.style.color = "#f9e2af";
                    }
                } else {
                    forceTypeEl.innerText = "없음"; forceTypeEl.className = "badge badge-neu";
                    attachStateEl.innerText = "떨어져 있음"; attachStateEl.style.color = "#a6adc8";
                }
            }
            requestAnimationFrame(animStep3);
        }
        initStep3(); animStep3();

        // 초기 구동
        window.addEventListener('DOMContentLoaded', () => {
            checkAndApplyStudentAuth();
            updateStepLockUI();
            initConceptAnim();

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
