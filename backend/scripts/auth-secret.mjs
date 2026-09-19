import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.env.NODE_ENV === 'production') {
  throw new Error(
    'Set AUTH_JWT_SECRET through the deployment secret manager in production.',
  );
}
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
if (/^AUTH_JWT_SECRET=.+/m.test(existing)) {
  console.log('Existing AUTH_JWT_SECRET preserved.');
} else {
  const line = `AUTH_JWT_SECRET=${randomBytes(32).toString('hex')}`;
  const updated = /^AUTH_JWT_SECRET=/m.test(existing)
    ? existing.replace(/^AUTH_JWT_SECRET=.*$/m, line)
    : `${existing}\n${line}\n`;
  writeFileSync(envPath, updated, { mode: 0o600 });
  console.log('Generated AUTH_JWT_SECRET in backend/.env without printing it.');
}
