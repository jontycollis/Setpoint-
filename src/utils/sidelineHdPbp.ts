// ── Sideline HD opportunistic PBP fetcher ─────────────────────────────────
//
// Task #11. The REST-API import path (`runSidelineApiImport`) produces
// summary-only Match records — score totals per set but no per-rally
// detail. For games that were scored via the iScore integration
// (Sideline HD's per-rally companion app), the upstream service holds
// rally-level play-by-play we can enrich the import with.
//
// "Opportunistic" because:
//   1) PBP is only available when `game.fromIscore === true`. Other
//      games are bypassed unconditionally.
//   2) A PBP fetch failure NEVER breaks the import. We swallow the
//      error, log a warning, and fall through to the summary record.
//
// The actual PBP endpoint isn't fully probed yet — different from the
// (already-shipped) team-games endpoint. Until it lands, the production
// fetcher returns `null` (= "no PBP data") and the enrichment is a
// no-op. The shape is designed so when a probe captures the real
// endpoint, the only change is the fetcher's body.
//
// Why dependency-inject the fetcher rather than hardcode it?
//   • Tests can simulate "PBP available", "PBP empty", "fetch error"
//     without mocking the whole apiFetch surface.
//   • The probe-captured endpoint replaces the production stub by
//     swapping the default — no callers change.
// ──────────────────────────────────────────────────────────────────────────

import type { Match } from '../types/match';
import type { SidelineHdApiGame, SidelineHdSession } from './sidelineHdApi';

/**
 * Result of a PBP fetch attempt. `null` means "no PBP available";
 * an object means "got rally events the caller can merge". `error`
 * carries the failure reason without throwing so the orchestrator
 * can log + continue.
 */
export interface PbpFetchResult {
  /** Game id this result is for — matches Match.id. */
  gameId: string;
  /** Pre-parsed events ready to splice into Match.events, or null. */
  events: Match['events'] | null;
  /** Diagnostic warning when the fetch couldn't produce events. */
  warning?: string;
}

/**
 * Fetcher contract — production passes `productionPbpFetcher` (stub
 * today, real endpoint once probed), tests pass a fake.
 */
export type PbpFetcher = (
  session: SidelineHdSession,
  game: SidelineHdApiGame
) => Promise<PbpFetchResult>;

/**
 * Production fetcher. TODO: replace the body once the PBP endpoint is
 * probed. The current shape returns a null-events result for every
 * game so the enrichment is a no-op until then.
 *
 * Probe recipe (mirror the team-games endpoint):
 *   1) Open a recent iScore game in the Sideline HD web app.
 *   2) Capture the cURL of the rally-fetch call (look for paths under
 *      /v2/games/.../pbp or /v2/iscore/...).
 *   3) Plug the path and response shape into this function.
 */
export const productionPbpFetcher: PbpFetcher = async (_session, game) => {
  return {
    gameId: game.id,
    events: null,
    warning:
      'PBP endpoint not probed yet — opportunistic enrichment skipped.',
  };
};

/**
 * Decide which games should be PBP-enriched. Pure helper extracted so
 * tests + telemetry can read the gating logic without re-running the
 * whole import. Today the only condition is `fromIscore === true`;
 * future signals (game length, sport, season) layer in here.
 */
export function gameHasOpportunisticPbp(game: SidelineHdApiGame): boolean {
  return game.fromIscore === true;
}

/**
 * Run PBP enrichment over a batch of (game, parsed Match) pairs.
 * Returns the SAME Match[] in the same order with events spliced in
 * for games where PBP fetched successfully. Games where PBP wasn't
 * available or the fetch failed pass through unchanged.
 *
 * Per-game errors are caught — one failure DOES NOT abort the batch.
 * Caller gets warnings to surface in the import progress card.
 */
export async function enrichWithPbp(args: {
  session: SidelineHdSession;
  pairs: Array<{ game: SidelineHdApiGame; match: Match }>;
  fetcher?: PbpFetcher;
}): Promise<{ matches: Match[]; warnings: string[] }> {
  const fetcher = args.fetcher ?? productionPbpFetcher;
  const warnings: string[] = [];
  const out: Match[] = [];

  for (const { game, match } of args.pairs) {
    if (!gameHasOpportunisticPbp(game)) {
      out.push(match);
      continue;
    }
    try {
      const result = await fetcher(args.session, game);
      if (result.warning) warnings.push(`${match.id}: ${result.warning}`);
      if (result.events && result.events.length > 0) {
        // Merge PBP events INTO the summary's events. PBP is more
        // detailed (per-rally) than the synthesised summary events,
        // so we replace the summary events entirely. Caller's
        // dedupe pipeline doesn't care about event-level shape.
        out.push({ ...match, events: result.events, updatedAt: Date.now() });
      } else {
        // No usable events — keep the summary record.
        out.push(match);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`${match.id}: PBP fetch threw: ${msg}`);
      out.push(match);
    }
  }

  return { matches: out, warnings };
}
