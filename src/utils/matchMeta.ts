// ── Match Meta helpers ─────────────────────────────────────────────────────
//
// Helpers for the new analytics-classification fields on `MatchMeta`
// (see `src/types/match.ts`):
//   • `matchKind`         — AES / Timu / standalone / imported
//   • `linkedAesEvent`    — pointer to an indexed AES tournament
//   • `linkedTimuTournament` — pointer to an indexed Timu tournament
//   • `includeInStats`    — per-match opt-in for season analytics
//   • `source`            — how the data got here (live-scored vs imported)
//
// On-read migration: any stored match missing these fields is treated
// as `matchKind: 'standalone'`, `source: 'tier2-live'`,
// `includeInStats: false`. We don't bump the storage schema version —
// the new fields are additive and defaultable.
//
// The pure transformers (defaults, normaliser, applyAesLink, etc.) are
// re-exported from `./matchMetaPure` so a node-only test script can
// pick them up without pulling the AsyncStorage import chain.
// ────────────────────────────────────────────────────────────────────────────

import {
  loadAesSeasonIndex,
  sortedAesSnapshots,
} from './aesSeasonIndex';
import {
  loadSeasonIndex as loadTimuIndex,
  sortedSnapshots as sortedTimuSnapshots,
} from './timuSeasonIndex';
import {
  loadMatchById,
  loadMatches,
  saveMatch,
} from './scoredMatchStore';
import {
  applyAesLink,
  applyMatchInclusion,
  applyTimuLink,
  applyUnlink,
  normaliseMatch,
} from './matchMetaPure';
import type {
  AesEventLink,
  Match,
  TimuTournamentLink,
} from '../types/match';

// Re-export the pure surface so existing callers (`import { ... } from
// '../utils/matchMeta'`) keep working unchanged.
export {
  applyAesLink,
  applyMatchInclusion,
  applyTimuLink,
  applyUnlink,
  defaultIncludeInStats,
  inferMatchCategoryFromEventName,
  matchCategoryLabel,
  normaliseMatch,
  normaliseMatchMeta,
} from './matchMetaPure';

// ── Inclusion + linking helpers (async wrappers) ────────────────────────

/**
 * Toggle (or set) `includeInStats` on a stored match by id. Returns
 * the updated match, or `null` if no such match exists. Persists via
 * `saveMatch`.
 */
export async function setMatchInclusion(
  matchId: string,
  include: boolean
): Promise<Match | null> {
  const match = await loadMatchById(matchId);
  if (!match) return null;
  const next = applyMatchInclusion(match, include);
  await saveMatch(next);
  return next;
}

/**
 * Attach an AES tournament link to an existing stored match. See
 * `applyAesLink` for the pure semantics.
 */
export async function linkMatchToAesEvent(
  matchId: string,
  link: AesEventLink
): Promise<Match | null> {
  const match = await loadMatchById(matchId);
  if (!match) return null;
  const next = applyAesLink(match, link);
  await saveMatch(next);
  return next;
}

/**
 * Attach a Timu tournament link to an existing stored match.
 */
export async function linkMatchToTimuTournament(
  matchId: string,
  link: TimuTournamentLink
): Promise<Match | null> {
  const match = await loadMatchById(matchId);
  if (!match) return null;
  const next = applyTimuLink(match, link);
  await saveMatch(next);
  return next;
}

/**
 * Clear any tournament links on a match and demote `matchKind` back
 * to `'standalone'`.
 */
export async function unlinkMatch(matchId: string): Promise<Match | null> {
  const match = await loadMatchById(matchId);
  if (!match) return null;
  const next = applyUnlink(match);
  await saveMatch(next);
  return next;
}

// ── Tournament + opposing-team pickers ────────────────────────────────────

/**
 * One row in the tournament picker shown by the post-match save sheet
 * (and by the "Link to tournament" affordance later). Carries enough
 * info for a row UI plus the link object the helper would write.
 */
export interface TournamentPickerEntry {
  source: 'aes' | 'timu';
  tournamentName: string;
  subtitle?: string;
  /** Sort key — most-recently-opened tournaments come first. */
  dateMs?: number;
  /** Last-indexed timestamp for tie-breaking when dateMs is missing. */
  indexedAt: number;
  /** AES-side ref (omitted for Timu rows). */
  aes?: AesEventLink;
  /** Timu-side ref (omitted for AES rows). */
  timu?: TimuTournamentLink;
}

