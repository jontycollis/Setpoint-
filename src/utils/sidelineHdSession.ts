// ── Sideline HD session persistence ────────────────────────────────────────
//
// Caches a snapshot of the WebView cookie jar to AsyncStorage so we can
// tell "user is already logged in" on next launch and skip the WebView
// step. The native cookie module ALSO persists across launches (it lives
// in the system WebView's jar), so this snapshot is mostly metadata — a
// timestamp for last-login + a sanity check that the user reached the
// dashboard at least once.
//
// The actual auth happens via the native cookie jar; this file is just
// a UX gate so the import screen knows whether to open the login WebView
// or jump straight to the team picker.
// ──────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@bior/sideline-hd-session/v1';

// One week. Sideline HD's actual cookie expiry isn't documented; we
// re-prompt for login after this even if the cookie is still alive in
// the jar, just to keep the "are we still logged in?" question honest.
const MAX_SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SidelineHdSessionRecord {
  /** Epoch ms when login was last confirmed (WebView reached dashboard). */
  loggedInAtMs: number;
  /** Best-effort capture of the cookie names we saw — for debugging only,
   *  values are deliberately NOT persisted here (the cookie jar is the
   *  source of truth). */
  cookieNames: string[];
}

export async function loadSidelineHdSession(): Promise<SidelineHdSessionRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SidelineHdSessionRecord;
    if (typeof parsed?.loggedInAtMs !== 'number') return null;
    if (Date.now() - parsed.loggedInAtMs > MAX_SESSION_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveSidelineHdSession(
  record: SidelineHdSessionRecord
): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[sidelineHdSession] save failed:', err);
  }
}

export async function clearSidelineHdSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore — best-effort
  }
}
