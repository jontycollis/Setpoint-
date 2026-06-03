// ── SidelineImportScreen ──────────────────────────────────────────────────
//
// Self-serve import flow for ANY user's Sideline HD historical match data.
// Distinct from `HistoricalImportScreen`, which only pulls the bundled
// PVC 3D Titanium static export.
//
// Approach (proven from the original Titanium import)
// ---------------------------------------------------
// Sideline HD's web pages cache ALL match data in localStorage on the
// user's browser when they're logged in and visit their team page (slug
// URL, e.g. https://sidelinehd.com/pvc3droyals). The flow is therefore:
//
//   1. Open a WebView on sidelinehd.com/login. The user logs in.
//   2. Let the user navigate freely inside the WebView — to the home
//      page, then to their team's slug URL.
//   3. When the WebView URL matches a team-page pattern, enable an
//      "Import this team's data" button.
//   4. Tapping it injects JS that copies `__pvc*` / `__review_*`
//      localStorage entries and posts them back via `onMessage`.
//   5. The parser (`sidelineHdParser.ts`) converts that snapshot into
//      `Match[]` and `runSidelineLocalStorageImport` persists them.
//   6. Show an "Imported N matches" done card. The user can navigate the
//      WebView to a different team's slug and import again — dedupe is
//      keyed on the source match id so re-imports are non-destructive.
//
// The previous API-shaped approach (Bearer JWT against Firebase auth)
// didn't work in a cookie-only WebView context; the API client was
// removed. This screen now drives the whole pipeline from the WebView.
//
// Native dep `@react-native-cookies/cookies` is still required for the
// "have we logged in?" sniff. We feature-flag the entry point on
// `isSidelineHdCookieModuleAvailable()` so an OTA push to devices
// running an older APK shows an "Available in next app version" notice
// instead of crashing the screen.
// ──────────────────────────────────────────────────────────────────────────

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type {
  WebViewNavigation,
  WebViewMessageEvent,
} from 'react-native-webview';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { UserProfile, TeamProfile } from '../types/profile';
import {
  SIDELINE_HD_LOGIN_URL,
  SIDELINE_HD_BASE_URL,
  isSidelineHdCookieModuleAvailable,
  readSidelineHdCookies,
  looksLikeAuthenticatedSession,
  clearSidelineHdCookies,
  type CookieMap,
} from '../utils/sidelineHdCookies';
import {
  loadSidelineHdSession,
  saveSidelineHdSession,
  clearSidelineHdSession,
  type SidelineHdSessionRecord,
} from '../utils/sidelineHdSession';
import { findTeamProfileByAlias } from '../utils/userProfile';
import {
  runSidelineLocalStorageImport,
  type SidelineLiveImportProgress,
  type SidelineLiveImportResult,
} from '../utils/sidelineHdLiveImporter';
import type { SidelineHdLocalStorageSnapshot } from '../utils/sidelineHdParser';

interface Props {
  userProfile: UserProfile | null;
  onBack: () => void;
  /**
   * Persist a new alias on the named TeamProfile. Called from the
   * `pick-team` flow once the user maps a Sideline HD slug to one of
   * their teams, so the next import of the same slug auto-matches
   * instead of dropping back into the picker. The parent owns the
   * userProfile and is responsible for both updating state and calling
   * saveUserProfile.
   */
  onAddTeamAlias?: (teamId: string, alias: string) => void;
}

// Team-page URL pattern: https://sidelinehd.com/<slug> with optional
// trailing slash. Reserved paths the page uses for auth / settings flows
// are filtered out so the import button doesn't light up on those.
const TEAM_PAGE_PATH_REGEX = /^\/([a-zA-Z0-9_-]{2,})\/?$/;
const RESERVED_SLUGS = new Set([
  'login',
  'logout',
  'signup',
  'register',
  'account',
  'settings',
  'profile',
  'home',
  'about',
  'help',
  'support',
  'terms',
  'privacy',
  'pricing',
  'features',
  'admin',
  'api',
  'app',
  'static',
  'media',
  'assets',
  'game',
  'games',
  'match',
  'matches',
  'team',
  'teams',
  'user',
  'users',
  'search',
]);

function extractTeamSlug(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('sidelinehd.com')) return null;
    const m = TEAM_PAGE_PATH_REGEX.exec(parsed.pathname);
    if (!m) return null;
    const slug = m[1]!;
    if (RESERVED_SLUGS.has(slug.toLowerCase())) return null;
    return slug;
  } catch {
    return null;
  }
}

