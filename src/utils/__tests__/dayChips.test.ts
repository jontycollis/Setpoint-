// ── buildDayChips tests ───────────────────────────────────────────────────
//
// Pins the chip-row behaviour that drives the TeamDashboard day filter.
// Covers today / tomorrow / day-after / day-before so the off-by-one that
// previously shipped ("Yesterday" chip showing a future-day's matches)
// can't return without a failing test.
// ──────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { buildDayChips, type DayChipMatch } from '../dayChips';

const ET = 'America/Toronto';

function isoAt(zone: string, iso: string): number {
  return DateTime.fromISO(iso, { zone }).toMillis();
}

/** Anchor "now" mid-day to avoid edge effects around midnight. */
const NOW = isoAt(ET, '2026-05-22T12:00:00');

function match(scheduledLocal: string, done = false): DayChipMatch {
  return {
    ScheduledStartDateTime: scheduledLocal,
    HasScores: done,
    FirstTeamWon: done,
  };
}

describe('buildDayChips', () => {
  it('labels today, tomorrow and day-after correctly', () => {
    const matches: DayChipMatch[] = [
      match('2026-05-22T13:00:00'), // Today, 1 PM ET
      match('2026-05-23T09:00:00'), // Tomorrow
      match('2026-05-24T09:00:00'), // Day after
    ];
    const chips = buildDayChips(matches, NOW, ET, ET);
    // First chip is "All Days" because we have >1 day represented.
    expect(chips[0]).toMatchObject({ key: 'all', label: 'All Days', diff: null });
    // 2026-05-22 ET is a Friday, so day-after-tomorrow is Sunday.
    expect(chips.slice(1).map((c) => c.label)).toEqual(['Today', 'Tomorrow', 'Sun']);
    expect(chips.slice(1).map((c) => c.diff)).toEqual([0, 1, 2]);
  });

  it('day-before with a completed match keeps a Yesterday chip', () => {
    // Past-day chips only render when there's real past data underneath.
    // A completed match yesterday produces a chip; a non-completed match
    // yesterday is stale and gets dropped.
    const matches: DayChipMatch[] = [
      match('2026-05-21T18:00:00', true), // Yesterday, completed
      match('2026-05-23T09:00:00'),       // Tomorrow, scheduled
    ];
    const chips = buildDayChips(matches, NOW, ET, ET);
    expect(chips.map((c) => c.label)).toEqual(['All Days', 'Yesterday', 'Tomorrow']);
    const past = chips.find((c) => c.label === 'Yesterday')!;
    const future = chips.find((c) => c.label === 'Tomorrow')!;
    expect(past.diff).toBe(-1);
    expect(future.diff).toBe(1);
  });

  it('drops a stale non-completed match from the day-before (excluded)', () => {
    // The very case the user wants protected: a forgotten not-marked-done
    // match from yesterday must NOT produce a "Yesterday" chip on a
    // future-only surface. The 30-min stale-cutoff filters it.
    const matches: DayChipMatch[] = [
      match('2026-05-21T18:00:00'), // Yesterday, NOT done (stale)
      match('2026-05-23T09:00:00'), // Tomorrow
    ];
    const chips = buildDayChips(matches, NOW, ET, ET);
    // Only the future chip should remain — no "All Days" because just one day.
    expect(chips.length).toBe(1);
    expect(chips[0]).toMatchObject({ key: '2026-05-23', label: 'Tomorrow', diff: 1 });
  });

  it('handles a tomorrow-only schedule with a single chip (no All Days)', () => {
    const matches: DayChipMatch[] = [match('2026-05-23T09:00:00')];
    const chips = buildDayChips(matches, NOW, ET, ET);
    expect(chips.length).toBe(1);
    expect(chips[0].label).toBe('Tomorrow');
    expect(chips[0].diff).toBe(1);
  });

  it('is tz-stable across the ET-vs-MT midnight crossover', () => {
    // It's 11:08 PM ET on May 21. In Calgary it's 9:08 PM on May 21.
    // A 9 AM Calgary match on May 22 must read "Tomorrow" regardless of
    // which side of the device-local midnight we sit on.
    const nowET = isoAt(ET, '2026-05-21T23:08:00');
    const MT = 'America/Edmonton';
    const matches: DayChipMatch[] = [
      // Calgary-local 9 AM, ingested with no tz suffix — parseScheduleTime
      // interprets it as wall time at the venue.
      { ScheduledStartDateTime: '2026-05-22T09:00:00', HasScores: false },
    ];
    expect(buildDayChips(matches, nowET, MT, MT)[0].label).toBe('Tomorrow');
    expect(buildDayChips(matches, nowET, MT, ET)[0].label).toBe('Tomorrow');
  });

  it('returns an empty list when every match is stale and not done', () => {
    const matches: DayChipMatch[] = [
      match('2026-05-19T09:00:00'),
      match('2026-05-20T10:00:00'),
    ];
    expect(buildDayChips(matches, NOW, ET, ET)).toEqual([]);
  });
});
