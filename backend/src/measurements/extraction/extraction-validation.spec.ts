import { describe, expect, it } from 'vitest';
import { candidate, modelResult } from '../../../test/fixtures/extraction.js';
import type { MeasurementCatalogService } from '../measurement-catalog.service.js';
import { validateExtraction } from './extraction-validation.js';

const catalog: Awaited<ReturnType<MeasurementCatalogService['get']>> = {
  version: 'test-catalog',
  checkedOn: '2026-09-19',
  age: null,
  definitions: [
    ['sit_and_reach', 'cm', 'decimal', null, true, null, 13, 64],
    ['cross_sit_up', '회', 'integer', '0', true, null, 19, 64],
    ['reaction_time', '초', 'decimal', '0', false, null, 19, 64],
    ['relative_grip_strength', '%', 'decimal', '0', true, null, 13, 64],
    ['body_fat_percentage', '%', 'decimal', '0', true, '100', 13, 64],
    ['repeated_jump', '회', 'integer', '0', true, null, 13, 18],
  ].map(
    ([
      code,
      unit,
      valueType,
      minValue,
      minInclusive,
      maxValue,
      minAge,
      maxAge,
    ]) => ({
      code,
      label: code,
      category: 'health_fitness',
      factor: 'flexibility',
      unit,
      valueType,
      minValue,
      minInclusive,
      maxValue,
      minAge,
      maxAge,
      sourceUrls: [],
    }),
  ) as Awaited<ReturnType<MeasurementCatalogService['get']>>['definitions'],
};

function row(code: string, value: string | null, unit: string | null) {
  return candidate({
    measurementCode: code,
    value,
    unit,
    evidence: { label: code, value, unit },
  });
}
const validate = (extra: Parameters<typeof modelResult>[0] = {}) =>
  validateExtraction(modelResult(extra), catalog);

