import { definitionValueErrors } from '../measurement-catalog.service.js';
import { measurementUnavailabilityReason } from '../measurement-availability.js';
import type { MeasurementCatalogService } from '../measurement-catalog.service.js';
import {
  decimalValueSchema,
  measurementMetadataSchemas,
} from '../measurement-input.js';
import type {
  ExtractionCandidate,
  ExtractionIssue,
  ModelExtraction,
} from './extraction.schema.js';

// Exact equivalent spellings only. No case-folding, fuzzy matching or conversion.
const UNIT_ALIASES: Record<string, readonly string[]> = {
  cm: ['cm', '㎝', '센티미터'],
  kg: ['kg', '㎏', '킬로그램'],
  '%': ['%', '％', '퍼센트'],
  회: ['회', '횟수'],
  초: ['초', 's', 'sec'],
  'kg/m²': ['kg/m²', 'kg/m2', 'kg/㎡', '㎏/㎡'],
  'ml/kg/min': ['ml/kg/min', 'mL/kg/min', 'mL·kg⁻¹·min⁻¹', 'ml·kg⁻¹·min⁻¹'],
};

export function normalizeUnit(raw: string | null, expected: string) {
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === expected || UNIT_ALIASES[expected]?.includes(trimmed)
    ? expected
    : null;
}

type Catalog = Awaited<ReturnType<MeasurementCatalogService['get']>>;
type DraftItem = {
  measurementCode: string;
  value: string;
  unit: string;
  reportedGrade: string | null;
  evidence: ExtractionCandidate['evidence'];
};
type ReviewItem = {
  measurementCode: string | null;
  value: string | null;
  unit: string | null;
  reportedGrade: string | null;
  evidence: ExtractionCandidate['evidence'];
  reasons: string[];
};

