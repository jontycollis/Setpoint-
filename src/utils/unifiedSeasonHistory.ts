// ── Unified Season History ─────────────────────────────────────────────────
//
// Merges AES and Timu season snapshots into a single ordered list of
// "tournament entries" for MyTeam. Each entry carries enough info to
// render the My Season History screen (division/subtitle, date, pool
// rank, final rank, matches grouped Pool / Playoffs) regardless of source.
// ────────────────────────────────────────────────────────────────────────────

import {
  loadSeasonIndex as loadTimuIndex,
  sortedSnapshots as sortedTimuSnapshots,
  type TimuTournamentSnapshot,
  type SeasonIndex as TimuSeasonIndex,
} from './timuSeasonIndex';
import {
  loadAesSeasonIndex,
  sortedAesSnapshots,
  type AesTournamentSnapshot,
  type AesSeasonIndex,
} from './aesSeasonIndex';
import { matchesAnyAlias, normalizeName } from './seasonTeamIdentity';
import { loadNormalisedMatches } from './matchMeta';
import { deriveMatchState } from './matchEngine';
import type { Match, Side } from '../types/match';
import {
  loadManualTournaments,
  type ManualTournamentEntry,
} from './manualTournaments';
import {
  loadMtcSeasonIndex,
  sortedMtcSnapshots,
  snapshotToUnifiedEntries,
  type MtcSeasonIndex,
} from './myteamClickSeasonIndex';

// ── Unified tournament entry (renderable by SeasonHistoryScreen) ──────────

export interface UnifiedTournamentEntry {
  /**
   * Where this entry came from.
   *
   *   • `'aes'`    — indexed AES tournament snapshot
   *   • `'timu'`   — indexed Timu tournament snapshot
   *   • `'scored'` — match scored locally via Tier 2 (or imported via
   *                   the Sideline HD pipeline). Each scored match
   *                   becomes one entry here, regardless of whether
   *                   it's linked to an AES / Timu tournament.
   *   • `'manual'` — user-typed tournament summary (beach pool weekends
   *                   not on AES/Timu, indoor events imported from a
   *                   PDF, etc.). One entry per tournament, totals are
   *                   entered directly; no per-match drill.
   *   • `'myteamclick'` — indexed snapshot from the MyTeam.Click
   *                   platform. Primary beach data source for
   *                   Ontario; carries per-pair partner data.
   */
  source: 'aes' | 'timu' | 'scored' | 'manual' | 'myteamclick';
  /** For `source: 'manual'` entries, the ManualTournamentEntry.id so the
   *  caller can edit/delete the underlying record. */
  manualEntryId?: string;
  /** Stable tournament key — used for routing and dedup. */
  sourceKey: string;
  // AES-specific
  eventKey?: string;
  divisionId?: number;
  /** Numeric AES team id for the user's team in this snapshot. Required
   *  to route into TeamDashboard via `handleNavigateToFavorite` — without
   *  it the upcoming-tournament tap can't resolve to a specific row. */
  myTeamId?: number;
  /** Division accent color from the AES snapshot — used to seed the
   *  recently-viewed row when we navigate from an upcoming card. */
  divisionColorHex?: string;
  // Timu-specific
  tid?: number;
  // Scored-specific
  /** The local Match.id for `source: 'scored'` entries. */
  matchId?: string;
  /** Per-match `includeInStats` flag (only set for scored entries). */
  includeInStats?: boolean;
  /** `matchKind` for scored entries — lets analytics readers split by
   *  AES vs Timu vs Standalone vs Imported even when the match isn't
   *  linked to a snapshot. */
  matchKind?: 'aes' | 'timu' | 'standalone' | 'imported';

  /**
   * Indoor vs beach. AES + Timu snapshots are always 'indoor' (those
   * platforms don't host beach). Scored entries read from `match.meta.sport`.
   * MyTeam.Click entries (when that adapter ships) are always 'beach'.
   * The SeasonHistory + Analytics filters key off this.
   */
  sport: 'indoor' | 'beach';

  /**
   * For beach entries only: who the athlete partnered with at this event.
   * Beach partnerships change per tournament, so this is per-entry, not
   * per-TeamProfile. Undefined for indoor entries and for beach entries
   * where the source data didn't surface a partner.
   */
  beachPartner?: { name: string; shirt?: number };