describe('Extraction semantic validation', () => {
  it('preserves negative, zero and arbitrarily precise decimals using existing Decimal rules', () => {
    const result = validate({
      candidates: [
        candidate(),
        row('cross_sit_up', '0', '회'),
        row('reaction_time', '0.301234567890123456789', '초'),
      ],
    });
    expect(result.status).toBe('extracted');
    expect(result.items.map((item) => item.value)).toEqual([
      '-3.25',
      '0',
      '0.301234567890123456789',
    ]);
    expect(result.items[0].evidence.value).toBe('-3.2500');
    expect(result.catalogVersion).toBe(catalog.version);
  });

  it('keeps readable values, distinguishes blank/unreadable rows from undetected tests', () => {
    const result = validate({
      candidates: [
        candidate(),
        { ...row('cross_sit_up', null, '회'), reading: 'blank' },
        { ...row('reaction_time', null, '초'), reading: 'unreadable' },
      ],
      hasUnreadableRegions: true,
    });
    expect(result.status).toBe('partial');
    expect(result.items).toHaveLength(1);
    expect(result.reviewItems[0].reasons).toContain('BLANK_VALUE');
    expect(result.reviewItems[1].reasons).toContain('UNREADABLE_VALUE');
    expect(result.notDetectedMeasurementCodes).toContain(
      'relative_grip_strength',
    );
    expect(result.notDetectedMeasurementCodes).not.toContain('cross_sit_up');
    expect(result.notDetectedMeasurementCodes).not.toContain('repeated_jump');
  });

  it.each([
    'not_target',
    'unreadable',
    'mixed_sessions',
    'multiple_people',
  ] as const)(
    'blocks %s even if a model supplies plausible values',
    (documentStatus) => {
      const result = validate({ documentStatus });
      expect(result.status).toBe(documentStatus);
      expect(result.items).toEqual([]);
      expect(Object.values(result.metadata).every((v) => v === null)).toBe(
        true,
      );
      expect(result.notDetectedMeasurementCodes).toEqual([]);
    },
  );

  it('does not treat a grade as a measurement or discard an original overall grade', () => {
    const result = validate({
      documentStatus: 'grades_only',
      metadata: { ...modelResult().metadata, reportedOverallGrade: '참가' },
    });
    expect(result.status).toBe('grades_only');
    expect(result.items).toEqual([]);
    expect(result.metadata.reportedOverallGrade).toBe('참가');
    expect(result.reviewItems[0].reasons).toContain('GRADES_ONLY');
  });

  it.each(['-3.2500', '12'])(
    'quarantines every duplicate, including equal/conflicting values %s',
    (value) => {
      const result = validate({
        candidates: [candidate(), row('sit_and_reach', value, 'cm')],
      });
      expect(result.items).toEqual([]);
      expect(result.reviewItems).toHaveLength(2);
      expect(
        result.reviewItems.every((item) =>
          item.reasons.includes('DUPLICATE_CODE'),
        ),
      ).toBe(true);
    },
  );

  it.each([
    ['absolute_grip_strength', '32', 'kg', 'UNKNOWN_TEST'],
    ['relative_grip_strength', '32', 'kg', 'UNIT_MISMATCH'],
    ['relative_grip_strength', '32', null, 'UNIT_MISSING'],
    ['reaction_time', '300', 'ms', 'UNIT_MISMATCH'],
    ['cross_sit_up', '1.5', '회', 'VALUE_CONSTRAINT'],
    ['cross_sit_up', '-1', '회', 'VALUE_CONSTRAINT'],
    ['reaction_time', '0', '초', 'VALUE_CONSTRAINT'],
    ['body_fat_percentage', '101', '%', 'VALUE_CONSTRAINT'],
    ['repeated_jump', '2', '회', 'AGE_NOT_APPLICABLE'],
    ['sit_and_reach', '1e-3', 'cm', 'INVALID_VALUE'],
  ])('reviews invalid %s (%s %s)', (code, value, unit, reason) => {
    const result = validate({ candidates: [row(code!, value, unit)] });
    expect(result.items).toEqual([]);
    expect(result.reviewItems[0].reasons).toContain(reason);
    expect(result.reviewItems[0].value).toBe(value);
  });

  it('normalizes equivalent units, never changes values or invents evidence', () => {
    expect(
      validate({ candidates: [row('reaction_time', '0.12345', 'sec')] })
        .items[0],
    ).toMatchObject({ unit: '초', value: '0.12345' });
    expect(
      validate({
        candidates: [
          candidate({
            evidence: { label: 'test', value: '-3.2500', unit: null },
          }),
        ],
      }).items,
    ).toEqual([]);
    expect(
      validate({ candidates: [candidate({ value: '3.25' })] }).reviewItems[0]
        .reasons,
    ).toContain('VALUE_EVIDENCE_MISMATCH');
  });

  it('does not select among attempts, ambiguous tests, conversions or reference values', () => {
    for (const concern of [
      'ambiguous_test',
      'multiple_attempts',
      'unit_conversion_required',
      'not_personal_value',
    ] as const) {
      expect(
        validate({ candidates: [candidate({ concerns: [concern] })] }).items,
      ).toEqual([]);
    }
  });

  it('defers age validation when unknown and requires date/age before saving', () => {
    const result = validate({
      metadata: {
        ...modelResult().metadata,
        measuredOn: null,
        ageAtMeasurement: null,
      },
    });
    expect(result.items).toHaveLength(1);
    expect(result.issues).toContainEqual({
      code: 'AGE_VALIDATION_PENDING',
      field: 'items',
      requiresInput: false,
    });
    expect(
      result.issues.filter((i) => i.requiresInput).map((i) => i.field),
    ).toEqual(['metadata.measuredOn', 'metadata.ageAtMeasurement']);
  });

  it.each(['12', '65', '0'])(
    'quarantines known unsupported age %s',
    (ageAtMeasurement) => {
      const result = validate({
        metadata: { ...modelResult().metadata, ageAtMeasurement },
      });
      expect(result.status).toBe('unsupported_age');
      expect(result.items).toEqual([]);
      expect(result.metadata.ageAtMeasurement).toBeNull();
    },
  );

  it.each(['2023-02-29', '2999-01-01', '0000-01-01'])(
    'validates real, nonfuture dates: %s',
    (measuredOn) => {
      const result = validate({
        metadata: {
          ...modelResult().metadata,
          measuredOn,
          ageAtMeasurement: '25.5',
          sexAtMeasurement: 'guessed',
        },
      });
      expect(result.metadata).toMatchObject({
        measuredOn: null,
        ageAtMeasurement: null,
        sexAtMeasurement: null,
      });
      expect(
        result.issues.filter((i) => i.code === 'INVALID_METADATA'),
      ).toHaveLength(3);
    },
  );

  it.each([13, 18, 19, 64])('uses measurement age boundary %i', (age) => {
    const result = validate({
      metadata: { ...modelResult().metadata, ageAtMeasurement: String(age) },
      candidates: [
        row('repeated_jump', '2', '회'),
        row('cross_sit_up', '2', '회'),
      ],
    });
    expect(result.items.map((item) => item.measurementCode)).toEqual([
      age < 19 ? 'repeated_jump' : 'cross_sit_up',
    ]);
  });
});
