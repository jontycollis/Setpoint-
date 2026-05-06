// ── User Profile storage + legacy migration ───────────────────────────────
//
// This module owns the new `vbplus.userProfile.v1` AsyncStorage key.
// Phase 1 ships the data layer only — no UI consumes this yet, so the rest
// of the app continues reading the legacy `aes.myTeam` and
// `season.myTeamAliases.v1` keys until Phase 2 wires it up.
//
// The migration is split into a pure function (`buildProfileFromLegacy`)
// and an I/O wrapper (`loadOrMigrateUserProfile`) so the migration logic
// can be exercised without AsyncStorage. See
// `scripts/verifyUserProfileMigration.ts` for the verification pass.
// ────────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FavoriteTeam } from '../types/aes';
import type {
  UserProfile,
  UserProfileV1,
  TeamProfile,
  TeamProfileSource,
} from '../types/profile';
import { normalizeName, matchesAnyAlias } from './seasonTeamIdentity';
import { buildV2FromV1 } from './userProfileMigration';

// Re-export the pure helpers so callers that already import from
// './userProfile' don't need to change. The functions themselves live in
// `userProfileMigration.ts` so the migration logic is exercisable without
// pulling AsyncStorage into the test harness.
export {
  buildV2FromV1,
  makeAthleteProfileId,
  getActiveAthlete,
  getTeamsForAthlete,
} from './userProfileMigration';

// New storage key. Old keys (`aes.myTeam`, `season.myTeamAliases.v1`)
// remain in place during Phase 1 — they're cleaned up in Phase 2 once
// readers move over to UserProfile.
const PROFILE_KEY = 'vbplus.userProfile.v1';

// ── Pure helpers ──────────────────────────────────────────────────────────

/**
 * Build a stable-ish id for a TeamProfile. Phase 1 doesn't need
 * cryptographic randomness — collision risk on a single device with a
 * handful of teams is negligible. Format: `tp_<base36-time>_<random>`.
 */
export function makeTeamProfileId(now: number = Date.now()): string {
  const t = now.toString(36);
  const r = Math.floor(Math.random() * 1e9).toString(36);
  return `tp_${t}_${r}`;
}

/**
 * Map a legacy FavoriteTeam.source to the new TeamProfileSource.
 * Legacy values: undefined or 'aes' → 'aes', 'timu' → 'timu'.
 */
function legacyFavoriteToSource(
  fav: FavoriteTeam | null | undefined
): TeamProfileSource {
  if (!fav) return 'aes';
  return fav.source === 'timu' ? 'timu' : 'aes';
}

/**
 * Dedupe alias strings case-insensitively (using the existing
 * `normalizeName` so age-group markers don't produce duplicate entries),
 * preserving the original casing and ordering of the first occurrence.
 * Caps at 20 to match the legacy alias-list cap.
 */
export function dedupeAliases(aliases: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of aliases) {
    if (!a || typeof a !== 'string') continue;
    const trimmed = a.trim();
    if (!trimmed) continue;
    const key = normalizeName(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= 20) break;
  }
  return out;
}

// ── Migration (pure function) ─────────────────────────────────────────────

/**
 * Build a UserProfile from the legacy storage shape. Pure — no I/O.
 *
 * Cases handled (for the user's own team):
 *   1. legacyMyTeam present, aliases populated  → one TeamProfile, kind 'me'
 *   2. legacyMyTeam present, aliases empty      → one TeamProfile (label = team name, aliases = [team name])
 *   3. legacyMyTeam null, aliases populated     → one TeamProfile with no primaryRef
 *      (preserves filtering ability for SeasonHistory; user can claim a
 *       primaryRef later by tapping "use this as my home tournament")
 *   4. legacyMyTeam null, aliases empty         → no me-team
 *
 * Plus, every entry in legacyFavorites that doesn't match an existing
 * 'me' team becomes a separate TeamProfile with kind: 'watching'. The
 * dedup uses normalized name matching so "Defensa U18 Rob" + "Defensa Rob"
 * favorites collapse onto the user's own profile rather than producing
 * a redundant watching entry.
 *
 * Internally builds a v1-shape result and immediately upgrades it through
 * `buildV2FromV1`, so the caller always receives a v2 profile. This keeps
 * the legacy-keys → v2 path consistent with the v1-stored → v2 path.
 *
 * In every case, the resulting profile has:
 *   - version: 2
 *   - mrsLinked: false / cacLinked: false (no integrations yet)
 *   - migratedFromLegacyAt: now
 *   - migratedFromV1At: now (the v1→v2 step also runs in this path)
 *   - activeTeamId set to the migrated me-team's id (or null if none)
 *   - athletes: [<self athlete>] when an me-team was created, else []
 */
