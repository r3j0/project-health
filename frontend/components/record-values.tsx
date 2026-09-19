import type { Catalog, Measurement } from "@/lib/types";
export function RecordValues({
  record,
  catalog,
}: {
  record: Measurement;
  catalog: Catalog;
}) {
  return (
    <div className="result-card">
      <div className="between result-heading">
        <h2 style={{ fontSize: 16 }}>저장한 측정값</h2>
        <span className="caption">{record.items.length}개</span>
      </div>
      <dl className="value-list">
        {record.items.map((item) => (
          <div className="value-row" key={item.measurementCode}>
            <dt>
              {catalog.definitions.find((d) => d.code === item.measurementCode)
                ?.label ?? item.measurementCode}
            </dt>
            <dd>
              <span>
                {item.value} {item.unit}
              </span>
              {item.reportedGrade && (
                <small>결과표 등급: {item.reportedGrade}</small>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