export function validateExtraction(raw: ModelExtraction, catalog: Catalog) {
  const issues: ExtractionIssue[] = [];
  const issue = (code: string, field: string, requiresInput = false) =>
    issues.push({ code, field, requiresInput });
  const blocked = [
    'not_target',
    'unreadable',
    'mixed_sessions',
    'multiple_people',
  ].includes(raw.documentStatus);
  const source = blocked
    ? {
        measuredOn: null,
        ageAtMeasurement: null,
        sexAtMeasurement: null,
        centerName: null,
        reportedOverallGrade: null,
      }
    : raw.metadata;

  function metadata<T>(
    field: keyof typeof source,
    schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
    value: unknown,
  ): T | null {
    if (value === null) return null;
    const parsed = schema.safeParse(value);
    if (parsed.success && parsed.data !== undefined) return parsed.data;
    issue('INVALID_METADATA', `metadata.${field}`);
    return null;
  }
  const ageText = source.ageAtMeasurement;
  const ageNumber =
    ageText !== null && /^(0|[1-9]\d{0,2})$/.test(ageText)
      ? Number(ageText)
      : null;
  const unsupportedAge =
    ageNumber !== null && (ageNumber < 13 || ageNumber > 64);
  const session = {
    measuredOn: metadata(
      'measuredOn',
      measurementMetadataSchemas.measuredOn,
      source.measuredOn,
    ),
    ageAtMeasurement: metadata(
      'ageAtMeasurement',
      measurementMetadataSchemas.ageAtMeasurement,
      ageNumber ?? ageText,
    ),
    sexAtMeasurement: metadata(
      'sexAtMeasurement',
      measurementMetadataSchemas.sexAtMeasurement,
      source.sexAtMeasurement,
    ),
    centerName: metadata(
      'centerName',
      measurementMetadataSchemas.centerName,
      source.centerName,
    ),
    reportedOverallGrade: metadata(
      'reportedOverallGrade',
      measurementMetadataSchemas.reportedOverallGrade,
      source.reportedOverallGrade,
    ),
  };
  if (!session.measuredOn) issue('INPUT_REQUIRED', 'metadata.measuredOn', true);
  if (session.ageAtMeasurement === null) {
    issue('INPUT_REQUIRED', 'metadata.ageAtMeasurement', true);
    issue('AGE_VALIDATION_PENDING', 'items');
  }
  if (unsupportedAge)
    issue('UNSUPPORTED_AGE', 'metadata.ageAtMeasurement', true);
  if (raw.hasUnreadableRegions) issue('UNREADABLE_REGION', 'image');
  if (raw.documentStatus !== 'nfa100')
    issue(raw.documentStatus.toUpperCase(), 'image');

  const candidates = blocked ? [] : raw.candidates;
  const counts = new Map<string, number>();
  for (const row of candidates) {
    if (row.measurementCode)
      counts.set(
        row.measurementCode,
        (counts.get(row.measurementCode) ?? 0) + 1,
      );
  }
  const definitions = new Map(
    catalog.definitions.map((def) => [def.code, def]),
  );
  const items: DraftItem[] = [];
  const reviewItems: ReviewItem[] = [];
  for (const candidate of candidates) {
    const { measurementCode, value, unit, reportedGrade, evidence } = candidate;
    const reasons: string[] = candidate.concerns.map((reason) =>
      reason.toUpperCase(),
    );
    const def = measurementCode ? definitions.get(measurementCode) : undefined;
    if (
      measurementCode &&
      measurementUnavailabilityReason(measurementCode) !== null
    )
      reasons.push('MEASUREMENT_RETIRED');
    if (!def) reasons.push('UNKNOWN_TEST');
    if (measurementCode && (counts.get(measurementCode) ?? 0) > 1)
      reasons.push('DUPLICATE_CODE');
    if (candidate.reading !== 'readable')
      reasons.push(
        candidate.reading === 'blank' ? 'BLANK_VALUE' : 'UNREADABLE_VALUE',
      );
    if (raw.documentStatus === 'grades_only') reasons.push('GRADES_ONLY');
    if (unsupportedAge) reasons.push('UNSUPPORTED_AGE');
    if (!evidence.label?.trim()) reasons.push('MISSING_EVIDENCE');
    const parsed = decimalValueSchema.safeParse(value);
    const original = decimalValueSchema.safeParse(evidence.value);
    if (!parsed.success) reasons.push('INVALID_VALUE');
    if (!original.success || (parsed.success && parsed.data !== original.data))
      reasons.push('VALUE_EVIDENCE_MISMATCH');
    const normalized = def ? normalizeUnit(unit, def.unit) : null;
    if (!unit || !evidence.unit) reasons.push('UNIT_MISSING');
    if (
      def &&
      (!normalized || normalizeUnit(evidence.unit, def.unit) !== normalized)
    )
      reasons.push('UNIT_MISMATCH');
    const grade =
      measurementMetadataSchemas.reportedOverallGrade.safeParse(reportedGrade);
    if (!grade.success) reasons.push('INVALID_REPORTED_GRADE');
    if (
      def &&
      session.ageAtMeasurement !== null &&
      (session.ageAtMeasurement < def.minAge ||
        session.ageAtMeasurement > def.maxAge)
    )
      reasons.push('AGE_NOT_APPLICABLE');
    if (
      def &&
      parsed.success &&
      normalized &&
      definitionValueErrors({ value: parsed.data, unit: normalized }, def)
        .length
    )
      reasons.push('VALUE_CONSTRAINT');
    if (
      reasons.length ||
      !def ||
      !parsed.success ||
      !normalized ||
      !grade.success
    ) {
      reviewItems.push({
        measurementCode,
        value,
        unit,
        reportedGrade,
        evidence,
        reasons: [...new Set(reasons)],
      });
    } else {
      items.push({
        measurementCode: def.code,
        value: parsed.data,
        unit: normalized,
        reportedGrade: grade.data,
        evidence,
      });
    }
  }
  if (!items.length) issue('INPUT_REQUIRED', 'items', true);
  if (reviewItems.length) issue('ITEM_REVIEW_REQUIRED', 'reviewItems');
  const status =
    raw.documentStatus !== 'nfa100'
      ? raw.documentStatus
      : unsupportedAge
        ? 'unsupported_age'
        : items.length === 0
          ? 'needs_review'
          : issues.length > 0
            ? 'partial'
            : 'extracted';
  return {
    catalogVersion: catalog.version,
    status,
    metadata: session,
    items,
    reviewItems,
    issues,
    // Not detected is NOT an assertion that a test was not performed.
    notDetectedMeasurementCodes: blocked
      ? []
      : catalog.definitions
          .filter(
            (def) =>
              measurementUnavailabilityReason(def.code) === null &&
              !counts.has(def.code) &&
              (session.ageAtMeasurement === null ||
                (session.ageAtMeasurement >= def.minAge &&
                  session.ageAtMeasurement <= def.maxAge)),
          )
          .map((def) => def.code),
  };
}

export type ExtractionDraft = ReturnType<typeof validateExtraction>;
