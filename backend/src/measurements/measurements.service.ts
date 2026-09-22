import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { MeasurementCreateRequest } from '../generated/prisma/client.js';
import { validateItems } from './measurement-catalog.service.js';
import {
  decodeCursor,
  encodeCursor,
  invalidInput,
} from './measurement-input.js';
import type {
  CreateMeasurementInput,
  PatchMeasurementInput,
  parseListQuery,
} from './measurement-input.js';

const includeRecord = {
  items: { orderBy: { code: 'asc' } },
  catalog: { include: { definitions: { orderBy: { code: 'asc' } } } },
} satisfies Prisma.MeasurementInclude;
type RecordWithItems = Prisma.MeasurementGetPayload<{
  include: typeof includeRecord;
}>;

const summarySelect = {
  id: true,
  measuredOn: true,
  ageAtMeasurement: true,
  sexAtMeasurement: true,
  reportKind: true,
  centerName: true,
  reportedOverallGrade: true,
  sourceProgram: true,
  entryMethod: true,
  catalogVersion: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { items: true } },
} satisfies Prisma.MeasurementSelect;

const storedItems = (items: CreateMeasurementInput['items']) =>
  items.map((item) => ({
    code: item.measurementCode,
    value: item.value,
    unit: item.unit,
    reportedGrade: item.reportedGrade,
  }));

export function serializeRecord(record: RecordWithItems) {
  const entered = new Set(record.items.map((item) => item.code));
  return {
    id: record.id,
    measuredOn: record.measuredOn.toISOString().slice(0, 10),
    ageAtMeasurement: record.ageAtMeasurement,
    sexAtMeasurement: record.sexAtMeasurement,
    reportKind: record.reportKind,
    centerName: record.centerName,
    reportedOverallGrade: record.reportedOverallGrade,
    sourceProgram: record.sourceProgram,
    entryMethod: record.entryMethod,
    catalogVersion: record.catalogVersion,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    items: record.items.map((item) => ({
      measurementCode: item.code,
      value: item.value.toFixed(),
      unit: item.unit,
      reportedGrade: item.reportedGrade,
    })),
    missingMeasurementCodes: record.catalog.definitions
      .filter(
        (def) =>
          record.ageAtMeasurement >= def.minAge &&
          record.ageAtMeasurement <= def.maxAge &&
          !entered.has(def.code),
      )
      .map((def) => def.code),
    // No evaluation engine/rules have been implemented. This reports capability,
    // never a fabricated score or certification result.
    evaluation: {
      status: 'not_evaluated',
      reason: 'evaluation_not_implemented',
    },
  };
}

