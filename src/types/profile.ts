// ── User Profile / Team Profile ───────────────────────────────────────────
//
// VBPlus has shifted from "tournament viewer with a single MyTeam bookmark"
// to "athlete or parent's home, with one or more teams attached". This file
// defines the persistent shape of that home.
//
// The single global `aes.myTeam` (FavoriteTeam | null) and the single global
// alias list (`season.myTeamAliases.v1: string[]`) are subsumed by:
//   - UserProfile        (one per device install, lives at vbplus.userProfile.v1)
//   - TeamProfile[]      (each is one roster — typically one per season)
//
// The `source` union explicitly reserves `'mrs-linked'` from day one so that
// the future OVA MRS OAuth integration plugs in without a type-level shift —
// the populator just produces `TeamProfile` records with `source: 'mrs-linked'`
// and the rest of the app keeps working. The CAC Locker reservations (see
// CoachCredentials below + cacLinked + coach? on UserProfile, plus coachRef?
// on TeamProfile) follow the same plug-in pattern: types reserved now, no
// runtime behaviour today, populator + UI ship together in a later phase.
// ────────────────────────────────────────────────────────────────────────────

import type { FavoriteTeam } from './aes';

// ── Source tagging ────────────────────────────────────────────────────────
//
// 'aes'         — team profile created from an AES-sourced tournament
// 'timu'        — team profile created from a Timu-sourced tournament
// 'mixed'       — team profile that has appeared in both AES and Timu
//                 events (set automatically once the second source matches
//                 via aliases). Useful for the Team Hub badge.
// 'mrs-linked'  — team profile populated by the future OVA MRS integration.
//                 Reserved as a first-class option NOW so swapping in the
//                 OAuth-backed populator later is purely additive.
export type TeamProfileSource = 'aes' | 'timu' | 'mixed' | 'mrs-linked';

// 'me'       — user (or their child) is/was on this team. Counts in Career.
// 'watching' — favorite-style follow only; excluded from Career rollups.
export type TeamProfileKind = 'me' | 'watching';

// Optional self-identification of role. Drives copy ("Welcome back, Sarah"
// vs nothing) and ordering decisions. Never required.
export type ProfileRole = 'athlete' | 'parent' | 'coach' | 'other';

// ── TeamProfile ───────────────────────────────────────────────────────────
//
// One per "roster" — i.e. one per (team, season) pair. The legacy migration
// produces exactly one of these, even if the user had aliases for several
// historical teams; Phase 2+ UI lets the user split aliases across teams.
export interface TeamProfile {
  /** Stable id, e.g. `tp_<random>` or `mrs:<memberId>:<rosterId>` for MRS. */
  id: string;
  /** User-editable display label, e.g. "Defensa U18 Rob 2025-26". */
  label: string;
  /** Which integration produced this profile (or that it merges multiple). */
  source: TeamProfileSource;
  /** Whether this team rolls up into the Career view. Defaults to 'me'. */
  kind: TeamProfileKind;
  /**
   * The athlete this team belongs to. Set when kind === 'me'; absent when
   * kind === 'watching' (watching is account-holder-scoped). v1 → v2
   * migration tags every existing 'me' team with the auto-created self
   * athlete's id.
   */
  athleteId?: string;
  /**
   * Names the team has gone by across snapshots (Timu/AES + spelling drift).
   * Replaces the global `season.myTeamAliases.v1` list — now scoped per team.
   */
  aliases: string[];
  /**
   * Canonical pointer for "open this team's dashboard". Carries source/eventKey/
   * teamId for AES or source='timu'+lastTid for Timu. Optional because the
   * legacy migration may produce a profile that has aliases but no
   * persisted MyTeam (rare, but possible).
   */
  primaryRef?: FavoriteTeam;

  // ── Display / sorting metadata (all optional) ──────────────────────────
  ageGroup?: string;             // "U18", "12U"
  gender?: 'girls' | 'boys';
  club?: string;                 // "Defensa", "Pakmen"
  seasonLabel?: string;          // "2025-26"
  /** Epoch ms when the team's first tournament occurred. */
  startedAt?: number;
  /** Epoch ms when the user stopped on this team. Null = current. */
  endedAt?: number | null;

  // ── Bookkeeping ────────────────────────────────────────────────────────
  createdAt: number;
  updatedAt: number;
  /**
   * Epoch ms of the last successful auto-discovery for this team (the
   * AES + Timu scan that populates SeasonHistory). Surfaced as a
   * "Last synced X ago" badge so users know whether their season
   * history is fresh or whether they should hit "Find more tournaments".
   */
  lastDiscoveryAt?: number;

