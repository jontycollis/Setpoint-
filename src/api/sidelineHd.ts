// ── Sideline HD authenticated API client ──────────────────────────────────
//
// After the WebView login captured the user's session cookie, this module
// drives the actual data-pull side of the self-serve importer: fetch the
// user's teams, fetch a team's matches, fetch a match's rally data.
//
// Endpoint discovery caveat
// -------------------------
// Sideline HD's API is not publicly documented. We don't probe URLs from
// dev tooling (the worktree harness blocks external HEADs for good
// reasons), so this client carries a small ordered list of *candidate*
// paths for each operation, hits them in order at runtime, and keeps
// the first one that returns a JSON payload. The chosen path is cached
// on a module-local map so subsequent calls hit the proven URL
// directly. If every candidate fails (or every payload looks empty), we
// surface a structured `SidelineHdProbeFailure` instead of returning
// fake data — the UI shows the user which endpoints we tried.
//
// Anti-wedge rules
// ----------------
// All fetches use a 15s timeout and return `null` on network errors
// rather than throwing through to the UI. Callers branch on the result
// shape (`ok` vs. `failure`) and render a graceful "we couldn't reach
// Sideline HD" card.
// ──────────────────────────────────────────────────────────────────────────

import {
  SIDELINE_HD_BASE_URL,
  readSidelineHdCookies,
  buildCookieHeader,
} from '../utils/sidelineHdCookies';

const REQUEST_TIMEOUT_MS = 15000;

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

/** Candidate URL paths to try for each operation. First-match wins. */
const CANDIDATE_PATHS = {
  // Authenticated-session probe — anything that 200s with a JSON body
  // for a logged-in user is enough to confirm cookies work.
  session: ['/api/me', '/api/user/me', '/api/v1/me', '/api/session'],
  // The current user's teams (the ones they own or coach).
  myTeams: [
    '/api/me/teams',
    '/api/teams/mine',
    '/api/my-teams',
    '/api/teams?mine=1',
    '/api/v1/me/teams',
  ],
  // A team's matches / games.
  teamMatches: (teamId: string) => [
    `/api/teams/${encodeURIComponent(teamId)}/games`,
    `/api/teams/${encodeURIComponent(teamId)}/matches`,
    `/api/games?teamId=${encodeURIComponent(teamId)}`,
    `/api/v1/teams/${encodeURIComponent(teamId)}/games`,
  ],
  // Rally / play-by-play data for a single match.
  matchRallies: (matchId: string) => [
    `/api/games/${encodeURIComponent(matchId)}/rallies`,
    `/api/games/${encodeURIComponent(matchId)}/pbp`,
    `/api/games/${encodeURIComponent(matchId)}`,
    `/api/matches/${encodeURIComponent(matchId)}/rallies`,
  ],
} as const;

/**
 * Discovered endpoint cache. Module-local so the first probe per
 * session is the only one paying the multi-URL cost.
 */
const discovered: { session?: string; myTeams?: string } = {};

/**
 * Outcome of a single fetch. We keep the raw response body around when
 * something goes wrong so the UI can surface a meaningful diagnostic
 * (HTTP code, content-type, first 500 chars of body) without exposing
 * fetch internals to the screen.
 */
export interface SidelineHdProbeAttempt {
  url: string;
  status: number | 'network-error' | 'timeout' | 'not-json';
  contentTypeHint?: string;
  bodySnippet?: string;
}

export interface SidelineHdProbeFailure {
  ok: false;
  attempts: SidelineHdProbeAttempt[];
  reason: string;
}

export interface SidelineHdProbeSuccess<T> {
  ok: true;
  url: string;
  data: T;
  attempts: SidelineHdProbeAttempt[];
}

export type SidelineHdProbeResult<T> =
  | SidelineHdProbeSuccess<T>
  | SidelineHdProbeFailure;

/**
 * Loose typing for the team payload. We don't know Sideline HD's
 * actual shape, so we accept any object with an `id` and a label
 * field, and tolerate either snake_case or camelCase.
 */
export interface SidelineHdTeam {
  id: string;
  name: string;
  /** Optional — Sideline HD may attach a divisional / league label. */
  league?: string;
  /** Optional — public-facing slug if present. */
  slug?: string;
  /** Original raw record so callers can dig into fields we didn't model. */
  raw: Record<string, unknown>;
}

/**
 * Match summary as it appears in a team's match list. Score may be
 * absent for upcoming matches.
 */
export interface SidelineHdMatchSummary {
  id: string;
  /** Epoch ms. Best-effort derived from one of several date-y fields. */
  dateMs: number | null;
  opponent: string;
  homeScore?: number;
  awayScore?: number;
  /** Whether we (the user's team) played home. */
  weWereHome?: boolean;
  /** Free-text event / league name if present. */
  eventName?: string;
  /** Original raw record. */
  raw: Record<string, unknown>;
}

/** Rally / play-by-play wrapper. Kept loose — parser handles the shape. */
export interface SidelineHdRallyPayload {
  matchId: string;
  /** Raw rallies / pbp records. Shape varies; the parser is best-effort. */
  rallies: unknown[];
  /** Top-level metadata returned alongside the rallies (team names,
   *  event, etc.). Useful for filling Match.meta fields. */
  metadata?: Record<string, unknown>;
  raw: Record<string, unknown>;
}

