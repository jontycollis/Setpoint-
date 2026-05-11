// ── Historical match importer ─────────────────────────────────────────────
//
// One-shot import path for bundled Sideline HD historical exports. Each
// bundle is a static asset shipped inside the app (under
// `src/assets/imports/`), produced by the offline JSON-build pipeline that
// converts a season's Sideline HD workbook to Tier-2 `Match[]` records.
//
// The bundle's home-side `teamProfileId` is a placeholder string —
// `__SETPOINT_PVC_PROFILE_ID__` for the PVC bundle. The importer substitutes
// the user's actual TeamProfile id at import time so the matches link
// cleanly into Tier-2 analytics.
//
// Import is idempotent: matches use deterministic ids
// (`import-pvc-<matchId>`) and `runHistoricalImport` skips any id already
// present in `scoredMatchStore`. Re-running the import is therefore safe
// and incremental — useful if the bundle gets refreshed in a later build.
// ──────────────────────────────────────────────────────────────────────────

import type { Match } from '../types/match';
import type { UserProfile, TeamProfile } from '../types/profile';
import { findTeamProfileByAlias } from './userProfile';
import { loadMatches, saveMatch } from './scoredMatchStore';

/** Placeholder that bundled records use for the home team profile id. */
const PVC_PLACEHOLDER_TEAM_PROFILE_ID = '__SETPOINT_PVC_PROFILE_ID__';

export interface HistoricalImportBundle {
  /** Stable id for the bundle — used by the screen to remember "already done". */
  id: string;
  /** Human-readable label, e.g. "PVC 3D Titanium 2025-26 season". */
  label: string;
  /** Match count — for the UI summary line. */
  matchCount: number;
  /** Team label the importer needs on the user's TeamProfile list. */
  targetTeamLabel: string;
  /** Parsed matches. The home side has the placeholder team profile id;
   *  `runHistoricalImport` substitutes at write time. */
  pvcMatches: Match[];
}

export interface HistoricalImportResult {
  imported: number;
  skipped: number;
  warnings: string[];
}

/**
 * Static bundle accessor. The JSON asset is required at module-eval time —
 * Metro bundles it into the JS payload so the import works offline on
 * first launch (no network call, no AsyncStorage seed).
 */
export function getHistoricalImportBundle(): HistoricalImportBundle {
  // Cast through unknown: the JSON has a couple of extra `meta` fields
  // (e.g. `videoUrl`) that the TS Match type doesn't declare. The runtime
  // shape is otherwise correct — every consumer reads the documented
  // fields only, and unknown extras pass through `saveMatch` untouched.
  const matches = require('../assets/imports/pvc_3d_titanium_historical_matches.json') as unknown as Match[];
  return {
    id: 'pvc-3d-titanium-2025-26',
    label: 'PVC 3D Titanium 2025-26 season',
    matchCount: matches.length,
    targetTeamLabel: 'PVC 3D Titanium',
    pvcMatches: matches,
  };
}

/**
 * Resolve the bundle's `targetTeamLabel` against the user's TeamProfiles
 * using the same alias comparator the rest of the app uses for "which of
 * my teams is this name?" lookups. Returns null when no profile matches —
 * the caller surfaces a "add this team first" UI state.
 */
export function findImportTargetTeam(
  profile: UserProfile | null | undefined,
  bundle: HistoricalImportBundle
): TeamProfile | null {
  return findTeamProfileByAlias(profile, bundle.targetTeamLabel);
}

/**
 * Lightweight runtime check for a Match record. We don't try to validate
 * the rules-engine derivation here — the engine itself tolerates the
 * gap-filled / malformed records by best-effort reduction. We just verify
 * the storage-layer invariants so a bad record doesn't poison the blob.
 */
function isPlausibleMatch(m: unknown): m is Match {
  if (!m || typeof m !== 'object') return false;
  const cast = m as Partial<Match>;
  if (typeof cast.id !== 'string' || !cast.id) return false;
  if (!cast.meta || typeof cast.meta !== 'object') return false;
  if (!Array.isArray(cast.events)) return false;
  if (!cast.rosters || typeof cast.rosters !== 'object') return false;
  if (typeof cast.createdAt !== 'number') return false;
  return true;
}

/**
 * Walk the bundle, substitute the placeholder team-profile id for the
 * user's actual id, and persist any matches that aren't already present
 * in `scoredMatchStore`. Errors per-match are caught and surfaced as
 * warnings so a single malformed record can't abort the whole import —
 * the Sideline HD source has a handful of gap-filled / inconsistent sets
 * that we accept as best-effort historical data.
 */
export async function runHistoricalImport(
  bundle: HistoricalImportBundle,
  targetTeamId: string,
  _options: Record<string, never> = {}
): Promise<HistoricalImportResult> {
  const warnings: string[] = [];
  let imported = 0;
  let skipped = 0;

  const existing = await loadMatches();
  const existingIds = new Set(existing.map((m) => m.id));

  for (const raw of bundle.pvcMatches) {
    try {
      if (!isPlausibleMatch(raw)) {
        const id =
          (raw as { id?: unknown })?.id != null
            ? String((raw as { id?: unknown }).id)
            : '(unknown)';
        warnings.push(`Skipped malformed record ${id}: missing required fields`);
        // eslint-disable-next-line no-console
        console.warn(`[historicalImporter] malformed record skipped:`, id);
        continue;
      }

      if (existingIds.has(raw.id)) {
        skipped++;
        continue;
      }

      // Substitute the placeholder team-profile id on the home side.
      const homeProfileId = raw.meta.home?.teamProfileId;
      const next: Match = {
        ...raw,
        meta: {
          ...raw.meta,
          home: {
            ...raw.meta.home,
            teamProfileId:
              homeProfileId === PVC_PLACEHOLDER_TEAM_PROFILE_ID
                ? targetTeamId
                : homeProfileId ?? targetTeamId,
          },
        },
      };

      await saveMatch(next);
      imported++;
    } catch (err: unknown) {
      const id =
        (raw as { id?: unknown })?.id != null
          ? String((raw as { id?: unknown }).id)
          : '(unknown)';
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Match ${id}: ${message}`);
      // eslint-disable-next-line no-console
      console.warn(`[historicalImporter] failed to import ${id}:`, message);
    }
  }

  return { imported, skipped, warnings };
}

/**
 * Count how many of the bundle's matches are already in storage. Used by
 * the UI to render the "already imported" state on re-entry.
 */
export async function countImportedFromBundle(
  bundle: HistoricalImportBundle
): Promise<number> {
  const existing = await loadMatches();
  const existingIds = new Set(existing.map((m) => m.id));
  let count = 0;
  for (const m of bundle.pvcMatches) {
    if (existingIds.has(m.id)) count++;
  }
  return count;
}
