// ── SidelineImportScreen ──────────────────────────────────────────────────
//
// Self-serve import flow for ANY user's Sideline HD historical match data.
// Distinct from `HistoricalImportScreen`, which only pulls the bundled
// PVC 3D Titanium static export. This screen drives the full pipeline:
//
//   stage="check"       — feature flag + session sniff
//   stage="login"       — WebView pointed at sidelinehd.com/login;
//                         we watch URL changes for the post-login redirect
//                         and read the cookie jar.
//   stage="teams"       — (TODO next session) list teams the user has
//                         access to, fetched via Sideline HD's API
//   stage="scrape"      — (TODO next session) walk the selected team's
//                         matches, parse rally data into Match[]
//   stage="preview"     — (TODO next session) confirm + dedupe
//   stage="import"      — wire into existing `runHistoricalImport`-style
//                         persistence
//
// Native dep `@react-native-cookies/cookies` is required for cookie
// capture. We feature-flag the entry point on
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
} from 'react-native';
import { WebView } from 'react-native-webview';
import type {
  WebViewNavigation,
  WebViewMessageEvent,
} from 'react-native-webview';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { UserProfile } from '../types/profile';
import {
  SIDELINE_HD_LOGIN_URL,
  isSidelineHdCookieModuleAvailable,
  getSidelineHdCookieModuleLoadError,
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

interface Props {
  userProfile: UserProfile | null;
  onBack: () => void;
}

type Stage =
  | { kind: 'check' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'logged-out' }
  | { kind: 'login' }
  | { kind: 'logged-in'; session: SidelineHdSessionRecord }
  | { kind: 'teams-todo' };

export function SidelineImportScreen({ userProfile: _userProfile, onBack }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [stage, setStage] = useState<Stage>({ kind: 'check' });
  const webViewRef = useRef<WebView>(null);
  // Holds the most-recent URL the WebView navigated to — used by the
  // dashboard sniff to decide if login is done. Stored in a ref because
  // we read it from async callbacks where stale closure state would lie.
  const lastUrlRef = useRef<string>(SIDELINE_HD_LOGIN_URL);

  // ── Initial probe ────────────────────────────────────────────────────
  // Run once on mount: confirm the native cookie module is present, then
  // check if the user has a fresh session stored. If both pass, jump
  // straight past the login WebView to the teams stub.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isSidelineHdCookieModuleAvailable()) {
        const detail =
          getSidelineHdCookieModuleLoadError() ??
          'Native cookie module not present in this build.';
        if (!cancelled) setStage({ kind: 'unavailable', reason: detail });
        return;
      }
      const stored = await loadSidelineHdSession();
      if (cancelled) return;
      if (stored) {
        setStage({ kind: 'logged-in', session: stored });
      } else {
        setStage({ kind: 'logged-out' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Login WebView navigation listener ────────────────────────────────
  // After the user submits credentials, Sideline HD redirects away from
  // `/login`. We poll the cookie jar on each navigation change and, if
  // an authenticated-looking cookie set is present AND the URL is no
  // longer on the login page, treat that as success.
  const handleNavigationStateChange = useCallback(
    async (navState: WebViewNavigation) => {
      const url = navState.url;
      lastUrlRef.current = url;
      // The login page redirects through one or more intermediate URLs
      // before landing on the dashboard. We only consider the cookie jar
      // once we've left /login entirely.
      const stillOnLoginPage = /\/login(\?|$|\/)/.test(url);
      if (stillOnLoginPage) return;
      const cookies: CookieMap | null = await readSidelineHdCookies();
      if (!cookies) return;
      if (!looksLikeAuthenticatedSession(cookies)) return;
      const record: SidelineHdSessionRecord = {
        loggedInAtMs: Date.now(),
        cookieNames: Object.keys(cookies),
      };
      await saveSidelineHdSession(record);
      setStage({ kind: 'logged-in', session: record });
    },
    []
  );

  const handleStartLogin = useCallback(() => {
    setStage({ kind: 'login' });
  }, []);

  const handleLogout = useCallback(async () => {
    await clearSidelineHdCookies();
    await clearSidelineHdSession();
    setStage({ kind: 'logged-out' });
  }, []);

  const handleContinueToTeams = useCallback(() => {
    // Placeholder for next session — team picker + scrape + preview live
    // here. For now, surface a friendly "coming soon" so the user can at
    // least confirm the login + capture worked end-to-end.
    Alert.alert(
      'Team picker — coming soon',
      'Login + cookie capture is working. Team listing, match scrape, and import flow ship in the next update.'
    );
    setStage({ kind: 'teams-todo' });
  }, []);

  return (
    <View style={styles.container}>
      <Hero onBack={onBack} colors={colors} />
      {stage.kind === 'login' ? (
        <View style={styles.webviewWrap}>
          <WebView
            ref={webViewRef}
            source={{ uri: SIDELINE_HD_LOGIN_URL }}
            onNavigationStateChange={handleNavigationStateChange}
            onMessage={(_e: WebViewMessageEvent) => {
              // No-op — login page doesn't postMessage. Keeping the prop
              // around makes injecting diagnostics later trivial.
            }}
            startInLoadingState={true}
            renderLoading={() => (
              <View style={styles.webviewLoading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            )}
            // Mobile UA so Sideline HD serves the mobile login layout —
            // matches what users would see in their phone browser.
            userAgent={
              'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
            }
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            javaScriptEnabled={true}
            domStorageEnabled={true}
          />
          <View style={styles.webviewFooter}>
            <Text style={styles.webviewFooterText}>
              Log in above. We&apos;ll detect when you reach the dashboard.
            </Text>
            <TouchableOpacity
              onPress={() => setStage({ kind: 'logged-out' })}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.webviewFooterLink}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <StageBody
            stage={stage}
            onStartLogin={handleStartLogin}
            onLogout={handleLogout}
            onContinueToTeams={handleContinueToTeams}
            colors={colors}
          />
        </ScrollView>
      )}
    </View>
  );
}

function StageBody({
  stage,
  onStartLogin,
  onLogout,
  onContinueToTeams,
  colors,
}: {
  stage: Stage;
  onStartLogin: () => void;
  onLogout: () => void;
  onContinueToTeams: () => void;
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
            We&apos;ll open the Sideline HD login page in a secure
            window. Once you&apos;re in, we&apos;ll list your teams and
            you can pick which one to import.
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
  if (stage.kind === 'logged-in' || stage.kind === 'teams-todo') {
    const session = stage.kind === 'logged-in' ? stage.session : null;
    return (
      <>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{'✓'} Connected to Sideline HD</Text>
          {session ? (
            <Text style={styles.cardMeta}>
              Logged in{' '}
              {new Date(session.loggedInAtMs).toLocaleString()}
            </Text>
          ) : null}
          <Text style={styles.cardBody}>
            Next: pick which team to import matches for. Coming in the
            next update — this session shipped the login + cookie
            capture so we could verify it works end-to-end.
          </Text>
          <TouchableOpacity
            style={styles.cta}
            onPress={onContinueToTeams}
            activeOpacity={0.7}
          >
            <Text style={styles.ctaLabel}>Continue to teams</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryCta}
            onPress={onLogout}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryCtaLabel}>Log out</Text>
          </TouchableOpacity>
        </View>
      </>
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
    cta: {
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    ctaLabel: {
      color: colors.textOnPrimary,
      fontSize: fontSize.md,
      fontWeight: '700',
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
      alignItems: 'center',
    },
    webviewFooterText: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      marginBottom: spacing.xs,
    },
    webviewFooterLink: {
      fontSize: fontSize.sm,
      color: colors.primary,
      fontWeight: '600',
    },
  });
}

/**
 * Stable route name for the launcher tile that the parallel home-screen
 * launcher session is wiring up. Keeping this exported as a constant so
 * both screens agree on the spelling.
 */
export const SIDELINE_IMPORT_ROUTE_NAME = 'import-sideline-hd';
