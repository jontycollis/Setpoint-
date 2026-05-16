// ── venueTimeZone + parseScheduleTime unit tests ───────────────────────────
//
// Pure-function coverage for the tz-handling overhaul:
//   • `tzForCanadianProvince` — province / state → IANA tz lookup
//   • `tzForVenueAddress` — heuristic fallback over free-text addresses
//   • `parseScheduleTime` — three branches (suffixed UTC, suffixed offset,
//     no-suffix + venue tz, no-suffix no tz)
//
// These run in Node via vitest, no React Native runtime needed.
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { tzForCanadianProvince, tzForVenueAddress } from '../venueTimeZone';
import { parseScheduleTime } from '../dates';

describe('tzForCanadianProvince', () => {
  it('maps Ontario (ON) to America/Toronto', () => {
    expect(tzForCanadianProvince('ON')).toBe('America/Toronto');
  });

  it('maps British Columbia (BC) to America/Vancouver', () => {
    expect(tzForCanadianProvince('BC')).toBe('America/Vancouver');
  });

  it('maps Alberta (AB) to America/Edmonton', () => {
    expect(tzForCanadianProvince('AB')).toBe('America/Edmonton');
  });

  it('maps New York (NY) to America/New_York', () => {
    expect(tzForCanadianProvince('NY')).toBe('America/New_York');
  });

  it('is case-insensitive (accepts lowercase "on")', () => {
    expect(tzForCanadianProvince('on')).toBe('America/Toronto');
  });

  it('returns null for unknown codes', () => {
    expect(tzForCanadianProvince('ZZ')).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(tzForCanadianProvince('')).toBeNull();
  });
});

describe('tzForVenueAddress', () => {
  it('finds Toronto by city name', () => {
    expect(tzForVenueAddress('123 Main St, Toronto, ON M1A 1A1')).toBe(
      'America/Toronto'
    );
  });

  it('finds Vancouver via the city keyword', () => {
    expect(tzForVenueAddress('Vancouver Convention Centre')).toBe(
      'America/Vancouver'
    );
  });

  it('falls back to province code in postal-style address', () => {
    // No matching city — relies on ", ON " token.
    expect(tzForVenueAddress('Random Hall, Brampton, ON L6V 2A1')).toBe(
      'America/Toronto'
    );
  });

  it('returns null when nothing matches', () => {
    expect(tzForVenueAddress('Some unknown venue in Outer Space')).toBeNull();
  });
});

describe('parseScheduleTime', () => {
  it('honours an explicit Z (UTC) suffix', () => {
    const ms = parseScheduleTime('2026-05-24T13:00:00Z', 'America/Toronto');
    expect(ms).toBe(Date.UTC(2026, 4, 24, 13, 0, 0));
  });

  it('honours an explicit +/- offset suffix', () => {
    // 2026-05-24T09:00:00-04:00 = 2026-05-24T13:00:00Z (EDT offset)
    const ms = parseScheduleTime('2026-05-24T09:00:00-04:00');
    expect(ms).toBe(Date.UTC(2026, 4, 24, 13, 0, 0));
  });

  it('parses no-suffix wall time as venue tz (Toronto, EDT in May)', () => {
    // 9 AM in Toronto on 2026-05-24 = 13:00 UTC (EDT = UTC-4 in May).
    const ms = parseScheduleTime('2026-05-24T09:00:00', 'America/Toronto');
    expect(ms).toBe(Date.UTC(2026, 4, 24, 13, 0, 0));
  });

  it('parses no-suffix wall time as Vancouver tz (PDT in May = UTC-7)', () => {
    // 9 AM in Vancouver on 2026-05-24 = 16:00 UTC (PDT = UTC-7 in May).
    const ms = parseScheduleTime('2026-05-24T09:00:00', 'America/Vancouver');
    expect(ms).toBe(Date.UTC(2026, 4, 24, 16, 0, 0));
  });

  it('falls back to Date.parse when no suffix and no venue tz', () => {
    // No-suffix → device-local. The test runner is on a known tz, so we
    // just assert the result is finite and matches Date.parse exactly
    // (rather than depending on the runner's tz). __DEV__ warning fires
    // in dev mode only — tests run as production-like via Node.
    const ms = parseScheduleTime('2026-05-24T09:00:00');
    expect(ms).not.toBeNull();
    expect(ms).toBe(Date.parse('2026-05-24T09:00:00'));
  });

  it('returns null for empty / nullish input', () => {
    expect(parseScheduleTime('')).toBeNull();
    expect(parseScheduleTime(null)).toBeNull();
    expect(parseScheduleTime(undefined)).toBeNull();
    expect(parseScheduleTime('not a date', 'America/Toronto')).toBeNull();
  });
});
