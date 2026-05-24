// ── sidelineHdParser tests ────────────────────────────────────────────────
//
// Covers the localStorage-snapshot parser used by the self-serve Sideline
// HD importer. The exact shape of `__pvcFinalMatches` and `__pvcPBP_*`
// isn't formally documented; these tests exercise the documented
// behaviours and the tolerant-parse fallbacks the parser relies on:
//
//   1. Stable id generation (used for dedupe across re-imports)
//   2. Empty snapshot → empty matches + a "no data" warning
//   3. `__pvcFinalMatches` with one entry → one Match, our-team-on-home,
//      summary-synthesised events when no PBP is present
//   4. Per-set scores in the summary drive setIndex on synthesised points
//   5. We played away → home/away scores swap so the Match is our-side-home
//   6. PBP string with score deltas produces real point events
//   7. PBP with a kill action label + jersey produces a stat event too
//   8. videoUrl pass-through from the summary record
//   9. Source flag + matchKind stamp correctly
//  10. Dedupe predicate
// ──────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  makeSidelineLiveMatchId,
  parseSidelineHdLocalStorageSnapshot,
  sidelineLiveMatchIsImported,
  type SidelineHdLocalStorageSnapshot,
} from '../sidelineHdParser';

function snapshot(
  finalMatches: unknown[],
  extra: Record<string, string> = {},
  teamSlug = 'pvc3droyals'
): SidelineHdLocalStorageSnapshot {
  return {
    teamSlug,
    entries: {
      __pvcFinalMatches: JSON.stringify(finalMatches),
      ...extra,
    },
  };
}

const BASE_OPTS = {
  teamProfileId: 'tp_abc',
  teamLabel: 'PVC 3D Titanium',
};

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

describe('parseSidelineHdLocalStorageSnapshot — empty snapshot', () => {
  it('returns no matches and a "no data" warning when entries are absent', () => {
    const result = parseSidelineHdLocalStorageSnapshot(
      { teamSlug: 'pvc3droyals', entries: {} },
      BASE_OPTS
    );
    expect(result.matches).toEqual([]);
    expect(result.warnings.some((w) => w.includes('__pvcFinalMatches'))).toBe(
      true
    );
  });
});

describe('parseSidelineHdLocalStorageSnapshot — happy path (summary only)', () => {
  it('produces one Match per __pvcFinalMatches entry with the live-source flag', () => {
    const result = parseSidelineHdLocalStorageSnapshot(
      snapshot([
        {
          id: 'match-7be8',
          date: '2025-10-05T00:00:00Z',
          homeTeam: 'PVC 3D Titanium',
          awayTeam: 'Noyz',
          homeScore: 2,
          awayScore: 1,
          eventName: "Women's Sunday League",
        },
      ]),
      BASE_OPTS
    );
    expect(result.matches).toHaveLength(1);
    const m = result.matches[0]!;
    expect(m.id).toBe('import-sideline-live-match-7be8');
    expect(m.meta.source).toBe('sideline-hd-live');
    expect(m.meta.matchKind).toBe('imported');
    expect(m.meta.home.label).toBe('PVC 3D Titanium');
    expect(m.meta.home.teamProfileId).toBe('tp_abc');
    expect(m.meta.away.label).toBe('Noyz');
    expect(m.meta.matchCategory).toBe('womens-sunday-league');
    expect(m.status).toBe('complete');
  });

  it('synthesises summary-only points when PBP is absent', () => {
    const result = parseSidelineHdLocalStorageSnapshot(
      snapshot([
        {
          id: 'match-1',
          homeTeam: 'PVC 3D Titanium',
          awayTeam: 'Noyz',
          homeScore: 3,
          awayScore: 1,
        },
      ]),
      BASE_OPTS
    );
    const events = result.matches[0]!.events;
    const home = events.filter(
      (e) => e.type === 'point' && e.scoringTeam === 'home'
    );
    const away = events.filter(
      (e) => e.type === 'point' && e.scoringTeam === 'away'
    );
    expect(home).toHaveLength(3);
    expect(away).toHaveLength(1);
  });

  it('uses per-set scores when present so each synthesised point lands in its set', () => {
    const result = parseSidelineHdLocalStorageSnapshot(
      snapshot([
        {
          id: 'match-2',
          homeTeam: 'PVC 3D Titanium',
          awayTeam: 'Noyz',
          sets: [
            { home: 25, away: 20 },
            { home: 23, away: 25 },
            { home: 15, away: 11 },
          ],
        },
      ]),
      BASE_OPTS
    );
    const events = result.matches[0]!.events;
    const set0 = events.filter((e) => e.setIndex === 0);
    const set1 = events.filter((e) => e.setIndex === 1);
    const set2 = events.filter((e) => e.setIndex === 2);
    expect(set0.length).toBe(45);
    expect(set1.length).toBe(48);
    expect(set2.length).toBe(26);
  });

  it('swaps home/away when our team played away so we end up on the home side', () => {
    const result = parseSidelineHdLocalStorageSnapshot(
      snapshot([
        {
          id: 'match-3',
          homeTeam: 'Noyz',
          awayTeam: 'PVC 3D Titanium',
          homeScore: 1,
          awayScore: 3,
        },
      ]),
      BASE_OPTS
    );
    const m = result.matches[0]!;
    expect(m.meta.home.label).toBe('PVC 3D Titanium');
    expect(m.meta.away.label).toBe('Noyz');
    const home = m.events.filter(
      (e) => e.type === 'point' && e.scoringTeam === 'home'
    );
    const away = m.events.filter(
      (e) => e.type === 'point' && e.scoringTeam === 'away'
    );
    expect(home).toHaveLength(3);
    expect(away).toHaveLength(1);
  });
});

