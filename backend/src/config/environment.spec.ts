import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './environment.js';

describe('Environment configuration', () => {
  it('starts locally without an environment file', () => {
    expect(validateEnvironment({})).toEqual({
      NODE_ENV: 'development',
      PORT: 3001,
      FRONTEND_ORIGIN: 'http://localhost:3000',
    });
  });

  it('converts the environment port into a TCP port number', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'production',
        PORT: '4000',
        FRONTEND_ORIGIN: 'https://example.com',
      }),
    ).toEqual({
      NODE_ENV: 'production',
      PORT: 4000,
      FRONTEND_ORIGIN: 'https://example.com',
    });
  });

  it.each(['', 'abc', '0', '-1', '65536', '3001.5'])(
    'rejects an invalid port: %s',
    (PORT) => {
      expect(() => validateEnvironment({ PORT })).toThrow('PORT');
    },
  );

  it.each([
    '*',
    '',
    'file:///tmp',
    'https://example.com/path',
    'http://localhost:3000/',
  ])('rejects an invalid frontend origin: %s', (FRONTEND_ORIGIN) => {
    expect(() => validateEnvironment({ FRONTEND_ORIGIN })).toThrow(
      'FRONTEND_ORIGIN',
    );
  });

  it('rejects a misspelled runtime environment', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'prod' })).toThrow('NODE_ENV');
  });
});
