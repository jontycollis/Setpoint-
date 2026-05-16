// AES API Client
const BASE_URL = 'https://results.advancedeventsystems.com';

import type {
  AESEvent,
  AESDivision,
  AESTeamAssignment,
  AESStanding,
} from '../types/aes';
import { cachedFetch } from '../utils/apiCache';
import type { CacheFetchOptions } from '../utils/apiCache';
import type { Country } from '../config/tournaments';
import type { LoaderResult } from '../utils/loaderResult';
import { errorMessage } from '../utils/loaderResult';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  // Append a cache-busting timestamp so we never serve stale data from the
  // OS HTTP cache or a CDN. AES standings/scores change live during a
  // tournament and need to be refetched every time the screen loads.
  const bust = `_t=${Date.now()}`;
  const bustedUrl = url.includes('?') ? `${url}&${bust}` : `${url}?${bust}`;
  const response = await fetch(bustedUrl, {
    headers: {
      'Accept': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
    },
    // React Native honors this on modern runtimes; falls through harmlessly
    // on older ones because the URL cache-buster and headers still prevent
    // cached responses.
    cache: 'no-store' as RequestCache,
  });
  if (!response.ok) {
    throw new Error(`AES API error: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  if (!text || text.trim().length === 0) {
    // AES API sometimes returns empty body for endpoints with no data
    return [] as unknown as T;
  }
  if (text.startsWith('<')) {
    throw new Error('API returned HTML instead of JSON');
  }
  return JSON.parse(text);
}

function odataUrl(eventKey: string, path: string, params?: string): string {
  const base = `${BASE_URL}/odata/${eventKey}/${path}`;
  return params ? `${base}?${params}` : base;
}

function apiUrl(eventKey: string, path: string): string {
  return `${BASE_URL}/api/event/${eventKey}/${path}`;
}

// ─── Event ──────────────────────────────────────────────────────────────────

export async function getEvent(eventKey: string): Promise<AESEvent> {
  return fetchJson<AESEvent>(`${BASE_URL}/api/event/${eventKey}`);
}

export interface UtilizedDate {
  DateTime: string;
  IsCurrent: boolean;
}

export async function getUtilizedDates(eventKey: string): Promise<UtilizedDate[]> {
  return fetchJson<UtilizedDate[]>(apiUrl(eventKey, 'utilizeddates'));
}

// ─── Division ───────────────────────────────────────────────────────────────

export interface PlayDay {
  HasPools: boolean;
  HasBrackets: boolean;
  DateTime: string;
  IsCurrent: boolean;
}

export async function getPlayDays(
  eventKey: string,
  divisionId: number
): Promise<PlayDay[]> {
  return fetchJson<PlayDay[]>(apiUrl(eventKey, `division/${divisionId}/playdays`));
}

/** Pools with team standings for a given day */
export interface PoolData {
  PlayId: number;
  PlayType: number;
  FullName: string;
  ShortName: string;
  CompleteShortName: string;
  CompleteFullName: string;
  Courts: string;
  Order: number;
  Teams: PoolTeam[];
}

export interface PoolTeam {
  TeamId: number;
  TeamName: string;
  TeamCode: string;
  TeamText: string;
  MatchesWon: number;
  MatchesLost: number;
  MatchPercent: string;
  SetsWon: number;
  SetsLost: number;
  SetPercent: string;
  PointRatio: string;
  FinishRank: number | null;
  OverallRank: number | null;
  Club: { ClubId: number; Name: string };
  Division: { DivisionId: number; Name: string; CodeAlias: string; ColorHex: string };
}

export async function getPlays(
  eventKey: string,
  divisionId: number,
  date: string
): Promise<PoolData[]> {
  return fetchJson<PoolData[]>(apiUrl(eventKey, `division/${divisionId}/plays/${date}`));
}

/** Find a specific pool/play by PlayId (scans all play days) */
export async function getPoolByPlayId(
  eventKey: string,
  divisionId: number,
  playId: number
): Promise<PoolData | null> {
  const days = await getPlayDays(eventKey, divisionId);
  for (const day of days) {
    try {
      const plays = await getPlays(eventKey, divisionId, day.DateTime);
      const found = plays.find((p) => p.PlayId === playId);
      if (found) return found;
    } catch {
      // Skip days that fail
    }
  }
  return null;
}

// ─── Teams (OData) ──────────────────────────────────────────────────────────

export async function getTeamAssignments(
  eventKey: string,
  divisionId: number,
  clubId?: number | null,
  teamIds?: number[]
): Promise<AESTeamAssignment[]> {
  const cId = clubId ?? 'null';
  const tIds = teamIds ? JSON.stringify(teamIds) : '[]';
  const url = odataUrl(
    eventKey,
    `nextassignments(dId=${divisionId},cId=${cId},tIds=${tIds})`,
    '$skip=0&$orderby=TeamName,TeamCode'
  );
  const result = await fetchJson<{ value: AESTeamAssignment[] }>(url);
  return result.value;
}

// ─── Team Schedule (per-team endpoints) ────────────────────────────────────

/** A single match inside a team schedule response */
export interface TeamScheduleMatch {
  MatchId: number;
  FirstTeamId: number;
  FirstTeamName: string;
  FirstTeamWon: boolean;
  FirstTeamText: string;
  SecondTeamId: number;
  SecondTeamName: string;
  SecondTeamWon: boolean;
  SecondTeamText: string;
  MatchFullName: string;
  MatchShortName: string;
  HasScores: boolean;
  Sets: MatchSet[];
  WorkTeamText: string;
  TypeOfOutcome: number;
  Court: { CourtId: number; Name: string; VideoLink: string };
  ScheduledStartDateTime: string; // ISO date string
  ScheduledEndDateTime: string;
}

/** A play group inside a current schedule response (has Matches array) */
export interface TeamSchedulePlay {
  Play: {
    Type: number;
    PlayId: number;
    FullName: string;
    ShortName: string;
    CompleteShortName: string;
    CompleteFullName: string;
    Order: number;
    Courts: { CourtId: number; Name: string; VideoLink: string }[];
  };
  PlayType: number;
  Matches: TeamScheduleMatch[];
}

/** A single item in a past schedule response (has single Match, NOT Matches array) */
export interface TeamPastScheduleItem {
  Match: TeamScheduleMatch;
  Play: {
    Type: number;
    PlayId: number;
    FullName: string;
    ShortName: string;
    CompleteShortName: string;
    CompleteFullName: string;
    Order: number;
    Courts: { CourtId: number; Name: string; VideoLink: string }[];
  };
  PlayType: number;
}

/** A row in the future schedule response */
export interface TeamFutureScheduleRow {
  PotentialRank: number;
  PotentialRankText: string;
  NextMatch: {
    MatchId: number;
    Court: { CourtId: number; Name: string; VideoLink: string };
    ScheduledStartDateTime: string;
    ScheduledEndDateTime: string;
  } | null;
  WorkMatch: {
    MatchId: number;
    Court: { CourtId: number; Name: string; VideoLink: string };
    ScheduledStartDateTime: string;
    ScheduledEndDateTime: string;
  } | null;
  NextPlay: {
    Type: number;
    PlayId: number;
    FullName: string;
    ShortName: string;
    CompleteShortName: string;
    CompleteFullName: string;
    Order: number;
    Courts: { CourtId: number; Name: string; VideoLink: string }[];
  } | null;
  PlayType: number;
  NextPendingReseed: boolean;
}

/**
 * Current schedule for a team — today's matches with full set scores.
 * Endpoint: /api/event/{key}/division/{dId}/team/{tId}/schedule/current
 */
export async function getTeamCurrentSchedule(
  eventKey: string,
  divisionId: number,
  teamId: number
): Promise<TeamSchedulePlay[]> {
  return fetchJson<TeamSchedulePlay[]>(
    apiUrl(eventKey, `division/${divisionId}/team/${teamId}/schedule/current`)
  );
}

/**
 * Future schedule — rank-based next-match possibilities.
 * Endpoint: /api/event/{key}/division/{dId}/team/{tId}/schedule/future
 */
export async function getTeamFutureSchedule(
  eventKey: string,
  divisionId: number,
  teamId: number
): Promise<TeamFutureScheduleRow[]> {
  return fetchJson<TeamFutureScheduleRow[]>(
    apiUrl(eventKey, `division/${divisionId}/team/${teamId}/schedule/future`)
  );
}

/**
 * Past schedule — completed matches from previous days.
 * NOTE: Returns a DIFFERENT shape than /schedule/current!
 * Each item has a single `Match` (not a `Matches` array).
 * Endpoint: /api/event/{key}/division/{dId}/team/{tId}/schedule/past
 */
export async function getTeamPastSchedule(
  eventKey: string,
  divisionId: number,
  teamId: number
): Promise<TeamPastScheduleItem[]> {
  return fetchJson<TeamPastScheduleItem[]>(
    apiUrl(eventKey, `division/${divisionId}/team/${teamId}/schedule/past`)
  );
}

/** A TeamScheduleMatch enriched with play context */
export interface EnrichedScheduleMatch extends TeamScheduleMatch {
  PlayId?: number;
  PlayType?: number; // 0 = pool, 1 = bracket
  PlayName?: string;
}

/**
 * Helper: extract all TeamScheduleMatch objects from both current and past
 * schedule responses, normalising the two different shapes into a flat list.
 * Each match is enriched with PlayId and PlayType from its parent play.
 */
export function extractAllScheduleMatches(
  currentSchedule: TeamSchedulePlay[],
  pastSchedule: TeamPastScheduleItem[]
): EnrichedScheduleMatch[] {
  const matches: EnrichedScheduleMatch[] = [];
  for (const sp of currentSchedule) {
    if (Array.isArray(sp.Matches)) {
      for (const m of sp.Matches) {
        matches.push({
          ...m,
          PlayId: sp.Play?.PlayId,
          PlayType: sp.PlayType ?? sp.Play?.Type,
          PlayName: sp.Play?.CompleteShortName || sp.Play?.ShortName || sp.Play?.FullName,
        });
      }
    }
  }
  for (const item of pastSchedule) {
    if (item.Match) {
      matches.push({
        ...item.Match,
        PlayId: item.Play?.PlayId,
        PlayType: item.PlayType ?? item.Play?.Type,
        PlayName: item.Play?.CompleteShortName || item.Play?.ShortName || item.Play?.FullName,
      });
    }
  }
  return matches;
}

// ─── Standings (OData) ──────────────────────────────────────────────────────

export async function getStandings(
  eventKey: string,
  divisionId: number
): Promise<AESStanding[]> {
  const url = odataUrl(
    eventKey,
    `standings(dId=${divisionId},cId=null,tIds=[])`,
    '$skip=0&$orderby=OverallRank,FinishRank,TeamCode'
  );
  const result = await fetchJson<{ value: AESStanding[] }>(url);
  return result.value;
}

// ─── Court Schedule ─────────────────────────────────────────────────────────

export interface CourtScheduleResponse {
  EarliestStartTime: number;
  LatestEndTime: number;
  CourtSchedules: CourtScheduleGroup[];
}

export interface CourtScheduleGroup {
  CourtId: number;
  Name: string;
  VideoLink: string;
  CourtMatches: CourtMatch[];
}

export interface CourtMatch {
  MatchId: number;
  Division: {
    DivisionId: number;
    Name: string;
    TeamCount: number;
    CodeAlias: string;
    ColorHex: string;
  };
  ScoreKioskCode: string;
  FirstTeamText: string;
  SecondTeamText: string;
  WorkTeamText: string;
  CompleteShortName: string;
  ScheduledStartDateTime: number; // Unix timestamp in ms
  ScheduledEndDateTime: number;
  HasOutcome: boolean;
}

export async function getCourtSchedule(
  eventKey: string,
  date: string,
  minuteOffset: number = 240
): Promise<CourtScheduleResponse> {
  return fetchJson<CourtScheduleResponse>(
    apiUrl(eventKey, `courts/${date}/${minuteOffset}`)
  );
}

/** Flatten court schedule into a flat list of matches with court name attached */
export interface FlatCourtMatch extends CourtMatch {
  CourtName: string;
  CourtVideoLink: string;
}

export function flattenCourtSchedule(response: CourtScheduleResponse): FlatCourtMatch[] {
  const matches: FlatCourtMatch[] = [];
  for (const court of response.CourtSchedules) {
    for (const match of court.CourtMatches) {
      matches.push({ ...match, CourtName: court.Name, CourtVideoLink: court.VideoLink || '' });
    }
  }
  matches.sort((a, b) => a.ScheduledStartDateTime - b.ScheduledStartDateTime);
  return matches;
}

/** Find all court matches involving a team (by TeamText match) */
export function filterMatchesForTeam(
  matches: FlatCourtMatch[],
  teamText: string
): FlatCourtMatch[] {
  const search = teamText.toLowerCase();
  return matches.filter(
    (m) =>
      m.FirstTeamText.toLowerCase() === search ||
      m.SecondTeamText.toLowerCase() === search
  );
}

/** Find all court matches for a specific division */
export function filterMatchesForDivision(
  matches: FlatCourtMatch[],
  divisionId: number
): FlatCourtMatch[] {
  return matches.filter((m) => m.Division.DivisionId === divisionId);
}

// ─── Brackets ───────────────────────────────────────────────────────────────

export interface BracketSet {
  FirstTeamScore: number | null;
  SecondTeamScore: number | null;
  ScoreText: string;
  IsDecidingSet: boolean;
}

export interface BracketMatch {
  MatchId?: number;
  FirstTeam: any | null;
  SecondTeam: any | null;
  FirstTeamText: string;
  SecondTeamText: string;
  FullName: string;
  ShortName: string;
  HasScores: boolean;
  FirstTeamWon: boolean;
  SecondTeamWon: boolean;
  Sets: BracketSet[];
  ScheduledStartDateTime?: number;
  Court?: { Name: string; VideoLink?: string } | null;
}

export interface BracketNode {
  Key: number;
  X: number; // round (0 = first round)
  Y: number; // position within round
  Reversed: boolean;
  DoubleCapped: boolean;
  Match: BracketMatch;
  TopSource: BracketNode | null;
  BottomSource: BracketNode | null;
}

export interface BracketData {
  Roots: BracketNode[];
  PlayType: number;
  BracketNotes: string | null;
  FutureRoundMatches: any[];
  Type: number;
  PlayId: number;
  FullName: string;
  ShortName: string;
  CompleteShortName: string;
  CompleteFullName: string;
  Order: number;
  Courts: string;
}

/** Get bracket/play detail by PlayId */
export async function getPlayDetail(
  eventKey: string,
  playId: number
): Promise<BracketData> {
  return fetchJson<BracketData>(apiUrl(eventKey, `play/${playId}`));
}

/** Flatten a bracket tree into a sorted list of matches with round info */
export interface FlatBracketMatch {
  round: number;
  position: number;
  match: BracketMatch;
  /** Index of the root this match belongs to (0 = main championship tree) */
  rootIndex: number;
}

export function flattenBracketTree(roots: BracketNode[]): FlatBracketMatch[] {
  const matches: FlatBracketMatch[] = [];

  function walk(node: BracketNode | null, rootIdx: number) {
    if (!node) return;
    matches.push({
      round: node.X,
      position: node.Y,
      match: node.Match,
      rootIndex: rootIdx,
    });
    walk(node.TopSource, rootIdx);
    walk(node.BottomSource, rootIdx);
  }

  for (let i = 0; i < roots.length; i++) {
    walk(roots[i], i);
  }

  // Sort by round then position
  matches.sort((a, b) => a.round - b.round || a.position - b.position);
  return matches;
}

// ─── Division Bracket Matches ───────────────────────────────────────────────

export interface BracketMatchWithContext {
  bracketPlayId: number;
  bracketShortName: string;
  bracketFullName: string;
  round: number;
  position: number;
  match: BracketMatch;
}

/**
 * Walk every bracket play in a division and return all bracket matches with
 * their parent-bracket context. Used to render AES-style "Future Matches"
 * (rank → next match) by pool.
 */
export async function getDivisionBracketMatches(
  eventKey: string,
  divisionId: number
): Promise<BracketMatchWithContext[]> {
  const out: BracketMatchWithContext[] = [];
  const seenPlayIds = new Set<number>();

  let days: PlayDay[] = [];
  try {
    days = await getPlayDays(eventKey, divisionId);
  } catch {
    return out;
  }

  for (const day of days) {
    let plays: PoolData[] = [];
    try {
      plays = await getPlays(eventKey, divisionId, day.DateTime);
    } catch {
      continue;
    }
    for (const p of plays) {
      if (seenPlayIds.has(p.PlayId)) continue;
      seenPlayIds.add(p.PlayId);
      // Try every play — if getPlayDetail returns a Roots tree, it's a
      // bracket-shaped play. We don't filter on Type/PlayType here because
      // some AES events publish Future Matches off plays whose Type field
      // isn't 1 (crossovers, pool-bracket hybrids, etc.). Non-bracket plays
      // just won't have Roots and will be skipped.
      try {
        const detail = await getPlayDetail(eventKey, p.PlayId);
        if (!detail?.Roots || detail.Roots.length === 0) continue;
        const flat = flattenBracketTree(detail.Roots);
        for (const fm of flat) {
          out.push({
            bracketPlayId: detail.PlayId,
            bracketShortName: detail.ShortName || detail.CompleteShortName || '',
            bracketFullName: detail.FullName || detail.CompleteFullName || '',
            round: fm.round,
            position: fm.position,
            match: fm.match,
          });
        }
      } catch {
        // skip bad play
      }
    }
  }
  return out;
}

// ─── Match Results / Scores ─────────────────────────────────────────────────

export interface MatchSet {
  FirstTeamScore: number | null;
  SecondTeamScore: number | null;
  ScoreText?: string;
  IsDecidingSet?: boolean;
}

export interface MatchResult {
  MatchId: number;
  HasScores: boolean;
  FirstTeamWon: boolean;
  SecondTeamWon: boolean;
  FirstTeamText: string;
  SecondTeamText: string;
  Sets: MatchSet[];
}

function normalizeMatch(m: any, fallbackId?: number): MatchResult {
  const sets: MatchSet[] = Array.isArray(m.Sets)
    ? m.Sets.map((s: any) => ({
        FirstTeamScore:
          s.FirstTeamScore ?? s.HomeScore ?? s.FirstScore ?? null,
        SecondTeamScore:
          s.SecondTeamScore ?? s.AwayScore ?? s.SecondScore ?? null,
        ScoreText: s.ScoreText,
        IsDecidingSet: s.IsDecidingSet,
      }))
    : [];
  return {
    MatchId: m.MatchId ?? fallbackId ?? 0,
    HasScores:
      !!m.HasScores ||
      sets.some(
        (s) => s.FirstTeamScore !== null || s.SecondTeamScore !== null
      ),
    FirstTeamWon: !!m.FirstTeamWon,
    SecondTeamWon: !!m.SecondTeamWon,
    FirstTeamText: m.FirstTeamText || '',
    SecondTeamText: m.SecondTeamText || '',
    Sets: sets,
  };
}

/**
 * Pool-play match results. Tries /api/event/{key}/play/{playId} on a pool
 * PlayId and extracts matches with sets. Different event configurations
 * return this data in slightly different shapes, so we defensively normalize.
 */
export async function getPoolMatches(
  eventKey: string,
  playId: number
): Promise<MatchResult[]> {
  try {
    const data: any = await fetchJson<any>(apiUrl(eventKey, `play/${playId}`));
    const out: MatchResult[] = [];

    const candidateMatches: any[] =
      (Array.isArray(data?.Matches) && data.Matches) ||
      (Array.isArray(data?.PoolMatches) && data.PoolMatches) ||
      [];
    for (const m of candidateMatches) {
      if (!m) continue;
      out.push(normalizeMatch(m));
    }

    if (Array.isArray(data?.Roots)) {
      const stack: any[] = [...data.Roots];
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node) continue;
        if (node.Match) out.push(normalizeMatch(node.Match, node.Match.MatchId));
        if (node.TopSource) stack.push(node.TopSource);
        if (node.BottomSource) stack.push(node.BottomSource);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Fetch result + set scores for a single match.
 *
 * AES does NOT expose a per-match endpoint (/match/{id} returns 404), so we
 * load all match results for the division in one go via `getAllDivisionMatchResults`
 * and look up the requested match from the resulting map.
 *
 * NOTE: only *positive* results (HasScores === true) are cached. Negative
 * results (no scores yet) are re-fetched every call so that new set scores
 * appear as soon as AES publishes them.
 */
const matchResultCache = new Map<string, MatchResult>();

export function clearMatchResultCache(): void {
  matchResultCache.clear();
  divisionResultsCache.clear();
}

export async function getMatchResult(
  eventKey: string,
  matchId: number,
  divisionId?: number
): Promise<MatchResult | null> {
  const cacheKey = `${eventKey}:${matchId}`;
  if (matchResultCache.has(cacheKey)) {
    return matchResultCache.get(cacheKey) ?? null;
  }
  if (!divisionId) {
    return null;
  }
  // Load all division match results (cached per-division).
  try {
    const map = await getAllDivisionMatchResults(eventKey, divisionId);
    const found = map.get(matchId) || null;
    if (found && found.HasScores) {
      matchResultCache.set(cacheKey, found);
    }
    return found;
  } catch {
    return null;
  }
}

/**
 * Build a map of MatchId → MatchResult for a whole division by iterating all
 * playdays and play IDs. Used to enrich the court schedule with set scores.
 *
 * Results are cached per division for 60 seconds to avoid hammering the API
 * when multiple modals/screens request data for the same division.
 */
const divisionResultsCache = new Map<string, { ts: number; map: Map<number, MatchResult> }>();
const DIVISION_CACHE_TTL = 60_000; // 60 seconds

export async function getAllDivisionMatchResults(
  eventKey: string,
  divisionId: number
): Promise<Map<number, MatchResult>> {
  const cacheKey = `${eventKey}:${divisionId}`;
  const cached = divisionResultsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < DIVISION_CACHE_TTL) {
    return cached.map;
  }

  const map = new Map<number, MatchResult>();
  try {
    const days = await getPlayDays(eventKey, divisionId);
    for (const day of days) {
      try {
        const plays = await getPlays(eventKey, divisionId, day.DateTime);
        for (const p of plays) {
          const results = await getPoolMatches(eventKey, p.PlayId);
          for (const r of results) {
            if (r.MatchId && r.HasScores) map.set(r.MatchId, r);
          }
        }
      } catch {
        // skip day
      }
    }
  } catch {
    // ignore
  }

  divisionResultsCache.set(cacheKey, { ts: Date.now(), map });
  return map;
}

// ─── URL Parsing ────────────────────────────────────────────────────────────

export function extractEventKey(url: string): string | null {
  const match = url.match(
    /results\.advancedeventsystems\.com\/event\/([A-Za-z0-9_\-=]+)/
  );
  return match ? match[1] : null;
}

// ─── Cached API wrappers ──────────────────────────────────────────────────
// These wrap existing functions with offline-first caching. Use these from
// screens/components; the uncached versions remain available for internal use.

/** Cached getEvent — TTL 5 min (event metadata rarely changes) */
export function getCachedEvent(
  eventKey: string,
  opts?: CacheFetchOptions
): Promise<AESEvent> {
  return cachedFetch(
    'event',
    { eventKey },
    () => getEvent(eventKey),
    { ttl: 300_000, ...opts }
  );
}

/** Cached team schedule (current) — TTL 60s (live scores) */
export function getCachedTeamCurrentSchedule(
  eventKey: string,
  divisionId: number,
  teamId: number,
  opts?: CacheFetchOptions
): Promise<TeamSchedulePlay[]> {
  return cachedFetch(
    'teamCurrentSchedule',
    { eventKey, divisionId, teamId },
    () => getTeamCurrentSchedule(eventKey, divisionId, teamId),
    { ttl: 60_000, ...opts }
  );
}

/** Cached team schedule (past) — TTL 5 min (completed games don't change often) */
export function getCachedTeamPastSchedule(
  eventKey: string,
  divisionId: number,
  teamId: number,
  opts?: CacheFetchOptions
): Promise<TeamPastScheduleItem[]> {
  return cachedFetch(
    'teamPastSchedule',
    { eventKey, divisionId, teamId },
    () => getTeamPastSchedule(eventKey, divisionId, teamId),
    { ttl: 300_000, ...opts }
  );
}

/** Cached team assignments — TTL 2 min */
export function getCachedTeamAssignments(
  eventKey: string,
  divisionId: number,
  clubId?: number | null,
  teamIds?: number[],
  opts?: CacheFetchOptions
): Promise<AESTeamAssignment[]> {
  return cachedFetch(
    'teamAssignments',
    { eventKey, divisionId, clubId, teamIds },
    () => getTeamAssignments(eventKey, divisionId, clubId, teamIds),
    { ttl: 120_000, ...opts }
  );
}

/** Cached standings — TTL 2 min */
export function getCachedStandings(
  eventKey: string,
  divisionId: number,
  opts?: CacheFetchOptions
): Promise<AESStanding[]> {
  return cachedFetch(
    'standings',
    { eventKey, divisionId },
    () => getStandings(eventKey, divisionId),
    { ttl: 120_000, ...opts }
  );
}

/** Cached court schedule — TTL 60s */
export function getCachedCourtSchedule(
  eventKey: string,
  date: string,
  minuteOffset?: number,
  opts?: CacheFetchOptions
): Promise<CourtScheduleResponse> {
  return cachedFetch(
    'courtSchedule',
    { eventKey, date, minuteOffset },
    () => getCourtSchedule(eventKey, date, minuteOffset),
    { ttl: 60_000, ...opts }
  );
}

// ─── Dynamic Tournament Discovery ─────────────────────────────────────────

const AES_EVENTS_API =
  'https://www.advancedeventsystems.com/api/landing/events';

/** Shape of an event object from the AES events listing API */
export interface AESListingEvent {
  eventSchedulerId: number;
  eventSchedulerKey: string;
  name: string;
  startDate: string; // ISO
  endDate: string; // ISO
  locationName: string | null;
  address: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null;
  affiliation: { name?: string } | null;
  eventType: { name?: string } | null;
  isSchedulerPosted: boolean;
  isPastEvent: boolean;
}

interface AESListingResponse {
  '@odata.count'?: number;
  value: AESListingEvent[];
}

/** Canadian province/territory codes for filtering */
const CA_PROVINCE_CODES = new Set([
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
]);

/** Keywords that identify a Canadian event by name */
const CA_NAME_PATTERNS = [
  /\bcanad/i,
  /\bova\b/i,
  /\bontario\b/i,
  /\balberta\b/i,
  /\bbritish.?columbia\b/i,
  /\bquebec\b/i,
  /\bmanitoba\b/i,
  /\bsaskatchewan\b/i,
  /\bnova.?scotia\b/i,
  /\bnew.?brunswick\b/i,
  /\bvolleyball.?canada\b/i,
  // Canadian city names commonly used in Nationals event names
  /\bmoncton\b/i,
  /\bcalgary\b/i,
  /\bedmonton\b/i,
  /\bottawa\b/i,
  /\bmississauga\b/i,
  /\bwinnipeg\b/i,
  /\bfredericton\b/i,
  /\bvancouver\b/i,
  /\bmontreal\b/i,
  /\btoronto\b/i,
];

/** Check whether an event looks Canadian */
function isCanadianEvent(event: AESListingEvent): boolean {
  // Check state/province code
  const state = event.address?.state;
  if (typeof state === 'string' && state.length > 0 && CA_PROVINCE_CODES.has(state.toUpperCase())) {
    return true;
  }
  // Check name patterns
  return CA_NAME_PATTERNS.some((re) => re.test(event.name));
}

/**
 * Normalize an event object from the API. The AES OData API may return
 * either camelCase or PascalCase field names depending on the endpoint
 * version, so we handle both defensively.
 */
function normalizeListingEvent(raw: any): AESListingEvent {
  return {
    eventSchedulerId: raw.eventSchedulerId ?? raw.EventSchedulerId ?? 0,
    eventSchedulerKey: raw.eventSchedulerKey ?? raw.EventSchedulerKey ?? '',
    name: raw.name ?? raw.Name ?? '',
    startDate: raw.startDate ?? raw.StartDate ?? '',
    endDate: raw.endDate ?? raw.EndDate ?? '',
    locationName: raw.locationName ?? raw.LocationName ?? null,
    address: raw.address ?? raw.Address ?? null,
    affiliation: raw.affiliation ?? raw.Affiliation ?? null,
    eventType: raw.eventType ?? raw.EventType ?? null,
    isSchedulerPosted: raw.isSchedulerPosted ?? raw.IsSchedulerPosted ?? false,
    isPastEvent: raw.isPastEvent ?? raw.IsPastEvent ?? false,
  };
}

export async function fetchCanadianEvents(
  options: { includePast?: boolean } = {}
): Promise<AESListingEvent[]> {
  // Server-side filter is required — the AES landing endpoint has 23k+ events
  // globally, so an unfiltered $top=200 page never reaches Canadian content.
  // Match by name keyword since address.state is null on Canadian events.
  // Broad keyword set: 'canada' catches "Volleyball Canada Nationals",
  // 'national' catches "14U Nationals Moncton" naming variants,
  // 'ontario'/'ova' catch OVA/OC events.
  const caNameFilter = [
    "contains(tolower(name),'canada')",
    "contains(tolower(name),'national')",
    "contains(tolower(name),'ontario')",
    "contains(tolower(name),'ova')",
  ].join(' or ');
  // We intentionally do NOT use isPastEvent for the default call.
  // AES marks events as "past" once their start date has passed, even if the
  // event is still underway — this caused ongoing Nationals to be invisible.
  // Instead, we use a date-based cutoff: include any event whose end date is
  // within the last 30 days or in the future. This captures ongoing + upcoming
  // events without pulling in years of history.
  //
  // Anchor the cutoff in device-local calendar time, not UTC: slicing the
  // ISO string off a `Date` produces a UTC date which rolls back to
  // "yesterday" for users west of UTC late at night. For a North American
  // user that translates to filter-by-tomorrow-at-the-event, which can
  // hide events that just started. `en-CA` locale renders ISO YYYY-MM-DD.
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);
  const cutoffStr = cutoffDate.toLocaleDateString('en-CA');
  const filter = options.includePast
    ? `(${caNameFilter})`
    : `endDate ge ${cutoffStr} and (${caNameFilter})`;
  const params = new URLSearchParams({
    $count: 'true',
    $format: 'json',
    $orderby: 'startDate desc,name',
    // 500 is well above the typical Canadian-event count across all years
    // (the earlier probe showed ~16 with "canada" + ~31 with "ontario"),
    // so we should never paginate.
    $top: options.includePast ? '500' : '200',
    $filter: filter,
  });
  const url = `${AES_EVENTS_API}?${params.toString()}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`AES listing API error: ${response.status}`);
  }
  const data = await response.json();
  // OData wraps results in "value"; fall back to array if the response is
  // already a plain array (some OData implementations vary)
  const rawEvents: any[] = data.value ?? data ?? [];
  return rawEvents.map(normalizeListingEvent).filter(isCanadianEvent);
}

