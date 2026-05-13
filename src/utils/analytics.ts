// ── Analytics aggregator ──────────────────────────────────────────────────
//
// Session γ — extends `statAggregator` with the higher-level shapes
// the analytics dashboard renders:
//   • Splits keyed by matchKind / source / tournament / phase
//   • Per-tournament rollups (one row per tournament the team played in)
//   • Per-player career stats with standout-match detection
//   • Season-at-a-glance: top contributors, most-improved, trend points
//
// Pure functions; no AsyncStorage, no React. The caller (StatsScreen,
// PlayerDetailScreen, MyHome card) is responsible for loading matches
// via `loadMatches()` + filtering by `includeInStats` before calling
// any of these helpers.
// ────────────────────────────────────────────────────────────────────────────

import type {
  Match,
  MatchCategory,
  MatchKind,
  MatchSource,
  PointEvent,
  Side,
} from '../types/match';
import { matchCategoryLabel } from './matchMetaPure';
import {
  aggregateMatchStats,
  buildMatchStatSummary,
  type PlayerStatLine,
  type TeamMatchStatSummary,
} from './statAggregator';
import { walkTeamRallies } from './teamRallyWalk';

// ── Phase classification ─────────────────────────────────────────────────

export type Phase = 'pool' | 'playoff' | 'unknown';

/**
 * Best-effort classification of a match as pool vs playoff. Reads
 * `tournamentContext.phase` first (the strict signal), then falls back
 * to a substring match on `tournamentContext.poolPhase` for matches
 * that only have the free-text label populated. Imported matches with
 * neither set return `'unknown'` — the analytics layer renders an "All"
 * tab when this happens for every match in the slice.
 */
export function getMatchPhase(match: Match): Phase {
  const ctx = match.meta.tournamentContext;
  if (!ctx) return 'unknown';
  const phase = ctx.phase;
  const poolPhase = (ctx.poolPhase ?? '').toLowerCase();
  if (phase === 'pool') return 'pool';
  if (poolPhase.startsWith('pool')) return 'pool';
  if (
    phase === 'play-off' ||
    phase === 'final' ||
    phase === 'finals' ||
    phase === 'semi-final' ||
    phase === 'classification' ||
    phase === 'eliminatory' ||
    phase === 'qualification' ||
    phase === 'main-draw' ||
    phase === 'seeding'
  ) {
    return 'playoff';
  }
  if (
    poolPhase.includes('playoff') ||
    poolPhase.includes('play-off') ||
    poolPhase.includes('bracket') ||
    poolPhase.includes('quarter') ||
    poolPhase.includes('semi') ||
    poolPhase.includes('final') ||
    poolPhase.includes('round of')
  ) {
    return 'playoff';
  }
  return 'unknown';
}

/**
 * Whether the slice has at least one match where the pool/playoff phase
 * could be determined. Used to decide whether to show the Pool/Playoff
 * sub-stripe under the AES split.
 */
export function sliceHasPhaseInfo(matches: Match[]): boolean {
  return matches.some((m) => getMatchPhase(m) !== 'unknown');
}

// ── Side resolution ──────────────────────────────────────────────────────

/**
 * Which side this team is on in the given match, or null if the match
 * doesn't reference the team (defensive — callers usually filter first).
 */
export function teamSide(match: Match, teamProfileId: string): Side | null {
  if (match.meta.home.teamProfileId === teamProfileId) return 'home';
  if (match.meta.away.teamProfileId === teamProfileId) return 'away';
  return null;
}

// ── Filtering predicates ─────────────────────────────────────────────────

export interface MatchFilter {
  matchKind?: MatchKind | 'all';
  source?: MatchSource | 'all';
  phase?: Phase | 'all';
  /** Workbook category — `'unknown'` matches the bucket of records that
   *  don't have `matchCategory` set (e.g. live-scored matches the user
   *  hasn't tagged yet). */
  matchCategory?: MatchCategory | 'all' | 'unknown';
  /** When true, drop matches where `meta.includeInStats === false`. */
  respectIncludeInStats?: boolean;
}

