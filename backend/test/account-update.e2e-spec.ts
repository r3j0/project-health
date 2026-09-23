import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { verify } from 'argon2';
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
import { PasswordService } from '../src/auth/password.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { configureApp } from '../src/setup-app.js';

const password = 'account update original password';
const nextPassword = ' account update new password ';
type Account = {
  user: { id: string; email: string };
  access_token: string;
  cookie: string;
};

describe('Credential-only User UPDATE', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  const ids: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    database = app.get(DatabaseService);
  });
  beforeEach(async () => {
    await database.authRateLimit.deleteMany();
  });
  afterAll(async () => {
    await database?.user.deleteMany({ where: { id: { in: ids } } });
    await app?.close();
  });

  function asAccount(response: request.Response) {
    const account = response.body as Account;
    account.cookie = (
      response.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0];
    return account;
  }
  async function register() {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('X-CSRF-Protection', '1')
      .send({ email: `account-update-${randomUUID()}@example.test`, password })
      .expect(201);
    const account = asAccount(response);
    ids.push(account.user.id);
    return account;
  }
  const patch = (account: Account, input: unknown) =>
    request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${account.access_token}`)
      .set('X-CSRF-Protection', '1')
      .send(input as object);
  const login = (email: string, inputPassword = password) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-CSRF-Protection', '1')
      .send({ email, password: inputPassword });
  const me = (account: Account) =>
    request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${account.access_token}`);
  const refresh = (cookie: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('X-CSRF-Protection', '1')
      .set('Cookie', cookie);

  it('changes only the normalized login email and keeps account/measurement/currency identity', async () => {
    const account = await register();
    const before = await database.user.findUniqueOrThrow({
      where: { id: account.user.id },
    });
    const record = await database.measurement.create({
      data: {
        userId: account.user.id,
        catalogVersion: 'nfa100-2026-09-19',
        measuredOn: new Date('2026-09-17'),
        ageAtMeasurement: 25,
        items: {
          create: [{ code: 'height', value: '165.123456789', unit: 'cm' }],
        },
      },
    });
    const targetEmail = `changed-${randomUUID()}@example.test`;
    const response = await patch(account, {
      currentPassword: password,
      email: `  ${targetEmail.toUpperCase()}  `,
    }).expect(204);
    expect(response.text).toBe('');
    expect(response.headers['cache-control']).toBe('no-store');
    const stored = await database.user.findUniqueOrThrow({
      where: { id: account.user.id },
    });
    expect(stored).toMatchObject({
      id: before.id,
      email: targetEmail,
      password: before.password,
      createdAt: before.createdAt,
    });
    expect(stored.updatedAt.getTime()).toBeGreaterThanOrEqual(
      before.updatedAt.getTime(),
    );
    await login(account.user.email).expect(401);
    const signedIn = asAccount(await login(targetEmail).expect(200));
    expect((await me(signedIn).expect(200)).body).toMatchObject({
      id: account.user.id,
      email: targetEmail,
      isOnboarded: true,
      currency: { balance: 0 },
    });
    expect(
      await database.measurement.findUnique({ where: { id: record.id } }),
    ).not.toBeNull();
  });

  it('changes the password with Argon2, preserves whitespace and revokes every old access/refresh session', async () => {
    const account = await register();
    const second = asAccount(await login(account.user.email).expect(200));
    const rotated = asAccount(await refresh(second.cookie).expect(200));
    const response = await patch(account, {
      currentPassword: password,
      newPassword: nextPassword,
    }).expect(204);
    const cookie = (response.headers['set-cookie'] as unknown as string[])[0];
    for (const part of [
      'project_health_refresh=;',
      'HttpOnly',
      'SameSite=Lax',
      'Path=/',
      'Expires=Thu, 01 Jan 1970',
    ])
      expect(cookie).toContain(part);
    for (const old of [account, second, rotated]) {
      await me(old).expect(401);
      await refresh(old.cookie).expect(401);
    }
    await patch(account, {
      currentPassword: password,
      newPassword: nextPassword,
    }).expect(401);
    await login(account.user.email).expect(401);
    await login(account.user.email, nextPassword.trim()).expect(401);
    const signedIn = asAccount(
      await login(account.user.email, nextPassword).expect(200),
    );
    await me(signedIn).expect(200);
    const stored = await database.user.findUniqueOrThrow({
      where: { id: account.user.id },
    });
    expect(stored.email).toBe(account.user.email);
    expect(stored.password).toMatch(/^\$argon2id\$/);
    expect(await verify(stored.password!, nextPassword)).toBe(true);
    expect(JSON.stringify(signedIn)).not.toContain(nextPassword);
  });

  it('updates email and password atomically, without changing another account', async () => {
    const account = await register();
    const other = await register();
    const unchanged = await database.user.findUniqueOrThrow({
      where: { id: other.user.id },
    });
    const email = `combined-${randomUUID()}@example.test`;
    await patch(account, {
      currentPassword: password,
      email,
      newPassword: nextPassword,
    }).expect(204);
    await login(account.user.email, nextPassword).expect(401);
    await login(email, password).expect(401);
    await login(email, nextPassword).expect(200);
    expect(
      await database.user.findUniqueOrThrow({ where: { id: other.user.id } }),
    ).toEqual(unchanged);
    await me(other).expect(200);
  });

  it('rolls back password changes and session revocation on an email collision', async () => {
    const account = await register();
    const other = await register();
    const before = await database.user.findUniqueOrThrow({
      where: { id: account.user.id },
    });
    await patch(account, {
      currentPassword: password,
      email: other.user.email.toUpperCase(),
      newPassword: nextPassword,
    }).expect(409);
    expect(
      await database.user.findUniqueOrThrow({ where: { id: account.user.id } }),
    ).toEqual(before);
    await me(account).expect(200);
    await refresh(account.cookie).expect(200);
    await me(other).expect(200);
    await login(account.user.email, password).expect(200);
    await login(account.user.email, nextPassword).expect(401);
  });

  it.each([
    {},
    { email: 'new@example.test' },
    { currentPassword: password },
    { currentPassword: '', email: 'new@example.test' },
    { currentPassword: password, email: null },
    { currentPassword: password, email: 'invalid' },
    { currentPassword: password, email: 123 },
    { currentPassword: password, newPassword: 'short' },
    { currentPassword: password, newPassword: 'x'.repeat(129) },
    { currentPassword: password, newPassword: null },
    { currentPassword: password, password: nextPassword },
    {
      currentPassword: password,
      newPassword: nextPassword,
      userId: randomUUID(),
    },
    {
      currentPassword: password,
      email: 'new@example.test',
      preferredExercises: [],
    },
    { currentPassword: password, exerciseGoals: [] },
    { currentPassword: password, currentFitness: {} },
    { currentPassword: password, fitnessGoals: [] },
    { currentPassword: password, balance: 100 },
    { currentPassword: password, isOnboarded: true },
    { currentPassword: password, currentCurriculum: {} },
  ])(
    'rejects invalid, retired, or server-managed input without mutating credentials: %j',
    async (input) => {
      const account = await register();
      const before = await database.user.findUniqueOrThrow({
        where: { id: account.user.id },
      });
      const response = await patch(account, input).expect(400);
      expect(JSON.stringify(response.body)).not.toContain(password);
      expect(
        await database.user.findUniqueOrThrow({
          where: { id: account.user.id },
        }),
      ).toEqual(before);
      await me(account).expect(200);
    },
  );

  it('requires authentication, CSRF/Origin checks and rate-limited password confirmation', async () => {
    const account = await register();
    const input = { currentPassword: password, newPassword: nextPassword };
    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('X-CSRF-Protection', '1')
      .send(input)
      .expect(401);
    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${account.access_token}`)
      .send(input)
      .expect(403);
    await patch(account, input)
      .set('Origin', 'https://untrusted.example')
      .expect(403);
    for (let i = 0; i < 5; i++)
      await patch(account, { ...input, currentPassword: 'wrong' }).expect(401);
    const blocked = await patch(account, input).expect(429);
    expect(
      (blocked.body as { retry_after: number }).retry_after,
    ).toBeGreaterThan(0);
    await me(account).expect(200);
    await login(account.user.email).expect(200);
  });

  it.each([null, password, '$argon2id$broken'])(
    'does not bypass confirmation when the stored hash is unusable: %s',
    async (stored) => {
      const account = await register();
      await database.user.update({
        where: { id: account.user.id },
        data: { password: stored },
      });
      await patch(account, {
        currentPassword: password,
        newPassword: nextPassword,
      }).expect(401);
      expect(
        (
          await database.user.findUniqueOrThrow({
            where: { id: account.user.id },
          })
        ).password,
      ).toBe(stored);
    },
  );

  it('serializes two updates that verified the same old credentials', async () => {
    const account = await register();
    const passwords = app.get(PasswordService);
    const matches = passwords.matches.bind(passwords);
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi
      .spyOn(passwords, 'matches')
      .mockImplementation(async (hash, input) => {
        const valid = await matches(hash, input);
        arrived++;
        if (arrived === 2) release();
        await gate;
        return valid;
      });
    const emails = [
      `race-a-${randomUUID()}@example.test`,
      `race-b-${randomUUID()}@example.test`,
    ];
    try {
      const results = await Promise.all(
        emails.map((email) =>
          patch(account, { currentPassword: password, email }),
        ),
      );
      expect(
        results.map((result) => result.status).sort((a, b) => a - b),
      ).toEqual([204, 401]);
      expect(
        (
          await database.user.findUniqueOrThrow({
            where: { id: account.user.id },
          })
        ).email,
      ).toBe(emails[results.findIndex((result) => result.status === 204)]);
    } finally {
      release();
      spy.mockRestore();
    }
    await me(account).expect(401);
  });

  it('rejects a login verified before a concurrent credential change commits', async () => {
    const account = await register();
    const passwords = app.get(PasswordService);
    const matches = passwords.matches.bind(passwords);
    const spy = vi
      .spyOn(passwords, 'matches')
      .mockImplementationOnce(async (hash, input) => {
        const valid = await matches(hash, input);
        await patch(account, {
          currentPassword: password,
          newPassword: nextPassword,
        }).expect(204);
        return valid;
      });
    try {
      await login(account.user.email).expect(401);
    } finally {
      spy.mockRestore();
    }
    expect(
      await database.authSession.count({
        where: { userId: account.user.id, revokedAt: null },
      }),
    ).toBe(0);
    await login(account.user.email, nextPassword).expect(200);
  });

  it('keeps refresh rotation from restoring access after credential changes', async () => {
    const account = await register();
    const [changed, refreshed] = await Promise.all([
      patch(account, { currentPassword: password, newPassword: nextPassword }),
      refresh(account.cookie),
    ]);
    expect(changed.status).toBe(204);
    expect([200, 401]).toContain(refreshed.status);
    if (refreshed.status === 200) {
      const stale = asAccount(refreshed);
      await me(stale).expect(401);
      await refresh(stale.cookie).expect(401);
    }
    await me(account).expect(401);
  });

  it('lets only one account claim a unique email during concurrent changes', async () => {
    const first = await register();
    const second = await register();
    const email = `claimed-${randomUUID()}@example.test`;
    const results = await Promise.all([
      patch(first, { currentPassword: password, email }),
      patch(second, { currentPassword: password, email }),
    ]);
    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([204, 409]);
    await me(results[0].status === 409 ? first : second).expect(200);
    expect(await database.user.count({ where: { email } })).toBe(1);
  });
});
