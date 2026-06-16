// Tests for the TournamentSource contract + registry + the first
// concrete implementation (manualSource). Two concerns:
//   1) Registry behavior — register, lookup, replace-on-reregister,
//      clear, iteration order.
//   2) manualSource conforms — preload caches, getEntries projects
//      correctly, teamProfileIds scoping works, errors don't throw.

import { describe, expect, it, beforeEach, vi } from 'vitest';

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
  registerTournamentSource,
  getRegisteredSource,
  getRegisteredSources,
  clearTournamentSourceRegistry,
  type TournamentSource,
} from '../types';
import { createManualSource } from '../manualSource';
import { saveManualTournament } from '../../utils/manualTournaments';
import { DEFAULT_TENANT_ID } from '../../utils/tenant';

beforeEach(() => {
  clearTournamentSourceRegistry();
  for (const k of Object.keys(memory)) delete memory[k];
});

describe('TournamentSource registry', () => {
  function stubSource(
    id: TournamentSource['id'],
    displayName: string
  ): TournamentSource {
    return {
      id,
      displayName,
      async getEntries() {
        return [];
      },
    };
  }

  it('registers and retrieves a source by id', () => {
    const aes = stubSource('aes', 'AES');
    registerTournamentSource(aes);
    expect(getRegisteredSource('aes')).toBe(aes);
  });

  it('lists every registered source', () => {
    registerTournamentSource(stubSource('aes', 'AES'));
    registerTournamentSource(stubSource('timu', 'Timu'));
    registerTournamentSource(stubSource('manual', 'Manual'));
    const ids = getRegisteredSources().map((s) => s.id).sort();
    expect(ids).toEqual(['aes', 'manual', 'timu']);
  });

  it('replaces a prior registration when an id is re-registered', () => {
    registerTournamentSource(stubSource('aes', 'OldName'));
    registerTournamentSource(stubSource('aes', 'NewName'));
    expect(getRegisteredSource('aes')!.displayName).toBe('NewName');
    expect(getRegisteredSources()).toHaveLength(1);
  });

  it('clear empties the registry', () => {
    registerTournamentSource(stubSource('aes', 'AES'));
    clearTournamentSourceRegistry();
    expect(getRegisteredSources()).toEqual([]);
    expect(getRegisteredSource('aes')).toBeUndefined();
  });
});

describe('manualSource', () => {
  const FIXED_NOW = 1_700_000_000_000;

  async function seedEntries() {
    await saveManualTournament({
      id: 'mt_a',
      tenantId: DEFAULT_TENANT_ID,
      teamProfileId: 'tp_A',
      sport: 'beach',
      tournamentName: 'OPVC Spring',
      dateMs: FIXED_NOW,
      matchesFor: 3,
      matchesAgainst: 1,
      setsFor: 7,
      setsAgainst: 3,
      finalRank: 3,
      fieldSize: 12,
      beachPartner: { name: 'Lyevina' },
    });
    await saveManualTournament({
      id: 'mt_b',
      tenantId: DEFAULT_TENANT_ID,
      teamProfileId: 'tp_B',
      sport: 'indoor',
      tournamentName: 'OVA League Night 4',
      dateMs: FIXED_NOW - 7 * 86400_000,
      matchesFor: 2,
      matchesAgainst: 2,
      setsFor: 5,
      setsAgainst: 6,
    });
  }

  it('projects manual entries to UnifiedTournamentEntry with source "manual"', async () => {
    await seedEntries();
    const src = createManualSource();
    await src.preload!();
    const out = await src.getEntries({ aliases: [] });
    expect(out).toHaveLength(2);
    const beach = out.find((e) => e.sport === 'beach')!;
    expect(beach.source).toBe('manual');
    expect(beach.manualEntryId).toBe('mt_a');
    expect(beach.finalRankLabel).toBe('3rd');
    expect(beach.fieldSize).toBe(12);
    expect(beach.beachPartner?.name).toBe('Lyevina');
  });

  it('scopes by teamProfileIds when supplied', async () => {
    await seedEntries();
    const src = createManualSource();
    await src.preload!();
    const out = await src.getEntries({
      aliases: [],
      teamProfileIds: ['tp_A'],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.manualEntryId).toBe('mt_a');
  });

  it('lazy-loads on getEntries when preload was skipped', async () => {
    await seedEntries();
    const src = createManualSource();
    // Skip preload — exercise the defensive lazy-load branch.
    const out = await src.getEntries({ aliases: [] });
    expect(out).toHaveLength(2);
  });

  it('claims id "manual" and a non-empty displayName', () => {
    const src = createManualSource();
    expect(src.id).toBe('manual');
    expect(src.displayName.length).toBeGreaterThan(0);
  });

  it('returns empty array when there are no entries (no throw)', async () => {
    const src = createManualSource();
    await src.preload!();
    const out = await src.getEntries({ aliases: [] });
    expect(out).toEqual([]);
  });
});
