# 간이측정·공식 종목 평가·6축 조회 API

2026-09-23 사용자 요청으로 추가했다. `/api/v1`의 기존 계정·사진 추출·측정 CRUD를 유지하면서 선택 입력과 응답을 확장한다. 기본 CRUD/인증/오류/ETag 계약은 [측정 API](measurements-api.md), 공식 기준 조사와 원자료는 [출처 검증](research-fitness-criteria.md)을 참고한다. 간이측정은 커리큘럼을 배정·교체·완료하거나 운동 진행을 변경하지 않는다.

## 저장과 프론트 요청

`GET /api/v1/measurement-catalog?age=25`의 최신 버전은 `nfa100-2026-09-23`이다. 기존 버전 `nfa100-2026-09-19`의 19개 정의는 수정하지 않았으며 새 버전에는 다음 2개를 추가했다.

| 코드                       | 단위  | 입력 조건                | 검사 방법                                                          |
| -------------------------- | ----- | ------------------------ | ------------------------------------------------------------------ |
| `self_curl_up`             | `회`  | 만 19–64세, 0 이상 정수  | 성인 자가측정용 윗몸말아올리기. 3초 신호에 맞추는 별도 프로토콜    |
| `ymca_recovery_heart_rate` | `bpm` | 만 19–64세, 양수 Decimal | 공식 자가측정 YMCA 스텝 후 회복 심박수. 프론트가 bpm으로 환산한 값 |

생성·수정에 `entryMethod: "self_assessment"`를 지원한다. 생성 시 생략하면 `manual`, 수정 시 생략하면 저장된 값을 유지한다. 사진 초안 확인 저장도 기존처럼 `manual`이다. `reportKind: "simple"`은 기관의 공식 간편측정을 뜻하므로 자가측정에서 자동으로 설정하지 않는다. `sourceProgram: "nfa100"`은 기준 체계 식별자이며 기관 측정·인증 여부를 보증하지 않는다.

간이측정은 측정 당시 만 19–64세, 다음 8개 코드만 허용한다: `height`, `weight`, `bmi`, `waist_circumference`, `cross_sit_up`, `self_curl_up`, `ymca_recovery_heart_rate`, `sit_and_reach`. 기존 manual은 만 13–64세 카탈로그 범위를 유지한다. 카탈로그 전체에는 manual용 검사도 있으므로 간이측정 화면은 이 허용 목록을 사용한다.

