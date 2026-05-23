// ── sidelineHdParser tests ────────────────────────────────────────────────
//
// The live-API rally schema is unknown, so the parser is intentionally
// tolerant. These tests cover the documented behaviours:
//   1. Stable id generation (used for dedupe)
//   2. Happy path with a kill-shaped rally produces a point + a stat
//   3. Sparse payload (just winner) produces a point with reason=null
//   4. Empty rally array falls through to summary-only synthesis
//   5. Roster extraction from loose payloads
//   6. Source flag stamps correctly
//   7. Dedupe predicate
// ──────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  makeSidelineLiveMatchId,
  parseSidelineLiveMatch,
  sidelineLiveMatchIsImported,
} from '../sidelineHdParser';
import type {
  SidelineHdMatchSummary,
  SidelineHdRallyPayload,
  SidelineHdTeam,
} from '../../api/sidelineHd';

function makeTeam(): SidelineHdTeam {
  return {
    id: 'team-123',
    name: 'PVC 3D Titanium',
    raw: {},
  };
}

function makeSummary(
  overrides: Partial<SidelineHdMatchSummary> = {}
): SidelineHdMatchSummary {
  return {
    id: 'match-7be8',
    dateMs: 1759622400000,
    opponent: 'Noyz',
    homeScore: 2,
    awayScore: 1,
    eventName: "Women's Sunday League",
    raw: {},
    ...overrides,
  };
}

function makeRallies(rallies: unknown[]): SidelineHdRallyPayload {
  return {
    matchId: 'match-7be8',
    rallies,
    raw: {},
  };
}

describe('makeSidelineLiveMatchId', () => {
  it('produces a stable prefixed id', () => {
    expect(makeSidelineLiveMatchId('match-7be8')).toBe(
      'import-sideline-live-match-7be8'
    );
  });
});

describe('sidelineLiveMatchIsImported', () => {
  it('returns true when the prefixed id is in the existing set', () => {
    const existing = new Set(['import-sideline-live-match-7be8']);
    expect(sidelineLiveMatchIsImported(existing, 'match-7be8')).toBe(true);
  });
  it('returns false when missing', () => {
    expect(sidelineLiveMatchIsImported(new Set(), 'match-7be8')).toBe(false);
  });
});

