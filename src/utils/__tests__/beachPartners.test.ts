// Tests for the per-partner beach rollups. Covers grouping logic,
// aggregate math, best-finish selection, and the display formatter.

import { describe, expect, it } from 'vitest';
import {
  aggregateByPartner,
  describePartnerRollup,
} from '../beachPartners';
import type { UnifiedTournamentEntry } from '../unifiedSeasonHistory';

const FIXED_NOW = 1_700_000_000_000;

function entry(
  partial: Partial<UnifiedTournamentEntry> = {}
): UnifiedTournamentEntry {
  return {
    source: 'manual',
    sourceKey: 'k',
    sport: 'beach',
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

describe('aggregateByPartner', () => {
  it('groups entries by partner name (case-insensitive)', () => {
    const entries = [
      entry({
        beachPartner: { name: 'Lyevina' },
        matchesFor: 3,
        matchesAgainst: 1,
        dateMs: FIXED_NOW,
      }),
      entry({
        beachPartner: { name: 'lyevina' },
        matchesFor: 2,
        matchesAgainst: 2,
        dateMs: FIXED_NOW - 86400_000,
      }),
      entry({
        beachPartner: { name: 'Jordan' },
        matchesFor: 4,
        matchesAgainst: 0,
        dateMs: FIXED_NOW - 7 * 86400_000,
      }),
    ];
    const rollups = aggregateByPartner(entries);
    expect(rollups).toHaveLength(2);
    const lyev = rollups.find((r) =>
      r.partnerName.toLowerCase().startsWith('ly')
    )!;
    expect(lyev.tournaments).toBe(2);
    expect(lyev.matchesWon).toBe(5);
    expect(lyev.matchesLost).toBe(3);
  });

  it('preserves the first partner casing seen in the data', () => {
    const entries = [
      entry({ beachPartner: { name: 'Lyevina' }, dateMs: FIXED_NOW - 100 }),
      entry({ beachPartner: { name: 'LYEVINA' }, dateMs: FIXED_NOW }),
    ];
    const rollups = aggregateByPartner(entries);
    expect(rollups[0]!.partnerName).toBe('Lyevina');
  });

  it('drops entries without a beachPartner', () => {
    const entries = [
      entry({ beachPartner: { name: 'Lyevina' } }),
      entry({ beachPartner: undefined }),
      entry({ beachPartner: { name: '   ' } }),
    ];
    const rollups = aggregateByPartner(entries);
    expect(rollups).toHaveLength(1);
    expect(rollups[0]!.partnerName).toBe('Lyevina');
  });

  it('picks the smallest finalRank across a partner group as bestFinish', () => {
    const entries = [
      entry({
        beachPartner: { name: 'Lyevina' },
        finalRank: 5,
        finalRankLabel: '5th',
        tournamentName: 'Toronto Open',
      }),
      entry({
        beachPartner: { name: 'Lyevina' },
        finalRank: 3,
        finalRankLabel: '3rd',
        tournamentName: 'OPVC Spring',
      }),
      entry({
        beachPartner: { name: 'Lyevina' },
        finalRank: null,
        finalRankLabel: null,
      }),
    ];
    const rollups = aggregateByPartner(entries);
    expect(rollups[0]!.bestFinish).toEqual({
      rank: 3,
      label: '3rd',
      tournamentName: 'OPVC Spring',
    });
  });

  it('sorts by most-recently-played first, then by tournament count', () => {
    const entries = [
      entry({
        beachPartner: { name: 'Jordan' },
        dateMs: FIXED_NOW - 30 * 86400_000,
      }),
      entry({
        beachPartner: { name: 'Jordan' },
        dateMs: FIXED_NOW - 25 * 86400_000,
      }),
      entry({
        beachPartner: { name: 'Lyevina' },
        dateMs: FIXED_NOW,
      }),
    ];
    const rollups = aggregateByPartner(entries);
    expect(rollups[0]!.partnerName).toBe('Lyevina'); // most recent
    expect(rollups[1]!.partnerName).toBe('Jordan');
  });

  it('captures the most recent date a partner was played with', () => {
    const entries = [
      entry({
        beachPartner: { name: 'Lyevina' },
        dateMs: FIXED_NOW - 30 * 86400_000,
      }),
      entry({
        beachPartner: { name: 'Lyevina' },
        dateMs: FIXED_NOW,
      }),
    ];
    const rollups = aggregateByPartner(entries);
    expect(rollups[0]!.lastPlayedMs).toBe(FIXED_NOW);
  });
});

describe('describePartnerRollup', () => {
  it('formats tournament count + match record + best finish line', () => {
    const display = describePartnerRollup({
      partnerName: 'Lyevina',
      tournaments: 5,
      matchesWon: 12,
      matchesLost: 4,
      setsWon: 30,
      setsLost: 18,
      bestFinish: { rank: 3, label: '3rd', tournamentName: 'OPVC Spring' },
      lastPlayedMs: FIXED_NOW,
    });
    expect(display.tournamentCount).toBe('5 tournaments');
    expect(display.matchRecord).toBe('12-4');
    expect(display.bestFinishLine).toBe('Best 3rd at OPVC Spring');
  });

  it('uses singular "1 tournament"', () => {
    const display = describePartnerRollup({
      partnerName: 'Jordan',
      tournaments: 1,
      matchesWon: 2,
      matchesLost: 1,
      setsWon: 4,
      setsLost: 2,
      bestFinish: null,
      lastPlayedMs: FIXED_NOW,
    });
    expect(display.tournamentCount).toBe('1 tournament');
    expect(display.bestFinishLine).toBeNull();
  });

  it('null match record when no decided matches', () => {
    const display = describePartnerRollup({
      partnerName: 'Jordan',
      tournaments: 1,
      matchesWon: 0,
      matchesLost: 0,
      setsWon: 0,
      setsLost: 0,
      bestFinish: null,
      lastPlayedMs: FIXED_NOW,
    });
    expect(display.matchRecord).toBeNull();
  });
});
