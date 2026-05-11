// ── Server splits / side-out & serving conversion ─────────────────────────
//
// Analytics slice 1 of the workbook port. Two related cuts per player:
//
//   • On-court splits — % of receiving rallies the team won when the
//     player was on the floor (side-out %), % of own-served rallies the
//     team won when the player was on the floor (serve point %).
//
//   • Personal serve splits — when this player was the actual server,
//     count of serves taken, won, lost, aces, point %.
//
// Walker is in `teamRallyWalk.ts` — this file just consumes its
// classified rally stream.
// ──────────────────────────────────────────────────────────────────────────

import type { Match } from '../types/match';
import { matchPassesFilter, teamSide, type MatchFilter } from './analytics';
import { walkTeamRallies } from './teamRallyWalk';

// ── Result shapes ─────────────────────────────────────────────────────────

export interface ServerSplitTeamTotals {
  recvRallies: number;
  recvWon: number;
  recvPct: number;
  serveRallies: number;
  serveWon: number;
  servePct: number;
  ambiguousRallies: number;
}

export interface ServerSplitLine {
  shirt: number;
  name: string;
  position?: string;
  // On-court splits — player was on the floor for the rally
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
  personalServeAces: number;
  personalServePct: number;
}

export interface ServerSplitSummary {
  team: ServerSplitTeamTotals;
  players: ServerSplitLine[];
  matchCount: number;
}

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

    const walk = walkTeamRallies(match, ourSide);
    team.ambiguousRallies += walk.ambiguousRallies;
    if (!walk.contributedAny) continue;
    matchCount++;

    for (const r of walk.rallies) {
      if (r.serving === ourSide) {
        team.serveRallies++;
        if (r.scoringTeam === ourSide) team.serveWon++;
      } else {
        team.recvRallies++;
        if (r.scoringTeam === ourSide) team.recvWon++;
      }

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
  }

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
  players.sort((a, b) => {
    const aTot = a.recvRallies + a.serveRallies;
    const bTot = b.recvRallies + b.serveRallies;
    return bTot - aTot || a.shirt - b.shirt;
  });

  return { team, players, matchCount };
}
