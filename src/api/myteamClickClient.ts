// ── MyTeam.Click REST API client ──────────────────────────────────────────
//
// The Angular SPA at https://myteam.click is the primary platform for
// beach tournaments in Ontario (VC Beach Tour, Helix Volley series, JNP
// memorial, etc.). It hosts indoor events too but the OVA + AES already
// cover those. The beach data is unique to this client.
//
// Auth recipe — see src/api/myteamClickProbe.md for the full probe log:
//   • `token: <jwt>` header (NOT Authorization: Bearer)
//   • `clientvs: <version>` sentinel (matches the version shown in the
//     SPA's hamburger menu). Server-side upgrade gate compares this to
//     a minimum; sending the version the SPA itself sends keeps us OK.
//   • `platform: web` (alternatives: ios, android)
//   • `source: <action-name>` — per-endpoint identifier used in their
//     server logs. Sending the same string the SPA sends keeps us
//     indistinguishable in their telemetry.
//
// The JWT is captured from the SPA's WebView (Capacitor) on first link
// — same pattern Bior uses for SidelineHD. Token lifetime is long
// (sample probe token had a ~28-year exp), so refresh isn't critical
// today.
//
// All endpoints route through the shared httpClient base (task #20) for
// consistent error handling + retry policy. ApiError code branches in
// `code` to read MyTeam.Click's structured `reasons` field.
// ──────────────────────────────────────────────────────────────────────────

import { fetchJson, type FetchOptions } from './httpClient';

export const MYTEAM_CLICK_BASE = 'https://myteamclick.herokuapp.com';
/**
 * Client version we identify as. Mirror what the SPA sends so the
 * server's upgrade gate (and presumably analytics) treats us as a
 * recent client. Bump when probing reveals a new value.
 */
export const MYTEAM_CLICK_CLIENT_VERSION = '5.6.48';

export interface MyTeamClickSession {
  /** JWT captured from the SPA's WebView (Capacitor key
   *  `CapacitorStorage.user.token`). Sent verbatim as `token` header. */
  jwt: string;
  /** Override the client version header. Tests + probe replay use this. */
  clientVersion?: string;
}

// ── Request helper ────────────────────────────────────────────────────────

interface MtcRequestOptions {
  /** Per-endpoint sentinel sent as the `source` header. Bior is honest
   *  about being a third-party app: the convention is to use a
   *  Bior-prefixed action name (e.g. `bior-getSchedule`) so the API
   *  owners can identify our traffic, while preserving compatibility
   *  with the server's source-routing if any. */
  source: string;
  /** Extra retry budget. Defaults to 1 (one retry) — beach tournaments
   *  in flight rarely change rapidly enough to need aggressive
   *  retries, but a one-shot retry papers over transient Heroku-side
   *  502/503 we see on cold starts. */
  retries?: number;
}

function makeFetchOptions(
  session: MyTeamClickSession,
  opts: MtcRequestOptions,
  method: 'GET' | 'POST',
  body?: unknown
): FetchOptions & { method: string; body?: string } {
  const headers: Record<string, string> = {
    token: session.jwt,
    clientvs: session.clientVersion ?? MYTEAM_CLICK_CLIENT_VERSION,
    platform: 'web',
    source: opts.source,
  };
  if (method === 'POST') headers['Content-Type'] = 'application/json';
  return {
    source: 'myteamclick',
    headers,
    retries: opts.retries ?? 1,
    method,
    body: body != null ? JSON.stringify(body) : undefined,
  };
}

// Internal — wraps fetchJson with the MyTeam.Click default options.
// httpClient.fetchJson uses GET when no method is set; we explicitly
// thread method via a small inline call.
async function mtcGet<T>(
  session: MyTeamClickSession,
  path: string,
  opts: MtcRequestOptions
): Promise<T> {
  return fetchJsonWithMethod<T>(
    `${MYTEAM_CLICK_BASE}${path}`,
    'GET',
    undefined,
    makeFetchOptions(session, opts, 'GET')
  );
}

async function mtcPost<T>(
  session: MyTeamClickSession,
  path: string,
  body: unknown,
  opts: MtcRequestOptions
): Promise<T> {
  return fetchJsonWithMethod<T>(
    `${MYTEAM_CLICK_BASE}${path}`,
    'POST',
    body,
    makeFetchOptions(session, opts, 'POST', body)
  );
}

