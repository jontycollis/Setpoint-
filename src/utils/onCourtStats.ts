// ── On-court / set-win analytics ──────────────────────────────────────────
//
// Analytics slice 2 of the workbook port. Mirrors the workbook's
// "PBP Season Rollup" + "Set Win % by Athlete" tabs:
//
//   • Per player: matches appeared in, sets appeared in (any rally),
//     on-court rallies, rallies the team won when on court, rally win %,
//     sets won, set win %.
//   • Team totals: rallies, wins, set record.
//
// Rally-win / rallies-on-court still come from the `walkTeamRallies`
// rotation walker in `teamRallyWalk.ts` — that's the only place we have
// per-rally on-court attribution. M (matches) and Sets counts use a
// broader "did this player participate at all" scan over all the event
// signals (stat shirts, courtSnapshot lineups + liberos-on-floor, lineup
// + libero events, subs) so liberos imported from Sideline HD — whose
// data lacks explicit `libero-on` events — still count toward their
// matches/sets played.
// ──────────────────────────────────────────────────────────────────────────

import type { Match, MatchEvent, StatEvent, PointEvent, Side } from '../types/match';
import { matchPassesFilter, teamSide, type MatchFilter } from './analytics';
import { walkTeamRallies } from './teamRallyWalk';

export interface OnCourtTeamTotals {
  matchCount: number;
  setsPlayed: number;
  setsWon: number;
  setWinPct: number;
  rallies: number;
  ralliesWon: number;
  rallyWinPct: number;
}

export interface OnCourtPlayerLine {
  shirt: number;
  name: string;
  position?: string;
  /**
   * Position inferred from rally / lineup data when the roster doesn't
   * carry an explicit `position` field. `'L'` if the player only ever
   * appears as a libero (in `lineup.liberos`, `homeLiberosOnFloor`, or
   * libero-on/off events, and never in the 6-position rotation). Empty
   * when no strong signal exists.
   */
  inferredPosition?: 'L';
  matchesAppeared: number;
  setsAppeared: number;
  setsWon: number;
  setWinPct: number;
  /** Rallies player was on court for (either side serving). */
  rallies: number;
  /** Of those rallies, how many our team won. */
  ralliesWon: number;
  rallyWinPct: number;
  /** Share of the slice's total rallies this player was on court for —
   *  proxy for relative court time. */
  shareOfRallies: number;
}

export interface OnCourtSummary {
  team: OnCourtTeamTotals;
  players: OnCourtPlayerLine[];
  /** Rallies that couldn't be classified by the walker (missing lineup
   *  data) — surfaced so the UI can be honest about coverage. */
  ambiguousRallies: number;
}

interface PlayerAcc {
  shirt: number;
  name: string;
  position?: string;
  matchesAppearedSet: Set<string>;
  setsAppearedKey: Set<string>;
  setsWonKey: Set<string>;
  rallies: number;
  ralliesWon: number;
  /** Times this shirt appeared in the 6-position rotation (lineup slots
   *  or stat courtSnapshot.homePositions). */
  rotationSlotAppearances: number;
  /** Times this shirt appeared as a libero (lineup.liberos,
   *  homeLiberosOnFloor on a snapshot, or libero-on/off events). */
  liberoMarkerAppearances: number;
}

interface MatchParticipation {
  /** All shirts that took part in this match in any signal — used for M. */
  byMatch: Set<number>;
  /** Per-set shirts that took part — used for Sets / Set%. */
  bySet: Map<number, Set<number>>;
  /** Shirts that appeared in any 6-position rotation slot in this match. */
  rotationShirts: Set<number>;
  /** Shirts that appeared as a libero in this match. */
  liberoShirts: Set<number>;
}

/**
 * Scan every event in a match for our-side participation signals so M /
 * Sets counts capture liberos and other players whose presence isn't
 * fully reconstructed by the rotation walker. Distinct from
 * `walkTeamRallies`, which only emits per-rally on-court sets from the
 * simulated rotation.
 */
