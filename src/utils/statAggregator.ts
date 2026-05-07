// ── Stat Aggregation Engine ────────────────────────────────────────────────
//
// Pure functions that extract, aggregate, and summarise player statistics
// from the event-sourced match log. Works at three levels:
//   1. Per-set   — stats within a single set
//   2. Per-match — stats across all sets of a single match
//   3. Per-season — stats across multiple matches (team dashboard)
//
// The stat model is inspired by Sideline HD and standard volleyball
// stat conventions. Stat events are stored as `StatEvent` entries in
// the event log; point-scoring actions (kill, block, ace) are ALSO
// reflected in the `PointEvent.reason` + `.shirt` fields for backwards
// compat with non-stat-enriched matches.
// ────────────────────────────────────────────────────────────────────────────

import type {
  Match,
  MatchEvent,
  PointEvent,
  StatEvent,
  StatCategory,
  Side,
  RosterPlayer,
} from '../types/match';

// ── Per-player stat totals ────────────────────────────────────────────────

export interface PlayerStatLine {
  shirt: number;
  name: string;
  position?: string;
  /** Total attacks (kills + errors + zero-kills). For kill% calc. */
  attacks: number;
  kills: number;
  /** Kill efficiency: (kills - errors) / attacks. NaN when attacks = 0. */
  killPct: number;
  blocks: number;
  aces: number;
  assists: number;
  digs: number;
  /** Total serve-receive attempts. */
  passAttempts: number;
  /** Sum of pass quality grades (0-3 per pass). */
  passQualitySum: number;
  /** Average pass quality: passQualitySum / passAttempts. NaN when 0. */
  passAvg: number;
  errors: number;
  /** Total points directly contributed: kills + blocks + aces. */
  totalPoints: number;
}

