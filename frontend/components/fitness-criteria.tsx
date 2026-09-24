import {
  formatInterval,
  type StoredItemEvaluation,
} from "@/lib/fitness-contract";

import { FitnessGradeProgress } from "./fitness-grade-progress";

export function FitnessCriteria({
  evaluation,
}: {
  evaluation: StoredItemEvaluation;
}) {
  const { criterion, thresholds } = evaluation;
  if (!criterion) return null;
  return (
    <div className="stack-sm evaluation-criteria">
      <FitnessGradeProgress evaluation={evaluation} />
      <p className="caption">
        만 {criterion.minAge}~{criterion.maxAge}세 ·{" "}
        {criterion.sex === "male" ? "남성" : "여성"} 기준 ·{" "}
        {
          {
            higher: "높을수록 좋은 값",
            lower: "낮을수록 좋은 값",
            range: "기준 구간에 해당하는 값",
          }[criterion.direction]
        }
      </p>
      <dl className="value-list">
        {[...thresholds]
          .sort((a, b) => a.grade - b.grade)
          .map((threshold) => (
            <div className="value-row" key={threshold.grade}>
              <dt>{threshold.grade}등급 기준</dt>
              <dd>
                {threshold.intervals
                  .map((i) => formatInterval(i, criterion.unit))
                  .join(" 또는 ")}
              </dd>
            </div>
          ))}
      </dl>
      <p className="caption">
        적용 기간: {criterion.effectiveFrom ?? "시작일 미지정"} ~{" "}
        {criterion.effectiveUntil ?? "종료일 미지정"}
      </p>
      <a
        className="text-link"
        href={criterion.source.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {criterion.source.documentTitle} (새 창)
      </a>
      <a
        className="text-link"
        href={criterion.source.protocolUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        공식 측정 방법 (새 창)
      </a>
      {criterion.source.supportingUrls
        .filter(
          (url) =>
            url !== criterion.source.url &&
            url !== criterion.source.protocolUrl,
        )
        .map((url, index) => (
          <a
            className="text-link"
            key={url}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            관련 공식 자료 {index + 1} (새 창)
          </a>
        ))}
      <p className="caption evaluation-version">
        공식 기준: {criterion.officialVersion ?? "개정번호 미제공"}
        <br />
        판정 기준 버전: {criterion.internalVersion}
        <br />
        출처 확인일: {criterion.source.checkedOn}
      </p>
    </div>
  );
}
