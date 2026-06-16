// ── MyTeam.Click connection screen ────────────────────────────────────────
//
// Hosts a WebView at https://myteam.click, watches for the post-login
// state, and extracts the JWT + player metadata from the SPA's
// Capacitor-backed localStorage so the rest of the app can call the
// MyTeam.Click REST API directly. Mirrors the SidelineHD connection
// pattern (see `SidelineImportScreen.tsx`) but is much simpler — the
// JWT lives in plain localStorage, not IndexedDB.
//
// Flow:
//   1. WebView loads https://myteam.click. If already logged in (cookie
//      jar persists), the SPA redirects to `/playereventlist` and our
//      injected probe immediately fires.
//   2. After every navigation, we inject a small probe that reads
//      `localStorage.CapacitorStorage.user`. If the blob contains a
//      token + _id, we post it back via `ReactNativeWebView.postMessage`
//      with kind 'mtc-user'.
//   3. The handler parses the blob, persists via `saveMyTeamClickSession`,
//      and bounces back to the parent screen via `onConnected`.
//
// Disconnect: clears the saved session and the WebView cookie jar so
// the next link prompts a fresh login.
// ──────────────────────────────────────────────────────────────────────────

import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import {
  clearMyTeamClickSession,
  loadMyTeamClickSession,
  parseCapturedUserBlob,
  saveMyTeamClickSession,
  type MyTeamClickSessionRecord,
} from '../utils/myteamClickSession';

const MYTEAM_CLICK_URL = 'https://myteam.click/';

// Injected after every navigation. Reads CapacitorStorage.user and
// posts the raw blob to the parent. Idempotent — when localStorage
// doesn't have the entry yet, posts a null marker so the host knows the
// probe ran without losing track.
const PROBE_JS = `
(function() {
  try {
    var raw = localStorage.getItem('CapacitorStorage.user');
    window.ReactNativeWebView.postMessage(JSON.stringify({
      kind: 'mtc-user',
      raw: raw || null,
    }));
  } catch (err) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      kind: 'mtc-user',
      raw: null,
      reason: String(err && err.message ? err.message : err),
    }));
  }
  true;
})();
`;

interface Props {
  onBack: () => void;
  /** Called with the saved session record after a successful capture.
   *  The parent typically navigates away and persists the link
   *  state on its own user profile. */
  onConnected: (record: MyTeamClickSessionRecord) => void;
}

export function MyTeamClickConnectionScreen({ onBack, onConnected }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const webViewRef = useRef<WebView>(null);
  const [navUrl, setNavUrl] = useState<string>(MYTEAM_CLICK_URL);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [existing, setExisting] = useState<MyTeamClickSessionRecord | null>(
    null
  );

  // On mount, surface any existing link so the user sees "already
  // connected as X" instead of being prompted again.
  React.useEffect(() => {
    let cancelled = false;
    void loadMyTeamClickSession().then((r) => {
      if (!cancelled) setExisting(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleNavStateChange = useCallback((nav: WebViewNavigation) => {
    setNavUrl(nav.url);
    setLoading(nav.loading);
    // After every navigation, fire the probe. It's cheap; harmless
    // when the user is on the login page (just returns raw: null).
    if (!nav.loading) {
      setTimeout(() => {
        webViewRef.current?.injectJavaScript(PROBE_JS);
      }, 50);
    }
  }, []);

  const handleMessage = useCallback(
    async (event: { nativeEvent: { data: string } }) => {
      let payload: { kind: string; raw: string | null } | null = null;
      try {
        payload = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (!payload || payload.kind !== 'mtc-user' || !payload.raw) return;
      // Avoid double-capturing if the probe fires repeatedly.
      if (capturing) return;
      setCapturing(true);
      const record = parseCapturedUserBlob(payload.raw);
      if (!record) {
        setCapturing(false);
        return;
      }
      try {
        await saveMyTeamClickSession(record);
      } catch (err) {
        Alert.alert(
          'Save failed',
          err instanceof Error ? err.message : String(err)
        );
        setCapturing(false);
        return;
      }
      onConnected(record);
    },
    [capturing, onConnected]
  );

  const handleDisconnect = useCallback(() => {
    Alert.alert(
      'Disconnect MyTeam.Click?',
      'Your saved login will be removed. You can reconnect anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await clearMyTeamClickSession();
            setExisting(null);
            // Reload the WebView so the cookie jar reflects a clean
            // state for the next attempt.
            webViewRef.current?.reload();
          },
        },
      ]
    );
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backLabel}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>MyTeam.Click</Text>
        {existing ? (
          <TouchableOpacity
            onPress={handleDisconnect}
            style={styles.disconnectBtn}
          >
            <Text style={styles.disconnectLabel}>Disconnect</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.disconnectBtn} />
        )}
      </View>

      {existing ? (
        <View style={styles.statusBar}>
          <Text style={styles.statusText}>
            Connected as {existing.firstName} {existing.lastName}
          </Text>
        </View>
      ) : (
        <View style={styles.statusBar}>
          <Text style={styles.statusText}>
            Log in below to link your MyTeam.Click account.
          </Text>
        </View>
      )}

      <View style={styles.webViewWrap}>
        <WebView
          ref={webViewRef}
          source={{ uri: MYTEAM_CLICK_URL }}
          onNavigationStateChange={handleNavStateChange}
          onMessage={handleMessage}
          // Allow shared cookie store so the user stays logged in across
          // visits — same as SidelineHD pattern.
          sharedCookiesEnabled
          incognito={false}
          // Tell the SPA we're a normal browser UA — Capacitor sometimes
          // serves a different shell when it detects a WebView UA.
          userAgent="Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        />
        {loading ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText} numberOfLines={1}>
          {navUrl}
        </Text>
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    backBtn: {
      paddingVertical: spacing.xs,
    },
    backLabel: {
      fontSize: fontSize.sm,
      color: colors.primary,
      fontWeight: '600',
    },
    title: {
      fontSize: fontSize.md,
      fontWeight: '800',
      color: colors.text,
    },
    disconnectBtn: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      minWidth: 80,
      alignItems: 'flex-end',
    },
    disconnectLabel: {
      fontSize: fontSize.sm,
      color: '#c0392b',
      fontWeight: '700',
    },
    statusBar: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      backgroundColor: colors.surface,
    },
    statusText: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
    },
    webViewWrap: {
      flex: 1,
    },
    loadingOverlay: {
      position: 'absolute',
      top: spacing.sm,
      right: spacing.sm,
      padding: spacing.xs,
      backgroundColor: 'rgba(255,255,255,0.85)',
      borderRadius: borderRadius.sm,
    },
    footer: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      backgroundColor: colors.surface,
    },
    footerText: {
      fontSize: fontSize.xs,
      color: colors.textLight,
    },
  });
}
