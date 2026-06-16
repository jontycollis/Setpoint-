// ── Auto-detect clubs from team labels ─────────────────────────────────────
//
// First-migration heuristic that buckets the user's existing TeamProfiles
// into auto-created Clubs based on the leading word of each team label.
// Existing labels follow predictable patterns:
//
//   "PVC 3D Royals U18"     → club = "PVC"
//   "PVC Mustangs 16U"      → club = "PVC"
//   "Defensa Rob"           → club = "Defensa"
//   "REACH Harmony"         → club = "REACH"
//   "Collis / Lyevina"      → beach pair, NO club
//
// Pure functions only. The caller (userProfileMigration) wires the
// resulting clubs + clubId assignments into the UserProfile and persists.
// ──────────────────────────────────────────────────────────────────────────

import type { Club, TeamProfile } from '../types/profile';

/**
 * Make a stable id for a freshly-detected Club. Format:
 * `club_<base36-time>_<random>`. Mirrors makeTeamProfileId /
 * makeAthleteProfileId so all id types follow the same shape.
 */
export function makeClubId(now: number = Date.now()): string {
  const t = now.toString(36);
  const r = Math.floor(Math.random() * 1e9).toString(36);
  return `club_${t}_${r}`;
}

/**
 * Extract the club key from a team label, or null if the label looks
 * like a beach pair / individual entry (no club applicable).
 *
 * Algorithm:
 *   1. Reject obvious pair patterns ("A / B", "A and B", "A vs B").
 *   2. Strip trailing age-group / season / division markers from the
 *      end of the label so they don't end up in the key.
 *   3. Take the first whitespace-separated token. If it's a generic
 *      filler word (Team, Club, etc.) try the second token instead.
 *   4. Reject keys shorter than 2 chars.
 *
 * The output preserves the original casing so the auto-created Club's
 * name reads naturally ("PVC", not "pvc").
 */
export function extractClubKey(teamLabel: string): string | null {
  const trimmed = teamLabel.trim();
  if (!trimmed) return null;

  // Beach pair patterns — surname/surname or first/first or "X and Y".
  if (/\s+\/\s+/.test(trimmed)) return null;
  if (/\s+(and|vs|&)\s+/i.test(trimmed)) return null;

  // Strip trailing format markers so they don't pollute the key. We
  // anchor to whitespace so e.g. "PVC18U" (no space) stays intact, while
  // "PVC 18U" gets stripped down to "PVC".
  let body = trimmed
    .replace(/\s+\d{4}[-\/]\d{2,4}.*$/i, '') // "2025-26", "2024/25" + trailing
    .replace(/\s+(season|year)[\s\d-]*$/i, '')
    .replace(/\s+(U\d{1,2}|\d{1,2}U)\b.*$/i, '') // "U18", "18U" + everything after
    .replace(/\s+(boys|girls|men|women|mens|womens|coed)\b.*$/i, '')
    .replace(/\s+(division|div)\s+.*$/i, '')
    .trim();

  if (!body) return null;

  const tokens = body.split(/\s+/);
  // First token is usually the club. Fall back to second token when the
  // first is a generic filler that wouldn't make a useful club name.
  const FILLERS = new Set(['the', 'team', 'club', 'volleyball', 'vb']);
  let key = tokens[0]!;
  if (FILLERS.has(key.toLowerCase()) && tokens[1]) {
    key = tokens[1]!;
  }
  if (key.length < 2) return null;
  return key;
}

export interface ClubDetectionResult {
  /** Newly-created Club records, in detection order. */
  clubs: Club[];
  /**
   * Map from teamProfile.id → clubId so the caller can stamp clubId on
   * the right teams without re-running the heuristic. Teams whose
   * extractClubKey returned null (beach pairs, etc.) don't appear here.
   */
  assignments: Record<string, string>;
}

/**
 * Bucket teams by extractClubKey and return the auto-created Clubs +
 * the team-id → club-id assignments. Pure — caller is responsible for
 * persisting. The caller is also responsible for not re-running this
 * unnecessarily (gate on UserProfile.clubsBackfilledAt).
 */
export function detectClubsFromTeams(
  teams: TeamProfile[],
  tenantId: string,
  now: number = Date.now()
): ClubDetectionResult {
  const byKey = new Map<string, TeamProfile[]>();
  for (const team of teams) {
    const key = extractClubKey(team.label);
    if (!key) continue;
    const bucket = byKey.get(key) ?? [];
    bucket.push(team);
    byKey.set(key, bucket);
  }

  const clubs: Club[] = [];
  const assignments: Record<string, string> = {};
  // Stable id sequence — bump random offset per club so a single now
  // value doesn't generate duplicate ids for several clubs detected in
  // the same migration pass.
  let salt = 0;
  for (const [key, bucket] of byKey) {
    const id = makeClubId(now + salt++);
    clubs.push({
      id,
      tenantId,
      name: key,
      createdAt: now,
      updatedAt: now,
      detectedFromTeamPrefix: true,
    });
    for (const team of bucket) {
      assignments[team.id] = id;
    }
  }
  return { clubs, assignments };
}
