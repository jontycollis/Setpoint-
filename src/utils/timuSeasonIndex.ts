// ── Timu Season Index ──────────────────────────────────────────────────────
//
// Timu has no public tournament index, so to do cross-tournament scouting
// we build our own. Every tournament the user opens (or explicitly adds)
// gets snapshotted to AsyncStorage. The snapshot is lean but rich enough
// to power:
//   • Team season history — "which tournaments was this team in, how did
//     they finish, what was their pool record"
//   • Head-to-head — direct matchups between any two teams across every
//     indexed tournament
//   • Aggregate stats — tournaments played, set-win %, average pool rank
//   • Common opponents — teams both you and your target have faced
//
// Snapshots are keyed by tid. Queries are computed on demand from the
// cached snapshots so there's no derived-state sync to maintain.
// ────────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getPools,
  getPlayoffs,
  getResults,
} from '../api/timuClient';
import type {
  TimuMatchResult,
  TimuPoolTeam,
  TimuTournamentInfo,
} from '../types/timu';

const STORAGE_KEY = 'timu.seasonIndex.v1';

/** Lean per-tournament snapshot we persist to AsyncStorage. */
export interface TimuTournamentSnapshot {
  tid: number;
  name: string;
  subtitle?: string;
  dateText?: string;
  /** Parsed start date (Unix ms) for sorting. Best-effort — may be undefined. */
  dateMs?: number;
  venueName?: string;
  /** Flattened team roster with pool stats. */
  teams: Array<TimuTeamSnapshot>;
  /** Match results with per-set scores, including playoffs. */
  results: TimuMatchResult[];
  /** Final rankings if posted (rank → team name). */
  finalRankings: Array<{ rank: number; rankLabel: string; teamName: string }>;
  /** When we last successfully indexed this tournament (ms). */
  indexedAt: number;
}

export interface TimuTeamSnapshot {
  teamName: string;
  poolId: string;
  rank: number | null;
  /** Sets for / against in pool play. */
  setsFor: number;
  setsAgainst: number;
  /** Matches won / lost in pool play. */
  matchesFor: number;
  matchesAgainst: number;
}

export type SeasonIndex = Record<number, TimuTournamentSnapshot>;

// ── Persistence ───────────────────────────────────────────────────────────

async function readIndex(): Promise<SeasonIndex> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as SeasonIndex;
    }
    return {};
  } catch {
    return {};
  }
}

async function writeIndex(index: SeasonIndex): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(index));
  } catch {
    // Ignore quota / write errors silently.
  }
}

/** Return the full index. Callers should treat it as read-only. */
export async function loadSeasonIndex(): Promise<SeasonIndex> {
  const cur = await readIndex();
  // One-time self-heal: early versions of the parser sometimes captured
  // JavaScript text into the tournament name / subtitle / notes fields
  // (before we started stripping <script>/href-attribute noise). If a
  // snapshot's name looks corrupt we drop it from the index so the next
  // time the user opens that tid we re-fetch clean data.
  let healed = false;
  const next: SeasonIndex = {};
  for (const [k, snap] of Object.entries(cur)) {
    if (!snap || looksLikeCorruptSnapshot(snap)) {
      healed = true;
      continue;
    }
    // Late-bound dateMs healing: snapshots saved before parseDateText
    // covered all date variants may have a `dateText` but no `dateMs`.
    // Try to fill it in here so season grouping picks them up.
    if (snap.dateMs == null || !isFinite(snap.dateMs)) {
      // 1. Re-parse the snapshot's main dateText (covers most cases).
      if (snap.dateText) {
        const parsed = parseDateText(snap.dateText);
        if (parsed) {
          snap.dateMs = parsed;
          healed = true;
        }
      }
      // 2. Fall back to per-match dateText fields. Older Timu pages used
      //    "Sat Dec 7 '24" formats that the snapshot's main info-block
      //    didn't capture but per-match parsers do — cover those here.
      if (snap.dateMs == null || !isFinite(snap.dateMs)) {
        for (const r of snap.results || []) {
          if (!r.dateText) continue;
          const parsed = parseDateText(r.dateText);
          if (parsed) {
            snap.dateMs = parsed;
            // Also surface a snapshot-level dateText so future heals are
            // O(1) instead of scanning all results.
            if (!snap.dateText) snap.dateText = r.dateText;
            healed = true;
            break;
          }
        }
      }
      // 3. Last-resort tid → season estimate. Each season preset has a
      //    tid range; if the tid falls inside one, use the midpoint of
      //    that season as an approximate dateMs. Better than nothing for
      //    season grouping, even if the exact day is wrong.
      if (snap.dateMs == null || !isFinite(snap.dateMs)) {
        const est = estimateDateMsFromTid(snap.tid);
        if (est) {
          snap.dateMs = est;
          healed = true;
        }
      }
    }
    next[Number(k)] = snap;
  }
  if (healed) {
    await writeIndex(next);
  }
  return next;
}

