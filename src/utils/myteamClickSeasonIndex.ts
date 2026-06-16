// ── MyTeam.Click season index ─────────────────────────────────────────────
//
// Parallel to aesSeasonIndex / timuSeasonIndex but scoped to a specific
// player + event on MyTeam.Click. Snapshots cache the
// `fetchEventSchedule` payload so the rest of the app reads from a
// local copy and we don't hammer the Heroku backend.
//
// Storage: `myteamclick.seasonIndex.v1` keyed by event _id. One
// snapshot per event — re-indexing replaces the prior copy. Carries
// the player id the snapshot was built for so multi-athlete profiles
// can keep per-athlete data straight.
// ──────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  MtcGroup,
  MtcMatch,
  MtcScheduleResponse,
  MtcTeam,
} from '../api/myteamClickClient';
import type {
  UnifiedMatchEntry,
  UnifiedTournamentEntry,
} from './unifiedSeasonHistory';

const STORAGE_KEY = 'myteamclick.seasonIndex.v1';

// ── Snapshot shape ────────────────────────────────────────────────────────

/**
 * Cached MyTeam.Click event snapshot. Mirrors the AES / Timu pattern:
 * one snapshot per (event, player) — the player slot lives in
 * `myPlayerId` so we can find their team during projection even when
 * the team name format changes ("A.Collis/K.McKeil") between events.
 */
export interface MtcEventSnapshot {
  source: 'myteamclick';
  /** Event id (matches MtcScheduleResponse.event._id). */
  eventId: string;
  /**
   * The player this snapshot was built for. Drives which team / group
   * counts as "mine" during projection.
   */
  myPlayerId: string;
  /** First / last name as captured at index time — used only for UI. */
  myPlayerName: { firstName: string; lastName: string };

  /** Event headline. */
  eventName: string;
  /** ISO date. */
  dateText: string;
  /** Start of the event in ms (parsed from `event.date`). */
  dateMs: number;
  /** Venue name from the first locList entry, if any. */
  venueName?: string;
  /** Organizing org name + abbr — useful for breadcrumb display. */
  orgName?: string;
  orgAbbr?: string;
  /** League id / name, when the event is part of a recurring series. */
  leagueId?: string;
  leagueName?: string;
  /** IANA time zone for the event venue. */
  venueTimeZone?: string;

  /** Sport — MyTeam.Click hosts beach + indoor. Detected from group
   *  name patterns at index time so downstream filters can split.
   *  Defaults to 'beach' since that's the platform's primary use. */
  sport: 'indoor' | 'beach';

  /** The whole groups array — projection picks out the player's
   *  group(s) on read. Kept whole so per-set re-projection (e.g. after
   *  a partnership / division UI lands) doesn't require re-indexing. */
  groups: MtcGroup[];
  /** Whole matchList — same reasoning. */
  matchList: MtcMatch[];
  /** Whole top-level locList. */
  locList: MtcScheduleResponse['event']['locList'];

  /** When the snapshot was fetched. */
  indexedAt: number;
}

export type MtcSeasonIndex = Record<string, MtcEventSnapshot>;

// ── Storage ───────────────────────────────────────────────────────────────

async function readIndex(): Promise<MtcSeasonIndex> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as MtcSeasonIndex;
    }
    return {};
  } catch {
    return {};
  }
}

async function writeIndex(index: MtcSeasonIndex): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(index));
  } catch {
    /* swallow — the prior value stays in place */
  }
}

export async function loadMtcSeasonIndex(): Promise<MtcSeasonIndex> {
  return readIndex();
}

export async function saveMtcSnapshot(
  snapshot: MtcEventSnapshot
): Promise<MtcSeasonIndex> {
  const cur = await readIndex();
  const next = { ...cur, [snapshot.eventId]: snapshot };
  await writeIndex(next);
  return next;
}

export async function removeMtcSnapshot(
  eventId: string
): Promise<MtcSeasonIndex> {
  const cur = await readIndex();
  if (!(eventId in cur)) return cur;
  const next = { ...cur };
  delete next[eventId];
  await writeIndex(next);
  return next;
}

export function sortedMtcSnapshots(
  index: MtcSeasonIndex
): MtcEventSnapshot[] {
  return Object.values(index).sort((a, b) => b.dateMs - a.dateMs);
}

// ── Builder (snapshot from a schedule response) ───────────────────────────

