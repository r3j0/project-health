import { describe, expect, it } from 'vitest';
import { parseCreate } from './measurement-input.js';
import { validateSelfAssessment } from './self-assessment.js';

const valid = {
  entryMethod: 'self_assessment' as const,
  reportKind: 'simple' as const,
  reportedOverallGrade: null,
  ageAtMeasurement: 25,
  items: [{ measurementCode: 'ymca_recovery_heart_rate', reportedGrade: null }],
};
describe('Adult self-assessment provenance', () => {
  it('allows partial real measurements without inventing missing values', () => {
    expect(() => validateSelfAssessment(valid)).not.toThrow();
  });
  it.each([18, 65])(
    'rejects unsupported assessment age %s',
    (ageAtMeasurement) => {
      expect(() =>
        validateSelfAssessment({ ...valid, ageAtMeasurement }),
      ).toThrow();
    },
  );
  it('rejects VO2 substitution, two endurance tests, and certification claims', () => {
    expect(() =>
      validateSelfAssessment({
        ...valid,
        items: [{ measurementCode: 'step_test_vo2max', reportedGrade: null }],
      }),
    ).toThrow();
    expect(() =>
      validateSelfAssessment({
        ...valid,
        items: ['cross_sit_up', 'self_curl_up'].map((measurementCode) => ({
          measurementCode,
          reportedGrade: null,
        })),
      }),
    ).toThrow();
    expect(() =>
      validateSelfAssessment({ ...valid, reportedOverallGrade: '1등급' }),
    ).toThrow();
    expect(() =>
      validateSelfAssessment({ ...valid, reportKind: 'standard' }),
    ).toThrow();
  });
  it('keeps manual import the default and rejects unknown provenance', () => {
    const body = {
      measuredOn: '2026-09-21',
      ageAtMeasurement: 25,
      catalogVersion: 'test',
      items: [{ measurementCode: 'height', value: '170', unit: 'cm' }],
    };
    expect(parseCreate(body).entryMethod).toBe('manual');
    expect(
      parseCreate({ ...body, entryMethod: 'self_assessment' }).entryMethod,
    ).toBe('self_assessment');
    expect(() => parseCreate({ ...body, entryMethod: 'ocr' })).toThrow();
  });
});
