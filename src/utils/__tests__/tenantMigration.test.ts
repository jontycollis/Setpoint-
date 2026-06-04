// Tests for the tenantId backfill in the v1→v2 migration and the
// idempotent v2 shape patch. The backfill is the foundation for
// white-label multi-tenant deployment — every record carries `tenantId`
// after the migration runs, regardless of whether it was a v1 input or a
// stale-shape v2 input.

import { describe, expect, it } from 'vitest';
import {
  buildV2FromV1,
  ensureTeamProfileShape,
  ensureAthleteProfileShape,
} from '../userProfileMigration';
import { DEFAULT_TENANT_ID } from '../tenant';
import type {
  AthleteProfile,
  TeamProfile,
  UserProfile,
  UserProfileV1,
} from '../../types/profile';

const FIXED_NOW = 1_700_000_000_000;

describe('ensureTeamProfileShape — tenantId backfill', () => {
  it('fills in tenantId when missing', () => {
    const team = {
      id: 'tp_1',
      label: 'Team',
      source: 'aes',
      sport: 'indoor',
      kind: 'me',
      aliases: ['Team'],
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    } as unknown as TeamProfile;
    const patched = ensureTeamProfileShape(team);
    expect(patched.tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it('preserves a non-default tenantId', () => {
    const team: TeamProfile = {
      id: 'tp_2',
      tenantId: 'volleyball-quebec',
      label: 'Team',
      source: 'aes',
      sport: 'indoor',
      kind: 'me',
      aliases: ['Team'],
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    };
    expect(ensureTeamProfileShape(team).tenantId).toBe('volleyball-quebec');
  });

  it('is idempotent — returns the same reference when nothing to patch', () => {
    const team: TeamProfile = {
      id: 'tp_3',
      tenantId: DEFAULT_TENANT_ID,
      label: 'Team',
      source: 'aes',
      sport: 'indoor',
      kind: 'me',
      aliases: ['Team'],
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    };
    expect(ensureTeamProfileShape(team)).toBe(team);
  });
});

describe('ensureAthleteProfileShape — tenantId backfill', () => {
  it('fills in tenantId when missing', () => {
    const athlete = {
      id: 'ath_1',
      displayName: 'Sarah',
      relation: 'child',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    } as unknown as AthleteProfile;
    expect(ensureAthleteProfileShape(athlete).tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it('is idempotent', () => {
    const athlete: AthleteProfile = {
      id: 'ath_2',
      tenantId: DEFAULT_TENANT_ID,
      displayName: 'Sarah',
      relation: 'child',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    };
    expect(ensureAthleteProfileShape(athlete)).toBe(athlete);
  });
});

describe('buildV2FromV1 — tenantId on v1 input', () => {
  it('stamps DEFAULT_TENANT_ID on the resulting UserProfile (no me-teams path)', () => {
    const v1: UserProfileV1 = {
      version: 1,
      teams: [],
      activeTeamId: null,
      mrsLinked: false,
      cacLinked: false,
      createdAt: FIXED_NOW - 1000,
      updatedAt: FIXED_NOW - 1000,
    };
    const v2 = buildV2FromV1(v1, FIXED_NOW);
    expect(v2.tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it('stamps DEFAULT_TENANT_ID on UserProfile, athletes, and teams (with me-team path)', () => {
    const v1: UserProfileV1 = {
      version: 1,
      displayName: 'Jon',
      role: 'parent',
      teams: [
        {
          id: 'tp_existing',
          label: 'PVC',
          source: 'aes',
          sport: 'indoor',
          kind: 'me',
          aliases: ['PVC'],
          createdAt: FIXED_NOW - 1000,
          updatedAt: FIXED_NOW - 1000,
        } as unknown as TeamProfile,
      ],
      activeTeamId: 'tp_existing',
      mrsLinked: false,
      cacLinked: false,
      createdAt: FIXED_NOW - 1000,
      updatedAt: FIXED_NOW - 1000,
    };
    const v2 = buildV2FromV1(v1, FIXED_NOW);
    expect(v2.tenantId).toBe(DEFAULT_TENANT_ID);
    expect(v2.athletes).toHaveLength(1);
    expect(v2.athletes[0]!.tenantId).toBe(DEFAULT_TENANT_ID);
    expect(v2.teams[0]!.tenantId).toBe(DEFAULT_TENANT_ID);
  });
});

describe('buildV2FromV1 — v2 short-circuit also backfills', () => {
  it('patches a stale v2 with no tenantId', () => {
    const staleV2 = {
      version: 2,
      athletes: [
        {
          id: 'ath_1',
          displayName: 'Sarah',
          relation: 'child',
          createdAt: FIXED_NOW - 1000,
          updatedAt: FIXED_NOW - 1000,
        },
      ],
      activeAthleteId: 'ath_1',
      teams: [
        {
          id: 'tp_1',
          label: 'PVC',
          source: 'aes',
          sport: 'indoor',
          kind: 'me',
          aliases: ['PVC'],
          createdAt: FIXED_NOW - 1000,
          updatedAt: FIXED_NOW - 1000,
        },
      ],
      activeTeamId: 'tp_1',
      mrsLinked: false,
      cacLinked: false,
      createdAt: FIXED_NOW - 1000,
      updatedAt: FIXED_NOW - 1000,
    } as unknown as UserProfile;
    const patched = buildV2FromV1(staleV2, FIXED_NOW);
    expect(patched.tenantId).toBe(DEFAULT_TENANT_ID);
    expect(patched.athletes[0]!.tenantId).toBe(DEFAULT_TENANT_ID);
    expect(patched.teams[0]!.tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it('returns the same reference when v2 is already complete', () => {
    const completeV2: UserProfile = {
      version: 2,
      tenantId: DEFAULT_TENANT_ID,
      athletes: [
        {
          id: 'ath_1',
          tenantId: DEFAULT_TENANT_ID,
          displayName: 'Sarah',
          relation: 'child',
          createdAt: FIXED_NOW - 1000,
          updatedAt: FIXED_NOW - 1000,
        },
      ],
      activeAthleteId: 'ath_1',
      teams: [
        {
          id: 'tp_1',
          tenantId: DEFAULT_TENANT_ID,
          label: 'PVC',
          source: 'aes',
          sport: 'indoor',
          kind: 'me',
          aliases: ['PVC'],
          createdAt: FIXED_NOW - 1000,
          updatedAt: FIXED_NOW - 1000,
        },
      ],
      activeTeamId: 'tp_1',
      mrsLinked: false,
      cacLinked: false,
      createdAt: FIXED_NOW - 1000,
      updatedAt: FIXED_NOW - 1000,
    };
    expect(buildV2FromV1(completeV2, FIXED_NOW)).toBe(completeV2);
  });
});