/**
 * Heuristic: is this event beach or indoor? MyTeam.Click hosts both.
 * Beach groups follow patterns like "2x2 Women Open", "2x2 Girls 18U",
 * "Top Guns - Men's 2s Open". Indoor (rare on this platform) uses 4s
 * / 6s / "Co-ed 6" / "League Night". We default to beach when nothing
 * matches because the platform's primary content IS beach.
 */
export function detectSportFromGroups(
  groups: Array<{ name: string }>
): 'indoor' | 'beach' {
  for (const g of groups) {
    const n = (g.name || '').toLowerCase();
    if (/\b6'?s?\b|\b6-person\b|co-?ed\s+6|league\s+night|\bindoor\b/.test(n)) {
      return 'indoor';
    }
  }
  for (const g of groups) {
    const n = (g.name || '').toLowerCase();
    if (/\b2'?s?\b|\b2x2\b|\bbeach\b|\bdoubles?\b/.test(n)) {
      return 'beach';
    }
  }
  return 'beach';
}

/**
 * Convert a fresh `fetchEventSchedule` response into a snapshot.
 * `myPlayerId` MUST match a player `_id` in some team's `slots` — we
 * project against this id when building unified entries. Falls back
 * to OK-snapshot-but-no-team semantics if the player isn't on any
 * team (returned snapshot still indexed for future repair).
 */
export function buildMtcSnapshotFromSchedule(args: {
  response: MtcScheduleResponse;
  myPlayerId: string;
  myPlayerName: { firstName: string; lastName: string };
  indexedAt?: number;
}): MtcEventSnapshot {
  const { response, myPlayerId, myPlayerName } = args;
  const ev = response.event;
  const dateMs = Date.parse(ev.date);
  return {
    source: 'myteamclick',
    eventId: ev._id,
    myPlayerId,
    myPlayerName,
    eventName: (ev.name || '').trim(),
    dateText: ev.date,
    dateMs: Number.isFinite(dateMs) ? dateMs : Date.now(),
    venueName: ev.locList[0]?.name,
    orgName: response.org?.name ?? ev.orgRef?.name,
    orgAbbr: ev.orgRef?.abbr,
    leagueId: ev.leagueRef?.league,
    leagueName: ev.leagueRef?.name,
    venueTimeZone: response.timeZone,
    sport: detectSportFromGroups(ev.groups),
    groups: ev.groups,
    matchList: ev.matchList,
    locList: ev.locList,
    indexedAt: args.indexedAt ?? Date.now(),
  };
}

// ── Projection to UnifiedTournamentEntry ──────────────────────────────────

/**
 * Find the player's team in a group via slot id match. Returns null
 * when the player isn't on any team in this group.
 */
function findMyTeam(group: MtcGroup, myPlayerId: string): MtcTeam | null {
  for (const t of group.teams) {
    if ((t.slots || []).some((s) => s._id === myPlayerId)) return t;
  }
  return null;
}

/**
 * Return the OTHER player slot — the user's beach partner for this
 * event. For a 2x2 (the platform's headline format) there's exactly
 * one other slot. For 4s / 6s we return the first non-self slot;
 * downstream UI can format better if it cares about >2 player teams.
 */
function findPartner(
  team: MtcTeam,
  myPlayerId: string
): { name: string } | undefined {
  const others = (team.slots || []).filter((s) => s._id !== myPlayerId);
  if (others.length === 0) return undefined;
  const o = others[0]!;
  // Names come in as e.g. "A." + "Collis" — preserve verbatim when the
  // first name looks like an initial; otherwise display "First Last".
  const fn = (o.firstName || '').trim();
  const ln = (o.lastName || '').trim();
  if (!fn && !ln) return undefined;
  return { name: `${fn}${fn && ln ? ' ' : ''}${ln}` };
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0] ?? '');
}

/**
 * Build UnifiedTournamentEntry rows for every group the player has a
 * team in. Most events produce a single entry; large multi-division
 * events (e.g. a player who entered both the 16U and 18U brackets)
 * produce one per group.
 */
