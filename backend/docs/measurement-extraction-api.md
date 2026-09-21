# 국민체력100 결과지 사진 추출 API

구현·공식 OpenAI 문서 확인일: 2026-09-21. 만 13–64세의 국민체력100 결과지에서 한 사람·한 측정 회차를 추출한다. 별도 OCR 엔진이나 팀원 서버 없이 **우리 백엔드에서 OpenAI Responses API를 호출**한다. 팀원의 키도 서버 비밀 설정으로만 주입한다.

반환값은 사용자가 확인·수정할 **저장 전 초안**이다. 추출만으로 Measurement, MeasurementItem, 생성 요청 키 또는 사용자 계정·온보딩을 변경하지 않는다. 호출 제한 카운터만 기존 `auth_rate_limits`에 기록한다. 프론트 화면과 DB 스키마는 변경하지 않았다.

## 환경설정과 실행

기존 인증·DB 환경설정과 실행 방법은 [백엔드 README](../README.md)를 따른다. 추가 설정은 백엔드의 `OPENAI_API_KEY`, `OPENAI_OCR_MODEL` 두 개다. `.env.example`에는 이름·설명과 빈 값만 있다. 실제 키는 Git, 프론트 환경변수, 브라우저, 요청 본문, 문서, 로그에 넣지 않는다. 팀원 서버 주소나 이미지 URL 설정은 없다.

두 설정이 비어 있거나 형식이 잘못되면 추출만 `503 EXTRACTION_UNAVAILABLE`이다. 서버 시작, 인증, 카탈로그와 기존 측정 CRUD는 계속 동작한다. 모델은 자동 선택하지 않으며 대체 모델로 조용히 전환하지 않는다. 배포 담당자가 **이미지 입력·Responses·Structured Outputs를 모두 지원하고 해당 프로젝트에서 호출 가능한 모델**을 설정해야 한다.

