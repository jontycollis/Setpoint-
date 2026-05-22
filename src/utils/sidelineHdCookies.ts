// ── Sideline HD cookie module wrapper ─────────────────────────────────────
//
// `@react-native-cookies/cookies` is a NATIVE module — it needs an APK
// rebuild to ship. OTA pushes can include the JS that calls into it, but
// the module won't be present on devices running an older APK. Calling
// it on an OTA-only build crashes the screen with an unhelpful TurboModule
// error.
//
// This wrapper isolates the require + native call surface so the rest of
// the app can interrogate `isSidelineHdCookieModuleAvailable()` to decide
// whether to surface the Sideline HD import entry point at all.
//
// On builds where the module is absent, the function returns false and
// all read/clear helpers no-op. The screen renders an "Available in next
// app version" notice instead of the WebView flow.
// ──────────────────────────────────────────────────────────────────────────

export const SIDELINE_HD_LOGIN_URL = 'https://sidelinehd.com/login';
export const SIDELINE_HD_BASE_URL = 'https://sidelinehd.com';

type CookieValue = {
  value: string;
  expires?: string;
  domain?: string;
  path?: string;
};

type CookieMap = Record<string, CookieValue>;

interface CookieManagerModule {
  get(url: string, useWebKit?: boolean): Promise<CookieMap>;
  clearAll(useWebKit?: boolean): Promise<boolean>;
  clearByName?(url: string, name: string, useWebKit?: boolean): Promise<boolean>;
}

// Resolve the module once at import time. The require is wrapped in a
// try/catch so a missing native module (OTA on an older APK) doesn't
// crash the whole bundle — it just sets `cookieModule` to null and the
// feature flag stays off.
let cookieModule: CookieManagerModule | null = null;
let loadError: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@react-native-cookies/cookies');
  cookieModule = (mod?.default ?? mod) as CookieManagerModule;
  // Sanity-check that the resolved object actually has the methods we
  // need — a partial export (e.g. JS shim with no native backing) should
  // be treated the same as a missing module.
  if (typeof cookieModule?.get !== 'function') {
    cookieModule = null;
    loadError = 'cookie module loaded but has no .get method';
  }
} catch (err) {
  cookieModule = null;
  loadError = err instanceof Error ? err.message : String(err);
}

/**
 * True when the native cookie module is loaded and usable. Returns false
 * on OTA-only builds that don't have the native module compiled in. The
 * Sideline HD import entry point should be hidden (or shown disabled with
 * an "Available in next app version" notice) when this is false.
 */
export function isSidelineHdCookieModuleAvailable(): boolean {
  return cookieModule !== null;
}

/**
 * Diagnostic — returns the require() error message if the module failed
 * to load. Useful for surfacing in the unavailable-state UI so we can
 * see why on devices in the wild.
 */
export function getSidelineHdCookieModuleLoadError(): string | null {
  return loadError;
}

/**
 * Read all cookies set for the Sideline HD domain. Returns null if the
 * native module isn't available. The cookies live in the WebView's
 * shared cookie jar — once the user logs in via WebView, the session
 * cookie shows up here for subsequent fetch() calls from RN.
 */
export async function readSidelineHdCookies(): Promise<CookieMap | null> {
  if (!cookieModule) return null;
  try {
    // `useWebKit=true` on iOS reads the WKWebView jar (matches the
    // WebView we render). On Android the flag is ignored — the system
    // cookie jar is shared with the WebView automatically.
    return await cookieModule.get(SIDELINE_HD_BASE_URL, true);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[sidelineHdCookies] readSidelineHdCookies failed:', err);
    return null;
  }
}

/**
 * Build a Cookie request header from a CookieMap. Returns an empty
 * string if the map is empty or null. Used by fetch() callers that need
 * to authenticate against Sideline HD's API after WebView login.
 */
export function buildCookieHeader(cookies: CookieMap | null): string {
  if (!cookies) return '';
  const parts: string[] = [];
  for (const [name, c] of Object.entries(cookies)) {
    if (c?.value) parts.push(`${name}=${c.value}`);
  }
  return parts.join('; ');
}

/**
 * Heuristic: do the cookies we got back look like an authenticated
 * session? Sideline HD's exact session cookie name isn't documented, so
 * we accept any non-tracking cookie that smells session-y. Refine once
 * we observe a real logged-in cookie jar from a test account.
 */
export function looksLikeAuthenticatedSession(
  cookies: CookieMap | null
): boolean {
  if (!cookies) return false;
  for (const name of Object.keys(cookies)) {
    const lower = name.toLowerCase();
    // Skip well-known third-party tracking cookies — they don't imply login.
    if (lower.startsWith('_ga') || lower.startsWith('_gid') || lower.startsWith('_gat')) {
      continue;
    }
    if (
      lower.includes('session') ||
      lower.includes('auth') ||
      lower.includes('token') ||
      lower === 'connect.sid' ||
      lower.startsWith('sid')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Clear all cookies for sidelinehd.com — wired to the "log out" button on
 * the import screen so a user can switch accounts without uninstalling.
 * No-ops if the native module isn't available.
 */
export async function clearSidelineHdCookies(): Promise<void> {
  if (!cookieModule) return;
  try {
    await cookieModule.clearAll(true);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[sidelineHdCookies] clearSidelineHdCookies failed:', err);
  }
}

export type { CookieMap, CookieValue };
