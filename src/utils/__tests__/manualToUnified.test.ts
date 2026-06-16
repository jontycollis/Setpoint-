// Tests that manual tournament entries land correctly in the unified
// season history — the projection through `buildMySeasonHistory` with
// the teamProfileIds filter, and the entry shape produced by the
// internal adapter.
//
// We exercise buildMySeasonHistory directly (not the storage layer) so
// the test is hermetic — no AsyncStorage mocking needed beyond the
// shim used in manualTournaments.test.

import { describe, expect, it, vi } from 'vitest';

const memory: Record<string, string> = {};
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => memory[k] ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      memory[k] = v;
    }),
    removeItem: vi.fn(async (k: string) => {
      delete memory[k];
    }),
  },
}));

import { buildMySeasonHistory, type LoadedIndices } from '../unifiedSeasonHistory';
import type { ManualTournamentEntry } from '../manualTournaments';
import { DEFAULT_TENANT_ID } from '../tenant';

const FIXED_NOW = 1_700_000_000_000;

function manualEntry(
  overrides: Partial<ManualTournamentEntry> = {}
): ManualTournamentEntry {
  return {
    id: 'mt_test',
    tenantId: DEFAULT_TENANT_ID,
    teamProfileId: 'tp_pair',
    sport: 'beach',
    tournamentName: 'OPVC Spring Slam',
    dateMs: FIXED_NOW,
    matchesFor: 3,
    matchesAgainst: 1,
    setsFor: 7,
    setsAgainst: 3,
    finalRank: 5,
    fieldSize: 24,
    beachPartner: { name: 'Lyevina' },
    createdAt: FIXED_NOW - 1000,
    updatedAt: FIXED_NOW - 500,
    ...overrides,
  };
}

function indicesWith(manual: ManualTournamentEntry[]): LoadedIndices {
  return {
    timu: {},
    aes: {},
    scored: [],
    manual,
  };
}

describe('buildMySeasonHistory — manual entries', () => {
  it('projects a manual entry to source "manual" with finalRankLabel and fieldSize', () => {
    const entries = [manualEntry()];
    const out = buildMySeasonHistory(
      indicesWith(entries),
      ['Collis / Lyevina'],
      { teamProfileIds: ['tp_pair'] }
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe('manual');
    expect(out[0]!.sourceKey).toBe('manual:mt_test');
    expect(out[0]!.manualEntryId).toBe('mt_test');
    expect(out[0]!.sport).toBe('beach');
    expect(out[0]!.finalRank).toBe(5);
    expect(out[0]!.finalRankLabel).toBe('5th');
    expect(out[0]!.fieldSize).toBe(24);
    expect(out[0]!.beachPartner?.name).toBe('Lyevina');
    expect(out[0]!.matchesFor).toBe(3);
    expect(out[0]!.matchesAgainst).toBe(1);
  });

  it('scopes by teamProfileIds when supplied', () => {
    const entries = [
      manualEntry({ id: 'mt_a', teamProfileId: 'tp_X' }),
      manualEntry({ id: 'mt_b', teamProfileId: 'tp_Y' }),
      manualEntry({ id: 'mt_c', teamProfileId: 'tp_X' }),
    ];
    const out = buildMySeasonHistory(
      indicesWith(entries),
      ['Anything'],
      { teamProfileIds: ['tp_X'] }
    );
    expect(out.map((e) => e.manualEntryId).sort()).toEqual(['mt_a', 'mt_c']);
  });

  it('includes every manual entry when teamProfileIds is undefined', () => {
    const entries = [
      manualEntry({ id: 'mt_a', teamProfileId: 'tp_X' }),
      manualEntry({ id: 'mt_b', teamProfileId: 'tp_Y' }),
    ];
    const out = buildMySeasonHistory(indicesWith(entries), ['Anything']);
    // Both entries included regardless of teamProfileId — legacy callers
    // without a scope id see everything.
    expect(out.map((e) => e.manualEntryId).sort()).toEqual(['mt_a', 'mt_b']);
  });

  it('sorts manual entries with the rest of the history (newest first)', () => {
    const entries = [
      manualEntry({ id: 'mt_old', dateMs: FIXED_NOW - 30 * 86400_000 }),
      manualEntry({ id: 'mt_new', dateMs: FIXED_NOW }),
    ];
    const out = buildMySeasonHistory(
      indicesWith(entries),
      ['Anything'],
      { teamProfileIds: ['tp_pair'] }
    );
    expect(out.map((e) => e.manualEntryId)).toEqual(['mt_new', 'mt_old']);
  });
});
