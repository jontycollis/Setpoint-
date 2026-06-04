// ── Sideline HD API game parser ────────────────────────────────────────────
//
// Converts API games (the shape returned by `GET /v2/teams/<id>/games`)
// into the app's `Match` shape so they land in the same Tier-2 analytics
// pipeline as locally-scored matches. Companion to `sidelineHdParser.ts`,
// which handles the now-defunct localStorage snapshot path.
//
// The API only surfaces per-set summary scores (e.g. `ourSets: [25, 25,
// -1]` against `opponentSets: [16, 23, -1]` for a 2-set sweep). There's
// no point-by-point rally data, so we synthesise `point` events from the
// set totals — same approach `sidelineHdParser.ts`'s
// `synthesiseFromSummary` uses when the PBP cache wasn't present. The
// resulting matches show correct W/L, set scores, and rollups; rally-level
// analytics (kill-shot heatmaps, server-rotation effectiveness) need
// real PBP data we don't have here.
// ──────────────────────────────────────────────────────────────────────────

import type {
  Match,
  MatchEvent,
  MatchMeta,
  RosterPlayer,
} from '../types/match';
import {
  makeSidelineLiveMatchId,
  type SidelineSnapshotParseResult,
} from './sidelineHdParser';
import { inferMatchCategoryFromEventName } from './matchMetaPure';
import type { SidelineHdApiGame } from './sidelineHdApi';
import { getCurrentTenantId } from './tenant';

export interface ApiGameParseOptions {
  /** TeamProfile id from the local user profile. Stamped on
   *  `meta.home.teamProfileId` so the imported matches link cleanly into
   *  analytics. */
  teamProfileId: string;
  /** User-facing label for the user's team. Falls back to the API's
   *  `scoreOurName` when this is empty. */
  teamLabel: string;
}

/**
 * Convert one API game into a `Match`. Returns null when the game is
 * unusable — e.g. it's a scheduled-but-unplayed game with no scores,
 * isn't volleyball, or doesn't have a `volleyball` blob (the only sport
 * shape we currently consume).
 *
 * Important: even completed games may have all `-1` sets if the user
 * created the game but never recorded scores (Sideline HD's "schedule
 * only" flow). We treat those as not-importable.
 */
export function gameToMatch(
  game: SidelineHdApiGame,
  options: ApiGameParseOptions
): { match: Match; warnings: string[] } | null {
  const warnings: string[] = [];
  const vb = game.volleyball;

  if (!vb) {
    warnings.push(`${game.id}: skipped — non-volleyball or no score blob.`);
    return null;
  }
  // Filter to actually-played sets. `-1` is Sideline HD's "not played"
  // sentinel; clamping to non-negative also tolerates the occasional 0/0
  // set that the live-scoring path can leave behind on an undone serve.
  const setPairs: { ourPts: number; oppPts: number }[] = [];
  const maxSets = Math.max(vb.ourSets?.length ?? 0, vb.opponentSets?.length ?? 0);
  for (let i = 0; i < maxSets; i++) {
    const ourRaw = vb.ourSets?.[i] ?? -1;
    const oppRaw = vb.opponentSets?.[i] ?? -1;
    if (ourRaw < 0 && oppRaw < 0) continue;
    setPairs.push({
      ourPts: ourRaw < 0 ? 0 : ourRaw,
      oppPts: oppRaw < 0 ? 0 : oppRaw,
    });
  }

  if (setPairs.length === 0) {
    warnings.push(`${game.id}: skipped — no completed sets.`);
    return null;
  }

  const dateMs = parseGameDateMs(game);
  const ourLabel = options.teamLabel || game.scoreOurName || 'My team';
  const opponentLabel = game.scoreOpponentName?.trim() || 'Opponent';
  const eventName = inferEventName(game);
  const matchCategory = inferMatchCategoryFromEventName(eventName) ?? undefined;
  // `bestOf` heuristic: 5 sets played → best-of-5, otherwise default to 3.
  // We can't read the format from the API so this is a guess based on
  // what actually happened. Matches the convention sideline-hd-import
  // already uses for the bundled Titanium export.
  const bestOf = setPairs.length >= 4 ? 5 : 3;
  const matchId = makeSidelineLiveMatchId(game.id);
  const events: MatchEvent[] = synthesisePointEvents(
    matchId,
    setPairs,
    dateMs,
    vb.weAreHome
  );

  const meta: MatchMeta = {
    tenantId: getCurrentTenantId(),
    eventName,
    division: '',
    matchLabel: `${ourLabel} vs ${opponentLabel}`,
    courtName: game.scheduleLocation?.trim() || '',
    dateMs,
    sport: 'indoor',
    bestOf,
    setTargets: { regular: 25, decider: 15, winBy: 2 },
    home: {
      label: ourLabel,
      teamProfileId: options.teamProfileId,
    },
    away: {
      label: opponentLabel,
    },
    officials: {},
    matchKind: 'imported',
    includeInStats: true,
    source: 'sideline-hd-live',
    matchCategory,
  };

  // Roster shape isn't surfaced by the games-list endpoint. Per-game
  // details endpoint *might* carry it under `scoreOurLineup`, but our
  // sample (PVC 3D Royals) returned a bare placeholder. Skip for v1 —
  // the importer is still useful without rosters, and we can add a
  // per-match drill-in later.
  const rosters: { home: RosterPlayer[]; away: RosterPlayer[] } = {
    home: [],
    away: [],
  };

  const match: Match = {
    id: matchId,
    meta,
    events,
    rosters,
    status: 'complete',
    createdAt: dateMs,
    updatedAt: dateMs,
    schemaVersion: 1,
  };

  return { match, warnings };
}