/**
 * Attempt to group events into logical tournament buckets by analysing their
 * names. For example "2025 Volleyball Canada Nationals - 15UG & 17UB" should
 * map to tournament id "canadian-nationals" and year 2025.
 */
export interface DiscoveredTournament {
  tournamentId: string;
  tournamentName: string;
  shortName: string;
  icon: string;
  year: number;
  events: {
    key: string;
    label: string;
    subtitle: string;
    dates: string;
    venue?: string;
    isSchedulerPosted: boolean;
  }[];
}

/** Well-known tournament patterns for grouping */
const TOURNAMENT_PATTERNS: {
  id: string;
  name: string;
  shortName: string;
  icon: string;
  pattern: RegExp;
}[] = [
  {
    id: 'ontario-championships',
    name: 'Ontario Championships',
    shortName: 'OCs',
    icon: '🏐',
    pattern: /ontario.?champion/i,
  },
  {
    id: 'canadian-nationals',
    name: 'Canadian National Championships',
    shortName: 'Nationals',
    icon: '🏆',
    // Match various AES naming patterns for Canadian Nationals:
    // - "2026 Volleyball Canada Nationals - 14UB & 15UB"
    // - "2026 Volleyball Canada 14U Nationals Moncton"
    // - "Canadian National Championships"
    // - "2026 14U Nationals Calgary" (with 'canada' in server filter)
    pattern: /(?:volleyball.?canada|canadian).{0,20}national|national.{0,20}(?:volleyball.?canada|canadian)|\b\d{2,3}U\w?\s+Nationals?\b/i,
  },
  {
    id: 'new-year-classic',
    name: 'New Year Classic',
    shortName: 'NYC',
    icon: '🎆',
    pattern: /new.?year/i,
  },
];

