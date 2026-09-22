import {
  fitnessFactors,
  type FitnessEvaluation,
} from "../../lib/fitness-evaluation.ts";
export const recordIdentity = {
  id: "00000000-0000-4000-8000-000000000004",
  revision: 1,
  measuredOn: "2026-09-01",
};
/** Synthetic contract examples, never production grade rules. */
export function evaluatedFixture(): FitnessEvaluation {
  return {
    schemaVersion: 1,
    status: "evaluated",
    measurementId: recordIdentity.id,
    measurementRevision: 1,
    ruleVersion: "contract-fixture-only",
    evaluatedAt: "2026-09-01T01:00:00Z",
    axes: fitnessFactors.map((f) =>
      f.code === "flexibility"
        ? {
            factor: f.code,
            status: "evaluated",
            grade: 2,
            reason: null,
            sourceMeasurementCodes: ["sit_and_reach"],
          }
        : {
            factor: f.code,
            status: "not_measured",
            grade: null,
            reason: "이 기록에서 측정하지 않았어요.",
            sourceMeasurementCodes: [],
          },
    ),
    items: [
      {
        measurementCode: "sit_and_reach",
        factor: "flexibility",
        value: "-2.5",
        unit: "cm",
        evaluatedValue: null,
        status: "evaluated",
        grade: 2,
        reason: null,
        criteria: {
          ageMin: 25,
          ageMax: 29,
          sex: "male",
          direction: "higher_is_better",
          unit: "cm",
          thresholds: [
            { grade: 1, value: "10", inclusive: true },
            { grade: 2, value: "-5", inclusive: true },
            { grade: 3, value: "-10", inclusive: true },
          ],
          nextGrade: { grade: 1, value: "10", gap: "12.5" },
          sources: [
            {
              title: "국민체력100 인증기준",
              url: "https://nfa.kspo.or.kr/reserve/0/selectMeasureGradeItemListByAgeSe.kspo",
            },
          ],
        },
      },
    ],
  };
}
