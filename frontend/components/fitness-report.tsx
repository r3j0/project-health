import type { Catalog, Measurement } from "@/lib/types";
import { fitnessFactors, gradeLabel } from "@/lib/fitness-evaluation";
import {
  itemGradeResult,
  parseMeasurementEvaluation,
  type ReportItem,
} from "@/lib/fitness-contract";
import { FitnessRadar } from "./fitness-radar";
import { FitnessCriteria } from "./fitness-criteria";
import { Notice } from "./ui";

function ItemReport({ item, label }: { item: ReportItem; label: string }) {
  const evaluation = item.evaluation;
  return (
    <div className="evaluation-item stack-sm">
      <h3>{label}</h3>
      <p>
        {item.value} {item.unit} · {gradeLabel(itemGradeResult(evaluation))}
      </p>
      <p className="muted">{evaluation.message}</p>
      <FitnessCriteria evaluation={evaluation} />
      {evaluation.evaluatedAt && (
        <p className="caption evaluation-version">
          평가 시각{" "}
          {new Intl.DateTimeFormat("ko-KR", {
            timeZone: "Asia/Seoul",
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(evaluation.evaluatedAt))}
        </p>
      )}
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
    evaluation = parseMeasurementEvaluation(record, catalog);
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
        표시해요. 종합 인증등급과는 별개예요.
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
                  <ItemReport
                    key={item.measurementCode}
                    item={item}
                    label={label(item.measurementCode)}
                  />
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
                .map((item) => (
                  <ItemReport
                    key={item.measurementCode}
                    item={item}
                    label={label(item.measurementCode)}
                  />
                ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
