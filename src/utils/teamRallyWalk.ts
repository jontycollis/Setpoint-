// ── Team rally walker ─────────────────────────────────────────────────────
//
// Shared primitive used by every per-rally / per-set aggregator in the
// analytics module. Walks a match's event log and emits one classified
// record per PointEvent, plus a per-set result map for set-win analytics.
//
// The walker simulates volleyball rotation per side-out so each rally is
// attributed to a serving side + (when our team is serving) a specific
// server shirt — even when the imported PointEvent doesn't carry a
// courtSnapshot (most imported rallies don't).
//
// Initial server side per set:
//   1. Honor `LineupEvent.firstServer` if present.
//   2. Otherwise, simulate both candidate starting sides against the
//      first our-side StatEvent's courtSnapshot anchor and pick the one
//      whose simulated positions + serving side match.
//   3. Fall back to `meta.coinToss.serve` alternated by setIdx.
//   4. Last resort: our team. Better than dropping rallies into ambiguous.
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

export interface RallyClassification {
  setIndex: number;
  /** Which side served this rally. */
  serving: Side;
  /** Side that won the rally. */
  scoringTeam: Side;
  /** Shirts of our players who were on the floor for this rally. Libero
   *  swapped in when applicable. */
  ourOnCourt: number[];
  /** When our team served, the shirt # of the actual server. Null when
   *  the opponent was serving. */
  ourServerShirt: number | null;
  /** True when the point was scored as an ace by our team. */
  aceForOurTeam: boolean;
  /** Optional point reason — preserved so consumers can do reason-keyed
   *  analytics (kill rate, error rate, etc.) downstream. */
  reason: PointEvent['reason'] | undefined;
}

export interface SetResult {
  setIndex: number;
  /** 'win' | 'loss' from our team's POV; null when no SetEndEvent. */
  outcome: 'win' | 'loss' | null;
  homeFinal: number;
  awayFinal: number;
}

export interface TeamRallyWalk {
  /** One entry per PointEvent the walker could classify. */
  rallies: RallyClassification[];
  /** Rallies the walker couldn't classify because lineup data was
   *  missing for the entire set. */
  ambiguousRallies: number;
  /** Per-set outcome (win/loss/null) keyed by setIndex. */
  setResults: SetResult[];
  /** True when at least one rally was classified for this match. */
  contributedAny: boolean;
}

// ── Public entry point ────────────────────────────────────────────────────

export function walkTeamRallies(match: Match, ourSide: Side): TeamRallyWalk {
  const setIndices = uniqueSetIndices(match.events);
  const rallies: RallyClassification[] = [];
  const setResults: SetResult[] = [];
  let ambiguous = 0;
  let contributedAny = false;

  for (const setIdx of setIndices) {
    const setEvents = match.events.filter((e) => e.setIndex === setIdx);
    const setEnd = setEvents.find((e): e is MatchEvent & { type: 'set-end'; homeFinal: number; awayFinal: number } =>
      e.type === 'set-end'
    ) as { homeFinal: number; awayFinal: number } | undefined;
    let outcome: SetResult['outcome'] = null;
    if (setEnd) {
      const ourFinal = ourSide === 'home' ? setEnd.homeFinal : setEnd.awayFinal;
      const oppFinal = ourSide === 'home' ? setEnd.awayFinal : setEnd.homeFinal;
      outcome = ourFinal > oppFinal ? 'win' : ourFinal < oppFinal ? 'loss' : null;
    }
    setResults.push({
      setIndex: setIdx,
      outcome,
      homeFinal: setEnd?.homeFinal ?? 0,
      awayFinal: setEnd?.awayFinal ?? 0,
    });

    const walked = walkSet(match, setIdx, setEvents, ourSide);
    if (walked.classified.length === 0) {
      ambiguous += walked.ambiguous;
      continue;
    }
    rallies.push(...walked.classified);
    contributedAny = true;
  }

  return { rallies, ambiguousRallies: ambiguous, setResults, contributedAny };
}

// ── Internals ─────────────────────────────────────────────────────────────

function uniqueSetIndices(events: MatchEvent[]): number[] {
  const seen = new Set<number>();
  for (const e of events) seen.add(e.setIndex);
  return Array.from(seen).sort((a, b) => a - b);
}

interface WalkSetResult {
  classified: RallyClassification[];
  ambiguous: number;
}

function walkSet(
  match: Match,
  setIdx: number,
  setEvents: MatchEvent[],
  ourSide: Side
): WalkSetResult {
  const ourLineup = setEvents.find(
    (e): e is LineupEvent => e.type === 'lineup' && (e as LineupEvent).team === ourSide
  );
  if (!ourLineup) return { classified: [], ambiguous: countPoints(setEvents) };

  const startingServer = pickStartingServer(match, setIdx, setEvents, ourSide, ourLineup);
  if (!startingServer) return { classified: [], ambiguous: countPoints(setEvents) };

  let positions: Lineup = [...ourLineup.positions] as Lineup;
  let serving: Side = startingServer;
  let liberoSwap: { libero: number; replaces: number } | null = null;
  const classified: RallyClassification[] = [];

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
      setIndex: setIdx,
      serving,
      scoringTeam: pe.scoringTeam,
      ourOnCourt,
      ourServerShirt,
      aceForOurTeam,
      reason: pe.reason ?? undefined,
    });

    // Post-rally rotation update.
    if (pe.scoringTeam !== serving) {
      serving = pe.scoringTeam;
      if (serving === ourSide) positions = rotateClockwise(positions);
    }
  }

  return { classified, ambiguous: 0 };
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
  return [
    positions[1],
    positions[2],
    positions[3],
    positions[4],
    positions[5],
    positions[0],
  ];
}

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
      const positionsMatch = result.positions.every((v, i) => v === expectedPositions[i]);
      const serverMatch = result.serving === expected.server;
      if (positionsMatch && serverMatch) return startServing;
    }
  }

  const coin = match.meta.coinToss?.serve;
  if (coin) return setIdx % 2 === 0 ? coin : oppositeSide(coin);

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
