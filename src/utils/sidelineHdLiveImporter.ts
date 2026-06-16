// ── Sideline HD localStorage importer ──────────────────────────────────────
//
// Persists matches parsed out of a Sideline HD WebView localStorage
// snapshot. The snapshot is captured by `SidelineImportScreen` after the
// user navigates the WebView to their team page; the parser
// (`sidelineHdParser.ts`) converts it into `Match[]` and this module
// dedupes against existing matches and writes via `scoredMatchStore`.
//
// Dedupe key is the stable id the parser produces
// (`import-sideline-live-<matchId>`); re-running the import after the
// user revisits the team page (e.g. to pick up newer matches) is
// non-destructive — already-imported matches are skipped, new ones are
// appended.
// ──────────────────────────────────────────────────────────────────────────

import type { Match } from '../types/match';
import { loadMatches, saveMatch } from './scoredMatchStore';
import {
  parseSidelineHdLocalStorageSnapshot,
  type SidelineHdLocalStorageSnapshot,
} from './sidelineHdParser';
import { parseSidelineHdApiGames } from './sidelineHdGameParser';
import type { SidelineHdApiGame, SidelineHdSession } from './sidelineHdApi';
import { enrichWithPbp, type PbpFetcher } from './sidelineHdPbp';

export interface SidelineLiveImportProgress {
  /** 0-based index in the parsed-matches array currently being persisted. */
  index: number;
  total: number;
  /** Human-readable label — surfaced in the import progress card. */
  label: string;
}

export interface SidelineLiveImportResult {
  imported: number;
  skipped: number;
  failed: number;
  warnings: string[];
  importedIds: string[];
}

interface ImportOptions {
  snapshot: SidelineHdLocalStorageSnapshot;
  teamProfileId: string;
  teamLabel: string;
  onProgress?: (p: SidelineLiveImportProgress) => void;
}

export async function runSidelineLocalStorageImport(
  options: ImportOptions
): Promise<SidelineLiveImportResult> {
  const { snapshot, teamProfileId, teamLabel, onProgress } = options;

  const parseResult = parseSidelineHdLocalStorageSnapshot(snapshot, {
    teamProfileId,
    teamLabel,
  });

  return await persistParsedMatches(parseResult, onProgress);
}

interface ApiImportOptions {
  games: SidelineHdApiGame[];
  teamProfileId: string;
  teamLabel: string;
  onProgress?: (p: SidelineLiveImportProgress) => void;
  /**
   * Auth session passed through to the optional PBP enrichment step.
   * When undefined, PBP enrichment is skipped (matches the pre-#11
   * behavior — every match imported as summary-only).
   */
  session?: SidelineHdSession;
  /**
   * Inject an alternate PBP fetcher (typically a fake in tests). When
   * undefined and a session is provided, the production fetcher is
   * used.
   */
  pbpFetcher?: PbpFetcher;
}

/**
 * Sister to `runSidelineLocalStorageImport` for the new REST API path.
 * Takes the games array returned by `fetchTeamGames` (sidelineHdApi.ts),
 * converts them to Match[] via the API parser, and persists via the same
 * dedupe / saveMatch pipeline so both import sources are interchangeable
 * at the storage layer.
 *
 * Opportunistic PBP (#11): when `session` is provided and any game has
 * `fromIscore === true`, we attempt a per-game PBP fetch before persisting.
 * Successful fetches replace the summary's synthesised events with the
 * richer rally-by-rally events; failures fall back to summary-only and
 * land as warnings. The pipeline never blocks on PBP — a failed fetch
 * does NOT abort the batch.
 */
export async function runSidelineApiImport(
  options: ApiImportOptions
): Promise<SidelineLiveImportResult> {
  const { games, teamProfileId, teamLabel, onProgress, session, pbpFetcher } =
    options;
  const parseResult = parseSidelineHdApiGames(games, {
    teamProfileId,
    teamLabel,
  });

  // Opportunistic PBP enrichment — only when we have a session (i.e. the
  // import call site passed auth). The localStorage importer doesn't need
  // this because its PBP comes from the snapshot, not the API.
  let enrichedMatches = parseResult.matches;
  const allWarnings = [...parseResult.warnings];
  if (session && parseResult.matches.length > 0) {
    const pairs = pairsForPbp(games, parseResult.matches);
    if (pairs.length > 0) {
      const enriched = await enrichWithPbp({
        session,
        pairs,
        fetcher: pbpFetcher,
      });
      enrichedMatches = mergeEnrichedMatches(
        parseResult.matches,
        enriched.matches
      );
      allWarnings.push(...enriched.warnings);
    }
  }

  return await persistParsedMatches(
    { matches: enrichedMatches, warnings: allWarnings },
    onProgress
  );
}

/**
 * Pair each parsed Match back with the source SidelineHdApiGame so the
 * PBP enricher can read `fromIscore` and the iScore game id. Match ids
 * are derived from game ids by the parser (with an `import-sideline-...`
 * prefix), but the prefix isn't recoverable from the Match alone, so we
 * iterate in parallel order — the parser preserves array order.
 *
 * Defensive: if the parser dropped a game (e.g. unparseable), the
 * arrays drift. We fall back to matching by suffix-includes-id, which
 * is robust even when an entry was skipped.
 */
function pairsForPbp(
  games: SidelineHdApiGame[],
  matches: Match[]
): Array<{ game: SidelineHdApiGame; match: Match }> {
  const out: Array<{ game: SidelineHdApiGame; match: Match }> = [];
  for (const match of matches) {
    const game = games.find((g) => match.id.endsWith(g.id));
    if (game) out.push({ game, match });
  }
  return out;
}

/**
 * Replace each entry in `original` with the matching enriched record
 * (matched by Match.id). Order is preserved. Enriched matches that
 * don't appear in `original` are appended.
 */
function mergeEnrichedMatches(original: Match[], enriched: Match[]): Match[] {
  const byId = new Map(enriched.map((m) => [m.id, m] as const));
  const out: Match[] = [];
  for (const m of original) {
    out.push(byId.get(m.id) ?? m);
  }
  return out;
}

async function persistParsedMatches(
  parseResult: { matches: Match[]; warnings: string[] },
  onProgress?: (p: SidelineLiveImportProgress) => void
): Promise<SidelineLiveImportResult> {
  const existing = await loadMatches();
  const existingIds = new Set(existing.map((m) => m.id));

  const result: SidelineLiveImportResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    warnings: [...parseResult.warnings],
    importedIds: [],
  };

  for (let i = 0; i < parseResult.matches.length; i++) {
    const match: Match = parseResult.matches[i]!;
    onProgress?.({
      index: i,
      total: parseResult.matches.length,
      label: match.meta.matchLabel,
    });
    if (existingIds.has(match.id)) {
      result.skipped++;
      continue;
    }
    try {
      await saveMatch(match);
      existingIds.add(match.id);
      result.imported++;
      result.importedIds.push(match.id);
    } catch (err) {
      result.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      result.warnings.push(`Failed to persist ${match.meta.matchLabel}: ${msg}`);
    }
  }

  return result;
}
