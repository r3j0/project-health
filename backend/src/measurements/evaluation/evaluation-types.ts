export type Sex = 'male' | 'female';
export type EntryMethod = 'manual' | 'self_assessment';
export type EvaluationStatus =
  | 'graded'
  | 'below_standard'
  | 'insufficient_information'
  | 'criteria_unavailable'
  | 'not_evaluated';

export type Boundary = { value: string; inclusive: boolean };
// Each interval requires both bounds; several intervals are alternatives (OR).
export type CriterionInterval = {
  lower: Boundary | null;
  upper: Boundary | null;
};
export type GradeThreshold = {
  grade: number;
  intervals: CriterionInterval[];
};
export type CriterionSource = {
  url: string;
  supportingUrls: string[];
  protocolUrl: string;
  documentTitle: string;
  checkedOn: string;
  revision: string | null;
};
export type Criterion = {
  id: string;
  internalVersion: string;
  officialVersion: string | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  rounding: 'none';
  measurementCode: string;
  protocol: string;
  unit: string;
  direction: 'higher' | 'lower' | 'range';
  minAge: number;
  maxAge: number;
  sex: Sex;
  entryMethods: EntryMethod[];
  catalogVersions: string[];
  source: CriterionSource;
  thresholds: GradeThreshold[];
};

export type EvaluationInput = {
  id: string;
  revision: number;
  measuredOn: string;
  ageAtMeasurement: number | null;
  sexAtMeasurement: Sex | null;
  entryMethod: EntryMethod;
  catalogVersion: string;
  items: { measurementCode: string; value: string; unit: string }[];
};
export type BoundaryAdjustment = {
  threshold: string;
  inclusive: boolean;
  difference: string;
  unit: string;
  change: 'increase' | 'decrease' | 'none';
  requiresBeyondBoundary: boolean;
};
export type NextTarget = {
  status: 'available' | 'highest_grade' | 'unavailable';
  grade: number | null;
  // Intervals are alternatives. Both lower and upper must hold in an interval.
  intervals: CriterionInterval[];
  adjustments: {
    lower: BoundaryAdjustment | null;
    upper: BoundaryAdjustment | null;
  }[];
  reasonCode: string | null;
};
export type GripConversion = {
  formulaVersion: 'nfa100-relative-grip-v1';
  measurementCode: 'relative_grip_strength';
  value: string;
  unit: '%';
  inputs: { measurementCode: string; value: string; unit: 'kg' }[];
  sourceUrl: string;
};
export type ItemEvaluation = {
  // Optional for backwards compatibility. Raw MeasurementItem values stay in kg.
  conversion?: GripConversion;
  measurementId: string;
  measurementCode: string;
  grade: number | null;
  status: EvaluationStatus;
  reasonCode: string;
  message: string;
  ageAtMeasurement: number | null;
  ageBand: { minAge: number; maxAge: number } | null;
  sex: Sex | null;
  criterion: Omit<Criterion, 'thresholds'> | null;
  thresholds: GradeThreshold[];
  nextTarget: NextTarget;
  evaluatedAt: string | null;
  recordRevision: number;
};
export type EvaluatedItem = {
  measurementCode: string;
  evaluation: ItemEvaluation;
};
export type AxisCode =
  | 'cardiorespiratory_endurance'
  | 'strength'
  | 'muscular_endurance'
  | 'flexibility'
  | 'agility'
  | 'power';
export type AxisEvaluation = {
  axis: AxisCode;
  label: string;
  grade: number | null;
  status: 'graded' | 'below_standard' | 'unevaluable' | 'not_measured';
  representativeMeasurementCode: string | null;
  measuredMeasurementCodes: string[];
  reasonCode: string;
  recordRevision: number | null;
};
