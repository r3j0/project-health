import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';

const root = fileURLToPath(new URL('..', import.meta.url));
config({ path: path.join(root, '.env'), quiet: true });
const databaseUrl = new URL(process.env.DATABASE_URL);
const settings = JSON.parse(
  readFileSync(path.join(root, '.local/postgres-settings.json'), 'utf8'),
);
// This explicitly invoked fixture is restricted to this project's local cluster.
assert.notEqual(
  process.env.NODE_ENV,
  'production',
  'Demo data is development-only.',
);
assert.equal(databaseUrl.hostname, '127.0.0.1');
assert.equal(databaseUrl.port, String(settings.port));
assert.equal(databaseUrl.pathname, '/project_health');
assert.equal(databaseUrl.searchParams.get('schema') ?? 'public', 'public');
assert.ok(
  decodeURIComponent(databaseUrl.username) === settings.user &&
    decodeURIComponent(databaseUrl.password) === settings.password,
  'The demo must use this project’s local database credentials.',
);

const directory = path.join(root, '.local/measurement-demo');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const credentialsPath = path.join(directory, 'credentials.json');
const inputPath = path.join(directory, 'input.json');
const statePath = path.join(directory, 'state.json');
const save = (file, value) =>
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
if (!existsSync(credentialsPath))
  save(credentialsPath, {
    email: `demo-measurement-${randomUUID()}@example.test`,
    password: randomBytes(32).toString('base64url'),
  });
const credentials = read(credentialsPath);
assert.match(credentials.email, /^demo-measurement-[a-f0-9-]+@example\.test$/);
if (!existsSync(statePath)) save(statePath, { requestKey: randomUUID() });
const state = read(statePath);

const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const child = spawn(process.execPath, ['dist/main.js'], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(port),
    AUTH_COOKIE_SAME_SITE: 'lax',
    TRUST_PROXY_CIDRS: '',
  },
  stdio: 'ignore',
});
const base = `http://127.0.0.1:${port}/api/v1`;
let accessToken;
let database;

async function call(route, method = 'GET', body, headers = {}) {
  const response = await fetch(base + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Protection': '1',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(
      `${method} ${route}: HTTP ${response.status}. No demo success is reported.`,
    );
  return {
    status: response.status,
    body: response.status === 204 ? null : await response.json(),
  };
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(
      child.exitCode,
      null,
      'Demo API exited. Check the normal server startup and migrations.',
    );
    try {
      ready = (
        await fetch(base + '/health/ready', {
          signal: AbortSignal.timeout(1000),
        })
      ).ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(
    ready,
    true,
    'Start the local database and apply migrations first.',
  );

  let auth;
  if (state.userId) {
    auth = await call('/auth/login', 'POST', credentials);
  } else {
    const registration = await fetch(base + '/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
      body: JSON.stringify(credentials),
      signal: AbortSignal.timeout(10_000),
    });
    if (registration.status === 409)
      auth = await call('/auth/login', 'POST', credentials);
    else {
      assert.equal(
        registration.status,
        201,
        'Demo account registration failed.',
      );
      auth = { body: await registration.json() };
    }
    state.userId = auth.body.user.id;
    save(statePath, state);
  }
  accessToken = auth.body.access_token;
  assert.equal(auth.body.user.id, state.userId);

  if (!existsSync(inputPath)) {
    const catalog = (await call('/measurement-catalog?age=25')).body;
    // Synthetic inputs only: no fabricated scores or successful API responses.
    save(inputPath, {
      catalogVersion: catalog.version,
      measuredOn: new Date(Date.now() + 9 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
      ageAtMeasurement: 25,
      sexAtMeasurement: null,
      reportKind: 'unknown',
      centerName: '[개발용 더미] 실제 측정 아님',
      items: [
        { measurementCode: 'height', value: '175.2', unit: 'cm' },
        { measurementCode: 'weight', value: '72.4', unit: 'kg' },
        { measurementCode: 'relative_grip_strength', value: '58.3', unit: '%' },
        { measurementCode: 'cross_sit_up', value: '0', unit: '회' },
        { measurementCode: 'shuttle_run_20m', value: '42', unit: '회' },
        { measurementCode: 'sit_and_reach', value: '-3.25', unit: 'cm' },
        {
          measurementCode: 'reaction_time',
          value: '0.301234567890123456789',
          unit: '초',
        },
      ],
    });
  }
  const input = read(inputPath);
  const created = await call('/measurements', 'POST', input, {
    'Idempotency-Key': state.requestKey,
  });
  state.measurementId = created.body.id;
  save(statePath, state);
  const record = (await call(`/measurements/${state.measurementId}`)).body;
  save(path.join(directory, 'record.json'), record);
  assert.equal(record.centerName, input.centerName);
  assert.equal(record.items.length, input.items.length);
  for (const item of input.items) {
    const stored = record.items.find(
      (value) => value.measurementCode === item.measurementCode,
    );
    assert.equal(stored?.value, item.value);
    assert.equal(stored?.unit, item.unit);
  }
  assert.equal(record.evaluation.status, 'not_evaluated');
  assert.ok(record.missingMeasurementCodes.includes('bmi'));
  const retry = await call('/measurements', 'POST', input, {
    'Idempotency-Key': state.requestKey,
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.id, state.measurementId);

  databaseUrl.searchParams.delete('schema');
  database = new pg.Client({
    connectionString: databaseUrl.toString(),
    connectionTimeoutMillis: 5000,
  });
  await database.connect();
  const verification = await database.query(
    'SELECT m.user_id, i.code, i.value::text AS value FROM public.measurements m JOIN public.measurement_items i ON i.measurement_id = m.id WHERE m.id = $1',
    [state.measurementId],
  );
  assert.equal(verification.rows.length, input.items.length);
  for (const row of verification.rows) {
    assert.equal(row.user_id, state.userId);
    assert.equal(
      row.value,
      input.items.find((item) => item.measurementCode === row.code)?.value,
    );
  }
  const count = await database.query(
    'SELECT count(*)::int AS count FROM public.measurements WHERE user_id = $1',
    [state.userId],
  );
  assert.equal(count.rows[0].count, 1);
  save(path.join(directory, 'verification.json'), {
    kind: 'synthetic_local_fixture',
    checkedAt: new Date().toISOString(),
    email: credentials.email,
    userId: state.userId,
    measurementId: state.measurementId,
    itemCount: record.items.length,
    missingMeasurementCodes: record.missingMeasurementCodes,
    checks: [
      'API create/read matches input',
      'database rows match API',
      'zero/negative/decimal values preserved',
      'BMI left missing',
      'retry created no duplicate',
    ],
  });
  console.log(
    JSON.stringify(
      {
        email: credentials.email,
        userId: state.userId,
        measurementId: state.measurementId,
        itemCount: record.items.length,
        resultFile: path.join(directory, 'record.json'),
      },
      null,
      2,
    ),
  );
} finally {
  try {
    if (accessToken) await call('/auth/logout', 'POST');
  } finally {
    try {
      await database?.end();
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const stopped = new Promise((resolve) => child.once('exit', resolve));
        child.kill('SIGTERM');
        await stopped;
      }
    }
  }
}
