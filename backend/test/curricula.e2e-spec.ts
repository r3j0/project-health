import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CurriculaService } from '../src/curricula/curricula.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { UserProfileService } from '../src/users/user-profile.service.js';

describe('One-workout assignment state against PostgreSQL', () => {
  let database: DatabaseService;
  let service: CurriculaService;
  let profiles: UserProfileService;
  let owner: string;
  let other: string;
  let definition: string;
  let otherDefinition: string;

  beforeAll(async () => {
    database = new DatabaseService(
      new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await database.onModuleInit();
    service = new CurriculaService(database);
    profiles = new UserProfileService(database);
    owner = (
      await database.user.create({
        data: {
          email: `curriculum-${randomUUID()}@example.test`,
          currency: { create: {} },
        },
      })
    ).id;
    other = (
      await database.user.create({
        data: {
          email: `curriculum-${randomUUID()}@example.test`,
          currency: { create: {} },
        },
      })
    ).id;
    definition = (
      await database.workoutCurriculum.create({
        data: { name: '[TEST ONLY] workout A' },
      })
    ).id;
    otherDefinition = (
      await database.workoutCurriculum.create({
        data: { name: '[TEST ONLY] workout B' },
      })
    ).id;
  });
  beforeEach(async () => {
    await database.userCurriculumAssignment.deleteMany({
      where: { userId: { in: [owner, other] } },
    });
  });
  afterAll(async () => {
    await database?.user.deleteMany({ where: { id: { in: [owner, other] } } });
    await database?.workoutCurriculum.deleteMany({
      where: { id: { in: [definition, otherDefinition] } },
    });
    await database?.onModuleDestroy();
  });

  it('keeps unassigned reads empty and requires an existing definition', async () => {
    expect(await service.current(owner)).toBeNull();
    expect((await profiles.get(owner)).currentCurriculum).toBeNull();
    expect(await service.history(owner)).toEqual({
      items: [],
      nextCursor: null,
    });
    await expect(
      service.assign(owner, randomUUID(), randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await service.current(owner)).toBeNull();
    expect(
      await database.workoutCurriculum.count({
        where: { id: { in: [definition, otherDefinition] } },
      }),
    ).toBe(2);
  });

  it('retains completed current assignment until an explicit next request and preserves all history', async () => {
    const key = randomUUID();
    const first = await service.assign(owner, definition, key);
    expect(first.status).toBe('assigned');
    expect(first.completedAt).toBeNull();
    expect((await profiles.get(owner)).currentCurriculum).toEqual(first);
    await expect(
      service.assign(owner, otherDefinition, randomUUID()),
    ).rejects.toBeInstanceOf(ConflictException);
    const completed = await service.complete(owner, first.id);
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).not.toBeNull();
    expect(await service.current(owner)).toEqual(completed);
    expect(await service.complete(owner, first.id)).toEqual(completed);
    expect(
      await database.userCurriculumAssignment.count({
        where: { userId: owner },
      }),
    ).toBe(1);
    const next = await service.assign(owner, otherDefinition, randomUUID());
    expect(next.id).not.toBe(first.id);
    expect(await service.current(owner)).toEqual(next);
    expect(await service.assign(owner, definition, key)).toEqual(completed);
    expect(await service.complete(owner, first.id)).toEqual(completed);
    expect(await service.current(owner)).toEqual(next);
    expect((await service.history(owner)).items).toEqual([next, completed]);
    const page = await service.history(owner, 1);
    expect(page.items).toEqual([next]);
    expect(page.nextCursor).toBe(next.id);
    expect(await service.history(owner, 1, page.nextCursor!)).toEqual({
      items: [completed],
      nextCursor: null,
    });
  });

  it('hides other owners assignments and rejects mismatched current ownership and missing foreign keys', async () => {
    const first = await service.assign(owner, definition, randomUUID());
    await expect(service.complete(other, first.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.history(other, 1, first.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await service.current(other)).toBeNull();
    const data = {
      userId: owner,
      curriculumId: definition,
      requestKey: randomUUID(),
      currentForUserId: owner,
    };
    for (const extra of [
      { currentForUserId: other },
      { currentForUserId: null },
      { curriculumId: randomUUID() },
      { userId: randomUUID(), currentForUserId: null },
    ])
      await expect(
        database.userCurriculumAssignment.create({
          data: { ...data, ...extra },
        }),
      ).rejects.toThrow();
    await expect(
      database.userCurriculumAssignment.create({ data }),
    ).rejects.toThrow();
    await expect(
      database.userCurriculumAssignment.update({
        where: { id: first.id },
        data: { userId: other, currentForUserId: other },
      }),
    ).rejects.toThrow();
  });

  it('deduplicates concurrent assignment retries and rejects different payloads for a reserved key', async () => {
    const key = randomUUID();
    const [first, second] = await Promise.all([
      service.assign(owner, definition, key),
      service.assign(owner, definition, key),
    ]);
    expect(first).toEqual(second);
    expect(
      await database.userCurriculumAssignment.count({
        where: { userId: owner },
      }),
    ).toBe(1);
    await expect(
      service.assign(owner, otherDefinition, key),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await service.assign(other, definition, key)).id).not.toBe(
      first.id,
    );
  });

  it('allows only one distinct concurrent assignment and one stable completion time', async () => {
    const assigned = await Promise.allSettled([
      service.assign(owner, definition, randomUUID()),
      service.assign(owner, otherDefinition, randomUUID()),
    ]);
    expect(
      assigned.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      assigned.find((result) => result.status === 'rejected'),
    ).toMatchObject({ reason: expect.any(ConflictException) });
    const current = (await service.current(owner))!;
    const completed = await Promise.all([
      service.complete(owner, current.id),
      service.complete(owner, current.id),
    ]);
    expect(completed[0]).toEqual(completed[1]);
    const next = await Promise.allSettled([
      service.assign(owner, definition, randomUUID()),
      service.assign(owner, otherDefinition, randomUUID()),
    ]);
    expect(next.filter((result) => result.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect((await service.history(owner)).items).toHaveLength(2);
  });

  it('handles overlapping completion/next-assignment and prevents reopening or overwriting completed history', async () => {
    const first = await service.assign(owner, definition, randomUUID());
    const [completion, next] = await Promise.allSettled([
      service.complete(owner, first.id),
      service.assign(owner, otherDefinition, randomUUID()),
    ]);
    expect(completion.status).toBe('fulfilled');
    if (next.status === 'rejected')
      expect(next.reason).toBeInstanceOf(ConflictException);
    const completed = await service.complete(owner, first.id);
    for (const data of [
      { status: 'assigned' as const, completedAt: null },
      { curriculumId: otherDefinition },
      { completedAt: new Date() },
    ])
      await expect(
        database.userCurriculumAssignment.update({
          where: { id: first.id },
          data,
        }),
      ).rejects.toThrow();
    await expect(
      database.workoutCurriculum.update({
        where: { id: definition },
        data: { name: 'changed' },
      }),
    ).rejects.toThrow();
    await expect(
      database.workoutCurriculum.delete({ where: { id: definition } }),
    ).rejects.toThrow();
    expect(await service.complete(owner, first.id)).toEqual(completed);
  });

  it('preserves the previous current marker when a requested definition is missing', async () => {
    const first = await service.assign(owner, definition, randomUUID());
    await service.complete(owner, first.id);
    await expect(
      service.assign(owner, randomUUID(), randomUUID()),
    ).rejects.toThrow();
    expect((await service.current(owner))?.id).toBe(first.id);
    expect((await service.history(owner)).items).toHaveLength(1);
  });
});