export function matchPassesFilter(match: Match, f: MatchFilter): boolean {
  const meta = match.meta;
  if (f.respectIncludeInStats && meta.includeInStats === false) return false;
  if (f.matchKind && f.matchKind !== 'all') {
    if ((meta.matchKind ?? 'standalone') !== f.matchKind) return false;
  }
  if (f.source && f.source !== 'all') {
    if ((meta.source ?? 'tier2-live') !== f.source) return false;
  }
  if (f.phase && f.phase !== 'all') {
    if (getMatchPhase(match) !== f.phase) return false;
  }
  if (f.matchCategory && f.matchCategory !== 'all') {
    const cat = meta.matchCategory;
    if (f.matchCategory === 'unknown') {
      if (cat) return false;
    } else if (cat !== f.matchCategory) {
      return false;
    }
  }
  return true;
}

// ── Tournament rollup ────────────────────────────────────────────────────

export interface TournamentRollup {
  /** Unique key — derived from AES eventId+divisionId / Timu tid /
   *  meta.eventName fallback. Stable across loads. */
  tournamentKey: string;
  tournamentName: string;
  /** AES / Timu when linked, otherwise the matchKind value
   *  ('standalone' / 'imported'). */
  source: 'aes' | 'timu' | 'standalone' | 'imported';
  /** Pool/Playoff phase if every contributing match shares the same
   *  classification; otherwise 'mixed'. Helps the row UI hint at what
   *  the drill-down will show. */
  phaseLabel: 'Pool' | 'Playoff' | 'Mixed' | 'Unknown';
  /** Matches the team played in this tournament. */
  matchIds: string[];
  matchesWon: number;
  matchesLost: number;
  setsWon: number;
  setsLost: number;
  /** Earliest match date in the rollup (for sort ordering). */
  dateMs: number;
}

function tournamentKeyForMatch(match: Match): {
  key: string;
  name: string;
  source: TournamentRollup['source'];
} {
  const meta = match.meta;
  if (meta.linkedAesEvent) {
    const div = meta.linkedAesEvent.divisionId
      ? `:${meta.linkedAesEvent.divisionId}`
      : '';
    return {
      key: `aes:${meta.linkedAesEvent.eventId}${div}`,
      name:
        meta.linkedAesEvent.tournamentName ||
        meta.eventName ||
        'AES tournament',
      source: 'aes',
    };
  }
  if (meta.linkedTimuTournament) {
    return {
      key: `timu:${meta.linkedTimuTournament.tid}`,
      name:
        meta.linkedTimuTournament.tournamentName ||
        meta.eventName ||
        'Timu tournament',
      source: 'timu',
    };
  }
  // Unlinked — bucket by eventName + matchKind so a string of standalone
  // matches with the same eventName roll up together (e.g. "Friday
  // scrimmages"). When eventName is blank, every match becomes its
  // own bucket — fine, the user just sees a list of one-off matches.
  const kind = meta.matchKind ?? 'standalone';
  const key = meta.eventName
    ? `${kind}:${meta.eventName.toLowerCase().trim()}`
    : `${kind}:match:${meta.dateMs}`;
  return {
    key,
    name: meta.eventName || (kind === 'imported' ? 'Imported match' : 'Standalone'),
    source: kind === 'imported' ? 'imported' : 'standalone',
  };
}

/**
 * Group a team's matches by tournament. Matches without a linked
 * tournament fall under their `eventName` (or a per-match singleton
 * when even that's blank). Returns rows sorted most-recent-first.
 */
export function aggregateTournamentRollups(
  matches: Match[],
  teamProfileId: string,
  filter: MatchFilter = { respectIncludeInStats: true }
): TournamentRollup[] {
  const buckets = new Map<string, TournamentRollup>();
  for (const match of matches) {
    if (!matchPassesFilter(match, filter)) continue;
    const side = teamSide(match, teamProfileId);
    if (!side) continue;
    const summary = buildMatchStatSummary(match, side);
    const tk = tournamentKeyForMatch(match);
    let row = buckets.get(tk.key);
    if (!row) {
      row = {
        tournamentKey: tk.key,
        tournamentName: tk.name,
        source: tk.source,
        phaseLabel: 'Unknown',
        matchIds: [],
        matchesWon: 0,
        matchesLost: 0,
        setsWon: 0,
        setsLost: 0,
        dateMs: match.meta.dateMs,
      };
      buckets.set(tk.key, row);
    }
    row.matchIds.push(match.id);
    row.setsWon += summary.setsWon;
    row.setsLost += summary.setsLost;
    if (summary.result === 'W') row.matchesWon++;
    else if (summary.result === 'L') row.matchesLost++;
    if (match.meta.dateMs < row.dateMs) row.dateMs = match.meta.dateMs;
    // Track phase consistency
    const phase = getMatchPhase(match);
    if (phase !== 'unknown') {
      const label = phase === 'pool' ? 'Pool' : 'Playoff';
      if (row.phaseLabel === 'Unknown') row.phaseLabel = label;
      else if (row.phaseLabel !== label && row.phaseLabel !== 'Mixed') {
        row.phaseLabel = 'Mixed';
      }
    }
  }
  const rows = Array.from(buckets.values());
  rows.sort((a, b) => b.dateMs - a.dateMs);
  return rows;
}

