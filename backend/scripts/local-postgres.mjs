import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

// A development-only, password-protected cluster owned by this backend directory.
const root = fileURLToPath(new URL('..', import.meta.url));
const local = path.join(root, '.local');
const data = path.join(local, 'postgres');
const settingsPath = path.join(local, 'postgres-settings.json');
const command = process.argv[2] ?? 'start';
if (
  !['start', 'stop'].includes(command) ||
  process.env.NODE_ENV === 'production'
) {
  throw new Error(
    'Usage: node scripts/local-postgres.mjs start|stop (development only).',
  );
}

function run(binary, args, quiet = false) {
  const result = spawnSync(binary, args, {
    cwd: root,
    stdio: quiet ? 'ignore' : 'inherit',
    timeout: 60_000,
  });
  if (result.error)
    throw new Error(`${binary} is required on PATH: ${result.error.message}`);
  return result.status ?? 1;
}

function mustRun(binary, args) {
  if (run(binary, args) !== 0)
    throw new Error(`${binary} failed. See output above.`);
}

if (command === 'stop') {
  if (
    existsSync(settingsPath) &&
    existsSync(path.join(data, 'PG_VERSION')) &&
    run('pg_ctl', ['-D', data, 'status'], true) === 0
  ) {
    mustRun('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
  }
} else {
  mkdirSync(local, { recursive: true, mode: 0o700 });
  if (!existsSync(settingsPath)) {
    if (existsSync(data))
      throw new Error(
        'Unmanaged .local/postgres directory exists; refusing to initialize it.',
      );
    const port = Number(process.env.LOCAL_POSTGRES_PORT ?? 15432);
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error('Invalid LOCAL_POSTGRES_PORT.');
    writeFileSync(
      settingsPath,
      JSON.stringify({
        port,
        user: 'project_health',
        password: randomBytes(32).toString('hex'),
      }),
      { mode: 0o600, flag: 'wx' },
    );
  }
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  if (!existsSync(path.join(data, 'PG_VERSION'))) {
    const passwordFile = path.join(local, 'postgres-password');
    writeFileSync(passwordFile, settings.password + '\n', { mode: 0o600 });
    mustRun('initdb', [
      '-D',
      data,
      '-U',
      settings.user,
      '--auth=scram-sha-256',
      '--pwfile',
      passwordFile,
      '--encoding=UTF8',
      '--locale=C',
    ]);
  }
  if (run('pg_ctl', ['-D', data, 'status'], true) !== 0) {
    mustRun('pg_ctl', [
      '-D',
      data,
      '-l',
      path.join(local, 'postgres.log'),
      '-o',
      `-h 127.0.0.1 -p ${settings.port} -c unix_socket_directories=''`,
      '-w',
      'start',
    ]);
  }
  const connection = {
    host: '127.0.0.1',
    port: settings.port,
    user: settings.user,
    password: settings.password,
    database: 'postgres',
    connectionTimeoutMillis: 5_000,
  };
  const client = new pg.Client(connection);
  try {
    await client.connect();
    for (const database of ['project_health', 'project_health_test']) {
      const result = await client.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [database],
      );
      if (result.rowCount === 0)
        await client.query(`CREATE DATABASE "${database}"`);
    }
  } finally {
    await client.end();
  }
  const envPath = path.join(root, '.env');
  if (!existsSync(envPath)) {
    const base = `postgresql://${settings.user}:${settings.password}@127.0.0.1:${settings.port}`;
    writeFileSync(
      envPath,
      `NODE_ENV=development\nPORT=3001\nFRONTEND_ORIGIN=http://localhost:3000\nDATABASE_URL=${base}/project_health?schema=public\nTEST_DATABASE_URL=${base}/project_health_test?schema=public\n`,
      { mode: 0o600, flag: 'wx' },
    );
    console.log(
      'Created backend/.env with generated local database credentials.',
    );
  } else {
    console.log(
      'Existing backend/.env preserved. Local credentials are in .local/postgres-settings.json.',
    );
  }
  console.log(
    `Local PostgreSQL is available on 127.0.0.1:${settings.port}. Run npm run db:migrate:deploy.`,
  );
}
