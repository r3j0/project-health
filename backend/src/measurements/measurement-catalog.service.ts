import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { MeasurementDefinition } from '../generated/prisma/client.js';
import { Prisma } from '../generated/prisma/client.js';
import { invalidInput } from './measurement-input.js';
import type {
  CreateMeasurementInput,
  FieldError,
} from './measurement-input.js';

@Injectable()
export class MeasurementCatalogService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async get(version?: string, age?: number) {
    const catalog = await this.database.measurementCatalog.findFirst({
      where: version === undefined ? undefined : { version },
      orderBy: [{ checkedOn: 'desc' }, { version: 'desc' }],
      include: { definitions: { orderBy: { code: 'asc' } } },
    });
    if (!catalog) {
      if (version !== undefined)
        throw new NotFoundException('검사 카탈로그를 찾을 수 없습니다.');
      throw new ServiceUnavailableException(
        '검사 카탈로그가 아직 준비되지 않았습니다.',
      );
    }
    if (catalog.definitions.length === 0)
      throw new ServiceUnavailableException(
        '검사 정의가 아직 준비되지 않았습니다.',
      );
    return {
      version: catalog.version,
      checkedOn: catalog.checkedOn.toISOString().slice(0, 10),
      age: age ?? null,
      definitions: catalog.definitions
        .filter(
          (def) =>
            age === undefined || (age >= def.minAge && age <= def.maxAge),
        )
        .map((def) => ({
          code: def.code,
          label: def.label,
          category: def.category,
          factor: def.factor,
          unit: def.unit,
          valueType: def.valueType,
          minAge: def.minAge,
          maxAge: def.maxAge,
          minValue: def.minValue?.toFixed() ?? null,
          minInclusive: def.minInclusive,
          maxValue: def.maxValue?.toFixed() ?? null,
          sourceUrls: def.sourceUrls,
        })),
    };
  }
}

export const SELF_ASSESSMENT_CODES = [
  'height',
  'weight',
  'bmi',
  'waist_circumference',
  'cross_sit_up',
  'self_curl_up',
  'ymca_recovery_heart_rate',
  'sit_and_reach',
] as const;

export function validateItems(
  input: Pick<CreateMeasurementInput, 'items' | 'ageAtMeasurement'> &
    Partial<Pick<CreateMeasurementInput, 'entryMethod'>>,
  definitions: MeasurementDefinition[],
) {
  const byCode = new Map(definitions.map((def) => [def.code, def]));
  const errors: FieldError[] = [];
  if (input.entryMethod === 'self_assessment' && input.ageAtMeasurement < 19)
    errors.push({
      field: 'ageAtMeasurement',
      message: '간이측정은 측정 당시 만 19~64세 성인에게만 제공됩니다.',
    });
  input.items.forEach((item, index) => {
    const field = `items.${index}`;
    if (
      input.entryMethod === 'self_assessment' &&
      !SELF_ASSESSMENT_CODES.some((code) => code === item.measurementCode)
    )
      errors.push({
        field: `${field}.measurementCode`,
        message: '간이측정에서 지원하지 않는 검사입니다.',
      });
    const def = byCode.get(item.measurementCode);
    if (!def) {
      errors.push({
        field: `${field}.measurementCode`,
        message: '이 카탈로그에서 지원하지 않는 검사입니다.',
      });
      return;
    }
    if (
      input.ageAtMeasurement < def.minAge ||
      input.ageAtMeasurement > def.maxAge
    )
      errors.push({
        field: `${field}.measurementCode`,
        message: `측정 당시 ${def.minAge}~${def.maxAge}세에게 적용되는 검사입니다.`,
      });
    errors.push(...definitionValueErrors(item, def, `${field}.`));
  });
  if (errors.length) invalidInput(errors);
}

// Shared by saving and extraction, including the catalog's JSON representation.
export function definitionValueErrors(
  item: { value: string; unit: string },
  def: Pick<MeasurementDefinition, 'unit' | 'valueType' | 'minInclusive'> & {
    minValue: Prisma.Decimal | string | null;
    maxValue: Prisma.Decimal | string | null;
  },
  prefix = '',
): FieldError[] {
  const errors: FieldError[] = [];
  if (item.unit !== def.unit)
    errors.push({
      field: `${prefix}unit`,
      message: `단위는 ${def.unit}이어야 합니다.`,
    });
  const value = new Prisma.Decimal(item.value);
  if (def.valueType === 'integer' && !value.isInteger())
    errors.push({
      field: `${prefix}value`,
      message: '횟수는 정수여야 합니다.',
    });
  if (
    def.minValue !== null &&
    (value.lessThan(def.minValue) ||
      (!def.minInclusive && value.equals(def.minValue)))
  )
    errors.push({
      field: `${prefix}value`,
      message: `${new Prisma.Decimal(def.minValue).toFixed()} ${def.minInclusive ? '이상' : '초과'}이어야 합니다.`,
    });
  if (def.maxValue !== null && value.greaterThan(def.maxValue))
    errors.push({
      field: `${prefix}value`,
      message: `${new Prisma.Decimal(def.maxValue).toFixed()} 이하여야 합니다.`,
    });
  return errors;
}
