import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { configureApp } from '../src/setup-app.js';

type Account = { user: { id: string }; access_token: string };
type Goal = {
  id: string;
  catalogVersion: string;
  measurementCode: string;
  value: string;
  unit: string;
  createdAt: string;
  updatedAt: string;
};
const version = 'nfa100-2026-09-19';
const base = '/api/v1/users/me/fitness-goals';
const payload = (extra: Record<string, unknown> = {}) => ({
  catalogVersion: version,
  measurementCode: 'reaction_time',
  value: '0.3012345678901234567890123456789',
  unit: '초',
  ...extra,
});

describe('Owned fitness goal CRUD and constraints', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let owner: Account;
  let other: Account;
  const ids: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    database = app.get(DatabaseService);
    for (let i = 0; i < 2; i++) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('X-CSRF-Protection', '1')
        .send({
          email: `goal-${randomUUID()}@example.test`,
          password: 'fitness goal integration password',
        })
        .expect(201);
      const account = response.body as Account;
      ids.push(account.user.id);
      if (i === 0) owner = account;
      else other = account;
    }
  });
  beforeEach(async () => {
    await database.userFitnessGoal.deleteMany({
      where: { userId: { in: ids } },
    });
  });
  afterAll(async () => {
    await database?.user.deleteMany({ where: { id: { in: ids } } });
    await app?.close();
  });
  const create = (body = payload(), account = owner) =>
    request(app.getHttpServer())
      .post(base)
      .set('Authorization', `Bearer ${account.access_token}`)
      .send(body);
  const get = (id = '', account = owner) =>
    request(app.getHttpServer())
      .get(`${base}${id ? `/${id}` : ''}`)
      .set('Authorization', `Bearer ${account.access_token}`);
  const patch = (id: string, body: unknown, account = owner) =>
    request(app.getHttpServer())
      .patch(`${base}/${id}`)
      .set('Authorization', `Bearer ${account.access_token}`)
      .send(body as object);
  const remove = (id: string, account = owner) =>
    request(app.getHttpServer())
      .delete(`${base}/${id}`)
      .set('Authorization', `Bearer ${account.access_token}`);

  it('preserves decimal precision throughout CRUD without creating actual measurements or onboarding', async () => {
    await get().expect(200, { items: [] });
    const created = await create().expect(201);
    const goal = created.body as Goal;
    expect(created.headers.location).toBe(`${base}/${goal.id}`);
    expect(created.headers['cache-control']).toBe('no-store');
    expect(goal.value).toBe(payload().value);
    await get(goal.id).expect(200, goal);
    await get().expect(200, { items: [goal] });
    const updated = (
      await patch(goal.id, { value: '0.201234567890123456789' }).expect(200)
    ).body as Goal;
    expect(updated).toMatchObject({
      ...goal,
      value: '0.201234567890123456789',
      updatedAt: updated.updatedAt,
    });
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${owner.access_token}`)
      .expect(200);
    expect(me.body).toMatchObject({
      isOnboarded: false,
      currentFitness: null,
      fitnessGoals: [updated],
    });
    expect(
      await database.measurement.count({ where: { userId: owner.user.id } }),
    ).toBe(0);
    await remove(goal.id).expect(204);
    await get(goal.id).expect(404);
    await remove(goal.id).expect(404);
    await get().expect(200, { items: [] });
  });

  it('blocks cross-user read/update/delete and ignores no submitted owner', async () => {
    const goal = (await create()).body as Goal;
    const absent = await get(randomUUID(), other).expect(404);
    expect((await get(goal.id, other).expect(404)).body).toEqual(absent.body);
    await patch(goal.id, { value: '1' }, other).expect(404);
    await remove(goal.id, other).expect(404);
    await create(payload({ userId: other.user.id })).expect(400);
    await get('', other).expect(200, { items: [] });
    await get(goal.id).expect(200, goal);
    for (const [method, path] of [
      ['get', base],
      ['post', base],
      ['get', `${base}/${goal.id}`],
      ['patch', `${base}/${goal.id}`],
      ['delete', `${base}/${goal.id}`],
    ] as const)
      await request(app.getHttpServer())[method](path).expect(401);
    await get('not-a-uuid').expect(400);
  });

  it('keeps only one current goal per item, including concurrent creation and another catalog version', async () => {
    const responses = await Promise.all([create(), create()]);
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([201, 409]);
    await create(payload(), other).expect(201);
    const nextVersion = `test-goal-${randomUUID()}`;
    const definition = await database.measurementDefinition.findUniqueOrThrow({
      where: {
        catalogVersion_code: { catalogVersion: version, code: 'reaction_time' },
      },
    });
    await database.measurementCatalog.create({
      data: {
        version: nextVersion,
        checkedOn: new Date('2026-09-18'),
        definitions: {
          create: {
            code: definition.code,
            label: definition.label,
            category: definition.category,
            factor: definition.factor,
            unit: definition.unit,
            valueType: definition.valueType,
            minAge: definition.minAge,
            maxAge: definition.maxAge,
            minValue: definition.minValue,
            minInclusive: definition.minInclusive,
            sourceUrls: definition.sourceUrls,
          },
        },
      },
    });
    await create(payload({ catalogVersion: nextVersion })).expect(409);
    expect(
      await database.userFitnessGoal.count({
        where: { userId: owner.user.id },
      }),
    ).toBe(1);
  });

  it.each([
    { value: 0.3 },
    { value: '' },
    { value: 'NaN' },
    { value: 'Infinity' },
    { value: '1e-3' },
    { value: '0' },
    { value: '-1' },
    { value: ' 1' },
    { value: '1'.repeat(129) },
    { unit: 'cm' },
    { catalogVersion: 'missing' },
    { measurementCode: 'unknown' },
    { measurementCode: 'cross_sit_up', value: '1.5', unit: '회' },
    { measurementCode: 'cross_sit_up', value: '-1', unit: '회' },
    { measurementCode: 'body_fat_percentage', value: '101', unit: '%' },
    { reportedGrade: '1' },
  ])(
    'rejects invalid goal values without partial storage: %j',
    async (extra) => {
      const response = await create(payload(extra)).expect(400);
      expect(response.body).toHaveProperty('errors');
      await get().expect(200, { items: [] });
    },
  );

  it('accepts meaningful zero, signed flexibility and high precision but not empty/unknown PATCH fields', async () => {
    for (const [measurementCode, value, unit] of [
      ['cross_sit_up', '0.00', '회'],
      ['sit_and_reach', '-2.1234567890123456789', 'cm'],
      ['relative_grip_strength', '105.50', '%'],
    ])
      await create(payload({ measurementCode, value, unit })).expect(201);
    const goal = (await create()).body as Goal;
    for (const body of [
      {},
      { value: '0' },
      { unit: 'kg' },
      { catalogVersion: version },
      { measurementCode: 'height' },
      { userId: other.user.id },
      { createdAt: '2026-09-21' },
    ])
      await patch(goal.id, body).expect(400);
    await get(goal.id).expect(200, goal);
    // No current age is stored: goals do not invent an age from past measurements.
    await create(
      payload({ measurementCode: 'repeated_jump', value: '10', unit: '회' }),
    ).expect(201);
  });

  it('enforces unit, FK, finite-value, integer and range rules at the DB boundary', async () => {
    const data = {
      userId: owner.user.id,
      catalogVersion: version,
      code: 'reaction_time',
      value: '0.3',
      unit: '초',
    };
    for (const extra of [
      { userId: randomUUID() },
      { catalogVersion: 'missing' },
      { unit: 'cm' },
      { value: '0' },
      { value: 'NaN' },
      { value: 'Infinity' },
      { code: 'cross_sit_up', unit: '회', value: '0.5' },
      { code: 'body_fat_percentage', unit: '%', value: '101' },
    ])
      await expect(
        database.userFitnessGoal.create({ data: { ...data, ...extra } }),
      ).rejects.toThrow();
    const goal = await database.userFitnessGoal.create({ data });
    await expect(database.userFitnessGoal.create({ data })).rejects.toThrow();
    await expect(
      database.userFitnessGoal.update({
        where: { id: goal.id },
        data: { value: '-1' },
      }),
    ).rejects.toThrow();
  });

  it('serializes concurrent partial patches and deletion without resurrecting goals', async () => {
    const goal = (await create()).body as Goal;
    const updates = await Promise.all([
      patch(goal.id, { value: '0.1234567890123456789' }),
      patch(goal.id, { unit: '초' }),
    ]);
    expect(updates.map((response) => response.status)).toEqual([200, 200]);
    expect(((await get(goal.id)).body as Goal).value).toBe(
      '0.1234567890123456789',
    );
    const [updated, deleted] = await Promise.all([
      patch(goal.id, { value: '0.2' }),
      remove(goal.id),
    ]);
    expect(deleted.status).toBe(204);
    expect([200, 404]).toContain(updated.status);
    await get(goal.id).expect(404);
  });
});