/**
 * Heuristic for old/corrupt snapshots written by buggy parser versions.
 * Used only as a self-heal on load — if it returns true, we drop the
 * entry so the next open of that tid re-indexes it cleanly.
 */
function looksLikeCorruptSnapshot(snap: TimuTournamentSnapshot): boolean {
  const suspicious = (s: string | undefined) =>
    !!s && (/[{};=]/.test(s) || s.length > 120);
  if (suspicious(snap.name)) return true;
  if (suspicious(snap.subtitle)) return true;
  // Legitimate names should have at least one letter.
  if (!snap.name || !/[A-Za-z]/.test(snap.name)) return true;
  // Notes sometimes captured JS — drop the field, don't drop the whole
  // snapshot. We keep the snapshot but zero the notes here.
  if (suspicious(snap.venueName)) return true;
  return false;
}

export async function saveSeasonIndex(index: SeasonIndex): Promise<void> {
  return writeIndex(index);
}

/** Remove a tournament from the index. */
export async function removeFromIndex(tid: number): Promise<SeasonIndex> {
  const cur = await readIndex();
  if (!(tid in cur)) return cur;
  const next = { ...cur };
  delete next[tid];
  await writeIndex(next);
  return next;
}

// ── Index building ────────────────────────────────────────────────────────

/** Diagnostic info about a snapshot build attempt — useful for surfacing
 *  to the user when something silently fails. */
export interface BuildSnapshotDiagnostics {
  poolsOk: boolean;
  poolsError?: string;
  resultsOk: boolean;
  resultsError?: string;
  resultsCount: number;
  playoffsOk: boolean;
  playoffsError?: string;
  finalRankingsCount: number;
}

/** Last build's diagnostics — for callers that want to inspect the most
 *  recent failure mode without changing the public return type. */
let lastBuildDiagnostics: Record<number, BuildSnapshotDiagnostics> = {};
export function getBuildDiagnostics(tid: number): BuildSnapshotDiagnostics | undefined {
  return lastBuildDiagnostics[tid];
}
export function getAllBuildDiagnostics(): Record<number, BuildSnapshotDiagnostics> {
  return { ...lastBuildDiagnostics };
}
export function clearBuildDiagnostics(): void {
  lastBuildDiagnostics = {};
}

/**
 * Fetch pools + results + playoffs for a tid in parallel and assemble a
 * snapshot. Network errors on playoffs or results are non-fatal — we'll
 * store whatever succeeds and let the next refresh fill in the rest.
 */
