export interface User {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
}
export interface AuthResponse {
  user: User;
  access_token: string;
  expires_in: number;
  token_type: "Bearer";
}
export interface Definition {
  code: string;
  label: string;
  category: string;
  factor: string;
  unit: string;
  valueType: "integer" | "decimal";
  minAge: number;
  maxAge: number;
  minValue: string | null;
  maxValue: string | null;
  minInclusive: boolean;
  sourceUrls: string[];
}
export interface Catalog {
  version: string;
  checkedOn: string;
  age: number | null;
  definitions: Definition[];
}
export interface MeasurementItem {
  measurementCode: string;
  value: string;
  unit: string;
  reportedGrade: string | null;
}
export interface MeasurementMetadata {
  measuredOn: string;
  ageAtMeasurement: number;
  sexAtMeasurement: "male" | "female" | null;
  reportKind: "standard" | "simple" | "unknown";
  centerName: string | null;
  reportedOverallGrade: string | null;
}
export interface MeasurementSummary extends MeasurementMetadata {
  id: string;
  catalogVersion: string;
  revision: number;
  itemCount: number;
  sourceProgram: string;
  entryMethod: string;
  createdAt: string;
  updatedAt: string;
}
export interface Measurement extends Omit<MeasurementSummary, "itemCount"> {
  items: MeasurementItem[];
  missingMeasurementCodes: string[];
  evaluation: { status: "not_evaluated"; reason: string };
}
export interface MeasurementPage {
  items: MeasurementSummary[];
  nextCursor: string | null;
}
export interface MeasurementInput extends MeasurementMetadata {
  catalogVersion: string;
  items: MeasurementItem[];
}
export interface RecordResponse {
  data: Measurement;
  etag: string;
}
