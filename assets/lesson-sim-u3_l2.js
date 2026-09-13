window.addEventListener('lesson-step-change', event => { const stepNum = event.detail;
            if (stepNum === 2) drawSim2();
            if (stepNum === 3) drawSim3();
            
});
        
        
        
        
        

        

        // ==========================================
        // STEP 2: 양방향 레이저 굴절 정밀 시뮬레이터
        // ==========================================
        const canvas2 = document.getElementById('simCanvas2');
        const ctx2 = canvas2.getContext('2d');
        let isLaserOn2 = true;
        let laserOriginMedium2 = 'air'; // 'air'(공기에서 출발) 또는 'water'(물속에서 출발)
        let incAngle2 = 45;
        let isDraggingLaser2 = false;

        function toggleAdvancedStudy() {
            const content = document.getElementById('advContentBox');
            const arrow = document.getElementById('advToggleArrow');
            if (content.style.display === 'none') {
                content.style.display = 'block';
                arrow.innerText = "▲ 접기";
            } else {
                content.style.display = 'none';
                arrow.innerText = "▼ 펼쳐보기";
            }
        }

        function toggleLaser2() {
            isLaserOn2 = !isLaserOn2;
            const btn = document.getElementById('s2LaserBtn');
            btn.innerText = isLaserOn2 ? "⚡ 레이저 광원: ON" : "⚡ 레이저 광원: OFF";
            btn.className = isLaserOn2 ? "sim-btn" : "sim-btn off";
            drawSim2();
        }

        function toggleLaserDirection2() {
            laserOriginMedium2 = (laserOriginMedium2 === 'air') ? 'water' : 'air';
            updateDirectionUI2();
            drawSim2();
        }

        function updateDirectionUI2() {
            const btn = document.getElementById('s2DirBtn');
            const n2 = parseFloat(document.getElementById('mediumSelect2').value);
            let medName = "💧 물";
            if (n2 > 2.0) medName = "💎 다이아몬드";
            else if (n2 > 1.4) medName = "🔍 유리";

            if (laserOriginMedium2 === 'air') {
                btn.innerText = `🔄 진행 방향: ☁️ 공기 ➔ ${medName}`;
            } else {
                btn.innerText = `🔄 진행 방향: ${medName} ➔ ☁️ 공기`;
            }
        }

        function setAnglePreset2(deg) {
            incAngle2 = deg;
            document.getElementById('angleSlider2').value = deg;
            document.getElementById('angleValLabel2').innerText = `${deg}°`;
            drawSim2();
        }

        function onAngleSliderChange2() {
            incAngle2 = parseFloat(document.getElementById('angleSlider2').value);
            document.getElementById('angleValLabel2').innerText = `${incAngle2}°`;
            drawSim2();
        }

        function getPos2(e) {
            const rect = canvas2.getBoundingClientRect();
            let cx = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0].clientX);
            let cy = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0].clientY);
            return { x: cx - rect.left, y: cy - rect.top };
        }

        function getLaserSourcePos2() {
            const cx = canvas2.width / 2;
            const cy = 235;
            const radius = 210;
            let rad;
            if (laserOriginMedium2 === 'air') {
                rad = (-90 - incAngle2) * Math.PI / 180;
            } else {
                rad = (90 + incAngle2) * Math.PI / 180;
            }
            return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
        }

        canvas2.addEventListener('mousedown', e => {
            if (!document.getElementById('step2').classList.contains('active')) return;
            const pos = getPos2(e);
            const src = getLaserSourcePos2();
            if (Math.hypot(pos.x - src.x, pos.y - src.y) < 55) {
                isDraggingLaser2 = true;
            }
        });

        function handleLaserMove2(pos) {
            const cx = canvas2.width / 2;
            const cy = 235;
            const dx = pos.x - cx;
            const dy = pos.y - cy;

            if (dy < 0) {
                laserOriginMedium2 = 'air';
                let angle = Math.atan2(-dx, -dy) * 180 / Math.PI;
                angle = Math.max(0, Math.min(80, angle));
                incAngle2 = Math.round(angle);
            } else {
                laserOriginMedium2 = 'water';
                let angle = Math.atan2(-dx, dy) * 180 / Math.PI;
                angle = Math.max(0, Math.min(80, angle));
                incAngle2 = Math.round(angle);
            }

            document.getElementById('angleSlider2').value = incAngle2;
            document.getElementById('angleValLabel2').innerText = `${incAngle2}°`;
            updateDirectionUI2();
            drawSim2();
        }

        canvas2.addEventListener('mousemove', e => {
            if (!document.getElementById('step2').classList.contains('active')) return;
            const pos = getPos2(e);
            if (isDraggingLaser2) {
                handleLaserMove2(pos);
            } else {
                const src = getLaserSourcePos2();
                if (Math.hypot(pos.x - src.x, pos.y - src.y) < 55) {
                    canvas2.style.cursor = 'grab';
                } else {
                    canvas2.style.cursor = 'default';
                }
            }
        });

        window.addEventListener('mouseup', () => { isDraggingLaser2 = false; });

        canvas2.addEventListener('touchstart', e => {
            if (!document.getElementById('step2').classList.contains('active')) return;
            const pos = getPos2(e);
            const src = getLaserSourcePos2();
            if (Math.hypot(pos.x - src.x, pos.y - src.y) < 65) {
                isDraggingLaser2 = true;
                e.preventDefault();
            }
        }, {passive: false});

        canvas2.addEventListener('touchmove', e => {
            if (document.getElementById('step2').classList.contains('active') && isDraggingLaser2) {
                const pos = getPos2(e);
                handleLaserMove2(pos);
                e.preventDefault();
            }
        }, {passive: false});

        window.addEventListener('touchend', () => { isDraggingLaser2 = false; });

        function drawSim2() {
            ctx2.clearRect(0, 0, canvas2.width, canvas2.height);

            const cx = canvas2.width / 2;
            const cy = 235;
            const radius = 190;
            const n2 = parseFloat(document.getElementById('mediumSelect2').value);

            let medColor = "rgba(6, 182, 212, 0.22)";
            let medName = "물 (Water)";
            let medShortName = "물";
            if (n2 > 2.0) {
                medColor = "rgba(168, 85, 247, 0.25)";
                medName = "다이아몬드 (Diamond)";
                medShortName = "다이아몬드";
            } else if (n2 > 1.4) {
                medColor = "rgba(59, 130, 246, 0.25)";
                medName = "유리 (Crown Glass)";
                medShortName = "유리";
            }

            // 상단: 공기 영역
            ctx2.fillStyle = "rgba(15, 23, 42, 0.6)";
            ctx2.fillRect(cx - 380, cy - radius - 25, 760, radius + 25);

            // 하단: 선택 매질 영역
            ctx2.fillStyle = medColor;
            ctx2.fillRect(cx - 380, cy, 760, radius + 25);

            // 경계면
            ctx2.strokeStyle = "#38bdf8";
            ctx2.lineWidth = 2.5;
            ctx2.beginPath();
            ctx2.moveTo(cx - 380, cy);
            ctx2.lineTo(cx + 380, cy);
            ctx2.stroke();

            // 영역 텍스트
            ctx2.fillStyle = "#94a3b8";
            ctx2.font = "bold 13px sans-serif";
            ctx2.textAlign = "left";
            ctx2.fillText("☁️ 공기 (속력 빠름, n₁=1.0)", cx - 360, cy - 20);
            ctx2.fillStyle = "#38bdf8";
            ctx2.fillText(`💧 ${medName} (속력 느림, n₂=${n2})`, cx - 360, cy + 30);

            // 각도기 원호
            ctx2.strokeStyle = "#334155";
            ctx2.lineWidth = 2;
            ctx2.beginPath();
            ctx2.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx2.stroke();

            // 각도 눈금 렌더링
            ctx2.textAlign = "center";
            ctx2.textBaseline = "middle";
            for (let deg = 0; deg < 360; deg += 10) {
                const rad = deg * Math.PI / 180;
                const isMajor = (deg % 30 === 0);
                const tickLen = isMajor ? 14 : 7;

                const x1 = cx + (radius - tickLen) * Math.cos(rad);
                const y1 = cy + (radius - tickLen) * Math.sin(rad);
                const x2 = cx + radius * Math.cos(rad);
                const y2 = cy + radius * Math.sin(rad);

                ctx2.strokeStyle = isMajor ? "#38bdf8" : "#64748b";
                ctx2.lineWidth = isMajor ? 1.5 : 1;
                ctx2.beginPath();
                ctx2.moveTo(x1, y1);
                ctx2.lineTo(x2, y2);
                ctx2.stroke();

                if (isMajor && deg !== 90 && deg !== 270 && deg !== 0 && deg !== 180) {
                    let normalDeg = 0;
                    if (deg < 90) normalDeg = 90 - deg;
                    else if (deg < 180) normalDeg = deg - 90;
                    else if (deg < 270) normalDeg = 270 - deg;
                    else normalDeg = deg - 270;

                    const tx = cx + (radius - 26) * Math.cos(rad);
                    const ty = cy + (radius - 26) * Math.sin(rad);
                    ctx2.fillStyle = "#cbd5e1";
                    ctx2.font = "10px sans-serif";
                    ctx2.fillText(`${normalDeg}°`, tx, ty);
                }
            }

            // 법선 렌더링
            const showNorm = document.getElementById('showNormCheck2').checked;
            if (showNorm) {
                ctx2.strokeStyle = "rgba(148, 163, 184, 0.8)";
                ctx2.lineWidth = 1.8;
                ctx2.setLineDash([5, 4]);
                ctx2.beginPath();
                ctx2.moveTo(cx, cy - radius - 15);
                ctx2.lineTo(cx, cy + radius + 15);
                ctx2.stroke();
                ctx2.setLineDash([]);

                ctx2.fillStyle = "#94a3b8";
                ctx2.font = "bold 12px sans-serif";
                ctx2.fillText("법선 (0°)", cx, cy - radius - 24);
                ctx2.fillText("법선 (0°)", cx, cy + radius + 24);

                ctx2.strokeStyle = "#64748b";
                ctx2.lineWidth = 1;
                if (laserOriginMedium2 === 'air') {
                    ctx2.strokeRect(cx - 12, cy - 12, 12, 12);
                } else {
                    ctx2.strokeRect(cx - 12, cy, 12, 12);
                }
            }

            // 물리 계산 (스넬의 법칙)
            const incRadVal = incAngle2 * Math.PI / 180;
            const laserColor = document.getElementById('laserColorSelect2').value;
            const laserLen = radius + 20;

            let n_src = (laserOriginMedium2 === 'air') ? 1.0 : n2;
            let n_dest = (laserOriginMedium2 === 'air') ? n2 : 1.0;
            let sinRef = (n_src / n_dest) * Math.sin(incRadVal);
            let isTotalInternalReflection = (sinRef > 1.0);
            let refAngle2 = 0;
            let refRadVal = 0;

            if (!isTotalInternalReflection) {
                refRadVal = Math.asin(Math.min(1.0, sinRef));
                refAngle2 = refRadVal * 180 / Math.PI;
            }

            // 임계각 계산
            let critAngle = (Math.asin(1.0 / n2) * 180 / Math.PI).toFixed(1);

            if (isLaserOn2) {
                let srcRad, refRad, reflRad, straightRad;

                if (laserOriginMedium2 === 'air') {
                    // 공기 ➔ 매질
                    srcRad = (-90 - incAngle2) * Math.PI / 180;
                    refRad = (90 - refAngle2) * Math.PI / 180;
                    reflRad = (-90 + incAngle2) * Math.PI / 180;
                    straightRad = srcRad + Math.PI;
                } else {
                    // 매질 ➔ 공기
                    srcRad = (90 + incAngle2) * Math.PI / 180;
                    refRad = (-90 + refAngle2) * Math.PI / 180;
                    reflRad = (90 - incAngle2) * Math.PI / 180;
                    straightRad = srcRad - Math.PI;
                }

                const srcX = cx + laserLen * Math.cos(srcRad);
                const srcY = cy + laserLen * Math.sin(srcRad);

                // 1. 입사 광선
                ctx2.strokeStyle = laserColor;
                ctx2.lineWidth = 3.5;
                ctx2.shadowColor = laserColor;
                ctx2.shadowBlur = 10;
                ctx2.beginPath();
                ctx2.moveTo(srcX, srcY);
                ctx2.lineTo(cx, cy);
                ctx2.stroke();

                // 2. 굴절 및 반사 광선
                if (isTotalInternalReflection) {
                    // 전반사: 굴절 광선은 없고 100% 반사됨
                    const destX = cx + laserLen * Math.cos(reflRad);
                    const destY = cy + laserLen * Math.sin(reflRad);
                    ctx2.strokeStyle = laserColor;
                    ctx2.lineWidth = 4;
                    ctx2.beginPath();
                    ctx2.moveTo(cx, cy);
                    ctx2.lineTo(destX, destY);
                    ctx2.stroke();

                    // 전반사 강조 마커 텍스트
                    ctx2.fillStyle = "#f43f5e";
                    ctx2.font = "bold 13px sans-serif";
                    ctx2.shadowBlur = 0;
                    ctx2.fillText("✨ 100% 전반사 발생 (Total Reflection)", cx + 160, cy + 45);
                } else {
                    // 일반 굴절 광선
                    const destX = cx + laserLen * Math.cos(refRad);
                    const destY = cy + laserLen * Math.sin(refRad);
                    ctx2.beginPath();
                    ctx2.moveTo(cx, cy);
                    ctx2.lineTo(destX, destY);
                    ctx2.stroke();

                    // 일부 미세 반사 광선 (물리적 현실감)
                    ctx2.strokeStyle = "rgba(255, 255, 255, 0.3)";
                    ctx2.lineWidth = 2;
                    ctx2.beginPath();
                    ctx2.moveTo(cx, cy);
                    ctx2.lineTo(cx + laserLen * Math.cos(reflRad), cy + laserLen * Math.sin(reflRad));
                    ctx2.stroke();
                }

                // 3. 원래 직진 가상 경로 (점선)
                ctx2.strokeStyle = "rgba(148, 163, 184, 0.4)";
                ctx2.lineWidth = 1.5;
                ctx2.setLineDash([4, 4]);
                ctx2.beginPath();
                ctx2.moveTo(cx, cy);
                ctx2.lineTo(cx + laserLen * Math.cos(straightRad), cy + laserLen * Math.sin(straightRad));
                ctx2.stroke();
                ctx2.setLineDash([]);
                ctx2.shadowBlur = 0;

                // 입사 지점 하이라이트 점
                ctx2.fillStyle = "#ffffff";
                ctx2.beginPath(); ctx2.arc(cx, cy, 4.5, 0, Math.PI * 2); ctx2.fill();

                // 4. 레이저 포인터 기기 렌더링
                ctx2.save();
                ctx2.translate(srcX, srcY);
                ctx2.rotate(Math.atan2(cy - srcY, cx - srcX));
                
                ctx2.fillStyle = "#334155";
                ctx2.fillRect(-45, -12, 45, 24);
                ctx2.fillStyle = "#64748b";
                ctx2.fillRect(-45, -8, 12, 16);
                ctx2.fillStyle = laserColor;
                ctx2.fillRect(-4, -5, 4, 10);
                ctx2.restore();

                // 안내 텍스트
                ctx2.fillStyle = "#38bdf8";
                ctx2.font = "bold 11px sans-serif";
                ctx2.fillText("👆 드래그 가능 (상/하 이동)", srcX, (laserOriginMedium2 === 'air') ? srcY - 20 : srcY + 28);

                // 5. 각도 호 및 라벨 표시
                if (incAngle2 > 4 && showNorm) {
                    // 입사각 호
                    ctx2.strokeStyle = "#ef4444";
                    ctx2.lineWidth = 2;
                    ctx2.beginPath();
                    if (laserOriginMedium2 === 'air') {
                        ctx2.arc(cx, cy, 55, srcRad, -Math.PI/2);
                    } else {
                        ctx2.arc(cx, cy, 55, Math.PI/2, srcRad);
                    }
                    ctx2.stroke();

                    ctx2.fillStyle = "#ef4444";
                    ctx2.font = "bold 12px sans-serif";
                    const incMidRad = (laserOriginMedium2 === 'air') 
                        ? (-90 - incAngle2 / 2) * Math.PI / 180 
                        : (90 + incAngle2 / 2) * Math.PI / 180;
                    ctx2.fillText(`입사각 ${incAngle2}°`, cx + 80 * Math.cos(incMidRad), cy + 80 * Math.sin(incMidRad));

                    if (!isTotalInternalReflection) {
                        // 굴절각 호
                        ctx2.strokeStyle = "#f59e0b";
                        ctx2.lineWidth = 2;
                        ctx2.beginPath();
                        if (laserOriginMedium2 === 'air') {
                            ctx2.arc(cx, cy, 55, Math.PI/2 - refRadVal, Math.PI/2);
                        } else {
                            ctx2.arc(cx, cy, 55, -Math.PI/2, -Math.PI/2 + refRadVal);
                        }
                        ctx2.stroke();

                        ctx2.fillStyle = "#f59e0b";
                        const refMidRad = (laserOriginMedium2 === 'air')
                            ? (90 - refAngle2 / 2) * Math.PI / 180
                            : (-90 + refAngle2 / 2) * Math.PI / 180;
                        ctx2.fillText(`굴절각 ${refAngle2.toFixed(1)}°`, cx + 85 * Math.cos(refMidRad), cy + 85 * Math.sin(refMidRad));
                    } else {
                        // 전반사 반사각 호
                        ctx2.strokeStyle = "#a855f7";
                        ctx2.lineWidth = 2;
                        ctx2.beginPath();
                        ctx2.arc(cx, cy, 55, reflRad, Math.PI/2);
                        ctx2.stroke();

                        ctx2.fillStyle = "#a855f7";
                        const reflMidRad = (90 - incAngle2 / 2) * Math.PI / 180;
                        ctx2.fillText(`반사각 ${incAngle2}°`, cx + 85 * Math.cos(reflMidRad), cy + 85 * Math.sin(reflMidRad));
                    }
                }
            }

            // 하단 정보 배지 업데이트
            const dirBadge = document.getElementById('s2DirBadge');
            const incBadge = document.getElementById('s2IncBadge');
            const refBadge = document.getElementById('s2RefBadge');
            const relBadge = document.getElementById('s2RelBadge');

            incBadge.innerText = `${incAngle2.toFixed(1)}°`;

            if (laserOriginMedium2 === 'air') {
                dirBadge.innerText = `공기 ➔ ${medShortName}`;
                refBadge.innerText = `${refAngle2.toFixed(1)}°`;
                refBadge.className = "badge badge-yellow";

                if (incAngle2 === 0) {
                    relBadge.innerText = "수직 입사(0°): 꺾이지 않고 그대로 직진";
                    relBadge.className = "badge badge-pos";
                } else {
                    relBadge.innerText = `입사각(${incAngle2}°) > 굴절각(${refAngle2.toFixed(1)}°) : 속력이 느려져 법선 쪽으로 꺾임`;
                    relBadge.className = "badge badge-green";
                }
            } else {
                dirBadge.innerText = `${medShortName} ➔ 공기`;

                if (incAngle2 === 0) {
                    refBadge.innerText = `0.0°`;
                    refBadge.className = "badge badge-yellow";
                    relBadge.innerText = "수직 입사(0°): 꺾이지 않고 그대로 직진";
                    relBadge.className = "badge badge-pos";
                } else if (isTotalInternalReflection) {
                    refBadge.innerText = `없음 (전반사)`;
                    refBadge.className = "badge badge-red";
                    relBadge.innerText = `임계각(${critAngle}°) 초과: 공기로 나가지 못하고 100% 전반사됨`;
                    relBadge.className = "badge badge-purple";
                } else {
                    refBadge.innerText = `${refAngle2.toFixed(1)}°`;
                    refBadge.className = "badge badge-yellow";
                    relBadge.innerText = `입사각(${incAngle2}°) < 굴절각(${refAngle2.toFixed(1)}°) : 속력이 빨라져 법선 반대쪽으로 크게 꺾임`;
                    relBadge.className = "badge badge-green";
                }
            }

            // 심화 탐구 데이터 패널 업데이트
            document.getElementById('advN1').innerText = (laserOriginMedium2 === 'air') ? "1.00 (공기)" : `${n2.toFixed(2)} (${medShortName})`;
            document.getElementById('advN2').innerText = (laserOriginMedium2 === 'air') ? `${n2.toFixed(2)} (${medShortName})` : "1.00 (공기)";
            document.getElementById('advIncAngle').innerText = `${incAngle2.toFixed(1)}°`;
            document.getElementById('advSinInc').innerText = Math.sin(incRadVal).toFixed(4);
            document.getElementById('advSinRef').innerText = isTotalInternalReflection ? `${sinRef.toFixed(4)} (> 1.0)` : sinRef.toFixed(4);
            document.getElementById('advRefAngle').innerText = isTotalInternalReflection ? "계산 불가 (전반사)" : `${refAngle2.toFixed(1)}°`;
            document.getElementById('advCritAngle').innerText = `${critAngle}°`;
        }

        // =========================================================================
        // STEP 3: 컵 속 동전 떠오름 및 정밀 역방향/순방향 광선 추적 시뮬레이터
        // =========================================================================
        const canvas3 = document.getElementById('simCanvas3');
        const ctx3 = canvas3.getContext('2d');
        let waterAnimId = null;

        function setWaterPreset3(val) {
            if (waterAnimId) clearInterval(waterAnimId);
            document.getElementById('waterLevelSlider3').value = val;
            drawSim3();
        }

        function animateWaterPour() {
            const slider = document.getElementById('waterLevelSlider3');
            slider.value = 0;
            if (waterAnimId) clearInterval(waterAnimId);
            
            waterAnimId = setInterval(() => {
                let cur = parseInt(slider.value);
                if (cur >= 100) {
                    clearInterval(waterAnimId);
                } else {
                    slider.value = cur + 1;
                    drawSim3();
                }
            }, 25);
        }

        function emptyWater() {
            if (waterAnimId) clearInterval(waterAnimId);
            const slider = document.getElementById('waterLevelSlider3');
            slider.value = 0;
            drawSim3();
        }

        function findRefractionPointToEye(coinX, coinY, eyeX, eyeY, waterY, waterLeftX, waterRightX) {
            const depth = coinY - waterY;
            if (depth <= 1) return null;

            let low = coinX + 0.5;
            let high = waterRightX - 0.5;
            let bestX = low;

            for (let i = 0; i < 35; i++) {
                let mid = (low + high) / 2;
                let dx_w = mid - coinX;
                let theta_w = Math.atan2(dx_w, depth);
                let sin_theta_a = 1.3333 * Math.sin(theta_w);

                if (sin_theta_a >= 0.9999) {
                    high = mid;
                    continue;
                }

                let theta_a = Math.asin(sin_theta_a);
                let slope = -1 / Math.tan(theta_a);
                let targetYAtEye = waterY + slope * (eyeX - mid);

                bestX = mid;
                if (targetYAtEye < eyeY) {
                    low = mid;
                } else {
                    high = mid;
                }
            }
            return bestX;
        }

        function drawSim3() {
            ctx3.clearRect(0, 0, canvas3.width, canvas3.height);

            const waterPct = parseInt(document.getElementById('waterLevelSlider3').value);
            document.getElementById('waterLevelLabel3').innerText = `${waterPct}% (${waterPct === 0 ? "물 없음" : waterPct >= 35 ? "눈에 도달함" : "가려짐"})`;

            const cupBottomY = 410;
            const cupTopY = 220;
            const cupHeight = cupBottomY - cupTopY;
            const cupBottomLeftX = 140;
            const cupBottomRightX = 420;
            const cupTopLeftX = 100;
            const cupTopRightX = 460;

            const coinX = 200;
            const coinY = cupBottomY - 10;
            const eyePos = { x: 750, y: 145 };

            const waterCurrentY = cupBottomY - (cupHeight * (waterPct / 100));
            const leftEdgeSlope = (cupTopLeftX - cupBottomLeftX) / (cupTopY - cupBottomY);
            const rightEdgeSlope = (cupTopRightX - cupBottomRightX) / (cupTopY - cupBottomY);
            const waterLeftX = cupBottomLeftX + leftEdgeSlope * (waterCurrentY - cupBottomY);
            const waterRightX = cupBottomRightX + rightEdgeSlope * (waterCurrentY - cupBottomY);

            // 1. 물
            if (waterPct > 0) {
                ctx3.fillStyle = "rgba(6, 182, 212, 0.28)";
                ctx3.beginPath();
                ctx3.moveTo(waterLeftX, waterCurrentY);
                ctx3.lineTo(waterRightX, waterCurrentY);
                ctx3.lineTo(cupBottomRightX, cupBottomY);
                ctx3.lineTo(cupBottomLeftX, cupBottomY);
                ctx3.closePath();
                ctx3.fill();

                ctx3.strokeStyle = "#38bdf8";
                ctx3.lineWidth = 2.5;
                ctx3.beginPath();
                ctx3.moveTo(waterLeftX, waterCurrentY);
                ctx3.lineTo(waterRightX, waterCurrentY);
                ctx3.stroke();

                ctx3.fillStyle = "#38bdf8";
                ctx3.font = "bold 11px sans-serif";
                ctx3.textAlign = "left";
                ctx3.fillText(`수면 (물 높이: ${waterPct}%)`, waterLeftX + 10, waterCurrentY - 8);
            }

            // 2. 컵 외형
            ctx3.strokeStyle = "#94a3b8";
            ctx3.lineWidth = 7;
            ctx3.beginPath();
            ctx3.moveTo(cupTopLeftX, cupTopY);
            ctx3.lineTo(cupBottomLeftX, cupBottomY);
            ctx3.lineTo(cupBottomRightX, cupBottomY);
            ctx3.lineTo(cupTopRightX, cupTopY);
            ctx3.stroke();

            ctx3.fillStyle = "#64748b";
            ctx3.beginPath(); ctx3.arc(cupTopLeftX, cupTopY, 4, 0, Math.PI*2); ctx3.fill();
            ctx3.beginPath(); ctx3.arc(cupTopRightX, cupTopY, 4, 0, Math.PI*2); ctx3.fill();

            ctx3.fillStyle = "#94a3b8";
            ctx3.font = "bold 12px sans-serif";
            ctx3.textAlign = "center";
            ctx3.fillText("불투명한 컵 가장자리", cupTopRightX, cupTopY - 14);

            // 3. 실제 동전
            ctx3.fillStyle = "#f59e0b";
            ctx3.beginPath();
            ctx3.ellipse(coinX, coinY, 22, 7, 0, 0, Math.PI * 2);
            ctx3.fill();
            ctx3.strokeStyle = "#d97706";
            ctx3.lineWidth = 2;
            ctx3.stroke();
            ctx3.fillStyle = "#0f172a";
            ctx3.font = "bold 11px sans-serif";
            ctx3.fillText("100", coinX, coinY + 3);

            ctx3.fillStyle = "#f59e0b";
            ctx3.font = "bold 12px sans-serif";
            ctx3.fillText("실제 동전 위치", coinX, coinY + 22);

            // 4. 물리적 광선 경로 추적
            let isLightReachingEye = false;
            let hitSurfaceX = null;
            let blockedWallPoint = null;

            if (waterPct === 0) {
                const slopeStraight = (eyePos.y - coinY) / (eyePos.x - coinX);
                const slopeWall = (cupTopY - cupBottomY) / (cupTopRightX - cupBottomRightX);
                const hitY = (slopeWall * cupBottomRightX - cupBottomY - slopeStraight * coinX + coinY) / (slopeWall - slopeStraight);
                const hitX = coinX + (hitY - coinY) / slopeStraight;
                blockedWallPoint = { x: hitX, y: hitY };
                isLightReachingEye = false;
            } else {
                hitSurfaceX = findRefractionPointToEye(coinX, coinY, eyePos.x, eyePos.y, waterCurrentY, waterLeftX, waterRightX);

                if (hitSurfaceX) {
                    const slopeAir = (eyePos.y - waterCurrentY) / (eyePos.x - hitSurfaceX);
                    const yAtRim = waterCurrentY + slopeAir * (cupTopRightX - hitSurfaceX);

                    if (yAtRim <= cupTopY + 1.0) {
                        isLightReachingEye = true;
                    } else {
                        const slopeWall = (cupTopY - cupBottomY) / (cupTopRightX - cupBottomRightX);
                        const hitY = (slopeWall * cupBottomRightX - cupBottomY - slopeAir * hitSurfaceX + waterCurrentY) / (slopeWall - slopeAir);
                        const hitX = hitSurfaceX + (hitY - waterCurrentY) / slopeAir;
                        blockedWallPoint = { x: hitX, y: hitY };
                        isLightReachingEye = false;
                    }
                }
            }

            // 5. 보조 광선 다발
            if (waterPct > 0) {
                ctx3.strokeStyle = "rgba(245, 158, 11, 0.15)";
                ctx3.lineWidth = 1.5;
                const limitX = hitSurfaceX ? hitSurfaceX - 10 : waterRightX;
                for (let tx = waterLeftX + 15; tx < limitX; tx += 22) {
                    ctx3.beginPath();
                    ctx3.moveTo(coinX, coinY);
                    ctx3.lineTo(tx, waterCurrentY);
                    ctx3.lineTo(tx + (tx - coinX) * 0.4, waterCurrentY - (coinY - waterCurrentY) * 0.3);
                    ctx3.stroke();
                }
            }

            // 6. 메인 광선
            if (waterPct === 0) {
                ctx3.strokeStyle = "#ef4444";
                ctx3.lineWidth = 3;
                ctx3.beginPath();
                ctx3.moveTo(coinX, coinY);
                ctx3.lineTo(blockedWallPoint.x, blockedWallPoint.y);
                ctx3.stroke();

                ctx3.strokeStyle = "rgba(239, 68, 68, 0.35)";
                ctx3.setLineDash([4, 4]);
                ctx3.beginPath();
                ctx3.moveTo(blockedWallPoint.x, blockedWallPoint.y);
                ctx3.lineTo(eyePos.x, eyePos.y);
                ctx3.stroke();
                ctx3.setLineDash([]);

                ctx3.fillStyle = "#ef4444";
                ctx3.beginPath();
                ctx3.arc(blockedWallPoint.x, blockedWallPoint.y, 5, 0, Math.PI * 2);
                ctx3.fill();
                ctx3.font = "bold 11px sans-serif";
                ctx3.fillText("🚫 컵 벽에 가로막힘", blockedWallPoint.x + 10, blockedWallPoint.y + 16);

                const slopeRim = (cupTopY - coinY) / (cupTopRightX - coinX);
                const passFarX = eyePos.x + 30;
                const passFarY = coinY + slopeRim * (passFarX - coinX);
                ctx3.strokeStyle = "rgba(148, 163, 184, 0.4)";
                ctx3.lineWidth = 1.5;
                ctx3.beginPath();
                ctx3.moveTo(coinX, coinY);
                ctx3.lineTo(passFarX, passFarY);
                ctx3.stroke();

            } else if (isLightReachingEye) {
                ctx3.strokeStyle = "#f59e0b";
                ctx3.lineWidth = 3.5;
                ctx3.beginPath();
                ctx3.moveTo(coinX, coinY);
                ctx3.lineTo(hitSurfaceX, waterCurrentY);
                ctx3.stroke();

                ctx3.strokeStyle = "#38bdf8";
                ctx3.lineWidth = 4;
                ctx3.shadowColor = "#38bdf8";
                ctx3.shadowBlur = 8;
                ctx3.beginPath();
                ctx3.moveTo(hitSurfaceX, waterCurrentY);
                ctx3.lineTo(eyePos.x, eyePos.y);
                ctx3.stroke();
                ctx3.shadowBlur = 0;

                const arrowX = (hitSurfaceX + eyePos.x) / 2;
                const arrowY = (waterCurrentY + eyePos.y) / 2;
                const airAngle = Math.atan2(eyePos.y - waterCurrentY, eyePos.x - hitSurfaceX);
                ctx3.fillStyle = "#38bdf8";
                ctx3.beginPath();
                ctx3.moveTo(arrowX, arrowY);
                ctx3.lineTo(arrowX - 12 * Math.cos(airAngle - Math.PI/6), arrowY - 12 * Math.sin(airAngle - Math.PI/6));
                ctx3.lineTo(arrowX - 12 * Math.cos(airAngle + Math.PI/6), arrowY - 12 * Math.sin(airAngle + Math.PI/6));
                ctx3.closePath();
                ctx3.fill();

                ctx3.strokeStyle = "rgba(148, 163, 184, 0.7)";
                ctx3.lineWidth = 1.5;
                ctx3.setLineDash([4, 4]);
                ctx3.beginPath();
                ctx3.moveTo(hitSurfaceX, waterCurrentY - 35);
                ctx3.lineTo(hitSurfaceX, waterCurrentY + 35);
                ctx3.stroke();
                ctx3.setLineDash([]);

                const slopeAir = (eyePos.y - waterCurrentY) / (eyePos.x - hitSurfaceX);
                const virtualCoinY = waterCurrentY + slopeAir * (coinX - hitSurfaceX);

                ctx3.strokeStyle = "#facc15";
                ctx3.lineWidth = 2.2;
                ctx3.setLineDash([5, 4]);
                ctx3.beginPath();
                ctx3.moveTo(eyePos.x, eyePos.y);
                ctx3.lineTo(coinX, virtualCoinY);
                ctx3.stroke();
                ctx3.setLineDash([]);

                ctx3.fillStyle = "rgba(250, 204, 21, 0.45)";
                ctx3.beginPath();
                ctx3.ellipse(coinX, virtualCoinY, 22, 7, 0, 0, Math.PI * 2);
                ctx3.fill();
                ctx3.strokeStyle = "#facc15";
                ctx3.lineWidth = 2;
                ctx3.stroke();

                ctx3.fillStyle = "#facc15";
                ctx3.font = "bold 12px sans-serif";
                ctx3.fillText("✨ 떠올라 보이는 동전(상)", coinX, virtualCoinY - 12);

                ctx3.strokeStyle = "#38bdf8";
                ctx3.lineWidth = 1.5;
                ctx3.beginPath();
                ctx3.moveTo(coinX - 35, coinY);
                ctx3.lineTo(coinX - 35, virtualCoinY);
                ctx3.stroke();
                ctx3.fillStyle = "#38bdf8";
                ctx3.font = "10px sans-serif";
                ctx3.fillText("떠오름", coinX - 42, (coinY + virtualCoinY)/2);

            } else {
                ctx3.strokeStyle = "#f59e0b";
                ctx3.lineWidth = 3;
                ctx3.beginPath();
                ctx3.moveTo(coinX, coinY);
                ctx3.lineTo(hitSurfaceX, waterCurrentY);
                ctx3.stroke();

                ctx3.strokeStyle = "#ef4444";
                ctx3.lineWidth = 3;
                ctx3.beginPath();
                ctx3.moveTo(hitSurfaceX, waterCurrentY);
                ctx3.lineTo(blockedWallPoint.x, blockedWallPoint.y);
                ctx3.stroke();

                ctx3.strokeStyle = "rgba(239, 68, 68, 0.35)";
                ctx3.setLineDash([4, 4]);
                ctx3.beginPath();
                ctx3.moveTo(blockedWallPoint.x, blockedWallPoint.y);
                ctx3.lineTo(eyePos.x, eyePos.y);
                ctx3.stroke();
                ctx3.setLineDash([]);

                ctx3.fillStyle = "#ef4444";
                ctx3.beginPath();
                ctx3.arc(blockedWallPoint.x, blockedWallPoint.y, 5, 0, Math.PI * 2);
                ctx3.fill();
                ctx3.font = "bold 11px sans-serif";
                ctx3.fillText("🚫 수위 부족 (벽에 가림)", blockedWallPoint.x + 10, blockedWallPoint.y + 14);
            }

            // 7. 관찰자 눈
            ctx3.save();
            ctx3.translate(eyePos.x, eyePos.y);

            if (isLightReachingEye) {
                ctx3.strokeStyle = "rgba(56, 189, 248, 0.8)";
                ctx3.lineWidth = 3;
                ctx3.beginPath();
                ctx3.arc(0, 0, 25, 0, Math.PI * 2);
                ctx3.stroke();
            }

            ctx3.fillStyle = "#ffffff";
            ctx3.beginPath();
            ctx3.ellipse(0, 0, 18, 12, 0, 0, Math.PI * 2);
            ctx3.fill();
            ctx3.strokeStyle = isLightReachingEye ? "#10b981" : "#64748b";
            ctx3.lineWidth = 2.5;
            ctx3.stroke();

            ctx3.fillStyle = isLightReachingEye ? "#0284c7" : "#475569";
            ctx3.beginPath();
            ctx3.arc(-4, 0, 8, 0, Math.PI * 2);
            ctx3.fill();

            ctx3.fillStyle = "#0f172a";
            ctx3.beginPath();
            ctx3.arc(-5, 0, 4.5, 0, Math.PI * 2);
            ctx3.fill();

            ctx3.fillStyle = "#ffffff";
            ctx3.beginPath();
            ctx3.arc(-6, -2, 1.8, 0, Math.PI * 2);
            ctx3.fill();
            ctx3.restore();

            ctx3.fillStyle = isLightReachingEye ? "#34d399" : "#94a3b8";
            ctx3.font = "bold 13px sans-serif";
            ctx3.textAlign = "center";
            ctx3.fillText(isLightReachingEye ? "👁️ 관찰자의 눈 (빛 도달! 동전 보임)" : "👁️ 관찰자의 눈 (빛 미도달)", eyePos.x, eyePos.y - 28);

            // 8. 상태 배지 업데이트
            const waterBadge = document.getElementById('s3WaterBadge');
            const visibleBadge = document.getElementById('s3CoinVisibleBadge');
            const principleBadge = document.getElementById('s3PrincipleBadge');

            if (waterPct === 0) {
                waterBadge.className = "badge badge-gray";
                waterBadge.innerText = "물 없음 (0%)";
                visibleBadge.className = "badge badge-red";
                visibleBadge.innerText = "🚫 컵 벽에 가려 보이지 않음";
                principleBadge.className = "badge badge-yellow";
                principleBadge.innerText = "빛이 직진하여 눈에 도달하지 못함 (빛 차단)";
            } else if (isLightReachingEye) {
                waterBadge.className = "badge badge-pos";
                waterBadge.innerText = `물 채워짐 (${waterPct}%)`;
                visibleBadge.className = "badge badge-green";
                visibleBadge.innerText = "✨ 동전이 선명하게 떠올라 보임!";
                principleBadge.className = "badge badge-pos";
                principleBadge.innerText = "빛이 수면에서 아래로 꺾여(굴절) 관찰자의 눈에 정확히 도달함!";
            } else {
                waterBadge.className = "badge badge-pos";
                waterBadge.innerText = `물 채워짐 (${waterPct}%)`;
                visibleBadge.className = "badge badge-yellow";
                visibleBadge.innerText = "⚠️ 물 높이가 부족하여 아직 가려짐";
                principleBadge.className = "badge badge-yellow";
                principleBadge.innerText = "빛이 굴절되기 시작했으나 아직 컵 모서리를 넘지 못함 (수위 35% 이상 필요)";
            }
        }

        // ==========================================
        // STEP 4: 형성평가 문항 데이터 및 오답 피드백 UI
        // ==========================================
        

        

        // 초기 구동
        window.addEventListener('DOMContentLoaded', () => {
            checkAndApplyStudentAuth();
            updateStepLockUI();
            updateDirectionUI2();
            drawSim2();
            drawSim3();

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
