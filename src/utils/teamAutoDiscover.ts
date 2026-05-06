// ── Team Auto-Discovery ────────────────────────────────────────────────────
//
// Given a team's aliases, scan AES (recent Canadian events) and Timu
// (current season's tid range) for any tournament where the team appears,
// then index those snapshots so SeasonHistory shows them automatically.
//
// Designed as background work — caller drives a UI via `onProgress`. Both
// halves run in parallel and never throw past their boundary; a transient
// failure in one source doesn't poison the other.
//
// Throttled per alias-set: re-running the same aliases inside 6 hours
// returns immediately so opening the same team twice doesn't blitz the
// discovery endpoints.
// ────────────────────────────────────────────────────────────────────────────

import {
  fetchCanadianEvents,
  getEvent,
  getTeamAssignments,
} from '../api/aesClient';
import { indexAesSnapshot } from './aesSeasonIndex';
import { discoverTeamEvents } from './timuDiscover';
import {
  bulkIndex as bulkIndexTimu,
  loadSeasonIndex as loadTimuIndex,
} from './timuSeasonIndex';
import { matchesAnyAlias } from './seasonTeamIdentity';
import { listSeasons } from './season';

export type AutoDiscoverPhase =
  | 'starting'
  | 'aes-scan'
  | 'aes-index'
  | 'timu-scan'
  | 'timu-index'
  | 'done';

export interface AutoDiscoverProgress {
  phase: AutoDiscoverPhase;
  /** Items processed in the current phase. */
  done: number;
  /** Items expected in the current phase. */
  total: number;
  /** Tournaments matched and indexed so far across both sources. */
  matched: number;
  /** Free-text label of the current item (event name, tid, etc.). */
  label?: string;
}

const lastRunByAliasKey: Record<string, number> = {};
const RECENT_RUN_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function aliasKey(aliases: string[]): string {
  return aliases.map((a) => a.toLowerCase().trim()).filter(Boolean).sort().join('|');
}

/**
 * Scan AES + Timu for tournaments matching any of the given aliases and
 * index every match. `onProgress` fires for each phase transition; the
 * final call is `{ phase: 'done' }`.
 *
 * Returns counts so callers can surface a "found N tournaments" toast.
 * `skipped: true` means a recent run for the same aliases was within
 * the throttle window — pass `force: true` to override.
 */
export async function autoDiscoverTeam(
  aliases: string[],
  onProgress?: (p: AutoDiscoverProgress) => void,
  options?: { force?: boolean }
): Promise<{ aesIndexed: number; timuIndexed: number; skipped: boolean }> {
  if (!aliases.length) {
    return { aesIndexed: 0, timuIndexed: 0, skipped: true };
  }
  const key = aliasKey(aliases);
  const last = lastRunByAliasKey[key] ?? 0;
  if (!options?.force && Date.now() - last < RECENT_RUN_TTL_MS) {
    return { aesIndexed: 0, timuIndexed: 0, skipped: true };
  }
  lastRunByAliasKey[key] = Date.now();

  onProgress?.({ phase: 'starting', done: 0, total: 0, matched: 0 });

  // The two phases share the `matched` counter via closure so the
  // progress callback always shows the running total.
  let matched = 0;
  const bumpMatched = (n: number) => {
    matched += n;
  };

  const [aesIndexed, timuIndexed] = await Promise.all([
    discoverAesForTeam(aliases, (p) => {
      onProgress?.({ ...p, matched });
    }, bumpMatched).catch(() => 0),
    discoverTimuForTeam(aliases, (p) => {
      onProgress?.({ ...p, matched });
    }, bumpMatched).catch(() => 0),
  ]);

  onProgress?.({
    phase: 'done',
    done: 1,
    total: 1,
    matched: aesIndexed + timuIndexed,
  });
  return { aesIndexed, timuIndexed, skipped: false };
}

// ── AES side ────────────────────────────────────────────────────────────────

