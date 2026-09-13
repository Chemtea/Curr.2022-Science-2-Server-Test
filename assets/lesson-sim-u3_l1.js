window.addEventListener('lesson-step-change', event => { const stepNum = event.detail;
            if (stepNum === 2) drawSim2();
            if (stepNum === 3) drawSim3();
            
});
        
        
        
        

        

        // ==========================================
        // STEP 2: 레이저 포인터 직접 드래그 & 각도 조절 바
        // ==========================================
        const canvas2 = document.getElementById('simCanvas2');
        const ctx2 = canvas2.getContext('2d');
        let isLaserOn2 = true;
        let incAngle2 = 40;
        let isDraggingLaser2 = false;

        function toggleLaser2() {
            isLaserOn2 = !isLaserOn2;
            const btn = document.getElementById('s2LaserBtn');
            btn.innerText = isLaserOn2 ? "⚡ 레이저 광원: ON" : "⚡ 레이저 광원: OFF";
            btn.className = isLaserOn2 ? "sim-btn" : "sim-btn off";
            document.getElementById('s2StateBadge').innerText = isLaserOn2 ? "광원 ON" : "광원 OFF";
            document.getElementById('s2StateBadge').className = isLaserOn2 ? "badge badge-pos" : "badge badge-gray";
            drawSim2();
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

        canvas2.addEventListener('mousedown', e => {
            if (!document.getElementById('step2').classList.contains('active')) return;
            const pos = getPos2(e);
            const cx = canvas2.width / 2;
            const cy = 340;
            const radius = 250;
            const incRad = (-90 - incAngle2) * Math.PI / 180;
            const srcX = cx + (radius + 20) * Math.cos(incRad);
            const srcY = cy + (radius + 20) * Math.sin(incRad);
            
            if (Math.hypot(pos.x - srcX, pos.y - srcY) < 55) {
                isDraggingLaser2 = true;
            }
        });

        function handleLaserMove(pos) {
            const cx = canvas2.width / 2;
            const cy = 340;
            
            let angleRad = Math.atan2(pos.y - cy, pos.x - cx);
            let deg = angleRad * 180 / Math.PI;
            if (deg > 0) deg -= 360; 
            
            let newIncAngle = -90 - deg;
            newIncAngle = Math.max(0, Math.min(80, newIncAngle));
            incAngle2 = Math.round(newIncAngle);
            
            document.getElementById('angleSlider2').value = incAngle2;
            document.getElementById('angleValLabel2').innerText = `${incAngle2}°`;
            drawSim2();
        }

        canvas2.addEventListener('mousemove', e => {
            if (!document.getElementById('step2').classList.contains('active')) return;
            const pos = getPos2(e);
            const cx = canvas2.width / 2;
            const cy = 340;
            
            if (isDraggingLaser2) {
                handleLaserMove(pos);
            } else {
                const radius = 250;
                const incRad = (-90 - incAngle2) * Math.PI / 180;
                const srcX = cx + (radius + 20) * Math.cos(incRad);
                const srcY = cy + (radius + 20) * Math.sin(incRad);
                
                if (Math.hypot(pos.x - srcX, pos.y - srcY) < 55) {
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
            const cx = canvas2.width / 2;
            const cy = 340;
            const incRad = (-90 - incAngle2) * Math.PI / 180;
            const srcX = cx + 270 * Math.cos(incRad);
            const srcY = cy + 270 * Math.sin(incRad);
            
            if (Math.hypot(pos.x - srcX, pos.y - srcY) < 65) {
                isDraggingLaser2 = true;
                e.preventDefault();
            }
        }, {passive: false});

        canvas2.addEventListener('touchmove', e => {
            if (document.getElementById('step2').classList.contains('active') && isDraggingLaser2) {
                const pos = getPos2(e);
                handleLaserMove(pos);
                e.preventDefault();
            }
        }, {passive: false});

        window.addEventListener('touchend', () => { isDraggingLaser2 = false; });

        function drawSim2() {
            ctx2.clearRect(0, 0, canvas2.width, canvas2.height);

            const cx = canvas2.width / 2;
            const cy = 340;
            const radius = 250;

            // 1. 각도기 반원 배경
            ctx2.fillStyle = "rgba(15, 23, 42, 0.7)";
            ctx2.beginPath();
            ctx2.arc(cx, cy, radius, Math.PI, 0, false);
            ctx2.closePath();
            ctx2.fill();
            ctx2.strokeStyle = "#334155";
            ctx2.lineWidth = 2;
            ctx2.stroke();

            // 2. 각도기 눈금선
            ctx2.textAlign = "center";
            ctx2.textBaseline = "middle";
            for (let deg = -80; deg <= 80; deg += 10) {
                const rad = (-90 + deg) * Math.PI / 180;
                const isMajor = (deg % 30 === 0);
                const tickLen = isMajor ? 16 : 8;

                const x1 = cx + (radius - tickLen) * Math.cos(rad);
                const y1 = cy + (radius - tickLen) * Math.sin(rad);
                const x2 = cx + radius * Math.cos(rad);
                const y2 = cy + radius * Math.sin(rad);

                ctx2.strokeStyle = isMajor ? "#38bdf8" : "#64748b";
                ctx2.lineWidth = isMajor ? 2 : 1;
                ctx2.beginPath();
                ctx2.moveTo(x1, y1);
                ctx2.lineTo(x2, y2);
                ctx2.stroke();

                const tx = cx + (radius - 28) * Math.cos(rad);
                const ty = cy + (radius - 28) * Math.sin(rad);
                ctx2.fillStyle = isMajor ? "#f8fafc" : "#94a3b8";
                ctx2.font = isMajor ? "bold 12px sans-serif" : "10px sans-serif";
                ctx2.fillText(`${Math.abs(deg)}°`, tx, ty);
            }

            // 3. 하단 거울 본체
            ctx2.fillStyle = "#1e293b";
            ctx2.fillRect(cx - 380, cy, 760, 50);
            ctx2.fillStyle = "#38bdf8";
            ctx2.fillRect(cx - 380, cy, 760, 4);
            ctx2.fillStyle = "#cbd5e1";
            ctx2.font = "bold 14px sans-serif";
            ctx2.fillText("평면거울 (반사면)", cx, cy + 28);

            // 4. 법선
            const showNorm = document.getElementById('showNormCheck2').checked;
            if (showNorm) {
                ctx2.strokeStyle = "rgba(148, 163, 184, 0.7)";
                ctx2.lineWidth = 2;
                ctx2.setLineDash([6, 5]);
                ctx2.beginPath();
                ctx2.moveTo(cx, cy);
                ctx2.lineTo(cx, cy - radius - 15);
                ctx2.stroke();
                ctx2.setLineDash([]);

                ctx2.fillStyle = "#94a3b8";
                ctx2.font = "bold 13px sans-serif";
                ctx2.fillText("법선 (0°)", cx, cy - radius - 24);

                ctx2.strokeStyle = "#64748b";
                ctx2.lineWidth = 1.5;
                ctx2.strokeRect(cx - 15, cy - 15, 15, 15);
            }

            // 5. 레이저 광선 발사 및 반사
            const laserColor = document.getElementById('laserColorSelect2').value;
            const incRad = (-90 - incAngle2) * Math.PI / 180;
            const refRad = (-90 + incAngle2) * Math.PI / 180;

            if (isLaserOn2) {
                const laserLen = radius + 20;
                const srcX = cx + laserLen * Math.cos(incRad);
                const srcY = cy + laserLen * Math.sin(incRad);

                ctx2.strokeStyle = laserColor;
                ctx2.lineWidth = 4;
                ctx2.shadowColor = laserColor;
                ctx2.shadowBlur = 12;
                ctx2.beginPath();
                ctx2.moveTo(srcX, srcY);
                ctx2.lineTo(cx, cy);
                ctx2.stroke();

                const destX = cx + laserLen * Math.cos(refRad);
                const destY = cy + laserLen * Math.sin(refRad);
                ctx2.beginPath();
                ctx2.moveTo(cx, cy);
                ctx2.lineTo(destX, destY);
                ctx2.stroke();
                ctx2.shadowBlur = 0;

                ctx2.fillStyle = "#ffffff";
                ctx2.beginPath(); ctx2.arc(cx, cy, 5, 0, Math.PI * 2); ctx2.fill();

                ctx2.save();
                ctx2.translate(srcX, srcY);
                ctx2.rotate(Math.atan2(cy - srcY, cx - srcX));
                
                ctx2.strokeStyle = "rgba(56, 189, 248, 0.4)";
                ctx2.lineWidth = 2;
                ctx2.setLineDash([4, 3]);
                ctx2.strokeRect(-50, -18, 56, 36);
                ctx2.setLineDash([]);

                ctx2.fillStyle = "#334155";
                ctx2.fillRect(-45, -12, 45, 24);
                ctx2.fillStyle = "#64748b";
                ctx2.fillRect(-45, -8, 12, 16);
                ctx2.fillStyle = laserColor;
                ctx2.fillRect(-4, -5, 4, 10);
                ctx2.restore();

                ctx2.fillStyle = "#38bdf8";
                ctx2.font = "bold 11px sans-serif";
                ctx2.fillText("👆 드래그 가능", srcX, srcY - 24);

                if (incAngle2 > 5) {
                    ctx2.strokeStyle = "#ef4444";
                    ctx2.lineWidth = 2.5;
                    ctx2.beginPath();
                    ctx2.arc(cx, cy, 70, incRad, -Math.PI/2);
                    ctx2.stroke();
                    ctx2.fillStyle = "#ef4444";
                    ctx2.font = "bold 13px sans-serif";
                    const incMidRad = (-90 - incAngle2 / 2) * Math.PI / 180;
                    ctx2.fillText(`입사각 ${incAngle2}°`, cx + 105 * Math.cos(incMidRad), cy + 105 * Math.sin(incMidRad));

                    ctx2.strokeStyle = "#f59e0b";
                    ctx2.lineWidth = 2.5;
                    ctx2.beginPath();
                    ctx2.arc(cx, cy, 70, -Math.PI/2, refRad);
                    ctx2.stroke();
                    ctx2.fillStyle = "#f59e0b";
                    const refMidRad = (-90 + incAngle2 / 2) * Math.PI / 180;
                    ctx2.fillText(`반사각 ${incAngle2}°`, cx + 105 * Math.cos(refMidRad), cy + 105 * Math.sin(refMidRad));
                }
            }

            document.getElementById('s2IncBadge').innerText = `${incAngle2}°`;
            document.getElementById('s2RefBadge').innerText = `${incAngle2}°`;
        }

        // ==========================================
        // STEP 3: 정반사·난반사 & 물리 상 작도
        // ==========================================
        const canvas3 = document.getElementById('simCanvas3');
        const ctx3 = canvas3.getContext('2d');
        let step3Mode = 'mirror';
        let eye3 = { x: 180, y: 120 };
        let isDraggingEye3 = false;

        function resetEyePos3() {
            eye3 = { x: 180, y: 120 };
            drawSim3();
        }

        function switchStep3Mode(mode) {
            step3Mode = mode;
            document.getElementById('s3ModeBtn1').className = (mode === 'roughness') ? "sim-btn" : "sim-btn secondary";
            document.getElementById('s3ModeBtn2').className = (mode === 'mirror') ? "sim-btn" : "sim-btn secondary";

            document.getElementById('s3ControlsRoughness').style.display = (mode === 'roughness') ? "flex" : "none";
            document.getElementById('s3ControlsMirror').style.display = (mode === 'mirror') ? "flex" : "none";

            document.getElementById('s3Info1').style.display = (mode === 'roughness') ? "block" : "none";
            document.getElementById('s3Info2').style.display = (mode === 'mirror') ? "block" : "none";
            document.getElementById('s3Info3').style.display = (mode === 'mirror') ? "block" : "none";
            document.getElementById('s3Info4').style.display = (mode === 'mirror') ? "block" : "none";

            drawSim3();
        }

        function getPos3(e) {
            const rect = canvas3.getBoundingClientRect();
            let cx = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0].clientX);
            let cy = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0].clientY);
            return { x: cx - rect.left, y: cy - rect.top };
        }

        canvas3.addEventListener('mousedown', e => {
            if (!document.getElementById('step3').classList.contains('active')) return;
            if (step3Mode !== 'mirror') return;
            const pos = getPos3(e);
            if (Math.hypot(pos.x - eye3.x, pos.y - eye3.y) < 36) {
                isDraggingEye3 = true;
            }
        });

        function handleEyeMove(pos) {
            const mx = 440;
            const groundY = 340;
            eye3.x = Math.max(50, Math.min(mx - 40, pos.x));
            eye3.y = Math.max(40, Math.min(groundY - 20, pos.y));
            drawSim3();
        }

        canvas3.addEventListener('mousemove', e => {
            if (!document.getElementById('step3').classList.contains('active')) return;
            if (step3Mode !== 'mirror') return;
            const pos = getPos3(e);
            if (isDraggingEye3) {
                handleEyeMove(pos);
            } else {
                if (Math.hypot(pos.x - eye3.x, pos.y - eye3.y) < 36) {
                    canvas3.style.cursor = 'grab';
                } else {
                    canvas3.style.cursor = 'default';
                }
            }
        });

        window.addEventListener('mouseup', () => { isDraggingEye3 = false; });

        canvas3.addEventListener('touchstart', e => {
            if (!document.getElementById('step3').classList.contains('active')) return;
            if (step3Mode !== 'mirror') return;
            const pos = getPos3(e);
            if (Math.hypot(pos.x - eye3.x, pos.y - eye3.y) < 45) {
                isDraggingEye3 = true;
                e.preventDefault();
            }
        }, {passive: false});

        canvas3.addEventListener('touchmove', e => {
            if (document.getElementById('step3').classList.contains('active') && step3Mode === 'mirror' && isDraggingEye3) {
                const pos = getPos3(e);
                handleEyeMove(pos);
                e.preventDefault();
            }
        }, {passive: false});

        window.addEventListener('touchend', () => { isDraggingEye3 = false; });

        function drawSim3() {
            ctx3.clearRect(0, 0, canvas3.width, canvas3.height);
            if (step3Mode === 'roughness') {
                drawRoughnessMode();
            } else {
                drawMirrorMode();
            }
        }

        function drawRoughnessMode() {
            const roughness = parseInt(document.getElementById('roughSlider3').value);
            const rayCount = parseInt(document.getElementById('rayCountSlider3').value);
            document.getElementById('rayCountLabel3').innerText = `${rayCount}줄기`;

            let roughTxt = `${roughness}% `;
            if (roughness === 0) roughTxt += "(완전 매끄러움 - 정반사)";
            else if (roughness < 40) roughTxt += "(약간 거침)";
            else roughTxt += "(매우 거침 - 난반사)";
            document.getElementById('roughLabel3').innerText = roughTxt;

            const info1 = document.getElementById('s3Info1');
            if (roughness === 0) {
                info1.innerHTML = `반사 상태: <span class="badge badge-pos">정반사 (나란히 반사되어 선명한 상 형성)</span>`;
            } else {
                info1.innerHTML = `반사 상태: <span class="badge badge-yellow">난반사 (사방으로 흩어져 상이 비치지 않음)</span>`;
            }

            const groundY = 320;
            const startX = 140;
            const endX = 740;
            const stepW = (endX - startX) / 40;

            ctx3.beginPath();
            ctx3.moveTo(startX, groundY);
            for (let i = 0; i <= 40; i++) {
                const px = startX + i * stepW;
                const noise = Math.sin(i * 1.5) * Math.cos(i * 0.7) * (roughness * 0.28);
                ctx3.lineTo(px, groundY + noise);
            }
            ctx3.lineTo(endX, groundY + 80);
            ctx3.lineTo(startX, groundY + 80);
            ctx3.closePath();
            ctx3.fillStyle = "#1e293b";
            ctx3.fill();
            ctx3.strokeStyle = (roughness === 0) ? "#38bdf8" : "#94a3b8";
            ctx3.lineWidth = 3;
            ctx3.stroke();

            ctx3.fillStyle = "#cbd5e1";
            ctx3.font = "bold 13px sans-serif";
            ctx3.textAlign = "center";
            ctx3.fillText(roughness === 0 ? "매끄러운 거울면 (정반사)" : "울퉁불퉁하고 거친 면 (난반사)", 440, groundY + 50);

            const raySpacing = (endX - startX - 180) / (rayCount - 1);

            for (let r = 0; r < rayCount; r++) {
                const hitX = startX + 90 + r * raySpacing;
                const idx = (hitX - startX) / stepW;
                const slope = Math.cos(idx * 1.5) * 1.5 * (roughness * 0.28 / stepW);
                const surfaceAngle = Math.atan(slope);
                const normalAngle = surfaceAngle - Math.PI / 2;

                const hitY = groundY + Math.sin(idx * 1.5) * Math.cos(idx * 0.7) * (roughness * 0.28);

                const srcX = hitX - 160;
                const srcY = hitY - 160;
                ctx3.strokeStyle = "#ef4444";
                ctx3.lineWidth = 3;
                ctx3.beginPath();
                ctx3.moveTo(srcX, srcY);
                ctx3.lineTo(hitX, hitY);
                ctx3.stroke();

                const inDir = Math.atan2(hitY - srcY, hitX - srcX);
                const refDir = 2 * normalAngle - inDir + Math.PI;

                const destX = hitX + 160 * Math.cos(refDir);
                const destY = hitY + 160 * Math.sin(refDir);
                ctx3.strokeStyle = (roughness === 0) ? "#38bdf8" : "#f59e0b";
                ctx3.lineWidth = 3;
                ctx3.beginPath();
                ctx3.moveTo(hitX, hitY);
                ctx3.lineTo(destX, destY);
                ctx3.stroke();

                if (roughness > 0) {
                    ctx3.strokeStyle = "rgba(148, 163, 184, 0.4)";
                    ctx3.lineWidth = 1;
                    ctx3.setLineDash([3, 3]);
                    ctx3.beginPath();
                    ctx3.moveTo(hitX, hitY);
                    ctx3.lineTo(hitX + 35 * Math.cos(normalAngle), hitY + 35 * Math.sin(normalAngle));
                    ctx3.stroke();
                    ctx3.setLineDash([]);
                }
            }
        }

        function drawMirrorMode() {
            const dist = parseInt(document.getElementById('objDistSlider3').value);
            const height = parseInt(document.getElementById('objHeightSlider3').value);

            document.getElementById('objDistLabel3').innerText = `${(dist / 10).toFixed(1)} cm`;
            document.getElementById('objHeightLabel3').innerText = `${(height / 10).toFixed(1)} cm`;

            document.getElementById('s3Info2').innerHTML = `물체와 거울 거리: <span class="badge badge-yellow">${(dist / 10).toFixed(1)} cm</span>`;
            document.getElementById('s3Info3').innerHTML = `거울과 상의 거리: <span class="badge badge-green">${(dist / 10).toFixed(1)} cm (정확히 일치)</span>`;

            const mx = 440;
            const groundY = 340;
            const mirrorTop = 40;

            // 바닥면
            ctx3.strokeStyle = "#334155";
            ctx3.lineWidth = 2;
            ctx3.beginPath();
            ctx3.moveTo(50, groundY);
            ctx3.lineTo(830, groundY);
            ctx3.stroke();

            // 평면거울
            ctx3.strokeStyle = "#38bdf8";
            ctx3.lineWidth = 6;
            ctx3.beginPath();
            ctx3.moveTo(mx, mirrorTop);
            ctx3.lineTo(mx, groundY);
            ctx3.stroke();

            // 거울 뒷면 빗금
            ctx3.strokeStyle = "rgba(56, 189, 248, 0.35)";
            ctx3.lineWidth = 1.5;
            for (let y = mirrorTop + 10; y <= groundY - 10; y += 15) {
                ctx3.beginPath();
                ctx3.moveTo(mx, y);
                ctx3.lineTo(mx + 10, y + 10);
                ctx3.stroke();
            }

            ctx3.fillStyle = "#38bdf8";
            ctx3.font = "bold 13px sans-serif";
            ctx3.textAlign = "center";
            ctx3.fillText("평면거울 (반사면)", mx, mirrorTop - 12);

            // 실물 촛불
            const objX = mx - dist;
            const objFlameY = groundY - height;

            ctx3.fillStyle = "#ef4444";
            ctx3.fillRect(objX - 7, objFlameY + 16, 14, height - 16);
            ctx3.fillStyle = "#f59e0b";
            ctx3.beginPath();
            ctx3.ellipse(objX, objFlameY + 8, 6, 10, 0, 0, Math.PI * 2);
            ctx3.fill();
            ctx3.fillStyle = "#fff";
            ctx3.beginPath();
            ctx3.ellipse(objX, objFlameY + 9, 3, 5, 0, 0, Math.PI * 2);
            ctx3.fill();

            ctx3.fillStyle = "#ffffff";
            ctx3.font = "bold 12px sans-serif";
            ctx3.fillText("물체(촛불)", objX, groundY + 22);

            // 가상 상
            const imgX = mx + dist;
            const imgFlameY = groundY - height;

            ctx3.fillStyle = "rgba(239, 68, 68, 0.4)";
            ctx3.fillRect(imgX - 7, imgFlameY + 16, 14, height - 16);
            ctx3.strokeStyle = "#ef4444";
            ctx3.lineWidth = 1.5;
            ctx3.strokeRect(imgX - 7, imgFlameY + 16, 14, height - 16);

            ctx3.fillStyle = "rgba(245, 158, 11, 0.45)";
            ctx3.beginPath();
            ctx3.ellipse(imgX, imgFlameY + 8, 6, 10, 0, 0, Math.PI * 2);
            ctx3.fill();
            ctx3.fillStyle = "#f59e0b";
            ctx3.fillText("거울 속 상 (가상 상)", imgX, groundY + 22);

            // 광선 작도 및 시선 가림 계산
            const hitYTop = eye3.y + (objFlameY + 8 - eye3.y) * ((mx - eye3.x) / (imgX - eye3.x));
            const hitYBot = eye3.y + (groundY - eye3.y) * ((mx - eye3.x) / (imgX - eye3.x));

            const isTopInMirror = (hitYTop >= mirrorTop && hitYTop <= groundY);
            const isBotInMirror = (hitYBot >= mirrorTop && hitYBot <= groundY);

            let isTopBlocked = false;
            let isBotBlocked = false;
            let blockXTop = eye3.x, blockYTop = eye3.y;
            let blockXBot = eye3.x, blockYBot = eye3.y;

            const candleEdgeX = objX + 7;

            if (eye3.x < candleEdgeX) {
                const tTop = (candleEdgeX - mx) / (eye3.x - mx);
                const yCrossTop = hitYTop + (eye3.y - hitYTop) * tTop;
                if (yCrossTop >= objFlameY && yCrossTop <= groundY) {
                    isTopBlocked = true;
                    blockXTop = candleEdgeX;
                    blockYTop = yCrossTop;
                }

                const tBot = (candleEdgeX - mx) / (eye3.x - mx);
                const yCrossBot = hitYBot + (eye3.y - hitYBot) * tBot;
                if (yCrossBot >= objFlameY && yCrossBot <= groundY) {
                    isBotBlocked = true;
                    blockXBot = candleEdgeX;
                    blockYBot = yCrossBot;
                }
            }

            if (isTopInMirror) {
                ctx3.strokeStyle = "#f59e0b";
                ctx3.lineWidth = 2.5;
                ctx3.beginPath();
                ctx3.moveTo(objX, objFlameY + 8);
                ctx3.lineTo(mx, hitYTop);
                ctx3.stroke();

                const midInX1 = (objX + mx) / 2;
                const midInY1 = (objFlameY + 8 + hitYTop) / 2;
                ctx3.fillStyle = "#f59e0b";
                ctx3.beginPath(); ctx3.arc(midInX1, midInY1, 3.5, 0, Math.PI*2); ctx3.fill();

                ctx3.beginPath();
                ctx3.moveTo(mx, hitYTop);
                if (isTopBlocked) {
                    ctx3.lineTo(blockXTop, blockYTop);
                    ctx3.stroke();
                    ctx3.fillStyle = "#ef4444";
                    ctx3.font = "bold 13px sans-serif";
                    ctx3.fillText("✖", blockXTop, blockYTop + 4);
                } else {
                    ctx3.lineTo(eye3.x, eye3.y);
                    ctx3.stroke();
                }

                ctx3.strokeStyle = "#f87171";
                ctx3.lineWidth = 1.8;
                ctx3.setLineDash([5, 4]);
                ctx3.beginPath();
                ctx3.moveTo(mx, hitYTop);
                ctx3.lineTo(imgX, imgFlameY + 8);
                ctx3.stroke();
                ctx3.setLineDash([]);
            }

            if (isBotInMirror) {
                ctx3.strokeStyle = "#38bdf8";
                ctx3.lineWidth = 2;
                ctx3.beginPath();
                ctx3.moveTo(objX, groundY);
                ctx3.lineTo(mx, hitYBot);
                if (isBotBlocked) {
                    ctx3.lineTo(blockXBot, blockYBot);
                    ctx3.stroke();
                    ctx3.fillStyle = "#ef4444";
                    ctx3.font = "bold 13px sans-serif";
                    ctx3.fillText("✖", blockXBot, blockYBot + 4);
                } else {
                    ctx3.lineTo(eye3.x, eye3.y);
                    ctx3.stroke();
                }

                ctx3.strokeStyle = "#38bdf8";
                ctx3.lineWidth = 1.6;
                ctx3.setLineDash([5, 4]);
                ctx3.beginPath();
                ctx3.moveTo(mx, hitYBot);
                ctx3.lineTo(imgX, groundY);
                ctx3.stroke();
                ctx3.setLineDash([]);
            }

            const rayBadge = document.getElementById('s3RayStatusBadge');
            if (isTopBlocked && isBotBlocked) {
                rayBadge.innerText = "🚫 물체(촛불)에 빛이 가려져 눈에 도달하지 않음 (상이 보이지 않음)";
                rayBadge.className = "badge badge-red";
            } else if (isTopBlocked || isBotBlocked) {
                rayBadge.innerText = "⚠️ 물체(촛불)에 일부 빛이 가려져 상이 온전히 보이지 않음";
                rayBadge.className = "badge badge-yellow";
            } else if (!isTopInMirror && !isBotInMirror) {
                rayBadge.innerText = "거울 범위를 벗어나 관찰자에게 상이 보이지 않음";
                rayBadge.className = "badge badge-red";
            } else if (!isTopInMirror || !isBotInMirror) {
                rayBadge.innerText = "반사 광선 일부가 거울 범위를 벗어남";
                rayBadge.className = "badge badge-yellow";
            } else {
                rayBadge.innerText = "관찰자의 눈에 상의 전체 모습이 선명하게 도달함";
                rayBadge.className = "badge badge-green";
            }

            // 관찰자 눈 렌더링
            ctx3.save();
            ctx3.translate(eye3.x, eye3.y);
            ctx3.strokeStyle = (isTopBlocked && isBotBlocked) ? "rgba(239, 68, 68, 0.6)" : "rgba(56, 189, 248, 0.45)";
            ctx3.lineWidth = 2;
            ctx3.setLineDash([4, 3]);
            ctx3.beginPath();
            ctx3.arc(0, 0, 24, 0, Math.PI * 2);
            ctx3.stroke();
            ctx3.setLineDash([]);

            ctx3.fillStyle = "#ffffff";
            ctx3.beginPath();
            ctx3.ellipse(0, 0, 16, 11, 0, 0, Math.PI * 2);
            ctx3.fill();
            ctx3.strokeStyle = "#64748b";
            ctx3.lineWidth = 2;
            ctx3.stroke();

            ctx3.fillStyle = (isTopBlocked && isBotBlocked) ? "#ef4444" : "#0284c7";
            ctx3.beginPath();
            ctx3.arc(4, 0, 7, 0, Math.PI * 2);
            ctx3.fill();

            ctx3.fillStyle = "#0f172a";
            ctx3.beginPath();
            ctx3.arc(5, 0, 4, 0, Math.PI * 2);
            ctx3.fill();

            ctx3.fillStyle = "#ffffff";
            ctx3.beginPath();
            ctx3.arc(4, -2, 1.5, 0, Math.PI * 2);
            ctx3.fill();
            ctx3.restore();

            ctx3.fillStyle = (isTopBlocked && isBotBlocked) ? "#ef4444" : "#38bdf8";
            ctx3.font = "bold 12px sans-serif";
            ctx3.textAlign = "center";
            ctx3.fillText((isTopBlocked && isBotBlocked) ? "👁️ 물체 뒤에 가려짐 (빛 차단됨)" : "👁️ 관찰자의 눈 (드래그 가능)", eye3.x, eye3.y - 30);
        }

        // ==========================================
        // STEP 4: 형성평가 문항 데이터
        // ==========================================
        

        

        // 초기 구동
        window.addEventListener('DOMContentLoaded', () => {
            checkAndApplyStudentAuth();
            updateStepLockUI();
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
