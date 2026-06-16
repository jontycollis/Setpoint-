// ── TournamentSource interface ────────────────────────────────────────────
//
// Today's source modules (aesSeasonIndex, timuSeasonIndex,
// manualTournaments) each implement the same conceptual contract —
// "given a team identity, give me their tournaments" — with slightly
// different surface APIs that grew organically. This module defines the
// shared contract every new source must conform to, and a tiny registry
// that lets `buildMySeasonHistory` and friends iterate over registered
// sources without hardcoding each one.
//
// Why a separate module under `src/sources/` rather than colocating with
// each source's existing index module?
//   • The interface lives BETWEEN the storage modules and the unified
//     reader. Putting it in `utils/` would tangle it with the legacy
//     readers; putting it in any one source's module would suggest
//     ownership it doesn't have.
//   • Future adapters (MyTeam.Click for beach, VC Beach Tour) land in
//     `src/sources/<name>/` so the structure scales obviously.
//
// Adoption is OPT-IN. Legacy source modules don't have to migrate
// immediately — buildMySeasonHistory keeps its current source-specific
// blocks. Newly-added sources register themselves; the unified reader
// will iterate registered sources in a follow-up pass when the legacy
// blocks are extracted.
// ──────────────────────────────────────────────────────────────────────────

import type { UnifiedTournamentEntry } from '../utils/unifiedSeasonHistory';

/**
 * Stable identifier matching the `source` discriminator on
 * UnifiedTournamentEntry. Sources MUST claim exactly one of these so
 * downstream readers can route by source if they need to.
 */
export type TournamentSourceId =
  | 'aes'
  | 'timu'
  | 'scored'
  | 'manual'
  | 'myteamclick'
  | 'vcbeach';

/**
 * Lookup hints a caller passes into `getEntries`. Sources should use
 * whatever fields they recognise and ignore the rest. The shape mirrors
 * the args buildMySeasonHistory threads through today.
 */
export interface SourceQuery {
  /** Aliases identifying the user's team(s). Empty array = no filter. */
  aliases: string[];
  /**
   * TeamProfile ids the caller wants entries scoped to. Optional —
   * sources that don't track teamProfileId (AES, Timu) ignore this.
   * The manual source uses this as its canonical identity filter.
   */
  teamProfileIds?: string[];
  /**
   * When true, drop entries flagged with `includeInStats === false`.
   * Sources that don't have an inclusion flag ignore this.
   */
  respectIncludeInStats?: boolean;
}

/**
 * Contract every source must implement. Async because most sources load
 * from AsyncStorage (or the network, for a hypothetical live mirror).
 *
 * Sources MUST NOT throw from `getEntries` — return an empty array on
 * any internal error and log via `__DEV__` console.warn. The unified
 * reader needs the registry iteration to be all-or-nothing safe.
 */
export interface TournamentSource {
  /** Stable id matching the `source` discriminator on entries. */
  readonly id: TournamentSourceId;
  /** Display label for diagnostic surfaces (e.g. "MyTeam.Click"). */
  readonly displayName: string;
  /**
   * Return every entry this source has for the given query. Multiple
   * calls during a single read pass should be cheap — sources that
   * load from AsyncStorage can memoise per `loadAllSeasonIndices`
   * batch via the optional `preload` step.
   */
  getEntries(query: SourceQuery): Promise<UnifiedTournamentEntry[]>;
  /**
   * Optional batch preload — sources that read from AsyncStorage can
   * use this to do one read for the entire batch and cache in a
   * closure. `getEntries` then reads from the cached copy. Unified
   * reader calls preload once per loadAllSeasonIndices invocation.
   */
  preload?(): Promise<void>;
}

/**
 * Tiny in-memory registry. Sources are registered at module-load time
 * via `registerTournamentSource`; the unified reader pulls the list
 * via `getRegisteredSources` when it's ready to iterate.
 *
 * Idempotent — re-registering the same id replaces the prior
 * registration. Useful in tests that swap implementations.
 */
const REGISTRY = new Map<TournamentSourceId, TournamentSource>();

export function registerTournamentSource(source: TournamentSource): void {
  REGISTRY.set(source.id, source);
}

export function getRegisteredSources(): TournamentSource[] {
  return Array.from(REGISTRY.values());
}

export function getRegisteredSource(
  id: TournamentSourceId
): TournamentSource | undefined {
  return REGISTRY.get(id);
}

/**
 * Test-only — wipe the registry between test runs so prior
 * registrations don't leak. NOT exported from the package index;
 * tests import directly.
 */
export function clearTournamentSourceRegistry(): void {
  REGISTRY.clear();
}
