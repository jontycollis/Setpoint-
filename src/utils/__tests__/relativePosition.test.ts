// Tests for the "where I fit in" relative-position analytics. Two
// concerns: the percentile aggregation correctly bounds and averages,
// and the bucket distribution + rates match expectations across
// representative entry shapes.

import { describe, expect, it } from 'vitest';
import {
  computeRelativePosition,
  formatFinishPercentile,
} from '../relativePosition';
import type { UnifiedTournamentEntry } from '../unifiedSeasonHistory';

function entry(
  partial: Partial<UnifiedTournamentEntry> = {}
): UnifiedTournamentEntry {
  return {
    source: 'aes',
    sourceKey: 'k',
    sport: 'indoor',
    tournamentName: 'T',
    poolRank: null,
    finalRank: null,
    finalRankLabel: null,
    matchesFor: 0,
    matchesAgainst: 0,
    setsFor: 0,
    setsAgainst: 0,
    matches: [],
    ...partial,
  };
}

describe('computeRelativePosition', () => {
  it('returns null rates when entries are empty', () => {
    const s = computeRelativePosition([]);
    expect(s.averageFinishPercentile).toBeNull();
    expect(s.bestFinishPercentile).toBeNull();
    expect(s.matchWinRate).toBeNull();
    expect(s.setWinRate).toBeNull();
    expect(s.entriesWithFinish).toBe(0);
    expect(s.totalDecidedMatches).toBe(0);
  });

  it('averages finish percentiles across entries with both rank + field size', () => {
    const entries = [
      entry({ finalRank: 2, fieldSize: 10 }), // 0.2 → top10? no (0.2 > 0.1), top25 yes
      entry({ finalRank: 5, fieldSize: 10 }), // 0.5 → topHalf
      entry({ finalRank: 8, fieldSize: 10 }), // 0.8 → bottomHalf
    ];
    const s = computeRelativePosition(entries);
    expect(s.entriesWithFinish).toBe(3);
    expect(s.averageFinishPercentile).toBeCloseTo(0.5, 3);
    expect(s.bestFinishPercentile).toBeCloseTo(0.2, 3);
  });

  it('ignores entries missing finalRank or fieldSize', () => {
    const entries = [
      entry({ finalRank: 1, fieldSize: 10 }),
      entry({ finalRank: null, fieldSize: 10 }),
      entry({ finalRank: 5, fieldSize: undefined }),
    ];
    const s = computeRelativePosition(entries);
    expect(s.entriesWithFinish).toBe(1);
    expect(s.averageFinishPercentile).toBeCloseTo(0.1, 3);
  });

  it('clamps stale rank/field combinations to 1.0', () => {
    // finalRank > fieldSize happens when a snapshot was indexed mid-
    // bracket and the playoff hadn't promoted teams to the rankings
    // list yet. Clamping prevents a negative-looking percentile.
    const s = computeRelativePosition([
      entry({ finalRank: 12, fieldSize: 8 }),
    ]);
    expect(s.averageFinishPercentile).toBe(1);
    expect(s.bestFinishPercentile).toBe(1);
  });

  it('buckets entries correctly across the four tiers', () => {
    const entries = [
      entry({ finalRank: 1, fieldSize: 20 }), // 0.05 → top10
      entry({ finalRank: 1, fieldSize: 10 }), // 0.10 → top10 (boundary)
      entry({ finalRank: 2, fieldSize: 10 }), // 0.20 → top25
      entry({ finalRank: 5, fieldSize: 10 }), // 0.50 → topHalf (boundary)
      entry({ finalRank: 6, fieldSize: 10 }), // 0.60 → bottomHalf
    ];
    const s = computeRelativePosition(entries);
    expect(s.finishBuckets.top10).toBe(2);
    expect(s.finishBuckets.top25).toBe(1);
    expect(s.finishBuckets.topHalf).toBe(1);
    expect(s.finishBuckets.bottomHalf).toBe(1);
  });

  it('computes match win rate from aggregate wins + losses', () => {
    const entries = [
      entry({ matchesFor: 3, matchesAgainst: 1 }),
      entry({ matchesFor: 2, matchesAgainst: 2 }),
    ];
    const s = computeRelativePosition(entries);
    expect(s.totalDecidedMatches).toBe(8);
    expect(s.matchWinRate).toBeCloseTo(5 / 8, 3);
  });

  it('computes set win rate independently of match rate', () => {
    // Won every match 2-1 — match rate 100%, set rate 67%.
    const entries = [
      entry({ matchesFor: 1, matchesAgainst: 0, setsFor: 2, setsAgainst: 1 }),
      entry({ matchesFor: 1, matchesAgainst: 0, setsFor: 2, setsAgainst: 1 }),
    ];
    const s = computeRelativePosition(entries);
    expect(s.matchWinRate).toBe(1);
    expect(s.setWinRate).toBeCloseTo(4 / 6, 3);
  });
});

describe('formatFinishPercentile', () => {
  it('reads top half as "Top N%"', () => {
    expect(formatFinishPercentile(0.05)).toBe('Top 5%');
    expect(formatFinishPercentile(0.18)).toBe('Top 18%');
    expect(formatFinishPercentile(0.5)).toBe('Top 50%');
  });

  it('reads bottom half as "Bottom (100-N)%"', () => {
    expect(formatFinishPercentile(0.62)).toBe('Bottom 38%');
    expect(formatFinishPercentile(0.9)).toBe('Bottom 10%');
    expect(formatFinishPercentile(1.0)).toBe('Bottom 0%');
  });
});