export function snapshotToUnifiedEntries(
  snapshot: MtcEventSnapshot
): UnifiedTournamentEntry[] {
  const out: UnifiedTournamentEntry[] = [];
  for (const group of snapshot.groups) {
    const myTeam = findMyTeam(group, snapshot.myPlayerId);
    if (!myTeam) continue;

    const partner = findPartner(myTeam, snapshot.myPlayerId);
    const finalRank = myTeam.groupPos ?? null;
    const finalRankLabel = finalRank != null ? ordinal(finalRank) : null;

    // Aggregate matches involving this team. Pool matches sit in
    // matchList with type 'P', finals with type 'F' (or other). Use
    // the team's stored mWon/mLost/sWon/sLost when present (canonical
    // from MyTeam.Click's own rollup), else re-derive from matchList
    // — older snapshots may lack the team-level rollup.
    let matchesFor = myTeam.mWon ?? 0;
    let matchesAgainst = myTeam.mLost ?? 0;
    let setsFor = myTeam.sWon ?? 0;
    let setsAgainst = myTeam.sLost ?? 0;
    const matches: UnifiedMatchEntry[] = [];
    if (matchesFor === 0 && matchesAgainst === 0) {
      // Derive from matchList.
      for (const m of snapshot.matchList) {
        const myEntry = m.teams.find((t) => t.teamId === myTeam._id);
        const oppEntry = m.teams.find((t) => t.teamId !== myTeam._id);
        if (!myEntry || !oppEntry) continue;
        const mySetsWon = myEntry.scores.filter(
          (s, i) => s > (oppEntry.scores[i] ?? 0)
        ).length;
        const oppSetsWon = oppEntry.scores.filter(
          (s, i) => s > (myEntry.scores[i] ?? 0)
        ).length;
        if (mySetsWon === oppSetsWon) continue; // undecided / tie
        setsFor += mySetsWon;
        setsAgainst += oppSetsWon;
        if (mySetsWon > oppSetsWon) matchesFor++;
        else matchesAgainst++;
        const oppTeam = group.teams.find((t) => t._id === oppEntry.teamId);
        matches.push({
          dateText: snapshot.dateText,
          time: '',
          court: '',
          roundLabel: m.type === 'F' ? 'Finals' : 'Pool',
          isPool: m.type === 'P',
          opponentName: oppTeam?.name ?? 'Opponent',
          mySetsWon,
          oppSetsWon,
          myScores: myEntry.scores,
          oppScores: oppEntry.scores,
          iWon: mySetsWon > oppSetsWon,
        });
      }
    } else {
      // Even when the rollup is populated, also build per-match rows
      // so per-set drill-downs work.
      for (const m of snapshot.matchList) {
        const myEntry = m.teams.find((t) => t.teamId === myTeam._id);
        const oppEntry = m.teams.find((t) => t.teamId !== myTeam._id);
        if (!myEntry || !oppEntry) continue;
        const mySetsWon = myEntry.scores.filter(
          (s, i) => s > (oppEntry.scores[i] ?? 0)
        ).length;
        const oppSetsWon = oppEntry.scores.filter(
          (s, i) => s > (myEntry.scores[i] ?? 0)
        ).length;
        if (mySetsWon === oppSetsWon) continue;
        const oppTeam = group.teams.find((t) => t._id === oppEntry.teamId);
        matches.push({
          dateText: snapshot.dateText,
          time: '',
          court: '',
          roundLabel: m.type === 'F' ? 'Finals' : 'Pool',
          isPool: m.type === 'P',
          opponentName: oppTeam?.name ?? 'Opponent',
          mySetsWon,
          oppSetsWon,
          myScores: myEntry.scores,
          oppScores: oppEntry.scores,
          iWon: mySetsWon > oppSetsWon,
        });
      }
    }

    out.push({
      source: 'myteamclick',
      sourceKey: `mtc:${snapshot.eventId}:${group._id}`,
      sport: snapshot.sport,
      tournamentName: snapshot.eventName,
      subtitle: group.name,
      dateText: snapshot.dateText,
      dateMs: snapshot.dateMs,
      venueName: snapshot.venueName,
      myTeamAsSeen: myTeam.name,
      beachPartner: partner,
      poolRank: myTeam.poolPos ?? null,
      finalRank,
      finalRankLabel,
      // Field size: the number of teams in this division. Drives the
      // "Where you fit in" percentile.
      fieldSize: group.teams.length || undefined,
      matchesFor,
      matchesAgainst,
      setsFor,
      setsAgainst,
      matches,
      indexedAt: snapshot.indexedAt,
    });
  }
  return out;
}
