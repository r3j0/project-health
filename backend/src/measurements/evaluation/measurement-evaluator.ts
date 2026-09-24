import { Prisma } from '../../generated/prisma/client.js';
import { convertAbsoluteGrip } from './grip-conversion.js';
import type {
  AxisCode,
  AxisEvaluation,
  Boundary,
  BoundaryAdjustment,
  Criterion,
  CriterionInterval,
  EvaluatedItem,
  EvaluationInput,
  GradeThreshold,
  ItemEvaluation,
  NextTarget,
} from './evaluation-types.js';
import {
  MEASUREMENT_PROTOCOLS,
  OFFICIAL_CRITERIA,
} from './official-criteria.js';

// Input has at most 128 characters. Cloning avoids changing Prisma's global
// Decimal settings and preserves every input digit during exact gap subtraction.
const Decimal = Prisma.Decimal.clone({ precision: 300 });

export const FITNESS_AXES: readonly { axis: AxisCode; label: string }[] = [
  { axis: 'cardiorespiratory_endurance', label: '심폐지구력' },
  { axis: 'strength', label: '근력' },
  { axis: 'muscular_endurance', label: '근지구력' },
  { axis: 'flexibility', label: '유연성' },
  { axis: 'agility', label: '민첩성' },
  { axis: 'power', label: '순발력' },
];

export const MEASUREMENT_AXES: Readonly<Record<string, AxisCode>> = {
  shuttle_run_20m: 'cardiorespiratory_endurance',
  treadmill_vo2max: 'cardiorespiratory_endurance',
  step_test_vo2max: 'cardiorespiratory_endurance',
  ymca_recovery_heart_rate: 'cardiorespiratory_endurance',
  relative_grip_strength: 'strength',
  absolute_grip_strength: 'strength',
  curl_up: 'muscular_endurance',
  self_curl_up: 'muscular_endurance',
  cross_sit_up: 'muscular_endurance',
  repeated_jump: 'muscular_endurance',
  sit_and_reach: 'flexibility',
  illinois_agility: 'agility',
  shuttle_run_10m_4: 'agility',
  reaction_time: 'agility',
  standing_long_jump: 'power',
  flight_time: 'power',
};

const unavailableTarget = (reasonCode: string): NextTarget => ({
  status: 'unavailable',
  grade: null,
  intervals: [],
  adjustments: [],
  reasonCode,
});

function baseEvaluation(
  input: Pick<
    EvaluationInput,
    'id' | 'revision' | 'ageAtMeasurement' | 'sexAtMeasurement'
  >,
  measurementCode: string,
  evaluatedAt: string | null,
): ItemEvaluation {
  return {
    measurementId: input.id,
    measurementCode,
    grade: null,
    status: 'criteria_unavailable',
    reasonCode: 'official_criteria_unverified',
    message: '이 검사에 적용할 공식 등급 기준을 확인하지 못했습니다.',
    ageAtMeasurement: input.ageAtMeasurement,
    ageBand: null,
    sex: input.sexAtMeasurement,
    criterion: null,
    thresholds: [],
    nextTarget: unavailableTarget('official_criteria_unverified'),
    evaluatedAt,
    recordRevision: input.revision,
  };
}

export function legacyEvaluation(
  record: Pick<
    EvaluationInput,
    'id' | 'revision' | 'ageAtMeasurement' | 'sexAtMeasurement'
  >,
  measurementCode: string,
): ItemEvaluation {
  return {
    ...baseEvaluation(record, measurementCode, null),
    status: 'not_evaluated',
    reasonCode: 'evaluation_not_stored',
    message:
      '이 기존 기록에는 저장된 평가가 없습니다. 자동 재평가하지 않았습니다.',
    nextTarget: unavailableTarget('evaluation_not_stored'),
  };
}

function unavailable(
  evaluation: ItemEvaluation,
  reasonCode: string,
  message: string,
  status:
    | 'criteria_unavailable'
    | 'insufficient_information' = 'criteria_unavailable',
): ItemEvaluation {
  return {
    ...evaluation,
    status,
    reasonCode,
    message,
    nextTarget: unavailableTarget(reasonCode),
  };
}

