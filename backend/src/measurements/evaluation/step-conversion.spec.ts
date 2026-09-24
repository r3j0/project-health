import { describe, expect, it } from 'vitest';
import { evaluateMeasurement } from './measurement-evaluator.js';
import { OFFICIAL_CRITERIA } from './official-criteria.js';
import type { EvaluationInput } from './evaluation-types.js';
const pulse = {
  measurementCode: 'ymca_recovery_heart_rate',
  value: '90',
  unit: 'bpm',
};
const height = { measurementCode: 'height', value: '170', unit: 'cm' };
const weight = { measurementCode: 'weight', value: '65', unit: 'kg' };
const base: EvaluationInput = {
  id: 'step-test',
  revision: 1,
  measuredOn: '2026-09-24',
  ageAtMeasurement: 25,
  sexAtMeasurement: 'male',
  entryMethod: 'self_assessment',
  catalogVersion: 'nfa100-2026-09-24-grip-v1',
  items: [pulse, height, weight],
};
const run = (overrides: Partial<EvaluationInput> = {}) =>
  evaluateMeasurement({ ...base, ...overrides });
describe('Adult step reference conversion', () => {
  it.each([
    ['male', '49.877'],
    ['female', '39.232'],
  ] as const)(
    'uses the %s equation and already-normalized bpm exactly once',
    (sexAtMeasurement, expected) => {
      const input = { ...base, sexAtMeasurement };
      const before = structuredClone(input);
      const result = evaluateMeasurement(input);
      expect(input).toEqual(before);
      expect(result.items[0].evaluation).toMatchObject({
        measurementCode: pulse.measurementCode,
        grade: 1,
        status: 'graded',
        reasonCode: 'step_reference_grade_applied',
        conversion: {
          value: expected,
          unit: 'ml/kg/min',
          assessmentKind: 'reference',
          ageAtMeasurement: 25,
          sexAtMeasurement,
          inputs: base.items,
        },
        criterion: { measurementCode: 'step_test_vo2max', unit: 'ml/kg/min' },
      });
      expect(result.axes[0]).toMatchObject({
        grade: 1,
        representativeMeasurementCode: pulse.measurementCode,
      });
    },
  );
  it.each([
    [{ sexAtMeasurement: null }, 'sex_at_measurement_missing'],
    [{ ageAtMeasurement: null }, 'age_at_measurement_missing'],
    [{ items: [pulse, weight] }, 'height_at_measurement_missing'],
    [{ items: [pulse, height] }, 'weight_at_measurement_missing'],
    [
      { items: [pulse, height, { ...weight, value: '0' }] },
      'weight_at_measurement_missing',
    ],
  ] as const)(
    'preserves raw data without guessing missing inputs: %j',
    (overrides, reasonCode) => {
      const result = run(overrides as Partial<EvaluationInput>);
      expect(result.items[0].evaluation).toMatchObject({
        status: 'insufficient_information',
        grade: null,
        reasonCode,
      });
      expect(result.items[0].evaluation.conversion).toBeUndefined();
      expect(result.axes[0].status).toBe('unevaluable');
    },
  );
  it.each([19, 64])('supports adult age boundary %s', (ageAtMeasurement) => {
    expect(run({ ageAtMeasurement }).items[0].evaluation.status).toBe('graded');
  });
  it.each([18, 65])(
    'does not use adult equations outside their supported scope (%s)',
    (ageAtMeasurement) => {
      expect(run({ ageAtMeasurement }).items[0].evaluation.reasonCode).toBe(
        'criteria_age_not_supported',
      );
    },
  );
  it('reuses exact thresholds and never rounds across a grade boundary', () => {
    const criteria = OFFICIAL_CRITERIA.filter(
      (c) =>
        c.measurementCode === 'step_test_vo2max' &&
        c.sex === 'male' &&
        c.minAge === 25,
    ).map((c) => ({
      ...c,
      thresholds: [
        {
          grade: 1,
          intervals: [
            { lower: { value: '49.877', inclusive: true }, upper: null },
          ],
        },
      ],
    }));
    expect(
      evaluateMeasurement(base, new Date(), criteria).items[0].evaluation.grade,
    ).toBe(1);
    const result = evaluateMeasurement(
      {
        ...base,
        items: [{ ...pulse, value: `90.${'0'.repeat(100)}1` }, height, weight],
      },
      new Date(),
      criteria,
    );
    expect(result.items[0].evaluation).toMatchObject({
      status: 'below_standard',
      grade: null,
    });
    expect(
      result.items[0].evaluation.nextTarget.adjustments[0].lower?.unit,
    ).toBe('ml/kg/min');
  });
  it('re-evaluates changes and keeps the best cardio result without changing direct VO2 rules', () => {
    const result = run({
      revision: 2,
      items: [pulse, height, { ...weight, value: '100' }],
    });
    expect(result.items[0].evaluation).toMatchObject({
      recordRevision: 2,
      grade: 3,
      conversion: { value: '42.107' },
    });
    const both = run({
      entryMethod: 'manual',
      items: [
        pulse,
        height,
        { ...weight, value: '100' },
        { measurementCode: 'step_test_vo2max', unit: 'ml/kg/min', value: '50' },
      ],
    });
    expect(both.axes[0]).toMatchObject({
      grade: 1,
      representativeMeasurementCode: 'step_test_vo2max',
    });
    expect(both.items[3].evaluation.conversion).toBeUndefined();
    expect(both.items[3].evaluation.criterion?.internalVersion).toBe(
      'nfa100-adult-2025-0027-v1',
    );
  });
  it('does not produce a grade for nonpositive estimates or unrecognized units', () => {
    expect(
      run({ items: [pulse, height, { ...weight, value: '500' }] }).items[0]
        .evaluation.reasonCode,
    ).toBe('step_vo2max_out_of_range');
    expect(
      run({ items: [{ ...pulse, unit: '회' }, height, weight] }).items[0]
        .evaluation.reasonCode,
    ).toBe('step_heart_rate_invalid');
  });
  it('preserves catalog and effective-date restrictions', () => {
    expect(
      run({ measuredOn: '2025-01-01' }).items[0].evaluation.reasonCode,
    ).toBe('criteria_not_applicable_date');
    expect(
      run({ catalogVersion: 'unknown' }).items[0].evaluation.reasonCode,
    ).toBe('criteria_catalog_version_mismatch');
  });
});