export async function buildSnapshot(tid: number): Promise<TimuTournamentSnapshot | null> {
  const [poolsRes, resultsRes, playoffsRes] = await Promise.allSettled([
    getPools(tid),
    getResults(tid),
    getPlayoffs(tid),
  ]);

  // Capture per-source outcome for diagnostic surfacing.
  const errMsg = (r: PromiseSettledResult<unknown>): string | undefined =>
    r.status === 'rejected'
      ? (r.reason instanceof Error ? r.reason.message : String(r.reason))
      : undefined;

  const diagnostics: BuildSnapshotDiagnostics = {
    poolsOk: poolsRes.status === 'fulfilled',
    poolsError: errMsg(poolsRes),
    resultsOk: resultsRes.status === 'fulfilled',
    resultsError: errMsg(resultsRes),
    resultsCount:
      resultsRes.status === 'fulfilled' ? resultsRes.value.matches.length : 0,
    playoffsOk: playoffsRes.status === 'fulfilled',
    playoffsError: errMsg(playoffsRes),
    finalRankingsCount:
      playoffsRes.status === 'fulfilled'
        ? playoffsRes.value.finalRankings.length
        : 0,
  };
  lastBuildDiagnostics[tid] = diagnostics;

  if (poolsRes.status !== 'fulfilled') return null;

  const poolsPage = poolsRes.value;
  const results = resultsRes.status === 'fulfilled' ? resultsRes.value.matches : [];
  const rankings =
    playoffsRes.status === 'fulfilled' ? playoffsRes.value.finalRankings : [];

  const teams: TimuTeamSnapshot[] = [];
  for (const pool of poolsPage.pools) {
    for (const t of pool.teams) {
      teams.push({
        teamName: t.teamName,
        poolId: pool.poolId,
        rank: t.rank,
        setsFor: t.setsFor,
        setsAgainst: t.setsAgainst,
        matchesFor: t.matchesFor,
        matchesAgainst: t.matchesAgainst,
      });
    }
  }

  return {
    tid,
    name: poolsPage.info.name || `Tournament ${tid}`,
    subtitle: poolsPage.info.subtitle,
    dateText: poolsPage.info.dateText,
    dateMs: parseDateText(poolsPage.info.dateText),
    venueName: poolsPage.info.venueName,
    teams,
    results,
    finalRankings: rankings.map((r) => ({
      rank: r.rank,
      rankLabel: r.rankLabel,
      teamName: r.teamName,
    })),
    indexedAt: Date.now(),
  };
}

/**
 * Index a tid and merge the result into stored index. If the tid is
 * already indexed, the existing snapshot is updated. Returns the updated
 * index map.
 */
export async function indexTournament(tid: number): Promise<SeasonIndex> {
  const snapshot = await buildSnapshot(tid);
  if (!snapshot) return readIndex();
  const cur = await readIndex();
  const next = { ...cur, [tid]: snapshot };
  await writeIndex(next);
  return next;
}

/**
 * Re-index a tid only if it hasn't been indexed in the last `staleMs`
 * window. Default: don't refresh if indexed in the last 2 minutes (avoids
 * hammering Timu when the user tab-switches quickly).
 */
export async function ensureIndexed(
  tid: number,
  staleMs: number = 2 * 60 * 1000
): Promise<SeasonIndex> {
  const cur = await readIndex();
  const existing = cur[tid];
  if (existing && Date.now() - existing.indexedAt < staleMs) return cur;
  return indexTournament(tid);
}

/**
 * Refresh every snapshot already in the index — useful when tournaments
 * have completed playoffs since they were first cached. Runs through
 * `bulkIndex` so it's throttled to 3 concurrent requests.
 */
export async function refreshAll(
  onProgress?: (done: number, total: number, tid: number, ok: boolean) => void,
  concurrency: number = 3
): Promise<SeasonIndex> {
  const cur = await readIndex();
  const tids = Object.keys(cur).map((k) => Number(k)).filter(Number.isFinite);
  if (tids.length === 0) return cur;
  return bulkIndex(tids, onProgress, concurrency);
}

/**
 * Heuristic: a snapshot is likely "stale" and should be re-fetched when:
 *
 *   • It hasn't been refreshed in the last hour (rate-limit refreshes).
 *   • Tournament hasn't started yet ⇒ skip (don't refresh the future).
 *   • EITHER any of the following:
 *       – results array is empty
 *       – results have no matches with a populated matchLabel (parser
 *         older than the apostrophe-year fix produced label-less matches)
 *       – results have matches but none are non-Pool playoff (we expect
 *         playoffs once the event has ended)
 *       – snap.dateMs is missing/invalid (parser couldn't compute it)
 *       – snap.name is empty (parser failed to extract the tournament
 *         name) — distinct from "looksLikeCorruptSnapshot" which drops
 *         the entry entirely
 */
export function looksStale(
  snap: TimuTournamentSnapshot,
  now: number = Date.now()
): boolean {
  // Avoid refreshing too often.
  if (now - snap.indexedAt < 60 * 60 * 1000) return false;
  // If the tournament hasn't started yet, no need to refresh.
  if (snap.dateMs && snap.dateMs > now + 24 * 60 * 60 * 1000) return false;
  // Clearly missing core metadata → refresh.
  if (!snap.name || snap.name.trim().length === 0) return true;
  if (snap.dateMs == null || !isFinite(snap.dateMs)) return true;
  if (!snap.results || snap.results.length === 0) return true;
  // No matchLabels at all → produced by the older format-blind parser.
  const anyLabel = snap.results.some((r) => r.matchLabel && r.matchLabel.length > 0);
  if (!anyLabel) return true;
  // No playoff label seen → likely indexed mid-tournament.
  const hasPlayoff = snap.results.some(
    (r) => r.matchLabel && !/^Pool\s/i.test(r.matchLabel)
  );
  return !hasPlayoff;
}

