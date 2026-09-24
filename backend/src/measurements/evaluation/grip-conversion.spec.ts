import { describe, expect, it } from 'vitest';
import { evaluateMeasurement } from './measurement-evaluator.js';
import { OFFICIAL_CRITERIA } from './official-criteria.js';
import type { EvaluationInput } from './evaluation-types.js';

const base: EvaluationInput = {
  id: 'grip-test',
  revision: 1,
  measuredOn: '2026-09-24',
  ageAtMeasurement: 25,
  sexAtMeasurement: 'male',
  entryMethod: 'manual',
  catalogVersion: 'nfa100-2026-09-24-grip-v1',
  items: [],
};
const grip = (value: string) => ({
  measurementCode: 'absolute_grip_strength',
  value,
  unit: 'kg',
});
const weight = (value: string) => ({
  measurementCode: 'weight',
  value,
  unit: 'kg',
});
function run(
  value: string,
  bodyWeight?: string,
  overrides: Partial<EvaluationInput> = {},
) {
  return evaluateMeasurement({
    ...base,
    items: [
      grip(value),
      ...(bodyWeight === undefined ? [] : [weight(bodyWeight)]),
    ],
    ...overrides,
  });
}

describe('Absolute grip uses same-record body weight and the relative-grip criterion', () => {
  it('preserves raw inputs, applies the official relative criterion and aggregates strength', () => {
    const input = { ...base, items: [grip('25'), weight('50')] };
    const before = structuredClone(input);
    const result = evaluateMeasurement(input);
    const evaluation = result.items[0].evaluation;
    expect(input).toEqual(before);
    expect(evaluation).toMatchObject({
      measurementCode: 'absolute_grip_strength',
      status: 'below_standard',
      criterion: { measurementCode: 'relative_grip_strength', unit: '%' },
      conversion: { value: '50', unit: '%', inputs: input.items },
    });
    expect(result.axes[1]).toMatchObject({
      status: 'below_standard',
      grade: evaluation.grade,
      representativeMeasurementCode: 'absolute_grip_strength',
    });
    expect(evaluation.nextTarget.adjustments[0].lower?.unit).toBe('%');
  });

  it.each([undefined, '0', '-1'])(
    'cannot grade without a positive same-record weight (%s)',
    (value) => {
      const result = run('25', value);
      expect(result.items[0].evaluation).toMatchObject({
        status: 'insufficient_information',
        grade: null,
        reasonCode: 'weight_at_measurement_missing',
      });
      expect(result.items[0].evaluation.conversion).toBeUndefined();
      expect(result.axes[1].status).toBe('unevaluable');
    },
  );

  it('keeps zero grip as a real below-standard value', () => {
    expect(run('0', '50').items[0].evaluation).toMatchObject({
      status: 'below_standard',
      conversion: { value: '0' },
    });
  });

  it('does not round a value just below the threshold into a better grade', () => {
    const criterion = OFFICIAL_CRITERIA.find(
      (c) =>
        c.measurementCode === 'relative_grip_strength' &&
        c.minAge === 25 &&
        c.sex === 'male',
    )!;
    const threshold = criterion.thresholds[0].intervals[0].lower!.value;
    const [whole, fraction] = threshold.split('.');
    const justBelow = `${whole}.${Number(fraction) - 1}${'9'.repeat(110)}`;
    expect(run(threshold, '100').items[0].evaluation.grade).toBe(1);
    expect(run(justBelow, '100').items[0].evaluation.grade).not.toBe(1);
  });

  it('re-evaluates changes in weight, age, sex and revision without changing raw grip', () => {
    const first = run('30', '50').items[0].evaluation;
    const second = run('30', '100', { revision: 2 }).items[0].evaluation;
    expect(first.conversion?.value).toBe('60');
    expect(second).toMatchObject({
      recordRevision: 2,
      conversion: { value: '30' },
    });
    expect(second.status).toBe('below_standard');
    expect(
      run('30', '50', { sexAtMeasurement: 'female' }).items[0].evaluation
        .criterion?.sex,
    ).toBe('female');
    expect(
      run('30', '50', { ageAtMeasurement: 18 }).items[0].evaluation,
    ).toMatchObject({
      status: 'criteria_unavailable',
      reasonCode: 'criteria_age_not_supported',
    });
    expect(
      run('30', '50', { sexAtMeasurement: null }).items[0].evaluation.status,
    ).toBe('insufficient_information');
  });

  it('handles repeating fractions and preserves the best grade if direct relative grip also exists', () => {
    const result = run('1', '3');
    expect(result.items[0].evaluation.conversion?.value).toMatch(/^33\.3+$/);
    const both = run('1', '3', {
      items: [
        grip('1'),
        weight('3'),
        { measurementCode: 'relative_grip_strength', value: '80', unit: '%' },
      ],
    });
    expect(both.axes[1]).toMatchObject({
      grade: 1,
      representativeMeasurementCode: 'relative_grip_strength',
      measuredMeasurementCodes: [
        'absolute_grip_strength',
        'relative_grip_strength',
      ],
    });
  });
});
