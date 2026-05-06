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

// ── UserProfile ───────────────────────────────────────────────────────────
//
// One per device install. Persisted at `vbplus.userProfile.v1`. Migration
// from legacy keys is lazy — `loadOrMigrateUserProfile()` builds this on
// first call from the existing `aes.myTeam` + `season.myTeamAliases.v1`.
export interface UserProfile {
  /** Schema version — bump on breaking shape changes; migrate forward. */
  version: 1;

  // ── Optional identity ──────────────────────────────────────────────────
  // Both optional. UI falls back to a generic "My career" header when
  // displayName is unset and skips role-based copy when role is unset.
  // Never block boot or onboarding on these fields.
  displayName?: string;
  role?: ProfileRole;

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
   * When true, the Tools tab surfaces the "Score a Match" entry. Default
   * false — most users are not scoring matches and don't need the row
   * cluttering the Tools list. Toggled by the Tier 2 scoring flow when it
   * provisions the user as a scorer (parallel session, owns the toggle UI).
   * Also concurrently added by Tier 2 Session B; if both edits land,
   * preserve a single declaration here.
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
}
