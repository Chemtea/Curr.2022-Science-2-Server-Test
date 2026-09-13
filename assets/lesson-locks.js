
      (function() {
        const THIS_UNIT_KEY = window.LESSON_CONFIG.unitKey;
        const THIS_LESSON_ID = window.LESSON_CONFIG.lessonKey;
        const LOCK_SCRIPT_URL = window.PLATFORM_CONFIG.LOCK_API || window.PLATFORM_CONFIG.PLATFORM_API;

        function enforceLessonLock() {
          document.documentElement.innerHTML = `
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>수업 잠김 안내</title>
              <style>
                body {
                  background-color: #0b0e14; color: #e2e8f0;
                  font-family: 'Pretendard', sans-serif;
                  display: flex; flex-direction: column; align-items: center; justify-content: center;
                  height: 100vh; margin: 0; text-align: center; padding: 20px;
                }
                .lock-card {
                  background: #182238; border: 1px solid #334155; border-radius: 16px;
                  padding: 30px 24px; max-width: 400px; box-shadow: 0 10px 30px rgba(0,0,0,0.6);
                }
                h2 { color: #f87171; margin-bottom: 10px; font-size: 1.3rem; }
                p { color: #94a3b8; font-size: 0.95rem; line-height: 1.6; margin-bottom: 20px; }
                button {
                  background: #0284c7; color: #fff; border: none; padding: 10px 20px;
                  border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 0.95rem;
                }
                button:hover { background: #0369a1; }
              </style>
            </head>
            <body>
              <div class="lock-card">
                <h2>🔒 수업 준비 중 (차시 접근 제한)</h2>
                <p>선생님에 의해 현재 차시 전체 학습이 잠겨 있습니다.<br>수업 시간에 다시 접속해주세요.</p>
                <button onclick="location.href='index.html'">홈 포털로 이동하기</button>
              </div>
            </body>
          `;
        }

        if (new URLSearchParams(location.search).get('worksheet') === '1') document.documentElement.classList.add('ctw-worksheet-only');
        let lockCheckInFlight = null;

        function enforceLockCheckFailure() {
          document.documentElement.innerHTML = `
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>잠금 상태 확인 필요</title>
              <style>
                body {
                  background-color: #0b0e14; color: #e2e8f0;
                  font-family: 'Pretendard', sans-serif;
                  display: flex; align-items: center; justify-content: center;
                  min-height: 100vh; margin: 0; text-align: center; padding: 20px;
                }
                .lock-card {
                  background: #182238; border: 1px solid #334155; border-radius: 16px;
                  padding: 30px 24px; max-width: 430px; box-shadow: 0 10px 30px rgba(0,0,0,0.6);
                }
                h2 { color: #fbbf24; margin-bottom: 10px; font-size: 1.25rem; }
                p { color: #94a3b8; font-size: 0.95rem; line-height: 1.65; margin-bottom: 20px; }
                button {
                  background: #0284c7; color: #fff; border: none; padding: 10px 20px;
                  border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 0.95rem;
                }
                button:hover { background: #0369a1; }
              </style>
            </head>
            <body>
              <div class="lock-card">
                <h2>⚠️ 수업 공개 상태를 확인할 수 없습니다</h2>
                <p>서버와 잠금 상태를 확인하는 중 일시적인 오류가 발생했습니다.<br>
                잠긴 수업이 우회되는 것을 방지하기 위해 페이지 접근을 잠시 제한합니다.</p>
                <button onclick="location.reload()">다시 확인하기</button>
              </div>
            </body>
          `;
        }

        async function fetchLockStateOnce() {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4000);
          try {
            const res = await fetch(LOCK_SCRIPT_URL, {
              method: "POST",
              headers: { "Content-Type": "text/plain;charset=utf-8" },
              body: JSON.stringify({ action: "get_locks" }),
              cache: "no-store",
              signal: controller.signal
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
          } finally {
            clearTimeout(timer);
          }
        }

        window.verifyLockStatus = function() {
          if (typeof window.CLASSROOM_NETWORK_ALLOWED !== "undefined" &&
              window.CLASSROOM_NETWORK_ALLOWED !== true) {
            return Promise.resolve();
          }

          if (lockCheckInFlight) return lockCheckInFlight;

          lockCheckInFlight = (async function() {
            let data = null;
            let lastError = null;

            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                data = await fetchLockStateOnce();
                lastError = null;
                break;
              } catch (err) {
                lastError = err;
                if (attempt < 3) {
                  await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                }
              }
            }

            if (lastError || !data || typeof data !== "object") {
              console.warn("잠금 상태 확인 최종 실패:", lastError);
              enforceLockCheckFailure();
              return;
            }

            window.dispatchEvent(new CustomEvent('ctw-lock-state', {detail:data}));

            if (new URLSearchParams(location.search).get('worksheet') === '1') return;

            if (data[THIS_UNIT_KEY]) {
              const unitLocked = data[THIS_UNIT_KEY].isLocked === true;
              const lessonLocked =
                data[THIS_UNIT_KEY].lessons &&
                data[THIS_UNIT_KEY].lessons[THIS_LESSON_ID] === true;

              if (unitLocked || lessonLocked) {
                enforceLessonLock();
                return;
              }
            }

            if (window.handleStepLocksSync) {
              window.handleStepLocksSync(data);
            }
          })().finally(() => {
            lockCheckInFlight = null;
          });

          return lockCheckInFlight;
        };

        // 로컬 파일(file://)로 직접 열었을 때는 외부 네트워크 권한 팝업 반복 방지
        const IS_LOCAL_FILE = (location.protocol === "file:");

        if (!IS_LOCAL_FILE) {
          // Initial lock check only once.
          verifyLockStatus();

          // Re-check only when Supabase Realtime announces a lock change.
          const lockRealtimeClient = window.createLockRealtimeClient(function() {
            window.dispatchEvent(new Event('ctw-lock-pending'));
            return verifyLockStatus();
          });

          // Safety resync after tab/network recovery.
          document.addEventListener("visibilitychange", function() {
            if (document.visibilityState === "visible") {
              lockRealtimeClient.reconnect();
              verifyLockStatus();
            }
          });
          window.addEventListener("focus", function() {
            lockRealtimeClient.reconnect();
            verifyLockStatus();
          });
          window.addEventListener("online", function() {
            lockRealtimeClient.reconnect();
            verifyLockStatus();
          });
        } else {
          console.info("Local file mode: realtime lock check is skipped.");
        }
      })();
    