import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createHmac, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { configureApp } from '../src/setup-app.js';
import {
  ExtractionConfig,
  EXTRACTION_POLICY,
} from '../src/measurements/extraction/extraction.config.js';
import { OPENAI_FETCH } from '../src/measurements/extraction/openai-extraction.client.js';
import type { ExtractionDraft } from '../src/measurements/extraction/extraction-validation.js';
import { candidate, modelResult, responseBody } from './fixtures/extraction.js';
import { twoFramePng } from './fixtures/png.js';

type Account = { user: { id: string }; access_token: string };

describe('Authenticated photo extraction with PostgreSQL and isolated OpenAI transport', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let owner: Account;
  let other: Account;
  let png: Buffer;
  let version: string;
  const users: string[] = [];
  const fetcher = vi.fn<typeof fetch>();
  const settings = new ConfigService({
    OPENAI_API_KEY: 'test-only-not-a-key',
    OPENAI_OCR_MODEL: 'test-only-model',
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OPENAI_FETCH)
      .useValue(fetcher)
      .overrideProvider(ExtractionConfig)
      .useValue(new ExtractionConfig(settings))
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    database = app.get(DatabaseService);
    png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    owner = await register();
    other = await register();
    version = (
      (
        await request(app.getHttpServer())
          .get('/api/v1/measurement-catalog')
          .expect(200)
      ).body as { version: string }
    ).version;
  });

  beforeEach(async () => {
    settings.set('OPENAI_API_KEY', 'test-only-not-a-key');
    settings.set('OPENAI_OCR_MODEL', 'test-only-model');
    fetcher
      .mockReset()
      .mockImplementation(() => Promise.resolve(Response.json(responseBody())));
    await database.measurement.deleteMany({ where: { userId: { in: users } } });
    await database.measurementCreateRequest.deleteMany({
      where: { userId: { in: users } },
    });
    await database.authRateLimit.deleteMany({
      where: {
        key: {
          in: users.flatMap((id) => [
            rateKey(id, 'minute', 60),
            rateKey(id, 'day', 86400),
          ]),
        },
      },
    });
  });

  afterAll(async () => {
    await database?.user.deleteMany({ where: { id: { in: users } } });
    await app?.close();
  });

  function rateKey(id: string, period: string, seconds: number) {
    return createHmac(
      'sha256',
      app.get(ConfigService).getOrThrow<string>('AUTH_JWT_SECRET'),
    )
      .update(
        `ocr:${period}:${id}:${Math.floor(Date.now() / (seconds * 1000))}`,
      )
      .digest('hex');
  }

  async function register() {
    const result = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('X-CSRF-Protection', '1')
      .send({
        email: `extraction-${randomUUID()}@example.test`,
        password: 'synthetic extraction password',
      })
      .expect(201);
    const account = result.body as Account;
    users.push(account.user.id);
    return account;
  }
  function upload(account = owner) {
    return request(app.getHttpServer())
      .post('/api/v1/measurements/extract')
      .set('Authorization', `Bearer ${account.access_token}`);
  }
  function extract(account = owner) {
    return upload(account).attach('image', png, {
      filename: 'synthetic.png',
      contentType: 'image/png',
    });
  }
  function profile() {
    return request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${owner.access_token}`)
      .expect(200);
  }

  it('uses the latest real catalog, returns a draft, and does not change records or onboarding', async () => {
    const beforeUser = await database.user.findUniqueOrThrow({
      where: { id: owner.user.id },
    });
    const before = await profile();
    const response = await extract().expect(200);
    const draft = response.body as ExtractionDraft;
    expect(response.headers['cache-control']).toBe('no-store');
    expect(draft).toMatchObject({
      catalogVersion: version,
      status: 'extracted',
      metadata: { measuredOn: '2024-02-29', ageAtMeasurement: 25 },
      items: [{ measurementCode: 'sit_and_reach', value: '-3.25', unit: 'cm' }],
    });
    expect(
      await database.measurement.count({ where: { userId: owner.user.id } }),
    ).toBe(0);
    expect(
      await database.measurementItem.count({
        where: { measurement: { userId: owner.user.id } },
      }),
    ).toBe(0);
    expect(
      await database.measurementCreateRequest.count({
        where: { userId: owner.user.id },
      }),
    ).toBe(0);
    expect(
      await database.user.findUniqueOrThrow({ where: { id: owner.user.id } }),
    ).toEqual(beforeUser);
    expect((await profile()).body).toEqual(before.body);
    expect(before.body).toMatchObject({ isOnboarded: false });
    const sent = JSON.parse(fetcher.mock.calls[0][1]!.body as string) as {
      input: Array<{ content: Array<{ text: string }> }>;
    };
    const prompt = JSON.parse(sent.input[0].content[0].text) as {
      catalogVersion: string;
      definitions: Array<{ code: string }>;
    };
    expect(prompt.catalogVersion).toBe(version);
    expect(prompt.definitions).toHaveLength(20);
    expect(
      prompt.definitions.map((definition) => definition.code),
    ).not.toContain('self_curl_up');
    expect(
      prompt.definitions.some((def) => def.code === 'relative_grip_strength'),
    ).toBe(true);
    expect(
      prompt.definitions.some((def) => def.code === 'absolute_grip_strength'),
    ).toBe(false);
  });

  it('supports explicit catalog versions and rejects an unknown version before calling OpenAI', async () => {
    await extract().field('catalogVersion', version).expect(200);
    const historical = (
      await extract().field('catalogVersion', 'nfa100-2026-09-23').expect(200)
    ).body as ExtractionDraft;
    expect(historical.notDetectedMeasurementCodes).not.toContain(
      'self_curl_up',
    );
    expect(historical.notDetectedMeasurementCodes).toContain(
      'ymca_recovery_heart_rate',
    );
    fetcher.mockClear();
    await extract().field('catalogVersion', 'unknown').expect(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps a retired candidate out of saveable items even when extracting with its historical catalog', async () => {
    fetcher.mockResolvedValue(
      Response.json(
        responseBody(
          modelResult({
            candidates: [
              candidate({
                measurementCode: 'self_curl_up',
                value: '12',
                unit: '회',
                evidence: {
                  label: '성인 윗몸말아올리기',
                  value: '12',
                  unit: '회',
                },
              }),
              candidate({
                measurementCode: 'ymca_recovery_heart_rate',
                value: '80',
                unit: 'bpm',
                evidence: {
                  label: 'YMCA 회복 심박수',
                  value: '80',
                  unit: 'bpm',
                },
              }),
            ],
          }),
        ),
      ),
    );
    const draft = (
      await extract().field('catalogVersion', 'nfa100-2026-09-23').expect(200)
    ).body as ExtractionDraft;
    expect(draft.status).toBe('partial');
    expect(draft.items).toEqual([
      expect.objectContaining({
        measurementCode: 'ymca_recovery_heart_rate',
        value: '80',
        unit: 'bpm',
      }),
    ]);
    expect(draft.reviewItems).toEqual([
      expect.objectContaining({
        measurementCode: 'self_curl_up',
        value: '12',
        unit: '회',
        reasons: ['MEASUREMENT_RETIRED'],
      }),
    ]);
    expect(draft.notDetectedMeasurementCodes).not.toContain('self_curl_up');
    expect(draft.notDetectedMeasurementCodes).toContain('cross_sit_up');
    expect(
      await database.measurement.count({ where: { userId: owner.user.id } }),
    ).toBe(0);
    expect((await profile()).body).toMatchObject({ isOnboarded: false });
  });

  it('returns all six readable fitness factors even when age is hidden', async () => {
    // Synthetic provider output verifies the complete HTTP/catalog path;
    // actual photo reading accuracy is covered separately by live verification.
    const rows = [
      ['relative_grip_strength', '41.1', '%'],
      ['cross_sit_up', '21', '회'],
      ['step_test_vo2max', '35.2', 'ml/kg/min'],
      ['sit_and_reach', '-2.5', 'cm'],
      ['reaction_time', '0.287', '초'],
      ['standing_long_jump', '181', 'cm'],
    ];
    fetcher.mockResolvedValue(
      Response.json(
        responseBody(
          modelResult({
            metadata: { ...modelResult().metadata, ageAtMeasurement: null },
            candidates: rows.map(([measurementCode, value, unit]) =>
              candidate({
                measurementCode,
                value,
                unit,
                evidence: { label: measurementCode, value, unit },
              }),
            ),
          }),
        ),
      ),
    );
    const result = (await extract().expect(200)).body as ExtractionDraft;
    expect(result.status).toBe('partial');
    expect(
      result.items.map(({ measurementCode, value, unit }) => [
        measurementCode,
        value,
        unit,
      ]),
    ).toEqual(rows);
    expect(result.reviewItems).toEqual([]);
    expect(result.issues).toContainEqual({
      code: 'AGE_VALIDATION_PENDING',
      field: 'items',
      requiresInput: false,
    });
    expect(
      await database.measurement.count({ where: { userId: owner.user.id } }),
    ).toBe(0);
  });

  it('requires live authentication before upload/paid calls', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/measurements/extract')
      .attach('image', png, 'synthetic.png')
      .expect(401);
    await upload({ ...owner, access_token: 'invalid' })
      .attach('image', png, 'synthetic.png')
      .expect(401);
    const revoked = await register();
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('X-CSRF-Protection', '1')
      .set('Authorization', `Bearer ${revoked.access_token}`)
      .expect(204);
    await extract(revoked).expect(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['OPENAI_API_KEY', 'OPENAI_OCR_MODEL'])(
    'keeps existing APIs available when %s is absent',
    async (key) => {
      settings.set(key, '');
      const result = await extract().expect(503);
      expect(result.body).toMatchObject({ code: 'EXTRACTION_UNAVAILABLE' });
      expect(fetcher).not.toHaveBeenCalled();
      await profile();
      await request(app.getHttpServer())
        .get('/api/v1/measurements')
        .set('Authorization', `Bearer ${owner.access_token}`)
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/measurements')
        .set('Authorization', `Bearer ${owner.access_token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          catalogVersion: version,
          measuredOn: '2024-02-29',
          ageAtMeasurement: 25,
          items: [
            { measurementCode: 'sit_and_reach', value: '-3.25', unit: 'cm' },
          ],
        })
        .expect(201);
    },
  );

  it.each([
    [twoFramePng(), 'image/png', 400],
    [Buffer.from('<html>fake image</html>'), 'image/png', 415],
    [Buffer.from('GIF89a'), 'image/gif', 415],
    [Buffer.from([0xff, 0xd8, 0xff, 0x01]), 'image/jpeg', 400],
    [Buffer.alloc(EXTRACTION_POLICY.maxImageBytes + 1), 'image/png', 413],
  ] as const)(
    'rejects fake, unsupported, corrupt or oversize uploads',
    async (buffer, contentType, status) => {
      await upload()
        .attach('image', buffer, { filename: 'claimed.jpg', contentType })
        .expect(status);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('rejects a declared MIME that disagrees with actual bytes', async () => {
    await upload()
      .attach('image', png, {
        filename: 'synthetic.jpg',
        contentType: 'image/jpeg',
      })
      .expect(415);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires one image, no remote URLs or extra input fields', async () => {
    await upload().send({ image: 'https://example.test/private' }).expect(400);
    await upload().field('catalogVersion', version).expect(400);
    await extract().attach('image', png, 'second.png').expect(400);
    await extract().field('url', 'https://example.test/private').expect(400);
    await extract().field('catalogVersion', '').expect(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    'unreadable',
    'not_target',
    'grades_only',
    'mixed_sessions',
    'multiple_people',
  ] as const)(
    'returns a specific %s document state without writes',
    async (documentStatus) => {
      fetcher.mockResolvedValueOnce(
        Response.json(
          responseBody(modelResult({ documentStatus, candidates: [] })),
        ),
      );
      const result = await extract().expect(200);
      expect(result.body).toMatchObject({ status: documentStatus, items: [] });
      expect(
        await database.measurement.count({ where: { userId: owner.user.id } }),
      ).toBe(0);
      expect((await profile()).body).toMatchObject({ isOnboarded: false });
    },
  );

  it('returns partial results and reviews absolute grip, missing units and duplicate values', async () => {
    fetcher.mockResolvedValueOnce(
      Response.json(
        responseBody(
          modelResult({
            candidates: [
              candidate(),
              candidate({
                measurementCode: 'relative_grip_strength',
                value: '32',
                unit: 'kg',
                evidence: { label: '악력', value: '32', unit: 'kg' },
              }),
              candidate({ measurementCode: 'reaction_time', unit: null }),
              candidate({ measurementCode: 'height' }),
              candidate({ measurementCode: 'height' }),
            ],
          }),
        ),
      ),
    );
    const result = (await extract().expect(200)).body as ExtractionDraft;
    expect(result.status).toBe('partial');
    expect(result.items).toHaveLength(1);
    expect(result.reviewItems).toHaveLength(4);
    expect(result.reviewItems[0].reasons).toContain('UNIT_MISMATCH');
    expect(result.reviewItems[1].reasons).toContain('UNIT_MISSING');
    expect(result.reviewItems[2].reasons).toContain('DUPLICATE_CODE');
  });

  it('persists only the user-confirmed conversion through the existing idempotent save API', async () => {
    const draft = (await extract().expect(200)).body as ExtractionDraft;
    const body = {
      ...draft.metadata,
      catalogVersion: draft.catalogVersion,
      items: draft.items.map(({ evidence: _evidence, ...item }) => item),
    };
    const key = randomUUID();
    const save = () =>
      request(app.getHttpServer())
        .post('/api/v1/measurements')
        .set('Authorization', `Bearer ${owner.access_token}`)
        .set('Idempotency-Key', key)
        .send(body);
    const saved = await save().expect(201);
    expect(saved.body).toMatchObject({
      entryMethod: 'manual',
      revision: 1,
      items: [{ value: '-3.25' }],
    });
    expect(saved.headers.etag).toBe('"1"');
    await save().expect(200, saved.body);
    expect((await profile()).body).toMatchObject({ isOnboarded: true });
    const before = await database.measurement.findMany({
      where: { userId: owner.user.id },
      include: { items: true },
    });
    await extract().expect(200);
    expect(
      await database.measurement.findMany({
        where: { userId: owner.user.id },
        include: { items: true },
      }),
    ).toEqual(before);
  });

  it('enforces shared per-user minute limits and keeps other users independent', async () => {
    for (let i = 0; i < EXTRACTION_POLICY.perMinute; i++)
      await extract().expect(200);
    const limited = await extract().expect(429);
    expect(limited.body).toMatchObject({ code: 'EXTRACTION_RATE_LIMITED' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(fetcher).toHaveBeenCalledTimes(EXTRACTION_POLICY.perMinute);
    await extract(other).expect(200);
  });

  it('enforces the day budget even when minute budget remains', async () => {
    await database.authRateLimit.create({
      data: {
        key: rateKey(owner.user.id, 'day', 86400),
        attempts: EXTRACTION_POLICY.perDay,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    await extract().expect(429);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sanitizes upstream errors and never creates fallback measurements', async () => {
    fetcher.mockResolvedValueOnce(
      new Response('private provider error', { status: 429 }),
    );
    const response = await extract().expect(503);
    expect(response.body).toEqual({
      statusCode: 503,
      code: 'OPENAI_RATE_LIMITED',
      message: 'OPENAI_RATE_LIMITED',
    });
    expect(
      await database.measurement.count({ where: { userId: owner.user.id } }),
    ).toBe(0);
    expect((await profile()).body).toMatchObject({ isOnboarded: false });
  });
});
