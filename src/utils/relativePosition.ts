// ── "Where I fit in" — relative-position analytics ────────────────────────
//
// Pure functions that turn a list of UnifiedTournamentEntry rows into a
// "where this athlete fits in" summary. Used by AthleteDetailScreen to
// surface the user's relative standing without needing per-player peer
// data from other clubs.
//
// Two angles, both achievable from data we already index:
//
//   1) **Finish percentile** — for each entry where we know `finalRank`
//      AND `fieldSize`, compute `finalRank / fieldSize`. Top-10% means
//      finishing in the upper 10% of the field. We average across
//      tournaments (median would be more robust but average reads
//      better in a one-liner UI).
//
//   2) **Match win rate** — `matchesFor / (matchesFor + matchesAgainst)`
//      across the supplied entries. Aggregate, not per-entry.
//
// What's intentionally absent:
//   • Per-player percentile (kills, digs, aces) — requires peer team
//     match data which we don't have for arbitrary teams. Doable as
//     a follow-up once Sideline imports get broader adoption.
//   • Division-mate ranking — same constraint.
//
// Pure / side-effect-free, so callable from screen render paths and
// unit-testable without React or AsyncStorage stubs.
// ──────────────────────────────────────────────────────────────────────────

import type { UnifiedTournamentEntry } from './unifiedSeasonHistory';

export interface RelativePositionSummary {
  /**
   * Average finish percentile across all entries with both `finalRank`
   * and `fieldSize`. 0.0 = always finished first, 1.0 = always finished
   * last. `null` when no entries had both signals.
   */
  averageFinishPercentile: number | null;
  /** How many entries contributed to the percentile average. */
  entriesWithFinish: number;

  /**
   * Best finish percentile observed — the single tournament where the
   * athlete placed highest relative to the field. `null` when no
   * entries had both signals.
   */
  bestFinishPercentile: number | null;

  /**
   * Match win rate (0..1) across all supplied entries. `null` when no
   * entries had any matches.
   */
  matchWinRate: number | null;
  /** Total decisive matches across entries (wins + losses). */
  totalDecidedMatches: number;

  /**
   * Set win rate (0..1). Often diverges meaningfully from match win
   * rate at the high end ("we won most matches but lost a lot of sets
   * in three-set wins"), so it's worth its own line.
   */
  setWinRate: number | null;

  /**
   * Distribution bucket counts for finish percentile — drives a small
   * histogram or text breakdown in the UI. Buckets are top-10 / top-25
   * / top-half / bottom-half. Each entry counts in exactly one bucket;
   * entries without finish data are excluded.
   */
  finishBuckets: {
    top10: number;
    top25: number;
    topHalf: number;
    bottomHalf: number;
  };
}

/**
 * Compute the relative-position summary for a slice of unified history.
 * Caller is responsible for filtering by sport / season / athlete
 * before passing in — this function makes no assumptions about scope.
 *
 * Returns an empty-but-shaped summary (all null counts / nulls for
 * rates) when `entries` is empty, so renderers can null-check rates
 * without worrying about object shape.
 */
export function computeRelativePosition(
  entries: UnifiedTournamentEntry[]
): RelativePositionSummary {
  const finishPercentiles: number[] = [];
  for (const e of entries) {
    if (
      e.finalRank != null &&
      e.fieldSize != null &&
      e.fieldSize > 0 &&
      e.finalRank > 0
    ) {
      // Bounded to [0, 1] in case a stale snapshot has finalRank >
      // fieldSize (rare but possible when playoff brackets change
      // after the standings list was indexed).
      finishPercentiles.push(Math.min(1, e.finalRank / e.fieldSize));
    }
  }

  const totalWins = entries.reduce((n, e) => n + e.matchesFor, 0);
  const totalLosses = entries.reduce((n, e) => n + e.matchesAgainst, 0);
  const totalDecided = totalWins + totalLosses;
  const totalSetsWon = entries.reduce((n, e) => n + e.setsFor, 0);
  const totalSetsLost = entries.reduce((n, e) => n + e.setsAgainst, 0);
  const totalSets = totalSetsWon + totalSetsLost;

  const sum = finishPercentiles.reduce((a, b) => a + b, 0);
  const averageFinishPercentile =
    finishPercentiles.length > 0 ? sum / finishPercentiles.length : null;
  const bestFinishPercentile =
    finishPercentiles.length > 0 ? Math.min(...finishPercentiles) : null;

  const finishBuckets = {
    top10: 0,
    top25: 0,
    topHalf: 0,
    bottomHalf: 0,
  };
  for (const p of finishPercentiles) {
    if (p <= 0.1) finishBuckets.top10++;
    else if (p <= 0.25) finishBuckets.top25++;
    else if (p <= 0.5) finishBuckets.topHalf++;
    else finishBuckets.bottomHalf++;
  }

  return {
    averageFinishPercentile,
    entriesWithFinish: finishPercentiles.length,
    bestFinishPercentile,
    matchWinRate: totalDecided > 0 ? totalWins / totalDecided : null,
    totalDecidedMatches: totalDecided,
    setWinRate: totalSets > 0 ? totalSetsWon / totalSets : null,
    finishBuckets,
  };
}

/**
 * Format a percentile as "Top N%" / "Bottom N%" — convention: a
 * percentile of 0.18 reads as "Top 18%" (you finished in the upper
 * 18% of the field). Percentiles > 0.5 read as "Bottom (100-N)%" so a
 * 0.62 percentile reads as "Bottom 38%" — the threshold sounds
 * natural for results that aren't great but aren't a wipeout either.
 */
export function formatFinishPercentile(p: number): string {
  const pct = Math.round(p * 100);
  if (pct <= 50) return `Top ${pct}%`;
  return `Bottom ${100 - pct}%`;
}
