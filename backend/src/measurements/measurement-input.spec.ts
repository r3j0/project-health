import { describe, expect, it } from 'vitest';
import { koreaDate, parseCreate, parseRevision } from './measurement-input.js';

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
