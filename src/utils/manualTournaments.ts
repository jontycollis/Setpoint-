// ── Manual tournament store ────────────────────────────────────────────────
//
// User-typed tournament summaries. Today's primary use case is BEACH
// tournaments — the OVA + Volleyball Canada platforms don't index them,
// so a parent tracking a beach season has nowhere to log results. This
// store fills the gap: one entry per tournament, totals + finish typed
// directly. Indoor entries are also supported (PDF imports, old league
// nights, etc.) but beach is the headline.
//
// Why not piggy-back on `scored.matches.v1`?
//   • Scored entries are PER-MATCH and carry a full Match (roster,
//     event-by-event score progression). A manual beach summary has
//     none of that — forcing one fake Match per tournament would
//     pollute analytics with empty rosters and bogus event traces.
//   • Manual entries don't include `includeInStats` semantics — they
//     ARE the stats; no underlying play to gate.
//
// Records carry `tenantId` like every other top-level record (see
// utils/tenant.ts). Storage is unversioned today; bump to v2 if the
// shape changes in a non-additive way.
// ──────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_TENANT_ID } from './tenant';

const STORAGE_KEY = 'manual.tournaments.v1';

export interface ManualTournamentEntry {
  /** Stable id — `mt_<base36-time>_<rand>`. */
  id: string;
  tenantId: string;
  /** Indoor or beach. UI filters by this; analytics splits by this. */
  sport: 'indoor' | 'beach';
  /**
   * The TeamProfile this entry is attached to. Required — without it
   * the entry would orphan when the user has multiple teams. For beach
   * pairs the team profile IS the pair (e.g. "Collis / Lyevina").
   */
  teamProfileId: string;
  /** Display name of the tournament ("OPVC Spring Slam"). */
  tournamentName: string;
  /** Division / subtitle ("Women 18U Tier 2", "Open"). Optional. */
  subtitle?: string;
  /** Date of the tournament. Used for sorting + Year-on-Year. */
  dateMs: number;
  /** Display date string. Falls back to a formatter when absent. */
  dateText?: string;
  /** Venue name. Optional. */
  venueName?: string;

  /**
   * Beach-only: who the athlete partnered with this weekend. Beach
   * partnerships rotate per event, so it's per-entry, not on the team
   * profile. Undefined for indoor entries.
   */
  beachPartner?: { name: string };

  /** Final placing in the field (1 = champion). */
  finalRank?: number;
  /** Total teams / pairs in the field. Used for percentile analytics. */
  fieldSize?: number;

  /** Match totals — wins + losses. */
  matchesFor: number;
  matchesAgainst: number;
  /** Set totals. */
  setsFor: number;
  setsAgainst: number;

  /** Free-text notes (weather, partner-swap mid-tournament, etc.). */
  notes?: string;

  createdAt: number;
  updatedAt: number;
}

export function makeManualTournamentId(now: number = Date.now()): string {
  const t = now.toString(36);
  const r = Math.floor(Math.random() * 1e9).toString(36);
  return `mt_${t}_${r}`;
}

async function read(): Promise<ManualTournamentEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ManualTournamentEntry[];
  } catch {
    return [];
  }
}

async function write(entries: ManualTournamentEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* ignore — write errors leave the prior value in place */
  }
}

/** Load every manual entry, newest first. */
export async function loadManualTournaments(): Promise<
  ManualTournamentEntry[]
> {
  const entries = await read();
  return [...entries].sort((a, b) => (b.dateMs ?? 0) - (a.dateMs ?? 0));
}

/** Load every manual entry attached to a single team. */
export async function loadManualTournamentsForTeam(
  teamProfileId: string
): Promise<ManualTournamentEntry[]> {
  const all = await loadManualTournaments();
  return all.filter((e) => e.teamProfileId === teamProfileId);
}

/**
 * Create or update a manual entry. Identity is on `id` — if the entry
 * has an id matching an existing record, that record is replaced; else
 * a new record is appended. Returns the persisted entry (with the id
 * generated if it was missing on input).
 */
export async function saveManualTournament(
  entry: Omit<ManualTournamentEntry, 'createdAt' | 'updatedAt'> & {
    createdAt?: number;
    updatedAt?: number;
  }
): Promise<ManualTournamentEntry> {
  const now = Date.now();
  const all = await read();
  const idx = all.findIndex((e) => e.id === entry.id);
  const tenantId =
    typeof entry.tenantId === 'string' && entry.tenantId.length > 0
      ? entry.tenantId
      : DEFAULT_TENANT_ID;
  if (idx === -1) {
    const created: ManualTournamentEntry = {
      ...entry,
      tenantId,
      createdAt: entry.createdAt ?? now,
      updatedAt: now,
    };
    await write([...all, created]);
    return created;
  }
  const next: ManualTournamentEntry = {
    ...all[idx]!,
    ...entry,
    tenantId,
    createdAt: all[idx]!.createdAt,
    updatedAt: now,
  };
  const replaced = [...all];
  replaced[idx] = next;
  await write(replaced);
  return next;
}

/** Remove the manual entry with this id. No-op if not found. */
export async function removeManualTournament(id: string): Promise<void> {
  const all = await read();
  const next = all.filter((e) => e.id !== id);
  if (next.length === all.length) return;
  await write(next);
}
