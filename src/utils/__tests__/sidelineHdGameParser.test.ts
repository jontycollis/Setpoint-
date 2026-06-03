import { describe, expect, it } from 'vitest';
import {
  gameToMatch,
  parseSidelineHdApiGames,
} from '../sidelineHdGameParser';
import type { SidelineHdApiGame } from '../sidelineHdApi';

const baseGame: SidelineHdApiGame = {
  id: 'GmSh01-GmSs01-2a850fdc-41f9-4298-8d80-76fc9133556d',
  date: '2026-05-21',
  title: 'Nationals Day 1 Game 3',
  sportType: 'volleyball',
  scoreOurName: 'PVC 3D Royals',
  scoreOpponentName: 'Soaring Eagles',
  scoreWeAreHome: 1,
  scoreTsEnd: '2026-05-21T18:30:00.000Z',
  scoreTsStart: '2026-05-21T17:45:00.000Z',
  scheduleLocation: 'Court 4',
  localTzString: 'America/Toronto',
  isEnded: true,
  volleyball: {
    ourScore: 2,
    opponentScore: 0,
    weAreHome: true,
    currentSetOurScore: 0,
    currentSetOpponentScore: 0,
    gameComplete: true,
    opponentSets: [16, 23, -1],
    ourSets: [25, 25, -1],
  },
};

describe('gameToMatch', () => {
  it('converts a completed 2-set sweep into a Match with per-set point events', () => {
    const result = gameToMatch(baseGame, {
      teamProfileId: 'tp_test',
      teamLabel: 'PVC 3D Royals (32)',
    });
    expect(result).not.toBeNull();
    const { match, warnings } = result!;
    expect(warnings).toEqual([]);
    expect(match.id).toBe(
      'import-sideline-live-GmSh01-GmSs01-2a850fdc-41f9-4298-8d80-76fc9133556d'
    );
    expect(match.meta.matchLabel).toBe(
      'PVC 3D Royals (32) vs Soaring Eagles'
    );
    expect(match.meta.sport).toBe('indoor');
    expect(match.meta.source).toBe('sideline-hd-live');
    expect(match.meta.matchKind).toBe('imported');
    expect(match.meta.bestOf).toBe(3);
    expect(match.meta.eventName).toBe('Nationals Day 1 Game 3');
    expect(match.meta.courtName).toBe('Court 4');
    // weAreHome === true → our points are 'home' side
    const set0Points = match.events.filter((e) => e.setIndex === 0);
    const set0Home = set0Points.filter(
      (e) => e.type === 'point' && e.scoringTeam === 'home'
    );
    const set0Away = set0Points.filter(
      (e) => e.type === 'point' && e.scoringTeam === 'away'
    );
    expect(set0Home.length).toBe(25);
    expect(set0Away.length).toBe(16);
    // Set 2 (the -1/-1 slot) shouldn't produce any events
    const set2Points = match.events.filter((e) => e.setIndex === 2);
    expect(set2Points.length).toBe(0);
  });

  it('flips sides when the user is the away team', () => {
    const awayGame: SidelineHdApiGame = {
      ...baseGame,
      id: 'GmSh01-away-test',
      volleyball: {
        ...baseGame.volleyball!,
        weAreHome: false,
      },
    };
    const result = gameToMatch(awayGame, {
      teamProfileId: 'tp_test',
      teamLabel: 'PVC 3D Royals',
    });
    expect(result).not.toBeNull();
    const { match } = result!;
    // weAreHome === false → our points are 'away' side. Our team is still
    // meta.home (the user-facing convention: "us" is always home), but
    // the event scoring teams flip.
    const set0Home = match.events.filter(
      (e) => e.setIndex === 0 && e.type === 'point' && e.scoringTeam === 'home'
    );
    const set0Away = set0Points(match.events, 0);
    expect(set0Home.length).toBe(16); // opponent's points
    expect(set0Away.length).toBe(25); // our points
  });

  it('skips a scheduled-only game with all -1 sets', () => {
    const scheduled: SidelineHdApiGame = {
      ...baseGame,
      id: 'GmSh01-scheduled-test',
      isEnded: false,
      volleyball: {
        ...baseGame.volleyball!,
        gameComplete: false,
        opponentSets: [-1, -1, -1],
        ourSets: [-1, -1, -1],
      },
    };
    const result = gameToMatch(scheduled, {
      teamProfileId: 'tp_test',
      teamLabel: 'PVC 3D Royals',
    });
    expect(result).toBeNull();
  });

  it('skips a non-volleyball game (no `volleyball` blob)', () => {
    const baseball: SidelineHdApiGame = {
      ...baseGame,
      id: 'GmSh01-baseball-test',
      sportType: 'baseball',
      volleyball: undefined,
    };
    const result = gameToMatch(baseball, {
      teamProfileId: 'tp_test',
      teamLabel: 'PVC 3D Royals',
    });
    expect(result).toBeNull();
  });

  it('bumps bestOf to 5 when 4+ sets were played', () => {
    const fiveSetter: SidelineHdApiGame = {
      ...baseGame,
      id: 'GmSh01-fivesets-test',
      volleyball: {
        ...baseGame.volleyball!,
        ourScore: 3,
        opponentScore: 2,
        ourSets: [25, 22, 25, 23, 15],
        opponentSets: [21, 25, 23, 25, 12],
      },
    };
    const result = gameToMatch(fiveSetter, {
      teamProfileId: 'tp_test',
      teamLabel: 'PVC 3D Royals',
    });
    expect(result).not.toBeNull();
    expect(result!.match.meta.bestOf).toBe(5);
  });
});

describe('parseSidelineHdApiGames', () => {
  it('returns matches in source order and warns when nothing imports', () => {
    const empty = parseSidelineHdApiGames([], {
      teamProfileId: 'tp_test',
      teamLabel: 'PVC 3D Royals',
    });
    expect(empty.matches).toEqual([]);
    expect(empty.warnings.join('|')).toMatch(/No completed games/i);
  });

  it('drops scheduled games but keeps the played one', () => {
    const games: SidelineHdApiGame[] = [
      baseGame,
      {
        ...baseGame,
        id: 'GmSh01-future',
        scheduleTsStart: '2099-01-01T00:00:00.000Z',
        volleyball: {
          ...baseGame.volleyball!,
          gameComplete: false,
          ourSets: [-1, -1, -1],
          opponentSets: [-1, -1, -1],
        },
      },
    ];
    const out = parseSidelineHdApiGames(games, {
      teamProfileId: 'tp_test',
      teamLabel: 'PVC 3D Royals',
    });
    expect(out.matches.length).toBe(1);
    expect(out.matches[0]!.id).toBe(
      'import-sideline-live-GmSh01-GmSs01-2a850fdc-41f9-4298-8d80-76fc9133556d'
    );
  });
});

// Small helper for the away-team assertion above.
function set0Points(
  events: { setIndex: number; type: string; scoringTeam?: string }[],
  setIdx: number
) {
  return events.filter(
    (e) => e.setIndex === setIdx && e.type === 'point' && e.scoringTeam === 'away'
  );
}
