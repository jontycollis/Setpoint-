// Tests for the per-athlete MRS link helpers. All pure — no
// AsyncStorage involvement.

import { describe, expect, it } from 'vitest';
import {
  resolveMrsTargetAthlete,
  anyAthleteMrsLinked,
  countMrsLinkedAthletes,
  applyMrsConnect,
  applyMrsDisconnect,
} from '../athleteMrs';
import type { AthleteProfile, UserProfile } from '../../types/profile';
import { DEFAULT_TENANT_ID } from '../tenant';

const FIXED_NOW = 1_700_000_000_000;

function athlete(
  id: string,
  partial: Partial<AthleteProfile> = {}
): AthleteProfile {
  return {
    id,
    tenantId: DEFAULT_TENANT_ID,
    displayName: id,
    relation: 'child',
    createdAt: FIXED_NOW - 1000,
    updatedAt: FIXED_NOW - 1000,
    ...partial,
  };
}

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    version: 2,
    tenantId: DEFAULT_TENANT_ID,
    athletes: [],
    activeAthleteId: null,
    teams: [],
    activeTeamId: null,
    clubs: [],
    mrsLinked: false,
    cacLinked: false,
    createdAt: FIXED_NOW - 1000,
    updatedAt: FIXED_NOW - 1000,
    ...overrides,
  };
}

describe('resolveMrsTargetAthlete', () => {
  it('returns the active athlete when set', () => {
    const a = athlete('ath_1');
    const b = athlete('ath_2');
    const p = profile({ athletes: [a, b], activeAthleteId: 'ath_2' });
    expect(resolveMrsTargetAthlete(p)?.id).toBe('ath_2');
  });

  it('falls back to a self-relation athlete when no active is set', () => {
    const a = athlete('ath_1', { relation: 'child' });
    const b = athlete('ath_2', { relation: 'self' });
    const p = profile({ athletes: [a, b], activeAthleteId: null });
    expect(resolveMrsTargetAthlete(p)?.id).toBe('ath_2');
  });

  it('falls back to the first athlete when neither active nor self is available', () => {
    const a = athlete('ath_1', { relation: 'child' });
    const b = athlete('ath_2', { relation: 'child' });
    const p = profile({ athletes: [a, b], activeAthleteId: null });
    expect(resolveMrsTargetAthlete(p)?.id).toBe('ath_1');
  });

  it('returns null when the profile has no athletes', () => {
    expect(resolveMrsTargetAthlete(profile())).toBeNull();
  });

  it('falls back when activeAthleteId points at a missing athlete', () => {
    const a = athlete('ath_1', { relation: 'self' });
    const p = profile({ athletes: [a], activeAthleteId: 'ath_missing' });
    expect(resolveMrsTargetAthlete(p)?.id).toBe('ath_1');
  });
});

describe('anyAthleteMrsLinked', () => {
  it('returns true when any athlete is linked', () => {
    const p = profile({
      athletes: [athlete('a'), athlete('b', { mrsLinked: true })],
    });
    expect(anyAthleteMrsLinked(p)).toBe(true);
  });

  it('returns false when no athlete is linked and the legacy flag is off', () => {
    const p = profile({ athletes: [athlete('a'), athlete('b')] });
    expect(anyAthleteMrsLinked(p)).toBe(false);
  });

  it('falls back to UserProfile.mrsLinked when there are no athletes', () => {
    expect(anyAthleteMrsLinked(profile({ mrsLinked: true }))).toBe(true);
    expect(anyAthleteMrsLinked(profile({ mrsLinked: false }))).toBe(false);
  });
});

describe('countMrsLinkedAthletes', () => {
  it('counts linked athletes', () => {
    const p = profile({
      athletes: [
        athlete('a', { mrsLinked: true }),
        athlete('b'),
        athlete('c', { mrsLinked: true }),
      ],
    });
    expect(countMrsLinkedAthletes(p)).toBe(2);
  });

  it('returns 0 for empty profile', () => {
    expect(countMrsLinkedAthletes(profile())).toBe(0);
  });
});

describe('applyMrsConnect', () => {
  it('flips mrsLinked on the target athlete', () => {
    const p = profile({
      athletes: [athlete('a'), athlete('b')],
      activeAthleteId: 'b',
    });
    const next = applyMrsConnect(p, 'b', FIXED_NOW);
    expect(next.athletes.find((a) => a.id === 'b')!.mrsLinked).toBe(true);
    expect(next.athletes.find((a) => a.id === 'a')!.mrsLinked).toBeUndefined();
  });

  it('sets aggregate UserProfile.mrsLinked = true after a successful link', () => {
    const p = profile({
      athletes: [athlete('a'), athlete('b')],
      activeAthleteId: 'b',
      mrsLinked: false,
    });
    const next = applyMrsConnect(p, 'b', FIXED_NOW);
    expect(next.mrsLinked).toBe(true);
  });

  it('falls back to UserProfile.mrsLinked when there are no athletes', () => {
    const p = profile({ mrsLinked: false });
    const next = applyMrsConnect(p, null, FIXED_NOW);
    expect(next.mrsLinked).toBe(true);
    expect(next.athletes).toEqual([]);
  });
});

describe('applyMrsDisconnect', () => {
  it('clears mrsLinked + mrsMemberId on the target athlete', () => {
    const p = profile({
      athletes: [
        athlete('a', { mrsLinked: true, mrsMemberId: 'mid_a' }),
        athlete('b', { mrsLinked: true, mrsMemberId: 'mid_b' }),
      ],
      activeAthleteId: 'b',
      mrsLinked: true,
    });
    const next = applyMrsDisconnect(p, 'b', FIXED_NOW);
    const b = next.athletes.find((a) => a.id === 'b')!;
    expect(b.mrsLinked).toBe(false);
    expect(b.mrsMemberId).toBeUndefined();
  });

  it('keeps aggregate UserProfile.mrsLinked = true while another athlete is still linked', () => {
    const p = profile({
      athletes: [
        athlete('a', { mrsLinked: true }),
        athlete('b', { mrsLinked: true }),
      ],
      mrsLinked: true,
    });
    const next = applyMrsDisconnect(p, 'b', FIXED_NOW);
    expect(next.mrsLinked).toBe(true);
  });

  it('flips aggregate to false when the last linked athlete disconnects', () => {
    const p = profile({
      athletes: [athlete('a'), athlete('b', { mrsLinked: true })],
      mrsLinked: true,
    });
    const next = applyMrsDisconnect(p, 'b', FIXED_NOW);
    expect(next.mrsLinked).toBe(false);
  });

  it('clears the legacy account-holder fields when no athletes exist', () => {
    const p = profile({ mrsLinked: true, mrsMemberId: 'mid' });
    const next = applyMrsDisconnect(p, null, FIXED_NOW);
    expect(next.mrsLinked).toBe(false);
    expect(next.mrsMemberId).toBeUndefined();
  });
});