  // ── Tier 2 scoring (reserved fields, no editor UI yet) ─────────────────
  /**
   * Player roster for this team. Used by the official-scorer flow to
   * pre-fill lineup and substitution pickers. Editor screen lands in
   * Session D of the Tier 2 build; the field is reserved here so any
   * data captured during early manual entry persists across the rollout.
   */
  roster?: import('./match').RosterPlayer[];
  rosterUpdatedAt?: number;

  // ── Reserved for OVA MRS (future) ──────────────────────────────────────
  // Today these are never set. The MRS populator will fill them when shipped;
  // the type carries them now so swapping the populator in is additive.
  /** MRS roster identifier (per-season). */
  mrsRosterId?: string;
  /** Member's role on this roster as MRS reports it. */
  mrsMemberRole?: 'athlete' | 'coach' | 'assistant-coach' | 'parent' | 'other';
  /** Epoch ms when the MRS data was last refreshed for this team. */
  mrsRefreshedAt?: number;

  // ── Reserved for CAC Locker (future) ───────────────────────────────────
  /**
   * If known, the team's coach's reference into The Locker. Lets a viewer
   * verify the coach's NCCP standing via the public transcript endpoint
   * (`thelocker.coach.ca/access/account/public`) without the coach having
   * to link their own account. The NCCP # is sufficient for lookup; the
   * last name is required by the public verifier, so we cache it here when
   * available. Populated by future TeamProfile editor / MRS roster import.
   */
  coachRef?: {
    nccpNumber: string;
    lastNameInLocker?: string;
    displayName?: string;
  };
}

// ── CAC Locker (future, reserved) ─────────────────────────────────────────
//
// Per-PERSON coaching credentials. Hangs off UserProfile (not TeamProfile)
// because The Locker is keyed on the human, not the team. A single coach's
// certifications apply across every team they coach.
//
// Three populator paths are reserved by the `source` discriminant:
//   'public-transcript' — looked up via the public verifier (NCCP # + last
//                         name, no auth). Limited surface but cheapest.
//   'webview'           — coach signs into Locker in-app; we read their
//                         certifications page. Same posture as MRS WebView.
//   'cac-linked'        — sanctioned OAuth/partner API (future, requires CAC).
export interface CoachCredentials {
  nccpNumber: string;
  /** Last name as stored in The Locker — required for public-transcript lookups. */
  lastNameInLocker?: string;
  /** Display name as Locker reports it. */
  displayName?: string;
  certifications?: LockerCertification[];
  modules?: LockerModule[];
  source: 'public-transcript' | 'webview' | 'cac-linked';
  refreshedAt: number;
}

export interface LockerCertification {
  /** "Volleyball — Club Coach", "Volleyball — Performance Coach", etc. */
  context: string;
  status: 'in-training' | 'trained' | 'certified';
  achievedAt?: number;
  expiresAt?: number;
}

export interface LockerModule {
  /** "Safe Sport Training", "Make Ethical Decisions", "Making Headway: Concussion", etc. */
  name: string;
  status: 'pending' | 'completed' | 'expired';
  completedAt?: number;
  expiresAt?: number;
}

// ── AthleteProfile ────────────────────────────────────────────────────────
//
// An explicitly-added linked person whose teams we track. Sibling of
// UserProfile — the account holder (parent / coach) is *not* implicitly an
// athlete; if they also play or coach a team they care about, they add
// themselves with `relation: 'self'`. The v1 → v2 migration auto-creates
// one 'self' athlete to anchor any existing 'me' teams (see
// `userProfile.ts` / `userProfileMigration.ts`).
//
// Per-athlete MRS / CAC fields are reserved here; v1 ships with all such
// state on UserProfile (account-holder-scoped). A future per-child-MRS or
// older-sibling-coach world fills these in.
export interface AthleteProfile {
  /** Stable id, e.g. `ath_<base36-time>_<random>`. */
  id: string;

  /** Display label — "Sarah", "Emily", "Me". Required. */
  displayName: string;

  /**
   *   'self'  — the account holder added themselves (they also play/coach)
   *   'child' — the account holder's child
   *   'other' — niece, friend, sibling, etc.
   * At most one 'self' entry exists at a time (Phase 2 enforces).
   */
  relation: 'self' | 'child' | 'other';

  /**
   * What this athlete *does* on their teams. Distinct from
   * UserProfile.role (the account holder's relation to volleyball overall).
   */
  role?: 'athlete' | 'coach' | 'assistant-coach' | 'other';

  // ── Per-athlete MRS (reserved, future) ───────────────────────────────
  /** Reserved. v1 stores MRS state on UserProfile.mrsMemberId. */
  mrsMemberId?: string;
  mrsLinked?: boolean;

  // ── Per-athlete CAC (reserved, future) ───────────────────────────────
  /** Reserved. UserProfile.coach remains the account holder's in v1. */
  coach?: CoachCredentials;