async function discoverAesForTeam(
  aliases: string[],
  onProgress?: (p: Omit<AutoDiscoverProgress, 'matched'>) => void,
  onMatch?: (n: number) => void
): Promise<number> {
  // includePast: true so we walk every Canadian AES event the team may
  // have played in — not just upcoming ones. The current-season filter
  // is a TournamentSelect concern, not a season-history concern.
  const events = await fetchCanadianEvents({ includePast: true });
  let matched = 0;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    onProgress?.({
      phase: 'aes-scan',
      done: i,
      total: events.length,
      label: ev.name,
    });
    try {
      const event = await getEvent(ev.eventSchedulerKey);
      // Walk every division in the event. We could narrow by age-group
      // string-match, but division names are inconsistent enough across
      // tournaments that we'd miss real matches. Brute force is fine —
      // ~5-10 divisions × ~1 HTTP call each per event.
      for (const division of event.Divisions) {
        try {
          const teams = await getTeamAssignments(
            event.Key,
            division.DivisionId,
            null
          );
          const matchedTeam = teams.find(
            (t) =>
              matchesAnyAlias(t.TeamText || '', aliases) ||
              matchesAnyAlias(t.TeamName || '', aliases) ||
              matchesAnyAlias(t.SearchableTeamName || '', aliases)
          );
          if (matchedTeam) {
            await indexAesSnapshot(
              event.Key,
              division.DivisionId,
              matchedTeam.TeamId
            );
            matched++;
            onMatch?.(1);
          }
        } catch {
          // Skip individual division failures — partial results are
          // better than nothing.
        }
      }
    } catch {
      // Skip individual event failures.
    }
  }

  onProgress?.({
    phase: 'aes-index',
    done: events.length,
    total: events.length,
  });
  return matched;
}

// ── Timu side ───────────────────────────────────────────────────────────────

async function discoverTimuForTeam(
  aliases: string[],
  onProgress?: (p: Omit<AutoDiscoverProgress, 'matched'>) => void,
  onMatch?: (n: number) => void
): Promise<number> {
  // Span every known Timu season so a team's multi-year history is
  // captured in one go. The discovery cache (7-day TTL inside
  // `timuDiscover`) means subsequent runs in the same week skip
  // already-scanned tids — only the FIRST run per team is slow.
  const seasons = listSeasons();
  if (!seasons.length) return 0;
  const tidStart = Math.min(...seasons.map((s) => s.tidStart));
  const tidEnd = Math.max(...seasons.map((s) => s.tidEnd));

  const matches = await discoverTeamEvents(
    aliases,
    tidStart,
    tidEnd,
    (p) =>
      onProgress?.({
        phase: 'timu-scan',
        done: p.done,
        total: p.total,
        label: `tid ${p.current}`,
      })
  );

  if (matches.length === 0) return 0;

  await bulkIndexTimu(
    matches.map((m) => m.tid),
    (done, total, tid) =>
      onProgress?.({
        phase: 'timu-index',
        done,
        total,
        label: `tid ${tid}`,
      })
  );

  // Verify which discovered tids actually surfaced the team in their
  // indexed snapshot. The discovery's fast regex (`extractTeamNames`)
  // is more permissive than the full pools parser used inside
  // `buildSnapshot` — when Timu's HTML structure is irregular we can
  // see a name during discovery but end up with an empty `snap.teams`,
  // which `buildMySeasonHistory` then filters out. Reporting the
  // un-verified count was misleading the user ("found 2" but only 1
  // appears on Season History), so we trust verification only.
  const idx = await loadTimuIndex();
  let verified = 0;
  for (const m of matches) {
    const snap = idx[m.tid];
    if (!snap) continue;
    if (snap.teams.some((t) => matchesAnyAlias(t.teamName, aliases))) {
      verified++;
    }
  }

  onMatch?.(verified);
  return verified;
}
