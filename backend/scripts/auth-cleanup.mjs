import { config } from 'dotenv';
import pg from 'pg';

config({ quiet: true });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const url = new URL(process.env.DATABASE_URL);
const schema = url.searchParams.get('schema') ?? 'public';
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))
  throw new Error('Invalid database schema.');
url.searchParams.delete('schema');
const client = new pg.Client({
  connectionString: url.toString(),
  connectionTimeoutMillis: 5000,
});
try {
  await client.connect();
  // Retain consumed token hashes until the fixed session expiry, including revoked sessions.
  const sessions = await client.query(
    `DELETE FROM "${schema}".auth_sessions WHERE expires_at <= CURRENT_TIMESTAMP`,
  );
  const limits = await client.query(
    `DELETE FROM "${schema}".auth_rate_limits WHERE expires_at <= CURRENT_TIMESTAMP`,
  );
  console.log(
    `Removed ${sessions.rowCount} expired sessions and ${limits.rowCount} expired rate-limit windows.`,
  );
} finally {
  await client.end();
}
