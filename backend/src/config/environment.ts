export function validateEnvironment(config: Record<string, unknown>) {
  const nodeEnv = config.NODE_ENV ?? 'development';
  if (
    typeof nodeEnv !== 'string' ||
    !['development', 'production', 'test'].includes(nodeEnv)
  ) {
    throw new Error('NODE_ENV must be development, production, or test.');
  }

  const port = Number(config.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const frontendOrigin = config.FRONTEND_ORIGIN ?? 'http://localhost:3000';
  if (typeof frontendOrigin !== 'string') {
    throw new Error('FRONTEND_ORIGIN must be a valid HTTP(S) origin.');
  }
  let url: URL;
  try {
    url = new URL(frontendOrigin);
  } catch {
    throw new Error('FRONTEND_ORIGIN must be a valid HTTP(S) origin.');
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== frontendOrigin
  ) {
    throw new Error(
      'FRONTEND_ORIGIN must be an HTTP(S) origin without a path or trailing slash.',
    );
  }

  return {
    ...config,
    NODE_ENV: nodeEnv,
    PORT: port,
    FRONTEND_ORIGIN: frontendOrigin,
  };
}