export function buildProfileFromLegacy(
  legacyMyTeam: FavoriteTeam | null,
  legacyAliases: string[],
  legacyFavorites: FavoriteTeam[] = [],
  now: number = Date.now()
): UserProfile {
  const teams: TeamProfile[] = [];

  if (legacyMyTeam) {
    // Case 1 & 2: we have a real bookmark. Aliases are the team name plus
    // anything the user accumulated globally (assumed all related — Phase 2
    // UI will let them split if they had multiple teams in the alias bucket).
    const id = makeTeamProfileId(now);
    const aliases = dedupeAliases([legacyMyTeam.teamName, ...legacyAliases]);
    teams.push({
      id,
      label: legacyMyTeam.teamName || 'My team',
      source: legacyFavoriteToSource(legacyMyTeam),
      kind: 'me',
      aliases,
      primaryRef: legacyMyTeam,
      createdAt: now,
      updatedAt: now,
    });
  } else if (legacyAliases.length > 0) {
    // Case 3: aliases without a MyTeam. Preserve them so SeasonHistory
    // filtering keeps working post-migration. The team has no primaryRef
    // (the dashboard tile will prompt the user to pick one).
    const id = makeTeamProfileId(now);
    const aliases = dedupeAliases(legacyAliases);
    teams.push({
      id,
      label: aliases[0] || 'My team',
      source: 'aes', // best guess; user can flip in Phase 2 if needed
      kind: 'me',
      aliases,
      // primaryRef intentionally omitted
      createdAt: now,
      updatedAt: now,
    });
  }
  // Case 4: nothing to migrate from MyTeam — me-team list stays empty.

  // ── Favorites → watching TeamProfiles ──────────────────────────────────
  //
  // Each legacyFavorite becomes a watching TeamProfile unless its name
  // normalizes onto an existing 'me' team's aliases (in which case the
  // favorite is just a duplicate bookmark and we ignore it). We also dedup
  // favorites against each other so the same team favorited twice across
  // different tournaments only produces one watching entry.
  const seenWatchingKeys = new Set<string>();
  for (const fav of legacyFavorites) {
    if (!fav || !fav.teamName) continue;

    // Skip if it matches the me-team we just created.
    const meTeam = teams[0];
    if (
      meTeam &&
      (matchesAnyAlias(fav.teamName, meTeam.aliases) ||
        matchesAnyAlias(fav.teamText || '', meTeam.aliases))
    ) {
      continue;
    }

    // Dedup watching entries by normalized team name.
    const dedupKey = normalizeName(fav.teamName);
    if (seenWatchingKeys.has(dedupKey)) continue;
    seenWatchingKeys.add(dedupKey);

    const id = makeTeamProfileId(now);
    teams.push({
      id,
      label: fav.teamText || fav.teamName,
      source: legacyFavoriteToSource(fav),
      kind: 'watching',
      aliases: dedupeAliases([fav.teamName, fav.teamText]),
      primaryRef: fav,
      createdAt: now,
      updatedAt: now,
    });
  }

  // activeTeamId points at the first 'me' team if one exists; otherwise
  // null even if there are watching teams (we don't auto-activate a
  // watching team).
  const firstMe = teams.find((t) => t.kind === 'me');
  const activeTeamId = firstMe?.id ?? null;

  const v1: UserProfileV1 = {
    version: 1,
    teams,
    activeTeamId,
    mrsLinked: false,
    cacLinked: false,
    createdAt: now,
    updatedAt: now,
    migratedFromLegacyAt: now,
  };
  return buildV2FromV1(v1, now);
}


