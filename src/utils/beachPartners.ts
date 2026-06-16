// ── Per-partner beach rollups ─────────────────────────────────────────────
//
// Beach pairs change per tournament — Sarah plays with Lyevina at OPVC
// Spring, with Jordan at Toronto Open, with Lyevina again at Provincials.
// Indoor-style team-level rollups don't capture this. This module groups
// a slice of UnifiedTournamentEntry rows by `beachPartner.name` so the
// athlete-detail view can show "with each partner, how did it go."
//
// Pure / side-effect-free — composes on top of buildMySeasonHistory's
// output. Caller is responsible for filtering to `sport === 'beach'`
// before passing in.
// ──────────────────────────────────────────────────────────────────────────

import type { UnifiedTournamentEntry } from './unifiedSeasonHistory';

export interface PartnerRollup {
  /** Partner's display name as seen in the data. */
  partnerName: string;
  /** How many tournaments this athlete played with this partner. */
  tournaments: number;
  /** Aggregate match record across all tournaments with this partner. */
  matchesWon: number;
  matchesLost: number;
  /** Aggregate set record. */
  setsWon: number;
  setsLost: number;
  /** Best finish (smallest rank) observed with this partner, or null. */
  bestFinish: {
    rank: number;
    label: string;
    tournamentName: string;
  } | null;
  /** Date of the most recent tournament with this partner. */
  lastPlayedMs: number | null;
}

/**
 * Group a list of unified entries by `beachPartner.name`. Entries
 * without a `beachPartner` (or with a blank name) are dropped — the
 * "no partner recorded" bucket isn't a useful rollup since the
 * underlying data is just missing.
 *
 * Returns partners sorted by most-recently-played first, then by
 * tournament count descending. Matches the intuition "show me my
 * current partner at the top, then everyone I used to play with."
 */
export function aggregateByPartner(
  entries: UnifiedTournamentEntry[]
): PartnerRollup[] {
  const groups = new Map<string, PartnerRollup>();
  for (const e of entries) {
    const name = e.beachPartner?.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const prior = groups.get(key);
    const next: PartnerRollup = prior
      ? {
          ...prior,
          tournaments: prior.tournaments + 1,
          matchesWon: prior.matchesWon + e.matchesFor,
          matchesLost: prior.matchesLost + e.matchesAgainst,
          setsWon: prior.setsWon + e.setsFor,
          setsLost: prior.setsLost + e.setsAgainst,
          lastPlayedMs:
            e.dateMs != null && (prior.lastPlayedMs ?? -Infinity) < e.dateMs
              ? e.dateMs
              : prior.lastPlayedMs,
        }
      : {
          partnerName: name,
          tournaments: 1,
          matchesWon: e.matchesFor,
          matchesLost: e.matchesAgainst,
          setsWon: e.setsFor,
          setsLost: e.setsAgainst,
          bestFinish: null,
          lastPlayedMs: e.dateMs ?? null,
        };

    // Best-finish update — pick the smaller rank, breaking ties by the
    // newer tournament so a recent repeat of an earlier rank floats up.
    if (e.finalRank != null && e.finalRankLabel != null) {
      const candidate = {
        rank: e.finalRank,
        label: e.finalRankLabel,
        tournamentName: e.tournamentName,
      };
      if (!next.bestFinish || e.finalRank < next.bestFinish.rank) {
        next.bestFinish = candidate;
      }
    }
    groups.set(key, next);
  }

  return Array.from(groups.values()).sort((a, b) => {
    const aLast = a.lastPlayedMs ?? -Infinity;
    const bLast = b.lastPlayedMs ?? -Infinity;
    if (aLast !== bLast) return bLast - aLast;
    return b.tournaments - a.tournaments;
  });
}

/**
 * Format a partner's record as a one-liner: "12-4 across 5 tournaments
 * · Best 3rd at OPVC Spring." Returns the segments separately so
 * renderers can style independently.
 */
export interface PartnerRollupDisplay {
  /** "5 tournaments" / "1 tournament" */
  tournamentCount: string;
  /** "12-4" or null when no decided matches. */
  matchRecord: string | null;
  /** "Best 3rd at OPVC Spring" or null when no finish data. */
  bestFinishLine: string | null;
}

export function describePartnerRollup(
  rollup: PartnerRollup
): PartnerRollupDisplay {
  const tournamentCount =
    rollup.tournaments === 1 ? '1 tournament' : `${rollup.tournaments} tournaments`;
  const totalDecided = rollup.matchesWon + rollup.matchesLost;
  const matchRecord =
    totalDecided > 0 ? `${rollup.matchesWon}-${rollup.matchesLost}` : null;
  const bestFinishLine = rollup.bestFinish
    ? `Best ${rollup.bestFinish.label} at ${rollup.bestFinish.tournamentName}`
    : null;
  return { tournamentCount, matchRecord, bestFinishLine };
}
