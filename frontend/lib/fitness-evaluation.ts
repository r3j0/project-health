/** Proposed evaluation v1 adapter. Confirm wire names with backend before release.
 * No thresholds, grade calculation, or per-factor maximum selection happens here.
 * The six factors follow the adult NFA100 certification table column order.
 */
export const fitnessFactors = [
  { code: "cardiorespiratory_endurance", label: "심폐지구력" },
  { code: "strength", label: "근력" },
  { code: "muscular_endurance", label: "근지구력" },
  { code: "flexibility", label: "유연성" },
  { code: "agility", label: "민첩성" },
  { code: "power", label: "순발력" },
] as const;
export type FitnessFactor = (typeof fitnessFactors)[number]["code"];
// Individual test thresholds are distinct from an overall certification (1–6).
export type TestGrade = 1 | 2 | 3;
export type GradeResult =
  | { status: "evaluated"; grade: TestGrade; reason: string | null }
  | {
      status:
        | "below_standard"
        | "missing_input"
        | "unsupported_rule"
        | "not_measured";
      grade: null;
      reason: string | null;
    };
export type FitnessAxis = GradeResult & {
  factor: FitnessFactor;
  sourceMeasurementCodes: string[];
};
export interface EvaluationCriteria {
  ageMin: number;
  ageMax: number;
  sex: "male" | "female";
  direction: "higher_is_better" | "lower_is_better";
  unit: string;
  thresholds: { grade: TestGrade; value: string; inclusive: boolean }[];
  nextGrade: { grade: TestGrade; value: string; gap: string } | null;
  sources: { title: string; url: string }[];
}
export type ItemEvaluation = GradeResult & {
  measurementCode: string;
  factor: FitnessFactor | null;
  value: string | null;
  unit: string;
  evaluatedValue: { value: string; unit: string } | null;
  criteria: EvaluationCriteria | null;
};
export interface FitnessEvaluation {
  schemaVersion: 1;
  status: "evaluated";
  measurementId: string;
  measurementRevision: number;
  ruleVersion: string;
  evaluatedAt: string;
  axes: FitnessAxis[];
  items: ItemEvaluation[];
}
export interface FitnessRecordIdentity {
  id: string;
  revision: number;
  measuredOn: string;
}
export interface LatestFitnessProfile {
  measurement: FitnessRecordIdentity;
  evaluation: FitnessEvaluation | null;
}
export const latestFitnessPath = "/users/me/fitness-profile";

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 5000;
const decimal = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length <= 128 &&
  /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v);
