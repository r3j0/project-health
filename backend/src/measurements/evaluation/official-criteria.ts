import type { Criterion } from './evaluation-types.js';
import { ADULT_THRESHOLDS } from './official-adult-thresholds.js';

// A measurement code identifies its protocol, not merely a fitness axis.
// Adult self curl-ups and recovery pulse counts deliberately have distinct keys.
export const MEASUREMENT_PROTOCOLS: Readonly<Record<string, string>> = {
  height: 'nfa100_height_cm',
  weight: 'nfa100_weight_kg',
  bmi: 'nfa100_bmi_kg_m2',
  waist_circumference: 'nfa100_waist_circumference_cm',
  body_fat_percentage: 'nfa100_body_fat_percentage',
  relative_grip_strength: 'nfa100_relative_grip_strength',
  curl_up: 'nfa100_youth_curl_up',
  self_curl_up: 'nfa100_adult_self_curl_up',
  cross_sit_up: 'nfa100_adult_cross_sit_up_60s',
  repeated_jump: 'nfa100_youth_repeated_jump',
  shuttle_run_20m: 'nfa100_shuttle_run_20m',
  treadmill_vo2max: 'nfa100_treadmill_vo2max',
  step_test_vo2max: 'nfa100_step_test_vo2max',
  ymca_recovery_heart_rate: 'nfa100_ymca_recovery_heart_rate_bpm',
  sit_and_reach: 'nfa100_sit_and_reach',
  illinois_agility: 'nfa100_youth_illinois_agility',
  shuttle_run_10m_4: 'nfa100_adult_shuttle_run_10m_4',
  reaction_time: 'nfa100_adult_reaction_time',
  standing_long_jump: 'nfa100_adult_standing_long_jump',
  flight_time: 'nfa100_flight_time',
  t_wall_coordination: 'nfa100_youth_t_wall_coordination',
};

const units: Readonly<Record<string, string>> = {
  shuttle_run_20m: '회',
  treadmill_vo2max: 'ml/kg/min',
  step_test_vo2max: 'ml/kg/min',
  relative_grip_strength: '%',
  cross_sit_up: '회',
  sit_and_reach: 'cm',
  shuttle_run_10m_4: '초',
  reaction_time: '초',
  standing_long_jump: 'cm',
  flight_time: '초',
};

// Only verified primary-source criteria are registered. The separate research
// record keeps the extraction, source hashes and known source limitations.
export const OFFICIAL_CRITERIA: readonly Criterion[] = ADULT_THRESHOLDS.flatMap(
  ({ sex, minAge, maxAge, thresholds }) =>
    Object.entries(thresholds).map(([measurementCode, values]): Criterion => {
      const lowerIsBetter =
        measurementCode === 'shuttle_run_10m_4' ||
        measurementCode === 'reaction_time';
      const selfAssessmentSupported =
        measurementCode === 'cross_sit_up' ||
        measurementCode === 'sit_and_reach';
      return {
        id: `nfa100-adult-${measurementCode}-${sex}-${minAge}-${maxAge}`,
        internalVersion: 'nfa100-adult-2025-0027-v1',
        officialVersion: '문화체육관광부 고시 제2025-0027호',
        effectiveFrom: '2025-06-02',
        effectiveUntil: null,
        rounding: 'none',
        measurementCode,
        protocol: MEASUREMENT_PROTOCOLS[measurementCode],
        unit: units[measurementCode],
        direction: lowerIsBetter ? 'lower' : 'higher',
        minAge,
        maxAge,
        sex,
        entryMethods: selfAssessmentSupported
          ? ['manual', 'self_assessment']
          : ['manual'],
        catalogVersions: [
          'nfa100-2026-09-19',
          'nfa100-2026-09-23',
          'nfa100-2026-09-24',
        ],
        source: {
          url: 'https://nfa.kspo.or.kr/reserve/0/selectMeasureGradeItemListByAgeSe.kspo',
          supportingUrls: [
            'https://www.mcst.go.kr/site/s_data/ordinance/instruction/instructionView.jsp?pSeq=3588',
            'https://www.law.go.kr/LSW/flDownload.do?bylClsCd=200201&flSeq=153209715',
          ],
          protocolUrl: selfAssessmentSupported
            ? 'https://nfa.kspo.or.kr/measure/self/selectSelfMeasureItem.kspo'
            : 'https://nfa.kspo.or.kr/reserve/3/selectMeasureItemListByAgeSe.kspo',
          documentTitle:
            '국민체력100 성인기 인증기준 및 체력인증의 등급별 기준과 절차에 관한 규정 별표 3',
          checkedOn: '2026-09-23',
          revision: '문화체육관광부 고시 제2025-0027호 (시행 2025-06-02)',
        },
        thresholds: values.map((value, index) => ({
          grade: index + 1,
          intervals: [
            {
              lower: lowerIsBetter ? null : { value, inclusive: true },
              upper: lowerIsBetter ? { value, inclusive: true } : null,
            },
          ],
        })),
      };
    }),
);