/**
 * Find every snapshot in the supplied index that looks stale. Caller is
 * expected to pass these to `bulkIndex` to refresh them.
 */
export function findStaleTids(index: SeasonIndex): number[] {
  const now = Date.now();
  const out: number[] = [];
  for (const snap of Object.values(index)) {
    if (looksStale(snap, now)) out.push(snap.tid);
  }
  return out;
}

/**
 * Bulk-index several tids. Runs them in parallel with a concurrency cap
 * so we don't blitz Timu. Returns the final index.
 */
export async function bulkIndex(
  tids: number[],
  onProgress?: (done: number, total: number, tid: number, ok: boolean) => void,
  concurrency: number = 3
): Promise<SeasonIndex> {
  let cur = await readIndex();
  let done = 0;
  const queue = tids.slice();

  async function worker() {
    while (queue.length) {
      const tid = queue.shift()!;
      try {
        const snap = await buildSnapshot(tid);
        if (snap) {
          cur = { ...cur, [tid]: snap };
          await writeIndex(cur);
          onProgress?.(++done, tids.length, tid, true);
        } else {
          onProgress?.(++done, tids.length, tid, false);
        }
      } catch {
        onProgress?.(++done, tids.length, tid, false);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tids.length) }, () => worker())
  );
  return cur;
}

// ── Queries (pure — operate on any SeasonIndex) ───────────────────────────

const norm = (s: string) => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');

/** All indexed tids, sorted by dateMs descending (newest first). */
export function sortedSnapshots(index: SeasonIndex): TimuTournamentSnapshot[] {
  return Object.values(index).sort((a, b) => {
    const da = a.dateMs ?? 0;
    const db = b.dateMs ?? 0;
    if (da !== db) return db - da;
    return b.tid - a.tid; // tiebreak by tid (larger = newer in practice)
  });
}

export interface TeamSeasonEntry {
  tid: number;
  tournamentName: string;
  subtitle?: string;
  dateText?: string;
  dateMs?: number;
  poolId: string;
  poolRank: number | null;
  matchesFor: number;
  matchesAgainst: number;
  setsFor: number;
  setsAgainst: number;
  finalRank: number | null;
  finalRankLabel: string | null;
}

/**
 * Every tournament in the index where `teamName` appears (by name match).
 * Sorted newest first.
 */
export function getTeamHistory(
  index: SeasonIndex,
  teamName: string
): TeamSeasonEntry[] {
  const needle = norm(teamName);
  const out: TeamSeasonEntry[] = [];
  for (const snap of sortedSnapshots(index)) {
    const entry = snap.teams.find((t) => norm(t.teamName) === needle);
    if (!entry) continue;
    const fin = snap.finalRankings.find((r) => norm(r.teamName) === needle);
    out.push({
      tid: snap.tid,
      tournamentName: snap.name,
      subtitle: snap.subtitle,
      dateText: snap.dateText,
      dateMs: snap.dateMs,
      poolId: entry.poolId,
      poolRank: entry.rank,
      matchesFor: entry.matchesFor,
      matchesAgainst: entry.matchesAgainst,
      setsFor: entry.setsFor,
      setsAgainst: entry.setsAgainst,
      finalRank: fin?.rank ?? null,
      finalRankLabel: fin?.rankLabel ?? null,
    });
  }
  return out;
}

export interface H2HMatch {
  tid: number;
  tournamentName: string;
  dateText?: string;
  matchLabel: string;
  meIsHome: boolean;
  myScores: number[];
  oppScores: number[];
  mySetsWon: number;
  oppSetsWon: number;
  iWon: boolean;
}

/**
 * Every direct matchup between `me` and `opp` across all indexed results.
 * Sorted by tournament date (newest first), then by match time within a
 * tournament (stable).
 */