  tournamentName: string;
  /** Division / subtitle — "18U Girls G" (AES) or "Trillium White C" (Timu). */
  subtitle?: string;
  dateText?: string;
  dateMs?: number;
  venueName?: string;

  /**
   * The user's team's name as it appears in THIS tournament's data. May
   * differ from the canonical alias (e.g. "Defensa U17 Rob" in 2024–25
   * vs "Defensa Rob" in the alias list). Use this when navigating to
   * the tournament's team dashboard so the right row is selected.
   */
  myTeamAsSeen?: string;

  /** Total match results stored in the snapshot, regardless of team filter. */
  totalMatchesInSnapshot?: number;
  /** When the snapshot was last fetched from Timu/AES. */
  indexedAt?: number;

  /** Pool name / id ("A", "B"...). AES standings don't surface pool id. */
  poolId?: string;
  /** My team's pool rank. */
  poolRank: number | null;
  /** My team's final rank. */
  finalRank: number | null;
  finalRankLabel: string | null;

  /**
   * Total teams in this entry's division / pool field. Used by
   * "where I fit in" analytics to derive a percentile (finalRank /
   * fieldSize). Surfaced from AES `snap.teams.length` and Timu
   * `snap.finalRankings.length || snap.teams.length`. Undefined for
   * locally-scored entries — they have no field-size signal.
   */
  fieldSize?: number;

  /** Pool play aggregate (from standings for AES, from pool stats for Timu). */
  matchesFor: number;
  matchesAgainst: number;
  setsFor: number;
  setsAgainst: number;

  /** My team's matches (both pool + playoffs). */
  matches: UnifiedMatchEntry[];
}

export interface UnifiedMatchEntry {
  dateText: string;
  time: string;
  court: string;
  roundLabel: string;
  isPool: boolean;
  opponentName: string;
  mySetsWon: number;
  oppSetsWon: number;
  myScores: number[];
  oppScores: number[];
  iWon: boolean;
}

// ── Query ─────────────────────────────────────────────────────────────────

export interface LoadedIndices {
  timu: TimuSeasonIndex;
  aes: AesSeasonIndex;
  /**
   * Locally-scored matches. Pulled from `scored.matches.v1` and
   * normalised so the new analytics fields (`matchKind`, `source`,
   * `includeInStats`) are guaranteed to be present.
   */
  scored: Match[];
  /**
   * User-typed tournament summaries from `manual.tournaments.v1`.
   * Today's primary use case is BEACH tournaments — the OVA / VC
   * platforms don't index those. One entry per tournament, totals
   * typed directly (no per-match drill).
   *
   * Optional so verification scripts + tests that synthesise a
   * LoadedIndices without manual entries don't need to patch every
   * fixture. Production code (loadAllSeasonIndices) always populates
   * it.
   */
  manual?: ManualTournamentEntry[];
  /**
   * MyTeam.Click event snapshots from `myteamclick.seasonIndex.v1`.
   * Primary beach data source for Ontario players. Optional for the
   * same reason as `manual` — legacy fixtures stay green.
   */
  myteamclick?: MtcSeasonIndex;
}

/** Read all sources once. Callers that need fresh data should call this. */
export async function loadAllSeasonIndices(): Promise<LoadedIndices> {
  const [timu, aes, scored, manual, myteamclick] = await Promise.all([
    loadTimuIndex(),
    loadAesSeasonIndex(),
    loadNormalisedMatches(),
    loadManualTournaments(),
    loadMtcSeasonIndex(),
  ]);
  return { timu, aes, scored, manual, myteamclick };
}

/**
 * Options for shaping the unified history result.
 */
export interface BuildHistoryOpts {
  /**
   * When `true`, scored matches with `includeInStats === false` are
   * dropped. Analytics readers (per-player roll-ups, "Season at a
   * glance") should pass `true`. Default `false` so Career-card-style
   * readers see every match the user has played.
   *
   * Has no effect on AES / Timu indexed entries — those don't carry
   * an inclusion flag.
   */
  respectIncludeInStats?: boolean;