function extractYearFromEvent(event: AESListingEvent): number {
  // Try to extract year from the event name first (e.g. "2026_OVA_New_Year...")
  const nameMatch = event.name.match(/\b(20\d{2})\b/);
  if (nameMatch) return parseInt(nameMatch[1], 10);
  // Fall back to start date
  return new Date(event.startDate).getFullYear();
}

function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  if (start.getMonth() === end.getMonth()) {
    return `${months[start.getMonth()]} ${start.getDate()} – ${end.getDate()}`;
  }
  return `${months[start.getMonth()]} ${start.getDate()} – ${months[end.getMonth()]} ${end.getDate()}`;
}

/** Simplify a long AES event name into a readable label + subtitle */
function parseEventLabel(name: string): { label: string; subtitle: string } {
  // Pattern: "2026 Volleyball Canada 14U Nationals Moncton"
  // → label: "Moncton — 14U", subtitle: "14U (Moncton)"
  const nationalsMatch = name.match(
    /(\d{2,3}U[BG]?)\s+Nationals?\s+([A-Z][a-zA-Z\s]+?)$/i
  );
  if (nationalsMatch) {
    const ageGroup = nationalsMatch[1].toUpperCase();
    const city = nationalsMatch[2].trim();
    return { label: `${city} — ${ageGroup}`, subtitle: `${ageGroup} (${city})` };
  }

  // Pattern: "2025 Volleyball Canada Nationals - 15UG & 17UB"
  const dashIdx = name.lastIndexOf(' - ');
  if (dashIdx >= 0) {
    const after = name.substring(dashIdx + 3).trim();
    // If the part after dash contains age groups, extract city from before
    // e.g., "Mississauga - 14UB & 15UB"
    return { label: after, subtitle: after };
  }

  // Pattern: "2026 Volleyball Canada Nationals 14UB 15UB" (underscore-separated)
  const ageGroupMatch = name.match(/Nationals?\s+.*?(\d{2,3}U[BG]?\b(?:\s*(?:&|,|and)\s*\d{2,3}U[BG]?\b)*)/i);
  if (ageGroupMatch) {
    return { label: ageGroupMatch[1], subtitle: ageGroupMatch[1] };
  }

  // Try generic separator
  const parts = name.split(/\s*[-–—]\s*/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1].trim();
    return { label: last, subtitle: last };
  }
  return { label: name, subtitle: name };
}

