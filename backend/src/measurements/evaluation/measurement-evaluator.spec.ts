import { describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import type {
  Criterion,
  EvaluatedItem,
  EvaluationInput,
  EvaluationStatus,
} from './evaluation-types.js';
import {
  aggregateAxes,
  evaluateMeasurement,
  legacyEvaluation,
} from './measurement-evaluator.js';
import {
  MEASUREMENT_PROTOCOLS,
  OFFICIAL_CRITERIA,
} from './official-criteria.js';

const timestamp = new Date('2026-09-23T10:00:00.000Z');
const base: EvaluationInput = {
  id: 'test-record',
  revision: 4,
  measuredOn: '2026-09-22',
  ageAtMeasurement: 25,
  sexAtMeasurement: 'male',
  entryMethod: 'manual',
  catalogVersion: 'nfa100-2026-09-23',
  items: [{ measurementCode: 'cross_sit_up', value: '45', unit: '회' }],
};

const evaluate = (overrides: Partial<EvaluationInput> = {}) =>
  evaluateMeasurement({ ...base, ...overrides }, timestamp).items[0].evaluation;

// Synthetic interval criteria exercise capabilities that the current official
// adult registry does not use. They are local to tests, never production data.
const rangeFixture: Criterion = {
  id: 'test-only-range',
  internalVersion: 'test-only-v1',
  officialVersion: null,
  effectiveFrom: null,
  effectiveUntil: null,
  rounding: 'none',
  measurementCode: 'sit_and_reach',
  protocol: MEASUREMENT_PROTOCOLS.sit_and_reach,
  unit: 'cm',
  direction: 'range',
  minAge: 19,
  maxAge: 64,
  sex: 'male',
  entryMethods: ['manual'],
  catalogVersions: [base.catalogVersion],
  source: {
    url: 'https://example.invalid/test-only',
    supportingUrls: [],
    protocolUrl: 'https://example.invalid/test-only',
    documentTitle: 'SYNTHETIC TEST FIXTURE — NOT OFFICIAL',
    checkedOn: '2026-09-23',
    revision: null,
  },
  thresholds: [
    {
      grade: 1,
      intervals: [
        {
          lower: { value: '10', inclusive: false },
          upper: { value: '20', inclusive: true },
        },
      ],
    },
    {
      grade: 2,
      intervals: [
        {
          lower: { value: '5', inclusive: true },
          upper: { value: '25', inclusive: true },
        },
      ],
    },
  ],
};

const evaluateFixture = (value: string, criterion: Criterion = rangeFixture) =>
  evaluateMeasurement(
    {
      ...base,
      items: [{ measurementCode: 'sit_and_reach', value, unit: 'cm' }],
    },
    timestamp,
    [criterion],
  ).items[0].evaluation;

describe('Verified adult criteria', () => {
  it('grades against the measured age and attaches a serializable source snapshot', () => {
    const evaluation = evaluate();
    expect(evaluation).toMatchObject({
      measurementId: 'test-record',
      measurementCode: 'cross_sit_up',
      status: 'graded',
      grade: 2,
      recordRevision: 4,
      ageAtMeasurement: 25,
      ageBand: { minAge: 25, maxAge: 29 },
      sex: 'male',
      evaluatedAt: timestamp.toISOString(),
      criterion: {
        internalVersion: 'nfa100-adult-2025-0027-v1',
        officialVersion: '문화체육관광부 고시 제2025-0027호',
        effectiveFrom: '2025-06-02',
        rounding: 'none',
      },
      nextTarget: {
        status: 'available',
        grade: 1,
        adjustments: [
          { lower: { threshold: '51', difference: '6', unit: '회' } },
        ],
      },
    });
    expect(JSON.parse(JSON.stringify(evaluation))).toEqual(evaluation);
  });

  it.each([
    [19, '55', 1, 19, 24],
    [24, '51', 2, 19, 24],
    [25, '51', 1, 25, 29],
    [29, '47', 2, 25, 29],
    [30, '47', 1, 30, 34],
    [59, '31', 2, 55, 59],
    [60, '31', 1, 60, 64],
    [64, '31', 1, 60, 64],
  ])(
    'uses the age %i boundary',
    (ageAtMeasurement, value, grade, minAge, maxAge) => {
      expect(
        evaluate({
          ageAtMeasurement,
          items: [{ measurementCode: 'cross_sit_up', value, unit: '회' }],
        }),
      ).toMatchObject({ grade, ageBand: { minAge, maxAge } });
    },
  );

  it.each([18, 65])(
    'does not extend adult thresholds to age %i',
    (ageAtMeasurement) => {
      expect(evaluate({ ageAtMeasurement })).toMatchObject({
        status: 'criteria_unavailable',
        reasonCode: 'criteria_age_not_supported',
        grade: null,
      });
    },
  );

  it('uses the declared measured sex, without inferring it', () => {
    expect(evaluate({ sexAtMeasurement: 'female' }).grade).toBe(1);
    expect(evaluate({ sexAtMeasurement: null })).toMatchObject({
      status: 'insufficient_information',
      reasonCode: 'sex_at_measurement_missing',
      grade: null,
      nextTarget: { status: 'unavailable', grade: null },
    });
    expect(evaluate({ ageAtMeasurement: null })).toMatchObject({
      status: 'insufficient_information',
      reasonCode: 'age_at_measurement_missing',
    });
    expect(evaluate({ measuredOn: '' }).reasonCode).toBe(
      'measurement_date_missing',
    );
  });

  it('respects the official effective date and never silently applies retroactive rules', () => {
    expect(evaluate({ measuredOn: '2025-06-01' })).toMatchObject({
      status: 'criteria_unavailable',
      reasonCode: 'criteria_not_applicable_date',
      criterion: null,
      thresholds: [],
    });
    expect(evaluate({ measuredOn: '2025-06-02' }).grade).toBe(2);
  });

  it('keeps zero as a below-standard measurement with the lowest reachable grade as target', () => {
    expect(
      evaluate({
        items: [{ measurementCode: 'cross_sit_up', value: '0', unit: '회' }],
      }),
    ).toMatchObject({
      status: 'below_standard',
      grade: null,
      nextTarget: {
        status: 'available',
        grade: 3,
        adjustments: [{ lower: { threshold: '38', difference: '38' } }],
      },
    });
  });

  it('keeps motor fitness grades limited to published grades 1 and 2', () => {
    const evaluation = evaluate({
      items: [
        { measurementCode: 'standing_long_jump', value: '100', unit: 'cm' },
      ],
    });
    expect(evaluation.thresholds.map((threshold) => threshold.grade)).toEqual([
      1, 2,
    ]);
    expect(evaluation.grade).toBeNull();
    expect(evaluation.nextTarget.grade).toBe(2);
  });

  it('does not invent a target beyond the highest grade', () => {
    expect(
      evaluate({
        items: [{ measurementCode: 'cross_sit_up', value: '51', unit: '회' }],
      }),
    ).toMatchObject({
      grade: 1,
      nextTarget: {
        status: 'highest_grade',
        grade: null,
        intervals: [],
        adjustments: [],
      },
    });
  });

  it('preserves exact decimal differences for lower-is-better values', () => {
    const evaluation = evaluate({
      ageAtMeasurement: 19,
      items: [
        {
          measurementCode: 'reaction_time',
          value: '0.301234567890123456789123456789',
          unit: '초',
        },
      ],
    });
    expect(evaluation.grade).toBe(2);
    expect(evaluation.nextTarget.adjustments[0].upper).toMatchObject({
      threshold: '0.301',
      difference: '0.000234567890123456789123456789',
      unit: '초',
      change: 'decrease',
      requiresBeyondBoundary: false,
    });
  });

  it('preserves exact decimal differences for higher-is-better values', () => {
    const evaluation = evaluate({
      items: [
        {
          measurementCode: 'sit_and_reach',
          value: '10.100000000000000000000000001',
          unit: 'cm',
        },
      ],
    });
    expect(evaluation.grade).toBe(2);
    expect(evaluation.nextTarget.adjustments[0].lower?.difference).toBe(
      '4.799999999999999999999999999',
    );
  });

  it('supports self-assessment only for separately verified matching protocols', () => {
    expect(evaluate({ entryMethod: 'self_assessment' }).grade).toBe(2);
    expect(
      evaluate({
        entryMethod: 'self_assessment',
        items: [{ measurementCode: 'self_curl_up', value: '51', unit: '회' }],
      }),
    ).toMatchObject({
      grade: null,
      status: 'criteria_unavailable',
      reasonCode: 'self_curl_up_criteria_unverified',
      criterion: null,
      thresholds: [],
    });
    expect(
      evaluate({
        entryMethod: 'self_assessment',
        items: [
          {
            measurementCode: 'ymca_recovery_heart_rate',
            value: '80',
            unit: 'bpm',
          },
        ],
      }),
    ).toMatchObject({
      grade: null,
      status: 'insufficient_information',
      reasonCode: 'height_at_measurement_missing',
      nextTarget: { status: 'unavailable', grade: null },
    });
  });

  it('does not turn body-composition certification prerequisites into individual grades', () => {
    expect(
      evaluate({
        items: [{ measurementCode: 'bmi', value: '22', unit: 'kg/m²' }],
      }),
    ).toMatchObject({
      grade: null,
      status: 'criteria_unavailable',
      reasonCode: 'official_criteria_unverified',
    });
  });

  it('rejects incompatible units, entry methods, protocols and catalog versions', () => {
    expect(
      evaluate({
        items: [{ measurementCode: 'cross_sit_up', value: '45', unit: 'cm' }],
      }).reasonCode,
    ).toBe('criteria_unit_mismatch');
    expect(evaluate({ catalogVersion: 'unknown' }).reasonCode).toBe(
      'criteria_catalog_version_mismatch',
    );
    expect(
      evaluate({
        entryMethod: 'self_assessment',
        items: [
          {
            measurementCode: 'step_test_vo2max',
            value: '45',
            unit: 'ml/kg/min',
          },
        ],
      }).reasonCode,
    ).toBe('criteria_entry_method_mismatch');
    expect(
      evaluateFixture('15', {
        ...rangeFixture,
        protocol: MEASUREMENT_PROTOCOLS.cross_sit_up,
      }).reasonCode,
    ).toBe('criteria_protocol_mismatch');
    expect(
      evaluateFixture('15', { ...rangeFixture, sex: 'female' }).reasonCode,
    ).toBe('criteria_sex_not_supported');
  });

  it('has complete disjoint adult age and sex coverage with no synthetic sources', () => {
    expect(OFFICIAL_CRITERIA).toHaveLength(180);
    for (const criterion of OFFICIAL_CRITERIA) {
      expect(criterion.source.url).toMatch(/^https:\/\/nfa\.kspo\.or\.kr\//);
      expect(criterion.source.supportingUrls).toHaveLength(2);
      expect(criterion.id).not.toContain('test-only');
      expect(criterion.protocol).toBe(
        MEASUREMENT_PROTOCOLS[criterion.measurementCode],
      );
    }
    for (
      let ageAtMeasurement = 19;
      ageAtMeasurement <= 64;
      ageAtMeasurement++
    ) {
      for (const sexAtMeasurement of ['male', 'female'] as const) {
        expect(
          evaluate({ ageAtMeasurement, sexAtMeasurement }).criterion,
        ).not.toBeNull();
      }
    }
  });

  it('handles the value immediately before, at and after every official threshold', () => {
    const Decimal = Prisma.Decimal.clone({ precision: 300 });
    for (const criterion of OFFICIAL_CRITERIA) {
      for (let index = 0; index < criterion.thresholds.length; index++) {
        const threshold = criterion.thresholds[index];
        const boundary =
          threshold.intervals[0].lower ?? threshold.intervals[0].upper!;
        const value = new Decimal(boundary.value);
        const epsilon =
          criterion.unit === '회' ? '1' : '0.000000000000000000000000000001';
        const lower = value.minus(epsilon).toFixed();
        const higher = value.plus(epsilon).toFixed();
        const grade = (sample: string) =>
          evaluate({
            ageAtMeasurement: criterion.minAge,
            sexAtMeasurement: criterion.sex,
            items: [
              {
                measurementCode: criterion.measurementCode,
                unit: criterion.unit,
                value: sample,
              },
            ],
          }).grade;
        const worseGrade = criterion.thresholds[index + 1]?.grade ?? null;
        expect(grade(boundary.value), criterion.id).toBe(threshold.grade);
        expect(
          grade(criterion.direction === 'higher' ? higher : lower),
          criterion.id,
        ).toBe(threshold.grade);
        expect(
          grade(criterion.direction === 'higher' ? lower : higher),
          criterion.id,
        ).toBe(worseGrade);
      }
    }
  });
});

describe('Range and open-boundary calculations using test-only fixtures', () => {
  it.each([
    ['4.9999999999999999999999', null],
    ['5', 2],
    ['10', 2],
    ['10.0000000000000000000001', 1],
    ['20', 1],
    ['20.0000000000000000000001', 2],
    ['25', 2],
    ['25.0000000000000000000001', null],
  ])('compares both range bounds precisely for %s', (value, grade) => {
    expect(evaluateFixture(value).grade).toBe(grade);
  });

  it('does not present the open boundary itself as an achieved target', () => {
    expect(evaluateFixture('10').nextTarget).toMatchObject({
      grade: 1,
      intervals: [
        {
          lower: { value: '10', inclusive: false },
          upper: { value: '20', inclusive: true },
        },
      ],
      adjustments: [
        {
          lower: {
            difference: '0',
            change: 'increase',
            requiresBeyondBoundary: true,
          },
          upper: { difference: '0', change: 'none' },
        },
      ],
    });
  });

  it('retains all alternative target intervals and their separate adjustments', () => {
    const fixture: Criterion = {
      ...rangeFixture,
      thresholds: [
        {
          grade: 1,
          intervals: [
            {
              lower: { value: '10', inclusive: true },
              upper: { value: '20', inclusive: true },
            },
            {
              lower: { value: '30', inclusive: true },
              upper: { value: '40', inclusive: true },
            },
          ],
        },
        {
          grade: 2,
          intervals: [
            {
              lower: { value: '5', inclusive: true },
              upper: { value: '45', inclusive: true },
            },
          ],
        },
      ],
    };
    const evaluation = evaluateFixture('25', fixture);
    expect(evaluation.grade).toBe(2);
    expect(evaluation.nextTarget.intervals).toHaveLength(2);
    expect(evaluation.nextTarget.adjustments[0].upper).toMatchObject({
      difference: '5',
      change: 'decrease',
    });
    expect(evaluation.nextTarget.adjustments[1].lower).toMatchObject({
      difference: '5',
      change: 'increase',
    });
  });

  it('fails closed for malformed or ambiguous registered criteria', () => {
    expect(
      evaluateFixture('15', { ...rangeFixture, thresholds: [] }).reasonCode,
    ).toBe('criteria_configuration_invalid');
    expect(
      evaluateFixture('15', {
        ...rangeFixture,
        thresholds: [rangeFixture.thresholds[0], rangeFixture.thresholds[0]],
      }).reasonCode,
    ).toBe('criteria_configuration_invalid');
    const result = evaluateMeasurement(
      {
        ...base,
        items: [{ measurementCode: 'sit_and_reach', value: '15', unit: 'cm' }],
      },
      timestamp,
      [rangeFixture, rangeFixture],
    );
    expect(result.items[0].evaluation.reasonCode).toBe('criteria_ambiguous');
  });
});

function result(
  measurementCode: string,
  status: EvaluationStatus,
  grade: number | null = null,
): EvaluatedItem {
  return {
    measurementCode,
    evaluation: { ...legacyEvaluation(base, measurementCode), status, grade },
  };
}

describe('Six representative axes and legacy records', () => {
  it('always returns all six ordered axes and excludes body composition and coordination', () => {
    const axes = aggregateAxes(
      [
        result('bmi', 'graded', 1),
        result('height', 'graded', 1),
        result('t_wall_coordination', 'graded', 1),
      ],
      4,
    );
    expect(axes.map(({ axis }) => axis)).toEqual([
      'cardiorespiratory_endurance',
      'strength',
      'muscular_endurance',
      'flexibility',
      'agility',
      'power',
    ]);
    expect(
      axes.every(
        (axis) =>
          axis.status === 'not_measured' &&
          axis.grade === null &&
          axis.representativeMeasurementCode === null,
      ),
    ).toBe(true);
  });

  it('selects the best grade, ignores unavailable and below-standard results, and preserves all items', () => {
    const items = [
      result('treadmill_vo2max', 'graded', 2),
      result('shuttle_run_20m', 'graded', 1),
      result('step_test_vo2max', 'below_standard'),
      result('ymca_recovery_heart_rate', 'criteria_unavailable'),
    ];
    expect(aggregateAxes(items, 4)[0]).toMatchObject({
      grade: 1,
      status: 'graded',
      representativeMeasurementCode: 'shuttle_run_20m',
      measuredMeasurementCodes: [
        'shuttle_run_20m',
        'step_test_vo2max',
        'treadmill_vo2max',
        'ymca_recovery_heart_rate',
      ],
    });
    expect(items).toHaveLength(4);
    expect(items[0].measurementCode).toBe('treadmill_vo2max');
  });

  it('resolves ties by ASCII measurement code independent of insertion order', () => {
    const items = [
      result('treadmill_vo2max', 'graded', 1),
      result('step_test_vo2max', 'graded', 1),
    ];
    expect(aggregateAxes(items, 4)[0].representativeMeasurementCode).toBe(
      'step_test_vo2max',
    );
    expect(aggregateAxes([...items].reverse(), 4)).toEqual(
      aggregateAxes(items, 4),
    );
  });

  it('distinguishes all below-standard, all unevaluable and unmeasured axes', () => {
    const axes = aggregateAxes(
      [
        result('shuttle_run_20m', 'below_standard'),
        result('step_test_vo2max', 'below_standard'),
        result('cross_sit_up', 'insufficient_information'),
        result('self_curl_up', 'criteria_unavailable'),
      ],
      4,
    );
    expect(axes[0]).toMatchObject({
      grade: null,
      status: 'below_standard',
      representativeMeasurementCode: 'shuttle_run_20m',
    });
    expect(axes[1]).toMatchObject({ grade: null, status: 'not_measured' });
    expect(axes[2]).toMatchObject({
      grade: null,
      status: 'unevaluable',
      representativeMeasurementCode: 'cross_sit_up',
    });
  });

  it('prefers a below-standard result when the other measured tests are unavailable', () => {
    expect(
      aggregateAxes(
        [
          result('cross_sit_up', 'below_standard'),
          result('self_curl_up', 'criteria_unavailable'),
        ],
        4,
      )[2].status,
    ).toBe('below_standard');
  });

  it('does not report a grade from another record revision', () => {
    expect(
      aggregateAxes([result('cross_sit_up', 'graded', 1)], 5)[2],
    ).toMatchObject({ grade: null, status: 'unevaluable', recordRevision: 5 });
  });

  it('returns legacy measured values as unevaluated without applying current criteria', () => {
    const evaluation = legacyEvaluation(base, 'cross_sit_up');
    expect(evaluation).toMatchObject({
      status: 'not_evaluated',
      reasonCode: 'evaluation_not_stored',
      grade: null,
      criterion: null,
      thresholds: [],
      evaluatedAt: null,
      recordRevision: 4,
      nextTarget: {
        status: 'unavailable',
        reasonCode: 'evaluation_not_stored',
      },
    });
    expect(
      aggregateAxes([{ measurementCode: 'cross_sit_up', evaluation }], 4)[2]
        .status,
    ).toBe('unevaluable');
  });
});