function contains(
  value: Prisma.Decimal,
  interval: CriterionInterval,
  ratio?: NonNullable<ReturnType<typeof convertAbsoluteGrip>>,
) {
  const { lower, upper } = interval;
  // Compare the original ratio by cross multiplication. A rounded quotient
  // must never promote a value just below an official grade boundary.
  const compare = (bound: string) =>
    ratio
      ? ratio.numerator.comparedTo(new Decimal(bound).times(ratio.denominator))
      : value.comparedTo(bound);
  return (
    (!lower ||
      compare(lower.value) > 0 ||
      (lower.inclusive && compare(lower.value) === 0)) &&
    (!upper ||
      compare(upper.value) < 0 ||
      (upper.inclusive && compare(upper.value) === 0))
  );
}

function adjustment(
  value: Prisma.Decimal,
  boundary: Boundary | null,
  side: 'lower' | 'upper',
  unit: string,
): BoundaryAdjustment | null {
  if (!boundary) return null;
  const target = new Decimal(boundary.value);
  const equal = value.equals(target);
  const unmet =
    (side === 'lower' ? value.lessThan(target) : value.greaterThan(target)) ||
    (equal && !boundary.inclusive);
  return {
    threshold: target.toFixed(),
    inclusive: boundary.inclusive,
    difference: unmet ? target.minus(value).abs().toFixed() : '0',
    unit,
    change: unmet ? (side === 'lower' ? 'increase' : 'decrease') : 'none',
    // An open boundary is an infimum, not a reachable exact target. Never
    // manufacture an epsilon or round the submitted measurement to cross it.
    requiresBeyondBoundary: unmet && !boundary.inclusive,
  };
}

function nextTarget(
  value: Prisma.Decimal,
  grade: number | null,
  thresholds: GradeThreshold[],
  unit: string,
): NextTarget {
  const index =
    grade === null
      ? thresholds.length
      : thresholds.findIndex((entry) => entry.grade === grade);
  if (index === 0)
    return {
      status: 'highest_grade',
      grade: null,
      intervals: [],
      adjustments: [],
      reasonCode: 'highest_grade_reached',
    };
  const target = thresholds[index - 1];
  return {
    status: 'available',
    grade: target.grade,
    intervals: structuredClone(target.intervals),
    adjustments: target.intervals.map(({ lower, upper }) => ({
      lower: adjustment(value, lower, 'lower', unit),
      upper: adjustment(value, upper, 'upper', unit),
    })),
    reasonCode: null,
  };
}

function validThresholds(thresholds: GradeThreshold[]) {
  const grades = new Set<number>();
  return (
    thresholds.length > 0 &&
    thresholds.every(({ grade, intervals }) => {
      if (!Number.isInteger(grade) || grade < 1 || grades.has(grade))
        return false;
      grades.add(grade);
      return (
        intervals.length > 0 &&
        intervals.every(({ lower, upper }) => {
          if (!lower && !upper) return false;
          for (const bound of [lower, upper]) {
            if (
              bound &&
              (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(bound.value) ||
                bound.value.length > 128)
            )
              return false;
          }
          if (!lower || !upper) return true;
          const comparison = new Decimal(lower.value).comparedTo(upper.value);
          return (
            comparison < 0 ||
            (comparison === 0 && lower.inclusive && upper.inclusive)
          );
        })
      );
    })
  );
}

