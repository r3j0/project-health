import { describe, expect, it } from 'vitest';
import {
  decodeCursor,
  encodeCursor,
  koreaDate,
  parseCreate,
  parseRevision,
} from './measurement-input.js';

describe('Measurement date and precision boundaries', () => {
  const valid = {
    measuredOn: '2024-02-29',
    ageAtMeasurement: 25,
    catalogVersion: 'test',
    items: [
      {
        measurementCode: 'reaction_time',
        value: '0.301234567890123456789',
        unit: '초',
      },
    ],
  };

  it('uses midnight in Korea when determining the current date', () => {
    expect(koreaDate(new Date('2026-09-18T14:59:59.999Z'))).toBe('2026-09-18');
    expect(koreaDate(new Date('2026-09-18T15:00:00.000Z'))).toBe('2026-09-19');
  });

  it('preserves decimal precision and never parses a numeric JSON value silently', () => {
    expect(parseCreate(valid).items[0].value).toBe('0.301234567890123456789');
    expect(() =>
      parseCreate({ ...valid, items: [{ ...valid.items[0], value: 0.301 }] }),
    ).toThrow();
  });

  it.each([
    '2023-02-29',
    '2026-04-31',
    '0000-01-01',
    '2026-9-1',
    '2024-02-29T00:00:00Z',
  ])('rejects an invalid date-only value: %s', (measuredOn) => {
    expect(() => parseCreate({ ...valid, measuredOn })).toThrow();
  });

  it('requires a strong numeric revision rather than an unconditional write', () => {
    expect(parseRevision('"3"')).toBe(3);
    for (const revision of [
      undefined,
      '*',
      'W/"1"',
      '1',
      '"0"',
      '"2147483648"',
    ]) {
      expect(() => parseRevision(revision)).toThrow();
    }
  });
});

describe('Measurement list cursors', () => {
  const cursor = {
    v: 2 as const,
    measuredOn: '2026-09-17',
    createdAt: '2026-09-24T00:00:00.123456Z',
    id: '00000000-0000-4000-8000-000000000001',
  };

  it('preserves the full PostgreSQL timestamp through a cursor round trip', () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('continues to accept the original date/ID cursor format', () => {
    const legacy = {
      v: 1 as const,
      measuredOn: cursor.measuredOn,
      id: cursor.id,
    };
    expect(decodeCursor(encodeCursor(legacy))).toEqual(legacy);
  });

  it.each([
    { createdAt: undefined },
    { createdAt: '0000-09-24T00:00:00.123456Z' },
    { createdAt: '2026-02-30T00:00:00.123456Z' },
    { createdAt: '2026-09-24T00:00:00.123Z' },
    { createdAt: '2026-09-24T00:00:00.1234567Z' },
    { createdAt: '2026-09-24T00:00:00.123456+09:00' },
    { createdAt: "2026-09-24'; SELECT 1; --" },
    { v: 3 },
    { userId: cursor.id },
  ])('rejects a malformed versioned boundary: %j', (override) => {
    const value = Buffer.from(
      JSON.stringify({ ...cursor, ...override }),
    ).toString('base64url');
    expect(() => decodeCursor(value)).toThrow();
  });
});