/**
 * Small bridge — `httpClient.fetchJson` doesn't currently expose a way
 * to pass method/body (it's GET-only). Keep it open for now via a
 * direct `fetch` call that respects the FetchOptions retry/header
 * shape; collapse to fetchJson when it learns method support.
 */
async function fetchJsonWithMethod<T>(
  url: string,
  method: 'GET' | 'POST',
  body: unknown,
  opts: FetchOptions & { method: string; body?: string }
): Promise<T> {
  if (method === 'GET') {
    // Reuse fetchJson — same headers/retry plumbing.
    return fetchJson<T>(url, opts);
  }
  // For POST, mirror fetchJson's logic inline (cache-bust + retry).
  const sep = url.includes('?') ? '&' : '?';
  const target = `${url}${sep}_t=${Date.now()}`;
  const res = await fetch(target, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      ...(opts.headers ?? {}),
    },
    body: opts.body,
    cache: 'no-store' as RequestCache,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `myteamclick HTTP ${res.status} ${res.statusText}: ${text.slice(0, 120)}`
    );
  }
  return JSON.parse(text) as T;
}

// ── Response shapes ───────────────────────────────────────────────────────

/**
 * One organizer (host of the tournament — e.g. "Helix Volley", "JNP
 * Memorial"). Returned in search responses' top-level `orgList` and
 * referenced from per-event `orgId`.
 */
export interface MtcOrg {
  _id: string;
  name: string;
  abbr?: string;
  timeZone?: string;
}

/** Venue / location reference. */
export interface MtcLoc {
  _id: string;
  name: string;
  city?: string;
  stateProv?: string;
  timeZone?: string;
}

/** Geographic search area used by tournament search. */
export interface MtcSearchArea {
  /** Radius in km. */
  radius: number;
  /** Human-readable location string (e.g. "Toronto, ON, Canada"). */
  loc: string;
  /** Signed longitude. */
  long: number;
  /** Signed latitude. */
  lat: number;
  /** Probe payload includes this — value didn't affect results. Safe
   *  to omit. */
  changed?: boolean;
}

/** Group within an event — a division / pool combination. */
export interface MtcGroupSummary {
  name: string;
  /** Hard cap on registered teams. */
  maxTeams: number;
  wlActive: boolean;
  stateCount: { act: number; wl: number };
  /** Present on detailed responses (schedule, tournament view). Not on
   *  the discovery search response. */
  _id?: string;
  teamCount?: number;
}

/** A single event hit from the discovery search. */
export interface MtcSearchEventEntry {
  loc: { distance: number; _id: string };
  event: {
    _id: string;
    orgId: string;
    name: string;
    date: string;
    timeFrames: Array<{ start: string; end: string }>;
    states: { canceled: boolean };
    displaySettings: Record<string, unknown>;
    regStartDates: Array<{ date: string; code: string }>;
    groups: MtcGroupSummary[];
    locList: Array<{ _id: string }>;
  };
}

export interface MtcSearchResponse {
  success: boolean;
  serverDate: number;
  orgList: MtcOrg[];
  locList: MtcLoc[];
  eventList: MtcSearchEventEntry[];
  /** Populated on error (e.g. `["INVALID_SEARCH_AREA"]`). */
  reasons?: string[];
}

/** Player slot within a team — typically the first/last name pair. */
export interface MtcPlayerSlot {
  firstName: string;
  lastName: string;
  _id: string;
}

/** Team within a group on the full schedule response. Includes final
 *  position fields once the event has been scored. */
export interface MtcTeam {
  _id: string;
  name: string;
  state: number;
  slots: MtcPlayerSlot[];
  admins?: MtcPlayerSlot[];
  startRank?: number;
  no?: number;
  /** Final placement within the group (= final tournament rank for
   *  this division). Undefined when state is pre-complete. */
  groupPos?: number;
  poolPos?: number;
  mWon?: number;
  mLost?: number;
  sWon?: number;
  sLost?: number;
  pf?: number;
  pa?: number;
}

/** A single pool within a group's pool-play config. */
export interface MtcPool {
  no: number;
  configId: string;
  state: number;
  teamIdList: string[];
  matchRefList: number[];
  useMatchesWon?: boolean;
}

