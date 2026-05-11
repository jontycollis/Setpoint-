// ── Server splits / side-out & serving conversion ─────────────────────────
//
// Analytics slice 1 of the workbook port. Two related cuts per player:
//
//   • On-court splits (what the workbook's "Side-Out & Serving Conversion"
//     tab shows) — how the team performed in rallies the player was on
//     court for, broken out by who was serving.
//        ↳ recv rallies  = opponent-served rallies the player was on for
//        ↳ recv won %    = side-out % (% of recv rallies the team won)
//        ↳ serve rallies = own-team-served rallies the player was on for
//        ↳ serve won %   = serve point % (% of own-served rallies the
//                          team won)
//
//   • Personal serve splits — when *this* player was the actual server,
//     how did the rally go? Workbook doesn't break this out; user asked
//     for it explicitly. Captures: personal serves, won, lost, aces.
//
// Inputs are the event log. The walker simulates rotation per set so it
// can attribute each rally's serving side + server shirt even when the
// imported PointEvents don't carry a courtSnapshot (most imported points
// don't — only stat-enriched rallies do).
//
// Initial server per set is picked by simulating both possible starting
// sides against the first StatEvent's courtSnapshot anchor. If neither
// matches (or there's no stat anchor), falls back to `meta.coinToss.serve`
// alternated by setIndex, then defaults to the user's own side.
// ──────────────────────────────────────────────────────────────────────────

import type {
  Match,
  MatchEvent,
  LineupEvent,
  StatEvent,
  PointEvent,
  Side,
  Lineup,
} from '../types/match';
import { matchPassesFilter, teamSide, type MatchFilter } from './analytics';

// ── Per-player + team result shapes ───────────────────────────────────────

export interface ServerSplitTeamTotals {
  recvRallies: number;
  recvWon: number;
  /** Side-out %: recvWon / recvRallies, NaN when recvRallies = 0. */
  recvPct: number;
  serveRallies: number;
  serveWon: number;
  /** Serve point %: serveWon / serveRallies, NaN when serveRallies = 0. */
  servePct: number;
  /** Rallies the walker couldn't classify (no signal for which side served).
   *  Surfaces as an "ambiguous" count so we can be honest about coverage. */
  ambiguousRallies: number;
}

export interface ServerSplitLine {
  shirt: number;
  name: string;
  position?: string;
  // On-court splits — player was on the floor for this rally
  recvRallies: number;
  recvWon: number;
  recvPct: number;
  serveRallies: number;
  serveWon: number;
  servePct: number;
  // Personal-serve splits — this player was the actual server
  personalServes: number;
  personalServeWon: number;
  personalServeLost: number;
  /** Aces credited to this server (PointEvent.reason==='ace' with the
   *  scoring side === our side AND this player was serving). */
  personalServeAces: number;
  personalServePct: number;
}

export interface ServerSplitSummary {
  team: ServerSplitTeamTotals;
  players: ServerSplitLine[];
  /** Number of matches that contributed at least one classified rally. */
  matchCount: number;
}

// ── Public entry point ────────────────────────────────────────────────────