  /**
   * TeamProfile ids that scope the manual-tournament filter. Manual
   * entries are attached to a TeamProfile directly (not aliases), so
   * when callers know the team(s) they're showing they should pass
   * the id(s) here so other-team manual entries don't leak in.
   *
   * When undefined, EVERY manual entry is included regardless of
   * teamProfileId — the legacy alias-driven filter is the only gate.
   * This default lets pre-existing call sites pick up manual entries
   * without code changes; updated callers should pass the ids
   * explicitly for tighter scoping.
   */
  teamProfileIds?: string[];

  /**
   * MyTeam.Click player ids to scope the beach-source filter to.
   * Snapshots are stored per-(event, player) so a multi-athlete
   * account can have several. Pass the active athlete's linked
   * MyTeam.Click id here; legacy callers (undefined) see every
   * snapshot.
   */
  myteamClickPlayerIds?: string[];
}

/**
 * Build a unified history for the user's team across all sources
 * (AES indexed snapshots, Timu indexed snapshots, locally scored
 * matches). Matches snapshots whose "my team" identity equals any of
 * the supplied aliases (case + whitespace insensitive, age-group
 * marker tolerant).
 *
 * Scored matches whose home / away label doesn't match any alias are
 * dropped. The `respectIncludeInStats` flag (in `opts`) gates whether
 * `includeInStats === false` scored matches are filtered out.
 */
export function buildMySeasonHistory(
  indices: LoadedIndices,
  aliases: string[],
  opts: BuildHistoryOpts = {}
): UnifiedTournamentEntry[] {
  if (aliases.length === 0) return [];
  const out: UnifiedTournamentEntry[] = [];

  // AES — filter snapshots whose myTeamText matches any alias.
  for (const snap of sortedAesSnapshots(indices.aes)) {
    if (!matchesAnyAlias(snap.myTeamText, aliases) &&
        !matchesAnyAlias(snap.myTeamName, aliases)) {
      continue;
    }
    out.push(aesSnapshotToUnified(snap));
  }

  // Timu — find the team row inside each snapshot that matches an alias.
  for (const snap of sortedTimuSnapshots(indices.timu)) {
    const myRow = snap.teams.find(
      (t) => matchesAnyAlias(t.teamName, aliases)
    );
    if (!myRow) continue;
    // Pass both the team-row name AND the user's full alias list so the
    // match filter can fall back to alias matching when results.php has a
    // slightly different spelling than the pool table.
    out.push(timuSnapshotToUnified(snap, myRow.teamName, aliases));
  }

  // Scored / imported matches — one UnifiedTournamentEntry per match.
  for (const m of indices.scored) {
    const entry = scoredMatchToUnified(m, aliases);
    if (!entry) continue;
    if (opts.respectIncludeInStats && entry.includeInStats === false) continue;
    out.push(entry);
  }

  // Manual entries — one per tournament. Beach-heavy today (AES /
  // Timu don't index beach); also accepts indoor for users importing
  // prior seasons from PDF / paper standings. Filter is teamProfileId-
  // driven: each manual entry has a canonical TeamProfile attachment,
  // so when the caller knows which team they're showing, only that
  // team's entries should appear. Legacy callers that don't pass
  // teamProfileIds see every manual entry (matches alias-driven
  // behavior for the indexed sources).
  if (indices.manual && indices.manual.length > 0) {
    const scopeIds = opts.teamProfileIds;
    for (const m of indices.manual) {
      if (scopeIds && scopeIds.length > 0) {
        if (!scopeIds.includes(m.teamProfileId)) continue;
      }
      out.push(manualEntryToUnified(m));
    }
  }

  // MyTeam.Click snapshots — primary beach data source. Each snapshot
  // is tied to a specific MyTeam.Click player id; the projection
  // already filters internally to the right athlete, but the caller
  // can pass `myteamClickPlayerIds` via opts to narrow further
  // (e.g. when showing only the active athlete's beach history).
  if (indices.myteamclick) {
    const playerScope = opts.myteamClickPlayerIds;
    for (const snap of sortedMtcSnapshots(indices.myteamclick)) {
      if (
        playerScope &&
        playerScope.length > 0 &&
        !playerScope.includes(snap.myPlayerId)
      ) {
        continue;
      }
      out.push(...snapshotToUnifiedEntries(snap));
    }
  }

  // Sort unified list newest → oldest.
  out.sort((a, b) => (b.dateMs ?? 0) - (a.dateMs ?? 0));
  return out;
}

// ── Upcoming-tournaments helpers (shared between MyHome, dashboards) ─────