function evaluateItem(
  input: EvaluationInput,
  item: EvaluationInput['items'][number],
  evaluatedAt: string,
  criteria: readonly Criterion[],
  ratio?: NonNullable<ReturnType<typeof convertAbsoluteGrip>>,
): ItemEvaluation {
  const evaluation = baseEvaluation(input, item.measurementCode, evaluatedAt);
  if (!input.measuredOn)
    return unavailable(
      evaluation,
      'measurement_date_missing',
      '측정일이 없어 적용 정보를 확인할 수 없습니다.',
      'insufficient_information',
    );
  if (
    input.ageAtMeasurement === null ||
    !Number.isInteger(input.ageAtMeasurement)
  )
    return unavailable(
      evaluation,
      'age_at_measurement_missing',
      '측정 당시 만 나이가 필요합니다. 현재 나이로 추정하지 않습니다.',
      'insufficient_information',
    );
  if (input.sexAtMeasurement === null)
    return unavailable(
      evaluation,
      'sex_at_measurement_missing',
      '공식 기준 적용에 필요한 측정 당시 성별 구간 정보가 없습니다.',
      'insufficient_information',
    );

  let matching = criteria.filter(
    (criterion) => criterion.measurementCode === item.measurementCode,
  );
  if (!matching.length) {
    if (item.measurementCode === 'self_curl_up')
      return unavailable(
        evaluation,
        'self_curl_up_criteria_unverified',
        '성인 자가측정용 윗몸말아올리기의 공식 등급 기준을 확인하지 못했습니다. 교차윗몸일으키기 기준을 대신 적용하지 않습니다.',
      );
    if (item.measurementCode === 'ymca_recovery_heart_rate')
      return unavailable(
        evaluation,
        'ymca_bpm_criteria_unverified',
        'YMCA 회복 심박수(bpm)의 공식 등급 기준을 확인하지 못했습니다. 최대산소섭취량 기준을 대신 적용하지 않습니다.',
      );
    return evaluation;
  }
  const restrictions: {
    matches: (criterion: Criterion) => boolean;
    reasonCode: string;
    message: string;
  }[] = [
    {
      matches: (criterion) => criterion.unit === item.unit,
      reasonCode: 'criteria_unit_mismatch',
      message: '이 측정 단위에 일치하는 공식 기준이 없습니다.',
    },
    {
      matches: (criterion) =>
        (criterion.effectiveFrom === null ||
          input.measuredOn >= criterion.effectiveFrom) &&
        (criterion.effectiveUntil === null ||
          input.measuredOn <= criterion.effectiveUntil),
      reasonCode: 'criteria_not_applicable_date',
      message:
        '측정일에 적용되는 공식 기준을 확인하지 못했습니다. 시행일 이전으로 소급 적용하지 않습니다.',
    },
    {
      matches: (criterion) =>
        criterion.protocol === MEASUREMENT_PROTOCOLS[item.measurementCode],
      reasonCode: 'criteria_protocol_mismatch',
      message: '이 검사 프로토콜에 일치하는 공식 기준이 없습니다.',
    },
    {
      matches: (criterion) =>
        criterion.entryMethods.includes(input.entryMethod),
      reasonCode: 'criteria_entry_method_mismatch',
      message: '이 등록 방식에 적용하도록 검증된 공식 기준이 없습니다.',
    },
    {
      matches: (criterion) =>
        criterion.catalogVersions.includes(input.catalogVersion),
      reasonCode: 'criteria_catalog_version_mismatch',
      message:
        '이 검사 카탈로그 버전에 적용하도록 검증된 공식 기준이 없습니다.',
    },
    {
      matches: (criterion) =>
        input.ageAtMeasurement! >= criterion.minAge &&
        input.ageAtMeasurement! <= criterion.maxAge,
      reasonCode: 'criteria_age_not_supported',
      message: '측정 당시 만 나이에 적용할 공식 기준이 없습니다.',
    },
    {
      matches: (criterion) => criterion.sex === input.sexAtMeasurement,
      reasonCode: 'criteria_sex_not_supported',
      message: '측정 당시 성별 구간에 적용할 공식 기준이 없습니다.',
    },
  ];
  for (const restriction of restrictions) {
    matching = matching.filter(restriction.matches);
    if (!matching.length)
      return unavailable(
        evaluation,
        restriction.reasonCode,
        restriction.message,
      );
  }
  if (matching.length !== 1)
    return unavailable(
      evaluation,
      'criteria_ambiguous',
      '적용 가능한 기준이 중복되어 하나의 기준을 확정할 수 없습니다.',
    );

  const { thresholds: originalThresholds, ...criterion } = matching[0];
  if (!validThresholds(originalThresholds))
    return unavailable(
      evaluation,
      'criteria_configuration_invalid',
      '공식 기준의 판정 조건을 확인할 수 없습니다.',
    );
  const thresholds = structuredClone(originalThresholds).sort(
    (left, right) => left.grade - right.grade,
  );
  const value = new Decimal(item.value);
  const grade =
    thresholds.find(({ intervals }) =>
      intervals.some((interval) => contains(value, interval, ratio)),
    )?.grade ?? null;
  return {
    ...evaluation,
    grade,
    status: grade === null ? 'below_standard' : 'graded',
    reasonCode:
      grade === null ? 'below_lowest_grade' : 'official_criterion_applied',
    message:
      grade === null
        ? '측정값이 적용 가능한 최저 등급 기준에 미달합니다.'
        : `공식 종목별 기준 ${grade}등급에 해당합니다. 종합 인증등급과는 별개입니다.`,
    ageBand: { minAge: criterion.minAge, maxAge: criterion.maxAge },
    criterion: structuredClone(criterion),
    thresholds,
    nextTarget: nextTarget(value, grade, thresholds, item.unit),
  };
}