function emptyStatLine(shirt: number, name: string, position?: string): PlayerStatLine {
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

function recalcDerived(line: PlayerStatLine): PlayerStatLine {
  line.totalPoints = line.kills + line.blocks + line.aces;
  line.killPct = line.attacks > 0 ? (line.kills - line.errors) / line.attacks : NaN;
  line.passAvg = line.passAttempts > 0 ? line.passQualitySum / line.passAttempts : NaN;
  return line;
}

// ── Extract stats from a single match ─────────────────────────────────────

/**
 * Build a court snapshot helper that reads the current rotation state
 * from derived match state at the time of each event. Since stat events
 * carry their own `courtSnapshot`, we mostly just read those.
 */

/**
 * Extract all stat events from a match's event log.
 */
export function extractStatEvents(match: Match): StatEvent[] {
  return match.events.filter((e): e is StatEvent => e.type === 'stat');
}

/**
 * Extract stat-enriched point events (those with reason + shirt).
 * These come from matches where the scorer used quick-tap scoring
 * with point attribution but NOT the full stat bar.
 */
export function extractAttributedPoints(match: Match): PointEvent[] {
  return match.events.filter(
    (e): e is PointEvent => e.type === 'point' && e.reason != null && e.shirt != null
  );
}

/**
 * Aggregate stats for a single team from a single match. Merges data
 * from both `StatEvent` entries and attributed `PointEvent` entries
 * (for backwards compat with matches scored before the stat bar existed).
 *
 * @param match  — the full match record
 * @param team   — which side to aggregate for ('home' | 'away')
 * @returns array of PlayerStatLine, one per player who recorded at least
 *          one stat or appeared in the roster
 */
export function aggregateMatchStats(
  match: Match,
  team: Side
): PlayerStatLine[] {
  const roster = team === 'home' ? match.rosters.home : match.rosters.away;
  const lines = new Map<number, PlayerStatLine>();

  // Seed from roster so every player appears even with zero stats
  for (const p of roster) {
    lines.set(p.shirt, emptyStatLine(p.shirt, p.name, p.position));
  }

  function getLine(shirt: number): PlayerStatLine {
    let line = lines.get(shirt);
    if (!line) {
      // Player not in roster (rare — maybe a sub from another team's roster?)
      const rp = roster.find((r) => r.shirt === shirt);
      line = emptyStatLine(shirt, rp?.name ?? `#${shirt}`, rp?.position);
      lines.set(shirt, line);
    }
    return line;
  }

  // 1) Process StatEvent entries
  for (const evt of match.events) {
    if (evt.type !== 'stat') continue;
    const se = evt as StatEvent;
    if (se.team !== team) continue;
    const line = getLine(se.shirt);
    switch (se.category) {
      case 'kill':
        line.kills++;
        line.attacks++;
        break;
      case 'block':
        line.blocks++;
        break;
      case 'ace':
        line.aces++;
        break;
      case 'assist':
        line.assists++;
        break;
      case 'dig':
        line.digs++;
        break;
      case 'pass':
        line.passAttempts++;
        if (se.quality != null) line.passQualitySum += se.quality;
        break;
      case 'error':
        line.errors++;
        line.attacks++; // attack errors count as attacks for kill% calc
        break;
    }
  }

  // 2) Backfill from attributed PointEvents (kills, aces, blocks that
  //    were recorded via quick-tap but don't have a matching StatEvent).
  //    We detect "already has a StatEvent" by checking if there's a
  //    StatEvent with the same timestamp range (within 2s) for the
  //    same player + category. This is a heuristic but safe: double-
  //    counting a kill is worse than missing one from legacy data.
  const statTimestamps = new Set(
    match.events
      .filter((e): e is StatEvent => e.type === 'stat' && e.team === team)
      .map((e) => `${e.shirt}-${e.category}-${Math.floor(e.ts / 2000)}`)
  );

  for (const evt of match.events) {
    if (evt.type !== 'point') continue;
    const pe = evt as PointEvent;
    if (pe.shirt == null || pe.reason == null) continue;

    // Determine if this point is for our team
    const pointForTeam =
      (pe.scoringTeam === team && (pe.reason === 'kill' || pe.reason === 'ace' || pe.reason === 'block'));

    if (!pointForTeam) continue;

    // Check if already counted via a StatEvent
    const cat: StatCategory = pe.reason as StatCategory;
    const key = `${pe.shirt}-${cat}-${Math.floor(pe.ts / 2000)}`;
    if (statTimestamps.has(key)) continue;

    const line = getLine(pe.shirt);
    switch (pe.reason) {
      case 'kill':
        line.kills++;
        line.attacks++;
        break;
      case 'ace':
        line.aces++;
        break;
      case 'block':
        line.blocks++;
        break;
    }

    // Backfill assists from the point's assistShirt
    if (pe.reason === 'kill' && pe.assistShirt != null) {
      const assistLine = getLine(pe.assistShirt);
      const assistKey = `${pe.assistShirt}-assist-${Math.floor(pe.ts / 2000)}`;
      if (!statTimestamps.has(assistKey)) {
        assistLine.assists++;
      }
    }
  }

  // 3) Recalc derived fields and return
  const result: PlayerStatLine[] = [];
  for (const line of lines.values()) {
    result.push(recalcDerived(line));
  }
  // Sort by total points desc, then kills, then shirt#
  result.sort((a, b) =>
    b.totalPoints - a.totalPoints ||
    b.kills - a.kills ||
    a.shirt - b.shirt
  );
  return result;
}

// ── Team-level match summary ──────────────────────────────────────────────

export interface TeamMatchStatSummary {
  matchId: string;
  matchLabel: string;
  dateMs: number;
  opponent: string;
  /** 'W' | 'L' | 'T' | null (in-progress) */
  result: 'W' | 'L' | 'T' | null;
  setsWon: number;
  setsLost: number;
  /** Team totals (sum of all players' stats) */
  totals: PlayerStatLine;
  /** Per-player breakdown */
  players: PlayerStatLine[];
}

/**
 * Build a match summary for a given team. Includes aggregated totals
 * and per-player breakdowns.
 */
export function buildMatchStatSummary(
  match: Match,
  teamSide: Side
): TeamMatchStatSummary {
  const players = aggregateMatchStats(match, teamSide);
  const totals = mergeTotals(players, 0, 'Team');

  const oppSide: Side = teamSide === 'home' ? 'away' : 'home';
  const oppLabel = teamSide === 'home' ? match.meta.away.label : match.meta.home.label;

  // Derive match result
  let result: 'W' | 'L' | 'T' | null = null;
  if (match.status === 'complete') {
    const matchEnd = match.events.find((e) => e.type === 'match-end');
    if (matchEnd && matchEnd.type === 'match-end') {
      const homeWon = matchEnd.setsHome > matchEnd.setsAway;
      const tie = matchEnd.setsHome === matchEnd.setsAway;
      if (tie) {
        result = 'T';
      } else if ((teamSide === 'home' && homeWon) || (teamSide === 'away' && !homeWon)) {
        result = 'W';
      } else {
        result = 'L';
      }
    }
  }

  const matchEnd = match.events.find((e) => e.type === 'match-end');
  const setsWon = matchEnd && matchEnd.type === 'match-end'
    ? (teamSide === 'home' ? matchEnd.setsHome : matchEnd.setsAway)
    : 0;
  const setsLost = matchEnd && matchEnd.type === 'match-end'
    ? (teamSide === 'home' ? matchEnd.setsAway : matchEnd.setsHome)
    : 0;

  return {
    matchId: match.id,
    matchLabel: match.meta.matchLabel,
    dateMs: match.meta.dateMs,
    opponent: oppLabel,
    result,
    setsWon,
    setsLost,
    totals,
    players,
  };
}

// ── Season (multi-match) aggregation ──────────────────────────────────────

export interface SeasonStatSummary {
  /** Per-player season totals (across all matches) */
  players: PlayerStatLine[];
  /** Team grand totals */
  totals: PlayerStatLine;
  /** Per-match breakdowns for drill-down */
  matches: TeamMatchStatSummary[];
  matchCount: number;
}

/**
 * Aggregate stats across an entire season's matches for one team.
 *
 * @param matches — all matches the team participated in
 * @param teamProfileId — the team profile ID to identify which side
 *                        the team is on in each match
 */
export function aggregateSeasonStats(
  matches: Match[],
  teamProfileId: string
): SeasonStatSummary {
  const matchSummaries: TeamMatchStatSummary[] = [];
  const seasonLines = new Map<number, PlayerStatLine>();

  for (const match of matches) {
    // Figure out which side the team is on
    const side: Side | null =
      match.meta.home.teamProfileId === teamProfileId
        ? 'home'
        : match.meta.away.teamProfileId === teamProfileId
        ? 'away'
        : null;
    if (!side) continue;

    const summary = buildMatchStatSummary(match, side);
    matchSummaries.push(summary);

    // Merge per-player stats into season totals
    for (const pl of summary.players) {
      let season = seasonLines.get(pl.shirt);
      if (!season) {
        season = emptyStatLine(pl.shirt, pl.name, pl.position);
        seasonLines.set(pl.shirt, season);
      }
      season.kills += pl.kills;
      season.attacks += pl.attacks;
      season.blocks += pl.blocks;
      season.aces += pl.aces;
      season.assists += pl.assists;
      season.digs += pl.digs;
      season.passAttempts += pl.passAttempts;
      season.passQualitySum += pl.passQualitySum;
      season.errors += pl.errors;
      // Keep the most recent name/position in case of roster updates
      season.name = pl.name;
      if (pl.position) season.position = pl.position;
    }
  }

  const players: PlayerStatLine[] = [];
  for (const line of seasonLines.values()) {
    players.push(recalcDerived(line));
  }
  players.sort((a, b) =>
    b.totalPoints - a.totalPoints ||
    b.kills - a.kills ||
    a.shirt - b.shirt
  );

  const totals = mergeTotals(players, 0, 'All Players');

  return {
    players,
    totals,
    matches: matchSummaries,
    matchCount: matchSummaries.length,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Merge an array of PlayerStatLines into a single team-total line.
 */
function mergeTotals(
  players: PlayerStatLine[],
  shirt: number,
  name: string
): PlayerStatLine {
  const totals = emptyStatLine(shirt, name);
  for (const p of players) {
    totals.kills += p.kills;
    totals.attacks += p.attacks;
    totals.blocks += p.blocks;
    totals.aces += p.aces;
    totals.assists += p.assists;
    totals.digs += p.digs;
    totals.passAttempts += p.passAttempts;
    totals.passQualitySum += p.passQualitySum;
    totals.errors += p.errors;
  }
  return recalcDerived(totals);
}

/**
 * Build a CourtSnapshot from the current match state. Called by the
 * scoring screen when the user tags a stat so each event carries a
 * frozen copy of who's on the floor.
 */
export function buildCourtSnapshot(
  match: Match
): import('../types/match').CourtSnapshot | null {
  // We need to derive state to get current rotations
  // This is imported lazily to avoid circular deps — the caller
  // (MatchScoringScreen) already has `state` derived, so in practice
  // the screen passes the snapshot directly.
  return null; // Placeholder — the screen builds this from its own derived state
}

/**
 * Create a CourtSnapshot from pre-derived match state. This is the
 * version the scoring screen should call since it already has `state`.
 */
export function snapshotFromState(
  state: import('../types/match').MatchState
): import('../types/match').CourtSnapshot | null {
  if (!state.currentSet) return null;
  const cs = state.currentSet;
  if (!cs.server || cs.serverShirt == null) return null;
  return {
    homePositions: [...cs.rotation.home.positions] as import('../types/match').Lineup,
    awayPositions: [...cs.rotation.away.positions] as import('../types/match').Lineup,
    homeLiberosOnFloor: cs.rotation.home.liberoOnFloor,
    awayLiberosOnFloor: cs.rotation.away.liberoOnFloor,
    server: cs.server,
    serverShirt: cs.serverShirt,
  };
}
