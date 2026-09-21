# 계정과 사용자 데이터 구조

2026-09-21 사용자 요구사항으로 기존 ‘User는 5개 컬럼만 사용’ 결정을 갱신했다. 기존 인증 필드는 보존하고 선택적 선호 운동·운동 목적 배열을 확장한다. [사용자 API](users-api.md)에 실제 요청·응답과 동시 요청 정책을 정의한다.

| User 컬럼             | 형태                         | 의미                                |
| --------------------- | ---------------------------- | ----------------------------------- |
| `id`                  | UUID PK                      | 내부 사용자 식별자                  |
| `email`               | TEXT NOT NULL UNIQUE         | trim·소문자화한 로그인 이메일       |
| `password`            | TEXT nullable                | Argon2id 단방향 해시, 응답에서 제외 |
| `created_at`          | TIMESTAMPTZ(6)               | 계정 생성 시각                      |
| `updated_at`          | TIMESTAMPTZ(6)               | 계정 변경 시각                      |
| `preferred_exercises` | TEXT[] NOT NULL DEFAULT '{}' | 선호 운동, 복수·선택                |
| `exercise_goals`      | TEXT[] NOT NULL DEFAULT '{}' | 운동 목적, 복수·선택                |

Prisma는 `createdAt`, `updatedAt`, `preferredExercises`, `exerciseGoals`를 DB의 snake_case 컬럼에 매핑한다. API는 기존 공개 4개 필드와 의미를 유지한다. 인증 세션·refresh 토큰·비밀번호 해시는 프로필에 노출하지 않는다. 미정인 선호 운동/운동 목적 선택지를 고정 enum으로 만들지 않는다.

비밀번호는 원문을 저장하지 않는다. 미래 소셜 전용 계정을 위해 nullable을 유지하되 현재 로그인/탈퇴 비밀번호 확인에서는 null·평문·손상된 해시를 거절한다. 임의 기본 비밀번호·가짜 이메일을 만들지 않는다. 수동 DB 입력은 해싱을 거치지 않으므로 계정 생성은 인증 API를 사용한다.

## 관계

- User 1:N Measurement, Measurement 1:N MeasurementItem. 현재 체력은 측정일 내림차순 → 등록 시각 내림차순 → ID 오름차순의 한 기록이다. 원문 값을 User에 복제하지 않는다.
- User 1:N UserFitnessGoal. 사용자+검사 코드 UNIQUE, 목표의 카탈로그 버전·코드·단위는 MeasurementDefinition을 참조한다. 목표와 실제 측정값은 별개다.
- User 1:1 UserCurrency. userId가 PK/FK, 비음수 INTEGER 잔액과 생성·수정 시각. 신규 가입은 nested transaction으로 함께 생성하고 기존 사용자는 마이그레이션으로 초기화한다. 관계 누락은 숨기지 않는다.
- User 1:N UserCurriculumAssignment, WorkoutCurriculum 1:N UserCurriculumAssignment. 현재 배정은 배정 행의 `currentForUserId` UNIQUE 관계 하나로 표현한다. 소유자 일치 CHECK와 트랜잭션으로 최대 하나만 유지한다. 완료 이력은 새 배정으로 덮어쓰지 않는다.
- User 1:N AuthSession, AuthSession 1:N AuthRefreshToken. User 1:N MeasurementCreateRequest.

`isOnboarded`는 유효한 측정 기록 존재 여부에서 계산한다. boolean·onboardingCompletedAt·baselineMeasurementId는 저장하지 않는다. 마지막 측정 삭제 후 미완료로 되돌아간다. 온보딩 조건은 추후 회의에서 재검토하는 MVP 정책이며 추천 가능 여부와 구분한다.

모든 사용자 소유 관계는 계정 삭제 시 CASCADE다. 목표·측정·배정이 참조하는 공용 정의는 계정과 함께 삭제하지 않는다. 기존 측정 API 계약은 유지한다.

## 후속 결정

닉네임은 중복을 허용한다는 기존 결정은 유지하지만 이번 API·컬럼에 추가하지 않는다. 카카오·구글 로그인·이메일 소유 확인·비밀번호 재설정은 후속 범위다. 같은 이메일만으로 로그인 수단을 자동 연결하지 않는다. 재화 거래, 운동 콘텐츠·추천, 목표 달성·성장 비교는 구현하지 않는다.

기존 기획 출처: [회원가입 / 로그인 / 온보딩 명세](https://app.notion.com/p/d54634ca4bdf83a8bb7c0147f51e63db), 2026-09-19 확인. 계정 필드 확장·현재 온보딩 조건·영구 탈퇴·배정 상태 관리는 2026-09-21 최신 사용자 지시를 따른다. 공유 Notion 원문은 이번 작업에서 수정하지 않았다.
