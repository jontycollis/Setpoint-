// ── User Profile migration (pure helpers) ─────────────────────────────────
//
// This module is intentionally free of side effects so it can be exercised
// from a plain Node script without pulling in AsyncStorage. The
// AsyncStorage-aware orchestration lives in `userProfile.ts`, which
// re-exports a few names from here for caller convenience.
//
// Phase 1 of the multi-athlete restructure: introduce v2 shape (athletes
// array + activeAthleteId + TeamProfile.athleteId) and migrate v1 profiles
// forward. No UI consumes the new fields yet.
// ────────────────────────────────────────────────────────────────────────────

import type {
  AthleteProfile,
  TeamProfile,
  UserProfile,
  UserProfileV1,
} from '../types/profile';

// ── Id generation ─────────────────────────────────────────────────────────

/**
 * Build a stable-ish id for an AthleteProfile. Phase 1 doesn't need
 * cryptographic randomness — collision risk on a single device with a
 * handful of athletes is negligible. Format: `ath_<base36-time>_<random>`.
 */
export function makeAthleteProfileId(now: number = Date.now()): string {
  const t = now.toString(36);
  const r = Math.floor(Math.random() * 1e9).toString(36);
  return `ath_${t}_${r}`;
}

// ── TeamProfile shape backfill ────────────────────────────────────────────

/**
 * Ensure a TeamProfile has every field that's been added since the original
 * v2 ship. Currently fills in `sport: 'indoor'` for profiles created before
 * beach support landed — every existing profile is an indoor team, so the
 * default is safe. Pure / idempotent — returns the same reference when no
 * patch is needed so a no-op load doesn't churn updatedAt downstream.
 */
export function ensureTeamProfileShape(team: TeamProfile): TeamProfile {
  if (team.sport === 'indoor' || team.sport === 'beach') return team;
  return { ...team, sport: 'indoor' };
}

// ── v1 → v2 migration ─────────────────────────────────────────────────────

/**
 * Map a v1 `UserProfile.role` (account-holder relation to volleyball overall)
 * onto the auto-created self athlete's `role` field. Per design doc §1.3:
 *   'athlete' → 'athlete'
 *   'coach'   → 'coach'
 *   anything else (including 'parent', 'other', or undefined) → undefined
 */
function mapV1RoleToAthleteRole(
  role: UserProfileV1['role']
): AthleteProfile['role'] | undefined {
  if (role === 'athlete') return 'athlete';
  if (role === 'coach') return 'coach';
  return undefined;
}

/**
 * Pure migration from v1 → v2 shape. Idempotent at the call-site level: if
 * the input already has `version === 2` it's returned unchanged (cast).
 * This lets callers run it unconditionally without an external version
 * check.
 *
 * Algorithm (per multi-athlete-design.md §1.3):
 *
 *   - If the v1 profile has any kind === 'me' team: auto-create one
 *     `relation: 'self'` AthleteProfile, displayName = profile.displayName
 *     ?? 'Me', role mapped per `mapV1RoleToAthleteRole`. Tag every 'me'
 *     team with its id. activeAthleteId = newSelfAthlete.id.
 *
 *   - If the v1 profile has zero 'me' teams (watching-only or empty):
 *     athletes = [], activeAthleteId = null. No anchor needed; the next
 *     'me' team add (Phase 2) will trigger the new-install athlete-create
 *     flow.
 *
 *   - Watching teams keep `athleteId` undefined (account-holder-scoped).
 *
 *   - migratedFromV1At = now; version = 2. Other v1 fields (mrsLinked,
 *     coach, displayName, role, etc.) are carried forward unchanged.
 */
export function buildV2FromV1(
  legacy: UserProfileV1 | UserProfile,
  now: number = Date.now()
): UserProfile {
  // Already v2 — still run the team-shape backfill so additive fields like
  // `sport` land on profiles that v2'd before beach support shipped. Skip
  // the rebuild when no team needs patching to avoid churning updatedAt.
  if (legacy.version === 2) {
    const patched = legacy.teams.map(ensureTeamProfileShape);
    const changed = patched.some((t, i) => t !== legacy.teams[i]);
    return changed ? { ...legacy, teams: patched, updatedAt: now } : legacy;
  }

  const v1 = legacy as UserProfileV1;
  const hasMeTeams = v1.teams.some((t) => t.kind === 'me');

  if (!hasMeTeams) {
    return {
      version: 2,
      displayName: v1.displayName,
      role: v1.role,
      athletes: [],
      activeAthleteId: null,
      teams: v1.teams.map(ensureTeamProfileShape),
      activeTeamId: v1.activeTeamId,
      mrsLinked: v1.mrsLinked,
      mrsMemberId: v1.mrsMemberId,
      cacLinked: v1.cacLinked,
      coach: v1.coach,
      createdAt: v1.createdAt,
      updatedAt: now,
      migratedFromLegacyAt: v1.migratedFromLegacyAt,
      migratedFromV1At: now,
    };
  }

  const selfId = makeAthleteProfileId(now);
  const selfAthlete: AthleteProfile = {
    id: selfId,
    displayName: v1.displayName ?? 'Me',
    relation: 'self',
    role: mapV1RoleToAthleteRole(v1.role),
    createdAt: now,
    updatedAt: now,
  };

  const teams: TeamProfile[] = v1.teams.map((t) =>
    ensureTeamProfileShape(t.kind === 'me' ? { ...t, athleteId: selfId } : t)
  );

  return {
    version: 2,
    displayName: v1.displayName,
    role: v1.role,
    athletes: [selfAthlete],
    activeAthleteId: selfId,
    teams,
    activeTeamId: v1.activeTeamId,
    mrsLinked: v1.mrsLinked,
    mrsMemberId: v1.mrsMemberId,
    cacLinked: v1.cacLinked,
    coach: v1.coach,
    createdAt: v1.createdAt,
    updatedAt: now,
    migratedFromLegacyAt: v1.migratedFromLegacyAt,
    migratedFromV1At: now,
  };
}

// ── Athlete look-ups (downstream consumers — Phase 2 UI will call these) ──

/**
 * Return the active AthleteProfile, or null if `activeAthleteId` is unset
 * or doesn't resolve. Phase 2 callers will lean on this; Phase 1 ships it
 * so it's available the moment UI work begins.
 */
export function getActiveAthlete(profile: UserProfile): AthleteProfile | null {
  if (!profile.activeAthleteId) return null;
  return (
    profile.athletes.find((a) => a.id === profile.activeAthleteId) ?? null
  );
}

/**
 * Return every TeamProfile attached to the given athlete (i.e. kind === 'me'
 * with matching athleteId). Watching teams are never returned — they're
 * account-holder-scoped and don't belong to any athlete.
 */
export function getTeamsForAthlete(
  profile: UserProfile,
  athleteId: string
): TeamProfile[] {
  return profile.teams.filter(
    (t) => t.kind === 'me' && t.athleteId === athleteId
  );
}