/**
 * Normalize whatever a user types into the "Go to my team" input down to a
 * team slug, or return null when the input doesn't look like one. Accepts:
 *   • Bare slug:     "pvc3droyals"
 *   • Path:          "/pvc3droyals"
 *   • Bare host+path: "sidelinehd.com/pvc3droyals"
 *   • Full URL:      "https://sidelinehd.com/pvc3droyals"
 *   • With query/hash: "https://sidelinehd.com/pvc3droyals?invite=abc#roster"
 * Rejects reserved slugs (login/logout/settings/etc) so the user can't
 * accidentally navigate the WebView somewhere we know isn't a team page.
 */
function extractSlugFromUserInput(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.replace(/^sidelinehd\.com\//, '').replace(/^\//, '');
  // Drop query string and fragment.
  s = s.split('?')[0]!.split('#')[0]!;
  // Take the first path segment only — "pvc3droyals/roster" → "pvc3droyals".
  const slash = s.indexOf('/');
  if (slash !== -1) s = s.slice(0, slash);
  if (!/^[a-z0-9_-]{2,}$/.test(s)) return null;
  if (RESERVED_SLUGS.has(s)) return null;
  return s;
}

// Diagnostic: enumerate IndexedDB databases on the page and (when the
// modern `indexedDB.databases()` API is available) the object stores
// inside each. Sideline HD moved away from localStorage for match data,
// so this is where we look next.
const DIAGNOSE_INDEXEDDB_JS = `
(function() {
  try {
    if (!window.indexedDB) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        kind: 'idb-diagnostic',
        href: location.href,
        databases: [],
        note: 'indexedDB unavailable on this page',
      }));
      return;
    }
    var listPromise = (typeof indexedDB.databases === 'function')
      ? indexedDB.databases()
      : Promise.resolve([]);
    listPromise.then(function(dbs) {
      var summaries = [];
      var remaining = dbs.length;
      if (remaining === 0) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          kind: 'idb-diagnostic',
          href: location.href,
          databases: [],
          note: 'no indexedDB databases registered',
        }));
        return;
      }
      dbs.forEach(function(info) {
        var req = indexedDB.open(info.name, info.version);
        req.onsuccess = function() {
          var db = req.result;
          var stores = Array.prototype.slice.call(db.objectStoreNames);
          summaries.push({
            name: info.name,
            version: info.version,
            stores: stores,
          });
          db.close();
          remaining--;
          if (remaining === 0) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              kind: 'idb-diagnostic',
              href: location.href,
              databases: summaries,
            }));
          }
        };
        req.onerror = function() {
          summaries.push({
            name: info.name,
            version: info.version,
            error: 'open failed',
          });
          remaining--;
          if (remaining === 0) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              kind: 'idb-diagnostic',
              href: location.href,
              databases: summaries,
            }));
          }
        };
      });
    }).catch(function(err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        kind: 'idb-diagnostic',
        href: location.href,
        databases: [],
        note: 'indexedDB.databases() rejected: ' + String(err && err.message ? err.message : err),
      }));
    });
  } catch (err) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      kind: 'localstorage-error',
      error: String(err && err.message ? err.message : err),
    }));
  }
  true;
})();
`;

// Diagnostic: dump every localStorage key + value size. Lets us see when
// Sideline HD has renamed their cache prefixes (the import filter only
// captures __pvc* and __review_*). The response comes back as a
// `localstorage-diagnostic` message; the parent shows it in an Alert.
const DIAGNOSE_LOCALSTORAGE_JS = `
(function() {
  try {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k) continue;
      var v = localStorage.getItem(k);
      var size = v ? v.length : 0;
      // Capture a tiny prefix of the value so JSON-shaped payloads are
      // identifiable without ballooning the payload size.
      var preview = v ? v.substring(0, 60).replace(/\\s+/g, ' ') : '';
      keys.push({ key: k, size: size, preview: preview });
    }
    keys.sort(function(a, b) { return b.size - a.size; });
    window.ReactNativeWebView.postMessage(JSON.stringify({
      kind: 'localstorage-diagnostic',
      href: location.href,
      total: keys.length,
      keys: keys,
    }));
  } catch (err) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      kind: 'localstorage-error',
      error: String(err && err.message ? err.message : err),
    }));
  }
  true;
})();
`;

// Injected into the WebView to pull every Sideline HD-prefixed
// localStorage entry. The response comes back via `onMessage`.
const EXTRACT_LOCALSTORAGE_JS = `
(function() {
  try {
    var out = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k) continue;
      if (k.indexOf('__pvc') === 0 || k.indexOf('__review_') === 0) {
        out[k] = localStorage.getItem(k);
      }
    }
    window.ReactNativeWebView.postMessage(JSON.stringify({
      kind: 'localstorage-data',
      data: out,
      href: location.href,
    }));
  } catch (err) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      kind: 'localstorage-error',
      error: String(err && err.message ? err.message : err),
    }));
  }
  true;
})();
`;

type Stage =
  | { kind: 'check' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'logged-out' }
  | { kind: 'login' }
  | { kind: 'browsing'; session: SidelineHdSessionRecord }
  | {
      kind: 'extracting';
      session: SidelineHdSessionRecord;
      slug: string;
    }
  | {
      // Auto-match by alias didn't find a TeamProfile for this slug.
      // We render a picker so the user can choose the right team manually
      // instead of bouncing them out of the flow.
      kind: 'pick-team';
      slug: string;
      snapshot: SidelineHdLocalStorageSnapshot;
    }
  | {
      kind: 'importing';
      slug: string;
      teamProfile: TeamProfile;
      snapshot: SidelineHdLocalStorageSnapshot;
      progress: SidelineLiveImportProgress | null;
    }
  | {
      kind: 'done';
      slug: string;
      teamProfile: TeamProfile;
      result: SidelineLiveImportResult;
    }
  | {
      kind: 'error';
      slug: string;
      reason: string;
    };

export function SidelineImportScreen({
  userProfile,
  onBack,
  onAddTeamAlias,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [stage, setStage] = useState<Stage>({ kind: 'check' });
  // Current WebView URL — drives the "this is a team page" detection
  // that enables the Import button. Kept in state so the button can
  // re-render reactively as the user navigates.
  const [currentUrl, setCurrentUrl] = useState<string>(SIDELINE_HD_BASE_URL);
  const webViewRef = useRef<WebView>(null);

  // ── Initial probe ────────────────────────────────────────────────────
  //
  // The native cookie module gives us a "have we logged in?" fast path
  // (read the system cookie jar, restore the browsing stage). It's NOT
  // required for the import pipeline itself — that runs entirely through
  // the WebView + localStorage, both of which work in any RN build
  // (Expo Go included). On builds without the cookie module we just skip
  // the fast path and fall through to `logged-out`, which shows the
  // "Log in to Sideline HD" button.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadSidelineHdSession();
      if (cancelled) return;
      if (stored) {
        setStage({ kind: 'browsing', session: stored });
      } else {
        setStage({ kind: 'logged-out' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Login WebView navigation listener ────────────────────────────────
  //
  // While in the login stage we watch for the post-login redirect and
  // capture the session. Once logged in, we flip into the browsing stage
  // where the same WebView is left mounted so the user can navigate to
  // their team page.
  const handleNavigationStateChange = useCallback(
    async (navState: WebViewNavigation) => {
      const url = navState.url;
      setCurrentUrl(url);

      // In the login stage, watch for the redirect off the login page.
      // Two-path detection:
      //   (a) Native cookie module present — read the cookie jar and
      //       confirm an authenticated session before promoting. This is
      //       the strict path (only available on builds that ship the
      //       native module).
      //   (b) No cookie module (Expo Go, OTA-only) — trust the URL: any
      //       navigation off /login is treated as success. Looser, but
      //       the downstream team-slug check (TEAM_PAGE_PATH_REGEX) is
      //       the real safety net — without a real login the user
      //       can't reach their team page and the import button won't
      //       enable.
      setStage((prev) => {
        if (prev.kind !== 'login') return prev;
        const stillOnLoginPage = /\/login(\?|$|\/)/.test(url);
        if (stillOnLoginPage) return prev;

        const cookieModulePresent = isSidelineHdCookieModuleAvailable();
        if (!cookieModulePresent) {
          // Fallback: promote based on URL alone.
          const record: SidelineHdSessionRecord = {
            loggedInAtMs: Date.now(),
            cookieNames: [],
          };
          void saveSidelineHdSession(record);
          return { kind: 'browsing', session: record };
        }

        // Fire-and-forget the cookie check — we don't want to block the
        // navigation listener on the native bridge call.
        void (async () => {
          const cookies: CookieMap | null = await readSidelineHdCookies();
          if (!cookies || !looksLikeAuthenticatedSession(cookies)) return;
          const record: SidelineHdSessionRecord = {
            loggedInAtMs: Date.now(),
            cookieNames: Object.keys(cookies),
          };
          await saveSidelineHdSession(record);
          setStage({ kind: 'browsing', session: record });
        })();
        return prev;
      });
    },
    []
  );

  // ── Import runner ────────────────────────────────────────────────────
  //
  // Shared by both the auto-match path (slug → alias match in the WebView
  // message handler) and the pick-team path (user explicitly chooses a
  // TeamProfile from the StageBody picker). Drives the screen through
  // `importing` → `done` (or `error` on failure).
  const startImportForTeam = useCallback(
    (
      slug: string,
      snapshot: SidelineHdLocalStorageSnapshot,
      teamProfile: TeamProfile
    ) => {
      setStage({
        kind: 'importing',
        slug,
        teamProfile,
        snapshot,
        progress: null,
      });
      void (async () => {
        try {
          const result = await runSidelineLocalStorageImport({
            snapshot,
            teamProfileId: teamProfile.id,
            teamLabel: teamProfile.label,
            onProgress: (progress) =>
              setStage({
                kind: 'importing',
                slug,
                teamProfile,
                snapshot,
                progress,
              }),
          });
          setStage({ kind: 'done', slug, teamProfile, result });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setStage({ kind: 'error', slug, reason: msg });
        }
      })();
    },
    []
  );

  // ── WebView message handler ──────────────────────────────────────────
  //
  // Receives the JSON blob posted by the injected JS. Parses it, looks
  // up the team profile, and kicks off the import.
  const handleWebViewMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const raw = event.nativeEvent.data;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== 'object') return;
      const message = parsed as Record<string, unknown>;
      if (message.kind === 'idb-diagnostic') {
        // IndexedDB diagnostic: show which databases + object stores exist
        // on the page. Match-data candidates: any store named like games,
        // matches, reviews, plays, pvc*, etc.
        const dbs = Array.isArray(message.databases) ? message.databases : [];
        const href = typeof message.href === 'string' ? message.href : '(no url)';
        const note = typeof message.note === 'string' ? message.note : null;
        const body = dbs.length
          ? dbs.map((d: unknown) => {
              const dd = d as {
                name?: string;
                version?: number;
                stores?: string[];
                error?: string;
              };
              const stores = (dd.stores ?? []).join(', ') || '(no stores)';
              const head = `${dd.name ?? '?'} v${dd.version ?? '?'}`;
              return dd.error ? `${head} — ${dd.error}` : `${head}\n  ${stores}`;
            }).join('\n\n')
          : note ?? 'no databases';
        Alert.alert(`IndexedDB on ${href}`, body);
        return;
      }
      if (message.kind === 'localstorage-diagnostic') {
        // Diagnostic dump for troubleshooting "0 matches imported". Lists
        // every localStorage key with size + a short value preview so we
        // can see whether Sideline HD renamed their cache prefixes.
        const keys = Array.isArray(message.keys) ? message.keys : [];
        const href = typeof message.href === 'string' ? message.href : '(no url)';
        const lines = keys.slice(0, 30).map((k: unknown) => {
          const kk = k as { key?: string; size?: number; preview?: string };
          return `${kk.size ?? 0}B  ${kk.key ?? '?'}\n  ${kk.preview ?? ''}`;
        });
        const extra =
          keys.length > 30 ? `\n…and ${keys.length - 30} more` : '';
        Alert.alert(
          `localStorage on ${href}`,
          `${keys.length} key(s)\n\n${lines.join('\n\n')}${extra}`
        );
        return;
      }
      if (message.kind === 'localstorage-error') {
        setStage((prev) => {
          if (prev.kind !== 'extracting') return prev;
          return {
            kind: 'error',
            slug: prev.slug,
            reason:
              typeof message.error === 'string'
                ? message.error
                : 'WebView refused to read localStorage.',
          };
        });
        return;
      }
      if (message.kind !== 'localstorage-data') return;
      const data = message.data;
      if (!data || typeof data !== 'object') {
        setStage((prev) => {
          if (prev.kind !== 'extracting') return prev;
          return {
            kind: 'error',
            slug: prev.slug,
            reason: 'No localStorage entries returned.',
          };
        });
        return;
      }
      const entries: Record<string, string> = {};
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        if (typeof v === 'string') entries[k] = v;
      }
      setStage((prev) => {
        if (prev.kind !== 'extracting') return prev;
        const slug = prev.slug;
        const snapshot: SidelineHdLocalStorageSnapshot = {
          teamSlug: slug,
          entries,
        };
        // Resolve the local TeamProfile by matching the slug against the
        // user's team aliases. The slug is usually a slugified version
        // of the team name (e.g. "pvc3droyals") so we also try the
        // human-readable variant. If neither matches we fall through to
        // the `pick-team` stage rather than bouncing the user out — they
        // can choose which of their teams to map this slug onto.
        const teamProfile =
          findTeamProfileByAlias(userProfile, slug) ??
          findTeamProfileByAlias(userProfile, prettifySlug(slug));
        if (!teamProfile) {
          return {
            kind: 'pick-team',
            slug,
            snapshot,
          };
        }
        startImportForTeam(slug, snapshot, teamProfile);
        return {
          kind: 'importing',
          slug,
          teamProfile,
          snapshot,
          progress: null,
        };
      });
    },
    [userProfile, startImportForTeam]
  );

  const handleStartLogin = useCallback(() => {
    setStage({ kind: 'login' });
  }, []);

  const handleLogout = useCallback(async () => {
    await clearSidelineHdCookies();
    await clearSidelineHdSession();
    setStage({ kind: 'logged-out' });
  }, []);

  const handleImportFromCurrentPage = useCallback(() => {
    const slug = extractTeamSlug(currentUrl);
    if (!slug) {
      Alert.alert(
        'Not a team page',
        'Navigate to your team page on Sideline HD (e.g. sidelinehd.com/pvc3droyals) before tapping Import.'
      );
      return;
    }
    setStage((prev) => {
      if (prev.kind !== 'browsing') return prev;
      return { kind: 'extracting', session: prev.session, slug };
    });
    // Give the page a beat to finish populating localStorage, then
    // inject the extractor. The team page populates synchronously on
    // load (we observed it via the Titanium bundle), so 1.5s is
    // comfortably enough headroom.
    setTimeout(() => {
      webViewRef.current?.injectJavaScript(EXTRACT_LOCALSTORAGE_JS);
    }, 1500);
  }, [currentUrl]);

  const handleImportAnother = useCallback(() => {
    setStage((prev) => {
      // Whether we just finished a successful import or hit an error,
      // dropping back to browsing lets the user navigate to another
      // team page and run the flow again.
      if (prev.kind === 'done' || prev.kind === 'error') {
        // We don't have the session record handy here — re-load it.
        return { kind: 'check' };
      }
      return prev;
    });
    void (async () => {
      const stored = await loadSidelineHdSession();
      if (stored) setStage({ kind: 'browsing', session: stored });
      else setStage({ kind: 'logged-out' });
    })();
  }, []);

  // Show the WebView for the login + browsing + extracting stages — the
  // same WebView instance is reused so cookies and DOM state persist
  // across navigation.
  const showWebView =
    stage.kind === 'login' ||
    stage.kind === 'browsing' ||
    stage.kind === 'extracting';

  const currentSlug = useMemo(
    () => extractTeamSlug(currentUrl),
    [currentUrl]
  );

  return (
    <View style={styles.container}>
      <Hero onBack={onBack} colors={colors} />
      {showWebView ? (
        // KeyboardAvoidingView pushes the slug-input footer above the
        // soft keyboard. iOS needs explicit 'padding' behaviour;
        // Android's default windowSoftInputMode is 'resize' which
        // usually handles this natively, but adding 'height' here is a
        // belt-and-suspenders safeguard against per-device differences
        // (some Samsung OEMs reportedly fall back to 'pan').
        <KeyboardAvoidingView
          style={styles.webviewWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <WebView
            ref={webViewRef}
            source={{ uri: SIDELINE_HD_LOGIN_URL }}
            onNavigationStateChange={handleNavigationStateChange}
            onMessage={handleWebViewMessage}
            startInLoadingState={true}
            renderLoading={() => (
              <View style={styles.webviewLoading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            )}
            userAgent={
              'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
            }
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            javaScriptEnabled={true}
            domStorageEnabled={true}
          />
          <WebViewFooter
            stage={stage}
            currentUrl={currentUrl}
            currentSlug={currentSlug}
            onImport={handleImportFromCurrentPage}
            onCancel={() => setStage({ kind: 'logged-out' })}
            onNavigateToSlug={(slug) => {
              // Navigate the WebView to the user-entered team URL without
              // re-mounting (which would lose the logged-in session). The
              // `true;` at the end keeps injectJavaScript happy — it
              // expects a truthy return.
              const targetUrl = `https://sidelinehd.com/${slug}`;
              const js = `window.location.href = ${JSON.stringify(targetUrl)}; true;`;
              webViewRef.current?.injectJavaScript(js);
            }}
            onDiagnoseLocalStorage={() => {
              // Fires the diagnostic JS; results come back via
              // `handleWebViewMessage` and surface in an Alert.
              webViewRef.current?.injectJavaScript(DIAGNOSE_LOCALSTORAGE_JS);
            }}
            onDiagnoseIndexedDB={() => {
              webViewRef.current?.injectJavaScript(DIAGNOSE_INDEXEDDB_JS);
            }}
            colors={colors}
          />
        </KeyboardAvoidingView>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <StageBody
            stage={stage}
            userProfile={userProfile}
            onStartLogin={handleStartLogin}
            onLogout={handleLogout}
            onDone={onBack}
            onImportAnother={handleImportAnother}
            onSelectTeam={(team) =>
              setStage((prev) => {
                // Guard: only act when we're actually in pick-team. Anything
                // else (stale tap, re-render race) is a no-op.
                if (prev.kind !== 'pick-team') return prev;
                // Persist the slug as an alias on the chosen team so the
                // next import of the same slug auto-matches. Fire-and-
                // forget — the import itself doesn't depend on the alias
                // landing, and the parent handles its own error logging.
                onAddTeamAlias?.(team.id, prev.slug);
                startImportForTeam(prev.slug, prev.snapshot, team);
                return {
                  kind: 'importing',
                  slug: prev.slug,
                  teamProfile: team,
                  snapshot: prev.snapshot,
                  progress: null,
                };
              })
            }
            colors={colors}
          />
        </ScrollView>
      )}
    </View>
  );
}

// Turn "pvc3droyals" into "PVC 3D Royals" — best-effort, used as a
// fallback when matching the slug to a TeamProfile alias.
function prettifySlug(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function WebViewFooter({
  stage,
  currentUrl,
  currentSlug,
  onImport,
  onCancel,
  onNavigateToSlug,
  onDiagnoseLocalStorage,
  onDiagnoseIndexedDB,
  colors,
}: {
  stage: Stage;
  currentUrl: string;
  currentSlug: string | null;
  onImport: () => void;
  onCancel: () => void;
  onNavigateToSlug: (slug: string) => void;
  onDiagnoseLocalStorage: () => void;
  onDiagnoseIndexedDB: () => void;
  colors: ThemeColors;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Controlled input for the "Go to my team" slug entry. Persists across
  // re-renders inside this footer so the user doesn't lose what they
  // typed if the WebView triggers an unrelated state change upstream.
  const [slugInput, setSlugInput] = useState('');
  const handleGo = useCallback(() => {
    const slug = extractSlugFromUserInput(slugInput);
    if (!slug) {
      Alert.alert(
        'Enter your team URL or slug',
        'Type your Sideline HD team URL (e.g. https://sidelinehd.com/pvc3droyals) or just the slug (pvc3droyals).'
      );
      return;
    }
    onNavigateToSlug(slug);
  }, [slugInput, onNavigateToSlug]);
  if (stage.kind === 'login') {
    return (
      <View style={styles.webviewFooter}>
        <Text style={styles.webviewFooterText}>
          Log in above. We&apos;ll detect when you reach the dashboard. If
          you&apos;re already logged in, type your team URL below and tap Go.
        </Text>
        {/*
         * Same slug-entry escape hatch we show in browsing. Sideline HD
         * sometimes keeps the URL at /login even after a successful sign-in
         * (they swap page content in place), which leaves our nav listener
         * unable to promote the stage. Letting the user navigate by slug
         * here unblocks that path.
         */}
        <View style={styles.slugInputRow}>
          <TextInput
            style={styles.slugInput}
            value={slugInput}
            onChangeText={setSlugInput}
            placeholder="pvc3droyals or sidelinehd.com/pvc3droyals"
            placeholderTextColor={colors.textLight}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={handleGo}
          />
          <TouchableOpacity
            style={styles.slugGoBtn}
            onPress={handleGo}
            activeOpacity={0.7}
          >
            <Text style={styles.slugGoBtnLabel}>Go</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          onPress={onCancel}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.webviewFooterLink}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (stage.kind === 'extracting') {
    return (
      <View style={styles.webviewFooter}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.webviewFooterText}>
          Reading {stage.slug}…
        </Text>
      </View>
    );
  }
  // browsing
  const importEnabled = currentSlug != null;
  return (
    <View style={styles.webviewFooter}>
      <Text style={styles.webviewFooterText}>
        {importEnabled
          ? `Ready: ${currentSlug} — or switch teams below`
          : 'Navigate to your team page, or enter your Sideline HD team URL below.'}
      </Text>
      <View style={styles.slugInputRow}>
        <TextInput
          style={styles.slugInput}
          value={slugInput}
          onChangeText={setSlugInput}
          placeholder="pvc3droyals or sidelinehd.com/pvc3droyals"
          placeholderTextColor={colors.textLight}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={handleGo}
        />
        <TouchableOpacity
          style={styles.slugGoBtn}
          onPress={handleGo}
          activeOpacity={0.7}
        >
          <Text style={styles.slugGoBtnLabel}>Go</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.webviewFooterRow}>
        <TouchableOpacity
          onPress={onCancel}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.webviewFooterLink}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDiagnoseLocalStorage}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.webviewFooterLink}>localStorage</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDiagnoseIndexedDB}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.webviewFooterLink}>IndexedDB</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onImport}
          disabled={!importEnabled}
          style={[styles.webviewImportBtn, !importEnabled && styles.ctaDisabled]}
          activeOpacity={0.7}
        >
          <Text style={styles.webviewImportBtnLabel}>
            {importEnabled ? "Import this team's data" : 'Import'}
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.webviewFooterHint}>{currentUrl}</Text>
    </View>
  );
}

