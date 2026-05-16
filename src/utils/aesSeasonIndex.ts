// ── AES Season Index ───────────────────────────────────────────────────────
//
// Parallel to timuSeasonIndex but scoped to a specific team within an AES
// event/division. AES snapshots are my-team-centric (we store my matches
// with scores + the full division standings for context), because a full
// event-wide snapshot would require pulling every team's schedule
// separately — too many API calls.
//
// Storage: `aes.seasonIndex.v1` keyed by `${eventKey}:${divisionId}`.
// One snapshot per (event, division) — if the user favorites more than
// one team in the same division, only the most recently indexed team's
// match list is cached. The team identity is carried in the snapshot.
// ────────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getEvent,
  getStandings,
  getTeamCurrentSchedule,
  getTeamPastSchedule,
  extractAllScheduleMatches,
  type EnrichedScheduleMatch,
} from '../api/aesClient';
import type {
  AESEvent,
  AESStanding,
  AESDivision,
} from '../types/aes';
import { tzForCanadianProvince, tzForVenueAddress } from './venueTimeZone';
import { parseScheduleTime, formatInVenueTz } from './dates';

const STORAGE_KEY = 'aes.seasonIndex.v1';

// ── Types ─────────────────────────────────────────────────────────────────

export interface AesTournamentSnapshot {
  source: 'aes';
  eventKey: string;
  divisionId: number;
  /** Team this snapshot was built for (carries through to the unified view). */
  myTeamId: number;
  myTeamText: string;
  myTeamName: string;

  eventName: string;
  divisionName: string;
  divisionColorHex: string;
  dateText: string;        // "Apr 16 – 18"
  dateMs?: number;         // start of event in ms
  venueName: string;
  /**
   * IANA time zone for the event venue (e.g. `"America/Toronto"`). Resolved
   * from the AES listing event's `address.state` (or a name heuristic) at
   * index time. Optional — older snapshots without it fall back to
   * device-local display.
   */
  venueTimeZone?: string;

  teams: Array<AesTeamRow>;

  /** My team's individual match history, in chronological order. */
  matches: Array<AesMatchEntry>;

  indexedAt: number;
}

export interface AesTeamRow {
  teamId: number;
  teamName: string;
  teamText: string;
  clubName: string;
  rank: number | null;      // FinishRank (falls back to OverallRank)
  matchesFor: number;
  matchesAgainst: number;
  setsFor: number;
  setsAgainst: number;
}

export interface AesMatchEntry {
  matchId: number;
  dateMs: number;           // ScheduledStartDateTime parsed to ms
  dateText: string;         // "Thu Apr 16"
  time: string;             // "9:00 AM"
  court: string;            // court name (e.g. "Court 5")
  /** Play type label — "Pool A", "1/4 Final", "Gold", etc. */
  roundLabel: string;
  isPool: boolean;
  opponentTeamId: number;
  opponentText: string;
  mySetsWon: number;
  oppSetsWon: number;
  myScores: number[];
  oppScores: number[];
  iWon: boolean;
  hasScores: boolean;
}

export type AesSeasonIndex = Record<string, AesTournamentSnapshot>;

// ── Storage ───────────────────────────────────────────────────────────────

export function aesSnapshotKey(eventKey: string, divisionId: number): string {
  return `${eventKey}:${divisionId}`;
}

async function readIndex(): Promise<AesSeasonIndex> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as AesSeasonIndex;
    }
    return {};
  } catch {
    return {};
  }
}

async function writeIndex(index: AesSeasonIndex): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(index));
  } catch {
    /* ignore */
  }
}

export async function loadAesSeasonIndex(): Promise<AesSeasonIndex> {
  return readIndex();
}

export async function removeAesSnapshot(
  eventKey: string,
  divisionId: number
): Promise<AesSeasonIndex> {
  const cur = await readIndex();
  const key = aesSnapshotKey(eventKey, divisionId);
  if (!(key in cur)) return cur;
  const next = { ...cur };
  delete next[key];
  await writeIndex(next);
  return next;
}

// ── Builder ───────────────────────────────────────────────────────────────

/**
 * Fetch a fresh snapshot for a team in an AES event+division. Returns null
 * if the event / division / team isn't found.
 */
