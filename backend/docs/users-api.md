# 사용자 프로필·목표·재화·운동 배정·영구 탈퇴

2026-09-21 사용자 결정. 기존 User 5개 컬럼 제한을 갱신하고 선호 운동·운동 목적 배열을 추가한다. 아래 API는 `/api/v1`을 사용하며 모든 요청에 본인의 `Authorization: Bearer <access_token>`이 필요하다. 소유자 ID는 인증 정보에서 결정한다. 비밀번호·해시·세션·refresh token은 프로필에 포함하지 않는다. 모든 `/auth`, `/users`, `/measurements` 응답은 `Cache-Control: no-store`, `Pragma: no-cache`를 유지한다.

## 경로

| 메서드·경로                          | 성공 | 용도                                |
| ------------------------------------ | ---- | ----------------------------------- |
| `GET /auth/me`                       | 200  | 기존 공개 필드와 확장 프로필        |
| `PATCH /users/me`                    | 200  | 개인 정보 변경 후 확장 프로필       |
| `GET /users/me/fitness-goals`        | 200  | `{ "items": [...] }`, 코드 오름차순 |
| `POST /users/me/fitness-goals`       | 201  | 목표 생성, 목표 객체와 Location     |
| `GET /users/me/fitness-goals/:id`    | 200  | 목표 한 개                          |
| `PATCH /users/me/fitness-goals/:id`  | 200  | 목표값·단위 변경                    |
| `DELETE /users/me/fitness-goals/:id` | 204  | 목표 삭제                           |
| `DELETE /users/me`                   | 204  | 비밀번호 확인 후 즉시 영구 탈퇴     |

사용자·목표 변경은 Bearer 인증을 사용한다. **계정 DELETE에는 추가로 `X-CSRF-Protection: 1`과 JSON 비밀번호가 필수**다. 브라우저 Origin은 `FRONTEND_ORIGIN`과 일치해야 한다. 기존 측정 API의 생성 요청 키·revision·부분 입력 계약은 유지한다.

## 확장 프로필

아래는 측정·목표·배정이 없는 계정의 응답 형식 예시다. ID·이메일·시각은 예시이며 실제 응답은 저장 데이터를 사용한다.

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "email": "member@example.test",
  "created_at": "2026-09-21T00:00:00.000Z",
  "updated_at": "2026-09-21T00:00:00.000Z",
  "preferredExercises": [],
  "exerciseGoals": [],
  "isOnboarded": false,
  "currentFitness": null,
  "fitnessGoals": [],
  "currency": { "balance": 0 },
  "currentCurriculum": null
}
```

- 기존 `id`, `email`, `created_at`, `updated_at`의 이름·의미를 유지한다. 신규 필드는 기존 측정 API와 같은 camelCase다. 관계 변경 시 계정 `updated_at`이 모든 관계의 변경 시각을 대표하지는 않는다.
- `preferredExercises: []`, `exerciseGoals: []`: 선택 없음. `fitnessGoals: []`: 등록한 목표 없음.
- `currentFitness: null`: 남은 측정 기록 없음. 값이 있으면 [측정 상세 API](measurements-api.md)의 객체 그대로이며 `id`, `measuredOn`, `catalogVersion`, `revision`, `items`, `missingMeasurementCodes`, `evaluation` 등을 포함한다.
- `currency.balance`: 저장된 정수 잔액. 초기 저장값은 0. 재화 행 자체가 누락되면 503이며 0으로 대신 응답하거나 조회 도중 생성하지 않는다.
- `currentCurriculum: null`: 배정 없음. 값이 있으면 아래 배정 객체다. 완료됐어도 다음 명시적 배정 전까지 현재 배정으로 조회된다.
- `isOnboarded`: 같은 조회 스냅샷에 측정 기록이 한 건 이상 있는지로 계산한다. 별도 boolean·완료 시각 컬럼은 없다.

가입·로그인·refresh 응답의 `user`는 기존 4개 공개 필드를 유지한다. 확장 정보는 `/auth/me`에서 조회한다. 인증 가드는 세션과 최소 공개 계정 필드만 읽으며 전체 측정·목표·배정을 조회하지 않는다. 상세 조회는 Repeatable Read 트랜잭션에서 계정·관계·선택 측정값을 함께 읽어 조회 중 수정/삭제가 겹쳐도 일관된 결과를 반환한다. 겹친 삭제 직전 스냅샷을 반환할 수 있지만 삭제 완료 후 시작한 조회는 최신 상태를 반영한다.

## 개인 정보 수정

```http
PATCH /api/v1/users/me
Authorization: Bearer <access_token>
Content-Type: application/json