/**
 * Filter `buildMySeasonHistory` results to entries whose `dateMs` is in
 * the future, sorted earliest → latest. Used by MyHome's per-team card
 * upcoming line and by the team dashboards' "Upcoming Tournaments"
 * section. One source of truth for what counts as "upcoming" so the
 * different screens can never disagree about which tournament is next.
 *
 * If the lookup returns empty in __DEV__ AND debugLabel is provided, we
 * log a diagnostic dump of the matcher's inputs (aliases vs every
 * indexed AES / Timu team-name) so the gap is investigable without a
 * debugger session. Disabled silently in production builds.
 */
export function getUpcomingTournaments(
  indices: LoadedIndices,
  aliases: string[],
  opts?: { debugLabel?: string }
): UnifiedTournamentEntry[] {
  const history = buildMySeasonHistory(indices, aliases);
  const now = Date.now();
  const upcoming = history
    .filter((e) => e.dateMs != null && e.dateMs > now)
    .sort((a, b) => (a.dateMs ?? 0) - (b.dateMs ?? 0));

  if (__DEV__ && opts?.debugLabel && upcoming.length === 0) {
    // Build a one-shot diagnostic. The two failure modes we've seen so far:
    //   (a) aliases miss the indexed team-name spelling (strict matcher)
    //   (b) entries match but every dateMs is null or in the past
    const indexedAesNames = new Set<string>();
    for (const snap of sortedAesSnapshots(indices.aes)) {
      if (snap.myTeamText) indexedAesNames.add(snap.myTeamText);
      if (snap.myTeamName) indexedAesNames.add(snap.myTeamName);
    }
    const indexedTimuNames = new Set<string>();
    for (const snap of sortedTimuSnapshots(indices.timu)) {
      for (const t of snap.teams) indexedTimuNames.add(t.teamName);
    }
    const matchedHistory = history.length;
    const futureCandidates = history.filter((e) => e.dateMs != null && e.dateMs > now).length;
    const undatedMatches = history.filter((e) => e.dateMs == null).length;
    const pastMatches = history.filter((e) => e.dateMs != null && e.dateMs <= now).length;
    // eslint-disable-next-line no-console
    console.warn(
      `[upcoming-tournaments] ${opts.debugLabel}: 0 upcoming.\n` +
        `  aliases (normalized): ${aliases.map((a) => normalizeName(a)).filter(Boolean).join(' | ') || '(empty)'}\n` +
        `  history matches: ${matchedHistory} (undated: ${undatedMatches}, past: ${pastMatches}, future: ${futureCandidates})\n` +
        `  indexed AES team-names: ${[...indexedAesNames].join(' | ') || '(empty index)'}\n` +
        `  indexed Timu team-names: ${[...indexedTimuNames].join(' | ') || '(empty index)'}`
    );
  }

  return upcoming;
}

/** Convenience: just the next one (or null). */
export function getNextUpcomingTournament(
  indices: LoadedIndices,
  aliases: string[],
  opts?: { debugLabel?: string }
): UnifiedTournamentEntry | null {
  return getUpcomingTournaments(indices, aliases, opts)[0] ?? null;
}

// ── Active-tournament predicate ───────────────────────────────────────────
//
// "Active" = the user is about to walk into this gym, or they're already
// at the gym. Drives the pinned "Active" section at the top of Season
// History. Looking at the user's own intent:
//
//   • Within the next 7 days (so they see Pool Friday at Monday breakfast)
//   • Currently in progress (heuristic: starts within the last 48h — most
//     OVA / Timu tournaments are one to three days)
//
// We use tournament `dateMs` (the start date the snapshot recorded) rather
// than per-match scheduled times because UnifiedTournamentEntry.matches
// only carries completed matches; scheduled future matches live in AES /
// Timu schedule endpoints that the snapshot pipeline doesn't preserve.
// The 48h grace covers the in-progress case without needing a separate
// "ended" timestamp on the snapshot.
// ──────────────────────────────────────────────────────────────────────────

/** ms in a day — only used in the active-window math below. */
const DAY_MS = 24 * 60 * 60 * 1000;
/** How far ahead we treat as "active". */
export const ACTIVE_WINDOW_FORWARD_MS = 7 * DAY_MS;
/** How far back a tournament start can be before we stop calling it
 *  "currently playing". Two days covers a Sat–Sun tournament started on
 *  Friday; longer than that and we trust the user's own past-results
 *  view rather than the active pin. */