// ── Per-player career rollup ─────────────────────────────────────────────

export interface PlayerMatchEntry {
  matchId: string;
  matchLabel: string;
  opponent: string;
  dateMs: number;
  result: 'W' | 'L' | 'T' | null;
  setsWon: number;
  setsLost: number;
  matchKind: MatchKind;
  source: MatchSource;
  phase: Phase;
  /** This player's stats in this match (zero when they didn't take the
   *  floor; calling code can filter those out if it wants matches-played
   *  rather than season-roster cardinality). */
  line: PlayerStatLine;
  /** Whether this player appears at all in the match's roster (i.e.
   *  was on the team's bench / starting six at some point). When false
   *  this is a "did not play" match and should usually be hidden. */
  appeared: boolean;
}

export interface PlayerCareerStats {
  shirt: number;
  name: string;
  position?: string;
  totals: PlayerStatLine;
  /** Matches the player appeared in (sorted most-recent-first). */
  matches: PlayerMatchEntry[];
  /** Match where this player's K+B+A was highest. Null when no matches
   *  contributed any scoring action. Ties broken by recency. */
  standoutMatch: PlayerMatchEntry | null;
}

function emptyLine(shirt: number, name: string, position?: string): PlayerStatLine {
  return {
    shirt,
    name,
    position,
    attacks: 0,
    kills: 0,
    killPct: NaN,
    blocks: 0,
    aces: 0,
    assists: 0,
    digs: 0,
    passAttempts: 0,
    passQualitySum: 0,
    passAvg: NaN,
    errors: 0,
    totalPoints: 0,
  };
}

function recalcDerived(line: PlayerStatLine): void {
  line.totalPoints = line.kills + line.blocks + line.aces;
  line.killPct = line.attacks > 0 ? (line.kills - line.errors) / line.attacks : NaN;
  line.passAvg = line.passAttempts > 0 ? line.passQualitySum / line.passAttempts : NaN;
}

function findRosterEntry(
  match: Match,
  side: Side,
  shirt: number
): { name: string; position?: string } | null {
  const roster = side === 'home' ? match.rosters.home : match.rosters.away;
  const rp = roster.find((r) => r.shirt === shirt);
  return rp ? { name: rp.name, position: rp.position } : null;
}

/**
 * Build a per-player season rollup keyed by shirt #, carrying career
 * totals + every match the player appeared in + a standout-match chip.
 */
