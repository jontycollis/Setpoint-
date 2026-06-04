// ── Sideline HD REST API client ────────────────────────────────────────────
//
// The localStorage-snapshot import path (commit 057373f) stopped working in
// 2026 when Sideline HD shipped a frontend that no longer caches match data
// to `localStorage.__pvcFinalMatches` / `__pvcPBP_*`. Match data is now
// served exclusively by their backend at
// `https://sideline-api-439745628468.us-central1.run.app`, a Google Cloud
// Run service. Reverse-engineered from their web bundle.
//
// AUTH RECIPE
// -----------
// Every request needs two headers:
//   • `Authorization: Bearer <firebase-jwt>`
//     Firebase Auth (project shd-001). The JWT is in the WebView's
//     `firebaseLocalStorageDb` IndexedDB after login. See
//     `EXTRACT_JWT_JS` in `SidelineImportScreen.tsx` for the extraction
//     payload.
//   • `X-Sideline-Mobile-Version: 2099.10.10`
//     A sentinel "future" version their web client uses to bypass the
//     server-side upgrade gate. Without it the server returns HTTP 418
//     `{"error": "UPGRADE_REQUIRED"}`. Value pulled from `lj` in their
//     minified bundle.
//
// The client deliberately keeps the surface minimal: just the auth+headers
// wrapper and the two endpoints we currently consume. Future endpoint
// additions plug in as additional `fetch*` helpers that all flow through
// the same `apiFetch` interceptor.
// ──────────────────────────────────────────────────────────────────────────

export const SIDELINE_API_BASE =
  'https://sideline-api-439745628468.us-central1.run.app/v2';

/**
 * Sentinel future version used by Sideline HD's own web client to bypass
 * the upgrade gate. If you ever see UPGRADE_REQUIRED responses landing,
 * the server-side gate has likely moved — re-probe their bundle for
 * `X-Sideline-Mobile-Version` and `=lj` to find the new value.
 */
export const SIDELINE_VERSION_HEADER_VALUE = '2099.10.10';

/**
 * Carries the bits we need to authenticate a request. `jwt` is the
 * Firebase ID token captured from the WebView. Tokens expire after ~1
 * hour; callers handle expiry by re-prompting the WebView login (Phase 1)
 * or by exchanging the refresh token (Phase 2 — not yet implemented).
 */
export interface SidelineHdSession {
  jwt: string;
  /** Optional override for the version header. Defaults to
   *  `SIDELINE_VERSION_HEADER_VALUE`. Tests use this to assert the header
   *  is being sent. */
  versionHeader?: string;
}

// ── Response shapes ──────────────────────────────────────────────────────

/**
 * A team as listed in `/v2/my/teams`. Same id format as the team-detail
 * endpoint expects (e.g. `IanC-TmSh01-pvc-xYbny9puI0EX`). Field naming
 * here mirrors Sideline HD's API verbatim — `nameLong` is the
 * human-readable team name, `nameHandle` / `nameHandleLower` is the
 * slug-style handle.
 */
export interface SidelineHdApiTeam {
  id: string;
  /** Human-readable name, e.g. "REACH Harmony". The picker uses this. */
  nameLong?: string;
  /** Handle / slug, e.g. "REACHHarmony". Useful for alias matching. */
  nameHandle?: string;
  /** Lowercased handle, e.g. "reachharmony". Useful for alias matching. */
  nameHandleLower?: string;
  /** City / region the team is associated with. */
  nameLocation?: string;
  /** Age level, e.g. "18U". */
  ageLevel?: string;
  /** Sport name, e.g. "Volleyball". Capitalised, not the
   *  `'volleyball'`-lowercased form returned by per-game endpoints. */
  sport?: string;
  /** User's role on this team — "Admin", "Coach", etc. */
  roles?: string[];
  /** Optional team logo info. */
  imageLogo?: {
    large?: string;
    small?: string;
    category?: string;
  } | null;
  paths?: {
    team?: string;
    games?: string;
  };
  /** Extra fields the API surfaces — kept open so we don't drop data
   *  consumers might want to surface later. */
  [extra: string]: unknown;
}

/**
 * Volleyball-specific score blob attached to a game. Sets are stored as
 * parallel arrays — `ourSets[i]` is our score in set `i`, `opponentSets[i]`
 * is the opponent's. `-1` for sets that weren't played (e.g. a sweep
 * leaves set 3 as `-1` on both sides).
 */
export interface SidelineHdApiVolleyballScore {
  /** Sets won by our team. */
  ourScore: number;
  /** Sets won by the opponent. */
  opponentScore: number;
  /** Per-set points scored by our team. Length = max sets in the format
   *  (typically 3 or 5). `-1` slots = set not played. */
  ourSets: number[];
  opponentSets: number[];
  weAreHome: boolean;
  gameComplete: boolean;
  /** Live-only — point counter in the active set during scoring. Reads as
   *  0 on completed games. */
  currentSetOurScore?: number;
  currentSetOpponentScore?: number;
}

/**
 * One game from `/v2/teams/<id>/games`. Most fields are optional because
 * the same shape covers scheduled-but-unplayed games, live games, and
 * completed games. Code that needs a "real" result should check
 * `isEnded && volleyball?.gameComplete`.
 */