export async function buildAesSnapshot(
  eventKey: string,
  divisionId: number,
  teamId: number,
  /**
   * Optional venue-tz hints. Most call sites don't have these — pass them
   * from places that have already fetched the AES listing (the listing has
   * an `address.state` we can map to IANA tz directly). When absent we
   * fall back to scanning `event.Location` heuristically.
   */
  hints?: { state?: string; address?: string }
): Promise<AesTournamentSnapshot | null> {
  let event: AESEvent;
  try {
    event = await getEvent(eventKey);
  } catch {
    return null;
  }

  const division = event.Divisions.find((d) => d.DivisionId === divisionId);
  if (!division) return null;

  let standings: AESStanding[] = [];
  try {
    standings = await getStandings(eventKey, divisionId);
  } catch {
    /* non-fatal — standings might be empty if event not started */
  }

  const myStanding = standings.find((s) => s.TeamId === teamId);
  const myTeamText =
    myStanding?.TeamText ||
    myStanding?.TeamName ||
    `Team ${teamId}`;
  const myTeamName = myStanding?.TeamName || myTeamText;

  // Pull my team's matches (current + past) and flatten.
  let scheduleMatches: EnrichedScheduleMatch[] = [];
  try {
    const [cur, past] = await Promise.all([
      getTeamCurrentSchedule(eventKey, divisionId, teamId).catch(() => []),
      getTeamPastSchedule(eventKey, divisionId, teamId).catch(() => []),
    ]);
    scheduleMatches = extractAllScheduleMatches(cur, past);
  } catch {
    /* non-fatal */
  }

  // Resolve a venue tz before we parse per-match times so that wall-clock
  // strings without a tz suffix get interpreted as venue-local.
  const venueTimeZone =
    (hints?.state && tzForCanadianProvince(hints.state)) ||
    (hints?.address && tzForVenueAddress(hints.address)) ||
    (event.Location && tzForVenueAddress(event.Location)) ||
    (event.Name && tzForVenueAddress(event.Name)) ||
    undefined;

  const matches = scheduleMatches
    .map((m) => toMatchEntry(m, teamId, venueTimeZone ?? undefined))
    .filter((m): m is AesMatchEntry => m !== null)
    // Chronological (oldest first) — history screen reverses per-tournament
    .sort((a, b) => a.dateMs - b.dateMs);

  const teams: AesTeamRow[] = standings.map(standingToTeamRow);

  const dateMs = parseIsoDate(event.StartDate);
  const dateText = formatEventDateRange(event);

  return {
    source: 'aes',
    eventKey,
    divisionId,
    myTeamId: teamId,
    myTeamText,
    myTeamName,
    eventName: event.Name,
    divisionName: division.Name,
    divisionColorHex: division.ColorHex || '#1a73e8',
    dateText,
    dateMs,
    venueName: event.Location || '',
    venueTimeZone: venueTimeZone ?? undefined,
    teams,
    matches,
    indexedAt: Date.now(),
  };
}

/**
 * Index an AES event+division snapshot into AsyncStorage. If a snapshot for
 * this key already exists, it's replaced. Returns the updated index map.
 */
export async function indexAesSnapshot(
  eventKey: string,
  divisionId: number,
  teamId: number,
  hints?: { state?: string; address?: string }
): Promise<AesSeasonIndex> {
  const snap = await buildAesSnapshot(eventKey, divisionId, teamId, hints);
  if (!snap) return readIndex();
  const cur = await readIndex();
  const next = { ...cur, [aesSnapshotKey(eventKey, divisionId)]: snap };
  await writeIndex(next);
  return next;
}

/**
 * Only refresh an existing snapshot if it's stale beyond `staleMs`. Default:
 * 2 minutes — avoids refetching when the user tab-switches through the app.
 */
export async function ensureAesIndexed(
  eventKey: string,
  divisionId: number,
  teamId: number,
  staleMs: number = 2 * 60 * 1000,
  hints?: { state?: string; address?: string }
): Promise<AesSeasonIndex> {
  const cur = await readIndex();
  const key = aesSnapshotKey(eventKey, divisionId);
  const existing = cur[key];
  if (
    existing &&
    existing.myTeamId === teamId &&
    Date.now() - existing.indexedAt < staleMs
  ) {
    return cur;
  }
  return indexAesSnapshot(eventKey, divisionId, teamId, hints);
}

// ── Pure helpers ──────────────────────────────────────────────────────────

function standingToTeamRow(s: AESStanding): AesTeamRow {
  return {
    teamId: s.TeamId,
    teamName: s.TeamName,
    teamText: s.TeamText,
    clubName: s.Club?.Name || '',
    rank: s.FinishRank ?? s.OverallRank ?? null,
    matchesFor: s.MatchesWon,
    matchesAgainst: s.MatchesLost,
    setsFor: s.SetsWon,
    setsAgainst: s.SetsLost,
  };
}

