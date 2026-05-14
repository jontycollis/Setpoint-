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
   */
  source: 'aes' | 'timu' | 'scored';
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
}

/** Read all sources once. Callers that need fresh data should call this. */
export async function loadAllSeasonIndices(): Promise<LoadedIndices> {
  const [timu, aes, scored] = await Promise.all([
    loadTimuIndex(),
    loadAesSeasonIndex(),
    loadNormalisedMatches(),
  ]);
  return { timu, aes, scored };
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
