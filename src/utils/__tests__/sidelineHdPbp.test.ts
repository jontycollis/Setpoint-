// Tests for the opportunistic PBP enrichment helper. AsyncStorage isn't
// touched (the helper is pure orchestration over a fetcher), so this
// suite is hermetic.
//
// Coverage:
//   • gameHasOpportunisticPbp gates on fromIscore
//   • enrichWithPbp skips games without fromIscore
//   • enrichWithPbp replaces events when fetcher succeeds
//   • enrichWithPbp keeps summary when fetcher returns null events
//   • enrichWithPbp keeps summary when fetcher throws
//   • enrichWithPbp surfaces per-game warnings
//   • Productionfetcher today returns null (acts as no-op until probed)

import { describe, expect, it, vi } from 'vitest';
import {
  enrichWithPbp,
  gameHasOpportunisticPbp,
  productionPbpFetcher,
  type PbpFetcher,
} from '../sidelineHdPbp';
import type { Match, MatchEvent } from '../../types/match';
import type {
  SidelineHdApiGame,
  SidelineHdSession,
} from '../sidelineHdApi';

const session: SidelineHdSession = { jwt: 'jwt-test' };

function game(id: string, partial: Partial<SidelineHdApiGame> = {}): SidelineHdApiGame {
  return { id, sportType: 'volleyball', ...partial };
}

function match(id: string, events: MatchEvent[] = []): Match {
  return {
    id,
    meta: {
      tenantId: 'ova',
      eventName: 'Test',
      division: '',
      matchLabel: 'A vs B',
      courtName: '',
      dateMs: 1700000000000,
      sport: 'indoor',
      bestOf: 3,
      setTargets: { regular: 25, decider: 15, winBy: 2 },
      home: { label: 'A' },
      away: { label: 'B' },
      officials: {},
      includeInStats: true,
    },
    events,
    rosters: { home: [], away: [] },
    status: 'complete',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    schemaVersion: 1,
  } as Match;
}

describe('gameHasOpportunisticPbp', () => {
  it('returns true when fromIscore is exactly true', () => {
    expect(gameHasOpportunisticPbp(game('g1', { fromIscore: true }))).toBe(true);
  });

  it('returns false when fromIscore is false / missing', () => {
    expect(gameHasOpportunisticPbp(game('g1'))).toBe(false);
    expect(gameHasOpportunisticPbp(game('g1', { fromIscore: false }))).toBe(false);
  });
});

describe('enrichWithPbp', () => {
  it('skips games without fromIscore and returns them unchanged', async () => {
    const m = match('match-1', [
      {
        id: 'ev',
        ts: 1,
        setIndex: 0,
        type: 'lineup',
        team: 'home',
        positions: [1, 2, 3, 4, 5, 6] as never,
        liberos: [],
      },
    ]);
    const fetcher = vi.fn();
    const out = await enrichWithPbp({
      session,
      pairs: [{ game: game('g1'), match: m }],
      fetcher: fetcher as unknown as PbpFetcher,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(out.matches[0]).toBe(m);
    expect(out.warnings).toEqual([]);
  });

  it('replaces events when the fetcher returns rally events', async () => {
    const m = match('match-1', []);
    const richEvents: MatchEvent[] = [
      {
        id: 'pbp1',
        ts: 1,
        setIndex: 0,
        type: 'point',
        scoringTeam: 'home',
        reason: 'kill',
        shirt: 7,
      },
    ];
    const fetcher: PbpFetcher = async (_s, g) => ({
      gameId: g.id,
      events: richEvents,
    });
    const out = await enrichWithPbp({
      session,
      pairs: [{ game: game('g1', { fromIscore: true }), match: m }],
      fetcher,
    });
    expect(out.matches[0]!.events).toBe(richEvents);
    expect(out.warnings).toEqual([]);
  });

  it('keeps the summary record when fetcher returns null events', async () => {
    const m = match('match-1', [
      { id: 'ev', ts: 1, setIndex: 0, type: 'point', scoringTeam: 'home', reason: 'kill' },
    ]);
    const fetcher: PbpFetcher = async (_s, g) => ({
      gameId: g.id,
      events: null,
      warning: 'PBP endpoint not probed yet',
    });
    const out = await enrichWithPbp({
      session,
      pairs: [{ game: game('g1', { fromIscore: true }), match: m }],
      fetcher,
    });
    expect(out.matches[0]).toBe(m);
    expect(out.warnings[0]).toContain('match-1');
    expect(out.warnings[0]).toContain('PBP endpoint not probed yet');
  });

  it('keeps the summary record and warns when fetcher throws', async () => {
    const m = match('match-1');
    const fetcher: PbpFetcher = async () => {
      throw new Error('network blew up');
    };
    const out = await enrichWithPbp({
      session,
      pairs: [{ game: game('g1', { fromIscore: true }), match: m }],
      fetcher,
    });
    expect(out.matches[0]).toBe(m);
    expect(out.warnings[0]).toMatch(/network blew up/);
  });

  it('processes mixed batches independently — one failure does not abort others', async () => {
    const m1 = match('match-1');
    const m2 = match('match-2');
    const m3 = match('match-3');
    const fetcher: PbpFetcher = async (_s, g) => {
      if (g.id === 'g2') throw new Error('boom');
      return {
        gameId: g.id,
        events: [
          { id: g.id, ts: 1, setIndex: 0, type: 'point', scoringTeam: 'home' },
        ] as MatchEvent[],
      };
    };
    const out = await enrichWithPbp({
      session,
      pairs: [
        { game: game('g1', { fromIscore: true }), match: m1 },
        { game: game('g2', { fromIscore: true }), match: m2 },
        { game: game('g3', { fromIscore: true }), match: m3 },
      ],
      fetcher,
    });
    expect(out.matches[0]!.events).toHaveLength(1);
    expect(out.matches[1]).toBe(m2); // failure passthrough
    expect(out.matches[2]!.events).toHaveLength(1);
    expect(out.warnings).toHaveLength(1);
  });
});

describe('productionPbpFetcher', () => {
  it('returns null events as a no-op until the endpoint is probed', async () => {
    const out = await productionPbpFetcher(session, game('g1', { fromIscore: true }));
    expect(out.events).toBeNull();
    expect(out.warning).toMatch(/not probed/);
  });
});