export function getH2H(
  index: SeasonIndex,
  me: string,
  opp: string
): H2HMatch[] {
  const myN = norm(me);
  const oppN = norm(opp);
  const out: H2HMatch[] = [];
  for (const snap of sortedSnapshots(index)) {
    for (const r of snap.results) {
      const home = norm(r.home.name);
      const away = norm(r.away.name);
      const isMeOpp = (home === myN && away === oppN) || (home === oppN && away === myN);
      if (!isMeOpp) continue;
      const meIsHome = home === myN;
      const myBox = meIsHome ? r.home : r.away;
      const oppBox = meIsHome ? r.away : r.home;
      out.push({
        tid: snap.tid,
        tournamentName: snap.name,
        dateText: r.dateText || snap.dateText,
        matchLabel: r.matchLabel,
        meIsHome,
        myScores: myBox.scores,
        oppScores: oppBox.scores,
        mySetsWon: myBox.setsWon,
        oppSetsWon: oppBox.setsWon,
        iWon: myBox.setsWon > oppBox.setsWon,
      });
    }
  }
  return out;
}

export interface AggregateStats {
  tournamentsPlayed: number;
  matchesWon: number;
  matchesLost: number;
  setsWon: number;
  setsLost: number;
  setWinPercentage: number;      // 0–100
  matchWinPercentage: number;    // 0–100
  averagePoolRank: number | null;
  bestPoolRank: number | null;
  bestFinalRank: number | null;
  recentFormSetWon: number;      // last 5 matches played
  recentFormSetLost: number;
  recentFormMatchWon: number;
  recentFormMatchLost: number;
}

/**
 * Aggregate stats for a team across the whole indexed season. Pool records
 * are taken from pool standings (source of truth for W/L). Recent form is
 * the last 5 completed matches across any indexed results.
 */
export function aggregateStats(
  index: SeasonIndex,
  teamName: string
): AggregateStats {
  const needle = norm(teamName);
  const tournaments = getTeamHistory(index, teamName);

  const matchesWon = tournaments.reduce((n, t) => n + t.matchesFor, 0);
  const matchesLost = tournaments.reduce((n, t) => n + t.matchesAgainst, 0);
  const setsWon = tournaments.reduce((n, t) => n + t.setsFor, 0);
  const setsLost = tournaments.reduce((n, t) => n + t.setsAgainst, 0);

  const poolRanks = tournaments
    .map((t) => t.poolRank)
    .filter((n): n is number => n != null);
  const averagePoolRank = poolRanks.length
    ? poolRanks.reduce((a, b) => a + b, 0) / poolRanks.length
    : null;
  const bestPoolRank = poolRanks.length ? Math.min(...poolRanks) : null;
  const finalRanks = tournaments
    .map((t) => t.finalRank)
    .filter((n): n is number => n != null);
  const bestFinalRank = finalRanks.length ? Math.min(...finalRanks) : null;

  const setsTotal = setsWon + setsLost;
  const matchesTotal = matchesWon + matchesLost;

  // Recent form — last 5 results where this team played.
  const recentResults: TimuMatchResult[] = [];
  for (const snap of sortedSnapshots(index)) {
    for (const r of snap.results) {
      if (norm(r.home.name) === needle || norm(r.away.name) === needle) {
        recentResults.push(r);
        if (recentResults.length >= 5) break;
      }
    }
    if (recentResults.length >= 5) break;
  }
  let recentFormSetWon = 0,
    recentFormSetLost = 0,
    recentFormMatchWon = 0,
    recentFormMatchLost = 0;
  for (const r of recentResults) {
    const isHome = norm(r.home.name) === needle;
    const my = isHome ? r.home : r.away;
    const other = isHome ? r.away : r.home;
    recentFormSetWon += my.setsWon;
    recentFormSetLost += other.setsWon;
    if (my.setsWon > other.setsWon) recentFormMatchWon++;
    else if (other.setsWon > my.setsWon) recentFormMatchLost++;
  }

  return {
    tournamentsPlayed: tournaments.length,
    matchesWon,
    matchesLost,
    setsWon,
    setsLost,
    setWinPercentage: setsTotal ? (setsWon * 100) / setsTotal : 0,
    matchWinPercentage: matchesTotal ? (matchesWon * 100) / matchesTotal : 0,
    averagePoolRank,
    bestPoolRank,
    bestFinalRank,
    recentFormSetWon,
    recentFormSetLost,
    recentFormMatchWon,
    recentFormMatchLost,
  };
}

