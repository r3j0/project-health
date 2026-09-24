# 절대악력 입력과 상대악력 환산

2026-09-24 사용자 결정: 결과표에 악력(kg)이 있는 사용자는 `absolute_grip_strength`로 원본을 저장한다. 같은 회차의 `weight`(kg)로 `절대악력 / 체중 × 100`을 계산하여 기존 `relative_grip_strength` 공식 기준에 적용한다.

- 새 카탈로그: `nfa100-2026-09-24-grip-v1`. 기존 카탈로그·과거 기록·평가 스냅샷을 변경하지 않는다.
- 검사 정의: `절대악력`, `kg`, decimal, 0 이상, 만 13~64세, 근력 축. 청소년 원본은 저장 가능하나 현재 검증된 등급표가 성인용이므로 청소년은 기준 부재를 반환한다.
- 직접 입력·사진 결과 확인 후 기존 측정 POST로 저장한다. 간이측정 운동 프로토콜에는 악력계 검사를 추가하지 않는다.
- 체중 없이도 원본은 저장하며 `insufficient_information / weight_at_measurement_missing`으로 평가한다. 다른 회차나 계정의 체중을 가져오지 않는다. 0 이하 체중·음수 악력·잘못된 단위는 기존 카탈로그 검증으로 거절한다.
- 성별·나이·측정일 등 기준 적용 조건은 기존 판정 규칙을 유지한다.
- 상대악력 %가 직접 입력된 경우 덮어쓰지 않는다. 둘 다 있으면 각 항목의 등급을 구하고 기존 근력 축의 최고 등급 집계 규칙을 따른다.
- 기록 수정 시 같은 트랜잭션·revision에서 체중·절대악력·나이·성별 변경을 반영하여 재평가한다. 체중 제거 시 이전 환산값을 유지하지 않는다.

## 응답 확장

`items[].value/unit`은 원본 kg이다. 절대악력 `evaluation.measurementCode`도 `absolute_grip_strength`다. 환산에 필요한 체중이 있으면 선택 필드 `evaluation.conversion`을 추가한다.

```json
{
  "formulaVersion": "nfa100-relative-grip-v1",
  "measurementCode": "relative_grip_strength",
  "value": "60",
  "unit": "%",
  "inputs": [
    {
      "measurementCode": "absolute_grip_strength",
      "value": "30",
      "unit": "kg"
    },
    { "measurementCode": "weight", "value": "50", "unit": "kg" }
  ],
  "sourceUrl": "https://nfa.kspo.or.kr/community/faq/selectFaqList.kspo"
}
```

`criterion.measurementCode`는 `relative_grip_strength`, 기준 및 다음 목표 단위는 `%`다. 원본 kg의 숫자를 % 등급 기준에 직접 대입하지 않는다. `conversion.inputs`는 같은 revision의 실제 입력이다. 평가 불가라도 환산이 가능하면 환산 근거를 제공한다.

입력 수치는 최대 128자 Decimal 문자열을 보존한다. 유한 소수가 아닌 환산값·목표 차이는 Decimal 유효숫자 300자리로 직렬화한다. 등급 경계 비교는 나눗셈 결과를 반올림하지 않고 원본의 교차 곱(`악력 × 100` 대 `기준 × 체중`)으로 비교한다. UI는 표시용으로만 줄일 수 있으며 축 등급은 서버의 평가를 사용한다.

## 사진 추출

절대악력 kg과 상대악력 %를 별도 코드로 식별한다. 사진 단계에서 환산하거나 새 등급을 만들지 않는다. 좌·우·복수 시도 값의 대표값이 명시되지 않으면 기존 `multiple_attempts` 검토 흐름을 유지한다. 사용자가 확인한 원본과 같은 회차의 체중을 저장할 때 서버가 환산한다.

## 출처

사용자가 제공한 국민체력100 「상대악력이란?」 안내 자료(2026-09-24 확인): 체중 50kg, 악력 25kg이면 상대악력 50%. [공식 FAQ](https://nfa.kspo.or.kr/community/faq/selectFaqList.kspo), [성인 측정 항목](https://nfa.kspo.or.kr/reserve/3/selectMeasureItemListByAgeSe.kspo). 등급표는 기존 `official-criteria.ts`의 출처·시행일·성별·연령 범위를 그대로 적용한다. YMCA 환산 및 목록 정렬 변경은 이 작업에 포함하지 않는다.
