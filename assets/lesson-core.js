
        // ==========================================
        // ★ 실시간 단계별 잠금 상태 관리 (POST 방식)
        // ==========================================
        const GOOGLE_SCRIPT_URL = window.PLATFORM_CONFIG.PLATFORM_API;
        const SUBMISSION_API_URL = window.PLATFORM_CONFIG.SUBMISSION_API;
        const ACADEMIC_YEAR_API_URL = window.PLATFORM_CONFIG.ACADEMIC_YEAR_API;
        let CURRENT_SCHOOL_YEAR = 2026; // 서버 확인 실패 시 fallback
        const THIS_LESSON_KEY = window.LESSON_CONFIG.lessonKey;

        // ==========================================
        // ★ 학생/교사 계정 세션 확인 및 4단계 자동 입력·인-페이지 로그인
        // ==========================================
        let currentSchoolYearLoadPromise = null;

        async function ensureCurrentSchoolYear() {
            if (currentSchoolYearLoadPromise) return currentSchoolYearLoadPromise;
            currentSchoolYearLoadPromise = (async () => {
                try {
                    const res = await fetch(ACADEMIC_YEAR_API_URL, {
                        method: "POST",
                        headers: { "Content-Type": "text/plain;charset=utf-8" },
                        body: JSON.stringify({ action: "get_public_config" }),
                        cache: "no-store"
                    });
                    const data = await res.json();
                    const year = Number(data && data.currentSchoolYear);
                    if (res.ok && data && data.success === true && Number.isInteger(year) && year >= 2000 && year <= 2100) {
                        CURRENT_SCHOOL_YEAR = year;
                    }
                } catch (err) {
                    console.warn("현재 학년도 확인 실패 - fallback 사용:", err);
                }
                return CURRENT_SCHOOL_YEAR;
            })();
            return currentSchoolYearLoadPromise;
        }

        async function sha256(str) {
            const buffer = new TextEncoder().encode(str);
            const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
        }

        let clientIpAddress = "알 수 없음";

        let lessonAccountFingerprint = null;
        function emitLessonAccountChange() {
            const next = JSON.stringify(window.ScienceContentClient.auth());
            if (lessonAccountFingerprint !== null && next !== lessonAccountFingerprint) window.dispatchEvent(new Event('science-account-change'));
            lessonAccountFingerprint = next;
        }
        function checkAndApplyStudentAuth() {
            const rawUser = window.platformSessionStorage.getItem("current_student");
            const sIdInput = document.getElementById("studentIdInput");
            const sNameInput = document.getElementById("studentNameInput");
            const headerLoginBtn = document.getElementById("headerLoginBtn");
            const headerLogoutBtn = document.getElementById("headerLogoutBtn");
            const headerLoginStatus = document.getElementById("headerLoginStatus");

            if (rawUser) {
                try {
                    const user = JSON.parse(rawUser);
                    const isAdminUser = user.isAdmin === true;
                    const storedStudentToken = String(user.studentSessionToken || "").trim();
                    const storedAdminToken = String(window.platformSessionStorage.getItem("current_admin_key") || "").trim();

                    // 예전 버그로 저장된 "토큰 없는 로그인"은 로그인으로 인정하지 않습니다.
                    if (
                        (!isAdminUser && !storedStudentToken.startsWith("stu_")) ||
                        (isAdminUser && !storedAdminToken.startsWith("adm_"))
                    ) {
                        window.platformSessionStorage.removeItem("current_student");
                        if (isAdminUser) window.platformSessionStorage.removeItem("current_admin_key");
                        throw new Error("유효한 로그인 세션 토큰이 없습니다.");
                    }

                    if (sIdInput) {
                        sIdInput.value = user.studentId || "";
                        sIdInput.readOnly = true;
                        sIdInput.style.backgroundColor = "#1e293b";
                        sIdInput.style.color = "#38bdf8";
                        sIdInput.style.fontWeight = "bold";
                        sIdInput.style.cursor = "not-allowed";
                    }

                    if (sNameInput) {
                        sNameInput.value = user.name || "";
                        sNameInput.readOnly = true;
                        sNameInput.style.backgroundColor = "#1e293b";
                        sNameInput.style.color = "#38bdf8";
                        sNameInput.style.fontWeight = "bold";
                        sNameInput.style.cursor = "not-allowed";
                    }

                    if (headerLoginStatus) {
                        const displayName = user.name || user.studentId || "사용자";
                        headerLoginStatus.textContent = `✅ ${displayName} 로그인 중`;
                        headerLoginStatus.style.color = "#86efac";
                        headerLoginStatus.style.borderColor = "#166534";
                    }
                    if (headerLoginBtn) headerLoginBtn.style.display = "none";
                    if (headerLogoutBtn) headerLogoutBtn.style.display = "inline-block";

                    // 관리자 공통 로그인 세션이 있으면 별도 비밀번호 입력 없이 관리자 모드를 복원합니다.
                    if (user.isAdmin === true) {
                        activateAdminModeFromSession(false);
                    }
                    emitLessonAccountChange();
                    return;
                } catch (error) {
                    console.warn("current_student 정보를 읽는 중 오류 발생:", error);
                    window.platformSessionStorage.removeItem("current_student");
                }
            }

            // Submission always uses the authenticated account, never typed identity.
            for (const input of [sIdInput, sNameInput]) {
                if (!input) continue;
                input.value = ''; input.readOnly = true; input.placeholder = '로그인 후 자동 입력';
                input.style.cssText = '';
            }

            if (headerLoginStatus) {
                headerLoginStatus.textContent = "👤 미로그인";
                headerLoginStatus.style.color = "#94a3b8";
                headerLoginStatus.style.borderColor = "#334155";
            }
            if (headerLoginBtn) headerLoginBtn.style.display = "inline-block";
            if (headerLogoutBtn) headerLogoutBtn.style.display = "none";
            emitLessonAccountChange();
        }

        function logoutPageUser() {
            window.platformSessionStorage.removeItem("current_student");
            window.platformSessionStorage.removeItem("current_admin_key");
            isAdminActive = false;
            cachedAdminKey = "";
            const adminBar = document.getElementById('adminStepBar');
            if (adminBar) adminBar.style.display = 'none';
            closePageLoginModal();
            checkAndApplyStudentAuth();
            updateStepLockUI();
            alert("로그아웃되었습니다.");
        }

        function openPageLoginModal() {
            const modal = document.getElementById("pageLoginModal");
            const idInput = document.getElementById("pageLoginId");
            const pwInput = document.getElementById("pageLoginPw");
            if (!modal) return;

            if (idInput) idInput.value = "";
            if (pwInput) pwInput.value = "";
            modal.style.display = "flex";
            setTimeout(() => { if (idInput) idInput.focus(); }, 50);
        }

        function closePageLoginModal() {
            const modal = document.getElementById("pageLoginModal");
            if (modal) modal.style.display = "none";
        }

        async function submitPageLogin() {
            const idElement = document.getElementById("pageLoginId");
            const pwElement = document.getElementById("pageLoginPw");
            const btn = document.getElementById("btnSubmitPageLogin");

            if (!idElement || !pwElement || !btn) {
                alert("로그인 입력 요소를 찾을 수 없습니다.");
                return;
            }

            const idInput = idElement.value.trim();
            const pwInput = pwElement.value.trim();

            if (!idInput) {
                alert("학번(4자리) 또는 ID(admin)를 입력해주세요.");
                return;
            }
            if (!pwInput) {
                alert("비밀번호를 입력해주세요.");
                return;
            }

            btn.disabled = true;
            btn.innerText = "로그인 중...";

            try {
                await ensureCurrentSchoolYear();
                const pwHash = await sha256(pwInput);
                const response = await fetch(GOOGLE_SCRIPT_URL, {
                    method: "POST",
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify({
                        action: "student_login",
                        studentId: idInput,
                        schoolYear: CURRENT_SCHOOL_YEAR,
                        passwordHash: pwHash,
                        ip: clientIpAddress,
                        userAgent: navigator.userAgent
                    })
                });

                let data = await response.json();

                if (!data.success) {
                    alert("❌ " + (data.message || "로그인에 실패했습니다."));
                    return;
                }

                // 비밀번호 초기화/최초 로그인 계정은 지금 입력한 비밀번호를 새 비밀번호로 등록하고
                // 실제 studentSessionToken이 발급된 뒤에만 로그인 완료 처리합니다.
                if (data.isFirstLogin === true && data.isAdmin !== true) {
                    btn.innerText = "새 비밀번호 설정 중...";

                    const registerResponse = await fetch(GOOGLE_SCRIPT_URL, {
                        method: "POST",
                        headers: { "Content-Type": "text/plain;charset=utf-8" },
                        body: JSON.stringify({
                            action: "register_initial_password",
                            studentId: idInput,
                            schoolYear: CURRENT_SCHOOL_YEAR,
                            newPasswordHash: pwHash,
                            newPasswordLength: pwInput.length,
                            ip: clientIpAddress,
                            userAgent: navigator.userAgent
                        })
                    });

                    const registerData = await registerResponse.json();
                    if (!registerData.success) {
                        alert("❌ " + (registerData.message || "새 비밀번호 설정에 실패했습니다."));
                        return;
                    }

                    data = registerData;
                    alert(
                        "🔐 새 비밀번호가 설정되었습니다.\n" +
                        "다음 로그인부터 지금 입력한 비밀번호를 사용하세요."
                    );
                }

                const isAdminUser = data.isAdmin === true;
                const studentToken = String(data.studentSessionToken || "").trim();
                const adminToken = String(data.adminSessionToken || "").trim();

                if (!isAdminUser && !studentToken.startsWith("stu_")) {
                    window.platformSessionStorage.removeItem("current_student");
                    window.platformSessionStorage.removeItem("current_admin_key");
                    checkAndApplyStudentAuth();
                    alert("❌ 학생 로그인 세션을 발급받지 못했습니다. 다시 로그인해 주세요.");
                    return;
                }

                if (isAdminUser && !adminToken.startsWith("adm_")) {
                    window.platformSessionStorage.removeItem("current_student");
                    window.platformSessionStorage.removeItem("current_admin_key");
                    checkAndApplyStudentAuth();
                    alert("❌ 관리자 로그인 세션을 발급받지 못했습니다. 다시 로그인해 주세요.");
                    return;
                }

                window.platformSessionStorage.setItem("current_student", JSON.stringify({
                    studentId: data.studentId,
                    name: data.name,
                    isAdmin: isAdminUser,
                    studentSessionToken: isAdminUser ? "" : studentToken,
                    userId: data.userId || "",
                    schoolYear: data.schoolYear || "",
                    accountType: data.accountType || (isAdminUser ? "admin" : "student"),
                    isManager: data.isManager === true,
                    permissions: Array.isArray(data.permissions) ? data.permissions : []
                }));

                if (isAdminUser) {
                    window.platformSessionStorage.setItem("current_admin_key", adminToken);
                } else {
                    window.platformSessionStorage.removeItem("current_admin_key");
                }

                alert(`👋 반갑습니다, ${data.name} 님!`);
                closePageLoginModal();
                checkAndApplyStudentAuth();
            } catch (err) {
                console.error("로그인 오류:", err);
                alert("통신 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
            } finally {
                btn.disabled = false;
                btn.innerText = "로그인";
            }
        }

        let currentActiveStep = 1;
        let isAdminActive = false;
        let cachedAdminKey = "";
        let fullCloudLocks = {};

        // 기본 잠금 상태: 1단계만 공개(false), 2·3·4단계 잠김(true)
        let stepLocks = {
            1: false,
            2: window.LESSON_CONFIG.trustedBuiltin === true,
            3: window.LESSON_CONFIG.trustedBuiltin === true,
            4: window.LESSON_CONFIG.trustedBuiltin === true
        };

        // 서버에서 받아온 잠금 상태 동기화
        window.handleStepLocksSync = function(cloudData) {
            fullCloudLocks = cloudData || {};
            if (fullCloudLocks.step_locks && fullCloudLocks.step_locks[THIS_LESSON_KEY]) {
                const cloudSteps = fullCloudLocks.step_locks[THIS_LESSON_KEY];
                for (let i = 1; i <= 4; i++) {
                    if (cloudSteps[i] !== undefined) {
                        stepLocks[i] = cloudSteps[i] === true;
                    }
                }
            }
            updateStepLockUI();

            // 만약 현재 학생이 보고 있는 단계가 선생님에 의해 갑자기 잠겼다면 1단계로 강제 복귀
            if (!isAdminActive && stepLocks[currentActiveStep] === true) {
                alert(`📢 선생님이 ${currentActiveStep}단계를 잠갔습니다. 1단계로 자동 이동합니다.`);
                switchStep(1);
            }
        };

        // UI에 자물쇠 및 버튼 활성/비활성 반영
        function updateStepLockUI() {
            window.dispatchEvent(new Event('ctw-admin-change'));
            for (let i = 1; i <= 4; i++) {
                const isLocked = stepLocks[i];
                const tabBtn = document.getElementById(`tabBtn${i}`);
                const lockIcon = document.getElementById(`tabLockIcon${i}`);
                const admBtn = document.getElementById(`admBtn${i}`);

                if (tabBtn) {
                    tabBtn.classList.toggle('is-locked', isLocked && !isAdminActive);
                }
                if (lockIcon) {
                    lockIcon.innerText = isLocked ? "🔒" : "";
                }
                if (admBtn) {
                    admBtn.className = `admin-toggle-chip ${isLocked ? 'locked' : 'unlocked'}`;
                    admBtn.innerText = `${i}단계: ${isLocked ? '🔒잠김' : '🔓공개'}`;
                }
            }
        }

        // 학생/교사의 탭 클릭 처리
        function trySwitchStep(stepNum) {
            if (!Number.isInteger(stepNum) || stepNum < 1 || stepNum > 4) return;
            if (!isAdminActive && stepLocks[stepNum] === true) {
                alert(`🔒 ${stepNum}단계는 현재 선생님에 의해 잠겨 있습니다.\n선생님의 수업 안내에 따라 순서대로 학습해 주세요!`);
                return;
            }
            switchStep(stepNum);
        }

        // 실제 탭 전환
        function switchStep(stepNum) {
            if (!Number.isInteger(stepNum) || stepNum < 1 || stepNum > 4) return;
            currentActiveStep = stepNum;
            document.querySelectorAll('.step-btn').forEach((btn, idx) => {
                btn.classList.toggle('active', idx === stepNum - 1);
            });
            document.querySelectorAll('.step-content').forEach((sec, idx) => {
                sec.classList.toggle('active', idx === stepNum - 1);
            });
            
            
            window.dispatchEvent(new CustomEvent('lesson-step-change',{detail:stepNum}));
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // 교사용 단계 잠금/해제 토글
        async function toggleStepLock(stepNum) {
            if (!isAdminActive || !cachedAdminKey || typeof window.CTWorksheetLockUpdate !== 'function') return;
            const next = !stepLocks[stepNum];
            const syncTag = document.getElementById('syncStatusTag');
            syncTag.innerText = '⏳ 클라우드 저장 중...'; syncTag.style.color = '#facc15';
            try {
                await window.CTWorksheetLockUpdate(['step_locks', THIS_LESSON_KEY, String(stepNum)], next);
                syncTag.innerText = '✅ 실시간 저장 완료'; syncTag.style.color = '#4ade80';
            } catch (error) {
                syncTag.innerText = '❌ ' + (error.message || '저장 실패'); syncTag.style.color = '#f87171';
            }
        }

        // 관리자 공통 로그인 세션에서 관리자 키 확인
        function getAdminKeyFromSession() {
            const rawUser = window.platformSessionStorage.getItem("current_student");
            const storedAdminKey = window.platformSessionStorage.getItem("current_admin_key") || "";
            if (!rawUser || !storedAdminKey) return "";

            try {
                const user = JSON.parse(rawUser);
                return user && user.isAdmin === true ? storedAdminKey : "";
            } catch (error) {
                console.warn("관리자 세션 정보를 읽는 중 오류 발생:", error);
                return "";
            }
        }

        // 이미 관리자 계정으로 로그인했다면 별도 비밀번호 입력 없이 관리자 모드 활성화
        function activateAdminModeFromSession(showAlert = false) {
            const storedAdminKey = getAdminKeyFromSession();
            if (!storedAdminKey) return false;

            isAdminActive = true;
            cachedAdminKey = storedAdminKey;

            const adminBar = document.getElementById('adminStepBar');
            if (adminBar) adminBar.style.display = 'block';
            updateStepLockUI();

            if (showAlert) {
                alert("🔓 로그인된 관리자 계정으로 관리자 모드가 활성화되었습니다.");
            }
            return true;
        }

        // 관리자 모드 인증
        function openAdminModal() {
            // 공통 로그인에서 관리자 인증이 끝난 상태라면 재입력 없이 즉시 진입
            if (activateAdminModeFromSession(false)) return;

            document.getElementById('adminPwInput').value = '';
            document.getElementById('adminModal').style.display = 'flex';
            setTimeout(() => document.getElementById('adminPwInput').focus(), 50);
        }

        function closeAdminModal() {
            document.getElementById('adminModal').style.display = 'none';
        }

        async function submitAdminAuth() {
            const inputVal = document.getElementById('adminPwInput').value.trim();
            if (!inputVal) {
                alert("비밀번호를 입력해주세요.");
                return;
            }

            const btn = document.getElementById('adminModalConfirmBtn');
            btn.innerText = "인증 중...";
            btn.disabled = true;

            fetch(GOOGLE_SCRIPT_URL, {
                method: "POST",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({ action: "verifyAuth", passwordHash: await sha256(inputVal) })
            })
            .then(res => res.json())
            .then(data => {
                btn.innerText = "인증하기";
                btn.disabled = false;
                if (data && (data.success === true || data.ok === true)) {
                    isAdminActive = true;
                    cachedAdminKey = data.adminSessionToken || "";

                    // 공통 로그인된 사용자가 관리자라면 이후 관리자 모드 진입에서도 재사용합니다.
                    try {
                        const rawUser = window.platformSessionStorage.getItem("current_student");
                        const user = rawUser ? JSON.parse(rawUser) : null;
                        if (user && user.isAdmin === true) {
                            window.platformSessionStorage.setItem("current_admin_key", cachedAdminKey);
                        }
                    } catch (error) {
                        console.warn("관리자 키 세션 저장 중 오류 발생:", error);
                    }

                    closeAdminModal();
                    document.getElementById('adminStepBar').style.display = 'block';
                    updateStepLockUI();
                    alert("🔓 교사용 관리자 모드가 활성화되었습니다.\n상단 바에서 각 단계를 자유롭게 잠그고 풀어보세요!");
                } else {
                    alert("❌ 관리자 비밀번호가 일치하지 않습니다.");
                }
            })
            .catch(err => {
                btn.innerText = "인증하기";
                btn.disabled = false;
                alert("⚠️ 인증 통신 오류가 발생했습니다. 네트워크 상태를 확인해주세요.");
            });
        }

        document.getElementById('adminPwInput').addEventListener('keydown', e => {
            if (e.key === 'Enter') submitAdminAuth();
            if (e.key === 'Escape') closeAdminModal();
        });

        function exitAdminMode() {
            isAdminActive = false;
            cachedAdminKey = "";
            document.getElementById('adminStepBar').style.display = 'none';
            updateStepLockUI();
            alert("관리자 모드가 종료되었습니다.");
        }

        // ==========================================
        // 4단계 형성평가 상태 관리 및 구글 시트 전송
        // ==========================================