{"preferredExercises":[" 수영 ","수영","빠른  걷기"],"exerciseGoals":["체력 유지"]}
```

200 응답은 확장 프로필이며 `preferredExercises`는 `["수영", "빠른 걷기"]`, `exerciseGoals`는 `["체력 유지"]`가 된다. 선택지 enum은 없다.

- 필드별 최대 20개 입력(중복 제거 전), 항목별 정규화 후 1~80자(JavaScript UTF-16 길이).
- 앞뒤 공백 제거, 연속 공백·탭·줄바꿈을 한 칸으로 합친다. 정규화 후 빈 항목은 400. 같은 문자열의 중복은 첫 항목만 보존하고 순서를 유지한다. 대소문자는 구분한다.
- 배열을 전달하면 그 필드 전체를 교체한다. 생략은 유지, `[]`는 모두 해제, `null`은 오류다. 예: `{"preferredExercises":[]}`는 운동 목적을 유지한다.
- 빈 객체·알 수 없는 필드·잘못된 자료형은 400. 이메일·비밀번호·소유자·재화·온보딩·체력값·목표·커리큘럼 상태는 이 API로 변경할 수 없다. Prisma 변경 객체는 허용 필드만 명시적으로 구성한다.
- 동시 PATCH는 보낸 필드에 대해 DB가 실행한 마지막 쓰기가 적용된다. 서로 생략한 필드는 덮어쓰지 않는다.

## 현재 체력과 온보딩

현재 체력은 **`measuredOn DESC, createdAt DESC, id ASC`**의 첫 측정 기록 한 건이다. DB에서 정렬하므로 DB 시각 정밀도도 유지된다. 과거 기록을 뒤늦게 등록해도 더 최근 측정일을 대체하지 않는다. 같은 측정일은 늦게 등록한 회차가 우선하며 등록 시각까지 같으면 UUID 오름차순이다. 기존 측정 목록의 페이지 정렬(`measuredOn DESC, id ASC`) 계약은 변경하지 않는다.

선택된 회차의 실제 items만 반환한다. 다른 날의 값을 합치거나 미입력을 0으로 채우지 않는다. 누락 코드는 해당 회차 나이·카탈로그 기준으로 제공한다. 선택된 회차를 삭제하거나 측정일을 수정하면 다음 조회에 같은 선택 규칙을 적용한다. 기록이 없으면 null이다. 체력값을 User에 복제하지 않는다.

**현재 MVP의 온보딩 완료 조건은 남아 있는 유효한 측정 기록 1건 이상**이다. 기존 사용자를 포함해 동일하게 계산한다. 부분 기록도 기존 측정 검증을 통과하면 완료다. 일부 기록 삭제 후 남은 기록이 있으면 true, 마지막 기록 삭제 후 false다. 선호 운동·운동 목적·목표는 조건이 아니다. 온보딩 완료는 평가·운동 추천에 데이터가 충분하다는 뜻이 아니며 `evaluation_not_implemented`를 그대로 유지한다. **이 조건은 후속 회의에서 재검토할 MVP 정책**이다.

## 목표 체력 CRUD

목표는 사용자가 선택한 희망값이다. 실제 측정값·서버 권장값·달성 판정과 다르다. 공용 측정 카탈로그의 `catalogVersion`·검사 코드·단위를 FK로 연결하며, **사용자 + 검사 코드에 목표 하나**만 허용한다(버전이 달라도 같은 코드 중복 금지). 다른 사용자의 목표 ID와 없는 ID는 모두 404다.

카탈로그 조회 후 다음처럼 생성한다:

```http
POST /api/v1/users/me/fitness-goals
Authorization: Bearer <access_token>
Content-Type: application/json