// ── I/O wrapper (talks to AsyncStorage) ───────────────────────────────────

async function getJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function setJson(key: string, value: unknown): Promise<void> {
  try {
    if (value == null) {
      await AsyncStorage.removeItem(key);
    } else {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    /* ignore storage errors silently */
  }
}

/**
 * Load the persisted UserProfile, or build it from legacy keys on first call
 * and persist the result. Idempotent — second call returns the stored value.
 *
 * Phase 1: no UI calls this yet. Phase 2 wires it into App.tsx boot.
 *
 * Note: the legacy keys (`aes.myTeam`, `season.myTeamAliases.v1`) are NOT
 * deleted by this function. They remain in place because the rest of the
 * app still reads them. Phase 2 cleanup removes them once readers migrate.
 */
export async function loadOrMigrateUserProfile(): Promise<UserProfile> {
  // Persisted shape may be v1 (pre-multi-athlete) or v2. Read as the
  // discriminated union and branch on `version`.
  const existing = await getJson<UserProfileV1 | UserProfile | null>(
    PROFILE_KEY,
    null
  );

  if (existing && existing.version === 2) {
    // Already v2; return as-is. (Defensive activeAthleteId reset is
    // deferred to Phase 2 once athletes can actually be deleted; in
    // Phase 1 nothing in the app mutates the athletes array.)
    return existing;
  }

  if (existing && existing.version === 1) {
    // Forward-migrate v1 → v2 and persist the upgraded shape.
    const upgraded = buildV2FromV1(existing);
    await setJson(PROFILE_KEY, upgraded);
    return upgraded;
  }

  // First-time read — build from the original legacy keys (pre-v1).
  // `buildProfileFromLegacy` already produces a v2 profile via
  // `buildV2FromV1` internally.
  const [legacyMyTeam, legacyAliases, legacyFavorites] = await Promise.all([
    loadLegacyMyTeam(),
    loadLegacyAliases(),
    loadLegacyFavorites(),
  ]);
  const profile = buildProfileFromLegacy(
    legacyMyTeam,
    legacyAliases,
    legacyFavorites
  );
  await setJson(PROFILE_KEY, profile);
  return profile;
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  const stamped: UserProfile = {
    ...profile,
    updatedAt: Date.now(),
  };
  return setJson(PROFILE_KEY, stamped);
}

/**
 * Read the persisted UserProfile without triggering migration. Returns null
 * if nothing has been written yet. Useful for diagnostics and tests; most
 * callers should use `loadOrMigrateUserProfile`.
 */
export async function peekUserProfile(): Promise<UserProfile | null> {
  return getJson<UserProfile | null>(PROFILE_KEY, null);
}

/** TEST/DIAG ONLY — wipe the persisted profile. */
export async function _resetUserProfileForTests(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PROFILE_KEY);
  } catch {
    /* ignore */
  }
}

// ── Legacy reads (kept local so Phase 4+ can delete them in one spot) ─────

const LEGACY_MY_TEAM_KEY = 'aes.myTeam';
const LEGACY_ALIASES_KEY = 'season.myTeamAliases.v1';
const LEGACY_FAVORITES_KEY = 'aes.favoriteTeams';

async function loadLegacyMyTeam(): Promise<FavoriteTeam | null> {
  return getJson<FavoriteTeam | null>(LEGACY_MY_TEAM_KEY, null);
}

async function loadLegacyAliases(): Promise<string[]> {
  const raw = await getJson<unknown>(LEGACY_ALIASES_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === 'string');
}

async function loadLegacyFavorites(): Promise<FavoriteTeam[]> {
  const raw = await getJson<unknown>(LEGACY_FAVORITES_KEY, []);
  if (!Array.isArray(raw)) return [];
  // Defensive shape filter — every favorite needs at minimum a teamName.
  return raw.filter(
    (f): f is FavoriteTeam =>
      !!f &&
      typeof f === 'object' &&
      typeof (f as FavoriteTeam).teamName === 'string' &&
      ((f as FavoriteTeam).teamName as string).length > 0
  );
}