export const ACTIVE_WINDOW_BACKWARD_MS = 2 * DAY_MS;

/**
 * Returns a short label describing the proximity of a tournament's start
 * date relative to now. Used on the "current tournament" badge in the
 * MyHome team tiles and the Tournaments sub-page.
 *
 *   • "Currently playing"  when the start date has passed
 *   • "Starts today"       when delta < 1 day
 *   • "Starts tomorrow"    when delta is exactly 1 day
 *   • "Starts in N days"   when delta > 1 day
 *   • "Active"             when no dateMs is known
 *
 * The countdown rounds to the nearest day so a tournament 36 hours out
 * reads "Starts in 2 days" rather than "Starts in 1.5 days".
 */
export function currentTournamentBadgeLabel(
  dateMs: number | undefined,
  nowMs: number = Date.now()
): string {
  if (dateMs == null) return 'Active';
  const delta = dateMs - nowMs;
  if (delta <= 0) return 'Currently playing';
  const days = Math.round(delta / DAY_MS);
  if (days === 0) return 'Starts today';
  if (days === 1) return 'Starts tomorrow';
  return `Starts in ${days} days`;
}

/**
 * Returns true when this tournament is either upcoming within
 * `ACTIVE_WINDOW_FORWARD_MS` or recent enough that it's plausibly still
 * being played (`ACTIVE_WINDOW_BACKWARD_MS`). Tournaments without a
 * `dateMs` can't be placed on the timeline and never count as active.
 */
export function isActiveTournament(
  entry: UnifiedTournamentEntry,
  nowMs: number = Date.now()
): boolean {
  if (entry.dateMs == null) return false;
  const delta = entry.dateMs - nowMs;
  return (
    delta <= ACTIVE_WINDOW_FORWARD_MS && delta >= -ACTIVE_WINDOW_BACKWARD_MS
  );
}

/**
 * Filter a history list down to the active set, sorted earliest →
 * latest (so an in-progress tournament beats one starting next week,
 * matching the user's mental priority). The history can include past
 * tournaments without filtering — `isActiveTournament` excludes them.
 */
export function getActiveTournaments(
  history: readonly UnifiedTournamentEntry[],
  nowMs: number = Date.now()
): UnifiedTournamentEntry[] {
  return history
    .filter((e) => isActiveTournament(e, nowMs))
    .sort((a, b) => (a.dateMs ?? 0) - (b.dateMs ?? 0));
}

// ── Source-specific adapters ──────────────────────────────────────────────

function aesSnapshotToUnified(snap: AesTournamentSnapshot): UnifiedTournamentEntry {
  // Find my team in the standings for final rank.
  const myStanding = snap.teams.find((t) => t.teamId === snap.myTeamId);
  const finalRank = myStanding?.rank ?? null;
  const finalRankLabel = finalRank != null ? ordinal(finalRank) : null;

  // Derive matches/sets totals from the per-match results, NOT from
  // myStanding. AES "standings" rows are pool-only — they exclude playoff
  // matches, which made career/YoY rollups dramatically under-count both
  // matches conceded AND sets conceded. The matches array below covers
  // pool play + every playoff round, which is what the user expects.
  const completed = snap.matches.filter((m) => m.hasScores);
  let matchesFor = 0;
  let matchesAgainst = 0;
  let setsFor = 0;
  let setsAgainst = 0;
  for (const m of completed) {
    // Skip undecided matches (equal sets won) — usually means the match
    // is in progress and the API hasn't promoted it to a final result.
    if (m.mySetsWon === m.oppSetsWon) continue;
    if (m.iWon) matchesFor++;
    else matchesAgainst++;
    setsFor += m.mySetsWon;
    setsAgainst += m.oppSetsWon;
  }

  return {
    source: 'aes',
    sport: 'indoor',
    sourceKey: `aes:${snap.eventKey}:${snap.divisionId}`,
    eventKey: snap.eventKey,
    divisionId: snap.divisionId,
    myTeamId: snap.myTeamId,
    divisionColorHex: snap.divisionColorHex,
    tournamentName: snap.eventName,
    subtitle: snap.divisionName,
    dateText: snap.dateText,
    dateMs: snap.dateMs,
    venueName: snap.venueName,
    myTeamAsSeen: snap.myTeamText || snap.myTeamName,
    poolId: undefined, // AES standings don't surface pool id directly
    poolRank: finalRank, // AES conflates pool + finish — use finish rank
    finalRank,
    finalRankLabel,
    // Division field size — the standings list IS the field for AES.
    fieldSize: snap.teams.length > 0 ? snap.teams.length : undefined,
    matchesFor,
    matchesAgainst,
    setsFor,
    setsAgainst,
    totalMatchesInSnapshot: snap.matches.length,
    indexedAt: snap.indexedAt,
    matches: completed.map((m) => ({
      dateText: m.dateText,
      time: m.time,
      court: m.court,
      roundLabel: m.roundLabel,
      isPool: m.isPool,
      opponentName: m.opponentText,
      mySetsWon: m.mySetsWon,
      oppSetsWon: m.oppSetsWon,
      myScores: m.myScores,
      oppScores: m.oppScores,
      iWon: m.iWon,
    })),
  };
}

