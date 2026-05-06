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

// ── Unified tournament entry (renderable by SeasonHistoryScreen) ──────────

export interface UnifiedTournamentEntry {
  source: 'aes' | 'timu';
  /** Stable tournament key — used for routing and dedup. */
  sourceKey: string;
  // AES-specific
  eventKey?: string;
  divisionId?: number;
  // Timu-specific
  tid?: number;

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
}

/** Read both indices once. Callers that need fresh data should call this. */
export async function loadAllSeasonIndices(): Promise<LoadedIndices> {
  const [timu, aes] = await Promise.all([
    loadTimuIndex(),
    loadAesSeasonIndex(),
  ]);
  return { timu, aes };
}

/**
 * Build a unified history for the user's team across both sources. Matches
 * snapshots whose "my team" identity equals any of the supplied aliases
 * (case + whitespace insensitive, age-group marker tolerant).
 */
export function buildMySeasonHistory(
  indices: LoadedIndices,
  aliases: string[]
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

  // Sort unified list newest → oldest.
  out.sort((a, b) => (b.dateMs ?? 0) - (a.dateMs ?? 0));
  return out;
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
