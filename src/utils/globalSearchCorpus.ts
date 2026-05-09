// ── Global search corpus ──────────────────────────────────────────────────
//
// Shared between the full-screen GlobalSearchScreen and the inline
// "search a tournament or team" input that sits at the top of the Browse
// tab. Single source of truth so both surfaces match exactly which teams
// are findable + how the result rows route through App's
// `handleGlobalSearchSelect`.
//
// The corpus contains:
//   - Profile teams (the user's own follow list — these float to the top
//     so familiar teams surface even before any snapshot has been built)
//   - Indexed AES teams (one row per snapshot × team)
//   - Indexed Timu teams (one row per snapshot × team-row by name)
// ────────────────────────────────────────────────────────────────────────────

import { loadAesSeasonIndex, sortedAesSnapshots } from './aesSeasonIndex';
import {
  loadSeasonIndex as loadTimuIndex,
  sortedSnapshots as sortedTimuSnapshots,
} from './timuSeasonIndex';
import type { UserProfile, TeamProfile } from '../types/profile';

export type GlobalSearchResult =
  | {
      kind: 'aes-team';
      eventKey: string;
      eventName: string;
      divisionId: number;
      divisionName: string;
      divisionColorHex?: string;
      teamId: number;
      teamName: string;
      teamText: string;
      clubName?: string;
    }
  | {
      kind: 'timu-team';
      tid: number;
      tournamentName: string;
      teamName: string;
    }
  | {
      kind: 'profile-team';
      team: TeamProfile;
    };

/**
 * Build the searchable corpus from AsyncStorage. Cheap — both indices
 * are already in storage; the call is essentially two JSON.parses + a
 * flat-map. Callers should cache the result rather than calling on
 * every keystroke.
 */
export async function buildGlobalSearchCorpus(
  profile: UserProfile | null
): Promise<GlobalSearchResult[]> {
  const [aesIdx, timuIdx] = await Promise.all([
    loadAesSeasonIndex(),
    loadTimuIndex(),
  ]);

  const out: GlobalSearchResult[] = [];
  const seen = new Set<string>();

  if (profile) {
    for (const team of profile.teams) {
      const key = `profile:${team.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: 'profile-team', team });
    }
  }

  for (const snap of sortedAesSnapshots(aesIdx)) {
    for (const team of snap.teams) {
      const key = `aes:${snap.eventKey}:${snap.divisionId}:${team.teamId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: 'aes-team',
        eventKey: snap.eventKey,
        eventName: snap.eventName,
        divisionId: snap.divisionId,
        divisionName: snap.divisionName,
        divisionColorHex: snap.divisionColorHex,
        teamId: team.teamId,
        teamName: team.teamName,
        teamText: team.teamText,
        clubName: team.clubName,
      });
    }
  }

  for (const snap of sortedTimuSnapshots(timuIdx)) {
    for (const team of snap.teams) {
      const key = `timu:${snap.tid}:${team.teamName.toLowerCase().trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: 'timu-team',
        tid: snap.tid,
        tournamentName: snap.name,
        teamName: team.teamName,
      });
    }
  }

  return out;
}

/** Case-insensitive substring filter against the corpus. */
export function matchesQuery(r: GlobalSearchResult, q: string): boolean {
  switch (r.kind) {
    case 'aes-team':
      return (
        r.teamName.toLowerCase().includes(q) ||
        r.teamText.toLowerCase().includes(q) ||
        (r.clubName ?? '').toLowerCase().includes(q) ||
        r.eventName.toLowerCase().includes(q) ||
        r.divisionName.toLowerCase().includes(q)
      );
    case 'timu-team':
      return (
        r.teamName.toLowerCase().includes(q) ||
        r.tournamentName.toLowerCase().includes(q)
      );
    case 'profile-team':
      return (
        r.team.label.toLowerCase().includes(q) ||
        r.team.aliases.some((a) => a.toLowerCase().includes(q)) ||
        (r.team.club ?? '').toLowerCase().includes(q)
      );
  }
}

/** Stable key for FlatList. */
export function resultKey(r: GlobalSearchResult): string {
  switch (r.kind) {
    case 'aes-team':
      return `aes:${r.eventKey}:${r.divisionId}:${r.teamId}`;
    case 'timu-team':
      return `timu:${r.tid}:${r.teamName}`;
    case 'profile-team':
      return `profile:${r.team.id}`;
  }
}
