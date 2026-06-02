// ── isActiveTournament / getActiveTournaments tests ──────────────────────
//
// Pins the "active" predicate that drives the pinned section at the top
// of Season History. The intent: a tournament starting within the next
// 7 days OR that started within the last 2 days (still plausibly being
// played) counts as active.
// ──────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  isActiveTournament,
  getActiveTournaments,
  type UnifiedTournamentEntry,
} from '../unifiedSeasonHistory';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 4, 22, 12, 0, 0); // 2026-05-22 12:00 UTC

function entry(dateMs: number | null, tournamentName = 'Test Cup'): UnifiedTournamentEntry {
  // The predicate only reads `dateMs`. Everything else is filler.
  return {
    source: 'aes',
    sport: 'indoor',
    sourceKey: `t-${dateMs ?? 'none'}`,
    tournamentName,
    poolRank: null,
    finalRank: null,
    finalRankLabel: null,
    matchesFor: 0,
    matchesAgainst: 0,
    setsFor: 0,
    setsAgainst: 0,
    matches: [],
    dateMs: dateMs ?? undefined,
  };
}

describe('isActiveTournament', () => {
  it('flags a tournament starting today as active', () => {
    expect(isActiveTournament(entry(NOW), NOW)).toBe(true);
  });

  it('flags a tournament starting in 3 days as active', () => {
    expect(isActiveTournament(entry(NOW + 3 * DAY), NOW)).toBe(true);
  });

  it('flags a tournament that started yesterday as active (still in progress)', () => {
    expect(isActiveTournament(entry(NOW - 1 * DAY), NOW)).toBe(true);
  });

  it('does NOT flag a tournament 8 days out', () => {
    expect(isActiveTournament(entry(NOW + 8 * DAY), NOW)).toBe(false);
  });

  it('does NOT flag a tournament 3 days in the past', () => {
    expect(isActiveTournament(entry(NOW - 3 * DAY), NOW)).toBe(false);
  });

  it('does NOT flag a tournament with no dateMs', () => {
    expect(isActiveTournament(entry(null), NOW)).toBe(false);
  });

  it('includes the 7-day boundary', () => {
    expect(isActiveTournament(entry(NOW + 7 * DAY), NOW)).toBe(true);
  });

  it('excludes anything past the 7-day boundary by a minute', () => {
    expect(isActiveTournament(entry(NOW + 7 * DAY + 60_000), NOW)).toBe(false);
  });
});

describe('getActiveTournaments', () => {
  it('returns only active entries sorted earliest first', () => {
    const list: UnifiedTournamentEntry[] = [
      entry(NOW + 6 * DAY, 'Far'),
      entry(NOW - 1 * DAY, 'Started yesterday'),
      entry(NOW + 30 * DAY, 'Way out'),
      entry(NOW + 2 * DAY, 'Soon'),
      entry(NOW - 10 * DAY, 'Long past'),
    ];
    const active = getActiveTournaments(list, NOW);
    expect(active.map((e) => e.tournamentName)).toEqual([
      'Started yesterday',
      'Soon',
      'Far',
    ]);
  });

  it('returns empty when nothing is active', () => {
    const list = [entry(NOW + 30 * DAY), entry(NOW - 30 * DAY)];
    expect(getActiveTournaments(list, NOW)).toEqual([]);
  });
});
