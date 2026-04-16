// AES API Client
const BASE_URL = 'https://results.advancedeventsystems.com';

import type {
  AESEvent,
  AESDivision,
  AESTeamAssignment,
  AESStanding,
} from '../types/aes';

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

/**
 * Helper: extract all TeamScheduleMatch objects from both current and past
 * schedule responses, normalising the two different shapes into a flat list.
 */
export function extractAllScheduleMatches(
  currentSchedule: TeamSchedulePlay[],
  pastSchedule: TeamPastScheduleItem[]
): TeamScheduleMatch[] {
  const matches: TeamScheduleMatch[] = [];
  for (const sp of currentSchedule) {
    if (Array.isArray(sp.Matches)) {
      matches.push(...sp.Matches);
    }
  }
  for (const item of pastSchedule) {
    if (item.Match) {
      matches.push(item.Match);
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
    '$skip=0&$orderby=OverallRank,FinishRank,TeamName,TeamCode'
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
}

export function flattenCourtSchedule(response: CourtScheduleResponse): FlatCourtMatch[] {
  const matches: FlatCourtMatch[] = [];
  for (const court of response.CourtSchedules) {
    for (const match of court.CourtMatches) {
      matches.push({ ...match, CourtName: court.Name });
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
}

export function flattenBracketTree(roots: BracketNode[]): FlatBracketMatch[] {
  const matches: FlatBracketMatch[] = [];

  function walk(node: BracketNode | null) {
    if (!node) return;
    matches.push({
      round: node.X,
      position: node.Y,
      match: node.Match,
    });
    walk(node.TopSource);
    walk(node.BottomSource);
  }

  for (const root of roots) {
    walk(root);
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