function StageBody({
  stage,
  userProfile,
  onStartLogin,
  onLogout,
  onDone,
  onImportAnother,
  onSelectTeam,
  colors,
}: {
  stage: Stage;
  userProfile: UserProfile | null;
  onStartLogin: () => void;
  onLogout: () => void;
  onDone: () => void;
  onImportAnother: () => void;
  onSelectTeam: (team: TeamProfile) => void;
  colors: ThemeColors;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (stage.kind === 'check') {
    return (
      <View style={styles.centeredBlock}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (stage.kind === 'unavailable') {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Available in next app version</Text>
        <Text style={styles.cardBody}>
          This feature needs native modules that ship with the next APK
          build. Your app will get them automatically on the next store
          update — no action needed.
        </Text>
        {__DEV__ ? (
          <Text style={styles.cardDebug}>Debug: {stage.reason}</Text>
        ) : null}
      </View>
    );
  }
  if (stage.kind === 'logged-out') {
    return (
      <>
        <Text style={styles.intro}>
          Pull your historical match data from Sideline HD into Bior. Log
          in below — your session stays on this device.
        </Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Connect Sideline HD</Text>
          <Text style={styles.cardBody}>
            We&apos;ll open Sideline HD in a secure window. Once
            you&apos;re logged in, navigate to your team&apos;s page and
            tap &ldquo;Import this team&apos;s data&rdquo;.
          </Text>
          <TouchableOpacity
            style={styles.cta}
            onPress={onStartLogin}
            activeOpacity={0.7}
          >
            <Text style={styles.ctaLabel}>Log in to Sideline HD</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }
  if (stage.kind === 'pick-team') {
    // Auto-match failed. Surface the user's "me" teams so they can pick
    // the one this snapshot belongs to. Watching-only teams are
    // intentionally hidden — you import INTO teams that are yours.
    const meTeams = (userProfile?.teams ?? []).filter(
      (t) => t.kind === 'me'
    );
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Pick a team for {stage.slug}</Text>
        <Text style={styles.cardBody}>
          We couldn&apos;t auto-match &ldquo;{stage.slug}&rdquo; to one of
          your teams. Choose which team to import this data into.
        </Text>
        {meTeams.length === 0 ? (
          <View style={styles.pickTeamEmpty}>
            <Text style={styles.cardBody}>
              You don&apos;t have any teams set up yet. Open My Team to add
              one, then come back and try the import again.
            </Text>
          </View>
        ) : (
          <View style={styles.pickTeamList}>
            {meTeams.map((team) => (
              <TouchableOpacity
                key={team.id}
                style={styles.pickTeamRow}
                onPress={() => onSelectTeam(team)}
                activeOpacity={0.7}
              >
                <View style={styles.pickTeamRowText}>
                  <Text style={styles.pickTeamRowLabel}>{team.label}</Text>
                  {team.seasonLabel ? (
                    <Text style={styles.pickTeamRowMeta}>
                      {team.seasonLabel}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.pickTeamRowCta}>Use</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <TouchableOpacity
          onPress={onDone}
          style={styles.cardSecondary}
          activeOpacity={0.7}
        >
          <Text style={styles.cardSecondaryLabel}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (stage.kind === 'importing') {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Importing {stage.slug}…</Text>
        {stage.progress ? (
          <>
            <Text style={styles.cardMeta}>
              {stage.progress.index + 1} of {stage.progress.total}
            </Text>
            <Text style={styles.cardBody}>{stage.progress.label}</Text>
          </>
        ) : (
          <Text style={styles.cardBody}>Starting…</Text>
        )}
        <View style={styles.centeredBlock}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }
  if (stage.kind === 'done') {
    const r = stage.result;
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {'✓'} Imported {r.imported} match
          {r.imported === 1 ? '' : 'es'} for {stage.teamProfile.label}
        </Text>
        <Text style={styles.cardBody}>
          {r.skipped > 0
            ? `Skipped ${r.skipped} already in your library.\n`
            : ''}
          {r.failed > 0
            ? `Failed to import ${r.failed} — see warnings below.\n`
            : ''}
          {r.imported > 0
            ? `Open ${stage.teamProfile.label} in My Team to see your new analytics.`
            : ''}
        </Text>
        {r.warnings.length > 0 ? (
          <>
            <Text style={styles.diagnosticHeader}>Warnings:</Text>
            {r.warnings.slice(0, 6).map((w, i) => (
              <Text key={i} style={styles.diagnosticLine}>
                • {w}
              </Text>
            ))}
            {r.warnings.length > 6 ? (
              <Text style={styles.diagnosticLine}>
                …plus {r.warnings.length - 6} more
              </Text>
            ) : null}
          </>
        ) : null}
        <TouchableOpacity
          style={styles.cta}
          onPress={onDone}
          activeOpacity={0.7}
        >
          <Text style={styles.ctaLabel}>Done</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryCta}
          onPress={onImportAnother}
          activeOpacity={0.7}
        >
          <Text style={styles.secondaryCtaLabel}>Import another team</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryCta}
          onPress={onLogout}
          activeOpacity={0.7}
        >
          <Text style={styles.secondaryCtaLabel}>Log out</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (stage.kind === 'error') {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Couldn&apos;t import {stage.slug}</Text>
        <Text style={styles.cardBody}>{stage.reason}</Text>
        <TouchableOpacity
          style={styles.cta}
          onPress={onImportAnother}
          activeOpacity={0.7}
        >
          <Text style={styles.ctaLabel}>Try again</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryCta}
          onPress={onLogout}
          activeOpacity={0.7}
        >
          <Text style={styles.secondaryCtaLabel}>Log out</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return null;
}

function Hero({
  onBack,
  colors,
}: {
  onBack: () => void;
  colors: ThemeColors;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.hero}>
      <TouchableOpacity
        onPress={onBack}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.heroBack}>{'< Back'}</Text>
      </TouchableOpacity>
      <Text style={styles.heroKicker}>MY TEAM</Text>
      <Text style={styles.heroTitle}>Import from Sideline HD</Text>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    hero: {
      backgroundColor: colors.primary,
      padding: spacing.xxl,
      paddingBottom: spacing.lg,
    },
    heroBack: {
      color: 'rgba(255,255,255,0.9)',
      fontSize: fontSize.md,
      fontWeight: '600',
      marginBottom: spacing.sm,
    },
    heroKicker: {
      color: 'rgba(255,255,255,0.7)',
      fontSize: fontSize.xs,
      fontWeight: '700',
      letterSpacing: 1,
    },
    heroTitle: {
      color: colors.textOnPrimary,
      fontSize: fontSize.xxl,
      fontWeight: '800',
    },
    scrollContent: {
      padding: spacing.lg,
    },
    centeredBlock: {
      paddingVertical: spacing.xxl,
      alignItems: 'center',
    },
    intro: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      marginBottom: spacing.lg,
      lineHeight: 20,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      padding: spacing.lg,
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardTitle: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.text,
      marginBottom: spacing.xs,
    },
    cardMeta: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      marginBottom: spacing.md,
    },
    cardBody: {
      fontSize: fontSize.sm,
      color: colors.text,
      lineHeight: 20,
      marginBottom: spacing.md,
    },
    cardDebug: {
      fontSize: fontSize.xs,
      color: colors.textLight,
      fontFamily: 'monospace',
      marginTop: spacing.sm,
    },
    diagnosticHeader: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.textSecondary,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    diagnosticLine: {
      fontSize: fontSize.xs,
      color: colors.textLight,
      fontFamily: 'monospace',
      marginBottom: 2,
    },
    cta: {
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    ctaDisabled: {
      opacity: 0.5,
    },
    ctaLabel: {
      color: colors.textOnPrimary,
      fontSize: fontSize.md,
      fontWeight: '700',
    },
    cardSecondary: {
      paddingVertical: spacing.sm,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    cardSecondaryLabel: {
      color: colors.primary,
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
    pickTeamEmpty: {
      paddingVertical: spacing.sm,
    },
    pickTeamList: {
      gap: spacing.xs,
    },
    pickTeamRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.background,
    },
    pickTeamRowText: {
      flex: 1,
      paddingRight: spacing.sm,
    },
    pickTeamRowLabel: {
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: colors.text,
    },
    pickTeamRowMeta: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      marginTop: 2,
    },
    pickTeamRowCta: {
      fontSize: fontSize.sm,
      fontWeight: '700',
      color: colors.primary,
    },
    secondaryCta: {
      backgroundColor: 'transparent',
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.xs,
    },
    secondaryCtaLabel: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
    webviewWrap: {
      flex: 1,
      backgroundColor: colors.background,
    },
    webviewLoading: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    webviewFooter: {
      padding: spacing.md,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
      alignItems: 'stretch',
      gap: spacing.xs,
    },
    webviewFooterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.xs,
    },
    webviewFooterText: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
    },
    webviewFooterLink: {
      fontSize: fontSize.sm,
      color: colors.primary,
      fontWeight: '600',
    },
    webviewFooterHint: {
      fontSize: 10,
      color: colors.textLight,
      fontFamily: 'monospace',
      marginTop: spacing.xs,
    },
    slugInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    slugInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.divider,
      borderRadius: borderRadius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      fontSize: fontSize.sm,
      color: colors.text,
      backgroundColor: colors.background,
    },
    slugGoBtn: {
      backgroundColor: colors.primary,
      borderRadius: borderRadius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
    },
    slugGoBtnLabel: {
      color: '#ffffff',
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
    webviewImportBtn: {
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    webviewImportBtnLabel: {
      color: colors.textOnPrimary,
      fontSize: fontSize.sm,
      fontWeight: '700',
    },
  });
}

/**
 * Stable route name for the launcher tile that the parallel home-screen
 * launcher session is wiring up. Keeping this exported as a constant so
 * both screens agree on the spelling.
 */
export const SIDELINE_IMPORT_ROUTE_NAME = 'import-sideline-hd';
