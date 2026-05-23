// ── bracketMatchMeta ───────────────────────────────────────────────────────
//
// Pure helper that turns an AES `BracketMatch` into the display strings
// the bracket-cell meta row needs. Extracted out of `BracketScreen` so
// the parse-then-format pipeline is testable in vitest (which doesn't
// load RN screens).
//
// Historical bug, pinned by `bracketMatchMeta.test.ts`: the AES API
// returns `ScheduledStartDateTime` as an ISO string (matching
// `TeamScheduleMatch`), but the field was typed `number?` and the screen
// guarded on `typeof === 'number'`. That guard was always false against
// the real payload, so the time row silently never rendered. Reading the
// value through `parseScheduleTime` makes the type mismatch the right
// failure mode (an unparseable string → null) instead of a silent skip.
// ────────────────────────────────────────────────────────────────────────────

import type { BracketMatch } from '../api/aesClient';
import {
  parseScheduleTime,
  formatDualTime,
  formatDualDate,
  formatTime,
  formatDate,
  type DualTzMode,
} from './dates';

export interface BracketMatchMeta {
  /** True when AES has stamped a scheduled start for this match. */
  hasTime: boolean;
  /** True when AES has assigned a court (`Court.Name` present). */
  hasCourt: boolean;
  /** Court display name, empty string when unassigned. */
  courtName: string;
  /** Formatted date (e.g. `"Sat May 23"`), empty when no time. */
  dateStr: string;
  /** Formatted time (e.g. `"9:00 AM (12:00 PM EDT)"`), empty when no time. */
  timeStr: string;
}

/**
 * Format the meta strip (date + time + court) for a bracket cell. Returns
 * empty strings when the bracket hasn't been seeded yet — the screen uses
 * `hasTime`/`hasCourt` to decide whether to render the row at all.
 *
 * `venueTz` drives venue-local interpretation of non-tz-suffixed AES
 * strings; `tzMode` controls whether to also render the user-local half.
 * `displayTz` is the fallback when no venue tz is known.
 */
export function formatBracketMatchMeta(
  m: BracketMatch,
  venueTz: string | undefined,
  tzMode: DualTzMode,
  displayTz?: string,
): BracketMatchMeta {
  const startMs = parseScheduleTime(m.ScheduledStartDateTime, venueTz);
  const hasTime = startMs != null;
  const courtName = m.Court?.Name ?? '';
  const hasCourt = courtName.length > 0;
  const timeStr = hasTime
    ? venueTz
      ? formatDualTime(
          startMs!,
          venueTz,
          { hour: 'numeric', minute: '2-digit', hour12: true },
          tzMode,
        )
      : formatTime(startMs!, displayTz)
    : '';
  const dateStr = hasTime
    ? venueTz
      ? formatDualDate(startMs!, venueTz, tzMode)
      : formatDate(startMs!, displayTz)
    : '';
  return { hasTime, hasCourt, courtName, dateStr, timeStr };
}