/** One match in the event-wide matchList. `_id` is a sequence number
 *  (1..N), referenced from `matchRefList` on pools / finals. */
export interface MtcMatch {
  _id: number;
  type: 'P' | 'F' | string;
  state: number;
  teams: Array<{ teamId: string; scores: number[] }>;
  arbitId?: string;
  idSig?: string;
}

/** A group on the schedule response. Carries pool play + finals
 *  config plus the team list with their final positions. */
export interface MtcGroup {
  _id: string;
  name: string;
  suffix?: string;
  teams: MtcTeam[];
  poolRounds?: unknown;
  poolPlay: { useMatchesWon: boolean; poolList: MtcPool[] };
  challenge?: { matchRefList: number[] };
  finals: {
    initMethod: string;
    orderBy: string;
    applyCP: boolean;
    state: number;
    treeList: unknown[];
    matchRefList?: number[];
  };
}

/** Full schedule response from `/volley/schedule/<eventId>`. */
export interface MtcScheduleResponse {
  success: boolean;
  org: MtcOrg;
  customConfig: Record<string, unknown>;
  timeZone: string;
  adminLevel: number;
  leagueInfo?: Record<string, unknown>;
  event: {
    _id: string;
    name: string;
    date: string;
    timeFrames: Array<{ start: string; end: string }>;
    leagueRef?: { name: string; league: string };
    orgRef?: { name: string; org: string; abbr?: string };
    locList: MtcLoc[];
    courtDef: unknown[];
    groups: MtcGroup[];
    matchList: MtcMatch[];
    persistentTeams?: boolean;
    customConfig?: Record<string, unknown>;
  };
}

/** Player's own event list — used as the discovery handle once a user
 *  links their MyTeam.Click account. */
export interface MtcPlayerEvent {
  _id: string;
  name: string;
  date: string;
  endDate?: string;
  timeZone?: string;
  timeFrames: Array<{ start: string; end: string }>;
  states: {
    schedulePublished: boolean;
    hideUntilStart: boolean;
    canceled: boolean;
  };
  orgRef?: { org: string };
  locList: Array<{ _id: string }>;
  teamRefList: Array<{ _id: string; name: string; state: number }>;
  sched: boolean;
  leagueId?: string;
  isAdmin?: boolean;
  hasActiveTeam?: boolean;
}

export interface MtcPlayerEventListResponse {
  success: boolean;
  eventList: MtcPlayerEvent[];
  leagueList: unknown[];
  locList: MtcLoc[];
  orgList: MtcOrg[];
}

// ── Public endpoints ──────────────────────────────────────────────────────

/**
 * Discover tournaments within a geographic area. Returns events with
 * `date >= afterDate`; past events are NOT returned via this endpoint —
 * use the player-event-list path for those (or a future league/event
 * listing if we wire that).
 *
 * Source identifier sent: `bior-findTournamentsInRange` so MyTeam.Click
 * server logs can attribute traffic to Bior.
 */
export async function searchTournamentsByArea(
  session: MyTeamClickSession,
  args: { searchArea: MtcSearchArea; afterDate: Date }
): Promise<MtcSearchResponse> {
  return mtcPost<MtcSearchResponse>(
    session,
    '/volley/tournament/search/advanced',
    {
      searchArea: args.searchArea,
      afterDate: args.afterDate.toISOString(),
    },
    { source: 'bior-findTournamentsInRange' }
  );
}

/**
 * Player's own events since the supplied timestamp. Pass `0` to fetch
 * everything (used for first-link cold reads).
 */
export async function fetchPlayerEvents(
  session: MyTeamClickSession,
  args: { sinceMs: number }
): Promise<MtcPlayerEventListResponse> {
  return mtcGet<MtcPlayerEventListResponse>(
    session,
    `/volley/v5/player/eventlist/since/${args.sinceMs}`,
    { source: 'bior-getMyEventsSinceV5' }
  );
}

/**
 * Full schedule for an event, including every group's teams (with
 * final positions / records) and every match. This is the canonical
 * payload for indexing.
 */
export async function fetchEventSchedule(
  session: MyTeamClickSession,
  args: { eventId: string }
): Promise<MtcScheduleResponse> {
  return mtcGet<MtcScheduleResponse>(
    session,
    `/volley/schedule/${encodeURIComponent(args.eventId)}`,
    { source: 'bior-getSchedule' }
  );
}