export function aggregatePlayerCareer(
  matches: Match[],
  teamProfileId: string,
  shirt: number,
  filter: MatchFilter = { respectIncludeInStats: true }
): PlayerCareerStats {
  let displayName = `#${shirt}`;
  let displayPosition: string | undefined;
  const totals = emptyLine(shirt, displayName);
  const entries: PlayerMatchEntry[] = [];

  for (const match of matches) {
    if (!matchPassesFilter(match, filter)) continue;
    const side = teamSide(match, teamProfileId);
    if (!side) continue;
    const rosterEntry = findRosterEntry(match, side, shirt);
    const players = aggregateMatchStats(match, side);
    const line = players.find((p) => p.shirt === shirt);
    if (!rosterEntry && !line) continue; // player not in this match at all

    if (rosterEntry) {
      displayName = rosterEntry.name;
      if (rosterEntry.position) displayPosition = rosterEntry.position;
    }

    const summary = buildMatchStatSummary(match, side);
    const playerLine = line ?? emptyLine(shirt, displayName, displayPosition);
    const appeared = !!rosterEntry;

    entries.push({
      matchId: match.id,
      matchLabel: match.meta.matchLabel || match.meta.eventName || 'Match',
      opponent: summary.opponent,
      dateMs: match.meta.dateMs,
      result: summary.result,
      setsWon: summary.setsWon,
      setsLost: summary.setsLost,
      matchKind: match.meta.matchKind ?? 'standalone',
      source: match.meta.source ?? 'tier2-live',
      phase: getMatchPhase(match),
      line: playerLine,
      appeared,
    });

    totals.kills += playerLine.kills;
    totals.attacks += playerLine.attacks;
    totals.blocks += playerLine.blocks;
    totals.aces += playerLine.aces;
    totals.assists += playerLine.assists;
    totals.digs += playerLine.digs;
    totals.passAttempts += playerLine.passAttempts;
    totals.passQualitySum += playerLine.passQualitySum;
    totals.errors += playerLine.errors;
  }

  totals.name = displayName;
  totals.position = displayPosition;
  recalcDerived(totals);

  entries.sort((a, b) => b.dateMs - a.dateMs);

  let standout: PlayerMatchEntry | null = null;
  let bestScore = -1;
  for (const entry of entries) {
    if (!entry.appeared) continue;
    const score = entry.line.kills + entry.line.blocks + entry.line.aces;
    if (score <= 0) continue;
    if (score > bestScore) {
      bestScore = score;
      standout = entry;
    }
    // Ties broken by recency — entries are already most-recent-first,
    // so the first entry with the max wins.
  }

  return {
    shirt,
    name: displayName,
    position: displayPosition,
    totals,
    matches: entries,
    standoutMatch: standout,
  };
}

// ── Season-at-a-glance ───────────────────────────────────────────────────

export interface SeasonRecord {
  matchesWon: number;
  matchesLost: number;
  setsWon: number;
  setsLost: number;
  matchCount: number;
}

export interface TopContributor {
  shirt: number;
  name: string;
  totalPoints: number;
}

export interface MostImproved {
  shirt: number;
  name: string;
  /** First-half average totalPoints per match. */
  baseline: number;
  /** Second-half average totalPoints per match. */
  recent: number;
  delta: number;
  /** Number of matches each window covers (recent / baseline). */
  baselineCount: number;
  recentCount: number;
}

export interface SeasonGlanceTrendPoint {
  matchId: string;
  dateMs: number;
  /** Rally win % for this match (rallies the team won / total rallies),
   *  computed as `pointsFor / (pointsFor + pointsAgainst)`. NaN when
   *  the match has no point events recorded. */
  rallyWinPct: number;
  /** Optional tournament name when this match has a linked tournament —
   *  the chart shades a vertical hash mark for the first match in each
   *  tournament window. */
  tournamentName?: string;
}

export interface SeasonGlance {
  record: SeasonRecord;
  topContributors: TopContributor[];
  mostImproved: MostImproved | null;
  /** When mostImproved is null, this explains why ('not enough matches'
   *  or 'no scoring activity'). */
  mostImprovedReason?: string;
  trendPoints: SeasonGlanceTrendPoint[];
  /** Counts by source so the UI can render "12 live · 64 imported". */
  sourceBreakdown: { tier2Live: number; sidelineImport: number; manual: number };
}

function rallyWinPct(match: Match, side: Side): number {
  let pf = 0;
  let pa = 0;
  for (const e of match.events) {
    if (e.type !== 'point') continue;
    const pe = e as PointEvent;
    if (pe.scoringTeam === side) pf++;
    else pa++;
  }
  if (pf + pa === 0) return NaN;
  return pf / (pf + pa);
}

/**
 * Build the "season-at-a-glance" payload for a team: record, top 3
 * scorers, most-improved player (if there's enough data), and per-match
 * trend points the dashboard's mini-chart can render.
 */