function toMatchEntry(
  m: EnrichedScheduleMatch,
  myTeamId: number,
  venueTz: string | undefined
): AesMatchEntry | null {
  const iAmFirst = m.FirstTeamId === myTeamId;
  const iAmSecond = m.SecondTeamId === myTeamId;
  if (!iAmFirst && !iAmSecond) return null;
  const mineText = iAmFirst ? m.FirstTeamText : m.SecondTeamText;
  const oppText = iAmFirst ? m.SecondTeamText : m.FirstTeamText;
  const oppId = iAmFirst ? m.SecondTeamId : m.FirstTeamId;
  // Sets have FirstTeamScore / SecondTeamScore
  const myScores: number[] = [];
  const oppScores: number[] = [];
  for (const s of m.Sets || []) {
    const mine = iAmFirst ? s.FirstTeamScore : s.SecondTeamScore;
    const opp = iAmFirst ? s.SecondTeamScore : s.FirstTeamScore;
    if (mine == null && opp == null) continue;
    myScores.push(Number(mine ?? 0));
    oppScores.push(Number(opp ?? 0));
  }
  const mySetsWon = myScores.reduce(
    (n, s, i) => n + (s > (oppScores[i] ?? 0) ? 1 : 0),
    0
  );
  const oppSetsWon = myScores.reduce(
    (n, s, i) => n + ((oppScores[i] ?? 0) > s ? 1 : 0),
    0
  );
  const iWon = iAmFirst ? !!m.FirstTeamWon : !!m.SecondTeamWon;
  // PlayType: 0 = pool, 1 = playoff (from AES conventions)
  const isPool = (m.PlayType ?? 0) !== 1;
  const roundLabel =
    m.PlayName || m.MatchShortName || (isPool ? 'Pool Play' : 'Playoffs');
  // Parse the schedule string venue-tz-aware: AES feeds us `"…T09:00:00"`
  // without a tz suffix, which actually means 9 AM at the venue. The cached
  // dateText/time strings are stamped venue-local too so downstream renders
  // are consistent regardless of where the user opens the snapshot from.
  const dateMs = parseScheduleTime(m.ScheduledStartDateTime, venueTz) ?? 0;
  const dateText = dateMs
    ? formatInVenueTz(dateMs, venueTz, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : '';
  const time = dateMs
    ? formatInVenueTz(dateMs, venueTz, {
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';
  return {
    matchId: m.MatchId,
    dateMs,
    dateText,
    time,
    court: m.Court?.Name || '',
    roundLabel,
    isPool,
    opponentTeamId: oppId,
    opponentText: oppText || '',
    mySetsWon,
    oppSetsWon,
    myScores,
    oppScores,
    iWon,
    hasScores: !!m.HasScores,
    // Note: `mineText` captured above isn't stored — the snapshot's
    // myTeamText field is authoritative for our identity.
  };
}

function parseIsoDate(s: unknown): number | undefined {
  if (!s || typeof s !== 'string') return undefined;
  const ms = Date.parse(s);
  return isFinite(ms) ? ms : undefined;
}

function formatEventDateRange(event: AESEvent): string {
  const start = parseIsoDate(event.StartDate);
  const end = parseIsoDate(event.EndDate);
  if (!start) return '';
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  const sMonth = s.toLocaleDateString('en-US', { month: 'short' });
  const sDay = s.getDate();
  if (!e || s.toDateString() === e.toDateString()) {
    return `${sMonth} ${sDay}, ${s.getFullYear()}`;
  }
  const eMonth = e.toLocaleDateString('en-US', { month: 'short' });
  const eDay = e.getDate();
  if (sMonth === eMonth && s.getFullYear() === e.getFullYear()) {
    return `${sMonth} ${sDay} \u2013 ${eDay}, ${s.getFullYear()}`;
  }
  return `${sMonth} ${sDay} \u2013 ${eMonth} ${eDay}, ${s.getFullYear()}`;
}

// ── Queries ───────────────────────────────────────────────────────────────

/** All indexed AES snapshots, sorted newest first. */
export function sortedAesSnapshots(
  index: AesSeasonIndex
): AesTournamentSnapshot[] {
  return Object.values(index).sort((a, b) => {
    const da = a.dateMs ?? 0;
    const db = b.dateMs ?? 0;
    return db - da;
  });
}

/**
 * Get the AES snapshots where a team (by numeric id) participated.
 * AES team IDs vary across events, so callers should resolve the user's
 * team identity on a per-event basis. When identity isn't known, fall
 * back to `getAesTeamHistoryByName`.
 */
export function getAesTeamHistoryById(
  index: AesSeasonIndex,
  teamId: number
): AesTournamentSnapshot[] {
  return sortedAesSnapshots(index).filter((s) => s.myTeamId === teamId);
}

/**
 * AES team text is reasonably stable across events (they typically use
 * the same club+squad name). Use this for cross-tournament "my season"
 * views where we only know the user's name, not every per-event teamId.
 *
 * Matches against `myTeamText` (the name we saw in that event). Normalizes
 * whitespace + case.
 */
export function getAesTeamHistoryByName(
  index: AesSeasonIndex,
  aliases: string[]
): AesTournamentSnapshot[] {
  const wanted = new Set(aliases.map(norm).filter(Boolean));
  if (wanted.size === 0) return [];
  return sortedAesSnapshots(index).filter(
    (s) => wanted.has(norm(s.myTeamText)) || wanted.has(norm(s.myTeamName))
  );
}

function norm(s: string): string {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}