describe('parseSidelineLiveMatch — happy path', () => {
  it('produces a Match with the live-source flag and stable id', () => {
    const result = parseSidelineLiveMatch({
      summary: makeSummary(),
      rallies: makeRallies([]),
      team: makeTeam(),
      teamProfileId: 'tp_abc',
    });
    expect(result.match).not.toBeNull();
    const m = result.match!;
    expect(m.id).toBe('import-sideline-live-match-7be8');
    expect(m.meta.source).toBe('sideline-hd-live');
    expect(m.meta.home.label).toBe('PVC 3D Titanium');
    expect(m.meta.home.teamProfileId).toBe('tp_abc');
    expect(m.meta.away.label).toBe('Noyz');
    expect(m.meta.matchCategory).toBe('womens-sunday-league');
    expect(m.status).toBe('complete');
  });

  it('emits a point + a stat for a rally with shirt + kill reason', () => {
    const result = parseSidelineLiveMatch({
      summary: makeSummary(),
      rallies: makeRallies([
        {
          winner: 'home',
          reason: 'kill',
          shirt: 7,
        },
      ]),
      team: makeTeam(),
      teamProfileId: 'tp_abc',
    });
    const events = result.match!.events;
    const point = events.find((e) => e.type === 'point');
    const stat = events.find((e) => e.type === 'stat');
    expect(point).toBeDefined();
    expect(stat).toBeDefined();
    if (point && point.type === 'point') {
      expect(point.scoringTeam).toBe('home');
      expect(point.reason).toBe('kill');
      expect(point.shirt).toBe(7);
    }
    if (stat && stat.type === 'stat') {
      expect(stat.category).toBe('kill');
      expect(stat.shirt).toBe(7);
      expect(stat.team).toBe('home');
    }
  });

  it('handles snake_case opponent labels', () => {
    const result = parseSidelineLiveMatch({
      summary: makeSummary(),
      rallies: makeRallies([
        { winner: 'away', reason: 'opp-error' },
      ]),
      team: makeTeam(),
      teamProfileId: 'tp_abc',
    });
    const point = result.match!.events.find((e) => e.type === 'point');
    expect(point).toBeDefined();
    if (point && point.type === 'point') {
      expect(point.scoringTeam).toBe('away');
      expect(point.reason).toBe('opp-error');
    }
  });

  it('warns but still emits a point when reason known but shirt missing', () => {
    const result = parseSidelineLiveMatch({
      summary: makeSummary(),
      rallies: makeRallies([
        { winner: 'home', reason: 'kill' },
      ]),
      team: makeTeam(),
      teamProfileId: 'tp_abc',
    });
    const events = result.match!.events;
    expect(events.some((e) => e.type === 'point')).toBe(true);
    expect(events.some((e) => e.type === 'stat')).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('parseSidelineLiveMatch — fallback synthesis', () => {
  it('synthesises points from summary scores when rallies are empty', () => {
    const result = parseSidelineLiveMatch({
      summary: makeSummary({ homeScore: 3, awayScore: 1 }),
      rallies: makeRallies([]),
      team: makeTeam(),
      teamProfileId: 'tp_abc',
    });
    const events = result.match!.events;
    const homePoints = events.filter(
      (e) => e.type === 'point' && e.scoringTeam === 'home'
    );
    const awayPoints = events.filter(
      (e) => e.type === 'point' && e.scoringTeam === 'away'
    );
    expect(homePoints.length).toBe(3);
    expect(awayPoints.length).toBe(1);
  });

  it('emits no events when summary has no score and rallies empty', () => {
    const result = parseSidelineLiveMatch({
      summary: makeSummary({ homeScore: 0, awayScore: 0 }),
      rallies: makeRallies([]),
      team: makeTeam(),
      teamProfileId: 'tp_abc',
    });
    expect(result.match!.events.length).toBe(0);
  });
});

describe('parseSidelineLiveMatch — roster extraction', () => {
  it('pulls a home roster from rally payload', () => {
    const result = parseSidelineLiveMatch({
      summary: makeSummary(),
      rallies: {
        matchId: 'match-7be8',
        rallies: [],
        raw: {
          homeRoster: [
            { shirt: 7, name: 'Kaliya Lea-Gordon' },
            { shirt: 16, name: 'Abby Collis' },
          ],
        },
      },
      team: makeTeam(),
      teamProfileId: 'tp_abc',
    });
    expect(result.match!.rosters.home).toHaveLength(2);
    expect(result.match!.rosters.home[0]).toMatchObject({
      shirt: 7,
      name: 'Kaliya Lea-Gordon',
    });
  });

  it('returns an empty roster when none provided', () => {
    const result = parseSidelineLiveMatch({
      summary: makeSummary(),
      rallies: makeRallies([]),
      team: makeTeam(),
      teamProfileId: 'tp_abc',
    });
    expect(result.match!.rosters.home).toEqual([]);
    expect(result.match!.rosters.away).toEqual([]);
  });
});

describe('parseSidelineLiveMatch — videoUrl pass-through', () => {
  it('attaches videoUrl when present in raw payload', () => {
    const result = parseSidelineLiveMatch({
      summary: makeSummary(),
      rallies: {
        matchId: 'match-7be8',
        rallies: [],
        raw: { videoUrl: 'https://sidelinehd.com/game/abc#pbp' },
      },
      team: makeTeam(),
      teamProfileId: 'tp_abc',
    });
    expect(result.match!.meta.videoUrl).toBe(
      'https://sidelinehd.com/game/abc#pbp'
    );
  });

  it('omits videoUrl when missing', () => {
    const result = parseSidelineLiveMatch({
      summary: makeSummary(),
      rallies: makeRallies([]),
      team: makeTeam(),
      teamProfileId: 'tp_abc',
    });
    expect(result.match!.meta.videoUrl).toBeUndefined();
  });
});
