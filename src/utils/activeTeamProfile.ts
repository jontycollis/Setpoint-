// ── activeTeamProfile ─────────────────────────────────────────────────────
//
// Thin glue between the new UserProfile model (src/types/profile.ts) and
// the legacy "single MyTeam" plumbing the rest of the app still reads.
//
// Two responsibilities:
//
//   1. Look up the active TeamProfile inside a UserProfile.
//   2. Keep UserProfile and legacy `myTeam` in lockstep — when the user
//      taps "Set as My Team" anywhere in the app, we both update legacy
//      `aes.myTeam` (so existing screens stay correct) AND find/create a
//      matching TeamProfile and set it as active. When they switch
//      teams via the new HamburgerMenu team-switcher, the same thing
//      happens in reverse.
//
// All functions are pure where possible — caller persists the resulting
// UserProfile via `saveUserProfile`.
// ────────────────────────────────────────────────────────────────────────────

import type { FavoriteTeam } from '../types/aes';
import type {
  UserProfile,
  TeamProfile,
  TeamProfileSource,
  TeamProfileKind,
} from '../types/profile';
import { matchesAnyAlias, normalizeName } from './seasonTeamIdentity';
import { dedupeAliases, makeTeamProfileId } from './userProfile';
import { DEFAULT_TENANT_ID } from './tenant';

// ── Look-ups ──────────────────────────────────────────────────────────────

/** Return the active TeamProfile, or null if no team is active. */
export function getActiveTeam(profile: UserProfile): TeamProfile | null {
  if (!profile.activeTeamId) return null;
  return profile.teams.find((t) => t.id === profile.activeTeamId) ?? null;
}

/** Find a TeamProfile by id. */
export function getTeamById(
  profile: UserProfile,
  id: string
): TeamProfile | null {
  return profile.teams.find((t) => t.id === id) ?? null;
}

/**
 * Find an existing TeamProfile that should "claim" the given FavoriteTeam.
 * The match strategy mirrors how cross-source matching already works in
 * `unifiedSeasonHistory`: any alias-match against the favorite's
 * teamName/teamText counts.
 *
 * Returns the matched profile or null if no profile claims it.
 */
export function findMatchingTeamProfile(
  profile: UserProfile,
  fav: FavoriteTeam
): TeamProfile | null {
  const candidateNames = [fav.teamName, fav.teamText].filter(Boolean);
  for (const team of profile.teams) {
    const aliases = team.aliases.length ? team.aliases : [team.label];
    for (const name of candidateNames) {
      if (matchesAnyAlias(name, aliases)) return team;
    }
  }
  return null;
}

// ── Mutations ─────────────────────────────────────────────────────────────

function favoriteSourceToTeamProfileSource(
  fav: FavoriteTeam
): TeamProfileSource {
  return fav.source === 'timu' ? 'timu' : 'aes';
}

/**
 * Switch the active team. No-op if `id` doesn't exist in the profile.
 */
export function setActiveTeamId(
  profile: UserProfile,
  id: string | null,
  now: number = Date.now()
): UserProfile {
  if (id != null && !profile.teams.some((t) => t.id === id)) return profile;
  if (profile.activeTeamId === id) return profile;
  return { ...profile, activeTeamId: id, updatedAt: now };
}

/**
 * Ensure a TeamProfile exists for the given FavoriteTeam. If a matching
 * profile is found, its `primaryRef` is updated and any new alias forms
 * absorbed. If no profile matches, a new TeamProfile is appended.
 *
 * The returned profile has the upserted team set as `activeTeamId`.
 *
 * `kind` defaults to 'me' for fresh creations; an existing matched
 * profile keeps its current kind unless the caller forces an override.
 */
export function upsertTeamProfileForFavorite(
  profile: UserProfile,
  fav: FavoriteTeam,
  options: {
    kind?: TeamProfileKind;
    /** If true, overwrite the matched profile's kind instead of preserving it. */
    forceKind?: boolean;
    now?: number;
  } = {}
): { profile: UserProfile; teamId: string } {
  const now = options.now ?? Date.now();
  const matched = findMatchingTeamProfile(profile, fav);

  if (matched) {
    // Update primaryRef + aliases on the matched profile.
    const aliases = dedupeAliases([
      ...matched.aliases,
      fav.teamName,
      fav.teamText,
    ]);
    const next: TeamProfile = {
      ...matched,
      primaryRef: fav,
      aliases,
      kind: options.forceKind && options.kind ? options.kind : matched.kind,
      // If the matched profile was AES-only and we just bound a Timu fav
      // (or vice-versa), bump it to 'mixed' for the Team Hub badge.
      source: deriveSourceTransition(
        matched.source,
        favoriteSourceToTeamProfileSource(fav)
      ),
      updatedAt: now,
    };
    const teams = profile.teams.map((t) => (t.id === matched.id ? next : t));
    return {
      profile: {
        ...profile,
        teams,
        activeTeamId: matched.id,
        updatedAt: now,
      },
      teamId: matched.id,
    };
  }

  // No match — create a new TeamProfile.
  const id = makeTeamProfileId(now);
  const aliases = dedupeAliases([fav.teamName, fav.teamText]);
  const created: TeamProfile = {
    id,
    tenantId: DEFAULT_TENANT_ID,
    label: fav.teamName || aliases[0] || 'My team',
    source: favoriteSourceToTeamProfileSource(fav),
    sport: 'indoor',
    kind: options.kind ?? 'me',
    aliases,
    primaryRef: fav,
    createdAt: now,
    updatedAt: now,
  };
  return {
    profile: {
      ...profile,
      teams: [...profile.teams, created],
      activeTeamId: id,
      updatedAt: now,
    },
    teamId: id,
  };
}

