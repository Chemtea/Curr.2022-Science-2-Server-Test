window.addEventListener('lesson-step-change', event => { const stepNum = event.detail;
            
});
        
        
        

        

        

        // ==========================================
        // STEP 2: 가전제품 시뮬레이션 및 심화 계산기
        // ==========================================
        const appData = {
            iron: { name: "전기다리미", icon: "👔", power: 1500, desc: "열선에 전류를 흘려 높은 열을 발생시켜 옷을 다립니다.", correct: ["heat"] },
            fan: { name: "선풍기", icon: "🌀", power: 50, desc: "모터를 회전시켜 시원한 바람을 일으킵니다.", correct: ["kinetic"] },
            dryer: { name: "헤어드라이어", icon: "💨", power: 1600, desc: "열선으로 뜨거운 열을 내고 모터 팬으로 강한 바람을 뿜어냅니다.", correct: ["heat", "kinetic", "sound"] },
            tv: { name: "스마트 TV", icon: "📺", power: 200, desc: "디스플레이 화면(빛)과 스피커(소리)로 영상과 음향을 전달합니다.", correct: ["light", "sound"] },
            phone: { name: "스마트폰 충전", icon: "🔋", power: 15, desc: "공급된 전기를 리튬이온 배터리 내부에 화학 에너지 형태로 저장합니다.", correct: ["chemical"] }
        };

        let currentAppKey = 'iron';
        let selectedEnergies = [];

        function selectAppliance(key, element) {
            currentAppKey = key;
            const data = appData[key];

            document.querySelectorAll('.app-card').forEach(card => card.classList.remove('active'));
            if (element) element.classList.add('active');

            document.getElementById('appBigIcon').innerText = data.icon;
            document.getElementById('appTitle').innerText = `${data.name} (소비 전력: ${data.power} W)`;
            document.getElementById('appDesc').innerText = data.desc;
            document.getElementById('calcPower').value = data.power;

            // 선택 상태 초기화
            selectedEnergies = [];
            document.querySelectorAll('.energy-btn').forEach(btn => btn.classList.remove('selected'));
            document.getElementById('energyAnswerFeedback').style.display = 'none';

            calculateJoules();
        }

        function toggleEnergy(btn, energyType) {
            btn.classList.toggle('selected');
            if (selectedEnergies.includes(energyType)) {
                selectedEnergies = selectedEnergies.filter(e => e !== energyType);
            } else {
                selectedEnergies.push(energyType);
            }
        }

        function checkEnergyAnswer() {
            const correctList = appData[currentAppKey].correct;
            const fb = document.getElementById('energyAnswerFeedback');
            fb.style.display = 'block';

            const isMatch = correctList.every(val => selectedEnergies.includes(val)) && selectedEnergies.length === correctList.length;

            if (isMatch) {
                fb.style.color = "#10b981";
                fb.innerHTML = `🎉 정답입니다! [${appData[currentAppKey].name}]은(는) 전기 에너지를 성공적으로 전환했습니다.`;
            } else {
                fb.style.color = "#f59e0b";
                const korNames = { heat: "열", kinetic: "운동", light: "빛", sound: "소리", chemical: "화학" };
                const correctNames = correctList.map(k => korNames[k]).join(", ");
                fb.innerHTML = `💡 다시 생각해보세요! [${appData[currentAppKey].name}]의 주된 전환 에너지는 [<b>${correctNames} 에너지</b>] 입니다.`;
            }
        }

        // 심화 학습 토글 및 계산기 연동
        function toggleAdvanced() {
            const adv = document.getElementById('advancedArea');
            const btn = document.querySelector('.advanced-toggle-btn');
            if (adv.style.display === 'block') {
                adv.style.display = 'none';
                btn.innerText = "➕ [심화 탐구] 소비 전력과 전기 에너지(J) 직접 계산해보기 (클릭하여 열기)";
            } else {
                adv.style.display = 'block';
                btn.innerText = "➖ [심화 탐구] 계산창 닫기";
                calculateJoules();
            }
        }

        function calculateJoules() {
            const power = parseFloat(document.getElementById('calcPower').value) || 0;
            const minutes = parseFloat(document.getElementById('calcMinutes').value) || 0;
            const seconds = minutes * 60;

            document.getElementById('calcSeconds').value = `${seconds.toLocaleString()} 초`;
            const totalJ = power * seconds;
            const totalKJ = (totalJ / 1000).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 });

            document.getElementById('calcResultJ').innerText = totalJ.toLocaleString() + " J";
            document.getElementById('calcResultNote').innerText = `(약 ${totalKJ} kJ의 에너지가 전환되어 사용되었습니다!)`;
        }

        // ==========================================
        // STEP 3: 서브탭, 등급, 대기전력, 전기요금
        // ==========================================
        function switchSubTab(subKey) {
            document.querySelectorAll('.tab-sub-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.sub-panel').forEach(p => p.classList.remove('active'));

            const tabMap = { 'eff': 0, 'grade': 1, 'standby': 2, 'tariff': 3 };
            const idx = tabMap[subKey];
            document.querySelectorAll('.tab-sub-btn')[idx].classList.add('active');
            document.getElementById(`sub-${subKey}`).classList.add('active');

            if(subKey === 'tariff') updateTariffSim();
        }

        function updateGradeSim() {
            const grade = parseInt(document.getElementById('gradeSlider').value);
            const circle = document.getElementById('gradeCircle');
            const text = document.getElementById('gradeText');
            const usage = document.getElementById('gradePowerUsage');
            const rank = document.getElementById('gradeRank');

            const colors = ["#10b981", "#3b82f6", "#f59e0b", "#f97316", "#ef4444"];
            circle.innerText = `${grade}등급`;
            circle.style.background = colors[grade - 1];

            const usageData = [180, 220, 260, 310, 370];
            usage.innerText = `${usageData[grade - 1]} kWh/년`;
            usage.style.color = colors[grade - 1];

            if (grade === 1) {
                text.innerText = "최고 효율 제품 (5등급 대비 약 30~40% 에너지 절약)";
                rank.innerText = "가장 우수함 (권장)";
                rank.style.color = "#10b981";
            } else if (grade === 5) {
                text.innerText = "최저 효율 제품 (전기 에너지 소모가 가장 큼)";
                rank.innerText = "에너지 소비 많음";
                rank.style.color = "#ef4444";
            } else {
                text.innerText = `중간 효율 제품 (${grade}등급 기준 소비 효율)`;
                rank.innerText = "보통 수준";
                rank.style.color = colors[grade - 1];
            }
        }

        function selectBtnQuiz(type, element) {
            document.querySelectorAll('.btn-card').forEach(c => c.classList.remove('selected'));
            if (element) element.classList.add('selected');

            const fb = document.getElementById('standbyFeedback');
            fb.style.display = 'block';

            if (type === 'standby') {
                fb.style.borderLeft = "5px solid #f59e0b";
                fb.innerHTML = `
                    <h4 style="color: #f59e0b; margin-bottom: 6px;">⚠️ 기호 A : 대기 전력이 발생하는 제품 (Standby)</h4>
                    <p style="font-size: 0.9rem; color: #cbd5e1;">
                        • <b>특징:</b> 윗부분이 열린 원 위로 세로선이 뚫고 나온 형태입니다. 리모컨 수신이나 시계 표시 등을 위해 <b>전원 버튼을 꺼도 플러그가 꽂혀 있으면 전기가 계속 소모</b>됩니다.<br>
                        • <b>절약 실천:</b> 사용하지 않을 때는 멀티탭 스위치를 끄거나 플러그를 뽑아야 전기가 절약됩니다.
                    </p>
                `;
            } else {
                fb.style.borderLeft = "5px solid #10b981";
                fb.innerHTML = `
                    <h4 style="color: #10b981; margin-bottom: 6px;">✅ 기호 B : 대기 전력이 완전 차단되는 제품 (Zero Watt)</h4>
                    <p style="font-size: 0.9rem; color: #cbd5e1;">
                        • <b>특징:</b> 닫힌 동그라미 안에 세로선이 온전히 갇혀 있는 형태입니다. 버튼을 끄는 순간 물리적으로 전원 회로가 완전히 끊겨 <b>플러그를 꽂아 두어도 대기 전력이 0 W</b>입니다.
                    </p>
                `;
            }
        }

        // 대한민국 주택용 전기요금 누진제 계산 모델
        function updateTariffSim() {
            const usage = parseInt(document.getElementById('tariffSlider').value);
            document.getElementById('tariffUsageDisplay').innerText = `${usage} kWh / 월`;

            const m1 = document.getElementById('meterT1');
            const m2 = document.getElementById('meterT2');
            const m3 = document.getElementById('meterT3');

            if (usage <= 200) {
                m1.style.width = `${(usage / 200) * 100 * (200/700)}%`;
                m2.style.width = `0%`;
                m3.style.width = `0%`;
            } else if (usage <= 400) {
                m1.style.width = `${(200 / 700) * 100}%`;
                m2.style.width = `${((usage - 200) / 700) * 100}%`;
                m3.style.width = `0%`;
            } else {
                m1.style.width = `${(200 / 700) * 100}%`;
                m2.style.width = `${(200 / 700) * 100}%`;
                m3.style.width = `${((usage - 400) / 700) * 100}%`;
            }

            let baseRate = 910;
            let energyCharge = 0;
            let tierText = "";
            let tierColor = "#10b981";

            if (usage <= 200) {
                baseRate = 910;
                energyCharge = usage * 120;
                tierText = "1구간 (기본 알뜰 구간)";
                tierColor = "#10b981";
            } else if (usage <= 400) {
                baseRate = 1600;
                energyCharge = (200 * 120) + ((usage - 200) * 214);
                tierText = "2구간 (일반 표준 구간)";
                tierColor = "#f59e0b";
            } else {
                baseRate = 7300;
                energyCharge = (200 * 120) + (200 * 214) + ((usage - 400) * 307);
                tierText = "3구간 (누진세 가중 구간 ⚠️)";
                tierColor = "#ef4444";
            }

            const rawTotal = (baseRate + energyCharge) * 1.137;
            const totalBill = Math.round(rawTotal / 10) * 10;
            const avgUnitPrice = Math.round(totalBill / usage);

            const tierDisp = document.getElementById('tariffTierDisplay');
            tierDisp.innerText = tierText;
            tierDisp.style.color = tierColor;

            document.getElementById('tariffCostDisplay').innerText = `약 ${totalBill.toLocaleString()} 원`;
            document.getElementById('tariffUnitDisplay').innerText = `약 ${avgUnitPrice.toLocaleString()} 원/kWh`;
        }

        // ==========================================
        // STEP 4: 형성평가 문항 데이터 및 오답 피드백 UI
        // ==========================================
        

        

        // 초기 구동
        window.addEventListener('DOMContentLoaded', () => {
            checkAndApplyStudentAuth();
            updateStepLockUI();

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
