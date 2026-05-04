// ── Volleyball Season Helpers ──────────────────────────────────────────────
//
// In Canada, the youth volleyball season runs September → May. So a date in
// October 2025 belongs to the "2025-26" season, and a date in February 2026
// also belongs to the "2025-26" season. June/July/August fall in the gap and
// we attribute them to the season that just ended.
//
// Tid presets are best-effort guesses calibrated against known data points
// (we know tid 3792 was January 31, 2026 and tid 4130 was March 28, 2026).
// Tids are sequential across all Timu users, not just OVA, so a season's
// range is wider than just OVA events.
// ────────────────────────────────────────────────────────────────────────────

export interface Season {
  /** Compact label, e.g. "2025-26". */
  id: string;
  /** Year in which the season starts (Sep). */
  startYear: number;
  /** Year in which the season ends (May). */
  endYear: number;
  /** Display label, e.g. "2025–26 Season". */
  label: string;
  /** Estimated start tid for discovery range (best-effort). */
  tidStart: number;
  /** Estimated end tid for discovery range (best-effort). */
  tidEnd: number;
}

/**
 * Best-effort tid range presets per season. The 2025-26 anchors are
 * calibrated against real observations; earlier seasons are extrapolated
 * backwards (~1500 tids/year on Timu's overall counter). Refined over time
 * as the user crawls older seasons.
 */
const SEASON_PRESETS: Season[] = [
  {
    id: '2025-26',
    startYear: 2025,
    endYear: 2026,
    label: '2025–26 Season',
    tidStart: 3500,
    tidEnd: 4400,
  },
  {
    id: '2024-25',
    startYear: 2024,
    endYear: 2025,
    label: '2024–25 Season',
    tidStart: 2400,
    tidEnd: 3500,
  },
  {
    id: '2023-24',
    startYear: 2023,
    endYear: 2024,
    label: '2023–24 Season',
    tidStart: 1500,
    tidEnd: 2400,
  },
  {
    id: '2022-23',
    startYear: 2022,
    endYear: 2023,
    label: '2022–23 Season',
    tidStart: 700,
    tidEnd: 1500,
  },
];

export function listSeasons(): Season[] {
  return SEASON_PRESETS.slice();
}

export function getSeason(id: string): Season | undefined {
  return SEASON_PRESETS.find((s) => s.id === id);
}

/**
 * Determine which season a calendar date belongs to. Sep–Dec belongs to
 * "YYYY-(YY+1)"; Jan–May belongs to "(YYYY-1)-YY"; Jun–Aug is a gap that
 * we attribute to the just-ended season.
 *
 * Returns the season id (e.g. "2025-26") or `null` if no preset covers
 * that date — callers can synthesize their own id with `seasonIdForDate`.
 */
export function seasonForDate(dateMs: number | undefined): Season | null {
  const id = seasonIdForDate(dateMs);
  if (!id) return null;
  return getSeason(id) || null;
}

/**
 * Like `seasonForDate` but always returns a synthetic `Season` with a
 * computed id, even if no preset exists. Useful when the user has events
 * in seasons we don't have a hardcoded preset for.
 */
export function seasonForDateOrSynth(dateMs: number | undefined): Season | null {
  if (dateMs == null || !isFinite(dateMs)) return null;
  const id = seasonIdForDate(dateMs);
  if (!id) return null;
  const preset = getSeason(id);
  if (preset) return preset;
  // Synthesize: parse "YYYY-YY" → years
  const parts = id.split('-');
  if (parts.length !== 2) return null;
  const startYear = Number(parts[0]);
  const endYear = startYear + 1;
  if (!Number.isFinite(startYear)) return null;
  return {
    id,
    startYear,
    endYear,
    label: `${startYear}–${String(endYear).slice(-2)} Season`,
    tidStart: 0,
    tidEnd: 0,
  };
}

/** Cheap version: just the id string. */
export function seasonIdForDate(dateMs: number | undefined): string | null {
  if (dateMs == null || !isFinite(dateMs)) return null;
  const d = new Date(dateMs);
  if (isNaN(d.getTime())) return null;
  const month = d.getMonth(); // 0-based
  const year = d.getFullYear();
  // Sep (8) – Dec (11) → "<year>-<year+1>"
  if (month >= 8) {
    return `${year}-${String(year + 1).slice(-2)}`;
  }
  // Jan (0) – May (4) → "<year-1>-<year>"
  if (month <= 4) {
    return `${year - 1}-${String(year).slice(-2)}`;
  }
  // Jun–Aug — gap. Attribute to the just-ended season.
  return `${year - 1}-${String(year).slice(-2)}`;
}

/** Current season based on today's date. */
export function currentSeason(): Season | null {
  return seasonForDateOrSynth(Date.now());
}

/**
 * For an indexed snapshot list, build the union of seasons we've seen
 * across the data — useful as a starting point for grouping.
 */
export function distinctSeasons(items: Array<{ dateMs?: number }>): Season[] {
  const seen = new Map<string, Season>();
  for (const item of items) {
    const s = seasonForDateOrSynth(item.dateMs);
    if (s && !seen.has(s.id)) seen.set(s.id, s);
  }
  // Newest first.
  return Array.from(seen.values()).sort((a, b) => b.startYear - a.startYear);
}
