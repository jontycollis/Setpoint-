// ── Day-filter chips ───────────────────────────────────────────────────────
//
// Builds the chip set used by the TeamDashboard day-filter row. Each chip
// represents one calendar day that has at least one renderable match;
// chips drive `filterByDay` so the Past Results / Future Matches / Next
// Match lists collapse to a single day on tap.
//
// Why this lives in its own module:
//
//   1. The label has to be tz-stable. A 9 AM Calgary match must read
//      "Tomorrow" for an Eastern user even when the device clock hasn't
//      crossed midnight yet. The helper is pure so tests can pin "now"
//      to a known instant in a known tz and assert.
//
//   2. A previous off-by-one shipped a stale "Yesterday" chip on
//      tournaments that hadn't started yet. The fix kept the chip logic
//      coupled to the screen render — making it a pure function lets us
//      unit-test the future / past split directly.
//
// Rules captured here:
//
//   • Completed matches (HasScores or a TeamWon flag) always produce a
//     past chip — even when the dashboard is otherwise "future only".
//     That way "Yesterday" only ever appears when there's actual data
//     under it.
//   • Non-completed matches more than 30 min in the past are skipped
//     (stale data — match never got marked done by AES). Without this
//     a forgotten not-yet-scored match from last week would create a
//     ghost chip with no real data on the day.
//   • Diff is computed in calendar days anchored in the display tz,
//     never in epoch ms, so DST and tz boundaries don't move the chip.
// ────────────────────────────────────────────────────────────────────────────

import {
  parseScheduleTime,
  calendarDayKey,
  calendarDayDiff,
  relativeDayLabel,
} from './dates';

/**
 * Minimum shape we need from each match: the schedule string plus the
 * three "match is done" flags AES exposes. Anything else on the row is
 * ignored. Keeps the helper trivially callable from tests.
 */
export interface DayChipMatch {
  ScheduledStartDateTime: string;
  HasScores?: boolean;
  FirstTeamWon?: boolean;
  SecondTeamWon?: boolean;
}

export interface DayChip {
  /** ISO calendar day key (`YYYY-MM-DD`) anchored in the display tz, or
   *  the literal string `'all'` for the "All Days" reset chip. */
  key: string;
  label: string;
  /** Calendar-day diff vs `now` in the display tz. Negative = past,
   *  0 = today, +1 = tomorrow, etc. `null` for the synthetic 'all' chip. */
  diff: number | null;
}

const STALE_GRACE_MS = 30 * 60 * 1000;

/**
 * Build the chip set from raw matches. Pure — depends only on the args.
 *
 * `venueTz` is what we pass to `parseScheduleTime` so naked timestamps get
 * read as wall time at the venue. `displayTz` is what anchors the day
 * boundaries (typically venueTz, or undefined for device-local when the
 * user has the toggle set to 'device').
 */
export function buildDayChips(
  matches: readonly DayChipMatch[],
  nowMs: number,
  venueTz: string | undefined,
  displayTz: string | undefined
): DayChip[] {
  const staleCutoff = nowMs - STALE_GRACE_MS;
  const keyToMs = new Map<string, number>();

  for (const m of matches) {
    const isDone = !!(m.HasScores || m.FirstTeamWon || m.SecondTeamWon);
    const ms = parseScheduleTime(m.ScheduledStartDateTime, venueTz);
    if (ms == null) continue;
    if (!isDone && ms <= staleCutoff) continue;
    const key = calendarDayKey(ms, displayTz);
    if (!key) continue;
    if (!keyToMs.has(key)) keyToMs.set(key, ms);
  }

  const sortedKeys = Array.from(keyToMs.keys()).sort();
  const chips: DayChip[] = [];
  if (sortedKeys.length >= 2) {
    chips.push({ key: 'all', label: 'All Days', diff: null });
  }
  for (const key of sortedKeys) {
    const ms = keyToMs.get(key)!;
    const diff = calendarDayDiff(nowMs, ms, displayTz);
    chips.push({ key, label: relativeDayLabel(ms, nowMs, displayTz), diff });
  }
  return chips;
}