/**
 * Returns the merged AES + Timu tournament list, ordered most-recent
 * first, ready to drive the post-match tournament picker. AES uses
 * `eventKey:divisionId` keys; Timu uses `tid`. Most-recent ordering
 * uses `dateMs` first (the tournament's start date), falling back to
 * `indexedAt` when the date is unknown.
 */
export async function getRecentTournamentsForLinking(): Promise<
  TournamentPickerEntry[]
> {
  const [aesIdx, timuIdx] = await Promise.all([
    loadAesSeasonIndex(),
    loadTimuIndex(),
  ]);
  const out: TournamentPickerEntry[] = [];
  for (const snap of sortedAesSnapshots(aesIdx)) {
    out.push({
      source: 'aes',
      tournamentName: snap.eventName,
      subtitle: snap.divisionName,
      dateMs: snap.dateMs,
      indexedAt: snap.indexedAt,
      aes: {
        eventId: snap.eventKey,
        divisionId: String(snap.divisionId),
        tournamentName: snap.eventName,
      },
    });
  }
  for (const snap of sortedTimuSnapshots(timuIdx)) {
    out.push({
      source: 'timu',
      tournamentName: snap.name,
      subtitle: snap.subtitle,
      dateMs: snap.dateMs,
      indexedAt: snap.indexedAt,
      timu: {
        tid: String(snap.tid),
        tournamentName: snap.name,
      },
    });
  }
  out.sort((a, b) => {
    const da = a.dateMs ?? 0;
    const db = b.dateMs ?? 0;
    if (db !== da) return db - da;
    return b.indexedAt - a.indexedAt;
  });
  return out;
}

/**
 * Reference to a tournament — either AES or Timu — used to look up
 * the team list. `source` is required so the resolver knows which
 * index to query; one of `aes` / `timu` carries the actual key.
 */
export type TournamentRef =
  | { source: 'aes'; aes: AesEventLink }
  | { source: 'timu'; timu: TimuTournamentLink };

/**
 * Fetch the team display-name list for a chosen tournament so the
 * post-match save sheet can show an opposition picker filtered to
 * the teams that played in that event. Returns names sorted
 * alphabetically (case-insensitive).
 *
 * The names are surfaced as-seen on the tournament; the post-match
 * save flow uses them as the away team's display name and as the
 * basis for the saved match's label. Future opponent-stats lookups
 * (Session γ) will key on these too.
 */
export async function getOpposingTeamsForTournament(
  ref: TournamentRef
): Promise<string[]> {
  if (ref.source === 'aes') {
    const idx = await loadAesSeasonIndex();
    // Match by eventKey + divisionId. divisionId on the link is a
    // string for storage uniformity; AES snapshots key on number.
    const wantedDiv = ref.aes.divisionId
      ? Number(ref.aes.divisionId)
      : NaN;
    for (const snap of sortedAesSnapshots(idx)) {
      if (snap.eventKey !== ref.aes.eventId) continue;
      if (Number.isFinite(wantedDiv) && snap.divisionId !== wantedDiv) continue;
      const names = snap.teams
        .map((t) => t.teamText || t.teamName)
        .filter((n): n is string => Boolean(n));
      return dedupeAndSort(names);
    }
    return [];
  }
  // Timu
  const idx = await loadTimuIndex();
  const wantedTid = Number(ref.timu.tid);
  if (!Number.isFinite(wantedTid)) return [];
  const snap = idx[wantedTid];
  if (!snap) return [];
  const names = snap.teams.map((t) => t.teamName).filter(Boolean);
  return dedupeAndSort(names);
}

function dedupeAndSort(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const k = n.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n.trim());
  }
  out.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return out;
}

// ── Read-side conveniences ────────────────────────────────────────────────

/**
 * Load every stored match, normalised. Use this anywhere downstream
 * code expects the new fields to be present (the analytics readers,
 * the unified history extension, etc.).
 */
export async function loadNormalisedMatches(): Promise<Match[]> {
  const matches = await loadMatches();
  return matches.map(normaliseMatch);
}
