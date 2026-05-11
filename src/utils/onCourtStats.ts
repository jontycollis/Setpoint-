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
// All cuts come from the shared `walkTeamRallies` walker in
// `teamRallyWalk.ts` — no rotation logic lives here.
// ──────────────────────────────────────────────────────────────────────────

import type { Match } from '../types/match';
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
    if (!walk.contributedAny) continue;

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

    // Per-set, per-player appearance tracking.
    const perSetAppearances = new Map<number, Set<number>>(); // setIdx → shirts on court that set
    for (const r of walk.rallies) {
      team.rallies++;
      if (r.scoringTeam === ourSide) team.ralliesWon++;

      let appear = perSetAppearances.get(r.setIndex);
      if (!appear) {
        appear = new Set();
        perSetAppearances.set(r.setIndex, appear);
      }
      for (const shirt of r.ourOnCourt) {
        appear.add(shirt);
        const meta = rosterByShirt.get(shirt) ?? { name: `#${shirt}` };
        const acc = getAcc(shirt, meta.name, meta.position);
        acc.rallies++;
        if (r.scoringTeam === ourSide) acc.ralliesWon++;
      }
    }

    // Roll set appearances + wins into the per-player accumulators.
    const setOutcome = new Map<number, 'win' | 'loss' | null>();
    for (const r of walk.setResults) setOutcome.set(r.setIndex, r.outcome);

    for (const [setIdx, shirts] of perSetAppearances) {
      const outcome = setOutcome.get(setIdx) ?? null;
      const setKey = `${match.id}#${setIdx}`;
      for (const shirt of shirts) {
        const meta = rosterByShirt.get(shirt) ?? { name: `#${shirt}` };
        const acc = getAcc(shirt, meta.name, meta.position);
        acc.matchesAppearedSet.add(match.id);
        if (outcome === 'win' || outcome === 'loss') {
          acc.setsAppearedKey.add(setKey);
          if (outcome === 'win') acc.setsWonKey.add(setKey);
        }
      }
    }
  }

  team.setWinPct = team.setsPlayed > 0 ? team.setsWon / team.setsPlayed : NaN;
  team.rallyWinPct = team.rallies > 0 ? team.ralliesWon / team.rallies : NaN;

  const players: OnCourtPlayerLine[] = [];
  for (const a of accs.values()) {
    const setsAppeared = a.setsAppearedKey.size;
    const setsWon = a.setsWonKey.size;
    players.push({
      shirt: a.shirt,
      name: a.name,
      position: a.position,
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
