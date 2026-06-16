// End-to-end coverage for the clubs auto-backfill wired into the
// UserProfile migration. Two entry points must populate `clubs` and
// stamp `clubId` on the right teams: the v1→v2 build path, and the
// idempotent v2 short-circuit that catches stale-shape v2 profiles.
//
// The backfill is one-shot — gated on `clubsBackfilledAt` — so manual
// edits the user makes afterwards (renames, reassignments) survive
// subsequent loads.

import { describe, expect, it } from 'vitest';
import { buildV2FromV1 } from '../userProfileMigration';
import { DEFAULT_TENANT_ID } from '../tenant';
import type { TeamProfile, UserProfile, UserProfileV1 } from '../../types/profile';

const FIXED_NOW = 1_700_000_000_000;

function v1Team(id: string, label: string, kind: 'me' | 'watching' = 'me'): TeamProfile {
  return {
    id,
    tenantId: DEFAULT_TENANT_ID,
    label,
    source: 'aes',
    sport: 'indoor',
    kind,
    aliases: [label],
    createdAt: FIXED_NOW - 1000,
    updatedAt: FIXED_NOW - 1000,
  };
}

describe('buildV2FromV1 — clubs backfill on v1 path with me-teams', () => {
  it('creates clubs + stamps clubId on matching teams', () => {
    const v1: UserProfileV1 = {
      version: 1,
      displayName: 'Jon',
      role: 'parent',
      teams: [
        v1Team('tp_a', 'PVC 3D Royals U18'),
        v1Team('tp_b', 'PVC Mustangs 16U'),
        v1Team('tp_c', 'Defensa Rob'),
      ],
      activeTeamId: 'tp_a',
      mrsLinked: false,
      cacLinked: false,
      createdAt: FIXED_NOW - 1000,
      updatedAt: FIXED_NOW - 1000,
    };
    const v2 = buildV2FromV1(v1, FIXED_NOW);
    expect(v2.clubs).toHaveLength(2);
    expect(v2.clubsBackfilledAt).toBe(FIXED_NOW);

    const pvc = v2.clubs.find((c) => c.name === 'PVC')!;
    const defensa = v2.clubs.find((c) => c.name === 'Defensa')!;
    expect(v2.teams.find((t) => t.id === 'tp_a')!.clubId).toBe(pvc.id);
    expect(v2.teams.find((t) => t.id === 'tp_b')!.clubId).toBe(pvc.id);
    expect(v2.teams.find((t) => t.id === 'tp_c')!.clubId).toBe(defensa.id);
  });

  it('handles an empty teams list gracefully', () => {
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
    expect(v2.clubs).toEqual([]);
    expect(v2.clubsBackfilledAt).toBe(FIXED_NOW);
  });
});

describe('buildV2FromV1 — clubs backfill via v2 short-circuit', () => {
  it('backfills a stale v2 profile that was missing the clubs fields', () => {
    const staleV2 = {
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
        v1Team('tp_a', 'PVC 3D Royals U18'),
        v1Team('tp_b', 'Defensa Rob'),
      ],
      activeTeamId: 'tp_a',
      mrsLinked: false,
      cacLinked: false,
      createdAt: FIXED_NOW - 1000,
      updatedAt: FIXED_NOW - 1000,
    } as unknown as UserProfile;
    const patched = buildV2FromV1(staleV2, FIXED_NOW);
    expect(patched.clubs).toHaveLength(2);
    expect(patched.clubsBackfilledAt).toBe(FIXED_NOW);
    const pvc = patched.clubs.find((c) => c.name === 'PVC')!;
    expect(patched.teams.find((t) => t.id === 'tp_a')!.clubId).toBe(pvc.id);
  });

  it('does NOT re-run the backfill if clubsBackfilledAt is already set', () => {
    // User manually deleted the auto-detected PVC club. We must respect
    // that decision and not re-create it on the next load.
    const earlier = FIXED_NOW - 500;
    const userCurated: UserProfile = {
      version: 2,
      tenantId: DEFAULT_TENANT_ID,
      athletes: [],
      activeAthleteId: null,
      teams: [v1Team('tp_a', 'PVC U16')],
      activeTeamId: 'tp_a',
      clubs: [],
      clubsBackfilledAt: earlier,
      mrsLinked: false,
      cacLinked: false,
      createdAt: FIXED_NOW - 1000,
      updatedAt: FIXED_NOW - 1000,
    };
    const result = buildV2FromV1(userCurated, FIXED_NOW);
    expect(result.clubs).toEqual([]);
    expect(result.clubsBackfilledAt).toBe(earlier);
    // No clubId was forced onto the team either.
    expect(result.teams[0]!.clubId).toBeUndefined();
  });
});