export function groupIntoTournaments(
  events: AESListingEvent[]
): DiscoveredTournament[] {
  // Map each event to its tournament group
  const groupMap = new Map<string, DiscoveredTournament>();

  for (const event of events) {
    const year = extractYearFromEvent(event);

    // Try to match to a known tournament pattern
    let matched = false;
    for (const tp of TOURNAMENT_PATTERNS) {
      if (tp.pattern.test(event.name)) {
        const groupKey = `${tp.id}:${year}`;
        let group = groupMap.get(groupKey);
        if (!group) {
          group = {
            tournamentId: tp.id,
            tournamentName: tp.name,
            shortName: tp.shortName,
            icon: tp.icon,
            year,
            events: [],
          };
          groupMap.set(groupKey, group);
        }

        const { label, subtitle } = parseEventLabel(event.name);
        group.events.push({
          key: event.eventSchedulerKey,
          label,
          subtitle,
          dates: formatDateRange(event.startDate, event.endDate),
          venue: event.locationName || undefined,
          isSchedulerPosted: event.isSchedulerPosted,
        });
        matched = true;
        break;
      }
    }

    // Unmatched Canadian events go into an "Other" group per year
    if (!matched) {
      const groupKey = `other-ca:${year}`;
      let group = groupMap.get(groupKey);
      if (!group) {
        group = {
          tournamentId: `other-ca-${year}`,
          tournamentName: 'Other Canadian Events',
          shortName: 'Other',
          icon: '🇨🇦',
          year,
          events: [],
        };
        groupMap.set(groupKey, group);
      }
      const { label, subtitle } = parseEventLabel(event.name);
      group.events.push({
        key: event.eventSchedulerKey,
        label: event.name, // Use full name for unknown tournaments
        subtitle,
        dates: formatDateRange(event.startDate, event.endDate),
        venue: event.locationName || undefined,
        isSchedulerPosted: event.isSchedulerPosted,
      });
    }
  }

  return Array.from(groupMap.values());
}

