# 프론트엔드 연동 계약과 남은 확인

확인일: 2026-09-22. 프론트 브랜치 `codex/frontend-phase-two`.
백엔드 PR [#6](https://github.com/r3j0/project-health/pull/6)은 확인 시점에 OPEN, head `815d15b91eed5551619715325873fea271ec1562`다.

**사진 추출은 PR에 공개된 계약으로 구현했다. 아래 평가·대표 프로필의 URL/필드명은 프론트 연동 준비용 제안이며, 백엔드와 확정된 계약으로 간주하면 안 된다.** 실제 백엔드 응답이 공개되면 `lib/fitness-evaluation.ts`에서 맞춘 뒤 실제 통합 검증한다. 운영 UI에 예시 측정값이나 가짜 평가 결과를 주입하지 않는다.

## 현재 공개 API

| 기능                            | 프론트 요청                                                  | 상태                                                 |
| ------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| 계정·온보딩·재화·현재 배정 조회 | `GET /auth/me`                                               | PR #6 제공                                           |
| 이메일/비밀번호 변경            | `PATCH /users/me`                                            | PR #6 제공, 현재 비밀번호 확인, 성공 후 재로그인     |
| 회원 탈퇴                       | `DELETE /users/me`                                           | PR #6 제공                                           |
| 카탈로그·측정 CRUD              | `/measurement-catalog`, `/measurements`, `/measurements/:id` | 제공, 기존 Decimal·부분 저장·소유권·동시성 계약 유지 |
| 사진 추출                       | `POST /measurements/extract`                                 | PR #6 제공, 프론트 연결 완료                         |
| 성인 간이측정 값 저장           | `POST /measurements`, `entryMethod: self_assessment`         | PR #6에 아직 미제공                                  |
| 종목별 평가·6축 대표 등급       | 측정 응답의 `evaluation`                                     | PR #6은 `not_evaluated`만 제공                       |
| 최신 한 기록의 대표 프로필      | `GET /users/me/fitness-profile` (제안)                       | PR #6에 아직 미제공                                  |

경로는 `NEXT_PUBLIC_API_BASE_URL` 뒤에 붙으며 기본값은 `http://localhost:3001/api/v1`이다. 새 API 주소와 실제 JSON 예시가 오면 아래 어댑터와 계약 테스트를 함께 맞춘다. 이 프론트 브랜치에는 백엔드 구현·마이그레이션을 포함하지 않는다.

## 사진 추출

[PR의 사진 추출 명세](https://github.com/r3j0/project-health/blob/815d15b91eed5551619715325873fea271ec1562/backend/docs/measurement-extraction-api.md)를 따른다.

- Bearer 인증, `FormData` 파일 필드 `image` 1장, JPEG/PNG/WebP, 최대 10 MiB. boundary는 브라우저가 작성한다. 클라이언트 제한은 50초(서버 요청 제한 45초).
- 업로드 전에 OpenAI에 사진을 전송한다는 사실을 표시한다. API 키·모델 선택은 백엔드에서 관리한다. 사진 바이트는 브라우저 저장소에 보관하지 않는다.
- `items`, 메타데이터, 확인 대상 원문을 보여 주고 사용자가 확인·수정한 뒤 기존 저장 API를 호출한다. 추출만으로 기록·온보딩·커리큘럼·대표 프로필을 변경하지 않는다.
- 혼합 회차·여러 사람·지원 연령 밖 결과는 자동 입력하지 않는다. 미탐지 항목을 실제 미측정으로 단정하지 않는다. 성별·날짜·나이를 계정이나 현재 날짜로 추정하지 않는다.
- 숫자는 문자열 그대로 보존한다. `evidence`, `reviewItems`, `issues` 등을 저장 본문에 넣지 않는다. `reportKind`는 unknown, 사진 확인 후 저장은 현재 계약대로 manual이며 `entryMethod: ocr`를 보내지 않는다.
- 취소/화면 이탈 이후 응답을 폐기한다. 429의 `retry_after` 동안 재요청을 막는다. 실패 후 사용자가 직접 입력할 수 있다. 비용이 발생하는 추출을 통신 오류 때문에 자동 재호출하지 않는다.
- 확인 폼의 `입력 지우고 다른 사진 선택`은 사용자 확인 후 사진 초안만 폐기한다. 저장 중·결과 불확실 상태에서는 재선택을 잠가 원래 생성 요청을 유지한다.
- 사진 확인 폼 초안은 계정별 `photo` 공간에 보관하여 직접 입력 초안과 분리한다. 새로고침·같은 계정 재로그인 후 값과 검토 메모를 복원한다. 이미지 미리보기는 복원하지 않는다.

## 간이측정은 기록 등록의 한 방법

시작점은 항상 `/onboarding`이다. 간이측정을 선택하면 `/workout?mode=assessment`로 들어간다. 기존 `?curriculum=adult-self-assessment-v1` 북마크도 지원한다. 일반 `/workout`은 현재 배정된 운동을 조회한다.

정적 성인 측정 정의를 공용 `WorkoutRunner`에 공급한다. 저장은 별도 `AssessmentWorkout` 어댑터에서 수행하며, 커리큘럼 배정·교체·완료 요청을 보내지 않는다. 인증 만료 후에도 mode와 같은 계정의 진행 상황을 복원한다.

백엔드에 필요한 항목은 `entryMethod: self_assessment`, 성인용 `self_curl_up`, `ymca_recovery_heart_rate`의 카탈로그/저장 지원이다. 맥박 10초 횟수는 프론트에서 ×6하여 bpm으로 보내며 VO₂max 값으로 바꾸지 않는다. 성인 윗몸말아올리기를 청소년 코드로 바꾸지 않는다. 신체정보·체력 항목은 건너뛸 수 있고 실제 값 1개 이상만 저장한다. 기존 사용자 운동 배정은 유지한다.

## 평가 응답 제안

`POST /measurements`, `PATCH /measurements/:id`, `GET /measurements/:id`에서 같은 revision의 원본과 평가를 반환한다. 저장·평가·대표 등급 선택은 백엔드가 처리한다. 프론트는 `reportedGrade` 원문과 계산된 등급을 분리해서 보여 준다.

상세 응답 `evaluation`:

| 필드                                   | 형식                                                                 |
| -------------------------------------- | -------------------------------------------------------------------- |
| `schemaVersion`, `status`              | `1`, `evaluated` (평가 처리 완료, 모든 축에 등급이 있다는 뜻은 아님) |
| `measurementId`, `measurementRevision` | 바깥 측정 기록의 id/revision과 동일                                  |
| `ruleVersion`, `evaluatedAt`           | 판정 기준 버전, ISO 시각                                             |
| `axes`                                 | 아래 6개 factor가 정확히 한 번씩 등장                                |
| `items`                                | 종목별 원본 값, 평가 상태·등급·사유와 상세 기준                      |

축은 12시부터 시계 방향으로 `cardiorespiratory_endurance`(심폐지구력), `strength`(근력), `muscular_endurance`(근지구력), `flexibility`(유연성), `agility`(민첩성), `power`(순발력)다. [국민체력100 성인 인증기준 표](https://nfa.kspo.or.kr/reserve/0/selectMeasureGradeItemListByAgeSe.kspo)의 열 순서를 따른다(2026-09-22 확인).

각 축은 `{ factor, status, grade, reason, sourceMeasurementCodes }`이다. `sourceMeasurementCodes`는 그 **회차 안에서** 대표 등급으로 선택된 종목 코드다. 같은 요인의 여러 종목은 백엔드가 가장 좋은 등급을 선택한다(1등급이 2등급보다 좋음). 프론트가 다른 날짜의 값이나 결과표 등급으로 보충하지 않는다.

| `status`           | `grade`   | 다각형 표시                    |
| ------------------ | --------- | ------------------------------ |
| `evaluated`        | 1 / 2 / 3 | 등급이 좋을수록 바깥           |
| `below_standard`   | null      | 원점보다 바깥의 가장 작은 고리 |
| `missing_input`    | null      | 원점, 평가 불가·정보 부족      |
| `unsupported_rule` | null      | 원점, 평가 불가·기준 없음      |
| `not_measured`     | null      | 원점, 평가 미존재·미측정       |

`reason`은 한국어 설명 또는 null. 평가/기준 미달 축은 반영 종목 코드가 필요하며, 평가 없는 축의 반영 코드 배열은 비어 있다. 평가 가능 종목이 0·1·2개여도 여섯 축·점은 유지하고 시계 방향으로 연결한 후 닫는다. 원점의 0은 화면 좌표이며 DB 등급이 아니다. 고리 위치는 서열 표시이며 100점 점수나 백분위가 아니다.

개별 종목의 1~3등급 임계값과 종합 인증 4~6등급 조건을 구분한다. 이 차트는 종목별 판정용이며 종합 인증서를 발급하거나 판정하지 않는다. 새로운 종목 등급 체계가 합의되면 어댑터·표시 범례·테스트를 함께 변경한다.

`items[]`는 아래 필드를 갖는다. 전체 TypeScript 형식은 `lib/fitness-evaluation.ts`에 있다.

- `measurementCode`, `factor`(6축 이외 신체정보 등은 null), `value`(원본 Decimal 문자열 또는 null), `unit`.
- 위와 동일한 `status`, `grade`, `reason`.
- `evaluatedValue`: 환산해서 판정한 값이 있다면 `{value, unit}`, 아니면 null. 예를 들어 raw bpm과 판정에 사용한 환산값을 구별한다. 프론트가 환산식을 추정하지 않는다.
- `criteria`: 없으면 null, 있으면 `ageMin`, `ageMax`, `sex`, `direction`(`higher_is_better`/`lower_is_better`), `unit`, `thresholds`, `nextGrade`, `sources`.
- `thresholds[]`: `{ grade, value: Decimal문자열, inclusive: boolean }`. 경계 포함 여부까지 표시한다.
- `nextGrade`: `{grade, value, gap}` 또는 null. 기준값·현재 값과의 차이는 백엔드 값을 그대로 표시한다.
- `sources[]`: `{title, url}`. HTTP(S) 출처만 링크로 표시한다.

상세 어댑터는 id/revision 불일치, 원본과 다른 값·단위, 중복 축·종목, 알려지지 않은 등급, 대표 종목과 축의 불일치를 거부한다. 오류가 있어도 저장된 원본·수정·삭제는 사용할 수 있다. 기존 `{status: "not_evaluated", reason: "evaluation_not_implemented"}` 응답은 미평가 안내로 표시한다. 과거 기록 재평가 정책은 이번 범위에서 정하지 않는다.

## 최신 대표 프로필 제안

`GET /users/me/fitness-profile`은 로그인한 사용자의 최신 **측정 회차 하나**를 반환한다. 종목별로 다른 날짜를 찾아 합치는 방식은 사용하지 않는다. 최신 회차 판정과 같은 날짜의 정렬 규칙은 백엔드 계약으로 고정해야 한다. 프론트가 목록 첫 줄을 대신 사용하지 않는다.

```json
{
  "measurement": {
    "id": "00000000-0000-4000-8000-000000000004",
    "revision": 1,
    "measuredOn": "2026-09-01"
  },
  "evaluation": {
    "schemaVersion": 1,
    "status": "evaluated",
    "measurementId": "00000000-0000-4000-8000-000000000004",
    "measurementRevision": 1,
    "ruleVersion": "서버 기준 버전",
    "evaluatedAt": "2026-09-01T01:00:00Z",
    "axes": []
  }
}
```

위 `axes: []`는 문서 축약이며 실제 응답에는 반드시 6개 축이 필요하다. 대표 API는 상세 종목·기준 전체를 보낼 필요 없이 이 요약만 제공하면 된다. 전체 예시는 테스트 전용 `tests/fixtures/fitness.ts`의 축을 참고한다. 그 파일의 임계값은 합성 테스트 데이터이며 실제 판정 규칙이 아니다.

기록이 없으면 `200 {"measurement":null,"evaluation":null}`. 기능 미구현의 404/501, 통신 실패, 레거시 미평가는 각각 구분한다. 메인·내 프로필은 저장/수정/삭제, 다른 탭 변경, 창 복귀 시 재조회하고 조회 중 이전 차트를 숨긴다. 늦은 응답이 현재 사용자나 수정 후 결과를 덮어쓸 수 없다.

## 실제 백엔드 연결 후 완료할 검증

1. 확정 URL·응답 예시·상태 코드를 어댑터와 계약 fixture에 함께 반영한다.
2. 사진 → 추출 → 사용자 확인 → 실제 저장 → 원본/평가/온보딩 조회. 추출만으로 DB 기록이 늘지 않아야 한다.
3. 같은 factor의 두 종목에서 최고 등급 선택, 부분 입력·실제 0·음수·나이/성별 부족·기준 미지원. 다각형은 항상 6개 축이다.
4. 기록 수정 후 평가와 revision/ETag 일치, 최신 기록의 날짜 변경/삭제 후 대표 회차 갱신. 다른 사용자의 정보에 접근할 수 없어야 한다.
5. 간이측정 저장 전후 `currentCurriculum` 동일, 생성 키 재시도에 기록/평가가 중복되지 않음.
6. 실제 OpenAI 키·모델·사용 가능한 결과지 표본으로 인식 품질을 검증한다. 프론트 계약 테스트가 실제 사진 판독 품질을 보장하지 않는다.