function gatherMatchParticipation(
  match: Match,
  ourSide: Side
): MatchParticipation {
  const byMatch = new Set<number>();
  const bySet = new Map<number, Set<number>>();
  const rotationShirts = new Set<number>();
  const liberoShirts = new Set<number>();

  function markShirt(shirt: number | undefined | null, setIdx: number): void {
    if (shirt == null || shirt === 0) return;
    byMatch.add(shirt);
    let s = bySet.get(setIdx);
    if (!s) {
      s = new Set();
      bySet.set(setIdx, s);
    }
    s.add(shirt);
  }

  function markRotationSlots(shirts: readonly number[], setIdx: number): void {
    for (const shirt of shirts) {
      if (shirt == null || shirt === 0) continue;
      rotationShirts.add(shirt);
      markShirt(shirt, setIdx);
    }
  }

  function markLibero(shirt: number | undefined | null, setIdx: number): void {
    if (shirt == null || shirt === 0) return;
    liberoShirts.add(shirt);
    markShirt(shirt, setIdx);
  }

  for (const ev of match.events as MatchEvent[]) {
    const setIdx = ev.setIndex;
    if (ev.type === 'lineup' && ev.team === ourSide) {
      markRotationSlots(ev.positions, setIdx);
      if (Array.isArray(ev.liberos)) {
        for (const lib of ev.liberos) markLibero(lib, setIdx);
      }
    } else if (ev.type === 'sub' && ev.team === ourSide) {
      markShirt(ev.in, setIdx);
      markShirt(ev.out, setIdx);
    } else if (ev.type === 'libero-on' && ev.team === ourSide) {
      markLibero(ev.libero, setIdx);
      markShirt(ev.replaces, setIdx);
    } else if (ev.type === 'libero-off' && ev.team === ourSide) {
      markLibero(ev.libero, setIdx);
    } else if (ev.type === 'libero-officially-replaced' && ev.team === ourSide) {
      markLibero(ev.libero, setIdx);
    } else if (ev.type === 'stat' && (ev as StatEvent).team === ourSide) {
      const se = ev as StatEvent;
      markShirt(se.shirt, setIdx);
      const snap = se.courtSnapshot;
      if (snap) {
        const positions = ourSide === 'home' ? snap.homePositions : snap.awayPositions;
        const lib = ourSide === 'home' ? snap.homeLiberosOnFloor : snap.awayLiberosOnFloor;
        if (Array.isArray(positions)) markRotationSlots(positions, setIdx);
        if (lib != null) markLibero(lib, setIdx);
      }
    } else if (ev.type === 'point') {
      const pe = ev as PointEvent;
      // Credit the scoring shirt on our side; the courtSnapshot, when
      // present, tells us everyone on the floor for both teams.
      if (pe.scoringTeam === ourSide) {
        markShirt(pe.shirt, setIdx);
        if (pe.assistShirt != null) markShirt(pe.assistShirt, setIdx);
      }
      const snap = pe.courtSnapshot;
      if (snap) {
        const positions = ourSide === 'home' ? snap.homePositions : snap.awayPositions;
        const lib = ourSide === 'home' ? snap.homeLiberosOnFloor : snap.awayLiberosOnFloor;
        if (Array.isArray(positions)) markRotationSlots(positions, setIdx);
        if (lib != null) markLibero(lib, setIdx);
      }
    }
  }

  return { byMatch, bySet, rotationShirts, liberoShirts };
}

