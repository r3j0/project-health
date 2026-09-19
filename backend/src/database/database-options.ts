/** Shared by runtime and integration tests; never print the credential-bearing URL. */
export function databaseOptions(connectionString: string) {
  const url = new URL(connectionString);
  const schema = url.searchParams.get('schema') ?? 'public';
  url.searchParams.delete('schema');

  return {
    connectionString: url.toString(),
    schema,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
  };
}