const grade = (v: unknown): v is TestGrade => v === 1 || v === 2 || v === 3;
const positiveInteger = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) > 0;
const factor = (v: unknown): v is FitnessFactor =>
  fitnessFactors.some((f) => f.code === v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
function result(v: unknown): boolean {
  return (
    object(v) &&
    (v.reason === null || text(v.reason)) &&
    (v.status === "evaluated"
      ? grade(v.grade)
      : [
          "below_standard",
          "missing_input",
          "unsupported_rule",
          "not_measured",
        ].includes(v.status as string) && v.grade === null)
  );
}
function unique<T>(items: T[], key: (v: T) => unknown) {
  return new Set(items.map(key)).size === items.length;
}
export function safeSourceUrl(v: unknown): v is string {
  if (!text(v)) return false;
  try {
    const url = new URL(v);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
function criteria(v: unknown): v is EvaluationCriteria | null {
  if (v === null) return true;
  if (
    !object(v) ||
    !positiveInteger(v.ageMin) ||
    !positiveInteger(v.ageMax) ||
    v.ageMin > v.ageMax ||
    !["male", "female"].includes(v.sex as string) ||
    !text(v.unit) ||
    !["higher_is_better", "lower_is_better"].includes(v.direction as string) ||
    !Array.isArray(v.thresholds) ||
    !v.thresholds.length ||
    v.thresholds.length > 3 ||
    !v.thresholds.every(
      (t) =>
        object(t) &&
        grade(t.grade) &&
        decimal(t.value) &&
        typeof t.inclusive === "boolean",
    ) ||
    !unique(v.thresholds, (t) => t.grade) ||
    !Array.isArray(v.sources) ||
    v.sources.length > 20 ||
    !v.sources.every((s) => object(s) && text(s.title) && safeSourceUrl(s.url))
  )
    return false;
  return (
    v.nextGrade === null ||
    (object(v.nextGrade) &&
      grade(v.nextGrade.grade) &&
      decimal(v.nextGrade.value) &&
      decimal(v.nextGrade.gap) &&
      !v.nextGrade.gap.startsWith("-"))
  );
}
function invalid(): never {
  throw new Error(
    "평가 응답을 확인하지 못했어요. 저장한 측정값은 기록에서 확인할 수 있어요.",
  );
}
/** Legacy responses stay readable; malformed or stale evaluations never become grades. */
export function parseEvaluation(
  value: unknown,
  record: {
    id: string;
    revision: number;
    items?: { measurementCode: string; value: string; unit: string }[];
  },
): FitnessEvaluation | null {
  if (object(value) && value.status === "not_evaluated" && text(value.reason))
    return null;
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    value.status !== "evaluated" ||
    value.measurementId !== record.id ||
    value.measurementRevision !== record.revision ||
    !positiveInteger(value.measurementRevision) ||
    !uuid(value.measurementId) ||
    !text(value.ruleVersion) ||
    !text(value.evaluatedAt) ||
    !Number.isFinite(Date.parse(value.evaluatedAt)) ||
    !Array.isArray(value.axes) ||
    value.axes.length !== 6 ||
    !value.axes.every(
      (a) =>
        object(a) &&
        factor(a.factor) &&
        result(a) &&
        Array.isArray(a.sourceMeasurementCodes) &&
        a.sourceMeasurementCodes.length <= 100 &&
        a.sourceMeasurementCodes.every(text) &&
        unique(a.sourceMeasurementCodes, (s) => s),
    ) ||
    !unique(value.axes, (a) => a.factor) ||
    !Array.isArray(value.items) ||
    value.items.length > 100 ||
    !value.items.every(
      (i) =>
        object(i) &&
        text(i.measurementCode) &&
        (i.factor === null || factor(i.factor)) &&
        result(i) &&
        (i.value === null || decimal(i.value)) &&
        text(i.unit) &&
        criteria(i.criteria) &&
        (i.evaluatedValue === null ||
          (object(i.evaluatedValue) &&
            decimal(i.evaluatedValue.value) &&
            text(i.evaluatedValue.unit))),
    ) ||
    !unique(value.items, (i) => i.measurementCode)
  )
    return invalid();
  const parsed = value as unknown as FitnessEvaluation;
  for (const item of parsed.items) {
    if (
      ["evaluated", "below_standard"].includes(item.status) &&
      item.value === null
    )
      return invalid();
    if (record.items) {
      const raw = record.items.find(
        (i) => i.measurementCode === item.measurementCode,
      );
      if (
        raw
          ? raw.value !== item.value || raw.unit !== item.unit
          : item.value !== null
      )
        return invalid();
    }
  }
  for (const axis of parsed.axes) {
    const hasGrade =
      axis.status === "evaluated" || axis.status === "below_standard";
    if (hasGrade !== axis.sourceMeasurementCodes.length > 0) return invalid();
    for (const code of axis.sourceMeasurementCodes) {
      const item = parsed.items.find((i) => i.measurementCode === code);
      if (
        !item ||
        item.factor !== axis.factor ||
        item.status !== axis.status ||
        item.grade !== axis.grade
      )
        return invalid();
    }
  }
  // Ordering is presentation, not evaluation. Preserve every explicitly returned axis.
  return {
    ...parsed,
    axes: fitnessFactors.map((f) =>
      parsed.axes.find((a) => a.factor === f.code)!,
    ),
  };
}
export function parseLatestFitness(
  value: unknown,
): LatestFitnessProfile | null {
  if (
    value === null ||
    (object(value) && value.measurement === null && value.evaluation === null)
  )
    return null;
  if (!object(value) || !object(value.measurement)) return invalid();
  const m = value.measurement;
  if (
    !uuid(m.id) ||
    !positiveInteger(m.revision) ||
    typeof m.measuredOn !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(m.measuredOn) ||
    !Number.isFinite(Date.parse(m.measuredOn)) ||
    new Date(m.measuredOn).toISOString().slice(0, 10) !== m.measuredOn
  )
    return invalid();
  const measurement = {
    id: m.id,
    revision: m.revision,
    measuredOn: m.measuredOn,
  };
  return {
    measurement,
    evaluation: parseEvaluation(value.evaluation, measurement),
  };
}
export function gradeLabel(result: GradeResult) {
  switch (result.status) {
    case "evaluated":
      return `${result.grade}등급`;
    case "below_standard":
      return "기준 미달";
    case "missing_input":
      return "평가 불가 · 정보 부족";
    case "unsupported_rule":
      return "평가 불가 · 기준 없음";
    case "not_measured":
      return "평가 미존재 · 미측정";
  }
}
/** Ordinal display positions only, never stored or sent as scores/grades. */
export function gradeRadius(result: GradeResult) {
  return result.status === "evaluated"
    ? (5 - result.grade) / 4
    : result.status === "below_standard"
      ? 0.25
      : 0;
}
export function radarPoint(index: number, radius: number) {
  const angle = (index * Math.PI) / 3 - Math.PI / 2;
  const round = (v: number) => Number(v.toFixed(3));
  return {
    x: round(180 + Math.cos(angle) * 108 * radius),
    y: round(158 + Math.sin(angle) * 108 * radius),
  };
}
export function radarGeometry(axes: readonly FitnessAxis[]) {
  const points = fitnessFactors.map((f, index) => {
    const axis = axes.find((a) => a.factor === f.code);
    if (!axis) return invalid();
    return { ...radarPoint(index, gradeRadius(axis)), factor: f.code };
  });
  return {
    points,
    path:
      points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ") + " Z",
  };
}
