import type {
  ExtractionCandidate,
  ModelExtraction,
} from '../../src/measurements/extraction/extraction.schema.js';

// Synthetic values only; no report photos, personal data or credentials.
export function candidate(
  extra: Partial<ExtractionCandidate> = {},
): ExtractionCandidate {
  return {
    measurementCode: 'sit_and_reach',
    value: '-3.2500',
    unit: 'cm',
    reportedGrade: null,
    evidence: { label: '앉아윗몸앞으로굽히기', value: '-3.2500', unit: 'cm' },
    reading: 'readable',
    concerns: [],
    ...extra,
  };
}

export function modelResult(
  extra: Partial<ModelExtraction> = {},
): ModelExtraction {
  return {
    documentStatus: 'nfa100',
    metadata: {
      measuredOn: '2024-02-29',
      ageAtMeasurement: '25',
      sexAtMeasurement: 'female',
      centerName: null,
      reportedOverallGrade: null,
    },
    candidates: [candidate()],
    hasUnreadableRegions: false,
    ...extra,
  };
}

export function responseBody(result: unknown = modelResult()) {
  return {
    status: 'completed',
    output: [
      {
        type: 'message',
        status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(result) }],
      },
    ],
  };
}
