// ── onCourtStats unit tests ────────────────────────────────────────────────
//
// Regression coverage for the libero match-count fix: in imports from
// Sideline HD the libero rarely arrives as a `libero-on` event, so the
// rotation walker never places her on court. M and Sets counts must
// fall back to participation signals (stat shirt, courtSnapshot lineups,
// homeLiberosOnFloor, lineup.liberos, sub in/out) so liberos still get
// credit for the matches they actually played.
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import type { Match, RosterPlayer, MatchEvent, CourtSnapshot } from '../../types/match';
import { aggregateOnCourtStats } from '../onCourtStats';

const TEAM_ID = 'team-pvc';

function homeRoster(): RosterPlayer[] {
  return [
    { shirt: 4, name: 'Setter', isLibero: false, active: true },
    { shirt: 7, name: 'OH 1', isLibero: false, active: true },
    { shirt: 8, name: 'OH 2', isLibero: false, active: true },
    { shirt: 9, name: 'MB 1', isLibero: false, active: true },
    { shirt: 13, name: 'MB 2', isLibero: false, active: true },
    { shirt: 17, name: 'OPP', isLibero: false, active: true },
    // Libero is on roster but NOT flagged isLibero — the Sideline HD
    // import strips this flag, which is the root cause we're guarding.
    { shirt: 16, name: 'Libero', isLibero: false, active: true },
  ];
}

function snapshot(positions: number[], libero: number | null): CourtSnapshot {
  return {
    homePositions: positions as CourtSnapshot['homePositions'],
    awayPositions: [21, 22, 23, 24, 25, 26],
    homeLiberosOnFloor: libero,
    awayLiberosOnFloor: null,
    server: 'home',
    serverShirt: positions[0],
  };
}

function buildMatch(id: string, events: MatchEvent[]): Match {
  return {
    id,
    meta: {
      tenantId: 'ova',
      eventName: 'Test League',
      division: '',
      matchLabel: 'PVC vs Opp',
      courtName: '',
      dateMs: 1700000000000,
      sport: 'indoor',
      bestOf: 3,
      setTargets: { regular: 25, decider: 15, winBy: 2 },
      home: { label: 'PVC', teamProfileId: TEAM_ID },
      away: { label: 'Opp' },
      officials: {},
      includeInStats: true,
    },
    events,
    rosters: { home: homeRoster(), away: [] },
    status: 'complete',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    schemaVersion: 1,
  } as Match;
}