function timuSnapshotToUnified(
  snap: TimuTournamentSnapshot,
  myTeamNameAsSeen: string,
  aliases: string[]
): UnifiedTournamentEntry {
  // Locate my team's pool row by matching on the row name we already know
  // is in the table (myTeamNameAsSeen comes from the alias-fuzzy match).
  const myRow = snap.teams.find(
    (t) => normalizeName(t.teamName) === normalizeName(myTeamNameAsSeen)
  );

  const finalR = snap.finalRankings.find(
    (r) => normalizeName(r.teamName) === normalizeName(myTeamNameAsSeen)
  );

  /**
   * Build the alias set we use to recognise "me" inside results.php.
   * Sometimes Timu's pool table and results page spell the team slightly
   * differently (extra age-group token, different capitalisation), so we
   * combine our broader alias list with the as-seen-in-pool name and use
   * the fuzzy `matchesAnyAlias` matcher rather than strict equality.
   */
  const matchAliases = Array.from(
    new Set([myTeamNameAsSeen, ...aliases].filter(Boolean))
  );

  // Build match entries from results.
  const matches: UnifiedMatchEntry[] = [];
  for (const r of snap.results) {
    const iAmHome = matchesAnyAlias(r.home.name, matchAliases);
    const iAmAway = !iAmHome && matchesAnyAlias(r.away.name, matchAliases);
    if (!iAmHome && !iAmAway) continue;
    const me = iAmHome ? r.home : r.away;
    const opp = iAmHome ? r.away : r.home;
    const { isPool, roundLabel } = parseRound(r.matchLabel);
    matches.push({
      dateText: r.dateText || snap.dateText || '',
      time: r.time || '',
      court: r.court,
      roundLabel,
      isPool,
      opponentName: opp.name,
      mySetsWon: me.setsWon,
      oppSetsWon: opp.setsWon,
      myScores: me.scores,
      oppScores: opp.scores,
      iWon: me.setsWon > opp.setsWon,
    });
  }

  // Same fix as AES: pool standings (myRow.matchesFor / matchesAgainst /
  // setsFor / setsAgainst) only reflect pool play. Derive cumulative
  // totals from the per-match `matches` array we just built — that
  // includes playoffs, so career/YoY rollups stop under-counting.
  let matchesFor = 0;
  let matchesAgainst = 0;
  let setsFor = 0;
  let setsAgainst = 0;
  for (const m of matches) {
    if (m.mySetsWon === m.oppSetsWon) continue; // undecided
    if (m.iWon) matchesFor++;
    else matchesAgainst++;
    setsFor += m.mySetsWon;
    setsAgainst += m.oppSetsWon;
  }

  return {
    source: 'timu',
    sport: 'indoor',
    sourceKey: `timu:${snap.tid}`,
    tid: snap.tid,
    tournamentName: snap.name,
    subtitle: snap.subtitle,
    dateText: snap.dateText,
    dateMs: snap.dateMs,
    venueName: snap.venueName,
    myTeamAsSeen: myTeamNameAsSeen,
    poolId: myRow?.poolId,
    poolRank: myRow?.rank ?? null,
    finalRank: finalR?.rank ?? null,
    finalRankLabel: finalR?.rankLabel ?? null,
    // Field size — prefer the final-rankings list (covers the full
    // tournament) over the pool standings (pool-only). Falls back to
    // pool size when finalRankings is empty (Timu can leave this
    // unpopulated until results are official).
    fieldSize:
      snap.finalRankings.length > 0
        ? snap.finalRankings.length
        : snap.teams.length > 0
          ? snap.teams.length
          : undefined,
    matchesFor,
    matchesAgainst,
    setsFor,
    setsAgainst,
    matches,
    totalMatchesInSnapshot: snap.results.length,
    indexedAt: snap.indexedAt,
  };
}

