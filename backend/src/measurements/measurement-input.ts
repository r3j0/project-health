import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';

export type FieldError = { field: string; message: string };

export function invalidInput(errors: FieldError[]): never {
  throw new BadRequestException({
    statusCode: 400,
    message: '측정 입력을 확인해 주세요.',
    errors,
  });
}

export function koreaDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !value.startsWith('0000') &&
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, '실제로 존재하는 YYYY-MM-DD 날짜를 입력해 주세요.');
const measuredOn = date.refine(
  (value) => value <= koreaDate(),
  '미래 측정일은 저장할 수 없습니다.',
);
const age = z.number().int().min(13).max(64);
const text = (max: number) => z.string().trim().min(1).max(max);
const version = text(100);

// Strings retain all submitted digits through JSON parsing. This bound limits
// input size, not a physiological range; values are never rounded.
export const decimalValueSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/,
    '측정값은 지수 표기 없는 10진수 문자열로 입력해 주세요.',
  )
  .transform((value) => new Prisma.Decimal(value).toFixed());

const itemSchema = z.strictObject({
  measurementCode: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/),
  value: decimalValueSchema,
  unit: text(30),
  reportedGrade: text(100).nullable().optional().default(null),
});
const items = z
  .array(itemSchema)
  .min(1)
  .max(100)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((item, index) => {
      if (seen.has(item.measurementCode))
        ctx.addIssue({
          code: 'custom',
          path: [index, 'measurementCode'],
          message: '같은 검사 코드는 한 번만 입력할 수 있습니다.',
        });
      seen.add(item.measurementCode);
    });
  });

const mutableFields = {
  measuredOn,
  ageAtMeasurement: age,
  sexAtMeasurement: z.enum(['male', 'female']).nullable(),
  reportKind: z.enum(['standard', 'simple', 'unknown']),
  centerName: text(200).nullable(),
  reportedOverallGrade: text(100).nullable(),
  items,
};

// Extraction validates each metadata field independently, using the save rules.
export const measurementMetadataSchemas = {
  measuredOn,
  ageAtMeasurement: age,
  sexAtMeasurement: mutableFields.sexAtMeasurement,
  centerName: mutableFields.centerName,
  reportedOverallGrade: mutableFields.reportedOverallGrade,
};

const createSchema = z.strictObject({
  ...mutableFields,
  catalogVersion: version,
  sexAtMeasurement: mutableFields.sexAtMeasurement.optional().default(null),
  reportKind: mutableFields.reportKind.optional().default('unknown'),
  centerName: mutableFields.centerName.optional().default(null),
  reportedOverallGrade: mutableFields.reportedOverallGrade
    .optional()
    .default(null),
});
const patchSchema = z
  .strictObject(mutableFields)
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    '수정할 필드를 한 개 이상 입력해 주세요.',
  );

const queryAge = z
  .string()
  .regex(/^\d{1,2}$/)
  .transform(Number)
  .pipe(age);
const catalogQuerySchema = z.strictObject({
  version: version.optional(),
  age: queryAge.optional(),
});
const listQuerySchema = z
  .strictObject({
    limit: z
      .string()
      .regex(/^\d{1,2}$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(50))
      .optional()
      .default(20),
    cursor: z.string().min(1).max(512).optional(),
    from: date.optional(),
    to: date.optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    path: ['to'],
    message: '종료일은 시작일보다 빠를 수 없습니다.',
  });
const cursorSchema = z.strictObject({
  v: z.literal(1),
  measuredOn: date,
  id: z.uuid(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown, prefix = ''): T {
  const result = schema.safeParse(value);
  if (!result.success)
    invalidInput(
      result.error.issues.map((issue) => ({
        field:
          [prefix, ...issue.path.map(String)].filter(Boolean).join('.') ||
          'body',
        message: issue.message,
      })),
    );
  return result.data;
}

export type CreateMeasurementInput = z.output<typeof createSchema>;
export type PatchMeasurementInput = z.output<typeof patchSchema>;
export const parseCreate = (value: unknown) => parse(createSchema, value);
export const parsePatch = (value: unknown) => parse(patchSchema, value);
export const parseListQuery = (value: unknown) =>
  parse(listQuerySchema, value, 'query');
export const parseCatalogQuery = (value: unknown) =>
  parse(catalogQuerySchema, value, 'query');
export const parseId = (value: unknown) =>
  parse(z.uuid(), value, 'id').toLowerCase();
export const parseCreateKey = (value: unknown) =>
  parse(z.uuid(), value, 'Idempotency-Key').toLowerCase();

export function parseRevision(value: unknown) {
  if (value === undefined)
    throw new HttpException(
      'If-Match에 조회한 revision을 보내 주세요.',
      HttpStatus.PRECONDITION_REQUIRED,
    );
  const header = parse(z.string().regex(/^"[1-9]\d{0,9}"$/), value, 'If-Match');
  return parse(
    z.number().int().min(1).max(2147483647),
    Number(header.slice(1, -1)),
    'If-Match',
  );
}

export function encodeCursor(record: { id: string; measuredOn: Date }) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      measuredOn: record.measuredOn.toISOString().slice(0, 10),
      id: record.id,
    }),
  ).toString('base64url');
}

export function decodeCursor(value: string) {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) throw new Error();
    return cursorSchema.parse(JSON.parse(decoded.toString('utf8')) as unknown);
  } catch {
    invalidInput([
      { field: 'query.cursor', message: '올바른 페이지 커서를 사용해 주세요.' },
    ]);
  }
}
