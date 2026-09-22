import test from "node:test";
import assert from "node:assert/strict";
import {
  fitnessFactors,
  gradeRadius,
  parseEvaluation,
  parseLatestFitness,
  radarGeometry,
  safeSourceUrl,
  type FitnessAxis,
} from "../../lib/fitness-evaluation.ts";
import { evaluatedFixture, recordIdentity } from "../fixtures/fitness.ts";

test("서버 평가를 보존하고 공식 순서로만 재배열한다", () => {
  const input = evaluatedFixture();
  input.axes.reverse();
  const parsed = parseEvaluation(input, recordIdentity)!;
  assert.deepEqual(
    parsed.axes.map((a) => a.factor),
    fitnessFactors.map((f) => f.code),
  );
  assert.equal(parsed.axes[3].grade, 2);
  assert.equal(parsed.items[0].value, "-2.5");
  assert.equal(parsed.items[0].criteria?.nextGrade?.gap, "12.5");
  assert.equal(
    parseEvaluation(
      { status: "not_evaluated", reason: "evaluation_not_implemented" },
      recordIdentity,
    ),
    null,
  );
});
test("다른 기록/수정 전 평가와 누락·중복 축·알 수 없는 등급은 거부한다", () => {
  const mutations = [
    (e: FitnessEvaluationLike) => {
      e.measurementId = "wrong-record";
    },
    (e: FitnessEvaluationLike) => {
      e.measurementRevision = 2;
    },
    (e: FitnessEvaluationLike) => {
      e.axes.pop();
    },
    (e: FitnessEvaluationLike) => {
      e.axes[1] = e.axes[0];
    },
    (e: FitnessEvaluationLike) => {
      e.axes[3].grade = 0;
    },
    (e: FitnessEvaluationLike) => {
      e.axes[3].grade = 6;
    },
    (e: FitnessEvaluationLike) => {
      e.axes[0].grade = 1;
    },
    (e: FitnessEvaluationLike) => {
      e.axes[3].sourceMeasurementCodes = ["nonexistent"];
    },
    (e: FitnessEvaluationLike) => {
      e.items[0].grade = 1;
    },
    (e: FitnessEvaluationLike) => {
      e.items[0].value = null;
    },
  ];
  for (const mutate of mutations) {
    const e = structuredClone(
      evaluatedFixture(),
    ) as unknown as FitnessEvaluationLike;
    mutate(e);
    assert.throws(() => parseEvaluation(e, recordIdentity));
  }
});
// Deliberately invalid JSON mutations exercise the runtime trust boundary.
type FitnessEvaluationLike = {
  measurementId: string;
  measurementRevision: number;
  axes: { grade: number | null; sourceMeasurementCodes: string[] }[];
  items: { grade: number | null; value: string | null }[];
};
test("평가의 원래 측정값이 저장된 원본과 다르면 거부한다", () => {
  const items = [{ measurementCode: "sit_and_reach", value: "0", unit: "cm" }];
  assert.throws(() =>
    parseEvaluation(evaluatedFixture(), { ...recordIdentity, items }),
  );
});
test("0, 1, 2개 평가 모두 여섯 점을 원점을 포함하여 닫힌 경로로 연결한다", () => {
  const axes: FitnessAxis[] = fitnessFactors.map((f) => ({
    factor: f.code,
    status: "not_measured",
    grade: null,
    reason: null,
    sourceMeasurementCodes: [],
  }));
  for (let count = 0; count <= 2; count++) {
    if (count)
      axes[count - 1] = { ...axes[count - 1], status: "evaluated", grade: 1 };
    const result = radarGeometry(axes);
    assert.equal(result.points.length, 6);
    assert.equal(
      result.points.filter((p) => p.x === 180 && p.y === 158).length,
      6 - count,
    );
    assert.equal((result.path.match(/L /g) ?? []).length, 5);
    assert.ok(result.path.endsWith(" Z"));
  }
  assert.deepEqual(radarGeometry(axes).points[0], {
    factor: "cardiorespiratory_endurance",
    x: 180,
    y: 50,
  });
  assert.ok(radarGeometry(axes).points[1].x > 180);
});
test("기준 미달은 원점보다 바깥, 등급이 좋을수록 바깥에 표시한다", () => {
  const levels = [
    gradeRadius({ status: "not_measured", grade: null, reason: null }),
    gradeRadius({ status: "below_standard", grade: null, reason: null }),
    ...([3, 2, 1] as const).map((grade) =>
      gradeRadius({ status: "evaluated", grade, reason: null }),
    ),
  ];
  assert.deepEqual(levels, [0, 0.25, 0.5, 0.75, 1]);
});
test("대표 프로필은 하나의 기록 식별자와 일치해야 하며 빈 상태가 명시되어야 한다", () => {
  assert.equal(
    parseLatestFitness({ measurement: null, evaluation: null }),
    null,
  );
  assert.equal(
    parseLatestFitness({
      measurement: recordIdentity,
      evaluation: evaluatedFixture(),
    })?.measurement.id,
    recordIdentity.id,
  );
  assert.throws(() =>
    parseLatestFitness({
      measurement: { ...recordIdentity, revision: 2 },
      evaluation: evaluatedFixture(),
    }),
  );
  assert.throws(() => parseLatestFitness({ measurement: null, axes: [] }));
});
test("판정 근거의 실행 URL과 잘못된 임계값은 거부한다", () => {
  assert.equal(safeSourceUrl("javascript:alert(1)"), false);
  assert.equal(safeSourceUrl("https://user:pass@example.com"), false);
  const e = evaluatedFixture();
  e.items[0].criteria!.sources[0].url = "javascript:alert(1)";
  assert.throws(() => parseEvaluation(e, recordIdentity));
  const duplicate = evaluatedFixture();
  duplicate.items[0].criteria!.thresholds.push(
    duplicate.items[0].criteria!.thresholds[0],
  );
  assert.throws(() => parseEvaluation(duplicate, recordIdentity));
});
