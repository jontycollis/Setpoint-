// Tests for the manual tournament store. AsyncStorage is mocked at the
// module level (the React Native AsyncStorage doesn't run under Node);
// we verify shape + behavior, not actual persistence.
//
// Coverage:
//   • saveManualTournament inserts a new record with createdAt/updatedAt
//   • saveManualTournament updates an existing record in place
//   • loadManualTournaments returns newest-first
//   • loadManualTournamentsForTeam filters by teamProfileId
//   • removeManualTournament drops by id; no-op when id unknown
//   • tenantId defaults to DEFAULT_TENANT_ID when missing on input

import { describe, expect, it, beforeEach, vi } from 'vitest';

// In-memory shim — vitest mocks AsyncStorage so the helpers work without
// a real device.
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

import {
  loadManualTournaments,
  loadManualTournamentsForTeam,
  saveManualTournament,
  removeManualTournament,
  makeManualTournamentId,
} from '../manualTournaments';
import { DEFAULT_TENANT_ID } from '../tenant';

const FIXED_NOW = 1_700_000_000_000;

function baseEntry(
  overrides: Partial<Parameters<typeof saveManualTournament>[0]> = {}
) {
  return {
    id: overrides.id ?? makeManualTournamentId(FIXED_NOW),
    tenantId: DEFAULT_TENANT_ID,
    teamProfileId: 'tp_1',
    sport: 'beach' as const,
    tournamentName: 'OPVC Spring Slam',
    dateMs: FIXED_NOW,
    matchesFor: 3,
    matchesAgainst: 1,
    setsFor: 7,
    setsAgainst: 3,
    ...overrides,
  };
}

beforeEach(() => {
  // Reset the shim between tests so leftover entries don't bleed across.
  for (const k of Object.keys(memory)) delete memory[k];
});

describe('saveManualTournament', () => {
  it('inserts a new record with createdAt + updatedAt', async () => {
    const saved = await saveManualTournament(baseEntry({ id: 'mt_a' }));
    expect(saved.id).toBe('mt_a');
    expect(saved.createdAt).toBeTypeOf('number');
    expect(saved.updatedAt).toBeTypeOf('number');
    const all = await loadManualTournaments();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe('mt_a');
  });

  it('updates an existing record in place when the id matches', async () => {
    await saveManualTournament(
      baseEntry({ id: 'mt_b', tournamentName: 'First Name' })
    );
    const updated = await saveManualTournament(
      baseEntry({ id: 'mt_b', tournamentName: 'Second Name' })
    );
    expect(updated.tournamentName).toBe('Second Name');
    const all = await loadManualTournaments();
    expect(all).toHaveLength(1);
    expect(all[0]!.tournamentName).toBe('Second Name');
  });

  it('preserves createdAt across updates', async () => {
    const initial = await saveManualTournament(baseEntry({ id: 'mt_c' }));
    await new Promise((r) => setTimeout(r, 5));
    const after = await saveManualTournament(
      baseEntry({ id: 'mt_c', tournamentName: 'Updated' })
    );
    expect(after.createdAt).toBe(initial.createdAt);
    expect(after.updatedAt).toBeGreaterThanOrEqual(initial.updatedAt);
  });

  it('defaults tenantId to DEFAULT_TENANT_ID when not provided', async () => {
    const saved = await saveManualTournament({
      ...baseEntry({ id: 'mt_d' }),
      tenantId: '',
    });
    expect(saved.tenantId).toBe(DEFAULT_TENANT_ID);
  });
});

describe('loadManualTournaments', () => {
  it('returns entries sorted newest-first by dateMs', async () => {
    await saveManualTournament(
      baseEntry({ id: 'mt_1', dateMs: FIXED_NOW - 30 * 86400_000 })
    );
    await saveManualTournament(
      baseEntry({ id: 'mt_2', dateMs: FIXED_NOW })
    );
    await saveManualTournament(
      baseEntry({ id: 'mt_3', dateMs: FIXED_NOW - 7 * 86400_000 })
    );
    const all = await loadManualTournaments();
    expect(all.map((e) => e.id)).toEqual(['mt_2', 'mt_3', 'mt_1']);
  });
});

describe('loadManualTournamentsForTeam', () => {
  it('filters by teamProfileId', async () => {
    await saveManualTournament(
      baseEntry({ id: 'mt_a', teamProfileId: 'tp_A' })
    );
    await saveManualTournament(
      baseEntry({ id: 'mt_b', teamProfileId: 'tp_B' })
    );
    await saveManualTournament(
      baseEntry({ id: 'mt_c', teamProfileId: 'tp_A' })
    );
    const aOnly = await loadManualTournamentsForTeam('tp_A');
    expect(aOnly.map((e) => e.id).sort()).toEqual(['mt_a', 'mt_c']);
  });
});

describe('removeManualTournament', () => {
  it('drops the matching entry', async () => {
    await saveManualTournament(baseEntry({ id: 'mt_1' }));
    await saveManualTournament(baseEntry({ id: 'mt_2' }));
    await removeManualTournament('mt_1');
    const all = await loadManualTournaments();
    expect(all.map((e) => e.id)).toEqual(['mt_2']);
  });

  it('is a no-op for an unknown id', async () => {
    await saveManualTournament(baseEntry({ id: 'mt_1' }));
    await removeManualTournament('mt_made_up');
    const all = await loadManualTournaments();
    expect(all).toHaveLength(1);
  });
});
