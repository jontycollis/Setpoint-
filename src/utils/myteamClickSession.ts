// ── MyTeam.Click session persistence ──────────────────────────────────────
//
// Stores the captured JWT + player metadata for the MyTeam.Click
// platform integration (#3 + #4 + #5). The connection screen
// (`MyTeamClickConnectionScreen`) injects a small bit of JS into a
// WebView at https://myteam.click after the user logs in; that JS
// reads `localStorage.CapacitorStorage.user` and posts it back, where
// we land it here.
//
// Why store both the JWT and the player metadata?
//   • The JWT is what the API client (`myteamClickClient.ts`) needs to
//     authenticate every request.
//   • `myPlayerId` is the discriminator for projection — without it
//     we can't tell which team in a multi-team event belongs to this
//     athlete.
//
// Single record per app install today. Multi-athlete MRS (#19) showed
// the per-athlete pattern; MyTeam.Click is per-account here because
// the platform itself is single-account (one player per login). If
// the app later needs to track multiple linked MyTeam.Click accounts
// (e.g. a parent's account AND each child's), the record promotes
// into an array — that's a small migration when it lands.
// ──────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@bior/myteamclick-session/v1';

/**
 * One linked MyTeam.Click account. The JWT is long-lived (sample
 * probe token had a ~28-year exp) so explicit expiry tracking isn't
 * needed; we still record `linkedAtMs` for UX ("connected 3 days
 * ago") and to drive a "re-link recommended" hint when older than
 * 90d.
 */
export interface MyTeamClickSessionRecord {
  /** JWT — `token` header value for every API call. */
  jwt: string;
  /** Player id captured from `CapacitorStorage.user._id`. Drives
   *  projection in `myteamClickSeasonIndex.ts`. */
  playerId: string;
  /** Display name captured at link time. May go stale if the user
   *  edits their MyTeam.Click profile; refresh on next link. */
  firstName: string;
  lastName: string;
  /** Epoch ms when the JWT was captured. */
  linkedAtMs: number;
}

/** Suggest the user re-link when the saved record is older than this. */
const RELINK_SUGGESTED_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export async function loadMyTeamClickSession(): Promise<MyTeamClickSessionRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MyTeamClickSessionRecord;
    if (
      typeof parsed?.jwt !== 'string' ||
      parsed.jwt.length === 0 ||
      typeof parsed?.playerId !== 'string' ||
      parsed.playerId.length === 0
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveMyTeamClickSession(
  record: MyTeamClickSessionRecord
): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[myteamClickSession] save failed:', err);
  }
}

export async function clearMyTeamClickSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* best-effort */
  }
}

/**
 * Pure helper — does the saved record look stale enough that we should
 * nudge the user to re-link? Exposed for the UI; tests cover the
 * threshold without needing to mock Date.
 */
export function shouldSuggestRelink(
  record: MyTeamClickSessionRecord,
  now: number = Date.now()
): boolean {
  return now - record.linkedAtMs > RELINK_SUGGESTED_AGE_MS;
}

/**
 * Pure helper — extract the session record from a raw JSON string
 * posted by the WebView injection script. Defensive about partial /
 * malformed input. Returns null when the JSON doesn't have the
 * required fields; caller surfaces a "couldn't capture login" error.
 *
 * The injected script reads `localStorage.CapacitorStorage.user`,
 * which is a stringified JSON blob. The blob's shape (per the probe):
 * `{"token": "<jwt>", "_id": "<playerId>", "firstName": "...",
 *  "lastName": "..."}`.
 */
export function parseCapturedUserBlob(
  raw: string,
  now: number = Date.now()
): MyTeamClickSessionRecord | null {
  try {
    const blob = JSON.parse(raw);
    if (
      !blob ||
      typeof blob !== 'object' ||
      typeof blob.token !== 'string' ||
      blob.token.length === 0 ||
      typeof blob._id !== 'string' ||
      blob._id.length === 0
    ) {
      return null;
    }
    return {
      jwt: blob.token,
      playerId: blob._id,
      firstName: typeof blob.firstName === 'string' ? blob.firstName : '',
      lastName: typeof blob.lastName === 'string' ? blob.lastName : '',
      linkedAtMs: now,
    };
  } catch {
    return null;
  }
}