  // ── Optional metadata ────────────────────────────────────────────────
  primaryAgeGroup?: string;
  /** Avatar emoji or single-character initials override. No image upload v1. */
  avatar?: string;

  createdAt: number;
  updatedAt: number;
}

// ── UserProfile ───────────────────────────────────────────────────────────
//
// One per device install. Persisted at `vbplus.userProfile.v1` (storage key
// is unchanged across schema versions; the `version` field on the value
// discriminates). Migration from legacy keys is lazy —
// `loadOrMigrateUserProfile()` builds this on first call.
//
// The shape is "parent-as-identity": this record describes the account
// holder using the device. Linked athletes live in a sibling
// `AthleteProfile[]` collection. If the account holder also plays or
// coaches their own team, they add themselves explicitly as
// `relation: 'self'`.
export interface UserProfile {
  /**
   * Schema version. v1 had a single user (no athletes array); v2 introduces
   * `athletes` + `activeAthleteId` + `TeamProfile.athleteId`. v1 readers
   * must run buildV2FromV1().
   */
  version: 2;

  // ── Optional identity ──────────────────────────────────────────────────
  // Both optional. UI falls back to a generic "My career" header when
  // displayName is unset and skips role-based copy when role is unset.
  // Never block boot or onboarding on these fields.
  displayName?: string;
  role?: ProfileRole;

  // ── Athletes (explicit additions only) ────────────────────────────────
  /**
   * Every linked person whose teams we track. May be empty (brand-new
   * install with no athletes added yet, or post-migration with zero
   * 'me' teams). The account holder is NOT implicitly here.
   */
  athletes: AthleteProfile[];
  /**
   * Which athlete is the current navigation context. Null when athletes
   * is empty. Phase 2 UI defaults to athletes[0]?.id if the persisted
   * id is missing or dangling.
   */
  activeAthleteId: string | null;

  /** All teams the user has added — current and past, 'me' and 'watching'. */
  teams: TeamProfile[];
  /** Which team is the current navigation context. Null if no teams yet. */
  activeTeamId: string | null;

  // ── Reserved for OVA MRS (future) ──────────────────────────────────────
  /**
   * Whether the user has connected their OVA MRS account. False today; the
   * settings UI shows an inert "OVA MRS — coming soon" row in Phase 2 and
   * a real toggle once the OAuth path lands.
   */
  mrsLinked: boolean;
  /** MRS member id once linked. */
  mrsMemberId?: string;

  // ── Reserved for CAC Locker (future) ───────────────────────────────────
  /**
   * Whether the user has connected their CAC Locker (NCCP) account. False
   * today; Phase 2 settings UI shows an inert "CAC Locker — coming soon"
   * row alongside the MRS one. When linked, `coach` carries the coach's
   * own credentials (certifications + ethics modules + expiries).
   */
  cacLinked: boolean;
  /**
   * The user's own coaching credentials, populated only when `cacLinked`
   * is true (or, in a degraded mode, when the user has manually entered
   * their NCCP number to enable public-transcript lookups for themselves).
   */
  coach?: CoachCredentials;

  // ── Tools tab gating ───────────────────────────────────────────────────
  /**
   * Tier 2 scorer mode. When true, the Tools tab surfaces the "Score a
   * Match" entry and the official-scorer flow becomes reachable.
   * Defaults to undefined / false — most users aren't scoring matches and
   * don't need the row cluttering the Tools list. Per-user setting; per-
   * team gating not in v1. Used by both the navigation pass (to gate the
   * Tools row) and the Tier 2 scoring screens (to gate the entry point).
   */
  scorerMode?: boolean;

  // ── Bookkeeping ────────────────────────────────────────────────────────
  createdAt: number;
  updatedAt: number;
  /**
   * Epoch ms when this profile was created from legacy keys. Diagnostic-only
   * — lets us detect users who were already using VBPlus pre-restructure.
   */
  migratedFromLegacyAt?: number;
  /**
   * Epoch ms when the v1 → v2 multi-athlete migration ran. Diagnostic-only.
   */
  migratedFromV1At?: number;
}

// ── UserProfileV1 (legacy shape, migration input only) ────────────────────
//
// Pre-multi-athlete shape. Persisted under the same storage key as
// UserProfile (the `version` field discriminates). NOT exported as part of
// the public profile API — readers should always work with `UserProfile`
// (v2). `buildV2FromV1` consumes this and produces a `UserProfile`.
export interface UserProfileV1 {
  version: 1;
  displayName?: string;
  role?: ProfileRole;
  teams: TeamProfile[];
  activeTeamId: string | null;
  mrsLinked: boolean;
  mrsMemberId?: string;
  cacLinked: boolean;
  coach?: CoachCredentials;
  createdAt: number;
  updatedAt: number;
  migratedFromLegacyAt?: number;
}