export interface CommonOpponent {
  teamName: string;
  /** Encounters I had with this opponent (total matches across season). */
  myMatches: number;
  myWins: number;
  /** Encounters the target had with this opponent. */
  theirMatches: number;
  theirWins: number;
}

/**
 * Teams that both `me` and `them` have played during the indexed season.
 * For each common opponent, shows win/loss counts for each side so the
 * user can compare form ("We went 2-0 vs X; they went 1-2").
 */
export function getCommonOpponents(
  index: SeasonIndex,
  me: string,
  them: string
): CommonOpponent[] {
  const myN = norm(me);
  const themN = norm(them);

  type Rec = { matches: number; wins: number };
  const myOpponents = new Map<string, Rec>();
  const theirOpponents = new Map<string, Rec>();

  for (const snap of sortedSnapshots(index)) {
    for (const r of snap.results) {
      const home = norm(r.home.name);
      const away = norm(r.away.name);
      const hBox = r.home;
      const aBox = r.away;

      if (home === myN && away !== themN) {
        const rec = myOpponents.get(aBox.name) || { matches: 0, wins: 0 };
        rec.matches++;
        if (hBox.setsWon > aBox.setsWon) rec.wins++;
        myOpponents.set(aBox.name, rec);
      } else if (away === myN && home !== themN) {
        const rec = myOpponents.get(hBox.name) || { matches: 0, wins: 0 };
        rec.matches++;
        if (aBox.setsWon > hBox.setsWon) rec.wins++;
        myOpponents.set(hBox.name, rec);
      }

      if (home === themN && away !== myN) {
        const rec = theirOpponents.get(aBox.name) || { matches: 0, wins: 0 };
        rec.matches++;
        if (hBox.setsWon > aBox.setsWon) rec.wins++;
        theirOpponents.set(aBox.name, rec);
      } else if (away === themN && home !== myN) {
        const rec = theirOpponents.get(hBox.name) || { matches: 0, wins: 0 };
        rec.matches++;
        if (aBox.setsWon > hBox.setsWon) rec.wins++;
        theirOpponents.set(hBox.name, rec);
      }
    }
  }

  const out: CommonOpponent[] = [];
  for (const [name, my] of myOpponents) {
    const theirs = theirOpponents.get(name);
    if (!theirs) continue;
    out.push({
      teamName: name,
      myMatches: my.matches,
      myWins: my.wins,
      theirMatches: theirs.matches,
      theirWins: theirs.wins,
    });
  }
  // Sort by total encounters (my + theirs), desc — most-played first.
  out.sort(
    (a, b) => b.myMatches + b.theirMatches - (a.myMatches + a.theirMatches)
  );
  return out;
}

// ── utilities ─────────────────────────────────────────────────────────────

/**
 * Best-effort parse of Timu's dateText into a Unix timestamp (ms).
 * Handles a range of variants seen on Timu pages:
 *   "March 28th, 2026"
 *   "March 28th - 29th, 2026"
 *   "March 28 – April 1, 2026"     (en-dash, cross-month range)
 *   "Mar 28, 2026"                 (abbreviated month)
 *   "January 31, 2026"
 * Returns undefined only if no plausible Month + Day + Year is found.
 */