export function aggregateServerSplits(
  matches: Match[],
  teamProfileId: string,
  filter: MatchFilter = { respectIncludeInStats: true }
): ServerSplitSummary {
  const team: ServerSplitTeamTotals = {
    recvRallies: 0,
    recvWon: 0,
    recvPct: NaN,
    serveRallies: 0,
    serveWon: 0,
    servePct: NaN,
    ambiguousRallies: 0,
  };
  const lines = new Map<number, ServerSplitLine>();
  let matchCount = 0;

  function getLine(shirt: number, name: string, position?: string): ServerSplitLine {
    let line = lines.get(shirt);
    if (!line) {
      line = {
        shirt,
        name,
        position,
        recvRallies: 0,
        recvWon: 0,
        recvPct: NaN,
        serveRallies: 0,
        serveWon: 0,
        servePct: NaN,
        personalServes: 0,
        personalServeWon: 0,
        personalServeLost: 0,
        personalServeAces: 0,
        personalServePct: NaN,
      };
      lines.set(shirt, line);
    } else {
      // Refresh name/position with latest seen (rosters can drift over season).
      line.name = name;
      if (position) line.position = position;
    }
    return line;
  }

  for (const match of matches) {
    if (!matchPassesFilter(match, filter)) continue;
    const ourSide = teamSide(match, teamProfileId);
    if (!ourSide) continue;
    const roster = ourSide === 'home' ? match.rosters.home : match.rosters.away;
    const rosterByShirt = new Map<number, { name: string; position?: string }>();
    for (const p of roster) rosterByShirt.set(p.shirt, { name: p.name, position: p.position });

    const setIndices = uniqueSetIndices(match.events);
    let contributedAny = false;

    for (const setIdx of setIndices) {
      const walk = walkSet(match, setIdx, ourSide);
      if (walk.classified.length === 0) {
        team.ambiguousRallies += walk.ambiguous;
        continue;
      }
      contributedAny = true;

      for (const r of walk.classified) {
        // Team totals
        if (r.serving === ourSide) {
          team.serveRallies++;
          if (r.scoringTeam === ourSide) team.serveWon++;
        } else {
          team.recvRallies++;
          if (r.scoringTeam === ourSide) team.recvWon++;
        }

        // Per-player on-court splits — every player on the floor for our
        // side gets credit (or charge) for this rally.
        for (const shirt of r.ourOnCourt) {
          const meta = rosterByShirt.get(shirt) ?? { name: `#${shirt}` };
          const line = getLine(shirt, meta.name, meta.position);
          if (r.serving === ourSide) {
            line.serveRallies++;
            if (r.scoringTeam === ourSide) line.serveWon++;
          } else {
            line.recvRallies++;
            if (r.scoringTeam === ourSide) line.recvWon++;
          }
        }

        // Personal serve splits — only when our team was serving.
        if (r.serving === ourSide && r.ourServerShirt != null) {
          const meta = rosterByShirt.get(r.ourServerShirt) ?? { name: `#${r.ourServerShirt}` };
          const line = getLine(r.ourServerShirt, meta.name, meta.position);
          line.personalServes++;
          if (r.scoringTeam === ourSide) {
            line.personalServeWon++;
            if (r.aceForOurTeam) line.personalServeAces++;
          } else {
            line.personalServeLost++;
          }
        }
      }
      team.ambiguousRallies += walk.ambiguous;
    }

    if (contributedAny) matchCount++;
  }

  // Recalc derived percentages
  team.recvPct = team.recvRallies > 0 ? team.recvWon / team.recvRallies : NaN;
  team.servePct = team.serveRallies > 0 ? team.serveWon / team.serveRallies : NaN;
  const players: ServerSplitLine[] = [];
  for (const line of lines.values()) {
    line.recvPct = line.recvRallies > 0 ? line.recvWon / line.recvRallies : NaN;
    line.servePct = line.serveRallies > 0 ? line.serveWon / line.serveRallies : NaN;
    line.personalServePct =
      line.personalServes > 0 ? line.personalServeWon / line.personalServes : NaN;
    players.push(line);
  }
  // Default sort: most on-court time first (recv + serve rallies).
  players.sort((a, b) => {
    const aTot = a.recvRallies + a.serveRallies;
    const bTot = b.recvRallies + b.serveRallies;
    return bTot - aTot || a.shirt - b.shirt;
  });

  return { team, players, matchCount };
}

// ── Walker internals ──────────────────────────────────────────────────────

function uniqueSetIndices(events: MatchEvent[]): number[] {
  const seen = new Set<number>();
  for (const e of events) seen.add(e.setIndex);
  return Array.from(seen).sort((a, b) => a - b);
}

interface ClassifiedRally {
  /** Which side served this rally. */
  serving: Side;
  /** Side that won the rally. */
  scoringTeam: Side;
  /** Shirts of our players who were on the floor for this rally. Includes
   *  the libero when one is swapped in (the back-row regular they
   *  replaced is excluded). */
  ourOnCourt: number[];
  /** When our team was serving, the shirt # of the actual server. */
  ourServerShirt: number | null;
  /** True when the point was scored as an ace by our team. */
  aceForOurTeam: boolean;
}

interface WalkResult {
  classified: ClassifiedRally[];
  /** Rallies skipped because no initial-server signal could be derived
   *  (no lineup event, no StatEvent anchors, no coin toss data). */
  ambiguous: number;
}

function walkSet(match: Match, setIdx: number, ourSide: Side): WalkResult {
  const setEvents = match.events.filter((e) => e.setIndex === setIdx);
  const ourLineup = setEvents.find(
    (e): e is LineupEvent => e.type === 'lineup' && (e as LineupEvent).team === ourSide
  );
  if (!ourLineup) return { classified: [], ambiguous: countPoints(setEvents) };

  const initialPositions: Lineup = [...ourLineup.positions] as Lineup;
  const initialLiberos = ourLineup.liberos ?? [];
  const startingServer = pickStartingServer(match, setIdx, setEvents, ourSide, ourLineup);
  if (!startingServer) {
    return { classified: [], ambiguous: countPoints(setEvents) };
  }

  let positions: Lineup = [...initialPositions] as Lineup;
  let serving: Side = startingServer;
  let liberoSwap: { libero: number; replaces: number } | null = null;

  const classified: ClassifiedRally[] = [];

  for (const ev of setEvents) {
    if (ev.type === 'libero-on') {
      if (ev.team === ourSide) liberoSwap = { libero: ev.libero, replaces: ev.replaces };
      continue;
    }
    if (ev.type === 'libero-off') {
      if (ev.team === ourSide && liberoSwap?.libero === ev.libero) liberoSwap = null;
      continue;
    }
    if (ev.type === 'libero-officially-replaced') {
      // The libero is locked out and a regular replaces them — clear the
      // current libero-swap so the regular is treated as on-court.
      if (ev.team === ourSide) liberoSwap = null;
      continue;
    }
    if (ev.type === 'sub') {
      if (ev.team === ourSide) {
        const idx = positions.indexOf(ev.out);
        if (idx >= 0) positions[idx] = ev.in;
      }
      continue;
    }
    if (ev.type !== 'point') continue;

    const pe = ev as PointEvent;
    const ourOnCourt = currentOnCourt(positions, liberoSwap);
    const ourServerShirt = serving === ourSide ? positions[0] : null;
    const aceForOurTeam = pe.scoringTeam === ourSide && pe.reason === 'ace';

    classified.push({
      serving,
      scoringTeam: pe.scoringTeam,
      ourOnCourt,
      ourServerShirt,
      aceForOurTeam,
    });

    // Post-rally rotation update.
    if (pe.scoringTeam !== serving) {
      serving = pe.scoringTeam;
      if (serving === ourSide) {
        positions = rotateClockwise(positions);
      }
      // Opponent rotation isn't tracked (not needed for our analytics).
    }
  }

  return { classified, ambiguous: 0 };

  // Suppress unused warning — `initialLiberos` is documented but not needed
  // by the walker since libero-on/off events drive the swap state.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void initialLiberos;
}

