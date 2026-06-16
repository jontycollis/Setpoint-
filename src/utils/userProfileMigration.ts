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
  Club,
  TeamProfile,
  UserProfile,
  UserProfileV1,
} from '../types/profile';
import { DEFAULT_TENANT_ID } from './tenant';
import { detectClubsFromTeams } from './clubDetection';

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
 * v2 ship. Currently fills in:
 *   • `sport: 'indoor'` for profiles created before beach support landed
 *   • `tenantId: DEFAULT_TENANT_ID` for profiles created before multi-tenant
 *
 * Pure / idempotent — returns the same reference when no patch is needed
 * so a no-op load doesn't churn updatedAt downstream.
 */
export function ensureTeamProfileShape(team: TeamProfile): TeamProfile {
  let patched = team;
  if (patched.sport !== 'indoor' && patched.sport !== 'beach') {
    patched = { ...patched, sport: 'indoor' };
  }
  if (typeof patched.tenantId !== 'string' || patched.tenantId.length === 0) {
    patched = { ...patched, tenantId: DEFAULT_TENANT_ID };
  }
  return patched;
}

/**
 * Companion to ensureTeamProfileShape for AthleteProfile. Currently only
 * backfills tenantId — the v1→v2 migration produced AthleteProfiles
 * before multi-tenant landed.
 */
export function ensureAthleteProfileShape(
  athlete: AthleteProfile
): AthleteProfile {
  if (typeof athlete.tenantId === 'string' && athlete.tenantId.length > 0) {
    return athlete;
  }
  return { ...athlete, tenantId: DEFAULT_TENANT_ID };
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
  // `sport` and `tenantId` land on profiles that v2'd before those landed.
  // Athletes get their own backfill, and the top-level UserProfile.tenantId
  // gets defaulted. Skip the rebuild when nothing needs patching to avoid
  // churning updatedAt.
  if (legacy.version === 2) {
    const patchedTeams = legacy.teams.map(ensureTeamProfileShape);
    const patchedAthletes = legacy.athletes.map(ensureAthleteProfileShape);
    const teamsChanged = patchedTeams.some((t, i) => t !== legacy.teams[i]);
    const athletesChanged = patchedAthletes.some(
      (a, i) => a !== legacy.athletes[i]
    );
    const needsTenantId =
      typeof legacy.tenantId !== 'string' || legacy.tenantId.length === 0;
    const tenantId = needsTenantId ? DEFAULT_TENANT_ID : legacy.tenantId;
    const needsClubsField = !Array.isArray(legacy.clubs);

    // Auto-detect clubs the first time we see a v2 profile that's never
    // had the backfill run. Gated on `clubsBackfilledAt` so it's strictly
    // one-shot — subsequent loads keep whatever the user has curated.
    const clubsBackfill =
      legacy.clubsBackfilledAt == null
        ? runClubsBackfill(patchedTeams, tenantId, now)
        : null;
    const existingClubs = needsClubsField ? [] : legacy.clubs;
    const nextClubs = clubsBackfill
      ? [...existingClubs, ...clubsBackfill.clubs]
      : existingClubs;
    const nextTeams = clubsBackfill
      ? patchedTeams.map((t) =>
          clubsBackfill.assignments[t.id]
            ? { ...t, clubId: clubsBackfill.assignments[t.id]! }
            : t
        )
      : patchedTeams;
    const teamsAfterClubs = clubsBackfill ? nextTeams : patchedTeams;
    const finalTeamsChanged = teamsChanged || clubsBackfill !== null;

    if (
      !finalTeamsChanged &&
      !athletesChanged &&
      !needsTenantId &&
      !needsClubsField &&
      !clubsBackfill
    ) {
      return legacy;
    }
    return {
      ...legacy,
      teams: teamsAfterClubs,
      athletes: patchedAthletes,
      tenantId,
      clubs: nextClubs,
      clubsBackfilledAt: clubsBackfill
        ? now
        : (legacy.clubsBackfilledAt ?? undefined),
      updatedAt: now,
    };
  }

  const v1 = legacy as UserProfileV1;
  const hasMeTeams = v1.teams.some((t) => t.kind === 'me');

  if (!hasMeTeams) {
    const teams = v1.teams.map(ensureTeamProfileShape);
    const { teams: teamsWithClubs, clubs } = applyClubsBackfill(
      teams,
      DEFAULT_TENANT_ID,
      now
    );
    return {
      version: 2,
      tenantId: DEFAULT_TENANT_ID,
      displayName: v1.displayName,
      role: v1.role,
      athletes: [],
      activeAthleteId: null,
      teams: teamsWithClubs,
      activeTeamId: v1.activeTeamId,
      clubs,
      clubsBackfilledAt: now,
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
    tenantId: DEFAULT_TENANT_ID,
    displayName: v1.displayName ?? 'Me',
    relation: 'self',
    role: mapV1RoleToAthleteRole(v1.role),
    // v1 stored MRS link state on UserProfile (one account per
    // install). The multi-athlete model attaches MRS per-athlete, so
    // the legacy single-account state lands on the auto-created self
    // athlete. UserProfile.mrsLinked stays in sync as the
    // "any-athlete-linked" aggregate flag (used by the hamburger
    // subtitle). When a second athlete is added, their MRS can be
    // linked independently from AthletesScreen.
    mrsLinked: v1.mrsLinked ? true : undefined,
    mrsMemberId: v1.mrsMemberId,
    createdAt: now,
    updatedAt: now,
  };

  const teams: TeamProfile[] = v1.teams.map((t) =>
    ensureTeamProfileShape(t.kind === 'me' ? { ...t, athleteId: selfId } : t)
  );
  const { teams: teamsWithClubs, clubs } = applyClubsBackfill(
    teams,
    DEFAULT_TENANT_ID,
    now
  );

  return {
    version: 2,
    tenantId: DEFAULT_TENANT_ID,
    displayName: v1.displayName,
    role: v1.role,
    athletes: [selfAthlete],
    activeAthleteId: selfId,
    teams: teamsWithClubs,
    activeTeamId: v1.activeTeamId,
    clubs,
    clubsBackfilledAt: now,
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

// ── Clubs backfill helper (shared by v1→v2 and v2 short-circuit) ──────────

/**
 * Run the auto-detect club heuristic and return the resulting Club list
 * along with team-id → club-id assignments. Pure passthrough around
 * detectClubsFromTeams — kept here so the migration paths above don't
 * have to know about ClubDetectionResult's shape.
 *
 * Returns null when no clubs were detected (so callers can skip the
 * teams.map allocation).
 */
function runClubsBackfill(
  teams: TeamProfile[],
  tenantId: string,
  now: number
): { clubs: Club[]; assignments: Record<string, string> } | null {
  const result = detectClubsFromTeams(teams, tenantId, now);
  if (result.clubs.length === 0) return null;
  return result;
}

/**
 * v1→v2 convenience: run the backfill and apply assignments to the
 * teams in a single pass so the caller can drop both into the new v2
 * UserProfile literal.
 */
function applyClubsBackfill(
  teams: TeamProfile[],
  tenantId: string,
  now: number
): { teams: TeamProfile[]; clubs: Club[] } {
  const result = runClubsBackfill(teams, tenantId, now);
  if (!result) return { teams, clubs: [] };
  const next = teams.map((t) =>
    result.assignments[t.id] ? { ...t, clubId: result.assignments[t.id]! } : t
  );
  return { teams: next, clubs: result.clubs };
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
