// ── Sideline HD live importer ─────────────────────────────────────────────
//
// Orchestrates the self-serve import flow: walks a list of selected
// Sideline HD match summaries, fetches each match's rally payload via the
// authenticated API, runs the parser, and persists the result via
// `scoredMatchStore`. Dedupe is keyed off the stable id the parser
// generates (`import-sideline-live-<matchId>`); re-running the import is
// non-destructive.
//
// Counterpart to `historicalImporter.ts`, which handles the bundled
// (static workbook) import. Both feed into the same `Match[]` store.
// ──────────────────────────────────────────────────────────────────────────

import type {
  SidelineHdMatchSummary,
  SidelineHdTeam,
} from '../api/sidelineHd';
import { fetchMatchRallies } from '../api/sidelineHd';
import { loadMatches, saveMatch } from './scoredMatchStore';
import {
  makeSidelineLiveMatchId,
  parseSidelineLiveMatch,
} from './sidelineHdParser';

export interface SidelineLiveImportProgress {
  /** Index in the selected-matches array currently being worked on. */
  index: number;
  total: number;
  /** Human-readable label for the current match — surfaced in the UI. */
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
  team: SidelineHdTeam;
  teamProfileId: string;
  selectedMatches: SidelineHdMatchSummary[];
  /** Optional progress callback — UI updates after each match. */
  onProgress?: (p: SidelineLiveImportProgress) => void;
}

export async function runSidelineLiveImport(
  options: ImportOptions
): Promise<SidelineLiveImportResult> {
  const { team, teamProfileId, selectedMatches, onProgress } = options;

  const existing = await loadMatches();
  const existingIds = new Set(existing.map((m) => m.id));

  const result: SidelineLiveImportResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    warnings: [],
    importedIds: [],
  };

  for (let i = 0; i < selectedMatches.length; i++) {
    const summary = selectedMatches[i];
    if (!summary) continue;
    const stableId = makeSidelineLiveMatchId(summary.id);
    onProgress?.({
      index: i,
      total: selectedMatches.length,
      label: `${summary.opponent} — ${summary.eventName ?? ''}`.trim(),
    });

    if (existingIds.has(stableId)) {
      result.skipped++;
      continue;
    }

    try {
      const ralliesRes = await fetchMatchRallies(summary.id);
      if (!ralliesRes.ok) {
        result.failed++;
        result.warnings.push(
          `Could not fetch rallies for ${summary.opponent}: ${ralliesRes.reason}`
        );
        continue;
      }
      const parsed = parseSidelineLiveMatch({
        summary,
        rallies: ralliesRes.data,
        team,
        teamProfileId,
      });
      if (!parsed.match) {
        result.failed++;
        result.warnings.push(
          `Parser returned no match for ${summary.opponent}: ${parsed.warnings.join('; ')}`
        );
        continue;
      }
      await saveMatch(parsed.match);
      existingIds.add(parsed.match.id);
      result.imported++;
      result.importedIds.push(parsed.match.id);
      if (parsed.warnings.length > 0) {
        for (const w of parsed.warnings.slice(0, 2)) {
          result.warnings.push(`${summary.opponent}: ${w}`);
        }
      }
    } catch (err: unknown) {
      result.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      result.warnings.push(`Import failed for ${summary.opponent}: ${msg}`);
    }
  }

  return result;
}

/** Count how many of a candidate list are already in storage. */
export async function countAlreadyImported(
  candidates: SidelineHdMatchSummary[]
): Promise<number> {
  const existing = await loadMatches();
  const existingIds = new Set(existing.map((m) => m.id));
  let count = 0;
  for (const s of candidates) {
    if (existingIds.has(makeSidelineLiveMatchId(s.id))) count++;
  }
  return count;
}