function parseDateText(raw?: string): number | undefined {
  if (!raw) return undefined;
  // Strip ordinal suffixes: "28th" → "28"
  const cleaned = raw.replace(/(\d+)(?:st|nd|rd|th)/gi, '$1');

  // Month token (long or short, case-insensitive). May appears as just "May".
  const month = String.raw`(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)`;
  const day = String.raw`(\d{1,2})`;
  const year = String.raw`(\d{4})`;
  const dash = String.raw`[\-–—]`; // hyphen, en-dash, em-dash

  // 1) "Month D, YYYY" or "Month D - D, YYYY" (same-month range)
  const sameMonth = new RegExp(
    `${month}\\s+${day}(?:\\s*${dash}\\s*\\d{1,2})?,\\s*${year}`,
    'i'
  );
  let m = cleaned.match(sameMonth);
  if (m) {
    const ms = Date.parse(`${m[1]} ${m[2]}, ${m[3]} 12:00:00`);
    if (!isNaN(ms)) return ms;
  }

  // 2) "Month D - Month D, YYYY" (cross-month range)
  const crossMonth = new RegExp(
    `${month}\\s+${day}\\s*${dash}\\s*${month}\\s+\\d{1,2},\\s*${year}`,
    'i'
  );
  m = cleaned.match(crossMonth);
  if (m) {
    const ms = Date.parse(`${m[1]} ${m[2]}, ${m[4]} 12:00:00`);
    if (!isNaN(ms)) return ms;
  }

  // 3) Older Timu compact format: "Sat Dec 7 '24" (apostrophe two-digit
  //    year, no comma, optional weekday prefix). Per-match dateText fields
  //    on older tournaments use this shape, which lets us recover an
  //    approximate dateMs even when the snapshot's main info-block date
  //    failed to capture.
  const apostrophe = new RegExp(
    `${month}\\s+${day}\\s*'(\\d{2})`,
    'i'
  );
  m = cleaned.match(apostrophe);
  if (m) {
    const yy = Number(m[3]);
    // Two-digit year → assume 2000s if <= 50, else 1900s. (Tournaments
    // pre-1995 don't exist in Timu.)
    const fullYear = yy <= 50 ? 2000 + yy : 1900 + yy;
    const ms = Date.parse(`${m[1]} ${m[2]}, ${fullYear} 12:00:00`);
    if (!isNaN(ms)) return ms;
  }

  // 4) ISO-like fallback: "YYYY-MM-DD"
  const iso = cleaned.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const ms = Date.parse(`${iso[1]}-${iso[2]}-${iso[3]}T12:00:00`);
    if (!isNaN(ms)) return ms;
  }

  return undefined;
}

/**
 * Last-resort estimate of a tournament's date from its tid alone, by
 * locating which season's tid range contains it and using the midpoint
 * of that season (Jan 15 of the spring year). Returns undefined if no
 * preset covers the tid.
 *
 * This is used only when both the snapshot's dateText AND every per-match
 * dateText fail to parse — so the user's tournament still groups under a
 * sensible season instead of "Unknown".
 */
function estimateDateMsFromTid(tid: number | undefined): number | undefined {
  if (tid == null || !isFinite(tid)) return undefined;
  // Inline the preset table here to avoid a circular import with season.ts.
  const presets: Array<{ tidStart: number; tidEnd: number; springYear: number }> = [
    { tidStart: 3500, tidEnd: 4400, springYear: 2026 }, // 2025-26
    { tidStart: 2400, tidEnd: 3500, springYear: 2025 }, // 2024-25
    { tidStart: 1500, tidEnd: 2400, springYear: 2024 }, // 2023-24
    { tidStart: 700, tidEnd: 1500, springYear: 2023 },  // 2022-23
  ];
  for (const p of presets) {
    if (tid >= p.tidStart && tid <= p.tidEnd) {
      // Use Jan 15 of spring year as a neutral midpoint within the season.
      const ms = Date.parse(`${p.springYear}-01-15T12:00:00`);
      if (!isNaN(ms)) return ms;
    }
  }
  return undefined;
}

/** Export for debugging / tests. */
export const __private = { parseDateText };

/**
 * Capture tournament info + basic pool teams into a minimal snapshot
 * suitable for callers that only have a TimuTournamentInfo + pools page
 * already in memory. Useful when the parent screen has already fetched
 * data and we want to update the index without a second round trip.
 */
export async function snapshotFromLoaded(
  info: TimuTournamentInfo,
  teams: TimuTeamSnapshot[],
  results: TimuMatchResult[],
  finalRankings: Array<{ rank: number; rankLabel: string; teamName: string }>
): Promise<SeasonIndex> {
  const snapshot: TimuTournamentSnapshot = {
    tid: info.tid,
    name: info.name,
    subtitle: info.subtitle,
    dateText: info.dateText,
    dateMs: parseDateText(info.dateText),
    venueName: info.venueName,
    teams,
    results,
    finalRankings,
    indexedAt: Date.now(),
  };
  const cur = await readIndex();
  const next = { ...cur, [info.tid]: snapshot };
  await writeIndex(next);
  return next;
}