{"catalogVersion":"nfa100-2026-09-19","measurementCode":"sit_and_reach","value":"5.25","unit":"cm"}
```

201, `Location: /api/v1/users/me/fitness-goals/<id>`. 응답 형식 예시:

```json
{
  "id": "00000000-0000-4000-8000-000000000002",
  "catalogVersion": "nfa100-2026-09-19",
  "measurementCode": "sit_and_reach",
  "value": "5.25",
  "unit": "cm",
  "createdAt": "2026-09-21T00:00:00.000Z",
  "updatedAt": "2026-09-21T00:00:00.000Z"
}
```

`GET /users/me/fitness-goals`는 `{ "items": [목표 객체] }`, `GET /users/me/fitness-goals/<id>`는 목표 객체다. PATCH 본문 `{"value":"6.125"}`는 단위를 유지한다. 값과 단위 중 적어도 한 필드를 보내야 하며 코드·버전·ID·소유자는 변경할 수 없다. 검사 정의를 바꾸려면 기존 목표를 삭제하고 새로 등록한다. 목표 DELETE는 본문 없이 호출하고 204를 받는다. 목록과 프로필의 목표 정렬은 코드 오름차순이다.

모든 목표값은 **지수 표기 없는 10진수 문자열**, 부호·소수점 포함 최대 128자다. JSON 숫자·NaN·Infinity·공백·빈 문자열은 400. PostgreSQL 무제한 정밀도 NUMERIC과 Prisma Decimal로 저장하며 `toFixed()` 문자열로 응답한다. 불필요한 끝자리 0은 정규화하지만 수치를 반올림하지 않는다. 실제 측정과 같은 공통 검증 함수를 사용해 정수 항목·단위·최솟값 포함 여부·최댓값을 검사하고 DB에서도 FK·CHECK·트리거로 보호한다.

현재 나이·생년월일을 계정에 저장하지 않으므로 과거 측정 당시 나이를 현재 나이로 추정하지 않는다. 목표 생성에 측정 기록을 요구하지 않으며 목표 저장은 연령 적합성·운동 적합성 판정이 아니다. 카탈로그에는 적용 연령 정보가 그대로 남고, 후속 추천에서 필요한 현재 정보를 별도로 확인해야 한다.

동일 코드 중복 POST·동시 생성은 한 건만 성공하고 나머지는 409다. PATCH는 목표 행을 잠근 뒤 최신 값에 생략 필드를 병합한다. 같은 필드를 동시에 바꾸면 DB가 실행한 마지막 요청이 적용된다. DELETE와 겹친 PATCH는 먼저 수정됐다면 200, 삭제가 먼저라면 404이며 삭제한 목표를 되살리지 않는다. 목표는 현재 설정만 저장하며 변경 이력·달성률·과거 대비 성장·baselineMeasurementId는 이번에 추가하지 않는다.

## 재화

`UserCurrency(userId PK/FK, balance, createdAt, updatedAt)`를 사용한다. 사용자당 최대 한 행이고 신규 이메일 가입의 User·재화·세션·refresh 해시는 Prisma nested write의 같은 트랜잭션에서 생성한다. 기존 계정은 새 마이그레이션에서 0으로 백필한다. 재화 행을 만들지 않는 수동 계정 생성 도구는 같은 트랜잭션에서 재화도 생성해야 한다.

잔액은 PostgreSQL INTEGER: 저장형의 범위는 -2,147,483,648~2,147,483,647, DB `CHECK(balance >= 0)` 적용 후 허용 범위는 **0~2,147,483,647**이다. 현재 잔액 변경 외부 API·지급·차감·구매·교환·거래 이력은 없다. 일반 User PATCH로 변경할 수 없다. 탈퇴 시 재화도 CASCADE 삭제한다.

## 운동 1회분의 현재 배정과 이력

`WorkoutCurriculum`은 공용 정의(`id`, `name`, `createdAt`), `UserCurriculumAssignment`는 사용자별 배정이다. 정의 내용·운동 영상·추천 알고리즘은 후속 범위이며 운영 seed나 샘플 운동을 추가하지 않는다. 정의 변경은 새 ID로 생성하고 DB 트리거가 기존 정의 수정을 금지한다. 참조되는 정의의 삭제는 FK RESTRICT다.

배정 응답 형식(실제 배정이 있을 때만):

```json
{
  "id": "00000000-0000-4000-8000-000000000003",
  "status": "assigned",
  "assignedAt": "2026-09-21T00:00:00.000Z",
  "completedAt": null,
  "curriculum": {
    "id": "00000000-0000-4000-8000-000000000004",
    "name": "실제로 저장된 1회 운동 정의의 이름"
  }
}
```

내부 `CurriculaService`의 상태 관리 동작만 제공하며 **배정·완료 HTTP 경로는 이번에 만들지 않는다**. 후속 호출자는 인증된 사용자 ID를 전달해야 한다.

- `assign(userId, curriculumId, requestKey)`: 실제 존재하는 정의와 UUID 요청 키로 명시적 배정. 배정 없음 또는 현재 운동 완료 상태에서만 허용한다. 진행 중 배정이 있으면 409, 정의가 없으면 404다. 검증/저장 실패는 트랜잭션을 롤백한다.
- `complete(userId, assignmentId)`: 본인 배정을 완료한다. `assigned → completed`로 바꾸고 DB 현재 시각을 기록한다. 중복 완료는 기존 완료 시각·상태를 반환한다. 다른 사용자/없는 ID는 404. 과거 완료 배정에 대한 재시도도 현재 새 배정을 건드리지 않는다. 추천이나 다음 배정을 호출하지 않는다.
- `current(userId)`: 현재 배정 또는 null. `history(userId, limit=20, cursor?)`: `assignedAt DESC, id ASC`, 최대 50개와 nextCursor. 다른 사용자의 커서도 404다. 목록은 완료 이력과 현재 배정을 모두 포함한다.

User에서 `currentCurriculumAssignment` 관계로 조회한다. 현재 표시의 유일한 저장 위치는 배정 행의 nullable `currentForUserId`다. UNIQUE가 사용자당 현재 최대 한 개를 보장하고 CHECK가 소유자와 같도록 한다. 진행 중 행은 반드시 현재 표시를 가져야 한다. 완료된 현재 표시를 지우고 다음 행을 만들 때는 사용자 행 잠금과 같은 트랜잭션을 사용한다. 완료 시각과 상태의 CHECK, 배정 식별자·완료 이력의 변경 방지 트리거도 둔다. User에 별도 현재 ID나 boolean을 중복 저장하지 않는다.

배정 요청 키는 사용자별 UNIQUE다. 같은 키·정의 재요청은 그 배정의 현재 상태를 반환하며 과거 완료 건을 다시 현재로 만들지 않는다. 같은 키·다른 정의는 409. 다른 키의 동시 배정은 하나만 성공한다. 완료와 다음 배정이 겹치면 잠금 순서에 따라 새 배정 성공 또는 진행 중 409다. 409 이후 재조회하고 명시적으로 재요청한다.

후속 추천은 `history`의 정의 ID·배정 시각·상태·완료 시각을 참조하거나 서비스 내부에서 소유자 조건으로 조회할 수 있다. **이력 저장만으로 추천 다양성·운동 중복 방지를 구현한 것은 아니다.** 최근 운동 제외·반복 간격·알고리즘 버전과 콘텐츠의 세부 설계는 후속 구현이다. 기본 제품 흐름은 현재 운동 완료 후 다음 운동 전에 새 배정이며, **어떤 화면·버튼에서 추천 요청을 보낼지는 후속 회의에서 결정**한다.

## 즉시 영구 탈퇴

```http
DELETE /api/v1/users/me
Authorization: Bearer <access_token>
X-CSRF-Protection: 1
Content-Type: application/json

