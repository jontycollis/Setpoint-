// ── Per-athlete MRS link state ────────────────────────────────────────────
//
// Today's reality: a parent with three kids has three separate OVA MRS
// accounts (one per child, in the child's name). Pre-#19, the app
// tracked a single account-holder-scoped MRS link. This module models
// MRS state per AthleteProfile so the same install can hold multiple
// linked accounts.
//
// Honest limitation: the underlying WebView shares a cookie jar across
// athletes. Switching the active athlete doesn't re-authenticate; the
// last-active MRS session sticks until the user signs out inside the
// web view. The Bior plan calls this out — full per-athlete OAuth flows
// land during the OVA digital transformation. For now we track link
// metadata + give the user a clear "which athlete am I connecting"
// picker, even if the actual cookies are shared.
//
// All functions are pure — they read/transform UserProfile shapes
// without touching storage. AsyncStorage persistence lives in App.tsx /
// userProfile.ts as usual.
// ──────────────────────────────────────────────────────────────────────────

import type { AthleteProfile, UserProfile } from '../types/profile';

/**
 * Resolve which AthleteProfile a future MRS link/disconnect should
 * mutate. Priority:
 *   1) The currently-active athlete (if any).
 *   2) A self-relation athlete (any).
 *   3) The first athlete by createdAt.
 *   4) null when the user has no athletes — caller falls back to the
 *      legacy account-holder fields on UserProfile.
 */
export function resolveMrsTargetAthlete(
  profile: UserProfile
): AthleteProfile | null {
  if (profile.activeAthleteId) {
    const active = profile.athletes.find(
      (a) => a.id === profile.activeAthleteId
    );
    if (active) return active;
  }
  const selfAthlete = profile.athletes.find((a) => a.relation === 'self');
  if (selfAthlete) return selfAthlete;
  return profile.athletes[0] ?? null;
}

/**
 * Aggregate "any athlete linked" flag for surfaces (hamburger
 * subtitle, splash) that just need a single yes/no. Falls back to
 * UserProfile.mrsLinked for legacy / no-athlete installs.
 */
export function anyAthleteMrsLinked(profile: UserProfile): boolean {
  if (profile.athletes.some((a) => a.mrsLinked)) return true;
  return !!profile.mrsLinked;
}

/**
 * Count how many athletes have MRS linked. Used by AthletesScreen for
 * the per-athlete badge and the connection screen's "switch athlete"
 * hint.
 */
export function countMrsLinkedAthletes(profile: UserProfile): number {
  return profile.athletes.filter((a) => a.mrsLinked).length;
}

/**
 * Apply an MRS connect event to the profile — flip the link flag on
 * the target athlete (and back-fill the legacy UserProfile flag so
 * existing readers stay green). Returns a NEW UserProfile; caller
 * persists.
 *
 * When `targetAthleteId` is null and the profile has no athletes,
 * falls back to the account-holder fields (matches pre-#19 behavior).
 */
export function applyMrsConnect(
  profile: UserProfile,
  targetAthleteId: string | null,
  now: number = Date.now()
): UserProfile {
  if (!targetAthleteId || profile.athletes.length === 0) {
    return { ...profile, mrsLinked: true, updatedAt: now };
  }
  const nextAthletes = profile.athletes.map((a) =>
    a.id === targetAthleteId
      ? { ...a, mrsLinked: true, updatedAt: now }
      : a
  );
  return {
    ...profile,
    athletes: nextAthletes,
    // Aggregate flag — stays "true if any athlete is linked" so
    // hamburger subtitles read correctly.
    mrsLinked: nextAthletes.some((a) => a.mrsLinked) || !!profile.mrsLinked,
    updatedAt: now,
  };
}

/**
 * Apply an MRS disconnect to the target athlete. Mirror of
 * applyMrsConnect — strips both `mrsLinked` and `mrsMemberId` on the
 * target. The aggregate UserProfile.mrsLinked is recomputed across
 * remaining athletes.
 */
export function applyMrsDisconnect(
  profile: UserProfile,
  targetAthleteId: string | null,
  now: number = Date.now()
): UserProfile {
  if (!targetAthleteId || profile.athletes.length === 0) {
    return {
      ...profile,
      mrsLinked: false,
      mrsMemberId: undefined,
      updatedAt: now,
    };
  }
  const nextAthletes = profile.athletes.map((a) => {
    if (a.id !== targetAthleteId) return a;
    const { mrsMemberId: _drop, ...rest } = a;
    return { ...rest, mrsLinked: false, updatedAt: now };
  });
  const anyLinked = nextAthletes.some((a) => a.mrsLinked);
  return {
    ...profile,
    athletes: nextAthletes,
    // Recompute the aggregate. If no athlete is linked AND nothing on
    // the account-holder fallback path, the surface flips back to "no".
    mrsLinked: anyLinked,
    // Account-holder fallback fields clear only when the target was
    // the implicit account-holder (no athletes), which we've already
    // covered above.
    updatedAt: now,
  };
}