[GPT-4.1 mini 공식 모델 페이지](https://developers.openai.com/api/docs/models/gpt-4.1-mini)는 이 세 기능을 명시한 모델의 예다. 이는 해당 계정의 접근 권한이나 국민체력100 결과지 인식 품질·최적성을 확인했다는 뜻이 아니다. 비용·품질·한글 및 작은 글자 판독은 익명화된 실제 표본으로 검증한 후 모델을 확정한다.

정책은 `src/measurements/extraction/extraction.config.ts` 한곳에 있다.

| 설정        | 현재 정책                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| 이미지 파일 | JPEG·PNG·WebP, 1장, 원본 최대 10 MiB(10,485,760바이트)                                               |
| 디코딩 제한 | 최대 24,000,000픽셀, 가로·세로 각각 10,000픽셀, 다중 프레임 거절                                     |
| 이미지 처리 | 전체 디코딩·EXIF 방향 보정·sRGB PNG 재인코딩, 크기 축소 없음, 변환 결과도 최대 10 MiB                |
| 이미지 입력 | `input_image`, 인라인 PNG data URL, `detail: high`                                                   |
| 외부 호출   | 네이티브 fetch, 요청당 최대 1회, 자동 재시도 없음, 리다이렉트 금지                                   |
| 시간 제한   | 인증·호출 제한 검사 후 업로드부터 결과 반환까지 45초, 이미지 처리 8초, 외부 연결·본문 수신 합계 30초 |
| 출력 제한   | 최대 8,000 출력 토큰, 외부 응답 최대 256 KiB, 후보 최대 100개                                        |
| 비용 제한   | 사용자별 고정 시간창 1분 5회·1일 30회, 실패·잘못된 업로드도 소비                                     |
| 동시 처리   | 프로세스당 최대 4개, 초과 시 503; 사용자 호출 제한은 DB로 인스턴스 간 공유                           |

고정 시간창은 Unix 시간 기준이며 달력상의 한국 자정 기준이 아니다. 분·일 카운터는 서로 다른 키로 분리한다. `429`의 `Retry-After` 초가 지나기 전에는 재호출하지 않는다. 만료된 카운터는 기존 `npm run auth:cleanup` 정책으로 정리한다. 추출에는 Idempotency-Key 계약이 없으므로 사용자 재요청은 새 추출 비용을 발생시킬 수 있다.

원본 사진은 메모리에만 받고 디스크·DB·Files API에 보관하지 않는다. 실제 파일 시그니처, 선언 MIME과 일치 여부, 크기·프레임·전체 이미지 디코딩을 검증한다. 원본 파일명은 분석에 전달하지 않는다. 재인코딩으로 EXIF/GPS·메타데이터·뒤에 붙인 데이터를 제거하며 작업 종료 시 업로드 버퍼를 비운다. 로그에 이미지, Base64, 측정값, 외부 응답 원문이나 API 키를 남기지 않는다.

OpenAI에는 분석을 위해 이미지가 전송된다. `store: false`를 사용하지만 이것을 OpenAI 측의 모든 데이터 보존이 없다는 보장으로 해석하면 안 된다. 실제 배포 프로젝트의 데이터 보존 설정은 [OpenAI 데이터 제어 문서](https://developers.openai.com/api/docs/guides/your-data)를 확인한다. 프론트는 업로드 전에 외부 분석 전송 사실을 안내하고 불필요한 개인정보가 가려진 사진 사용을 안내할 수 있다.

## 요청

`POST /api/v1/measurements/extract`

- 기존 `Authorization: Bearer <access_token>` 인증을 사용한다. 만료·폐기된 세션은 401이다.
- `multipart/form-data`의 파일 필드 `image`는 정확히 1개다.
- 텍스트 필드 `catalogVersion`만 선택 입력이다. 생략하면 기존 카탈로그 서비스가 확인일·버전 내림차순으로 최신 버전을 조회한다. 빈 문자열이나 반복 필드·다른 필드는 거절한다.
- 원격 이미지 URL, Base64 JSON 본문, 사용자 ID, 모델명, 키, 프롬프트는 요청 입력으로 받지 않는다.
- 성공 HTTP 상태는 200이며 `Cache-Control: no-store`다. 새 기록을 생성하지 않으므로 201·기록 ID·revision·ETag를 반환하지 않는다.

```bash
curl -sS -X POST http://localhost:3001/api/v1/measurements/extract \
  -H "Authorization: Bearer $TOKEN" \
  -F 'image=@/absolute/path/report.png;type=image/png'
```

특정 버전을 사용하려면 위 요청에 `-F 'catalogVersion=nfa100-2026-09-19'`를 추가한다. 버전은 실제 카탈로그 응답에서 선택한다. 이 명령의 사진 경로는 직접 준비한 결과지로 교체한다.

브라우저에서는 `FormData`에 파일과 선택 버전을 넣는다. multipart boundary는 브라우저가 생성하도록 `Content-Type`을 직접 설정하지 않는다.

```ts
const form = new FormData();
form.append('image', selectedFile);
if (selectedCatalogVersion)
  form.append('catalogVersion', selectedCatalogVersion);
const response = await fetch(`${apiBase}/measurements/extract`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}` },
  body: form,
});
const result = await response.json();
if (!response.ok) {
  // code/statusCode와 429의 Retry-After를 이용해 오류·재시도 안내를 표시한다.
  throw result;
}
// 모든 items와 metadata를 사용자에게 보여 주고 수정·확인을 받는다.
// extracted도 자동 저장하거나 기관이 검증한 결과로 표시하지 않는다.
```

## 반환 스키마

| 필드                            | 형식·의미                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalogVersion`                | 서버가 실제 조회·검증한 카탈로그 버전                                                                                                                      |
| `status`                        | 아래 추출 상태                                                                                                                                             |
| `metadata.measuredOn`           | 실제 존재하는 한국 기준 비미래 날짜 `YYYY-MM-DD` 또는 null                                                                                                 |
| `metadata.ageAtMeasurement`     | 측정 당시 만 13–64세 정수 또는 null                                                                                                                        |
| `metadata.sexAtMeasurement`     | `male`, `female`, null                                                                                                                                     |
| `metadata.centerName`           | 원문 센터명(최대 200자) 또는 null                                                                                                                          |
| `metadata.reportedOverallGrade` | 원문 종합등급(최대 100자) 또는 null                                                                                                                        |
| `items`                         | 코드·수치·원문 단위·카탈로그 제약 검증을 통과한 항목 배열. 나이 미상 시 연령 검증은 보류                                                                   |
| `items[].measurementCode`       | 해당 카탈로그의 검사 코드                                                                                                                                  |
| `items[].value`                 | 기존 저장 API와 같은 10진수 문자열. Decimal로 정규화하므로 `-3.2500` → `-3.25`, 정밀도·부호·실제 0 보존                                                    |
| `items[].unit`                  | 카탈로그의 정규 단위                                                                                                                                       |
| `items[].reportedGrade`         | 원문 항목별 등급 또는 null                                                                                                                                 |
| `items[].evidence`              | 해당 항목의 원문 `label`, `value`, `unit`만 담는 객체                                                                                                      |
| `reviewItems`                   | 검증 불가한 항목. 후보 `measurementCode`, `value`, `unit`, `reportedGrade`, `evidence`, 중복 없는 `reasons` 배열. 원문을 유지하며 값·코드·단위는 null 가능 |
| `issues`                        | `{ code, field, requiresInput }[]`. 문제 및 저장 전 입력 필요 필드                                                                                         |
| `notDetectedMeasurementCodes`   | 연령에 해당하는 카탈로그 중 **모델이 행을 탐지하지 않은** 코드. 미실시·필수 누락을 뜻하지 않음                                                             |

