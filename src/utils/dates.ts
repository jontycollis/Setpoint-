// ── Date formatting + parsing ──────────────────────────────────────────────
//
// Most of this file existed before the timezone-handling overhaul; the
// additions here are:
//
//   • `parseScheduleTime(str, venueTz?)` — single source of truth for
//     interpreting an upstream schedule timestamp. If the string carries a
//     tz suffix we honour it; if it doesn't and we know the venue tz we
//     parse as venue wall-time via Luxon; otherwise we fall back to
//     `Date.parse` (device-local) with a __DEV__ warning so the legacy
//     ambiguity is visible during development.
//
//   • `formatInVenueTz(ms, venueTz, opts?)` — venue-local rendering. When
//     `venueTz` is undefined we render device-local, matching prior
//     behaviour for matches that lack a venueTimeZone field.
//
//   • Every existing formatter now takes an optional trailing `venueTz`
//     argument. Default-undefined preserves device-local behaviour for
//     code that hasn't been migrated yet.
// ────────────────────────────────────────────────────────────────────────────

import { DateTime } from 'luxon';

declare const __DEV__: boolean;

/** Format a date for display — accepts ISO string or Unix ms timestamp */
export function formatDate(date: string | number, venueTz?: string): string {
  const ms = typeof date === 'number' ? date : Date.parse(date);
  if (!isFinite(ms)) return '';
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  };
  return formatInVenueTz(ms, venueTz, opts) || new Date(ms).toLocaleDateString('en-US', opts);
}

/** Format a datetime for display as time — accepts ISO string or Unix ms */
export function formatTime(date: string | number, venueTz?: string): string {
  const ms = typeof date === 'number' ? date : Date.parse(date);
  if (!isFinite(ms)) return '';
  const opts: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };
  return formatInVenueTz(ms, venueTz, opts) || new Date(ms).toLocaleTimeString('en-US', opts);
}

/** Format date range for event display */
export function formatDateRange(start: string, end: string, venueTz?: string): string {
  const sMs = Date.parse(start);
  const eMs = Date.parse(end);
  if (!isFinite(sMs)) return '';
  const startStr = formatInVenueTz(sMs, venueTz, {
    month: 'short',
    day: 'numeric',
  });
  const endStr = isFinite(eMs)
    ? formatInVenueTz(eMs, venueTz, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '';
  return endStr ? `${startStr} – ${endStr}` : startStr;
}

/** Get relative time description — accepts ISO string or Unix ms */
export function getRelativeTime(date: string | number, venueTz?: string): string {
  const now = new Date();
  const target = typeof date === 'number' ? new Date(date) : new Date(date);
  const diffMs = target.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins < 0) {
    const absMins = Math.abs(diffMins);
    if (absMins < 60) return `${absMins}m ago`;
    if (absMins < 1440) return `${Math.round(absMins / 60)}h ago`;
    return formatDate(date, venueTz);
  }

  if (diffMins < 60) return `In ${diffMins}m`;
  if (diffMins < 1440) return `In ${Math.round(diffMins / 60)}h`;

  // Use calendar day comparison for "Tomorrow" instead of hour-based math.
  // We anchor the comparison in `venueTz` when supplied so a 9 AM match in
  // Toronto reads "Tomorrow" for a Vancouver user even when their device
  // clock hasn't crossed midnight yet.
  const dayDiff = calendarDayDiff(now.getTime(), target.getTime(), venueTz);
  if (dayDiff === 1) return 'Tomorrow';
  return formatDate(date, venueTz);
}

/** Format date as YYYY-MM-DD for API calls (UTC). */
export function toApiDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Format `now` as YYYY-MM-DD in the user's *device-local* calendar (rather
 * than UTC). Used for AES "what's on today" lookups where slicing the
 * UTC ISO string off `new Date()` can roll the date back into "yesterday"
 * for users west of UTC late at night. Optional venueTz lets callers ask
 * for the venue's calendar day instead.
 */
export function todayApiDate(venueTz?: string): string {
  const now = DateTime.now();
  const dt = venueTz ? now.setZone(venueTz) : now;
  // `.toISODate()` is the calendar date in the active zone, no UTC slip.
  return dt.toISODate() ?? new Date().toLocaleDateString('en-CA');
}

/** Format a short day label (e.g. "Sun Apr 19") from ISO or Unix ms */
export function formatShortDay(date: string | number, venueTz?: string): string {
  return formatDate(date, venueTz);
}

