import { invalidInput } from './measurement-input.js';

export const selfAssessmentCodes = new Set([
  'height',
  'weight',
  'bmi',
  'waist_circumference',
  'cross_sit_up',
  'self_curl_up',
  'ymca_recovery_heart_rate',
  'sit_and_reach',
]);

export function validateSelfAssessment(input: {
  entryMethod: string;
  ageAtMeasurement: number;
  reportKind: string;
  reportedOverallGrade: string | null;
  items: Array<{ measurementCode: string; reportedGrade: string | null }>;
}) {
  if (input.entryMethod !== 'self_assessment') return;
  const errors: Array<{ field: string; message: string }> = [];
  if (input.ageAtMeasurement < 19 || input.ageAtMeasurement > 64)
    errors.push({
      field: 'ageAtMeasurement',
      message: '성인 간이측정은 만 19~64세를 지원합니다.',
    });
  if (input.reportKind !== 'simple')
    errors.push({
      field: 'reportKind',
      message: '자가 간이측정 유형을 유지해 주세요.',
    });
  if (input.reportedOverallGrade !== null)
    errors.push({
      field: 'reportedOverallGrade',
      message: '자가측정에는 인증등급을 입력할 수 없습니다.',
    });
  const codes = new Set(input.items.map((item) => item.measurementCode));
  if (codes.has('cross_sit_up') && codes.has('self_curl_up'))
    errors.push({
      field: 'items',
      message: '근지구력 항목은 한 가지만 선택해 주세요.',
    });
  input.items.forEach((item, index) => {
    if (!selfAssessmentCodes.has(item.measurementCode))
      errors.push({
        field: `items.${index}.measurementCode`,
        message: '성인 간이측정 항목을 선택해 주세요.',
      });
    if (item.reportedGrade !== null)
      errors.push({
        field: `items.${index}.reportedGrade`,
        message: '자가측정에는 인증등급을 입력할 수 없습니다.',
      });
  });
  if (errors.length) invalidInput(errors);
}
