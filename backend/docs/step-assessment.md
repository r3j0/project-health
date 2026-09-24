# 성인 스텝검사 참고 평가

2026-09-24 사용자 결정: 자가측정 회복 심박수(bpm)를 성인 최대산소섭취량 추정식으로 환산하고, 기존 스텝검사 기준으로 참고 등급을 반환한다. 공식 인증 또는 센터 측정과 동일한 정확도를 보장하는 결과가 아니다.

## 근거와 적용 범위

- 공식 환산식: [국민체력100 FAQ](https://nfa.kspo.or.kr/community/faq/selectFaqView.kspo?contSn=36786), 「국민체력100 심폐지구력 최대산소섭취량 계산공식」. 사용자 제공 첨부본의 성인 출처는 한국스포츠개발원 체력인증센터 모델개발 결과보고서(2014).
- [자가측정 방법](https://nfa.kspo.or.kr/measure/self/selectSelfMeasureItem.kspo): 30cm 박스, 96bpm, 180초 운동, 60초 휴식, 10초 맥박 × 6. 공개 안내 및 사용자 자료 확인일 2026-09-24.
- [등급표](https://nfa.kspo.or.kr/reserve/0/selectMeasureGradeItemListByAgeSe.kspo): 기존 성인 `step_test_vo2max` 성별·연령별 수치와 시행일을 재사용한다. 추정값을 반올림해 등급 경계를 넘기지 않는다.
- 수동 10초 맥박 추정과 센터의 심박계 측정 간 동등성은 검증되지 않았다. `assessmentKind: reference`와 버전이 있는 자가측정 protocol을 저장하며 정식 인증으로 표현하지 않는다.
- 성인 만 19–64세만 지원한다. 청소년 공식으로 자동 대체하지 않는다.

## 계산 및 저장 계약

남성: `70.597 - 0.246×나이 + 0.077×신장 - 0.222×체중 - 0.147×심박수`

여성: `54.337 - 0.185×나이 + 0.097×신장 - 0.246×체중 - 0.122×심박수`

단위는 만 나이, cm, kg, bpm이며 결과는 ml/kg/min이다. 입력 심박수는 이미 bpm이므로 백엔드에서 다시 6을 곱하지 않는다. 모든 계산 입력은 해당 측정 기록에서만 얻으며 계정의 현재 신체정보로 보충하지 않는다. Decimal precision 300으로 유한 소수 선형식을 계산한다.

기존 `ymca_recovery_heart_rate` 원본을 유지하고 해당 항목의 `evaluation.conversion`에 다음을 저장한다:

- `formulaVersion: nfa100-adult-step-vo2max-v1`
- `measurementCode: step_test_vo2max`, `value`, `unit: ml/kg/min`
- `inputs`: 원본 심박수, 신장, 체중의 code/value/unit
- `ageAtMeasurement`, `sexAtMeasurement`
- `assessmentKind: reference`
- `protocol: nfa100-self-step-30cm-96bpm-180s-rest60s-pulse10s-v1`
- `sourceUrl`, `protocolUrl`

평가의 measurementCode는 원본 심박수 코드다. criterion/thresholds/nextTarget은 VO₂max 기준이며 내부 기준 버전에 `-step-reference-v1`을 붙여 기존 직접입력 평가와 구분한다. 직접 입력한 `step_test_vo2max`의 계약과 기준은 변경하지 않는다. 같은 축의 다른 측정이 있다면 기존 최고 등급 집계 규칙을 그대로 적용한다.

성별·신장·체중 등 정보가 부족하면 원본만 저장하고 `insufficient_information`과 구체적인 reasonCode를 반환한다. 계산 결과가 0 이하이면 입력 확인이 필요한 `step_vo2max_out_of_range`로 반환하며 음수 점수에 등급을 부여하지 않는다. 사용자 PATCH 시 기존 트랜잭션에서 재평가한다. GET, 동일 생성 요청 재시도, 배포 시에는 과거 평가를 일괄 재계산하지 않는다.

기존 JSON 평가 스냅샷을 확장하므로 DB 스키마·카탈로그 마이그레이션은 필요 없다. 사용자 운동 커리큘럼 및 온보딩 판단 규칙도 변경하지 않는다.

## 구현 검증

2026-09-24 `npm run check` 통과: 단위 테스트 189개, 격리 PostgreSQL 통합 테스트 228개, Prisma 검증·생성, 포맷·린트·타입 검사 및 Nest 빌드. 남녀 환산값, 성인 경계, 정보 누락, 반올림 경계, 같은 기록의 값 수정, 다른 심폐지구력 검사와 최고 등급 집계, 과거 스냅샷·멱등 재시도 보존을 확인했다.