/**
 * Merge API-discovered tournaments into a static registry, adding any
 * events that aren't already present (matched by key). Returns a new
 * registry array — does NOT mutate the input.
 */
export function mergeDiscoveredEvents(
  staticRegistry: Country[],
  discovered: DiscoveredTournament[]
): Country[] {
  const registry: Country[] = JSON.parse(JSON.stringify(staticRegistry));
  const canada = registry.find((c) => c.id === 'canada');
  if (!canada) return registry;

  for (const disc of discovered) {
    let tournament = canada.tournaments.find((t) => t.id === disc.tournamentId);
    if (!tournament) {
      tournament = {
        id: disc.tournamentId,
        name: disc.tournamentName,
        shortName: disc.shortName,
        icon: disc.icon,
        years: [],
      };
      canada.tournaments.push(tournament);
    }

    let yearEntry = tournament.years.find((y) => y.year === disc.year);
    if (!yearEntry) {
      yearEntry = { year: disc.year, events: [] };
      if (disc.tournamentId === 'ontario-championships') {
        yearEntry.infoPageUrl = 'https://www.ontariovolleyball.org/ocs-venue';
      } else if (disc.tournamentId === 'canadian-nationals') {
        yearEntry.infoPageUrl = `https://volleyball.ca/en/competitions/${disc.year}-youth-nationals`;
      }
      tournament.years.push(yearEntry);
    }

    const existingKeys = new Set(yearEntry.events.map((e) => e.key));
    for (const de of disc.events) {
      if (!existingKeys.has(de.key)) {
        yearEntry.events.push({
          key: de.key,
          label: de.label,
          subtitle: de.subtitle,
          dates: de.dates,
          venue: de.venue,
        });
      }
    }

    yearEntry.events.sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true })
    );
  }

  return registry;
}