{"password":"현재 계정의 실제 비밀번호"}
```

기존 Argon2id 검증을 재사용한다. 비밀번호는 변경·trim하지 않으며 1~128자를 받는다. 저장된 비밀번호가 null·평문·손상된 해시라면 동일한 본인 확인 실패 401이다. 비밀번호가 없다는 이유로 확인을 생략하지 않는다. 향후 소셜 계정은 별도 재인증 방식을 구현해야 한다.

비밀번호 확인 후 검증한 해시를 DELETE 조건으로 사용해 검증 사이의 비밀번호 변경을 차단한다. User DELETE 한 문장과 FK CASCADE는 원자적으로 다음을 제거한다:

- 계정·선호 운동·운동 목적, 측정 회차·모든 항목·생성 요청 이력(삭제된 측정의 요청 tombstone 포함)
- 목표 체력·재화, 현재/과거 커리큘럼 배정·완료 이력
- 모든 인증 세션·사용/미사용 refresh token 해시

공용 측정 카탈로그·검사 정의·공용 운동 정의·다른 사용자 데이터는 남는다. 보안 요청 횟수의 HMAC 키는 기존 만료/cleanup 정책을 유지한다. 복구·유예·휴면 계정은 만들지 않는다.

성공 시 204(본문 없음), 기존 로그인과 같은 이름·Path·Secure·HttpOnly·SameSite·Domain 조건으로 refresh 쿠키를 지운다. 프론트는 `credentials: 'include'`로 요청하고 성공 후 메모리 access token과 개인 데이터 캐시를 비운다. 모든 access token은 요청 시 DB 세션을 확인하므로 탈퇴 커밋 이후 기존 모든 세션의 access/refresh는 401이다. 탈퇴와 이미 진행 중인 refresh가 겹쳐 200을 받더라도 그 토큰은 탈퇴 후 사용할 수 없다.

| 상황                                                     | 응답                    |
| -------------------------------------------------------- | ----------------------- |
| 인증 없음·만료·삭제한 계정으로 반복 탈퇴                 | 401                     |
| 비밀번호 불일치·검증 중 비밀번호 변경·비밀번호 없는 계정 | 401, 계정 보존          |
| 동시에 같은 계정 탈퇴                                    | 한 요청 204, 나머지 401 |
| 빈/누락 비밀번호·알 수 없는 필드·잘못된 입력             | 400                     |
| CSRF 헤더 누락·허용되지 않은 Origin                      | 403                     |
| 요청 제한 초과                                           | 429, `retry_after` 초   |

기존 IP당 60회/분 요청 제한과 DB 저장 방식을 재사용하며, 탈퇴 본인 확인은 계정당 5회/15분(성공·실패 모두 계산)이다. 잘못된 비밀번호 오류 응답은 입력 비밀번호나 해시를 포함하지 않는다.

## 적용·검증과 후속 범위

새 마이그레이션은 `20260921000100_user_features`다. 기존 파일을 수정하거나 DB를 초기화하지 않는다. [DB 문서](database.md)의 환경 구분과 적용 순서를 따른다. `npm run check`는 스키마·생성·서식·린트·타입·단위·실제 DB 통합 검사·빌드를 실행한다. 통합 검사는 새 임시 스키마 적용/재적용 외에 이전 마이그레이션까지 적용한 스키마에 계정·측정·요청·세션·토큰을 저장한 뒤 새 SQL 적용과 재화 백필·기존 사용자 온보딩을 확인한다.

후속 범위: 과거 대비 변화/성장, 목표 달성 판정, 운동 콘텐츠·추천 알고리즘, 재화 지급·차감·구매·교환·거래 이력, 추천 호출 화면/시점, 온보딩 조건 재검토. 현재 응답에 임의 체력 점수·권장 목표·추천 결과를 채우지 않는다.