/**
 * Project a manual tournament entry onto the unified entry shape.
 * Trivial — manual entries already carry every field the unified view
 * needs (no per-match drill, totals are entered directly). Source-
 * specific fields (manualEntryId) let the screen route to an editor.
 */
function manualEntryToUnified(
  entry: ManualTournamentEntry
): UnifiedTournamentEntry {
  return {
    source: 'manual',
    sourceKey: `manual:${entry.id}`,
    manualEntryId: entry.id,
    sport: entry.sport,
    tournamentName: entry.tournamentName,
    subtitle: entry.subtitle,
    dateText: entry.dateText,
    dateMs: entry.dateMs,
    venueName: entry.venueName,
    beachPartner: entry.beachPartner,
    poolRank: null,
    finalRank: entry.finalRank ?? null,
    finalRankLabel:
      entry.finalRank != null ? ordinal(entry.finalRank) : null,
    fieldSize: entry.fieldSize,
    matchesFor: entry.matchesFor,
    matchesAgainst: entry.matchesAgainst,
    setsFor: entry.setsFor,
    setsAgainst: entry.setsAgainst,
    matches: [], // Manual entries don't carry per-match detail.
    indexedAt: entry.updatedAt,
  };
}

/**
 * Project a locally-scored match onto the unified entry shape. Returns
 * `null` when the match's home / away label doesn't match any alias
 * (i.e. this match isn't the user's team). Each scored match becomes
 * one entry; pool/playoff context is derived from `tournamentContext`
 * if present, otherwise the match shows up under its own label.
 */
function scoredMatchToUnified(
  match: Match,
  aliases: string[]
): UnifiedTournamentEntry | null {
  const meta = match.meta;
  const isHome = matchesAnyAlias(meta.home.label, aliases);
  const isAway = !isHome && matchesAnyAlias(meta.away.label, aliases);
  if (!isHome && !isAway) return null;

  const state = deriveMatchState(match);
  const myFromSide: Side = isHome ? 'home' : 'away';
  const oppFromSide: Side = isHome ? 'away' : 'home';
  const opponentName = isHome ? meta.away.label : meta.home.label;

  // Per-set scores: read setHistory (if the match is complete) or the
  // current set's running score (if still in progress — we still want
  // to surface mid-match data for UI consistency).
  const myScores: number[] = [];
  const oppScores: number[] = [];
  for (const s of state.setHistory) {
    if (myFromSide === 'home') {
      myScores.push(s.homeFinal);
      oppScores.push(s.awayFinal);
    } else {
      myScores.push(s.awayFinal);
      oppScores.push(s.homeFinal);
    }
  }

  const mySetsWon =
    myFromSide === 'home' ? state.setsWon.home : state.setsWon.away;
  const oppSetsWon =
    oppFromSide === 'home' ? state.setsWon.home : state.setsWon.away;
  const decided = mySetsWon !== oppSetsWon;
  const iWon = mySetsWon > oppSetsWon;

  // Pool/playoff hint from the tournament context, if set.
  const ctx = meta.tournamentContext;
  const isPool =
    ctx?.phase === 'pool' || (ctx?.poolPhase ?? '').toLowerCase().startsWith('pool');
  const roundLabel =
    ctx?.poolPhase || (ctx?.phase ? prettyPhase(ctx.phase) : '') || meta.matchLabel;

  // Tournament name preference: linked snapshot name → meta.eventName →
  // fallback "Match" so the row has *something* visible.
  const tournamentName =
    meta.linkedAesEvent?.tournamentName ||
    meta.linkedTimuTournament?.tournamentName ||
    meta.eventName ||
    'Scored match';

  // Stable per-match key.
  const sourceKey = `scored:${match.id}`;

  const entry: UnifiedTournamentEntry = {
    source: 'scored',
    sport: meta.sport,
    sourceKey,
    matchId: match.id,
    includeInStats: meta.includeInStats,
    matchKind: meta.matchKind,
    eventKey: meta.linkedAesEvent?.eventId,
    divisionId: meta.linkedAesEvent?.divisionId
      ? Number(meta.linkedAesEvent.divisionId) || undefined
      : undefined,
    tid: meta.linkedTimuTournament?.tid
      ? Number(meta.linkedTimuTournament.tid) || undefined
      : undefined,
    tournamentName,
    subtitle: meta.division || ctx?.poolPhase,
    dateText: undefined,
    dateMs: meta.dateMs,
    venueName: meta.venue?.hallName || meta.venue?.city,
    myTeamAsSeen: isHome ? meta.home.label : meta.away.label,
    poolId: undefined,
    poolRank: null,
    finalRank: null,
    finalRankLabel: null,
    matchesFor: decided && iWon ? 1 : 0,
    matchesAgainst: decided && !iWon ? 1 : 0,
    setsFor: mySetsWon,
    setsAgainst: oppSetsWon,
    totalMatchesInSnapshot: 1,
    indexedAt: match.updatedAt,
    matches: [
      {
        dateText: '',
        time: '',
        court: meta.courtName || '',
        roundLabel,
        isPool,
        opponentName,
        mySetsWon,
        oppSetsWon,
        myScores,
        oppScores,
        iWon,
      },
    ],
  };
  return entry;
}

