import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service.js';
import { UserProfileService } from '../src/users/user-profile.service.js';

it('upgrades populated pre-feature storage without resetting accounts, measurements or sessions', async () => {
  const url = new URL(process.env.DATABASE_URL!);
  // Only the isolated runner can opt into creating this additional test schema.
  if (
    process.env.NODE_ENV !== 'test' ||
    !/^test_[a-f0-9]+$/.test(url.searchParams.get('schema') ?? '')
  )
    throw new Error('An isolated test schema is required.');
  const schema = `test_upgrade_${randomUUID().replaceAll('-', '')}`;
  url.searchParams.delete('schema');
  const client = new pg.Client({ connectionString: url.toString() });
  let database: DatabaseService | undefined;
  let created = false;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await client.query(`SET search_path TO "${schema}"`);
    const migrationRoot = new URL('../prisma/migrations/', import.meta.url);
    const extension = '20260921000100_user_features';
    const directories = (await readdir(migrationRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const name of directories.filter((name) => name < extension))
      await client.query(
        await readFile(new URL(`${name}/migration.sql`, migrationRoot), 'utf8'),
      );
    const owner = randomUUID();
    const emptyUser = randomUUID();
    const measurementId = randomUUID();
    const sessionId = randomUUID();
    const key = randomUUID();
    await client.query(
      'INSERT INTO users(id, email, password) VALUES ($1, $2, $3), ($4, $5, NULL)',
      [
        owner,
        `legacy-${owner}@example.test`,
        '$argon2id$legacy-test-fixture',
        emptyUser,
        `legacy-${emptyUser}@example.test`,
      ],
    );
    await client.query('BEGIN');
    await client.query(
      "INSERT INTO measurements(id, user_id, measured_on, age_at_measurement, catalog_version) VALUES ($1, $2, '2026-09-17', 25, 'nfa100-2026-09-19')",
      [measurementId, owner],
    );
    await client.query(
      "INSERT INTO measurement_items(measurement_id, catalog_version, code, value, unit) VALUES ($1, 'nfa100-2026-09-19', 'reaction_time', '0.301234567890123456789', '초')",
      [measurementId],
    );
    await client.query('COMMIT');
    await client.query(
      "INSERT INTO measurement_create_requests(user_id, key, request_hash, measurement_id) VALUES ($1, $2, repeat('a', 64), $3)",
      [owner, key, measurementId],
    );
    await client.query(
      "INSERT INTO auth_sessions(id, user_id, expires_at) VALUES ($1, $2, CURRENT_TIMESTAMP + interval '7 days')",
      [sessionId, owner],
    );
    await client.query(
      "INSERT INTO auth_refresh_tokens(token_hash, session_id) VALUES (repeat('b', 64), $1)",
      [sessionId],
    );
    const accountBefore = (
      await client.query('SELECT * FROM users ORDER BY id')
    ).rows as unknown[];
    const measurementBefore = (await client.query('SELECT * FROM measurements'))
      .rows as unknown[];
    const itemsBefore = (await client.query('SELECT * FROM measurement_items'))
      .rows as unknown[];
    const sessionsBefore = (await client.query('SELECT * FROM auth_sessions'))
      .rows as unknown[];
    for (const name of directories.filter((name) => name >= extension))
      await client.query(
        await readFile(new URL(`${name}/migration.sql`, migrationRoot), 'utf8'),
      );
    expect(
      (
        await client.query(
          'SELECT id, email, password, created_at, updated_at FROM users ORDER BY id',
        )
      ).rows,
    ).toEqual(accountBefore);
    expect((await client.query('SELECT * FROM measurements')).rows).toEqual(
      measurementBefore,
    );
    expect(
      (await client.query('SELECT * FROM measurement_items')).rows,
    ).toEqual(itemsBefore);
    expect((await client.query('SELECT * FROM auth_sessions')).rows).toEqual(
      sessionsBefore,
    );
    expect(
      (await client.query('SELECT * FROM auth_refresh_tokens')).rowCount,
    ).toBe(1);
    expect(
      (await client.query('SELECT * FROM measurement_create_requests'))
        .rowCount,
    ).toBe(1);
    expect(
      (
        await client.query(
          'SELECT user_id, balance FROM user_currencies ORDER BY user_id',
        )
      ).rows,
    ).toEqual(
      [owner, emptyUser].sort().map((user_id) => ({ user_id, balance: 0 })),
    );
    url.searchParams.set('schema', schema);
    database = new DatabaseService(
      new ConfigService({ DATABASE_URL: url.toString() }),
    );
    await database.onModuleInit();
    const profiles = new UserProfileService(database);
    expect(await profiles.get(owner)).toMatchObject({
      id: owner,
      preferredExercises: [],
      exerciseGoals: [],
      currency: { balance: 0 },
      isOnboarded: true,
      currentFitness: {
        id: measurementId,
        items: [{ value: '0.301234567890123456789' }],
      },
      fitnessGoals: [],
      currentCurriculum: null,
    });
    expect(await profiles.get(emptyUser)).toMatchObject({
      isOnboarded: false,
      currentFitness: null,
      currency: { balance: 0 },
    });
    expect(await database.workoutCurriculum.count()).toBe(0);
    await database.measurement.delete({ where: { id: measurementId } });
    expect(await profiles.get(owner)).toMatchObject({
      isOnboarded: false,
      currentFitness: null,
    });
  } finally {
    await database?.onModuleDestroy();
    // Clear a failed transaction before removing only this test's own schema.
    await client.query('ROLLBACK');
    if (created) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    await client.end();
  }
}, 30_000);