실제로 보이지 않는 정보는 계정·현재 나이·생년월일 등으로 보충하지 않는다. 잘못된 메타데이터는 null과 `INVALID_METADATA`로 반환한다. 읽을 수 없었던 행은 `reviewItems`의 `UNREADABLE_VALUE`, 빈 행은 `BLANK_VALUE`로 구분한다. 탐지되지 않은 행은 사진에 없거나 모델이 놓친 것일 수 있으므로 ‘미측정’이라고 확정하지 않는다. 대체 검사를 모두 채울 필요는 없다.

의미상 같은 단위만 명시적 별칭으로 정규화한다: `㎝`/`센티미터` → `cm`, `㎏`/`킬로그램` → `kg`, `％`/`퍼센트` → `%`, `횟수` → `회`, `s`/`sec` → `초`, `kg/m2`/`kg/㎡`/`㎏/㎡` → `kg/m²`, `mL/kg/min`/`mL·kg⁻¹·min⁻¹`/`ml·kg⁻¹·min⁻¹` → `ml/kg/min`. 앞뒤 공백 외의 퍼지 매칭은 하지 않는다. `ms` → `초`, `m` → `cm` 같은 수치 환산은 하지 않고 확인 대상으로 남긴다. 사진의 원문 단위가 없으면 카탈로그 단위로 채우지 않는다.

다음은 합성 예시다. 운영 경로가 생성하는 예시·기본 측정값이 아니다.

```json
{
  "catalogVersion": "nfa100-2026-09-19",
  "status": "partial",
  "metadata": {
    "measuredOn": "2024-02-29",
    "ageAtMeasurement": 25,
    "sexAtMeasurement": "female",
    "centerName": null,
    "reportedOverallGrade": null
  },
  "items": [
    {
      "measurementCode": "sit_and_reach",
      "value": "-3.25",
      "unit": "cm",
      "reportedGrade": null,
      "evidence": {
        "label": "앉아윗몸앞으로굽히기",
        "value": "-3.2500",
        "unit": "cm"
      }
    }
  ],
  "reviewItems": [
    {
      "measurementCode": null,
      "value": "32",
      "unit": "kg",
      "reportedGrade": null,
      "evidence": { "label": "악력", "value": "32", "unit": "kg" },
      "reasons": ["UNKNOWN_TEST"]
    }
  ],
  "issues": [
    {
      "code": "ITEM_REVIEW_REQUIRED",
      "field": "reviewItems",
      "requiresInput": false
    }
  ],
  "notDetectedMeasurementCodes": [
    "bmi",
    "body_fat_percentage",
    "cross_sit_up",
    "flight_time",
    "height",
    "reaction_time",
    "relative_grip_strength",
    "shuttle_run_10m_4",
    "shuttle_run_20m",
    "standing_long_jump",
    "step_test_vo2max",
    "treadmill_vo2max",
    "waist_circumference",
    "weight"
  ]
}
```