// ── Tz-aware parsing + rendering ───────────────────────────────────────────

/**
 * Parse a schedule timestamp into an epoch (ms). Three branches:
 *
 *   1. The string carries an explicit tz suffix (`Z` or `+HH:MM` /
 *      `-HH:MM`). We honour it directly — `Date.parse` already handles
 *      that correctly cross-platform.
 *
 *   2. No suffix + caller supplied `venueTz`. Treat the string as wall
 *      time at the venue and convert to UTC via Luxon. This is the case
 *      AES feeds us: `"2026-05-24T09:00:00"` from an Ontario event means
 *      9 AM Toronto wall time, not 9 AM device-local.
 *
 *   3. No suffix + no venue tz. Fall back to `Date.parse` (device-local)
 *      and emit a __DEV__ warning so the ambiguity is visible during
 *      development. Existing matches without a `venueTimeZone` keep
 *      working — they get the same behaviour as before this overhaul.
 *
 * Returns `null` when the string is unparseable.
 */
export function parseScheduleTime(
  str: string | null | undefined,
  venueTz?: string
): number | null {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (trimmed.length === 0) return null;

  // 1) Has tz suffix? Match trailing `Z` or `+HH:MM` / `-HH:MM` / `+HHMM`.
  //    Restrict to the tail so we don't pick up dash-separated dates.
  const hasTzSuffix = /(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed);
  if (hasTzSuffix) {
    const ms = Date.parse(trimmed);
    return isFinite(ms) ? ms : null;
  }

  // 2) No suffix + venue tz available → wall-time in venue.
  if (venueTz) {
    const dt = DateTime.fromISO(trimmed, { zone: venueTz });
    if (dt.isValid) return dt.toMillis();
    // Some upstream feeds use a space separator instead of the ISO 'T'.
    // Luxon's fromSQL covers that shape.
    const sql = DateTime.fromSQL(trimmed, { zone: venueTz });
    if (sql.isValid) return sql.toMillis();
    return null;
  }

  // 3) No suffix + no venue tz → device-local fallback (legacy behaviour).
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn(
      `[parseScheduleTime] parsing "${trimmed}" as device-local — no venueTz supplied; ` +
        'pass venueTimeZone from the snapshot to get venue-local interpretation.'
    );
  }
  const ms = Date.parse(trimmed);
  return isFinite(ms) ? ms : null;
}

/**
 * Render an epoch in the venue's tz. When `venueTz` is undefined we render
 * device-local so callers can stay tz-aware-by-default without forking
 * code paths for every snapshot that lacks a venue tz.
 */
export function formatInVenueTz(
  ms: number,
  venueTz: string | undefined,
  opts?: Intl.DateTimeFormatOptions
): string {
  if (!isFinite(ms)) return '';
  const formatOpts = opts ?? { hour: 'numeric', minute: '2-digit', hour12: true };
  if (venueTz) {
    try {
      return new Date(ms).toLocaleString('en-US', { ...formatOpts, timeZone: venueTz });
    } catch {
      // Older Hermes / Android Intl builds may reject some IANA names —
      // fall through to device-local.
    }
  }
  // Device-local fallback: pick the formatter that fits the supplied opts.
  const hasDate = !!(opts && (opts.weekday || opts.year || opts.month || opts.day));
  const hasTime = !!(opts && (opts.hour || opts.minute || opts.second));
  const d = new Date(ms);
  if (hasDate && !hasTime) return d.toLocaleDateString('en-US', formatOpts);
  if (hasTime && !hasDate) return d.toLocaleTimeString('en-US', formatOpts);
  return d.toLocaleString('en-US', formatOpts);
}

/**
 * Calendar-day difference (target − ref) in days, anchored in `venueTz` if
 * supplied (otherwise device-local). Returns an integer.
 */
function calendarDayDiff(refMs: number, targetMs: number, venueTz?: string): number {
  const ref = venueTz
    ? DateTime.fromMillis(refMs, { zone: venueTz })
    : DateTime.fromMillis(refMs);
  const target = venueTz
    ? DateTime.fromMillis(targetMs, { zone: venueTz })
    : DateTime.fromMillis(targetMs);
  // Strip the time-of-day so we compare calendar dates, not 24h windows.
  const refStart = ref.startOf('day');
  const targetStart = target.startOf('day');
  return Math.round(targetStart.diff(refStart, 'days').days);
}
