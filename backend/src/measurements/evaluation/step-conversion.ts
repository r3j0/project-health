import { Prisma } from '../../generated/prisma/client.js';
import type { EvaluationInput, StepConversion } from './evaluation-types.js';

// Inputs are at most 128 characters; the finite linear formula remains exact.
const Decimal = Prisma.Decimal.clone({ precision: 300 });
const coefficients = {
  male: ['70.597', '0.246', '0.077', '0.222', '0.147'],
  female: ['54.337', '0.185', '0.097', '0.246', '0.122'],
} as const;
type Failure = {
  ok: false;
  status: 'insufficient_information' | 'criteria_unavailable';
  reasonCode: string;
  message: string;
};
const missing = (reasonCode: string, message: string): Failure => ({
  ok: false,
  status: 'insufficient_information',
  reasonCode,
  message,
});

/** Reference estimate for the published NFA self-test protocol, not certification.
 * The caller supplies already-converted bpm: never multiply by six again.
 */
export function convertStepHeartRate(
  input: EvaluationInput,
  item: EvaluationInput['items'][number],
): { ok: true; conversion: StepConversion } | Failure {
  const age = input.ageAtMeasurement;
  const sex = input.sexAtMeasurement;
  if (age === null || !Number.isInteger(age))
    return missing(
      'age_at_measurement_missing',
      '스텝검사 환산에 측정 당시 만 나이가 필요합니다.',
    );
  if (age < 19 || age > 64)
    return {
      ok: false,
      status: 'criteria_unavailable',
      reasonCode: 'criteria_age_not_supported',
      message: '스텝검사 환산은 만 19~64세 성인만 지원합니다.',
    };
  if (sex === null)
    return missing(
      'sex_at_measurement_missing',
      '스텝검사 환산에 측정 당시 성별이 필요합니다.',
    );
  if (item.unit !== 'bpm' || new Decimal(item.value).lte(0))
    return missing(
      'step_heart_rate_invalid',
      '스텝검사 회복 심박수(bpm)를 확인해 주세요.',
    );
  const height = input.items.find((i) => i.measurementCode === 'height');
  const weight = input.items.find((i) => i.measurementCode === 'weight');
  if (!height || height.unit !== 'cm' || new Decimal(height.value).lte(0))
    return missing(
      'height_at_measurement_missing',
      '최대산소섭취량 환산에 같은 측정 기록의 신장(cm)이 필요합니다. 회복 심박수 원본은 저장했습니다.',
    );
  if (!weight || weight.unit !== 'kg' || new Decimal(weight.value).lte(0))
    return missing(
      'weight_at_measurement_missing',
      '최대산소섭취량 환산에 같은 측정 기록의 체중(kg)이 필요합니다. 회복 심박수 원본은 저장했습니다.',
    );
  const [constant, ageFactor, heightFactor, weightFactor, pulseFactor] =
    coefficients[sex];
  const value = new Decimal(constant)
    .minus(new Decimal(ageFactor).times(age))
    .plus(new Decimal(heightFactor).times(height.value))
    .minus(new Decimal(weightFactor).times(weight.value))
    .minus(new Decimal(pulseFactor).times(item.value));
  if (value.lte(0))
    return missing(
      'step_vo2max_out_of_range',
      '입력값으로 양수인 최대산소섭취량을 추정할 수 없습니다. 신장·체중·회복 심박수를 확인해 주세요.',
    );
  return {
    ok: true,
    conversion: {
      formulaVersion: 'nfa100-adult-step-vo2max-v1',
      measurementCode: 'step_test_vo2max',
      value: value.toFixed(),
      unit: 'ml/kg/min',
      inputs: [item, height, weight].map(
        ({ measurementCode, value, unit }) => ({
          measurementCode,
          value,
          unit,
        }),
      ),
      ageAtMeasurement: age,
      sexAtMeasurement: sex,
      assessmentKind: 'reference',
      protocol: 'nfa100-self-step-30cm-96bpm-180s-rest60s-pulse10s-v1',
      sourceUrl:
        'https://nfa.kspo.or.kr/community/faq/selectFaqView.kspo?contSn=36786',
      protocolUrl:
        'https://nfa.kspo.or.kr/measure/self/selectSelfMeasureItem.kspo',
    },
  };
}