## 상태·확인 사유

HTTP 200은 추출 처리가 끝났다는 의미다. 인식 결과가 저장 가능하다는 뜻은 아니다.

| `status`          | 의미                                                                    |
| ----------------- | ----------------------------------------------------------------------- |
| `extracted`       | 탐지된 항목·필수 메타데이터의 서버 검증 통과. 사용자 확인은 여전히 필수 |
| `partial`         | 유효한 항목이 있으나 확인 대상·판독 불가 영역·필수 정보 부족 등이 있음  |
| `needs_review`    | 대상 결과지로 인식했으나 검증된 수치가 없음                             |
| `not_target`      | 국민체력100 대상 결과지가 아님                                          |
| `unreadable`      | 문서를 판독할 수 없음                                                   |
| `grades_only`     | 원문 등급만 있는 결과지. 기존 저장 API는 수치 없이 저장 불가            |
| `mixed_sessions`  | 여러 측정 회차 혼재. 임의로 한 회차를 선택하지 않음                     |
| `multiple_people` | 여러 사람의 결과 혼재                                                   |
| `unsupported_age` | 판독된 만 나이가 13–64세 밖. 모든 후보를 확인 대상으로 옮김             |

`not_target`, `unreadable`, `mixed_sessions`, `multiple_people`에서는 `items`·`reviewItems`·탐지 누락 목록이 비고 메타데이터는 모두 null이다. 모델이 함께 보낸 그럴듯한 수치도 폐기한다. `grades_only`에서는 원문 등급을 남기되 수치를 `items`에 넣지 않는다.

`reviewItems[].reasons`:

- 식별: `UNKNOWN_TEST`, `AMBIGUOUS_TEST`, `MISSING_EVIDENCE`.
- 값: `BLANK_VALUE`, `UNREADABLE_VALUE`, `INVALID_VALUE`, `VALUE_EVIDENCE_MISMATCH`, `VALUE_CONSTRAINT`, `INVALID_REPORTED_GRADE`.
- 단위: `UNIT_MISSING`, `UNIT_UNCLEAR`, `UNIT_MISMATCH`, `UNIT_CONVERSION_REQUIRED`.
- 복수값·출처: `DUPLICATE_CODE`, `CONFLICTING_VALUES`, `MULTIPLE_ATTEMPTS`, `NOT_PERSONAL_VALUE`, `GRADES_ONLY`.
- 연령: `AGE_NOT_APPLICABLE`, `UNSUPPORTED_AGE`.

동일 코드가 두 번 나오면 값이 같아도 양쪽 모두 확인 대상으로 이동한다. 서버는 최대·평균·첫 번째 값을 선택하지 않는다. 절대악력 kg과 상대악력 %는 다른 검사이며 변환하지 않는다. 원문 value·unit 근거와 모델 후보가 불일치하면 통과시키지 않는다.

`issues[].code`:

- `INPUT_REQUIRED`: `metadata.measuredOn`, `metadata.ageAtMeasurement`, `items` 중 저장에 필요한 필드. `requiresInput: true`.
- `INVALID_METADATA`: 형식·의미 검증 실패. 원문 이상값을 임의로 정상값으로 수정하지 않음.
- `AGE_VALIDATION_PENDING`: 나이를 알 수 없거나 유효하지 않아 항목별 연령 적합성 검증 보류. 사용자가 나이를 입력하면 기존 저장 API에서 다시 검증.
- `UNSUPPORTED_AGE`: 지원 연령 밖. 다른 나이로 바꾸어 저장하도록 유도하지 않으며 실제 측정 당시 나이를 확인해야 함.
- `UNREADABLE_REGION`, `ITEM_REVIEW_REQUIRED`: 사진 일부 또는 항목 확인 필요.
- `NOT_TARGET`, `UNREADABLE`, `GRADES_ONLY`, `MIXED_SESSIONS`, `MULTIPLE_PEOPLE`: 문서 상태 사유.

