import type { MeasurementConversion } from "@/lib/fitness-contract";
import { displayConvertedValue } from "@/lib/conversion-display";

/** Only receives conversions that passed the report contract boundary. */
export function ConversionDetails({
  conversion,
}: {
  conversion: MeasurementConversion;
}) {
  const input = (code: string) =>
    conversion.inputs.find((i) => i.measurementCode === code)!.value;
  const step = conversion.formulaVersion === "nfa100-adult-step-vo2max-v1";
  return (
    <div className="stack-sm">
      <p>
        {step ? "추정 최대산소섭취량" : "등급 판정에 사용한 상대악력"}:{" "}
        {displayConvertedValue(conversion.value)} {conversion.unit}
      </p>
      {step ? (
        <>
          <p className="caption">
            측정 당시 {conversion.sexAtMeasurement === "male" ? "남성" : "여성"}{" "}
            · 만 {conversion.ageAtMeasurement}세 · 신장 {input("height")} cm ·
            체중 {input("weight")} kg · 회복 심박수{" "}
            {input("ymca_recovery_heart_rate")} bpm
          </p>
          <p className="caption">
            적용 공식:{" "}
            {conversion.sexAtMeasurement === "male"
              ? "70.597 − 0.246×나이 + 0.077×신장 − 0.222×체중 − 0.147×심박수"
              : "54.337 − 0.185×나이 + 0.097×신장 − 0.246×체중 − 0.122×심박수"}
          </p>
          <p className="caption">
            자가측정 기반 참고 등급이며 공식 인증이 아니에요. 아래 기준과 다음
            목표는 최대산소섭취량(ml/kg/min) 기준이에요.
          </p>
          <p className="caption">
            30cm 스텝박스 · 96bpm · 운동 3분 · 회복 1분 후 10초 맥박 × 6
          </p>
          <a
            className="text-link"
            href={conversion.protocolUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            자가측정 방법 (새 창)
          </a>
        </>
      ) : (
        <>
          <p className="caption">
            절대악력 {input("absolute_grip_strength")} kg ÷ 같은 기록의 체중{" "}
            {input("weight")} kg × 100
          </p>
          <p className="caption">
            아래 등급 기준과 목표는 상대악력(%) 기준이에요.
          </p>
        </>
      )}
      <p className="caption">
        환산값 표시는 소수점 6자리까지이며, 등급은 반올림하지 않은 계산값으로
        판정해요.
      </p>
      <a
        className="text-link"
        href={conversion.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        {step ? "최대산소섭취량 계산 공식" : "상대악력 환산 안내"} (새 창)
      </a>
    </div>
  );
}
