import type { Catalog, Measurement } from "@/lib/types";
import {
  fitnessFactors,
  gradeLabel,
  parseEvaluation,
  type EvaluationCriteria,
} from "@/lib/fitness-evaluation";
import { FitnessRadar } from "./fitness-radar";
import { Notice } from "./ui";
function Criteria({ criteria }: { criteria: EvaluationCriteria }) {
  const { nextGrade, direction, unit } = criteria;
  return (
    <div className="stack-sm evaluation-criteria">
      <p className="caption">
        만 {criteria.ageMin}~{criteria.ageMax}세 ·{" "}
        {criteria.sex === "male" ? "남성" : "여성"} 기준 ·{" "}
        {direction === "higher_is_better"
          ? "높을수록 좋은 값"
          : "낮을수록 좋은 값"}
      </p>
      <dl className="value-list">
        {[...criteria.thresholds]
          .sort((a, b) => a.grade - b.grade)
          .map((t) => (
            <div className="value-row" key={t.grade}>
              <dt>{t.grade}등급 기준</dt>
              <dd>
                {t.value} {unit}{" "}
                {direction === "higher_is_better"
                  ? t.inclusive
                    ? "이상"
                    : "초과"
                  : t.inclusive
                    ? "이하"
                    : "미만"}
              </dd>
            </div>
          ))}
      </dl>
      {nextGrade && (
        <p>
          다음 {nextGrade.grade}등급 기준값 {nextGrade.value} {unit} · 현재
          값과의 차이 {nextGrade.gap} {unit}
        </p>
      )}
      {criteria.sources.map((s) => (
        <a
          key={s.url}
          className="text-link"
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {s.title} (새 창)
        </a>
      ))}
    </div>
  );
}
export function FitnessReport({
  record,
  catalog,
}: {
  record: Measurement;
  catalog: Catalog;
}) {
  let evaluation;
  try {
    evaluation = parseEvaluation(record.evaluation, record);
  } catch {
    return (
      <Notice>
        평가 정보를 확인하지 못했어요. 저장한 측정값은 아래에서 확인할 수
        있어요.
      </Notice>
    );
  }
  if (!evaluation)
    return (
      <Notice tone="info">
        아직 평가 결과가 제공되지 않았어요. 저장한 측정값은 아래에서 확인할 수
        있어요.
      </Notice>
    );
  const label = (code: string) =>
    catalog.definitions.find((d) => d.code === code)?.label ?? code;
  return (
    <section className="stack" aria-labelledby="fitness-report-title">
      <h2 id="fitness-report-title">이 기록의 체력 프로필</h2>
      <FitnessRadar axes={evaluation.axes} />
      <p className="caption">
        이 측정 기록에서 같은 체력 요인에 속한 종목 중 가장 높은 등급을
        표시해요.
      </p>
      <div className="stack-sm">
        {evaluation.axes.map((axis) => (
          <details className="accordion" key={axis.factor}>
            <summary>
              {fitnessFactors.find((f) => f.code === axis.factor)!.label} ·{" "}
              {gradeLabel(axis)}
            </summary>
            <div className="stack-sm">
              {axis.reason && <p className="muted">{axis.reason}</p>}
              {!!axis.sourceMeasurementCodes.length && (
                <p>
                  대표 등급 반영:{" "}
                  {axis.sourceMeasurementCodes.map(label).join(", ")}
                </p>
              )}
              {evaluation.items
                .filter((i) => i.factor === axis.factor)
                .map((item) => (
                  <div
                    className="evaluation-item stack-sm"
                    key={item.measurementCode}
                  >
                    <h3>{label(item.measurementCode)}</h3>
                    <p>
                      {item.value === null
                        ? "측정값 없음"
                        : `${item.value} ${item.unit}`}{" "}
                      · {gradeLabel(item)}
                    </p>
                    {item.reason && <p className="muted">{item.reason}</p>}
                    {item.evaluatedValue && (
                      <p className="caption">
                        평가에 사용한 환산값: {item.evaluatedValue.value}{" "}
                        {item.evaluatedValue.unit}
                      </p>
                    )}
                    {item.criteria ? (
                      <Criteria criteria={item.criteria} />
                    ) : (
                      <p className="caption">
                        상세 판정 기준이 제공되지 않았어요.
                      </p>
                    )}
                  </div>
                ))}
            </div>
          </details>
        ))}
        {evaluation.items.some((i) => i.factor === null) && (
          <details className="accordion">
            <summary>다각형에 포함하지 않는 항목</summary>
            <div className="stack-sm">
              {evaluation.items
                .filter((i) => i.factor === null)
                .map((i) => (
                  <p key={i.measurementCode}>
                    {label(i.measurementCode)} · {gradeLabel(i)}
                    {i.reason ? ` — ${i.reason}` : ""}
                  </p>
                ))}
            </div>
          </details>
        )}
      </div>
      <p className="caption evaluation-version">
        판정 기준 {evaluation.ruleVersion} · 평가 시각{" "}
        {new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul",
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(evaluation.evaluatedAt))}
      </p>
    </section>
  );
}