/**
 * Compute the 'source' field after a new favorite ties into a profile.
 * 'mixed' if the new source disagrees with an existing 'aes' or 'timu'
 * profile; otherwise unchanged.
 */
function deriveSourceTransition(
  existing: TeamProfileSource,
  incoming: TeamProfileSource
): TeamProfileSource {
  if (existing === 'mrs-linked') return existing;
  if (existing === 'mixed') return existing;
  if (existing === incoming) return existing;
  // existing is 'aes' or 'timu' and incoming differs.
  if (
    (existing === 'aes' && incoming === 'timu') ||
    (existing === 'timu' && incoming === 'aes')
  ) {
    return 'mixed';
  }
  return existing;
}

/**
 * Like `upsertTeamProfileForFavorite` but tailored for the "track this
 * team" / favorite-style add path: never changes activeTeamId, never
 * promotes a watching team to a 'me' team, and does nothing if the team
 * already matches an existing 'me' team (the user already owns it).
 *
 * Returns the updated profile and the team id that was upserted (or null
 * if no upsert happened — e.g. duplicate of a 'me' team).
 */
export function addWatchingTeamProfile(
  profile: UserProfile,
  fav: FavoriteTeam,
  now: number = Date.now()
): { profile: UserProfile; teamId: string | null } {
  const matched = findMatchingTeamProfile(profile, fav);
  if (matched && matched.kind === 'me') {
    // Already a me-team — favoriting is redundant. Don't duplicate.
    return { profile, teamId: null };
  }
  if (matched && matched.kind === 'watching') {
    // Refresh aliases + primaryRef on the existing watching profile.
    const aliases = dedupeAliases([
      ...matched.aliases,
      fav.teamName,
      fav.teamText,
    ]);
    const next: TeamProfile = {
      ...matched,
      primaryRef: fav,
      aliases,
      source: deriveSourceTransition(
        matched.source,
        favoriteSourceToTeamProfileSource(fav)
      ),
      updatedAt: now,
    };
    return {
      profile: {
        ...profile,
        teams: profile.teams.map((t) => (t.id === matched.id ? next : t)),
        updatedAt: now,
      },
      teamId: matched.id,
    };
  }

  // New watching team — append, do NOT change activeTeamId.
  const id = makeTeamProfileId(now);
  const aliases = dedupeAliases([fav.teamName, fav.teamText]);
  const created: TeamProfile = {
    id,
    tenantId: DEFAULT_TENANT_ID,
    label: fav.teamName || aliases[0] || 'Tracked team',
    source: favoriteSourceToTeamProfileSource(fav),
    sport: 'indoor',
    kind: 'watching',
    aliases,
    primaryRef: fav,
    createdAt: now,
    updatedAt: now,
  };
  return {
    profile: {
      ...profile,
      teams: [...profile.teams, created],
      updatedAt: now,
    },
    teamId: id,
  };
}

/**
 * Remove a TeamProfile by id. If the removed team was the active one,
 * activeTeamId is reassigned to the first remaining team (or null if
 * no teams remain).
 */
export function removeTeamProfile(
  profile: UserProfile,
  id: string,
  now: number = Date.now()
): UserProfile {
  const teams = profile.teams.filter((t) => t.id !== id);
  if (teams.length === profile.teams.length) return profile; // no-op
  let activeTeamId = profile.activeTeamId;
  if (activeTeamId === id) {
    activeTeamId = teams[0]?.id ?? null;
  }
  return { ...profile, teams, activeTeamId, updatedAt: now };
}

/**
 * Update a TeamProfile's `kind` ('me' vs 'watching') without otherwise
 * touching it.
 */
export function setTeamKind(
  profile: UserProfile,
  id: string,
  kind: TeamProfileKind,
  now: number = Date.now()
): UserProfile {
  const teams = profile.teams.map((t) =>
    t.id === id ? { ...t, kind, updatedAt: now } : t
  );
  return { ...profile, teams, updatedAt: now };
}

// ── Convenience for tests / external diagnostics ──────────────────────────

/** Number of teams marked kind === 'me' (i.e. count toward Career rollup). */
export function countMyTeams(profile: UserProfile): number {
  return profile.teams.filter((t) => t.kind === 'me').length;
}

/** Sort teams: active first, then 'me' before 'watching', newest createdAt next. */
export function sortedTeamsForDisplay(
  profile: UserProfile
): TeamProfile[] {
  const out = [...profile.teams];
  out.sort((a, b) => {
    if (a.id === profile.activeTeamId) return -1;
    if (b.id === profile.activeTeamId) return 1;
    if (a.kind !== b.kind) return a.kind === 'me' ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
  return out;
}

/** Stable, normalized label for cross-source dedup. */
export function teamProfileNormalizedLabel(team: TeamProfile): string {
  return normalizeName(team.label || team.aliases[0] || '');
}