검사 코드는 **해당 공식 측정법을 수행했다는 입력의 선언**이다. 교차윗몸일으키기(1분), 성인 자가 윗몸말아올리기, 청소년 `curl_up`을 서로 변환하지 않는다. 같은 축·비슷한 이름만으로 코드를 선택하지 않는다. 공식 프로토콜은 [공식 성인 측정항목](https://nfa.kspo.or.kr/reserve/3/selectMeasureItemListByAgeSe.kspo)과 [자가측정 안내](https://nfa.kspo.or.kr/measure/self/selectSelfMeasureItem.kspo)를 따른다. 백엔드는 실제 수행 자세를 확인할 수 없으므로 프론트에서 해당 프로토콜을 안내해야 한다. YMCA는 30cm 스텝·96bpm·3분 수행 → 1분 휴식 → 10초 맥박 × 6을 완료한 bpm을 보낸다. 자가 앉아굽히기는 발뒤꿈치에 맞춘 줄자 30cm 기준을 빼서 부호 있는 cm를 보낸다. 서버는 다시 ×6 또는 −30cm를 적용하지 않는다.

측정일과 `ageAtMeasurement`는 기존대로 필수다. 나이는 **측정일 기준 만 나이**를 전달한다. 사용자 계정에는 생년월일이 없으며 현재 나이·사진·이름으로 추정하지 않는다. 생년월일로 나이를 구하는 프론트는 측정 연도에서 출생 연도를 빼고 측정일에 생일이 지나지 않았으면 1을 뺀다. 날짜/나이를 모르면 저장 필드 오류를 반환하며, `sexAtMeasurement`를 모르면 null로 저장하고 `insufficient_information`을 반환한다. 생년월일 자체는 추가 수집하지 않는다. 측정일을 수정할 때 프론트는 그 날짜의 만 나이도 확인해 함께 보낸다. 생략된 나이는 기존 PATCH 계약에 따라 유지한다.

```http
POST /api/v1/measurements
Authorization: Bearer <access_token>
Idempotency-Key: <새 저장 작업의 UUID>
Content-Type: application/json
```

```json
{
  "catalogVersion": "nfa100-2026-09-23",
  "entryMethod": "self_assessment",
  "measuredOn": "2026-09-23",
  "ageAtMeasurement": 25,
  "sexAtMeasurement": "male",
  "items": [
    {
      "measurementCode": "cross_sit_up",
      "value": "49",
      "unit": "회",
      "reportedGrade": "결과지 원문"
    },
    { "measurementCode": "self_curl_up", "value": "0", "unit": "회" },
    {
      "measurementCode": "ymca_recovery_heart_rate",
      "value": "90",
      "unit": "bpm"
    }
  ]
}
```

위 수치는 계약 설명용 예시다. 응답은 201(동일 키 재시도는 200), `ETag: "1"`이며 실제 기록 ID·시각과 저장된 값을 반환한다. 평가가 없어도 유효한 값은 저장한다.

- 건너뛴 검사는 `items`에 넣지 않는다. 빈 문자열/null/가짜 0 행을 보내지 않는다.
- 유효한 값 1개 이상이면 부분 저장한다. 빈 배열·null 배열·값 없는 행은 400이다. 잘못된 값이 섞인 요청도 전체를 거절하며 조용히 삭제하지 않는다.
- 실제 0회와 유연성 0cm는 유효하다. 신장·체중·허리둘레·BMI·심박수의 0은 오류다.
- 모든 수치·기준값·차이는 Decimal 문자열이다. 단위 변환이나 반올림을 수행하지 않는다. BMI도 기존대로 입력값만 보존하며 신장/체중으로 자동 생성하지 않는다.
- PATCH는 생략한 필드를 유지한다. `sexAtMeasurement`, `centerName`, `reportedOverallGrade`만 메타데이터 null 삭제가 가능하다. `entryMethod`, 나이·날짜·items는 null 불가다.
- PATCH의 `items`는 전체 교체다. 유지할 항목도 함께 보내고 제거할 항목은 제외한다. 각 새 항목에서 `reportedGrade` 생략/null은 null로 저장된다. 마지막 측정값을 제거하는 빈 배열은 허용하지 않는다.
- `reportedGrade`와 `reportedOverallGrade`는 원문 그대로 별도 저장하며 계산 결과가 덮어쓰지 않는다.

## 상세·생성·수정 응답

세 경로는 동일한 상세 구조를 반환한다. 기존 필드는 유지하고 `items[].evaluation`, 최상위 `axes`를 추가했다. 목록은 기존 회차 요약을 유지한다. 계산값은 클라이언트가 제출할 수 없으며 알 수 없는 입력 필드는 400이다.

각 `items[].evaluation`은 다음을 포함한다.

| 필드                                                 | 의미                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `measurementId`, `measurementCode`, `recordRevision` | 평가한 기록·종목·수정 버전                                                            |
| `grade`                                              | 계산 등급 또는 null. 기준 미달/평가 불가를 숫자 0으로 표현하지 않음                   |
| `status`, `reasonCode`, `message`                    | 판정 상태·기계 사유 코드·한국어 설명                                                  |
| `ageAtMeasurement`, `ageBand`, `sex`                 | 측정 당시 만 나이, 적용 구간, 성별 구간                                               |
| `criterion`                                          | 기준 ID·내부 버전·공식 버전·시행일·종료일·프로토콜·단위·방향·대상·출처. 미적용은 null |
| `thresholds`                                         | 등급별 조건. 경계 수치와 포함 여부를 명시                                             |
| `nextTarget`                                         | 다음 등급 조건·방향별 차이 또는 제공 불가/최고 등급 상태                              |
| `evaluatedAt`                                        | 계산 시각 ISO UTC. 기존 미평가 데이터는 null                                          |

| 종목 `status`              | `grade`            | 대표 사유                                                                                                                           |
| -------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `graded`                   | 1 이상의 공식 등급 | `official_criterion_applied`                                                                                                        |
| `below_standard`           | null               | `below_lowest_grade`                                                                                                                |
| `insufficient_information` | null               | `sex_at_measurement_missing` 등                                                                                                     |
| `criteria_unavailable`     | null               | `self_curl_up_criteria_unverified`, `ymca_bpm_criteria_unverified`, `criteria_age_not_supported`, `criteria_not_applicable_date` 등 |
| `not_evaluated`            | null               | `evaluation_not_stored` (기존 평가 데이터 없음)                                                                                     |

미측정 검사는 행을 만들지 않는다. 신체구성의 수치가 있다는 이유로 임의 등급이나 6축 점수를 생성하지 않는다. 필요한 정보가 여러 개 부족하면 만 나이·성별 등 필수 정보 누락 사유가 먼저 반환될 수 있다.

종합 인증은 별개다. 기존 최상위 `evaluation.status`는 `not_evaluated`를 유지하되 사유는 `overall_certification_not_computed`로 변경했다. 종목 평가는 위 새 필드로 읽고, 원문 `reportedOverallGrade`를 서버 계산 인증으로 표시하지 않는다. 부분 측정을 완전한 체력인증서처럼 표시하지 않는다.

### 다음 등급

공식 기준 남성 만 25–29세 교차윗몸일으키기는 1등급 51회 이상, 2등급 45회 이상, 3등급 38회 이상이다. 예시 49회는 2등급이고 다음 목표 일부 응답은 다음과 같다.

```json
{
  "status": "available",
  "grade": 1,
  "intervals": [
    { "lower": { "value": "51", "inclusive": true }, "upper": null }
  ],
  "adjustments": [
    {
      "lower": {
        "threshold": "51",
        "inclusive": true,
        "difference": "2",
        "unit": "회",
        "change": "increase",
        "requiresBeyondBoundary": false
      },
      "upper": null
    }
  ],
  "reasonCode": null
}
```

`intervals`는 대안(OR), 한 interval의 lower/upper는 모두 충족(AND)해야 한다. `adjustments`는 같은 인덱스의 interval에 대응한다. 낮을수록 좋은 종목은 upper 경계와 `change: "decrease"`로 차이를 반환한다. 범위형·복수 조건을 하나의 목표 숫자로 축약하지 않는다. 이미 충족한 경계는 차이 `"0"`, change `none`이다. 열린 경계는 `requiresBeyondBoundary: true`로 표시하며 임의 epsilon을 더하거나 반올림하지 않는다.

기준 미달이면 최저 공식 등급의 조건을 반환한다. 최고 등급은 `status: "highest_grade"`, grade null, 빈 조건/차이 배열이고 임의 목표를 만들지 않는다. 평가 불가는 `status: "unavailable"`과 해당 reasonCode, grade null, 빈 배열이다. 성인 운동체력 항목에는 공식 1·2등급만 있으므로 임의 3등급을 추가하지 않는다.

## 6축과 최신 다각형

축은 항상 심폐지구력 → 근력 → 근지구력 → 유연성 → 민첩성 → 순발력 순서다. 대응은 `src/measurements/evaluation/measurement-evaluator.ts`의 `MEASUREMENT_AXES`로 명시하며 신체구성·청소년 협응력은 넣지 않는다.

동일 축의 평가 가능한 종목 중 숫자가 가장 작은 등급을 선택한다. 등급이 있으면 기준 미달보다 우선하고, 등급 없이 평가 가능한 것이 전부 기준 미달이면 `below_standard`다. 측정한 검사가 전부 평가 불가면 `unevaluable`, 측정한 검사가 없으면 `not_measured`다. 동률 또는 기준 미달/평가 불가 대표는 **검사 코드 ASCII 오름차순**으로 결정한다. 각 축은 `representativeMeasurementCode`, 전체 `measuredMeasurementCodes`, `recordRevision`을 포함한다. 상세는 개별 결과를 모두 보존한다. 그래프 원점 표시 여부는 프론트가 status로 처리하며 실제 grade null을 0등급으로 바꾸지 않는다.

```http
GET /api/v1/measurements/latest-polygon
Authorization: Bearer <access_token>
```

위 생성 예시의 200 응답(실제 ID는 생성 응답 값):

```json
{
  "measurementId": "<기록 ID>",
  "measuredOn": "2026-09-23",
  "revision": 1,
  "axes": [
    {
      "axis": "cardiorespiratory_endurance",
      "label": "심폐지구력",
      "grade": null,
      "status": "unevaluable",
      "representativeMeasurementCode": "ymca_recovery_heart_rate",
      "measuredMeasurementCodes": ["ymca_recovery_heart_rate"],
      "reasonCode": "all_measurements_unevaluable",
      "recordRevision": 1
    },
    {
      "axis": "strength",
      "label": "근력",
      "grade": null,
      "status": "not_measured",
      "representativeMeasurementCode": null,
      "measuredMeasurementCodes": [],
      "reasonCode": "no_measurements",
      "recordRevision": 1
    },
    {
      "axis": "muscular_endurance",
      "label": "근지구력",
      "grade": 2,
      "status": "graded",
      "representativeMeasurementCode": "cross_sit_up",
      "measuredMeasurementCodes": ["cross_sit_up", "self_curl_up"],
      "reasonCode": "best_available_grade",
      "recordRevision": 1
    },
    {
      "axis": "flexibility",
      "label": "유연성",
      "grade": null,
      "status": "not_measured",
      "representativeMeasurementCode": null,
      "measuredMeasurementCodes": [],
      "reasonCode": "no_measurements",
      "recordRevision": 1
    },
    {
      "axis": "agility",
      "label": "민첩성",
      "grade": null,
      "status": "not_measured",
      "representativeMeasurementCode": null,
      "measuredMeasurementCodes": [],
      "reasonCode": "no_measurements",
      "recordRevision": 1
    },
    {
      "axis": "power",
      "label": "순발력",
      "grade": null,
      "status": "not_measured",
      "representativeMeasurementCode": null,
      "measuredMeasurementCodes": [],
      "reasonCode": "no_measurements",
      "recordRevision": 1
    }
  ]
}
```

기존 목록과 같은 `measuredOn DESC, id ASC`로 **한 회차만** 선택한다. 다른 회차의 항목을 끌어오지 않으며 `updatedAt`은 정렬에 사용하지 않는다. 수정 완료 후 조회는 새 평가/revision을, 삭제 완료 후 조회는 다음 회차를 반환한다. 동시 수정·삭제와 겹친 조회는 Repeatable Read의 일관된 이전 스냅샷을 반환할 수 있다.

기록이 없으면 200, measurementId/measuredOn/revision 모두 null과 6개 `not_measured` 축(grade/대표 검사/recordRevision null, 측정 코드 빈 배열)을 반환한다. 인증 없으면 401이며 다른 사용자의 기록은 조회 후보에 들어오지 않는다. 응답은 `Cache-Control: no-store`다.

## 기준·저장·호환성

운영 기준은 문화체육관광부 고시 제2025-0027호(시행 2025-06-02)와 국민체력100 공식 성인 표를 대조했다. 적용 항목은 상대악력, 교차윗몸일으키기, 20m 왕복오래달리기, 트레드밀 VO₂max, 스텝검사 VO₂max, 앉아윗몸앞으로굽히기, 10m 4회 왕복달리기, 반응시간, 제자리멀리뛰기, 체공시간이다. 만 19–64세 남/여 각 9개 연령 구간에 한정하며 시행일 이전 측정에 소급 적용하지 않는다. 상세 출처·공식 버전·내부 버전은 평가의 criterion에 포함된다. 청소년 등급, 신체구성 종목 등급, 성인 self_curl_up, YMCA bpm은 이 구현에서 공식 기준 미확보로 처리한다.

생성·수정은 같은 트랜잭션에서 측정값·평가·revision을 함께 저장한다. 생략된 items도 수정된 메타데이터로 재평가한다. 원문 등급은 보존한다. 조회는 저장된 평가를 사용하며 기준 코드가 바뀌었다고 과거 기록을 재평가하지 않는다. DB deferred validator는 평가의 기록·종목·revision 일치를 검사한다.

마이그레이션 전 기록의 evaluation은 null을 유지한다. 조회에서 `not_evaluated/evaluation_not_stored`, 평가 시각 null로 직렬화하고 실제 기준 미달·미측정과 구분한다. 이후 사용자가 그 기록을 수정하면 해당 수정에서 처음 평가한다. 별도 일괄 재평가 정책·작업은 없다.

기존 카탈로그·manual 기본값·Decimal·부분저장·Idempotency-Key·If-Match·온보딩 조건을 유지한다. 이전 서버가 생성한 manual 요청 키의 해시도 호환된다. 응답에 새 필드가 추가되므로 프론트의 엄격한 응답 스키마를 확장하고, 기존 최상위 evaluation.reason을 하드코딩했다면 새 종합 인증 사유를 허용해야 한다. 현재 프론트 화면 구현은 이 작업 범위가 아니다.

마이그레이션: `backend/`에서 `npm run db:generate`, `npm run db:migrate:deploy` 후 새 서버를 시작한다. 운영 배포·실물 결과지 추출 검증은 완료 조건에 포함하지 않는다. 테스트는 개발/운영 DB와 분리된 테스트 DB의 임시 스키마에서 수행한다.
