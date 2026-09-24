import { z } from 'zod';

const sourceText = (max: number) => z.string().max(max).nullable();
export const candidateSchema = z.strictObject({
  measurementCode: sourceText(100),
  value: sourceText(128),
  unit: sourceText(30),
  reportedGrade: sourceText(100),
  evidence: z.strictObject({
    label: sourceText(100),
    value: sourceText(128),
    unit: sourceText(30),
  }),
  // Visible rows only. Never fabricate a row for an absent catalog item.
  reading: z.enum(['readable', 'blank', 'unreadable']),
  concerns: z
    .array(
      z.enum([
        'unknown_test',
        'ambiguous_test',
        'unit_missing',
        'unit_unclear',
        'unit_conversion_required',
        'multiple_attempts',
        'conflicting_values',
        'not_personal_value',
      ]),
    )
    .max(8),
});

export const modelExtractionSchema = z.strictObject({
  documentStatus: z.enum([
    'nfa100',
    'not_target',
    'unreadable',
    'grades_only',
    'mixed_sessions',
    'multiple_people',
  ]),
  metadata: z.strictObject({
    measuredOn: sourceText(40),
    ageAtMeasurement: sourceText(40),
    sexAtMeasurement: sourceText(40),
    centerName: sourceText(200),
    reportedOverallGrade: sourceText(100),
  }),
  candidates: z.array(candidateSchema).max(100),
  hasUnreadableRegions: z.boolean(),
});

// A single Zod source generates the strict wire schema and validates responses.
export const extractionJsonSchema = z.toJSONSchema(modelExtractionSchema, {
  target: 'draft-7',
});
export type ModelExtraction = z.infer<typeof modelExtractionSchema>;
export type ExtractionCandidate = z.infer<typeof candidateSchema>;
export type ExtractionIssue = {
  code: string;
  field: string;
  requiresInput: boolean;
};