export function evaluateMeasurement(
  input: EvaluationInput,
  evaluatedAt = new Date(),
  criteria: readonly Criterion[] = OFFICIAL_CRITERIA,
): { items: EvaluatedItem[]; axes: AxisEvaluation[] } {
  const timestamp = evaluatedAt.toISOString();
  const items = input.items.map((item) => {
    if (item.measurementCode !== 'absolute_grip_strength')
      return {
        measurementCode: item.measurementCode,
        evaluation: evaluateItem(input, item, timestamp, criteria),
      };
    const ratio = convertAbsoluteGrip(item, input.items);
    if (!ratio)
      return {
        measurementCode: item.measurementCode,
        evaluation: unavailable(
          baseEvaluation(input, item.measurementCode, timestamp),
          'weight_at_measurement_missing',
          '상대악력 환산에 필요한 같은 측정 기록의 체중(kg)이 없습니다. 절대악력 원본만 저장했습니다.',
          'insufficient_information',
        ),
      };
    const evaluated = evaluateItem(
      input,
      {
        measurementCode: 'relative_grip_strength',
        value: ratio.conversion.value,
        unit: '%',
      },
      timestamp,
      criteria,
      ratio,
    );
    return {
      measurementCode: item.measurementCode,
      evaluation: {
        ...evaluated,
        measurementCode: item.measurementCode,
        conversion: ratio.conversion,
      },
    };
  });
  return { items, axes: aggregateAxes(items, input.revision) };
}

const compareCode = (left: EvaluatedItem, right: EvaluatedItem) =>
  left.measurementCode < right.measurementCode
    ? -1
    : left.measurementCode > right.measurementCode
      ? 1
      : 0;

export function aggregateAxes(
  items: readonly EvaluatedItem[],
  recordRevision?: number,
): AxisEvaluation[] {
  return FITNESS_AXES.map(({ axis, label }) => {
    const measured = items
      .filter((item) => MEASUREMENT_AXES[item.measurementCode] === axis)
      .sort(compareCode);
    const matchingRevision = measured.filter(
      ({ evaluation }) =>
        recordRevision === undefined ||
        evaluation.recordRevision === recordRevision,
    );
    const graded = matchingRevision
      .filter(
        ({ evaluation }) =>
          evaluation.status === 'graded' &&
          evaluation.grade !== null &&
          Number.isInteger(evaluation.grade) &&
          evaluation.grade >= 1,
      )
      .sort(
        (left, right) =>
          left.evaluation.grade! - right.evaluation.grade! ||
          compareCode(left, right),
      );
    const below = matchingRevision.filter(
      ({ evaluation }) => evaluation.status === 'below_standard',
    );
    const representative = graded[0] ?? below[0] ?? measured[0];
    return {
      axis,
      label,
      grade: graded[0]?.evaluation.grade ?? null,
      status: graded.length
        ? 'graded'
        : below.length
          ? 'below_standard'
          : measured.length
            ? 'unevaluable'
            : 'not_measured',
      representativeMeasurementCode: representative?.measurementCode ?? null,
      measuredMeasurementCodes: measured.map((item) => item.measurementCode),
      reasonCode: graded.length
        ? 'best_available_grade'
        : below.length
          ? 'all_evaluable_measurements_below_standard'
          : measured.length
            ? 'all_measurements_unevaluable'
            : 'no_measurements',
      recordRevision: recordRevision ?? null,
    };
  });
}
