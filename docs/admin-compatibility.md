# 기존 관리자 기능 호환성 점검

점검일: 2026-09-13. 대상은 `Chemtea-lab / science-platform-test` 및 이 저장소의 최신 `index.html`이다. 운영 프로젝트에서는 누락된 학생 계정 생성 함수의 코드만 읽었으며 변경하지 않았다. 이 문서는 기능별 API 계약과 남은 검증 범위를 구분한다.

## 기능별 결과

| 기능 | index가 호출하는 함수·작업 | 확인 결과 |
|---|---|---|
| 학생 계정 개별 생성 | `admin-account-api` → `admin_create_student_account` | 테스트 서버에 함수가 누락돼 있었다. 동일 요청·응답 계약을 유지하는 테스트 전용 함수를 배포했다. 관리자 세션·현재 계정 상태를 다시 확인하고, 현재 학년도의 등록대기 학생으로만 생성한다. |
| 학생 목록·이름 수정 | `admin-tools-api` → `admin_list_accounts`, `admin_update_student_account` | 테스트 배포본 v1에 구현되어 있고 요청 필드가 일치한다. 이름 변경은 과거 제출 자료에 저장된 이름을 소급 변경하지 않는다. |
| 학생 비밀번호 초기화 | `admin-tools-api` → `admin_reset_password` | 테스트 배포본 v1에 구현되어 있다. 비밀번호를 비우고 등록대기로 돌린 뒤 해당 계정의 세션을 삭제한다. 새 활성화 흐름에서는 교사가 일회용 코드를 발급해야 다시 비밀번호를 설정할 수 있다. |
| 학년도 상태·명단 붙여넣기·전환 | `academic-year-api` → `admin_get_academic_year_status`, `admin_prepare_academic_year_roster`, `admin_activate_academic_year` | 테스트 배포본 v2와 관련 DB 함수 3개가 존재하고 요청 필드가 일치한다. 실제 학년도 전환은 실행하지 않았다. |
| 계정 유형·중간관리자 권한 | `academic-year-api` → `admin_list_role_users`, `admin_update_role_user` | 테스트 배포본 v2 및 `update_role_user_by_account_id_atomic`이 존재한다. 관리자 세션으로 제한한다. 실제 계정 권한 변경은 실행하지 않았다. |
| 외부회원 승인·거절 | `account-api` → `list_pending_signups`, `approve_external_signup`, `reject_external_signup` | 테스트 배포본 v2 및 관련 DB 함수가 존재한다. 최고관리자 또는 `signup_manage` 권한을 확인한다. 실제 가입 요청은 처리하지 않았다. |
| 공지 작성·목록·숨김 | `announcement-api` → `admin_list_announcements`, `admin_create_announcement`, `admin_set_announcement_active` | 테스트 배포본 v3에 구현되어 있고 제목·본문·대상·학년도 요청 필드가 일치한다. 최고관리자 또는 `announcements_manage` 권한을 확인한다. |
| 학생 질문·답변·교사 메모 | `question-api` → `admin_list_teacher_questions`, `admin_reply_teacher_question`, `admin_save_teacher_question_note` | 테스트 배포본 v2에 구현되어 있다. 최고관리자 또는 `questions_manage` 권한을 확인하며 학생용 응답에서 교사 메모를 제외한다. |
| 제출·미제출 현황판 | `admin-dashboard-api` → `get_class_dashboard` | 테스트 배포본 v1에 구현되어 있다. 기존 `first_submissions`, `learning_submissions`에서 조회하므로 새 서버 채점의 기록 연결이 필요하다. 이 저장소의 서버 채점 연결 SQL이 해당 표에 기록한다. |
| 단원·활동 잠금 | `lock-realtime-api` → `get_locks`, `save_locks` | 서버 원자적 부분 변경 API와 index의 `patches` 요청이 일치한다. 전체 잠금 자료를 덮어쓰는 예전 요청은 허용하지 않는다. |

새 학생 계정 생성 함수는 테스트 서버에 배포했고 합성 학생의 실제 생성·등록 대기 상태를 확인했다. 위의 ‘존재·계약 일치’는 모든 관리자 작업을 실제 데이터로 수행했다는 의미가 아니다.

