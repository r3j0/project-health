import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service.js';
import type { Prisma } from '../src/generated/prisma/client.js';

describe('PostgreSQL measurement storage', () => {
  let database: DatabaseService;
  let userId: string;
  let catalogVersion: string;

  beforeAll(async () => {
    database = new DatabaseService(
      new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await database.onModuleInit();
    const catalog = await database.measurementCatalog.findFirstOrThrow({
      orderBy: [{ checkedOn: 'desc' }, { version: 'desc' }],
    });
    catalogVersion = catalog.version;
    userId = (
      await database.user.create({
        data: { email: `measurement-${randomUUID()}@example.test` },
      })
    ).id;
  });

  afterAll(async () => {
    if (userId) await database.user.delete({ where: { id: userId } });
    await database?.onModuleDestroy();
  });

  function create(
    items: Prisma.MeasurementItemUncheckedCreateWithoutMeasurementInput[],
    ageAtMeasurement = 25,
    extra: Partial<Prisma.MeasurementUncheckedCreateInput> = {},
  ) {
    return database.measurement.create({
      data: {
        userId,
        catalogVersion,
        measuredOn: new Date('2026-09-17T00:00:00Z'),
        ageAtMeasurement,
        items: { create: items },
        ...extra,
      },
      include: { items: true },
    });
  }

  it('loads sourced definitions for both age groups from committed migrations', async () => {
    const definitions = await database.measurementDefinition.findMany({
      where: { catalogVersion },
    });
    expect(catalogVersion).toBe('nfa100-2026-09-24-grip-v1');
    expect(definitions).toHaveLength(21);
    expect(definitions.map((item) => item.code)).not.toContain('self_curl_up');
    const retiredDefinitions = await database.measurementDefinition.findMany({
      where: { catalogVersion: 'nfa100-2026-09-23' },
    });
    expect(retiredDefinitions).toHaveLength(21);
    expect(retiredDefinitions.map((item) => item.code)).toContain(
      'self_curl_up',
    );
    expect(
      await database.measurementDefinition.count({
        where: { catalogVersion: 'nfa100-2026-09-19' },
      }),
    ).toBe(19);
    for (const [age, factorCount] of [
      [13, 8],
      [18, 8],
      [19, 7],
      [64, 7],
    ]) {
      const applicable = definitions.filter(
        (item) => age >= item.minAge && age <= item.maxAge,
      );
      expect(applicable).toHaveLength(age >= 19 ? 17 : 16);
      expect(new Set(applicable.map((item) => item.factor)).size).toBe(
        factorCount,
      );
    }
    expect(definitions.every((item) => item.sourceUrls.length > 0)).toBe(true);
    expect(await database.isReady()).toBe(true);
  });

  it('persists one actual item, preserving negative values and missing information', async () => {
    const created = await create([
      { code: 'sit_and_reach', value: '-3.25', unit: 'cm' },
    ]);
    const stored = await database.measurement.findUniqueOrThrow({
      where: { id: created.id },
      include: { items: true },
    });
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0].value.toString()).toBe('-3.25');
    expect(stored.sexAtMeasurement).toBeNull();
    expect(stored.reportedOverallGrade).toBeNull();
    expect(stored.measuredOn.toISOString()).toBe('2026-09-17T00:00:00.000Z');
    expect(stored.sourceProgram).toBe('nfa100');
    expect(stored.entryMethod).toBe('manual');
  });

  it('preserves actual zero, small decimals, and relative grip above 100 percent', async () => {
    const record = await create([
      { code: 'cross_sit_up', value: '0', unit: '회' },
      { code: 'reaction_time', value: '0.301234567890123456', unit: '초' },
      { code: 'relative_grip_strength', value: '105.25', unit: '%' },
    ]);
    const values = Object.fromEntries(
      record.items.map((item) => [item.code, item.value.toString()]),
    );
    expect(values).toEqual({
      cross_sit_up: '0',
      reaction_time: '0.301234567890123456',
      relative_grip_strength: '105.25',
    });
  });

  it('keeps alternative cardiopulmonary tests separate without calculating a score', async () => {
    const record = await create([
      { code: 'shuttle_run_20m', value: '42', unit: '회' },
      { code: 'treadmill_vo2max', value: '37.1', unit: 'ml/kg/min' },
      { code: 'step_test_vo2max', value: '36.4', unit: 'ml/kg/min' },
    ]);
    expect(record.items).toHaveLength(3);
    expect(new Set(record.items.map((item) => item.code)).size).toBe(3);
  });

  it('rejects empty records without leaving an orphan parent', async () => {
    const before = await database.measurement.count({ where: { userId } });
    await expect(create([])).rejects.toThrow();
    expect(await database.measurement.count({ where: { userId } })).toBe(
      before,
    );
  });

  it.each([
    ['wrong age', { code: 'repeated_jump', value: '20', unit: '회' }, 19],
    [
      'wrong unit',
      { code: 'relative_grip_strength', value: '32', unit: 'kg' },
      25,
    ],
    [
      'fractional count',
      { code: 'cross_sit_up', value: '1.5', unit: '회' },
      25,
    ],
    ['negative count', { code: 'curl_up', value: '-1', unit: '회' }, 18],
    [
      'invalid percentage',
      { code: 'body_fat_percentage', value: '101', unit: '%' },
      25,
    ],
    ['zero time', { code: 'reaction_time', value: '0', unit: '초' }, 25],
    ['non-finite value', { code: 'height', value: 'NaN', unit: 'cm' }, 25],
    [
      'unknown code',
      { code: 'unverified_measurement', value: '1', unit: '회' },
      25,
    ],
  ])('rejects %s at the database boundary', async (_name, item, age) => {
    await expect(create([item], age)).rejects.toThrow();
  });

  it('enforces age bounds, actual dates, and user ownership references', async () => {
    const items = [{ code: 'height', value: '165.2', unit: 'cm' }];
    for (const age of [12, 65])
      await expect(create(items, age)).rejects.toThrow();
    await expect(
      create(items, 25, { measuredOn: new Date('2999-01-01T00:00:00Z') }),
    ).rejects.toThrow();
    await expect(create(items, 25, { userId: randomUUID() })).rejects.toThrow();
  });

  it('rejects duplicate items and rolls back the entire record', async () => {
    const item = { code: 'height', value: '165.2', unit: 'cm' };
    const before = await database.measurement.count({ where: { userId } });
    await expect(create([item, item])).rejects.toThrow();
    expect(await database.measurement.count({ where: { userId } })).toBe(
      before,
    );
  });

  it('revalidates existing items after an age change', async () => {
    const record = await create(
      [{ code: 'repeated_jump', value: '20', unit: '회' }],
      18,
    );
    await expect(
      database.measurement.update({
        where: { id: record.id },
        data: { ageAtMeasurement: 19 },
      }),
    ).rejects.toThrow();
    expect(
      (
        await database.measurement.findUniqueOrThrow({
          where: { id: record.id },
        })
      ).ageAtMeasurement,
    ).toBe(18);
  });

  it('allows atomic item replacement while rejecting deletion of the last item', async () => {
    const record = await create([
      { code: 'height', value: '165.2', unit: 'cm' },
    ]);
    await expect(
      database.measurementItem.deleteMany({
        where: { measurementId: record.id },
      }),
    ).rejects.toThrow();
    await database.$transaction(async (tx) => {
      await tx.measurementItem.deleteMany({
        where: { measurementId: record.id },
      });
      await tx.measurementItem.create({
        data: {
          measurementId: record.id,
          catalogVersion,
          code: 'weight',
          value: '61.23',
          unit: 'kg',
        },
      });
      await tx.measurement.update({
        where: { id: record.id },
        data: { revision: { increment: 1 } },
      });
    });
    const stored = await database.measurement.findUniqueOrThrow({
      where: { id: record.id },
      include: { items: true },
    });
    expect(stored.revision).toBe(2);
    expect(stored.items.map((item) => item.code)).toEqual(['weight']);
  });

  it('does not allow concurrent deletions to leave an empty record', async () => {
    const record = await create([
      { code: 'height', value: '165.2', unit: 'cm' },
      { code: 'weight', value: '61.23', unit: 'kg' },
    ]);
    const deletions = await Promise.allSettled(
      record.items.map((item) =>
        database.measurementItem.delete({
          where: {
            measurementId_code: { measurementId: record.id, code: item.code },
          },
        }),
      ),
    );
    expect(
      deletions.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await database.measurementItem.count({
        where: { measurementId: record.id },
      }),
    ).toBe(1);
  });

  it('keeps two measurement sessions on the same date distinct', async () => {
    const first = await create([
      { code: 'height', value: '165.2', unit: 'cm' },
    ]);
    const second = await create([
      { code: 'height', value: '165.3', unit: 'cm' },
    ]);
    expect(first.id).not.toBe(second.id);
  });

  it('keeps published definitions immutable', async () => {
    await expect(
      database.measurementDefinition.update({
        where: { catalogVersion_code: { catalogVersion, code: 'height' } },
        data: { unit: 'm' },
      }),
    ).rejects.toThrow();
  });

  it('reports missing migrations as not ready', async () => {
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set(
      'schema',
      `missing_${randomUUID().replaceAll('-', '')}`,
    );
    const unmigrated = new DatabaseService(
      new ConfigService({ DATABASE_URL: url.toString() }),
    );
    try {
      expect(await unmigrated.isReady()).toBe(false);
    } finally {
      await unmigrated.onModuleDestroy();
    }
  });
});