// ── Screen-level typed loaders ───────────────────────────────────────────
//
// Wrap the throwing primitives above in tagged-union LoaderResult shapes so
// callers can render distinct empty / error UI without duplicating
// try/catch boilerplate. See src/utils/loaderResult.ts for the shape.

/**
 * Run AES discovery and merge the results onto `base`. Returns:
 *   - { status: 'ok',    data }    — at least one new event merged in
 *   - { status: 'empty' }          — discovery succeeded but added nothing
 *   - { status: 'error', message } — fetch / parse failure
 *
 * Callers display the same `base` registry regardless of outcome, but the
 * 'error' branch lets them surface a retry affordance instead of silently
 * showing the static fallback.
 */
export async function loadDiscoveredRegistry(
  base: Country[]
): Promise<LoaderResult<Country[]>> {
  try {
    const events = await fetchCanadianEvents();
    const grouped = groupIntoTournaments(events);
    if (grouped.length === 0) {
      return { status: 'empty' };
    }
    const merged = mergeDiscoveredEvents(base, grouped);
    return { status: 'ok', data: merged };
  } catch (err) {
    return { status: 'error', message: errorMessage(err, 'Could not check for new tournaments.') };
  }
}

/**
 * Fetch the team assignments for a specific event/division. Returns a
 * tagged result so the AddTournaments AES picker can distinguish "no
 * teams yet in this division" (the registration was published without
 * roster yet) from "the request failed" — the latter gets a retry
 * affordance instead of a blank list.
 */
export async function loadDivisionTeams(
  eventKey: string,
  divisionId: number
): Promise<LoaderResult<AESTeamAssignment[]>> {
  try {
    const teams = await getTeamAssignments(eventKey, divisionId, null, []);
    if (teams.length === 0) return { status: 'empty' };
    return { status: 'ok', data: teams };
  } catch (err) {
    return {
      status: 'error',
      message: errorMessage(err, 'Could not load teams for this division.'),
    };
  }
}