function prettyPhase(phase: NonNullable<Match['meta']['tournamentContext']>['phase']): string {
  switch (phase) {
    case 'pool':
      return 'Pool';
    case 'eliminatory':
      return 'Eliminatory';
    case 'qualification':
      return 'Qualification';
    case 'play-off':
      return 'Play-off';
    case 'seeding':
      return 'Seeding';
    case 'final':
      return 'Final';
    case 'main-draw':
      return 'Main Draw';
    case 'classification':
      return 'Classification';
    case 'semi-final':
      return 'Semi-final';
    case 'finals':
      return 'Finals';
    default:
      return '';
  }
}

function parseRound(label: string): { isPool: boolean; roundLabel: string } {
  if (!label) return { isPool: false, roundLabel: '' };
  const cleaned = label.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return { isPool: /^Pool\s/i.test(cleaned), roundLabel: cleaned };
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const ones = n % 10;
  if (ones === 1) return `${n}st`;
  if (ones === 2) return `${n}nd`;
  if (ones === 3) return `${n}rd`;
  return `${n}th`;
}

// ── Aggregate stats ───────────────────────────────────────────────────────

export interface UnifiedAggregateStats {
  tournamentsPlayed: number;
  totalMatchesWon: number;
  totalMatchesLost: number;
  totalSetsWon: number;
  totalSetsLost: number;
  bestPoolRank: number | null;
  bestFinish: { rank: number; label: string; tournamentName: string } | null;
}

export function aggregateUnifiedStats(
  history: UnifiedTournamentEntry[]
): UnifiedAggregateStats {
  const totalMatchesWon = history.reduce((n, t) => n + t.matchesFor, 0);
  const totalMatchesLost = history.reduce((n, t) => n + t.matchesAgainst, 0);
  const totalSetsWon = history.reduce((n, t) => n + t.setsFor, 0);
  const totalSetsLost = history.reduce((n, t) => n + t.setsAgainst, 0);

  const poolRanks = history
    .map((t) => t.poolRank)
    .filter((n): n is number => n != null);
  const bestPoolRank = poolRanks.length ? Math.min(...poolRanks) : null;

  const finishCandidates = history
    .filter((t) => t.finalRank != null)
    .sort((a, b) => (a.finalRank as number) - (b.finalRank as number));
  const bestFinish = finishCandidates[0]
    ? {
        rank: finishCandidates[0].finalRank as number,
        label: finishCandidates[0].finalRankLabel as string,
        tournamentName: finishCandidates[0].tournamentName,
      }
    : null;

  return {
    tournamentsPlayed: history.length,
    totalMatchesWon,
    totalMatchesLost,
    totalSetsWon,
    totalSetsLost,
    bestPoolRank,
    bestFinish,
  };
}
