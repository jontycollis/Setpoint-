// ── Match Meta — pure helpers ─────────────────────────────────────────────
//
// Pure (no AsyncStorage, no React Native) helpers for the analytics
// classification fields on `MatchMeta`. Split out so test scripts can
// exercise the migration / transformation logic without pulling the
// React Native AsyncStorage surface that `matchMeta.ts` brings in.
//
// `matchMeta.ts` re-exports everything here for the runtime callers;
// `scripts/verifyMatchMeta.ts` imports from this module directly.
// ────────────────────────────────────────────────────────────────────────────

import type {
  AesEventLink,
  Match,
  MatchKind,
  MatchMeta,
  MatchSource,
  TimuTournamentLink,
} from '../types/match';

// ── Defaults ──────────────────────────────────────────────────────────────

/**
 * `true` for AES / Timu / imported matches (they're "real" competition
 * data and should roll up by default), `false` for standalone matches
 * (scrimmages and ad-hoc matches start out excluded; the user can flip
 * any specific scrimmage on later).
 */
export function defaultIncludeInStats(matchKind: MatchKind): boolean {
  switch (matchKind) {
    case 'aes':
    case 'timu':
    case 'imported':
      return true;
    case 'standalone':
      return false;
  }
}

// ── On-read normaliser ────────────────────────────────────────────────────

/**
 * Fill in the new fields on a meta that was stored before they
 * existed. Idempotent — calling on an already-normalised meta is a
 * no-op (returns the same reference if no changes are needed).
 *
 * Default rules:
 *   • `matchKind`       → `'standalone'`
 *   • `source`          → `'tier2-live'` (legacy data is presumed to
 *                          have come from Tier 2 live scoring)
 *   • `includeInStats`  → `false` (because the fallback `matchKind`
 *                          is `'standalone'`)
 */
export function normaliseMatchMeta(meta: MatchMeta): MatchMeta {
  const hasKind = meta.matchKind != null;
  const hasSource = meta.source != null;
  const hasInclude = meta.includeInStats != null;
  if (hasKind && hasSource && hasInclude) return meta;

  const matchKind: MatchKind = meta.matchKind ?? 'standalone';
  const source: MatchSource = meta.source ?? 'tier2-live';
  const includeInStats =
    meta.includeInStats ?? defaultIncludeInStats(matchKind);
  return {
    ...meta,
    matchKind,
    source,
    includeInStats,
  };
}

/** Convenience wrapper: normalise the meta on a Match record. */
export function normaliseMatch(match: Match): Match {
  const nextMeta = normaliseMatchMeta(match.meta);
  if (nextMeta === match.meta) return match;
  return { ...match, meta: nextMeta };
}

// ── Pure transformers for the link/unlink/inclusion helpers ──────────────

/**
 * Pure transformer: stamp a new `includeInStats` value on a match.
 * Always normalises on the way through so older matches pick up
 * their default fields. Bumps `updatedAt`.
 */
export function applyMatchInclusion(
  match: Match,
  include: boolean,
  now: number = Date.now()
): Match {
  const normalised = normaliseMatch(match);
  return {
    ...normalised,
    meta: { ...normalised.meta, includeInStats: include },
    updatedAt: now,
  };
}

/**
 * Pure transformer: attach an AES tournament link, force
 * `matchKind: 'aes'`, and clear any prior Timu link (a single match
 * can't be both). Bumps `updatedAt`.
 */
export function applyAesLink(
  match: Match,
  link: AesEventLink,
  now: number = Date.now()
): Match {
  const normalised = normaliseMatch(match);
  return {
    ...normalised,
    meta: {
      ...normalised.meta,
      matchKind: 'aes',
      linkedAesEvent: link,
      linkedTimuTournament: undefined,
    },
    updatedAt: now,
  };
}

/**
 * Pure transformer: attach a Timu tournament link, force
 * `matchKind: 'timu'`, and clear any prior AES link.
 */
export function applyTimuLink(
  match: Match,
  link: TimuTournamentLink,
  now: number = Date.now()
): Match {
  const normalised = normaliseMatch(match);
  return {
    ...normalised,
    meta: {
      ...normalised.meta,
      matchKind: 'timu',
      linkedTimuTournament: link,
      linkedAesEvent: undefined,
    },
    updatedAt: now,
  };
}

/**
 * Pure transformer: drop both tournament links, demote `matchKind`
 * back to `'standalone'`. The user's `includeInStats` choice is
 * preserved (the analytics layer respects whatever was last set).
 */
export function applyUnlink(match: Match, now: number = Date.now()): Match {
  const normalised = normaliseMatch(match);
  return {
    ...normalised,
    meta: {
      ...normalised.meta,
      matchKind: 'standalone',
      linkedAesEvent: undefined,
      linkedTimuTournament: undefined,
    },
    updatedAt: now,
  };
}