@Injectable()
export class MeasurementsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async create(userId: string, key: string, input: CreateMeasurementInput) {
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          ...input,
          items: [...input.items].sort((a, b) =>
            a.measurementCode.localeCompare(b.measurementCode),
          ),
        }),
      )
      .digest('hex');
    const requestWhere = { userId_key: { userId, key } };
    const existing = await this.database.measurementCreateRequest.findUnique({
      where: requestWhere,
    });
    if (existing) return this.replay(existing, requestHash);

    try {
      const record = await this.database.$transaction(async (tx) => {
        // Reserving the unique key in the same transaction handles retries
        // across multiple API instances, including simultaneous requests.
        await tx.measurementCreateRequest.create({
          data: { userId, key, requestHash },
        });
        const catalog = await tx.measurementCatalog.findUnique({
          where: { version: input.catalogVersion },
          include: { definitions: true },
        });
        if (!catalog)
          invalidInput([
            {
              field: 'catalogVersion',
              message: '지원하는 검사 카탈로그 버전을 선택해 주세요.',
            },
          ]);
        validateItems(input, catalog.definitions);
        const { items, ...metadata } = input;
        const created = await tx.measurement.create({
          data: {
            ...metadata,
            userId,
            measuredOn: new Date(`${input.measuredOn}T00:00:00.000Z`),
            sourceProgram: 'nfa100',
            entryMethod: 'manual',
            items: { create: storedItems(items) },
          },
          include: includeRecord,
        });
        await tx.measurementCreateRequest.update({
          where: requestWhere,
          data: { measurementId: created.id },
        });
        return created;
      });
      return { record: serializeRecord(record), replayed: false };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const committed =
          await this.database.measurementCreateRequest.findUnique({
            where: requestWhere,
          });
        if (committed) return this.replay(committed, requestHash);
      }
      throw error;
    }
  }

  async list(userId: string, query: ReturnType<typeof parseListQuery>) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const measuredOn: Prisma.DateTimeFilter<'Measurement'> = {};
    if (query.from) measuredOn.gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) measuredOn.lte = new Date(`${query.to}T00:00:00.000Z`);
    const cursorDate = cursor
      ? new Date(`${cursor.measuredOn}T00:00:00.000Z`)
      : null;
    const rows = await this.database.measurement.findMany({
      where: {
        userId,
        measuredOn,
        ...(cursor && cursorDate
          ? {
              OR: [
                { measuredOn: { lt: cursorDate } },
                { measuredOn: cursorDate, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ measuredOn: 'desc' }, { id: 'asc' }],
      take: query.limit + 1,
      select: summarySelect,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(({ _count, measuredOn, ...row }) => ({
        ...row,
        measuredOn: measuredOn.toISOString().slice(0, 10),
        itemCount: _count.items,
      })),
      nextCursor:
        rows.length > query.limit ? encodeCursor(page[page.length - 1]) : null,
    };
  }

  async get(userId: string, id: string) {
    const record = await this.readSnapshot(userId, id);
    if (!record) throw this.notFound();
    return serializeRecord(record);
  }

  async patch(
    userId: string,
    id: string,
    revision: number,
    patch: PatchMeasurementInput,
  ) {
    const record = await this.database.$transaction(async (tx) => {
      const existing = await tx.measurement.findFirst({
        where: { id, userId },
        select: { revision: true },
      });
      if (!existing) throw this.notFound();
      if (existing.revision !== revision) throw this.staleRevision();
      if (revision === 2147483647)
        throw new ConflictException('기록의 수정 버전 한도에 도달했습니다.');
      const { items: replacement, measuredOn, ...metadata } = patch;
      // Claim the revision and lock the parent before reading related items.
      // Concurrent writes are rejected before validation; invalid input rolls
      // back this metadata/revision update along with the rest of the transaction.
      const changed = await tx.measurement.updateMany({
        where: { id, userId, revision },
        data: {
          ...metadata,
          ...(measuredOn === undefined
            ? {}
            : { measuredOn: new Date(`${measuredOn}T00:00:00.000Z`) }),
          revision: { increment: 1 },
        },
      });
      if (!changed.count) await this.rejectConcurrentChange(tx, userId, id);
      const current = await tx.measurement.findFirstOrThrow({
        where: { id, userId },
        include: includeRecord,
      });
      const items =
        replacement ??
        current.items.map((item) => ({
          measurementCode: item.code,
          value: item.value.toFixed(),
          unit: item.unit,
          reportedGrade: item.reportedGrade,
        }));
      validateItems(
        { ageAtMeasurement: current.ageAtMeasurement, items },
        current.catalog.definitions,
      );
      if (replacement === undefined) return current;
      await tx.measurementItem.deleteMany({ where: { measurementId: id } });
      await tx.measurementItem.createMany({
        data: storedItems(replacement).map((item) => ({
          ...item,
          measurementId: id,
          catalogVersion: current.catalogVersion,
        })),
      });
      return tx.measurement.findFirstOrThrow({
        where: { id, userId },
        include: includeRecord,
      });
    });
    return serializeRecord(record);
  }

  async delete(userId: string, id: string, revision: number) {
    await this.database.$transaction(async (tx) => {
      const current = await tx.measurement.findFirst({
        where: { id, userId },
        select: { revision: true },
      });
      if (!current) throw this.notFound();
      if (current.revision !== revision) throw this.staleRevision();
      const deleted = await tx.measurement.deleteMany({
        where: { id, userId, revision },
      });
      if (!deleted.count) await this.rejectConcurrentChange(tx, userId, id);
    });
  }

  private async replay(request: MeasurementCreateRequest, requestHash: string) {
    if (request.requestHash !== requestHash)
      throw new ConflictException(
        '같은 Idempotency-Key에 다른 입력을 사용할 수 없습니다.',
      );
    if (!request.measurementId)
      throw new GoneException('이 요청으로 생성한 기록은 이미 삭제되었습니다.');
    const record = await this.readSnapshot(
      request.userId,
      request.measurementId,
    );
    if (!record)
      throw new GoneException('이 요청으로 생성한 기록은 이미 삭제되었습니다.');
    return { record: serializeRecord(record), replayed: true };
  }

  private readSnapshot(userId: string, id: string) {
    // Prisma loads included relations with separate SELECTs. Read Committed
    // could mix a previous revision with items changed or deleted in between.
    return this.database.$transaction(
      (tx) =>
        tx.measurement.findFirst({
          where: { id, userId },
          include: includeRecord,
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async rejectConcurrentChange(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
  ): Promise<never> {
    if (
      !(await tx.measurement.findFirst({
        where: { id, userId },
        select: { id: true },
      }))
    )
      throw this.notFound();
    throw this.staleRevision();
  }

  private notFound() {
    return new NotFoundException('측정 기록을 찾을 수 없습니다.');
  }
  private staleRevision() {
    return new PreconditionFailedException(
      '기록이 변경되었습니다. 최신 기록을 조회한 뒤 다시 시도해 주세요.',
    );
  }
}