## 확인된 연결 수정 사항

1. **학생 계정 생성 API 누락 수정**: `supabase/functions/admin-account-api/index.ts`를 테스트 프로젝트에 배포했다. 별도 외부 패키지가 없고 실제 프로젝트 URL을 확인한다. 성공 후 관리자 배너의 **계정 활성화**에서 코드를 발급한다. 운영본의 약한 세션 검사를 그대로 복사하지 않았다.
2. **새 수업 현황판 식별자**: 수업 ID가 없는 자료의 채점 기록은 `content_`와 하이픈을 제거한 자료 UUID로 저장된다. 자료 목록과 공통 수업 화면의 식별자도 같은 규칙을 사용하도록 수정했다. 기존 15차시처럼 `lesson_id`가 있는 경우 해당 ID를 그대로 유지한다.
3. **활성화 안내 문구**: 학생 생성·비밀번호 초기화 후 ‘다음 로그인에서 바로 비밀번호 설정’이라는 예전 안내 대신 **계정 활성화에서 코드 발급 → 학생이 코드와 새 비밀번호 입력**을 안내하도록 수정했다.

## 보안 점검의 범위

- 확인한 학년도·회원가입·계정 권한 변경 DB 함수는 `anon` 및 `authenticated`의 직접 실행 권한이 모두 차단되어 있었다. 브라우저가 관리자 DB 함수를 직접 호출하는 경로는 열지 않았다.
- 새 학생 생성 함수는 `adm_` 토큰 형식뿐 아니라 서버에 저장된 세션 종류·계정 유형·만료·철회와 연결된 관리자 계정을 확인한다. 다른 학년도·관리자 계정 유형·비밀번호를 요청에 섞어도 학생 생성값에 반영하지 않는다.
- 동일 학년도의 학번 중복은 기존 DB 고유 인덱스에서도 차단한다. 중복 또는 재시도 시 기존 계정을 덮어쓰지 않는다.
- 기존 공지·질문·회원·학년도·관리자 도구·현황판 API는 세션 존재와 만료를 검사하지만, 새 자료 API와 같은 모든 계정 상태 재검증을 공통으로 사용하지 않는다. 따라서 이번의 API 호환성 점검을 기존 API 전체 보안 개편 완료로 해석하면 안 된다. 후속 통합 시 현재 계정의 비활성·철회 검사를 공통 함수로 모으고, 변경 권한 회수 직후의 접근 거부를 검증해야 한다.
- 서비스 키는 Edge Function 환경변수에서만 사용하고 클라이언트에 반환하지 않는다. 관련 기준: [Supabase Edge Function 환경변수](https://supabase.com/docs/guides/functions/secrets).

## 검증 기록

- 새 계정 생성 함수의 단위 검사 8개 통과: 학생 토큰 차단, 만료·철회·잘못된 세션 차단, 비활성 관리자 차단, 레거시 관리자 자격 재검증, 중복 계정 덮어쓰기 방지, 테스트 프로젝트 고정, 실제 요청 크기 제한, 활성화 대기 상태 생성.
- 기존 6개 관리자 조회 API에 실제로 미인증 요청을 보내 모두 `success:false`, `permissionDenied:true`로 거부되는 것을 확인했다. 학년도·계정·공지·질문 API는 HTTP 200 안의 오류 상태를 사용하고, 관리자 도구·현황판 API는 HTTP 403을 사용한다. index는 응답의 `success`도 확인하므로 이 차이를 처리한다.
- 실제 학생의 이름·비밀번호·권한 및 학년도는 이 점검에서 바꾸지 않았다.
- 실제 기기 필기·마이크·3D 검증은 별도의 기기 확인이 필요하며 API 코드 점검으로 대체되지 않는다.

로그인 공통 함수인 `platform-api` v8에는 현재 계정 상태·역할·동의·세션 만료/폐기 검증을 추가했다. 이 함수의 예전 전체 잠금 저장 경로는 410으로 차단했다. 다른 기존 관리자 함수 전체의 검증 통합까지 수행한 것은 아니다.