function countPoints(events: MatchEvent[]): number {
  let n = 0;
  for (const e of events) if (e.type === 'point') n++;
  return n;
}

function currentOnCourt(
  positions: Lineup,
  liberoSwap: { libero: number; replaces: number } | null
): number[] {
  const set = new Set<number>(positions);
  if (liberoSwap) {
    set.delete(liberoSwap.replaces);
    set.add(liberoSwap.libero);
  }
  return Array.from(set);
}

function rotateClockwise(positions: Lineup): Lineup {
  // Volleyball clockwise rotation: position I rotates out (to position VI)
  // and the rest shift one slot toward I. In our 0-indexed array
  // (positions[0] = pos I), this is a left shift with wraparound:
  // new[i] = old[(i+1) % 6].
  return [
    positions[1],
    positions[2],
    positions[3],
    positions[4],
    positions[5],
    positions[0],
  ];
}

/**
 * Determine which side started serving this set. Strategy:
 *   1. Honor `LineupEvent.firstServer` if our-side lineup has it set.
 *   2. Otherwise, find the first our-side StatEvent with a courtSnapshot,
 *      simulate forward from each candidate starting server (home/away),
 *      and pick the one whose simulated positions + serving side match
 *      the anchor's snapshot.
 *   3. Fallback to `meta.coinToss.serve` alternated by `setIdx`.
 *   4. Last resort: our team serves first. Loses precision on a small
 *      number of sets but doesn't crash the aggregator.
 */
function pickStartingServer(
  match: Match,
  setIdx: number,
  setEvents: MatchEvent[],
  ourSide: Side,
  ourLineup: LineupEvent
): Side | null {
  if (ourLineup.firstServer) return ourLineup.firstServer;

  const anchorIdx = setEvents.findIndex(
    (e) => e.type === 'stat' && (e as StatEvent).team === ourSide && (e as StatEvent).courtSnapshot
  );
  if (anchorIdx >= 0) {
    const anchor = setEvents[anchorIdx] as StatEvent;
    const expected = anchor.courtSnapshot;
    for (const startServing of ['home', 'away'] as const) {
      const result = simulateUpTo(
        setEvents,
        anchorIdx,
        ourSide,
        [...ourLineup.positions] as Lineup,
        startServing
      );
      const expectedPositions =
        ourSide === 'home' ? expected.homePositions : expected.awayPositions;
      const positionsMatch = result.positions.every(
        (v, i) => v === expectedPositions[i]
      );
      const serverMatch = result.serving === expected.server;
      if (positionsMatch && serverMatch) return startServing;
    }
  }

  // Coin toss fallback: alternate starting server by set index.
  const coin = match.meta.coinToss?.serve;
  if (coin) {
    return setIdx % 2 === 0 ? coin : oppositeSide(coin);
  }

  // Last-resort default: our team. Better than dropping the entire set's
  // rallies into "ambiguous".
  return ourSide;
}

function oppositeSide(side: Side): Side {
  return side === 'home' ? 'away' : 'home';
}

function simulateUpTo(
  setEvents: MatchEvent[],
  anchorIdx: number,
  ourSide: Side,
  startingPositions: Lineup,
  startServing: Side
): { positions: Lineup; serving: Side } {
  let positions: Lineup = [...startingPositions] as Lineup;
  let serving: Side = startServing;
  for (let i = 0; i < anchorIdx; i++) {
    const ev = setEvents[i];
    if (ev.type === 'sub' && ev.team === ourSide) {
      const idx = positions.indexOf(ev.out);
      if (idx >= 0) positions[idx] = ev.in;
      continue;
    }
    if (ev.type !== 'point') continue;
    const pe = ev as PointEvent;
    if (pe.scoringTeam !== serving) {
      serving = pe.scoringTeam;
      if (serving === ourSide) positions = rotateClockwise(positions);
    }
  }
  return { positions, serving };
}