// ── Internal fetch with timeout + cookie injection ────────────────────────

async function fetchWithCookies(
  path: string
): Promise<{ ok: boolean; status: number; contentType: string; body: string }> {
  const cookies = await readSidelineHdCookies();
  const cookieHeader = buildCookieHeader(cookies);
  if (!cookieHeader) {
    return {
      ok: false,
      status: 0,
      contentType: '',
      body: '<no cookies — user not logged in>',
    };
  }
  const url = `${SIDELINE_HD_BASE_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        Cookie: cookieHeader,
        Referer: `${SIDELINE_HD_BASE_URL}/`,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    const contentType = res.headers.get('content-type') ?? '';
    const body = await res.text();
    return { ok: res.ok, status: res.status, contentType, body };
  } finally {
    clearTimeout(timer);
  }
}

function safeParseJson<T = unknown>(body: string): T | null {
  if (!body) return null;
  const trimmed = body.trim();
  if (!trimmed) return null;
  // Reject obvious HTML responses — login-required redirects and 404
  // pages typically come back as HTML even on a JSON-y URL.
  if (trimmed.startsWith('<')) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

/**
 * Walk a candidate list and return the first one that yields a non-null
 * JSON body. Records every attempt for diagnostics.
 */
async function probe<T>(
  paths: readonly string[],
  validate: (data: unknown) => data is T
): Promise<SidelineHdProbeResult<T>> {
  const attempts: SidelineHdProbeAttempt[] = [];
  for (const path of paths) {
    try {
      const res = await fetchWithCookies(path);
      if (!res.ok) {
        attempts.push({
          url: path,
          status: res.status,
          contentTypeHint: res.contentType || undefined,
          bodySnippet: res.body.slice(0, 200),
        });
        continue;
      }
      const parsed = safeParseJson(res.body);
      if (parsed == null) {
        attempts.push({
          url: path,
          status: 'not-json',
          contentTypeHint: res.contentType || undefined,
          bodySnippet: res.body.slice(0, 200),
        });
        continue;
      }
      if (!validate(parsed)) {
        attempts.push({
          url: path,
          status: res.status,
          contentTypeHint: res.contentType || undefined,
          bodySnippet: JSON.stringify(parsed).slice(0, 200),
        });
        continue;
      }
      attempts.push({
        url: path,
        status: res.status,
        contentTypeHint: res.contentType || undefined,
      });
      return { ok: true, url: path, data: parsed, attempts };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const status: SidelineHdProbeAttempt['status'] = msg.includes('abort')
        ? 'timeout'
        : 'network-error';
      attempts.push({ url: path, status, bodySnippet: msg.slice(0, 200) });
    }
  }
  return {
    ok: false,
    attempts,
    reason: 'No candidate endpoint returned a usable JSON payload.',
  };
}

// ── Type-narrowing helpers (loose JSON → expected shape) ──────────────────

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function pickString(
  obj: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

function pickNumber(
  obj: Record<string, unknown>,
  keys: readonly string[]
): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function pickBool(
  obj: Record<string, unknown>,
  keys: readonly string[]
): boolean | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'boolean') return v;
  }
  return undefined;
}

function pickDateMs(
  obj: Record<string, unknown>,
  keys: readonly string[]
): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      // Heuristic: epoch in seconds vs. ms. Treat anything < 1e12 as seconds.
      return v < 1e12 ? v * 1000 : v;
    }
    if (typeof v === 'string' && v) {
      const parsed = Date.parse(v);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

/**
 * Extract an array from a payload that might be either a bare array
 * or an object with a `data` / `items` / `teams` / `games` wrapper.
 */
function extractArray(
  data: unknown,
  innerKeys: readonly string[] = ['data', 'items', 'results', 'teams', 'games', 'matches']
): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (isObject(data)) {
    for (const k of innerKeys) {
      const inner = data[k];
      if (Array.isArray(inner)) return inner;
    }
  }
  return null;
}

// ── Public surface ─────────────────────────────────────────────────────────

/**
 * Quick yes/no — can we hit *any* authenticated endpoint with the
 * current cookie jar? Used by the screen to confirm the session is
 * still alive before walking into the team list, so we can surface a
 * cleaner "log in again" prompt rather than a multi-URL probe failure.
 *
 * Caches the discovered session-probe URL for the rest of the session.
 */
export async function pingSession(): Promise<SidelineHdProbeResult<unknown>> {
  if (discovered.session) {
    const res = await fetchWithCookies(discovered.session);
    if (res.ok) {
      const parsed = safeParseJson(res.body);
      if (parsed != null) {
        return {
          ok: true,
          url: discovered.session,
          data: parsed,
          attempts: [{ url: discovered.session, status: res.status }],
        };
      }
    }
    // Cached URL stopped working — fall through to re-probe.
    discovered.session = undefined;
  }
  const result = await probe<unknown>(
    CANDIDATE_PATHS.session,
    (data): data is unknown => data != null
  );
  if (result.ok) discovered.session = result.url;
  return result;
}

/**
 * Fetch the teams the logged-in user owns / has access to. Best-effort
 * parsing — accepts loose payloads as long as each record has *some*
 * id + name pair.
 */
export async function fetchMyTeams(): Promise<SidelineHdProbeResult<SidelineHdTeam[]>> {
  const validate = (data: unknown): data is SidelineHdTeam[] => {
    const arr = extractArray(data, ['teams', 'data', 'items', 'results']);
    return Array.isArray(arr) && arr.length >= 0;
  };
  const cachedFirst = discovered.myTeams
    ? [discovered.myTeams, ...CANDIDATE_PATHS.myTeams.filter((p) => p !== discovered.myTeams)]
    : CANDIDATE_PATHS.myTeams;
  const probeResult = await probe<unknown>(cachedFirst, validate);
  if (!probeResult.ok) return probeResult;
  discovered.myTeams = probeResult.url;

  const arr = extractArray(probeResult.data, ['teams', 'data', 'items', 'results']);
  const teams: SidelineHdTeam[] = [];
  for (const entry of arr ?? []) {
    if (!isObject(entry)) continue;
    const id = pickString(entry, ['id', 'teamId', 'team_id', 'uuid', '_id']);
    const name = pickString(entry, ['name', 'teamName', 'team_name', 'label', 'displayName']);
    if (!id || !name) continue;
    teams.push({
      id,
      name,
      league: pickString(entry, ['league', 'leagueName', 'division']),
      slug: pickString(entry, ['slug', 'shortCode']),
      raw: entry,
    });
  }
  return { ok: true, url: probeResult.url, data: teams, attempts: probeResult.attempts };
}

/**
 * Fetch a team's match list. Same loose-tolerance parsing as
 * `fetchMyTeams` — pick the records that have an id + a date and a
 * recognisable opponent label.
 */
export async function fetchTeamMatches(
  teamId: string
): Promise<SidelineHdProbeResult<SidelineHdMatchSummary[]>> {
  const validate = (data: unknown): data is unknown =>
    extractArray(data, ['games', 'matches', 'data', 'items', 'results']) !== null;
  const probeResult = await probe<unknown>(CANDIDATE_PATHS.teamMatches(teamId), validate);
  if (!probeResult.ok) return probeResult;

  const arr =
    extractArray(probeResult.data, ['games', 'matches', 'data', 'items', 'results']) ?? [];
  const matches: SidelineHdMatchSummary[] = [];
  for (const entry of arr) {
    if (!isObject(entry)) continue;
    const id = pickString(entry, ['id', 'gameId', 'matchId', 'game_id', 'uuid', '_id']);
    if (!id) continue;
    const dateMs = pickDateMs(entry, [
      'date',
      'startTime',
      'startsAt',
      'scheduledAt',
      'playedAt',
      'gameDate',
      'dateMs',
    ]);
    const opponent =
      pickString(entry, ['opponent', 'opponentName', 'opponentLabel', 'awayTeamName']) ||
      pickString(entry, ['awayTeam']) ||
      'Opponent';
    const homeScore = pickNumber(entry, [
      'homeScore',
      'home_score',
      'scoreHome',
      'home_points',
    ]);
    const awayScore = pickNumber(entry, [
      'awayScore',
      'away_score',
      'scoreAway',
      'away_points',
    ]);
    const weWereHome =
      pickBool(entry, ['isHome', 'home']) ??
      undefined;
    const eventName = pickString(entry, [
      'eventName',
      'leagueName',
      'tournamentName',
      'competition',
    ]);
    matches.push({
      id,
      dateMs,
      opponent,
      homeScore,
      awayScore,
      weWereHome,
      eventName,
      raw: entry,
    });
  }
  return { ok: true, url: probeResult.url, data: matches, attempts: probeResult.attempts };
}

/**
 * Fetch the rally / play-by-play data for a single match. Returns the
 * raw payload; the parser converts it into a `Match` separately.
 */
export async function fetchMatchRallies(
  matchId: string
): Promise<SidelineHdProbeResult<SidelineHdRallyPayload>> {
  const validate = (data: unknown): data is unknown => isObject(data) || Array.isArray(data);
  const probeResult = await probe<unknown>(CANDIDATE_PATHS.matchRallies(matchId), validate);
  if (!probeResult.ok) return probeResult;

  const root = isObject(probeResult.data) ? probeResult.data : {};
  const rallies =
    extractArray(probeResult.data, ['rallies', 'pbp', 'events', 'plays', 'points']) ?? [];
  const metadata = isObject(root.metadata) ? (root.metadata as Record<string, unknown>) : undefined;

  return {
    ok: true,
    url: probeResult.url,
    data: {
      matchId,
      rallies,
      metadata,
      raw: isObject(probeResult.data) ? (probeResult.data as Record<string, unknown>) : {},
    },
    attempts: probeResult.attempts,
  };
}

/** Reset the cached endpoint resolutions — used on logout. */
export function resetDiscoveredEndpoints(): void {
  discovered.session = undefined;
  discovered.myTeams = undefined;
}
