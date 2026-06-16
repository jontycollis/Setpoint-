// ── MyTeam.Click TournamentSource ─────────────────────────────────────────
//
// Plugs the MyTeam.Click season index (#3) into the registry built in
// #15. Mirrors `manualSource.ts` in shape — wraps the existing storage
// layer (`myteamClickSeasonIndex.ts`) and projects snapshots into the
// unified entry stream.
//
// The MyTeam.Click adapter is per-PLAYER, not per-TEAM: each snapshot
// carries a `myPlayerId` from the linked MyTeam.Click account. When
// the registry calls `getEntries`, we only project snapshots whose
// player matches one of the requested athletes (via the
// `myteamClickPlayerIds` SourceQuery extension — see types.ts).
// ──────────────────────────────────────────────────────────────────────────

import type { UnifiedTournamentEntry } from '../utils/unifiedSeasonHistory';
import {
  loadMtcSeasonIndex,
  snapshotToUnifiedEntries,
  type MtcEventSnapshot,
} from '../utils/myteamClickSeasonIndex';
import type { SourceQuery, TournamentSource } from './types';

export function createMyTeamClickSource(): TournamentSource {
  let cache: MtcEventSnapshot[] | null = null;

  return {
    id: 'myteamclick',
    displayName: 'MyTeam.Click',
    async preload() {
      try {
        const idx = await loadMtcSeasonIndex();
        cache = Object.values(idx);
      } catch {
        cache = [];
      }
    },
    async getEntries(query: SourceQuery): Promise<UnifiedTournamentEntry[]> {
      if (cache == null) {
        try {
          const idx = await loadMtcSeasonIndex();
          cache = Object.values(idx);
        } catch {
          return [];
        }
      }
      // Player-id scoping: when supplied, only snapshots tied to those
      // players contribute. When not supplied, every snapshot
      // projects (legacy reader compatibility).
      const playerScope = (query as SourceQuery & {
        myteamClickPlayerIds?: string[];
      }).myteamClickPlayerIds;
      const out: UnifiedTournamentEntry[] = [];
      for (const snap of cache) {
        if (
          playerScope &&
          playerScope.length > 0 &&
          !playerScope.includes(snap.myPlayerId)
        ) {
          continue;
        }
        out.push(...snapshotToUnifiedEntries(snap));
      }
      return out;
    },
  };
}