describe('parseSidelineHdLocalStorageSnapshot — PBP rally parsing', () => {
  it('walks a pipe-delimited PBP string and emits point events from score deltas', () => {
    const pbp = [
      '1|-|0|kill|7',
      '1|-|1|kill|3',
      '2|-|1|ace|7',
    ].join('\n');
    const result = parseSidelineHdLocalStorageSnapshot(
      snapshot(
        [
          {
            id: 'match-pbp',
            homeTeam: 'PVC 3D Titanium',
            awayTeam: 'Noyz',
            homeScore: 2,
            awayScore: 1,
          },
        ],
        { '__pvcPBP_match-pbp': pbp }
      ),
      BASE_OPTS
    );
    const events = result.matches[0]!.events;
    const points = events.filter((e) => e.type === 'point');
    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({ scoringTeam: 'home', shirt: 7 });
    expect(points[1]).toMatchObject({ scoringTeam: 'away', shirt: 3 });
    expect(points[2]).toMatchObject({ scoringTeam: 'home', shirt: 7 });
  });

  it('emits a stat event alongside the point when action + shirt are recognisable', () => {
    const pbp = '1|-|0|kill|7';
    const result = parseSidelineHdLocalStorageSnapshot(
      snapshot(
        [
          {
            id: 'match-stat',
            homeTeam: 'PVC 3D Titanium',
            awayTeam: 'Noyz',
            homeScore: 1,
            awayScore: 0,
          },
        ],
        { '__pvcPBP_match-stat': pbp }
      ),
      BASE_OPTS
    );
    const events = result.matches[0]!.events;
    const stat = events.find((e) => e.type === 'stat');
    expect(stat).toBeDefined();
    if (stat && stat.type === 'stat') {
      expect(stat.category).toBe('kill');
      expect(stat.shirt).toBe(7);
      expect(stat.team).toBe('home');
    }
  });

  it('starts a new set when scores reset to 0/0 partway through the blob', () => {
    const pbp = [
      '1|-|0|kill|7',
      '2|-|0|ace|7',
      '0|-|0|kill|7', // new set
      '1|-|0|kill|7',
    ].join('\n');
    const result = parseSidelineHdLocalStorageSnapshot(
      snapshot(
        [
          {
            id: 'match-sets',
            homeTeam: 'PVC 3D Titanium',
            awayTeam: 'Noyz',
            homeScore: 2,
            awayScore: 0,
          },
        ],
        { '__pvcPBP_match-sets': pbp }
      ),
      BASE_OPTS
    );
    const events = result.matches[0]!.events;
    const set0Points = events.filter(
      (e) => e.type === 'point' && e.setIndex === 0
    );
    const set1Points = events.filter(
      (e) => e.type === 'point' && e.setIndex === 1
    );
    expect(set0Points.length).toBe(2);
    expect(set1Points.length).toBeGreaterThan(0);
  });
});

describe('parseSidelineHdLocalStorageSnapshot — videoUrl pass-through', () => {
  it('attaches videoUrl when present on the summary record', () => {
    const result = parseSidelineHdLocalStorageSnapshot(
      snapshot([
        {
          id: 'match-vid',
          homeTeam: 'PVC 3D Titanium',
          awayTeam: 'Noyz',
          videoUrl: 'https://sidelinehd.com/game/abc#pbp',
        },
      ]),
      BASE_OPTS
    );
    expect(result.matches[0]!.meta.videoUrl).toBe(
      'https://sidelinehd.com/game/abc#pbp'
    );
  });

  it('omits videoUrl when missing', () => {
    const result = parseSidelineHdLocalStorageSnapshot(
      snapshot([
        {
          id: 'match-novid',
          homeTeam: 'PVC 3D Titanium',
          awayTeam: 'Noyz',
        },
      ]),
      BASE_OPTS
    );
    expect(result.matches[0]!.meta.videoUrl).toBeUndefined();
  });
});

describe('parseSidelineHdLocalStorageSnapshot — roster extraction', () => {
  it('pulls a home roster from the summary record', () => {
    const result = parseSidelineHdLocalStorageSnapshot(
      snapshot([
        {
          id: 'match-roster',
          homeTeam: 'PVC 3D Titanium',
          awayTeam: 'Noyz',
          homeRoster: [
            { shirt: 7, name: 'Kaliya Lea-Gordon' },
            { shirt: 16, name: 'Abby Collis' },
          ],
        },
      ]),
      BASE_OPTS
    );
    expect(result.matches[0]!.rosters.home).toHaveLength(2);
    expect(result.matches[0]!.rosters.home[0]).toMatchObject({
      shirt: 7,
      name: 'Kaliya Lea-Gordon',
    });
  });

  it('returns empty rosters when none are present', () => {
    const result = parseSidelineHdLocalStorageSnapshot(
      snapshot([
        {
          id: 'match-noroster',
          homeTeam: 'PVC 3D Titanium',
          awayTeam: 'Noyz',
        },
      ]),
      BASE_OPTS
    );
    expect(result.matches[0]!.rosters.home).toEqual([]);
    expect(result.matches[0]!.rosters.away).toEqual([]);
  });
});