export function aggregateOnCourtStats(
  matches: Match[],
  teamProfileId: string,
  filter: MatchFilter = { respectIncludeInStats: true }
): OnCourtSummary {
  const team: OnCourtTeamTotals = {
    matchCount: 0,
    setsPlayed: 0,
    setsWon: 0,
    setWinPct: NaN,
    rallies: 0,
    ralliesWon: 0,
    rallyWinPct: NaN,
  };
  const accs = new Map<number, PlayerAcc>();
  let ambiguous = 0;

  function getAcc(shirt: number, name: string, position?: string): PlayerAcc {
    let a = accs.get(shirt);
    if (!a) {
      a = {
        shirt,
        name,
        position,
        matchesAppearedSet: new Set(),
        setsAppearedKey: new Set(),
        setsWonKey: new Set(),
        rallies: 0,
        ralliesWon: 0,
        rotationSlotAppearances: 0,
        liberoMarkerAppearances: 0,
      };
      accs.set(shirt, a);
    } else {
      a.name = name;
      if (position) a.position = position;
    }
    return a;
  }

  for (const match of matches) {
    if (!matchPassesFilter(match, filter)) continue;
    const ourSide = teamSide(match, teamProfileId);
    if (!ourSide) continue;
    const roster = ourSide === 'home' ? match.rosters.home : match.rosters.away;
    const rosterByShirt = new Map<number, { name: string; position?: string }>();
    for (const p of roster) rosterByShirt.set(p.shirt, { name: p.name, position: p.position });

    const walk = walkTeamRallies(match, ourSide);
    ambiguous += walk.ambiguousRallies;

    // Broader participation scan — captures liberos / subs the rotation
    // walker misses when the import lacks libero-on events. Used for M
    // and Sets; rally-level stats below still use `walk.rallies`.
    const participation = gatherMatchParticipation(match, ourSide);

    const hasParticipation =
      walk.contributedAny || participation.byMatch.size > 0;
    if (!hasParticipation) continue;

    team.matchCount++;

    // Track set outcomes for the team — only count sets with a recorded
    // win or loss (drop in-progress / abandoned).
    for (const r of walk.setResults) {
      if (r.outcome === 'win') {
        team.setsPlayed++;
        team.setsWon++;
      } else if (r.outcome === 'loss') {
        team.setsPlayed++;
      }
    }

    // Per-rally accumulation — rallies / ralliesWon / on-court rallies
    // share. Only the rotation walker can attribute rallies to specific
    // shirts on the floor.
    for (const r of walk.rallies) {
      team.rallies++;
      if (r.scoringTeam === ourSide) team.ralliesWon++;
      for (const shirt of r.ourOnCourt) {
        const meta = rosterByShirt.get(shirt) ?? { name: `#${shirt}` };
        const acc = getAcc(shirt, meta.name, meta.position);
        acc.rallies++;
        if (r.scoringTeam === ourSide) acc.ralliesWon++;
      }
    }

    // M — matches appeared in. Any participation signal counts.
    for (const shirt of participation.byMatch) {
      const meta = rosterByShirt.get(shirt) ?? { name: `#${shirt}` };
      const acc = getAcc(shirt, meta.name, meta.position);
      acc.matchesAppearedSet.add(match.id);
      if (participation.rotationShirts.has(shirt)) acc.rotationSlotAppearances++;
      if (participation.liberoShirts.has(shirt)) acc.liberoMarkerAppearances++;
    }

    // Sets / set wins. A player gets credit for a set whenever they
    // appear in any signal during that set AND the set has a recorded
    // outcome (in-progress / abandoned sets still don't count).
    const setOutcome = new Map<number, 'win' | 'loss' | null>();
    for (const r of walk.setResults) setOutcome.set(r.setIndex, r.outcome);
    for (const [setIdx, shirts] of participation.bySet) {
      const outcome = setOutcome.get(setIdx) ?? null;
      if (outcome !== 'win' && outcome !== 'loss') continue;
      const setKey = `${match.id}#${setIdx}`;
      for (const shirt of shirts) {
        const meta = rosterByShirt.get(shirt) ?? { name: `#${shirt}` };
        const acc = getAcc(shirt, meta.name, meta.position);
        acc.setsAppearedKey.add(setKey);
        if (outcome === 'win') acc.setsWonKey.add(setKey);
      }
    }
  }

  team.setWinPct = team.setsPlayed > 0 ? team.setsWon / team.setsPlayed : NaN;
  team.rallyWinPct = team.rallies > 0 ? team.ralliesWon / team.rallies : NaN;

  const players: OnCourtPlayerLine[] = [];
  for (const a of accs.values()) {
    const setsAppeared = a.setsAppearedKey.size;
    const setsWon = a.setsWonKey.size;
    // Infer libero when the player has libero markers but never appeared
    // in any 6-position rotation slot across the whole slice. Conservative
    // by design — a player who occasionally subs in as libero AND plays
    // out the rotation in other matches is not labelled.
    const inferredPosition: 'L' | undefined =
      a.liberoMarkerAppearances > 0 && a.rotationSlotAppearances === 0
        ? 'L'
        : undefined;
    players.push({
      shirt: a.shirt,
      name: a.name,
      position: a.position,
      inferredPosition,
      matchesAppeared: a.matchesAppearedSet.size,
      setsAppeared,
      setsWon,
      setWinPct: setsAppeared > 0 ? setsWon / setsAppeared : NaN,
      rallies: a.rallies,
      ralliesWon: a.ralliesWon,
      rallyWinPct: a.rallies > 0 ? a.ralliesWon / a.rallies : NaN,
      shareOfRallies: team.rallies > 0 ? a.rallies / team.rallies : NaN,
    });
  }
  players.sort((a, b) => b.rallies - a.rallies || a.shirt - b.shirt);

  return { team, players, ambiguousRallies: ambiguous };
}