export function buildSeasonGlance(
  matches: Match[],
  teamProfileId: string,
  filter: MatchFilter = { respectIncludeInStats: true }
): SeasonGlance {
  const record: SeasonRecord = {
    matchesWon: 0,
    matchesLost: 0,
    setsWon: 0,
    setsLost: 0,
    matchCount: 0,
  };
  const totalsByShirt = new Map<number, PlayerStatLine>();
  const perPlayerPerMatch = new Map<number, number[]>(); // shirt → totalPoints per chronological match
  const trend: SeasonGlanceTrendPoint[] = [];
  const sourceBreakdown = { tier2Live: 0, sidelineImport: 0, manual: 0 };
  const seenTournaments = new Set<string>();

  // Sort by date asc so per-match windows below are chronological.
  const ordered = matches.slice().sort((a, b) => a.meta.dateMs - b.meta.dateMs);

  for (const match of ordered) {
    if (!matchPassesFilter(match, filter)) continue;
    const side = teamSide(match, teamProfileId);
    if (!side) continue;
    const summary = buildMatchStatSummary(match, side);

    record.matchCount++;
    record.setsWon += summary.setsWon;
    record.setsLost += summary.setsLost;
    if (summary.result === 'W') record.matchesWon++;
    else if (summary.result === 'L') record.matchesLost++;

    const src = match.meta.source ?? 'tier2-live';
    if (src === 'tier2-live') sourceBreakdown.tier2Live++;
    else if (src === 'sideline-hd-import') sourceBreakdown.sidelineImport++;
    else sourceBreakdown.manual++;

    for (const player of summary.players) {
      let totals = totalsByShirt.get(player.shirt);
      if (!totals) {
        totals = emptyLine(player.shirt, player.name, player.position);
        totalsByShirt.set(player.shirt, totals);
      }
      totals.kills += player.kills;
      totals.attacks += player.attacks;
      totals.blocks += player.blocks;
      totals.aces += player.aces;
      totals.assists += player.assists;
      totals.digs += player.digs;
      totals.passAttempts += player.passAttempts;
      totals.passQualitySum += player.passQualitySum;
      totals.errors += player.errors;
      totals.name = player.name;
      if (player.position) totals.position = player.position;

      let series = perPlayerPerMatch.get(player.shirt);
      if (!series) {
        series = [];
        perPlayerPerMatch.set(player.shirt, series);
      }
      series.push(player.kills + player.blocks + player.aces);
    }

    const tn =
      match.meta.linkedAesEvent?.tournamentName ||
      match.meta.linkedTimuTournament?.tournamentName ||
      match.meta.eventName ||
      undefined;
    const isFirstInTournament = tn && !seenTournaments.has(tn);
    if (tn && isFirstInTournament) seenTournaments.add(tn);
    trend.push({
      matchId: match.id,
      dateMs: match.meta.dateMs,
      rallyWinPct: rallyWinPct(match, side),
      tournamentName: isFirstInTournament ? tn : undefined,
    });
  }

  // Top 3 contributors
  const lines = Array.from(totalsByShirt.values());
  for (const l of lines) recalcDerived(l);
  const topContributors: TopContributor[] = lines
    .filter((l) => l.totalPoints > 0)
    .sort((a, b) => b.totalPoints - a.totalPoints || a.shirt - b.shirt)
    .slice(0, 3)
    .map((l) => ({ shirt: l.shirt, name: l.name, totalPoints: l.totalPoints }));

  // Most-improved: per-player split into baseline (first half) vs recent
  // (second half) windows. Need ≥4 matches for either half to mean anything.
  let mostImproved: MostImproved | null = null;
  let mostImprovedReason: string | undefined;
  if (record.matchCount < 4) {
    mostImprovedReason = 'Need at least 4 matches';
  } else {
    let bestDelta = -Infinity;
    for (const [shirt, series] of perPlayerPerMatch.entries()) {
      if (series.length < 4) continue;
      const half = Math.floor(series.length / 2);
      const baseline =
        series.slice(0, half).reduce((a, b) => a + b, 0) / half;
      const recentCount = series.length - half;
      const recent =
        series.slice(half).reduce((a, b) => a + b, 0) / recentCount;
      const delta = recent - baseline;
      if (delta > bestDelta) {
        bestDelta = delta;
        const totals = totalsByShirt.get(shirt);
        if (totals) {
          mostImproved = {
            shirt,
            name: totals.name,
            baseline,
            recent,
            delta,
            baselineCount: half,
            recentCount,
          };
        }
      }
    }
    if (!mostImproved || bestDelta <= 0) {
      mostImproved = null;
      mostImprovedReason = 'No upward trend yet';
    }
  }

  return {
    record,
    topContributors,
    mostImproved,
    mostImprovedReason,
    trendPoints: trend,
    sourceBreakdown,
  };
}

// ── Season totals split by dimension ─────────────────────────────────────

export type SplitDimension = 'matchKind' | 'source' | 'phase' | 'matchCategory';

/**
 * Returns split labels present in the slice (e.g. {'aes', 'standalone'}
 * for matchKind). Useful so the UI doesn't render empty buckets.
 */
