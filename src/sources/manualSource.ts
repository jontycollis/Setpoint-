// ── Manual tournament source ──────────────────────────────────────────────
//
// First concrete TournamentSource implementation. Wraps the existing
// `manualTournaments` store and projects entries into the unified
// shape. Conforms strictly to the contract in `./types.ts` so the
// unified reader can iterate over it once the legacy hardcoded blocks
// in buildMySeasonHistory get extracted.
//
// The wrap is paper-thin: the same `manualEntryToUnified` adapter that
// buildMySeasonHistory uses today is duplicated here intentionally —
// keeping the legacy reader untouched while the registry path matures.
// When the legacy path retires, the duplication collapses naturally.
// ──────────────────────────────────────────────────────────────────────────

import type { UnifiedTournamentEntry } from '../utils/unifiedSeasonHistory';
import {
  loadManualTournaments,
  type ManualTournamentEntry,
} from '../utils/manualTournaments';
import type { SourceQuery, TournamentSource } from './types';

/**
 * Stable ordinal formatter — small enough to inline rather than depend
 * on the one in unifiedSeasonHistory. Lets this source compile without
 * cross-importing internals.
 */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0] ?? '');
}

function manualEntryToUnified(
  entry: ManualTournamentEntry
): UnifiedTournamentEntry {
  return {
    source: 'manual',
    sourceKey: `manual:${entry.id}`,
    manualEntryId: entry.id,
    sport: entry.sport,
    tournamentName: entry.tournamentName,
    subtitle: entry.subtitle,
    dateText: entry.dateText,
    dateMs: entry.dateMs,
    venueName: entry.venueName,
    beachPartner: entry.beachPartner,
    poolRank: null,
    finalRank: entry.finalRank ?? null,
    finalRankLabel:
      entry.finalRank != null ? ordinal(entry.finalRank) : null,
    fieldSize: entry.fieldSize,
    matchesFor: entry.matchesFor,
    matchesAgainst: entry.matchesAgainst,
    setsFor: entry.setsFor,
    setsAgainst: entry.setsAgainst,
    matches: [],
    indexedAt: entry.updatedAt,
  };
}

export function createManualSource(): TournamentSource {
  // Per-batch cache. Cleared every preload() call so a long-running
  // session that opens the unified reader multiple times sees fresh
  // data each time.
  let cache: ManualTournamentEntry[] | null = null;

  return {
    id: 'manual',
    displayName: 'Manual entries',
    async preload() {
      try {
        cache = await loadManualTournaments();
      } catch {
        cache = [];
      }
    },
    async getEntries(query: SourceQuery): Promise<UnifiedTournamentEntry[]> {
      // Lazy-load if preload wasn't called (defensive — sources should
      // tolerate readers that haven't adopted the preload pattern yet).
      if (cache == null) {
        try {
          cache = await loadManualTournaments();
        } catch {
          return [];
        }
      }
      const scope = query.teamProfileIds;
      const out: UnifiedTournamentEntry[] = [];
      for (const entry of cache) {
        if (scope && scope.length > 0 && !scope.includes(entry.teamProfileId)) {
          continue;
        }
        out.push(manualEntryToUnified(entry));
      }
      return out;
    },
  };
}
