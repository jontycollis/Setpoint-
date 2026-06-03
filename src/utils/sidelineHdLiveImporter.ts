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
import type { SidelineHdApiGame } from './sidelineHdApi';

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
}

/**
 * Sister to `runSidelineLocalStorageImport` for the new REST API path.
 * Takes the games array returned by `fetchTeamGames` (sidelineHdApi.ts),
 * converts them to Match[] via the API parser, and persists via the same
 * dedupe / saveMatch pipeline so both import sources are interchangeable
 * at the storage layer.
 */
export async function runSidelineApiImport(
  options: ApiImportOptions
): Promise<SidelineLiveImportResult> {
  const { games, teamProfileId, teamLabel, onProgress } = options;
  const parseResult = parseSidelineHdApiGames(games, {
    teamProfileId,
    teamLabel,
  });
  return await persistParsedMatches(parseResult, onProgress);
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