export function presentSplitKeys(
  matches: Match[],
  teamProfileId: string,
  dim: SplitDimension,
  filter: MatchFilter = { respectIncludeInStats: true }
): Set<string> {
  const out = new Set<string>();
  for (const match of matches) {
    if (!matchPassesFilter(match, filter)) continue;
    if (!teamSide(match, teamProfileId)) continue;
    out.add(splitKeyOf(match, dim));
  }
  return out;
}

export function splitKeyOf(match: Match, dim: SplitDimension): string {
  const meta = match.meta;
  if (dim === 'matchKind') return meta.matchKind ?? 'standalone';
  if (dim === 'source') return meta.source ?? 'tier2-live';
  if (dim === 'matchCategory') return meta.matchCategory ?? 'unknown';
  return getMatchPhase(match);
}

/**
 * Display label for a split key on a given axis. Wraps the category
 * labeller for the workbook axis; falls back to the raw key for the
 * other axes (the UI already renders those as short tokens like "AES").
 */
export function splitKeyLabel(dim: SplitDimension, key: string): string {
  if (dim === 'matchCategory') {
    if (key === 'unknown') return 'Untagged';
    return matchCategoryLabel(key as MatchCategory);
  }
  if (dim === 'matchKind') {
    if (key === 'aes') return 'AES';
    if (key === 'timu') return 'Timu';
    if (key === 'standalone') return 'Standalone';
    if (key === 'imported') return 'Imported';
  }
  if (dim === 'phase') {
    if (key === 'pool') return 'Pool';
    if (key === 'playoff') return 'Playoff';
    if (key === 'unknown') return 'Phase: untagged';
  }
  if (dim === 'source') {
    if (key === 'tier2-live') return 'Live-scored';
    if (key === 'sideline-hd-import') return 'Imported (Sideline)';
    if (key === 'manual-entry') return 'Manual entry';
  }
  return key;
}

/**
 * Bucket a slice of matches by a chosen split axis. The single home for
 * "give me one bucket per X". The map's keys are stable (`splitKeyOf`)
 * so adding another axis is one place — extend `SplitDimension` plus
 * `splitKeyOf` and every consumer picks it up.
 */
export function splitMatches(
  matches: Match[],
  axis: SplitDimension
): Map<string, Match[]> {
  const out = new Map<string, Match[]>();
  for (const match of matches) {
    const key = splitKeyOf(match, axis);
    const bucket = out.get(key);
    if (bucket) bucket.push(match);
    else out.set(key, [match]);
  }
  return out;
}

// ── On-court % per match (workbook "On-Court %" column) ──────────────────

export interface PerMatchOnCourt {
  matchId: string;
  matchLabel: string;
  opponent: string;
  dateMs: number;
  /** Total rallies the walker could classify in this match. */
  rallies: number;
  /** Rallies this player was on the floor for. */
  ralliesOnCourt: number;
  /** Of those rallies, how many our team won. */
  ralliesOnCourtWon: number;
  /** ralliesOnCourt / rallies. NaN when rallies=0. */
  onCourtPct: number;
}

/**
 * Per-player, per-match on-court fraction. Mirrors the workbook's
 * "On-Court %" column at the row-per-match grain. Aggregating to season
 * level is just `sum(ralliesOnCourt) / sum(rallies)` — which is exactly
 * what `aggregateOnCourtStats` already returns as `shareOfRallies`.
 *
 * Returned newest-first for direct rendering in PlayerDetailScreen.
 */
export function computeOnCourtPercent(
  matches: Match[],
  teamProfileId: string,
  shirt: number,
  filter: MatchFilter = { respectIncludeInStats: true }
): PerMatchOnCourt[] {
  const out: PerMatchOnCourt[] = [];
  for (const match of matches) {
    if (!matchPassesFilter(match, filter)) continue;
    const side = teamSide(match, teamProfileId);
    if (!side) continue;
    const walk = walkTeamRallies(match, side);
    if (!walk.contributedAny) continue;
    let onCourt = 0;
    let onCourtWon = 0;
    for (const rally of walk.rallies) {
      if (rally.ourOnCourt.includes(shirt)) {
        onCourt++;
        if (rally.scoringTeam === side) onCourtWon++;
      }
    }
    if (onCourt === 0) continue; // skip matches where the player never took the floor
    const summary = buildMatchStatSummary(match, side);
    out.push({
      matchId: match.id,
      matchLabel: match.meta.matchLabel || match.meta.eventName || 'Match',
      opponent: summary.opponent,
      dateMs: match.meta.dateMs,
      rallies: walk.rallies.length,
      ralliesOnCourt: onCourt,
      ralliesOnCourtWon: onCourtWon,
      onCourtPct: walk.rallies.length > 0 ? onCourt / walk.rallies.length : NaN,
    });
  }
  out.sort((a, b) => b.dateMs - a.dateMs);
  return out;
}

