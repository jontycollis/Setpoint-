// ── Scored-match persistence ───────────────────────────────────────────────
//
// Thin AsyncStorage wrapper for the Tier 2 scoring engine's matches.
// Stored as a single JSON blob keyed by `scored.matches.v1`, mapping
// match.id → Match. We could split per-match into separate keys for
// faster partial reads, but matches are small (~25 KB even for a
// thrash-y full-event match) so a single blob is fine — typical user
// has dozens, not thousands, of scored matches stored.
//
// NOT covered by unit tests in Session A — AsyncStorage is a thin RN
// shim that vitest can't drive without mocks. The contract here is
// straightforward enough that integration testing in-app (Session B+)
// will catch any real bugs.
// ────────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Match, MatchKind, MatchSource } from '../types/match';
import type { TeamProfile } from '../types/profile';
import { matchesAnyAlias } from './seasonTeamIdentity';

const STORAGE_KEY = 'scored.matches.v1';

type StoredBlob = Record<string, Match>;

/**
 * Normalise on read. Older stored matches predate the analytics
 * fields on `MatchMeta` — fill them in with defaults so every
 * downstream consumer sees a uniformly-shaped record.
 *
 * Defaults:
 *   • `matchKind`      → `'standalone'`
 *   • `source`         → `'tier2-live'`  (legacy = live-scored)
 *   • `includeInStats` → `false`         (default for `'standalone'`)
 *
 * Mirrors `normaliseMatchMeta` in `matchMeta.ts`. Duplicated here so
 * the storage layer doesn't import the helper module (avoids a
 * potential cycle: matchMeta.ts → scoredMatchStore.ts → matchMeta.ts).
 */
function normaliseOnRead(match: Match): Match {
  const meta = match.meta;
  const hasKind = (meta as { matchKind?: MatchKind }).matchKind != null;
  const hasSource = (meta as { source?: MatchSource }).source != null;
  const hasInclude =
    (meta as { includeInStats?: boolean }).includeInStats != null;
  if (hasKind && hasSource && hasInclude) return match;
  return {
    ...match,
    meta: {
      ...meta,
      matchKind: meta.matchKind ?? 'standalone',
      source: meta.source ?? 'tier2-live',
      includeInStats: meta.includeInStats ?? false,
    },
  };
}

async function readBlob(): Promise<StoredBlob> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeBlob(blob: StoredBlob): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // Best-effort. Storage failures here surface in the next
    // saveMatch call too — caller can retry with a UI affordance.
  }
}

/** All matches sorted by createdAt desc (newest first). */
export async function loadMatches(): Promise<Match[]> {
  const blob = await readBlob();
  return Object.values(blob)
    .map(normaliseOnRead)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Single match by id, or null if not found. */
export async function loadMatchById(id: string): Promise<Match | null> {
  const blob = await readBlob();
  const m = blob[id];
  return m ? normaliseOnRead(m) : null;
}

/** Persist a match, overwriting any prior version with the same id. */
export async function saveMatch(match: Match): Promise<void> {
  const blob = await readBlob();
  blob[match.id] = match;
  await writeBlob(blob);
}

/** Remove a match. No-op if the id isn't present. */
export async function deleteMatch(id: string): Promise<void> {
  const blob = await readBlob();
  if (!(id in blob)) return;
  delete blob[id];
  await writeBlob(blob);
}

/**
 * One-shot migration for matches saved before MatchSetupScreen learned
 * to write `meta.home.teamProfileId`. Walks every stored match and, for
 * any whose home side has no team-profile foreign key, tries to match
 * `meta.home.label` against the user's TeamProfiles by label + aliases
 * using the project's shared `matchesAnyAlias` (case-insensitive,
 * normalised exact match). Only writes back when at least one match
 * was filled.
 *
 * Also tries the away side: a few flows (imports, opponent-as-home
 * setups) leave the user's team on the away header — without this
 * second pass those matches stay invisible to analytics even though
 * the label aliases cleanly onto a known TeamProfile.
 *
 * Returns counts so the caller can log a one-line summary in __DEV__.
 */
export async function backfillHomeTeamProfileIds(
  teams: TeamProfile[]
): Promise<{ backfilled: number; skipped: number }> {
  if (teams.length === 0) return { backfilled: 0, skipped: 0 };
  const blob = await readBlob();
  let backfilled = 0;
  let skipped = 0;
  let mutated = false;
  for (const id of Object.keys(blob)) {
    const m = blob[id];
    const homeNeedsFill = !m.meta.home.teamProfileId;
    const awayNeedsFill = !m.meta.away.teamProfileId;
    if (!homeNeedsFill && !awayNeedsFill) continue;

    const findByLabel = (label: string | undefined) => {
      if (!label) return null;
      return (
        teams.find((t) =>
          matchesAnyAlias(label, [t.label, ...(t.aliases ?? [])])
        ) ?? null
      );
    };

    const homeMatch = homeNeedsFill ? findByLabel(m.meta.home.label) : null;
    const awayMatch = awayNeedsFill ? findByLabel(m.meta.away.label) : null;
    if (!homeMatch && !awayMatch) {
      skipped++;
      continue;
    }

    blob[id] = {
      ...m,
      meta: {
        ...m.meta,
        home: homeMatch
          ? { ...m.meta.home, teamProfileId: homeMatch.id }
          : m.meta.home,
        away: awayMatch
          ? { ...m.meta.away, teamProfileId: awayMatch.id }
          : m.meta.away,
      },
    };
    backfilled++;
    mutated = true;
  }
  if (mutated) await writeBlob(blob);
  return { backfilled, skipped };
}

/** Erase every stored match. Used by "Reset all data" affordances. */
export async function clearAllMatches(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