모델 출력에 confidence 수치는 없다. Structured Outputs는 구조를 제한할 뿐 실제 사진 내용의 정확성을 보증하지 않는다. 서버는 코드·단위·수치 제약·중복·날짜·나이·성별을 따로 검증하며, 실제 인식 오류는 사용자 확인과 표본 평가로 다룬다.

## HTTP 오류

추출 전용 오류는 `{ "statusCode": 503, "code": "EXTRACTION_UNAVAILABLE", "message": "EXTRACTION_UNAVAILABLE" }`처럼 안정적인 `code`로 분기한다. 인증·카탈로그 오류는 기존 API 형식을 유지한다. 외부 서비스의 응답 원문·키·사진을 오류에 포함하지 않는다.

| HTTP | 코드                                                                                    | 처리                                                                     |
| ---- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 400  | `MULTIPART_REQUIRED`, `INVALID_MULTIPART`, `IMAGE_REQUIRED`, `INVALID_EXTRACTION_INPUT` | 폼·파일 개수·필드 확인                                                   |
| 400  | `INVALID_IMAGE`, `MULTI_FRAME_IMAGE`                                                    | 디코딩 가능한 단일 프레임 사진으로 교체                                  |
| 401  | 기존 인증 오류                                                                          | 로그인·토큰 갱신                                                         |
| 404  | 기존 카탈로그 오류                                                                      | 사용 가능한 버전 조회                                                    |
| 413  | `IMAGE_TOO_LARGE`, `IMAGE_DIMENSIONS_EXCEEDED`                                          | 파일 크기·해상도를 제한 이하로 조정                                      |
| 415  | `UNSUPPORTED_IMAGE`, `IMAGE_TYPE_MISMATCH`                                              | 지원 형식과 실제 MIME으로 업로드                                         |
| 422  | `OPENAI_REFUSAL`                                                                        | 모델의 분석 거절. 성공 결과로 대체하지 않음                              |
| 429  | `EXTRACTION_RATE_LIMITED`                                                               | 사용자 호출 제한. `Retry-After` 헤더와 `retry_after` 본문 초 제공        |
| 502  | `OPENAI_INCOMPLETE`                                                                     | 토큰 한도·필터·미완료/잘린 응답. 잘린 JSON을 부분 성공으로 사용하지 않음 |
| 502  | `OPENAI_INVALID_RESPONSE`                                                               | JSON·스키마·메시지 구조·응답 크기 오류                                   |
| 502  | `OPENAI_REQUEST_REJECTED`                                                               | 기타 외부 요청 오류. 서버 설정 점검                                      |
| 503  | `EXTRACTION_UNAVAILABLE`                                                                | 키·모델 미설정/형식 오류                                                 |
| 503  | `OPENAI_CONFIGURATION_ERROR`                                                            | 외부 401·403·404. 키·모델·프로젝트 권한 확인                             |
| 503  | `OPENAI_RATE_LIMITED`                                                                   | 외부 429, 사용자 자체 제한과 구분                                        |
| 503  | `OPENAI_UNAVAILABLE`                                                                    | 외부 5xx·연결 실패                                                       |
| 503  | `EXTRACTION_BUSY`                                                                       | 동시 처리 한도                                                           |
| 503  | 기존 카탈로그 준비 오류                                                                 | DB 기준 데이터 준비                                                      |
| 504  | `EXTRACTION_TIMEOUT`                                                                    | 요청 또는 외부 응답 시간 제한                                            |

실패 시 자동 재호출하거나 예시 데이터로 바꾸지 않는다. 취소·시간 초과 시 진행 중인 외부 요청에도 AbortSignal을 전달한다. 이미 외부에서 처리한 요청의 과금 취소를 보장하지는 않는다.

## 확인 후 기존 API로 저장

추출 응답 전체를 저장 API에 보내면 strict 입력 검증에서 거절된다. 사용자가 회차 정보·각 항목을 확인한 후 필요한 필드만 변환한다. 확인 대상은 지원 코드·단위·값이 확정된 경우에만 추가하고, 빼더라도 다른 유효한 항목 1개 이상과 실제 측정일·나이가 있으면 부분 저장할 수 있다. 성별은 null이어도 저장 가능하다.