export interface SidelineHdApiGame {
  id: string;
  date?: string;
  title?: string;
  sportType?: 'volleyball' | 'baseball' | 'otherSport' | string;
  scoreOurName?: string;
  scoreOpponentName?: string;
  scoreWeAreHome?: number;
  /** Schedule + score timestamps. ISO strings in `localTzString` zone. */
  scheduleTsStart?: string;
  scoreTsStart?: string;
  scoreTsEnd?: string;
  scheduleLocation?: string;
  localTzString?: string;
  isEnded?: boolean;
  /** Sport-specific score blob. Populated when `sportType === 'volleyball'`. */
  volleyball?: SidelineHdApiVolleyballScore;
  /** Pre-computed deep links the API returns alongside the game. */
  paths?: {
    team?: string;
    live_game?: string;
    details?: string;
  };
  /** Extra fields — preserved so callers can opt into surfacing them. */
  [extra: string]: unknown;
}

// ── Errors ───────────────────────────────────────────────────────────────

/**
 * Thrown by `apiFetch` on non-2xx responses. Exposes the parsed error body
 * (Sideline HD returns JSON like `{"error":"UPGRADE_REQUIRED", "message":"..."}`)
 * so the caller can branch on `code`.
 */
export class SidelineHdApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly responseBody: string;

  constructor(opts: {
    status: number;
    code: string | null;
    message: string;
    responseBody: string;
  }) {
    super(opts.message);
    this.name = 'SidelineHdApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.responseBody = opts.responseBody;
  }

  /** True when the response indicates the JWT is invalid / expired. The
   *  app reacts by re-prompting the WebView login. */
  get isAuthExpired(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** True when the upgrade gate rejected the request. Usually means the
   *  version-header sentinel changed on Sideline HD's side. */
  get isUpgradeRequired(): boolean {
    return this.status === 418 || this.code === 'UPGRADE_REQUIRED';
  }
}

// ── Core fetch wrapper ───────────────────────────────────────────────────

/**
 * Low-level wrapper around `fetch`. Handles the two required headers,
 * parses JSON, and converts non-2xx into a typed `SidelineHdApiError`.
 *
 * `path` may be a full URL (the API returns absolute paths in `paths.*`
 * fields — caller can pass those straight through) or a path starting
 * with `/v2/...` (we'll attach the base URL). Anything else is treated
 * as relative-to-base for safety.
 */
export async function apiFetch<T = unknown>(
  session: SidelineHdSession,
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown }
): Promise<T> {
  const url = path.startsWith('http')
    ? path
    : `${SIDELINE_API_BASE}${path.startsWith('/v2') ? path.slice(3) : path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.jwt}`,
    'X-Sideline-Mobile-Version':
      session.versionHeader ?? SIDELINE_VERSION_HEADER_VALUE,
    Accept: 'application/json',
  };
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  const responseBody = await res.text();

  if (!res.ok) {
    let code: string | null = null;
    let message = `Sideline HD API ${res.status}`;
    try {
      const parsed = JSON.parse(responseBody) as {
        error?: unknown;
        message?: unknown;
        detail?: unknown;
      };
      if (typeof parsed.error === 'string') code = parsed.error;
      if (typeof parsed.message === 'string') message = parsed.message;
      else if (typeof parsed.detail === 'string') message = parsed.detail;
    } catch {
      // Body wasn't JSON — leave the default message.
    }
    throw new SidelineHdApiError({
      status: res.status,
      code,
      message,
      responseBody,
    });
  }

  if (!responseBody) return undefined as unknown as T;
  try {
    return JSON.parse(responseBody) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SidelineHdApiError({
      status: res.status,
      code: null,
      message: `Response was not JSON: ${msg}`,
      responseBody,
    });
  }
}

// ── Endpoint helpers ─────────────────────────────────────────────────────

/**
 * `/v2/my/teams` — list every team the authenticated user is on. Lets us
 * skip the WebView-navigate-to-slug song and dance entirely; the user
 * just logs in and picks from this list.
 *
 * Response shape (Jun 2026): `{"teams": [...]}` envelope. Older drafts
 * of this client expected a bare array — be defensive: support both
 * shapes so we don't regress if Sideline HD flips back.
 */
export async function fetchMyTeams(
  session: SidelineHdSession
): Promise<SidelineHdApiTeam[]> {
  const data = await apiFetch<unknown>(session, '/v2/my/teams');
  let list: unknown[] = [];
  if (Array.isArray(data)) {
    list = data;
  } else if (data && typeof data === 'object') {
    const teamsField = (data as { teams?: unknown }).teams;
    if (Array.isArray(teamsField)) list = teamsField;
  }
  return list.filter(
    (t): t is SidelineHdApiTeam =>
      !!t && typeof t === 'object' && typeof (t as SidelineHdApiTeam).id === 'string'
  );
}

/**
 * `/v2/teams/<teamId>/games` — every game on a team's schedule, past
 * present and future. Filter on `isEnded` for finished games and on
 * `sportType === 'volleyball'` for the sport we currently support. The
 * response is a plain array (not paginated for typical team sizes — PVC
 * 3D Royals returned 50 games × 224 KB total without pagination).
 */
export async function fetchTeamGames(
  session: SidelineHdSession,
  teamId: string
): Promise<SidelineHdApiGame[]> {
  const data = await apiFetch<unknown>(
    session,
    `/v2/teams/${encodeURIComponent(teamId)}/games`
  );
  if (!Array.isArray(data)) return [];
  return (data as SidelineHdApiGame[]).filter(
    (g) => g && typeof g === 'object' && typeof g.id === 'string'
  );
}