// ── Convenience re-exports for the workbook-parity metric names ─────────
//
// The four helpers below name the workbook metrics directly so callers
// can read the dashboard wiring left-to-right without chasing through
// `onCourtStats` / `serverSplits` / `lineupCombos`. Internally they
// just delegate to those modules. New work should consume these names.

import { aggregateOnCourtStats, type OnCourtPlayerLine, type OnCourtSummary } from './onCourtStats';
import { aggregateLineupCombos, type LineupComboLine, type LineupCombosSummary } from './lineupCombos';
import { aggregateServerSplits, type ServerSplitLine, type ServerSplitSummary } from './serverSplits';

/**
 * Workbook tab #2: "Set Win % by Athlete" — per-player set-win rate
 * computed against every set the player took the floor for any rally
 * of. Delegates to `aggregateOnCourtStats` which already produces the
 * right shape; this name re-anchors the call site to the workbook.
 */
export function computeSetWinPercentByAthlete(
  matches: Match[],
  teamProfileId: string,
  filter: MatchFilter = { respectIncludeInStats: true }
): OnCourtPlayerLine[] {
  return aggregateOnCourtStats(matches, teamProfileId, filter).players;
}

/**
 * Workbook tab #3: "Lineup Combinations" — 6-player on-court groupings
 * with rally win %, set win %, rally count, set count. Threshold and
 * topN configurable; caller picks the workbook defaults.
 */
export function findLineupCombinations(
  matches: Match[],
  teamProfileId: string,
  filter: MatchFilter = { respectIncludeInStats: true }
): LineupCombosSummary {
  return aggregateLineupCombos(matches, teamProfileId, filter);
}

/**
 * Workbook tabs "Side-out %" + "Serve-win %" — per-team and per-server.
 * `serveWin% = rallies won while serving / total serves`,
 * `sideOut% = rallies won while receiving / total receives`. Per-player
 * lines include the "this player was the actual server" view too.
 */
export function computeServeStats(
  matches: Match[],
  teamProfileId: string,
  filter: MatchFilter = { respectIncludeInStats: true }
): ServerSplitSummary {
  return aggregateServerSplits(matches, teamProfileId, filter);
}

// Re-export the row types so consumers don't need to learn the
// underlying module names.
export type {
  OnCourtPlayerLine,
  OnCourtSummary,
  LineupComboLine,
  LineupCombosSummary,
  ServerSplitLine,
  ServerSplitSummary,
};

// ── Player-table query with positionFilter (plumbing) ────────────────────

/**
 * Reserved query parameter for league-wide views. Not yet wired into the
 * UI as a user-facing control — the StatsScreen ships with a disabled
 * "Filter by position" dropdown so a future iteration can flip it on
 * without touching the analytics layer. Accepts a position code; passes
 * through the existing season summary by filtering players whose roster
 * entry (or per-match override) matches.
 */
export interface PlayerTableQuery {
  matches: Match[];
  teamProfileId: string;
  /** When set, only return player rows whose default position matches.
   *  `null` = no filter. */
  positionFilter?: 'S' | 'OH' | 'MB' | 'OPP' | 'L' | 'DS' | null;
  filter?: MatchFilter;
}

/**
 * Filter `PlayerStatLine[]` by position. Pure helper — the UI passes
 * the season-summary's `players` array plus the chosen position; we
 * read each player's `position` (from the roster, captured at aggregate
 * time) and keep only matches. Players whose `position` is undefined
 * are filtered out when a positionFilter is active so we don't claim
 * coverage we don't have.
 */
export function filterPlayersByPosition(
  players: PlayerStatLine[],
  position: PlayerTableQuery['positionFilter']
): PlayerStatLine[] {
  if (!position) return players;
  return players.filter((p) => p.position === position);
}