describe('aggregateOnCourtStats', () => {
  it('counts a libero whose only floor evidence is courtSnapshot.homeLiberosOnFloor', () => {
    // Sideline HD shape: a lineup with 6 regulars, no libero-on events,
    // but each rally's courtSnapshot reports `homeLiberosOnFloor: 16`.
    const positions = [4, 7, 9, 8, 13, 17];
    const events: MatchEvent[] = [
      {
        id: 'ev1',
        ts: 1,
        setIndex: 0,
        type: 'lineup',
        team: 'home',
        positions: positions as never,
        liberos: [],
      },
      {
        id: 'ev2',
        ts: 2,
        setIndex: 0,
        type: 'stat',
        team: 'home',
        shirt: 16,
        category: 'dig',
        courtSnapshot: snapshot(positions, 16),
      },
      {
        id: 'ev3',
        ts: 3,
        setIndex: 0,
        type: 'point',
        scoringTeam: 'home',
        reason: 'kill',
        shirt: 7,
      },
      {
        id: 'ev4',
        ts: 4,
        setIndex: 0,
        type: 'set-end',
        homeFinal: 25,
        awayFinal: 22,
        durationMs: 60_000,
      },
    ];

    const out = aggregateOnCourtStats([buildMatch('m1', events)], TEAM_ID);
    const libero = out.players.find((p) => p.shirt === 16);
    expect(libero, 'libero should appear in player list').toBeDefined();
    expect(libero!.matchesAppeared).toBe(1);
    expect(libero!.setsAppeared).toBe(1);
    expect(libero!.setsWon).toBe(1);
    // Inferred position when libero markers exist but the player never
    // appeared in the 6-position rotation in any signal.
    expect(libero!.inferredPosition).toBe('L');
  });

  it('credits a libero who appears via lineup.liberos array even with no libero-on event', () => {
    const positions = [4, 7, 9, 8, 13, 17];
    const events: MatchEvent[] = [
      {
        id: 'ev1',
        ts: 1,
        setIndex: 0,
        type: 'lineup',
        team: 'home',
        positions: positions as never,
        liberos: [16],
      },
      {
        id: 'ev2',
        ts: 2,
        setIndex: 0,
        type: 'point',
        scoringTeam: 'home',
        reason: 'kill',
        shirt: 7,
      },
      {
        id: 'ev3',
        ts: 3,
        setIndex: 0,
        type: 'set-end',
        homeFinal: 25,
        awayFinal: 22,
        durationMs: 60_000,
      },
    ];
    const out = aggregateOnCourtStats([buildMatch('m2', events)], TEAM_ID);
    const libero = out.players.find((p) => p.shirt === 16);
    expect(libero).toBeDefined();
    expect(libero!.matchesAppeared).toBe(1);
    expect(libero!.setsAppeared).toBe(1);
  });

  it('does not count a player who has zero participation signals', () => {
    const positions = [4, 7, 9, 8, 13, 17];
    const events: MatchEvent[] = [
      {
        id: 'ev1',
        ts: 1,
        setIndex: 0,
        type: 'lineup',
        team: 'home',
        positions: positions as never,
        liberos: [],
      },
      {
        id: 'ev2',
        ts: 2,
        setIndex: 0,
        type: 'point',
        scoringTeam: 'home',
        reason: 'kill',
        shirt: 7,
      },
      {
        id: 'ev3',
        ts: 3,
        setIndex: 0,
        type: 'set-end',
        homeFinal: 25,
        awayFinal: 22,
        durationMs: 60_000,
      },
    ];
    const out = aggregateOnCourtStats([buildMatch('m3', events)], TEAM_ID);
    // #16 (Libero on roster) never appears in events — should be absent.
    const libero = out.players.find((p) => p.shirt === 16);
    expect(libero).toBeUndefined();
  });

  it('counts only sets with a recorded outcome — in-progress sets do not count Set% but DO contribute to M', () => {
    const positions = [4, 7, 9, 8, 13, 17];
    // Set 0 has a set-end (win); set 1 has events but no set-end.
    const events: MatchEvent[] = [
      {
        id: 'ev1',
        ts: 1,
        setIndex: 0,
        type: 'lineup',
        team: 'home',
        positions: positions as never,
        liberos: [16],
      },
      {
        id: 'ev2',
        ts: 2,
        setIndex: 0,
        type: 'point',
        scoringTeam: 'home',
        reason: 'kill',
        shirt: 7,
      },
      {
        id: 'ev3',
        ts: 3,
        setIndex: 0,
        type: 'set-end',
        homeFinal: 25,
        awayFinal: 22,
        durationMs: 60_000,
      },
      {
        id: 'ev4',
        ts: 4,
        setIndex: 1,
        type: 'lineup',
        team: 'home',
        positions: positions as never,
        liberos: [16],
      },
      {
        id: 'ev5',
        ts: 5,
        setIndex: 1,
        type: 'point',
        scoringTeam: 'home',
        reason: 'kill',
        shirt: 7,
      },
    ];

    const out = aggregateOnCourtStats([buildMatch('m4', events)], TEAM_ID);
    const libero = out.players.find((p) => p.shirt === 16);
    expect(libero).toBeDefined();
    // Libero showed up in both sets but only set 0 ended.
    expect(libero!.matchesAppeared).toBe(1);
    expect(libero!.setsAppeared).toBe(1);
    expect(libero!.setsWon).toBe(1);
  });

  it('does not infer libero for a player who appears in regular rotation positions', () => {
    const positions = [4, 7, 9, 8, 13, 17];
    const events: MatchEvent[] = [
      {
        id: 'ev1',
        ts: 1,
        setIndex: 0,
        type: 'lineup',
        team: 'home',
        positions: positions as never,
        liberos: [],
      },
      {
        id: 'ev2',
        ts: 2,
        setIndex: 0,
        type: 'point',
        scoringTeam: 'home',
        reason: 'kill',
        shirt: 7,
      },
      {
        id: 'ev3',
        ts: 3,
        setIndex: 0,
        type: 'set-end',
        homeFinal: 25,
        awayFinal: 22,
        durationMs: 60_000,
      },
    ];
    const out = aggregateOnCourtStats([buildMatch('m5', events)], TEAM_ID);
    const setter = out.players.find((p) => p.shirt === 4);
    expect(setter).toBeDefined();
    expect(setter!.inferredPosition).toBeUndefined();
  });
});
