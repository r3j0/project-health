import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import type {
  AxisEvaluation,
  ItemEvaluation,
} from '../src/measurements/evaluation/evaluation-types.js';
import { configureApp } from '../src/setup-app.js';

type Account = { user: { id: string }; access_token: string };
type Measurement = {
  id: string;
  measuredOn: string;
  ageAtMeasurement: number;
  sexAtMeasurement: string | null;
  entryMethod: string;
  sourceProgram: string;
  revision: number;
  missingMeasurementCodes: string[];
  items: Array<{
    measurementCode: string;
    value: string;
    unit: string;
    reportedGrade: string | null;
    evaluation: ItemEvaluation;
  }>;
  axes: AxisEvaluation[];
  evaluation: { status: string; reason: string };
};
type Polygon = {
  measurementId: string | null;
  measuredOn: string | null;
  revision: number | null;
  axes: AxisEvaluation[];
};
const version = 'nfa100-2026-09-24';
const retiredVersion = 'nfa100-2026-09-23';
const axisOrder = [
  'cardiorespiratory_endurance',
  'strength',
  'muscular_endurance',
  'flexibility',
  'agility',
  'power',
];

describe('Stored measurement evaluation and latest polygon against PostgreSQL', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let owner: Account;
  let other: Account;
  const userIds: string[] = [];
  const curriculumIds: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    database = app.get(DatabaseService);
    owner = await register();
    other = await register();
  });

  beforeEach(async () => {
    await database.measurementCreateRequest.deleteMany({
      where: { userId: { in: userIds } },
    });
    await database.measurement.deleteMany({
      where: { userId: { in: userIds } },
    });
  });

  afterAll(async () => {
    await database?.user.deleteMany({ where: { id: { in: userIds } } });
    await database?.workoutCurriculum.deleteMany({
      where: { id: { in: curriculumIds } },
    });
    await app?.close();
  });

  async function register() {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('X-CSRF-Protection', '1')
      .send({
        email: `evaluation-${randomUUID()}@example.test`,
        password: 'measurement evaluation integration password',
      })
      .expect(201);
    const account = response.body as Account;
    userIds.push(account.user.id);
    return account;
  }

  function payload(extra: Record<string, unknown> = {}) {
    return {
      catalogVersion: version,
      measuredOn: '2026-09-17',
      ageAtMeasurement: 19,
      sexAtMeasurement: 'male',
      entryMethod: 'self_assessment',
      items: [{ measurementCode: 'cross_sit_up', value: '48', unit: '회' }],
      ...extra,
    };
  }
  const create = (
    body: Record<string, unknown> = payload(),
    key = randomUUID(),
    account = owner,
  ) =>
    request(app.getHttpServer())
      .post('/api/v1/measurements')
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('Idempotency-Key', key)
      .send(body);
  const detail = (id: string, account = owner) =>
    request(app.getHttpServer())
      .get(`/api/v1/measurements/${id}`)
      .set('Authorization', `Bearer ${account.access_token}`);
  const latest = (account = owner) =>
    request(app.getHttpServer())
      .get('/api/v1/measurements/latest-polygon')
      .set('Authorization', `Bearer ${account.access_token}`);
  const patch = (
    id: string,
    body: Record<string, unknown>,
    revision = 1,
    account = owner,
  ) =>
    request(app.getHttpServer())
      .patch(`/api/v1/measurements/${id}`)
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('If-Match', `"${revision}"`)
      .send(body);
  const remove = (id: string, revision = 1, account = owner) =>
    request(app.getHttpServer())
      .delete(`/api/v1/measurements/${id}`)
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('If-Match', `"${revision}"`);
  const profile = () =>
    request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${owner.access_token}`);

  async function seedRetiredMeasurement() {
    const id = randomUUID();
    // A frozen pre-retirement snapshot, independent of the current evaluator.
    const evaluation: ItemEvaluation = {
      measurementId: id,
      measurementCode: 'self_curl_up',
      grade: null,
      status: 'criteria_unavailable',
      reasonCode: 'self_curl_up_criteria_unverified',
      message:
        '성인 자가측정용 윗몸말아올리기의 공식 등급 기준을 확인하지 못했습니다. 교차윗몸일으키기 기준을 대신 적용하지 않습니다.',
      ageAtMeasurement: 19,
      ageBand: null,
      sex: 'male',
      criterion: null,
      thresholds: [],
      nextTarget: {
        status: 'unavailable',
        grade: null,
        intervals: [],
        adjustments: [],
        reasonCode: 'self_curl_up_criteria_unverified',
      },
      evaluatedAt: '2026-09-23T00:00:00.000Z',
      recordRevision: 1,
    };
    await database.measurement.create({
      data: {
        id,
        userId: owner.user.id,
        catalogVersion: retiredVersion,
        entryMethod: 'self_assessment',
        measuredOn: new Date('2026-09-17T00:00:00Z'),
        ageAtMeasurement: 19,
        sexAtMeasurement: 'male',
        items: {
          create: [
            {
              code: 'self_curl_up',
              value: '0',
              unit: '회',
              evaluation: evaluation as Prisma.InputJsonValue,
            },
          ],
        },
      },
    });
    return { id, evaluation };
  }

  it('stores step estimates, replays snapshots and re-evaluates same-record inputs atomically', async () => {
    const key = randomUUID();
    const pulse = {
      measurementCode: 'ymca_recovery_heart_rate',
      value: '90',
      unit: 'bpm',
    };
    const height = { measurementCode: 'height', value: '170', unit: 'cm' };
    const weight = { measurementCode: 'weight', value: '65', unit: 'kg' };
    const body = payload({
      ageAtMeasurement: 25,
      items: [pulse, height, weight],
    });
    const original = (await create(body, key).expect(201)).body as Measurement;
    const step = (r: Measurement) =>
      r.items.find((i) => i.measurementCode === pulse.measurementCode)!;
    expect(step(original)).toMatchObject({
      ...pulse,
      evaluation: {
        grade: 1,
        conversion: { value: '49.877', assessmentKind: 'reference' },
      },
    });
    await create(body, key).expect(200, original);
    await detail(original.id).expect(200, original);
    expect(((await latest().expect(200)).body as Polygon).axes[0].grade).toBe(
      1,
    );
    const changed = (
      await patch(original.id, {
        items: [pulse, height, { ...weight, value: '100' }],
      }).expect(200)
    ).body as Measurement;
    expect(step(changed).evaluation).toMatchObject({
      recordRevision: 2,
      grade: 3,
      conversion: { value: '42.107' },
    });
    expect(((await latest().expect(200)).body as Polygon).axes[0].grade).toBe(
      3,
    );
    await patch(original.id, { sexAtMeasurement: 'female' }, 1).expect(412);
    await detail(original.id, other).expect(404);
    const incomplete = (
      await patch(original.id, { items: [pulse, weight] }, 2).expect(200)
    ).body as Measurement;
    expect(step(incomplete).evaluation).toMatchObject({
      status: 'insufficient_information',
      reasonCode: 'height_at_measurement_missing',
    });
    expect(step(incomplete).evaluation.conversion).toBeUndefined();
    const restored = (
      await patch(
        original.id,
        { items: [pulse, height, weight], sexAtMeasurement: 'female' },
        3,
      ).expect(200)
    ).body as Measurement;
    expect(step(restored).evaluation).toMatchObject({
      grade: 1,
      conversion: { value: '39.232', sexAtMeasurement: 'female' },
    });
    const newAge = (
      await patch(original.id, { ageAtMeasurement: 30 }, 4).expect(200)
    ).body as Measurement;
    expect(step(newAge).evaluation.conversion).toMatchObject({
      value: '38.307',
      ageAtMeasurement: 30,
    });
    const noSex = (
      await patch(original.id, { sexAtMeasurement: null }, 5).expect(200)
    ).body as Measurement;
    expect(step(noSex).evaluation.status).toBe('insufficient_information');
    await remove(original.id, 6).expect(204);
  });

  it('does not recalculate a historical YMCA snapshot during reads or idempotent replay', async () => {
    const key = randomUUID();
    const body = payload({
      items: [
        {
          measurementCode: 'ymca_recovery_heart_rate',
          value: '90',
          unit: 'bpm',
        },
        { measurementCode: 'height', value: '170', unit: 'cm' },
        { measurementCode: 'weight', value: '65', unit: 'kg' },
      ],
    });
    const record = (await create(body, key).expect(201)).body as Measurement;
    const saved = record.items.find(
      (item) => item.measurementCode === 'ymca_recovery_heart_rate',
    )!.evaluation;
    const historical = {
      ...saved,
      grade: null,
      status: 'criteria_unavailable',
      criterion: null,
      thresholds: [],
      ageBand: null,
      conversion: undefined,
      reasonCode: 'ymca_bpm_criteria_unverified',
      message: '이전 버전에서 평가하지 않은 기록입니다.',
      nextTarget: {
        status: 'unavailable',
        grade: null,
        intervals: [],
        adjustments: [],
        reasonCode: 'ymca_bpm_criteria_unverified',
      },
    };
    const snapshot = JSON.parse(
      JSON.stringify(historical),
    ) as Prisma.InputJsonValue;
    await database.measurementItem.update({
      where: {
        measurementId_code: {
          measurementId: record.id,
          code: 'ymca_recovery_heart_rate',
        },
      },
      data: { evaluation: snapshot },
    });
    for (const response of [
      await detail(record.id).expect(200),
      await create(body, key).expect(200),
    ]) {
      const current = response.body as Measurement;
      expect(
        current.items.find(
          (item) => item.measurementCode === 'ymca_recovery_heart_rate',
        )!.evaluation,
      ).toEqual(snapshot);
      expect(current.axes[0].status).toBe('unevaluable');
    }
  });

  it('stores absolute grip unchanged and re-evaluates same-record weight atomically', async () => {
    const key = randomUUID();
    const body = payload({
      catalogVersion: 'nfa100-2026-09-24-grip-v1',
      entryMethod: 'manual',
      ageAtMeasurement: 25,
      items: [
        { measurementCode: 'absolute_grip_strength', value: '30', unit: 'kg' },
        { measurementCode: 'weight', value: '50', unit: 'kg' },
      ],
    });
    const response = await create(body, key).expect(201);
    const record = response.body as Measurement;
    const findGrip = (value: Measurement) =>
      value.items.find((i) => i.measurementCode === 'absolute_grip_strength')!;
    expect(findGrip(record)).toMatchObject({
      value: '30',
      unit: 'kg',
      evaluation: {
        status: 'graded',
        conversion: { value: '60' },
        criterion: { measurementCode: 'relative_grip_strength', unit: '%' },
      },
    });
    expect((await detail(record.id).expect(200)).body).toEqual(record);
    const replay = await create(body, key).expect(200);
    expect(replay.body).toEqual(record);
    await patch(record.id, {
      items: [
        { measurementCode: 'absolute_grip_strength', value: '30', unit: 'kg' },
        { measurementCode: 'weight', value: '100', unit: 'kg' },
      ],
    }).expect(200);
    const changed = (await detail(record.id).expect(200)).body as Measurement;
    expect(findGrip(changed)).toMatchObject({
      value: '30',
      evaluation: {
        recordRevision: 2,
        status: 'below_standard',
        conversion: { value: '30' },
      },
    });
    expect(((await latest().expect(200)).body as Polygon).axes[1].status).toBe(
      'below_standard',
    );
    const withoutWeight = await patch(
      record.id,
      {
        items: [
          {
            measurementCode: 'absolute_grip_strength',
            value: '30',
            unit: 'kg',
          },
        ],
      },
      2,
    ).expect(200);
    expect(
      findGrip(withoutWeight.body as Measurement).evaluation,
    ).toMatchObject({
      status: 'insufficient_information',
      reasonCode: 'weight_at_measurement_missing',
    });
    await patch(
      record.id,
      {
        items: [
          {
            measurementCode: 'absolute_grip_strength',
            value: '30',
            unit: 'kg',
          },
          { measurementCode: 'weight', value: '0', unit: 'kg' },
        ],
      },
      3,
    ).expect(400);
    await patch(record.id, { sexAtMeasurement: 'female' }, 1).expect(412);
    await detail(record.id, other).expect(404);
    await remove(record.id, 3).expect(204);
    await create(body, key).expect(410);
  });

  it('rejects wrong absolute-grip units, negative values and unsupported self-assessment entry', async () => {
    for (const [value, unit, entryMethod] of [
      ['-1', 'kg', 'manual'],
      ['25', '%', 'manual'],
      ['25', 'kg', 'self_assessment'],
    ]) {
      await create(
        payload({
          catalogVersion: 'nfa100-2026-09-24-grip-v1',
          entryMethod,
          items: [{ measurementCode: 'absolute_grip_strength', value, unit }],
        }),
      ).expect(400);
    }
  });

  function expectConsistentEvaluation(record: Measurement) {
    expect(record.axes.map((axis) => axis.axis)).toEqual(axisOrder);
    expect(
      record.axes.every((axis) => axis.recordRevision === record.revision),
    ).toBe(true);
    for (const item of record.items) {
      expect(item.evaluation).toMatchObject({
        measurementId: record.id,
        measurementCode: item.measurementCode,
        ageAtMeasurement: record.ageAtMeasurement,
        sex: record.sexAtMeasurement,
        recordRevision: record.revision,
      });
      expect(item.evaluation.evaluatedAt).not.toBeNull();
      expect(Number.isNaN(Date.parse(item.evaluation.evaluatedAt!))).toBe(
        false,
      );
    }
  }

  it('saves a partial self assessment and preserves its source through detail, list, and metadata updates', async () => {
    const original = (await create().expect(201)).body as Measurement;
    expect(original).toMatchObject({
      entryMethod: 'self_assessment',
      sourceProgram: 'nfa100',
      revision: 1,
    });
    expect(original.items).toHaveLength(1);
    expectConsistentEvaluation(original);
    await detail(original.id).expect(200, original);
    const listed = await request(app.getHttpServer())
      .get('/api/v1/measurements')
      .set('Authorization', `Bearer ${owner.access_token}`)
      .expect(200);
    expect(listed.body).toMatchObject({
      items: [
        {
          id: original.id,
          entryMethod: 'self_assessment',
          sourceProgram: 'nfa100',
        },
      ],
    });
    const updated = (
      await patch(original.id, { centerName: '직접 측정' }).expect(200)
    ).body as Measurement;
    expect(updated.entryMethod).toBe('self_assessment');
    expect(updated.sourceProgram).toBe('nfa100');
    expect(updated.revision).toBe(2);
    expectConsistentEvaluation(updated);
    await detail(original.id).expect(200, updated);
  });

  it.each([19, 64])(
    'accepts the self-assessment adult age boundary %i with official age-specific evaluation',
    async (ageAtMeasurement) => {
      const record = (
        await create(
          payload({
            ageAtMeasurement,
            items: [
              {
                measurementCode: 'cross_sit_up',
                value: ageAtMeasurement === 19 ? '55' : '31',
                unit: '회',
              },
            ],
          }),
        ).expect(201)
      ).body as Measurement;
      expect(record.items[0].evaluation).toMatchObject({
        status: 'graded',
        grade: 1,
        ageAtMeasurement,
      });
      expect(record.items[0].evaluation.ageBand).toEqual(
        ageAtMeasurement === 19
          ? { minAge: 19, maxAge: 24 }
          : { minAge: 60, maxAge: 64 },
      );
    },
  );

  it.each(
    ['nfa100-2026-09-19', retiredVersion, version].flatMap((catalogVersion) =>
      ['manual', 'self_assessment'].map((entryMethod) => ({
        catalogVersion,
        entryMethod,
      })),
    ),
  )(
    'rejects new retired adult curl-up input atomically for %j',
    async (extra) => {
      const response = await create(
        payload({
          ...extra,
          items: [{ measurementCode: 'self_curl_up', value: '0', unit: '회' }],
        }),
      ).expect(400);
      expect(response.body).toMatchObject({
        errors: expect.arrayContaining([
          expect.objectContaining({ field: 'items.0.measurementCode' }),
        ]),
      });
      expect(
        await database.measurement.count({ where: { userId: owner.user.id } }),
      ).toBe(0);
      expect(
        await database.measurementCreateRequest.count({
          where: { userId: owner.user.id },
        }),
      ).toBe(0);
      expect((await profile().expect(200)).body).toMatchObject({
        isOnboarded: false,
      });
    },
  );

  it('keeps adolescent curl-up available for manual records', async () => {
    const record = (
      await create(
        payload({
          ageAtMeasurement: 18,
          entryMethod: 'manual',
          items: [{ measurementCode: 'curl_up', value: '30', unit: '회' }],
        }),
      ).expect(201)
    ).body as Measurement;
    expect(record.items).toEqual([
      expect.objectContaining({
        measurementCode: 'curl_up',
        value: '30',
        unit: '회',
      }),
    ]);
    await detail(record.id).expect(200, record);
  });

  it('preserves stored retired values and evaluation snapshots in detail and latest polygon', async () => {
    const legacy = await seedRetiredMeasurement();
    const record = (await detail(legacy.id).expect(200)).body as Measurement;
    expect(record.items).toEqual([
      {
        measurementCode: 'self_curl_up',
        value: '0',
        unit: '회',
        reportedGrade: null,
        evaluation: legacy.evaluation,
      },
    ]);
    expect(record.axes[2]).toMatchObject({
      axis: 'muscular_endurance',
      status: 'unevaluable',
      grade: null,
      measuredMeasurementCodes: ['self_curl_up'],
    });
    await latest().expect(200, {
      measurementId: legacy.id,
      measuredOn: record.measuredOn,
      revision: 1,
      axes: record.axes,
    });
    const stored = await database.measurementItem.findUniqueOrThrow({
      where: {
        measurementId_code: { measurementId: legacy.id, code: 'self_curl_up' },
      },
    });
    expect(stored.evaluation).toEqual(legacy.evaluation);
    expect((await profile().expect(200)).body).toMatchObject({
      isOnboarded: true,
    });
  });

  it('allows retaining, correcting, and removing a previously stored retired item but never adding it back', async () => {
    const legacy = await seedRetiredMeasurement();
    const retained = (
      await patch(legacy.id, { centerName: '기존 자가측정' }).expect(200)
    ).body as Measurement;
    expect(retained.items[0]).toMatchObject({
      measurementCode: 'self_curl_up',
      value: '0',
      evaluation: { status: 'criteria_unavailable', grade: null },
    });
    expectConsistentEvaluation(retained);
    await patch(
      legacy.id,
      {
        items: [{ measurementCode: 'self_curl_up', value: '1.5', unit: '회' }],
      },
      2,
    ).expect(400);
    await detail(legacy.id).expect(200, retained);
    const corrected = (
      await patch(
        legacy.id,
        {
          items: [{ measurementCode: 'self_curl_up', value: '12', unit: '회' }],
        },
        2,
      ).expect(200)
    ).body as Measurement;
    expect(corrected.items[0]).toMatchObject({
      value: '12',
      evaluation: {
        status: 'criteria_unavailable',
        grade: null,
        recordRevision: 3,
      },
    });
    expectConsistentEvaluation(corrected);
    await patch(legacy.id, { items: [] }, 3).expect(400);
    const removed = (
      await patch(
        legacy.id,
        {
          items: [{ measurementCode: 'cross_sit_up', value: '48', unit: '회' }],
        },
        3,
      ).expect(200)
    ).body as Measurement;
    expect(removed.items.map((item) => item.measurementCode)).toEqual([
      'cross_sit_up',
    ]);
    expect(removed.missingMeasurementCodes).not.toContain('self_curl_up');
    expect(removed.missingMeasurementCodes).toContain(
      'ymca_recovery_heart_rate',
    );
    expectConsistentEvaluation(removed);
    const rejected = await patch(
      legacy.id,
      {
        items: [{ measurementCode: 'self_curl_up', value: '12', unit: '회' }],
      },
      4,
    ).expect(400);
    expect(rejected.body).toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({ field: 'items.0.measurementCode' }),
      ]),
    });
    await detail(legacy.id).expect(200, removed);
    await remove(legacy.id, 4).expect(204);
    expect((await profile().expect(200)).body).toMatchObject({
      isOnboarded: false,
    });
  });

  it.each(['manual', 'self_assessment'])(
    'does not add retired items to an existing %s record that never contained one',
    async (entryMethod) => {
      const record = (
        await create(
          payload({ catalogVersion: retiredVersion, entryMethod }),
        ).expect(201)
      ).body as Measurement;
      expect(record.missingMeasurementCodes).not.toContain('self_curl_up');
      const rejected = await patch(record.id, {
        items: [
          { measurementCode: 'cross_sit_up', value: '48', unit: '회' },
          { measurementCode: 'self_curl_up', value: '12', unit: '회' },
        ],
      }).expect(400);
      expect(rejected.body).toMatchObject({
        errors: expect.arrayContaining([
          expect.objectContaining({ field: 'items.1.measurementCode' }),
        ]),
      });
      await detail(record.id).expect(200, record);
    },
  );

  it('replays a pre-retirement create key without revalidating or reevaluating the retired item', async () => {
    const key = randomUUID();
    const legacy = await seedRetiredMeasurement();
    // Exact published normalized hash order from before retirement.
    const originalInput = {
      measuredOn: '2026-09-17',
      ageAtMeasurement: 19,
      sexAtMeasurement: 'male',
      reportKind: 'unknown',
      centerName: null,
      reportedOverallGrade: null,
      items: [
        {
          measurementCode: 'self_curl_up',
          value: '0',
          unit: '회',
          reportedGrade: null,
        },
      ],
      catalogVersion: retiredVersion,
      entryMethod: 'self_assessment',
    };
    await database.measurementCreateRequest.create({
      data: {
        userId: owner.user.id,
        key,
        measurementId: legacy.id,
        requestHash: createHash('sha256')
          .update(JSON.stringify(originalInput))
          .digest('hex'),
      },
    });
    const original = (await detail(legacy.id).expect(200)).body as Measurement;
    const replay = await create(originalInput, key).expect(200, original);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect((replay.body as Measurement).items[0].evaluation).toEqual(
      legacy.evaluation,
    );
    await create(
      {
        ...originalInput,
        items: [{ measurementCode: 'self_curl_up', value: '1', unit: '회' }],
      },
      key,
    ).expect(409);
    expect(
      await database.measurement.count({ where: { userId: owner.user.id } }),
    ).toBe(1);
    await remove(legacy.id).expect(204);
    await create(originalInput, key).expect(410);
    expect(
      await database.measurement.count({ where: { userId: owner.user.id } }),
    ).toBe(0);
  });

  it.each([
    { ageAtMeasurement: 18 },
    { ageAtMeasurement: 65 },
    { items: [] },
    { items: null },
    { items: [{ measurementCode: 'cross_sit_up', value: null, unit: '회' }] },
    { items: [{ measurementCode: 'cross_sit_up', value: '1.5', unit: '회' }] },
    {
      items: [
        {
          measurementCode: 'ymca_recovery_heart_rate',
          value: '0',
          unit: 'bpm',
        },
      ],
    },
    {
      items: [
        {
          measurementCode: 'ymca_recovery_heart_rate',
          value: '80',
          unit: 'ml/kg/min',
        },
      ],
    },
    {
      items: [
        { measurementCode: 'relative_grip_strength', value: '60', unit: '%' },
      ],
    },
    { items: [{ measurementCode: 'curl_up', value: '30', unit: '회' }] },
  ])('rejects invalid self assessment input atomically: %j', async (extra) => {
    await create(payload(extra)).expect(400);
    expect(
      await database.measurement.count({ where: { userId: owner.user.id } }),
    ).toBe(0);
    expect(
      await database.measurementCreateRequest.count({
        where: { userId: owner.user.id },
      }),
    ).toBe(0);
    expect((await profile().expect(200)).body).toMatchObject({
      isOnboarded: false,
    });
  });

  it('preserves valid zero while separating below-standard, unavailable, and unmeasured states', async () => {
    const record = (
      await create(
        payload({
          items: [
            { measurementCode: 'cross_sit_up', value: '0', unit: '회' },
            {
              measurementCode: 'ymca_recovery_heart_rate',
              value: '80',
              unit: 'bpm',
            },
          ],
        }),
      ).expect(201)
    ).body as Measurement;
    const items = Object.fromEntries(
      record.items.map((item) => [item.measurementCode, item]),
    );
    expect(items.cross_sit_up).toMatchObject({
      value: '0',
      evaluation: { grade: null, status: 'below_standard' },
    });
    expect(items.ymca_recovery_heart_rate).toMatchObject({
      value: '80',
      unit: 'bpm',
      evaluation: {
        grade: null,
        status: 'insufficient_information',
        reasonCode: 'height_at_measurement_missing',
        criterion: null,
        thresholds: [],
        nextTarget: { status: 'unavailable' },
      },
    });
    expect(record.axes).toEqual([
      expect.objectContaining({
        axis: 'cardiorespiratory_endurance',
        status: 'unevaluable',
        grade: null,
      }),
      expect.objectContaining({
        axis: 'strength',
        status: 'not_measured',
        grade: null,
      }),
      expect.objectContaining({
        axis: 'muscular_endurance',
        status: 'below_standard',
        grade: null,
        representativeMeasurementCode: 'cross_sit_up',
      }),
      expect.objectContaining({
        axis: 'flexibility',
        status: 'not_measured',
        grade: null,
      }),
      expect.objectContaining({
        axis: 'agility',
        status: 'not_measured',
        grade: null,
      }),
      expect.objectContaining({
        axis: 'power',
        status: 'not_measured',
        grade: null,
      }),
    ]);
    expect(record.items).toHaveLength(2);
    expectConsistentEvaluation(record);
  });

  it('stores original grades separately from sourced calculated grades and exact next-grade guidance', async () => {
    const record = (
      await create(
        payload({
          reportedOverallGrade: '원문 종합 1등급',
          items: [
            {
              measurementCode: 'cross_sit_up',
              value: '48',
              unit: '회',
              reportedGrade: '결과지에 기재된 별도 등급',
            },
          ],
        }),
      ).expect(201)
    ).body as Measurement;
    expect(record.items[0]).toMatchObject({
      reportedGrade: '결과지에 기재된 별도 등급',
      evaluation: {
        status: 'graded',
        grade: 2,
        nextTarget: {
          status: 'available',
          grade: 1,
          adjustments: [
            {
              lower: {
                threshold: '55',
                difference: '7',
                unit: '회',
                change: 'increase',
              },
              upper: null,
            },
          ],
        },
      },
    });
    const criterion = record.items[0].evaluation.criterion;
    expect(criterion?.id).toBeTruthy();
    expect(criterion?.internalVersion).toBeTruthy();
    expect(criterion?.source.url).toMatch(/^https:\/\//);
    expect(criterion?.source.documentTitle).toBeTruthy();
    expect(record.items[0].evaluation.thresholds).toHaveLength(3);
    expect(record.evaluation).toEqual({
      status: 'not_evaluated',
      reason: 'overall_certification_not_computed',
    });
    const stored = await database.measurementItem.findUniqueOrThrow({
      where: {
        measurementId_code: { measurementId: record.id, code: 'cross_sit_up' },
      },
    });
    expect(stored.evaluation).toEqual(record.items[0].evaluation);
    expect(stored.reportedGrade).toBe('결과지에 기재된 별도 등급');
    await detail(record.id).expect(200, record);
  });

  it('refreshes value, demographics, target guidance, and revision together while preserving omitted fields', async () => {
    const original = (
      await create(
        payload({
          items: [
            {
              measurementCode: 'cross_sit_up',
              value: '48',
              unit: '회',
              reportedGrade: '원문 2등급',
            },
          ],
        }),
      ).expect(201)
    ).body as Measurement;
    const updated = (
      await patch(original.id, {
        items: [
          {
            measurementCode: 'cross_sit_up',
            value: '55',
            unit: '회',
            reportedGrade: '원문 2등급',
          },
        ],
      }).expect(200)
    ).body as Measurement;
    expect(updated.items[0]).toMatchObject({
      value: '55',
      reportedGrade: '원문 2등급',
      evaluation: {
        grade: 1,
        nextTarget: {
          status: 'highest_grade',
          grade: null,
          intervals: [],
          adjustments: [],
        },
      },
    });
    expectConsistentEvaluation(updated);
    const missingSex = (
      await patch(original.id, { sexAtMeasurement: null }, 2).expect(200)
    ).body as Measurement;
    expect(missingSex.items[0]).toMatchObject({
      value: '55',
      reportedGrade: '원문 2등급',
      evaluation: {
        status: 'insufficient_information',
        reasonCode: 'sex_at_measurement_missing',
        grade: null,
        nextTarget: { status: 'unavailable' },
        recordRevision: 3,
      },
    });
    expectConsistentEvaluation(missingSex);
    await detail(original.id).expect(200, missingSex);
    const stored = await database.measurementItem.findUniqueOrThrow({
      where: {
        measurementId_code: {
          measurementId: original.id,
          code: 'cross_sit_up',
        },
      },
    });
    expect(stored.evaluation).toEqual(missingSex.items[0].evaluation);
    await patch(original.id, { items: null }, 3).expect(400);
    await patch(original.id, { items: [] }, 3).expect(400);
    await patch(original.id, { entryMethod: null }, 3).expect(400);
    await detail(original.id).expect(200, missingSex);
  });

  it('replaces rather than merges items and does not calculate BMI from height and weight', async () => {
    const original = (
      await create(
        payload({
          items: [
            { measurementCode: 'height', value: '170', unit: 'cm' },
            { measurementCode: 'weight', value: '60', unit: 'kg' },
            { measurementCode: 'cross_sit_up', value: '0', unit: '회' },
          ],
        }),
      ).expect(201)
    ).body as Measurement;
    expect(original.items.map((item) => item.measurementCode)).toEqual([
      'cross_sit_up',
      'height',
      'weight',
    ]);
    const replaced = (
      await patch(original.id, {
        items: [{ measurementCode: 'weight', value: '61', unit: 'kg' }],
      }).expect(200)
    ).body as Measurement;
    expect(replaced.items.map((item) => item.measurementCode)).toEqual([
      'weight',
    ]);
    expect(replaced.axes.every((axis) => axis.status === 'not_measured')).toBe(
      true,
    );
    expect(
      await database.measurementItem.count({
        where: { measurementId: original.id },
      }),
    ).toBe(1);
    expectConsistentEvaluation(replaced);
  });

  it('deduplicates self assessments, distinguishes input methods, and rejects stale evaluation writes', async () => {
    const key = randomUUID();
    const body = payload();
    const original = (await create(body, key).expect(201)).body as Measurement;
    await create(body, key).expect(200, original);
    await create(payload({ entryMethod: 'manual' }), key).expect(409);
    const responses = await Promise.all([
      patch(original.id, {
        items: [{ measurementCode: 'cross_sit_up', value: '55', unit: '회' }],
      }),
      patch(original.id, {
        items: [{ measurementCode: 'cross_sit_up', value: '0', unit: '회' }],
      }),
    ]);
    expect(
      responses.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([200, 412]);
    const winner = responses.find((response) => response.status === 200)!
      .body as Measurement;
    expectConsistentEvaluation(winner);
    expect(winner.items[0].evaluation.grade).toBe(
      winner.items[0].value === '55' ? 1 : null,
    );
    expect(winner.items[0].evaluation.status).toBe(
      winner.items[0].value === '55' ? 'graded' : 'below_standard',
    );
    await detail(original.id).expect(200, winner);
    await create(body, key).expect(200, winner);
    await remove(original.id, 2).expect(204);
    await create(body, key).expect(410);
    expect(
      await database.measurementItem.count({
        where: { measurementId: original.id },
      }),
    ).toBe(0);
  });

  it('returns six explicit empty axes without authentication or ownership leaks', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/measurements/latest-polygon')
      .expect(401);
    const empty = await latest().expect(200);
    const polygon = empty.body as Polygon;
    expect(polygon).toMatchObject({
      measurementId: null,
      measuredOn: null,
      revision: null,
    });
    expect(polygon.axes.map((axis) => axis.axis)).toEqual(axisOrder);
    for (const axis of polygon.axes)
      expect(axis).toMatchObject({
        status: 'not_measured',
        grade: null,
        representativeMeasurementCode: null,
        measuredMeasurementCodes: [],
        recordRevision: null,
      });
    const foreign = (await create(payload(), randomUUID(), other).expect(201))
      .body as Measurement;
    await latest().expect(200, empty.body);
    await detail(foreign.id).expect(404);
    await patch(foreign.id, { centerName: 'spoofed' }).expect(404);
    await remove(foreign.id).expect(404);
    expect((await latest(other).expect(200)).body).toEqual({
      measurementId: foreign.id,
      measuredOn: foreign.measuredOn,
      revision: foreign.revision,
      axes: foreign.axes,
    });
  });

  it('uses the latest created session on the latest measurement date through updates and deletion', async () => {
    const older = (
      await create(
        payload({
          measuredOn: '2026-09-15',
          items: [{ measurementCode: 'cross_sit_up', value: '55', unit: '회' }],
        }),
      ).expect(201)
    ).body as Measurement;
    const first = (
      await create(
        payload({
          items: [
            { measurementCode: 'sit_and_reach', value: '16.1', unit: 'cm' },
          ],
        }),
      ).expect(201)
    ).body as Measurement;
    const second = (
      await create(
        payload({
          items: [
            {
              measurementCode: 'ymca_recovery_heart_rate',
              value: '80',
              unit: 'bpm',
            },
          ],
        }),
      ).expect(201)
    ).body as Measurement;
    const [following, selected] = [first, second].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    // Force creation order to disagree with ID order, without relying on timing.
    await database.measurement.update({
      where: { id: following.id },
      data: { createdAt: new Date('2026-09-20T00:00:00Z') },
    });
    await database.measurement.update({
      where: { id: selected.id },
      data: { createdAt: new Date('2026-09-21T00:00:00Z') },
    });
    // A later entry for an older measurement date must not become representative.
    await database.measurement.update({
      where: { id: older.id },
      data: { createdAt: new Date('2026-09-22T00:00:00Z') },
    });
    const polygonFor = (record: Measurement) => ({
      measurementId: record.id,
      measuredOn: record.measuredOn,
      revision: record.revision,
      axes: record.axes,
    });
    await latest().expect(200, polygonFor(selected));
    const followingUpdated = (
      await patch(following.id, {
        centerName: '같은 날짜의 이전 기록 수정',
      }).expect(200)
    ).body as Measurement;
    await latest().expect(200, polygonFor(selected));
    await patch(older.id, { centerName: '수정 시각이 가장 최근' }).expect(200);
    await latest().expect(200, polygonFor(selected));
    expect((await latest()).body as Polygon).toMatchObject({
      axes: expect.arrayContaining([
        expect.objectContaining({
          axis: 'muscular_endurance',
          status: 'not_measured',
          grade: null,
        }),
      ]),
    });
    const changed = (
      await patch(selected.id, {
        items: [{ measurementCode: 'cross_sit_up', value: '0', unit: '회' }],
      }).expect(200)
    ).body as Measurement;
    await latest().expect(200, polygonFor(changed));
    await remove(selected.id, 2).expect(204);
    await latest().expect(200, polygonFor(followingUpdated));
    await remove(following.id, 2).expect(204);
    const olderUpdated = (await detail(older.id).expect(200))
      .body as Measurement;
    await latest().expect(200, polygonFor(olderUpdated));
  });

  it('uses ascending ID only when measurement date and creation time are both equal', async () => {
    const first = (
      await create(
        payload({
          items: [{ measurementCode: 'cross_sit_up', value: '55', unit: '회' }],
        }),
      ).expect(201)
    ).body as Measurement;
    const second = (await create().expect(201)).body as Measurement;
    expect(first.axes[2].grade).toBe(1);
    expect(second.axes[2].grade).toBe(2);
    await database.measurement.updateMany({
      where: { id: { in: [first.id, second.id] } },
      data: { createdAt: new Date('2026-09-20T00:00:00Z') },
    });
    const [selected] = [first, second].sort((a, b) => a.id.localeCompare(b.id));
    await latest().expect(200, {
      measurementId: selected.id,
      measuredOn: selected.measuredOn,
      revision: selected.revision,
      axes: selected.axes,
    });
  });

  it('reads legacy records without fabricating stored evaluations or automatically backfilling them', async () => {
    const legacy = await database.measurement.create({
      data: {
        userId: owner.user.id,
        catalogVersion: 'nfa100-2026-09-19',
        measuredOn: new Date('2026-09-17T00:00:00Z'),
        ageAtMeasurement: 19,
        sexAtMeasurement: 'male',
        items: {
          create: [
            {
              code: 'cross_sit_up',
              value: '55',
              unit: '회',
              reportedGrade: '기존 원문',
            },
          ],
        },
      },
    });
    const record = (await detail(legacy.id).expect(200)).body as Measurement;
    expect(record.items[0]).toMatchObject({
      reportedGrade: '기존 원문',
      evaluation: {
        status: 'not_evaluated',
        reasonCode: 'evaluation_not_stored',
        grade: null,
        evaluatedAt: null,
        criterion: null,
        recordRevision: 1,
      },
    });
    expect(record.axes[2]).toMatchObject({
      status: 'unevaluable',
      grade: null,
    });
    await latest().expect(200, {
      measurementId: record.id,
      measuredOn: record.measuredOn,
      revision: 1,
      axes: record.axes,
    });
    const stored = await database.measurementItem.findUniqueOrThrow({
      where: {
        measurementId_code: { measurementId: legacy.id, code: 'cross_sit_up' },
      },
    });
    expect(stored.evaluation).toBeNull();
    expect((await profile().expect(200)).body).toMatchObject({
      isOnboarded: true,
    });
  });

  it('replays pre-upgrade request hashes for omitted or explicit manual entry methods', async () => {
    const key = randomUUID();
    // Match the published pre-upgrade normalized input, including property order.
    // Do not use the current parser or hash implementation to build this fixture.
    const originalInput = {
      measuredOn: '2026-09-17',
      ageAtMeasurement: 19,
      sexAtMeasurement: 'male',
      reportKind: 'unknown',
      centerName: null,
      reportedOverallGrade: null,
      items: [
        {
          measurementCode: 'cross_sit_up',
          value: '48',
          unit: '회',
          reportedGrade: null,
        },
      ],
      catalogVersion: 'nfa100-2026-09-19',
    };
    const legacy = await database.measurement.create({
      data: {
        userId: owner.user.id,
        catalogVersion: originalInput.catalogVersion,
        measuredOn: new Date('2026-09-17T00:00:00Z'),
        ageAtMeasurement: 19,
        sexAtMeasurement: 'male',
        items: { create: [{ code: 'cross_sit_up', value: '48', unit: '회' }] },
      },
    });
    await database.measurementCreateRequest.create({
      data: {
        userId: owner.user.id,
        key,
        measurementId: legacy.id,
        requestHash: createHash('sha256')
          .update(JSON.stringify(originalInput))
          .digest('hex'),
      },
    });
    const expected = await detail(legacy.id).expect(200);
    for (const input of [
      originalInput,
      { ...originalInput, entryMethod: 'manual' },
    ]) {
      const replay = await create(input, key).expect(200, expected.body);
      expect(replay.headers['idempotency-replayed']).toBe('true');
    }
    expect(
      await database.measurement.count({ where: { userId: owner.user.id } }),
    ).toBe(1);
  });

  it('counts an unevaluable self assessment for onboarding while leaving the current curriculum unchanged', async () => {
    const definition = await database.workoutCurriculum.create({
      data: { name: '[TEST ONLY] Existing curriculum' },
    });
    curriculumIds.push(definition.id);
    const assignment = await database.userCurriculumAssignment.create({
      data: {
        userId: owner.user.id,
        currentForUserId: owner.user.id,
        curriculumId: definition.id,
        requestKey: randomUUID(),
      },
    });
    expect((await profile().expect(200)).body).toMatchObject({
      isOnboarded: false,
      currentCurriculum: { id: assignment.id },
    });
    const record = (
      await create(
        payload({
          items: [
            {
              measurementCode: 'ymca_recovery_heart_rate',
              value: '80',
              unit: 'bpm',
            },
          ],
        }),
      ).expect(201)
    ).body as Measurement;
    expect((await profile().expect(200)).body).toMatchObject({
      isOnboarded: true,
      currentCurriculum: { id: assignment.id },
    });
    await patch(record.id, { centerName: '자가측정' }).expect(200);
    await remove(record.id, 2).expect(204);
    expect((await profile().expect(200)).body).toMatchObject({
      isOnboarded: false,
      currentCurriculum: { id: assignment.id },
    });
    expect(
      await database.userCurriculumAssignment.findMany({
        where: { userId: owner.user.id },
      }),
    ).toEqual([assignment]);
  });

  it('enforces self-assessment scope and evaluation identity/revision at the database boundary', async () => {
    for (const [code, value, unit, age] of [
      ['height', '170', 'cm', 18],
      ['relative_grip_strength', '60', '%', 25],
      ['self_curl_up', '1.5', '회', 25],
      ['ymca_recovery_heart_rate', '0', 'bpm', 25],
    ] as const) {
      await expect(
        database.measurement.create({
          data: {
            userId: owner.user.id,
            catalogVersion: code === 'self_curl_up' ? retiredVersion : version,
            entryMethod: 'self_assessment',
            measuredOn: new Date('2026-09-17T00:00:00Z'),
            ageAtMeasurement: age,
            items: { create: [{ code, value, unit }] },
          },
        }),
      ).rejects.toThrow();
    }
    const record = (await create().expect(201)).body as Measurement;
    for (const invalid of [
      { recordRevision: 999 },
      { measurementId: randomUUID() },
      { measurementCode: 'self_curl_up' },
    ]) {
      await expect(
        database.measurementItem.update({
          where: {
            measurementId_code: {
              measurementId: record.id,
              code: 'cross_sit_up',
            },
          },
          data: { evaluation: { ...record.items[0].evaluation, ...invalid } },
        }),
      ).rejects.toThrow();
    }
    await expect(
      database.measurement.update({
        where: { id: record.id },
        data: { revision: 2 },
      }),
    ).rejects.toThrow();
    await detail(record.id).expect(200, record);
  });
});