```ts
// confirmed는 사용자가 직접 확인·수정한 폼 상태다.
const saveBody = {
  catalogVersion: draft.catalogVersion,
  measuredOn: confirmed.measuredOn,
  ageAtMeasurement: confirmed.ageAtMeasurement,
  sexAtMeasurement: confirmed.sexAtMeasurement ?? null,
  centerName: confirmed.centerName ?? null,
  reportedOverallGrade: confirmed.reportedOverallGrade ?? null,
  items: confirmed.items.map((item) => ({
    measurementCode: item.measurementCode,
    value: item.value, // 문자열 유지; Number/parseFloat/반올림 금지
    unit: item.unit,
    reportedGrade: item.reportedGrade ?? null,
  })),
};
// 저장 작업당 한 번 생성. 네트워크 재시도에서는 같은 키와 본문을 유지한다.
const saveKey = crypto.randomUUID();
await fetch(`${apiBase}/measurements`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': saveKey,
  },
  body: JSON.stringify(saveBody),
});
```

저장 요청 예시:

```bash
MEASUREMENT_REQUEST_KEY=$(uuidgen)
curl -i -X POST http://localhost:3001/api/v1/measurements \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $MEASUREMENT_REQUEST_KEY" \
  --data '{"catalogVersion":"nfa100-2026-09-19","measuredOn":"2024-02-29","ageAtMeasurement":25,"sexAtMeasurement":"female","items":[{"measurementCode":"sit_and_reach","value":"-3.25","unit":"cm","reportedGrade":null}]}'
```

`evidence`, `reviewItems`, `issues`, `status`, `notDetectedMeasurementCodes`는 저장 요청에 포함하지 않는다. `reportKind`는 이번 추출 응답에서 추정하지 않으며 저장 요청에서 생략하면 기존 기본값 `unknown`이다.

기존 정책상 **`sourceProgram: nfa100`, `entryMethod: manual`은 서버가 설정**한다. OCR 초안을 확인하여 저장해도 이 정책을 유지하며 `entryMethod: ocr`를 보내면 거절된다. OCR 출처 저장을 위한 DB 변경은 없다. 저장 이후의 본인 소유권, Decimal 문자열, 부분 저장, Idempotency-Key, revision·ETag·If-Match 계약은 [측정 API](measurements-api.md)와 동일하다.

## 검증 범위와 실제 호출 확인

자동 테스트는 OpenAI HTTP transport만 대역으로 바꾸고 이미지 디코딩·인증·카탈로그·PostgreSQL·기존 저장은 실제 구현을 사용한다. fixture는 합성 값과 코드로 만든 빈 이미지다. 실제 사진 판독 품질이나 사진 속 악성 지시문에 대한 모델의 성공률을 검증한 것은 아니다. 프롬프트 규칙이 실제 호출에 포함되는지와 응답 후 서버 차단 규칙을 자동 검증한다. 운영 경로에는 테스트 대역이나 성공 fallback이 없다.

```bash
npm run check
```

실제 호출은 프로젝트 키·호출 가능한 모델·사용이 허용된 결과지 사진을 준비한 뒤 위 curl로 실행한다. 한글·작은 글자, 음수, 소수, 0, 본인 측정값과 기준표, 악력/상대악력, 여러 회차, 누락 단위를 사용자 확인 정답과 비교해야 한다. 사진에 지시문을 넣은 표본도 별도 평가하되 결과지 원문·API 키를 로그나 저장소에 보관하지 않는다. 추출 전후 기록 목록과 `/auth/me`를 비교하고 확인 후 저장 시에만 기록·온보딩이 바뀌는지 검증한다.

이번 작업 환경에는 실제 OpenAI 키·모델 설정과 호출용 결과지 표본이 준비되지 않아 **실제 OpenAI 호출은 수행하지 않았다**. 자동 검사 결과는 별도 [검증 기록](measurement-extraction-verification.md)에 남긴다.

공식 구현 근거: [이미지 입력](https://developers.openai.com/api/docs/guides/images-vision), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Sharp 디코딩 제한](https://sharp.pixelplumbing.com/api-constructor/). 프롬프트·출력 스키마·외부 호출·서버 검증은 각각 별도 파일로 관리한다.