/**
 * Convert a list of API games into Matches + warnings, matching the
 * existing `parseSidelineHdLocalStorageSnapshot` return shape so callers
 * can branch on the import source without restructuring.
 */
export function parseSidelineHdApiGames(
  games: SidelineHdApiGame[],
  options: ApiGameParseOptions
): SidelineSnapshotParseResult {
  const matches: Match[] = [];
  const warnings: string[] = [];
  for (const game of games) {
    if (!game || typeof game !== 'object') continue;
    const result = gameToMatch(game, options);
    if (!result) continue;
    matches.push(result.match);
    for (const w of result.warnings) warnings.push(w);
  }
  if (matches.length === 0) {
    warnings.push(
      'No completed games on this team — nothing to import. Played games appear here automatically a few minutes after scoring is finalised on Sideline HD.'
    );
  }
  return { matches, warnings };
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Pick the most precise timestamp the API surfaces. Priority:
 *   1. `scoreTsEnd` — when scoring finished. Best signal for "this is
 *      really when the match happened".
 *   2. `scoreTsStart` — when scoring started.
 *   3. `scheduleTsStart` — when the game was scheduled.
 *   4. `date` (YYYY-MM-DD) — fallback parsed in UTC.
 * Returns `Date.now()` when nothing parses, so the match still lands in
 * the timeline (later than other imports, easy to spot).
 */
function parseGameDateMs(game: SidelineHdApiGame): number {
  const tryParse = (s: string | undefined): number | null => {
    if (!s) return null;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  };
  return (
    tryParse(game.scoreTsEnd) ??
    tryParse(game.scoreTsStart) ??
    tryParse(game.scheduleTsStart) ??
    tryParse(game.date) ??
    Date.now()
  );
}

/**
 * Best-effort event name from the game's `title` (e.g. "Nationals Day 1
 * Game 3") + sanctioning partner if present. Drives the matchCategory
 * inference that gates AES/Timu cross-tagging.
 */
function inferEventName(game: SidelineHdApiGame): string {
  const title = game.title?.trim();
  const sanctioner = typeof game.sanctioningPartner === 'string'
    ? game.sanctioningPartner.trim()
    : '';
  if (title && sanctioner && !title.includes(sanctioner)) {
    return `${sanctioner} — ${title}`;
  }
  if (title) return title;
  if (sanctioner) return sanctioner;
  return 'Sideline HD import';
}

/**
 * Synthesise point events from per-set scores. Same shape the
 * localStorage parser uses when PBP data is absent — every point lands
 * in the correct set, alternates aren't real but the totals are honest,
 * and the bestOf/win-by logic shows the right match outcome.
 *
 * Sides are mapped against the user's team (the home label) via the
 * `weAreHome` flag from the API: when the user is the visiting team in
 * Sideline HD's view, our points go to `'away'` so they land on the
 * correct side of the local Match.
 */
function synthesisePointEvents(
  matchId: string,
  setPairs: { ourPts: number; oppPts: number }[],
  baseTs: number,
  weAreHome: boolean
): MatchEvent[] {
  const events: MatchEvent[] = [];
  const ourSide: 'home' | 'away' = weAreHome ? 'home' : 'away';
  const oppSide: 'home' | 'away' = weAreHome ? 'away' : 'home';
  for (let s = 0; s < setPairs.length; s++) {
    const { ourPts, oppPts } = setPairs[s]!;
    for (let i = 0; i < ourPts; i++) {
      events.push({
        id: `slapi-${matchId}-s${s}-r${i}-our`,
        ts: baseTs + s * 100000 + i,
        setIndex: s,
        type: 'point',
        scoringTeam: ourSide,
        reason: null,
      });
    }
    for (let i = 0; i < oppPts; i++) {
      events.push({
        id: `slapi-${matchId}-s${s}-r${i}-opp`,
        ts: baseTs + s * 100000 + ourPts + i,
        setIndex: s,
        type: 'point',
        scoringTeam: oppSide,
        reason: null,
      });
    }
  }
  return events;
}
