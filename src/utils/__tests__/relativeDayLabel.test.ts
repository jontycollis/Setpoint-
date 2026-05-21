// ── relativeDayLabel + calendarDayKey unit tests ──────────────────────────
//
// Exercises the tz-stable day-label helpers used by the Team Dashboard chip
// row. The fix-in-context: a team whose tournament starts tomorrow used to
// see a stale hardcoded "Yesterday" chip even with no past matches. These
// tests pin the label boundaries and verify the tz anchoring so a 9 AM
// Calgary match labels as "Tomorrow" for an Eastern user even when their
// device clock hasn't crossed midnight yet.
// ──────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { calendarDayKey, calendarDayDiff, relativeDayLabel } from '../dates';

const MT = 'America/Edmonton';
const ET = 'America/Toronto';

function ms(iso: string, zone: string): number {
  return DateTime.fromISO(iso, { zone }).toMillis();
}

describe('calendarDayKey', () => {
  it('returns YYYY-MM-DD in the requested zone', () => {
    // 2026-05-22 14:50 in Calgary (MT) → 16:50 in Toronto (ET) → still May 22 in both
    const m = ms('2026-05-22T14:50:00', MT);
    expect(calendarDayKey(m, MT)).toBe('2026-05-22');
    expect(calendarDayKey(m, ET)).toBe('2026-05-22');
  });

  it('crosses midnight correctly between zones', () => {
    // 2026-05-21 22:30 Calgary (MT) = 2026-05-22 00:30 Toronto (ET)
    const m = ms('2026-05-21T22:30:00', MT);
    expect(calendarDayKey(m, MT)).toBe('2026-05-21');
    expect(calendarDayKey(m, ET)).toBe('2026-05-22');
  });

  it('returns empty string for non-finite input', () => {
    expect(calendarDayKey(NaN)).toBe('');
    expect(calendarDayKey(Infinity)).toBe('');
  });
});

describe('calendarDayDiff', () => {
  it('returns +1 for tomorrow', () => {
    const now = ms('2026-05-21T23:08:00', ET); // 11:08 PM ET, the screenshot moment
    const target = ms('2026-05-22T14:50:00', MT); // tomorrow's Calgary match
    expect(calendarDayDiff(now, target, MT)).toBe(1);
    expect(calendarDayDiff(now, target, ET)).toBe(1);
  });

  it('returns -1 for yesterday', () => {
    const now = ms('2026-05-21T11:00:00', ET);
    const target = ms('2026-05-20T09:00:00', ET);
    expect(calendarDayDiff(now, target, ET)).toBe(-1);
  });

  it('returns 0 for same calendar day even across 24h windows', () => {
    const now = ms('2026-05-21T00:30:00', ET);
    const target = ms('2026-05-21T23:30:00', ET);
    expect(calendarDayDiff(now, target, ET)).toBe(0);
  });
});

describe('relativeDayLabel', () => {
  // Anchor "now" at the screenshot moment: 11:08 PM ET on 2026-05-21.
  const now = ms('2026-05-21T23:08:00', ET);

  it('labels a same-day match as "Today"', () => {
    const target = ms('2026-05-21T18:00:00', ET);
    expect(relativeDayLabel(target, now, ET)).toBe('Today');
  });

  it('labels a +1 day match as "Tomorrow" (the original bug — was "Yesterday")', () => {
    // The exact case from the bug report: device on ET, match in Calgary,
    // dated Fri May 22 2:50 PM venue-local.
    const target = ms('2026-05-22T14:50:00', MT);
    expect(relativeDayLabel(target, now, MT)).toBe('Tomorrow');
    expect(relativeDayLabel(target, now, ET)).toBe('Tomorrow');
  });

  it('labels a -1 day match as "Yesterday"', () => {
    const target = ms('2026-05-20T18:00:00', ET);
    expect(relativeDayLabel(target, now, ET)).toBe('Yesterday');
  });

  it('uses a short weekday name for days 2..6 in either direction', () => {
    const tPlus2 = ms('2026-05-23T10:00:00', ET); // Sat
    const tPlus6 = ms('2026-05-27T10:00:00', ET); // Wed
    const tMinus2 = ms('2026-05-19T10:00:00', ET); // Tue
    expect(relativeDayLabel(tPlus2, now, ET)).toBe('Sat');
    expect(relativeDayLabel(tPlus6, now, ET)).toBe('Wed');
    expect(relativeDayLabel(tMinus2, now, ET)).toBe('Tue');
  });

  it('falls back to short date for days more than a week out', () => {
    const tPlus8 = ms('2026-05-29T10:00:00', ET);
    // "May 29" — locale-formatted; just confirm it's not a weekday label.
    const label = relativeDayLabel(tPlus8, now, ET);
    expect(label).toMatch(/May\s*29/);
  });

  it('is tz-stable across the ET-vs-MT midnight crossover', () => {
    // It's 11:08 PM ET on May 21 (the screenshot). In Calgary it's 9:08 PM
    // on May 21. A 9 AM Calgary match on May 22 must read "Tomorrow" no
    // matter which side of the device-local midnight we anchor in.
    const target = ms('2026-05-22T09:00:00', MT);
    expect(relativeDayLabel(target, now, MT)).toBe('Tomorrow');
    expect(relativeDayLabel(target, now, ET)).toBe('Tomorrow');
  });
});
