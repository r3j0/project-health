import { Prisma } from '../../generated/prisma/client.js';
import type { EvaluationInput, GripConversion } from './evaluation-types.js';

// Input decimals have at most 128 characters. Products of two input/boundary
// values therefore fit exactly; division is only for display and target gaps.
const Decimal = Prisma.Decimal.clone({ precision: 300 });

export function convertAbsoluteGrip(
  item: EvaluationInput['items'][number],
  items: EvaluationInput['items'],
) {
  const weight = items.find((entry) => entry.measurementCode === 'weight');
  if (!weight || weight.unit !== 'kg' || new Decimal(weight.value).lte(0))
    return null;
  const numerator = new Decimal(item.value).times(100);
  const denominator = new Decimal(weight.value);
  const value = numerator.dividedBy(denominator).toFixed();
  const conversion: GripConversion = {
    formulaVersion: 'nfa100-relative-grip-v1',
    measurementCode: 'relative_grip_strength',
    value,
    unit: '%',
    inputs: [
      {
        measurementCode: 'absolute_grip_strength',
        value: item.value,
        unit: 'kg',
      },
      { measurementCode: 'weight', value: weight.value, unit: 'kg' },
    ],
    sourceUrl: 'https://nfa.kspo.or.kr/community/faq/selectFaqList.kspo',
  };
  return { numerator, denominator, conversion };
}
