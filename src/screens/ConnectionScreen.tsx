// ── ConnectionScreen ──────────────────────────────────────────────────────
//
// Generic WebView host for "log in to a third-party site and view your
// data inside VBPlus". Used by:
//   - OVA MRS (mrs.ontariovolleyball.org)
//   - CAC Locker (thelocker.coach.ca)
//
// We can't embed an OAuth flow yet — neither service exposes a partner API.
// So Phase 4 takes the pragmatic route the user asked for: open the live
// site in a WebView, let them log in with their own credentials, then
// surface their authenticated profile page in-app. We detect the login
// transition by watching the URL — when it leaves the `/Login` /
// `/Account/Login` path, the session is established. We don't store
// credentials, scrape HTML, or extract data ourselves; that lands when
// the OAuth APIs become available.
//
// `connected: boolean` reflects whether the user has previously completed
// a login on this service in this app install. Disconnect flips it back
// to false. Cookies persist in the WebView between launches (RN default),
// so a previously-connected user stays signed in until they explicitly
// disconnect or the service expires their session.
// ────────────────────────────────────────────────────────────────────────────

import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview';
import { colors, spacing, fontSize, borderRadius } from '../utils/theme';

export interface ConnectionConfig {
  /** Display label (e.g. "OVA MRS", "CAC Locker"). */
  serviceName: string;
  /** Where to land the WebView. Login page if not yet authenticated. */
  loginUrl: string;
  /**
   * RegExp tested against the URL after each navigation. When the URL
   * stops matching this pattern, we treat the session as authenticated
   * and call `onConnect`. Examples:
   *   /\/Account\/Login/i      — true while on the login page
   *   /\/Login(\?|$)/i         — same idea, more permissive
   */
  loginUrlPattern: RegExp;
}

interface Props {
  config: ConnectionConfig;
  /** Whether the user has previously completed a login. */
  connected: boolean;
  /** Called once we detect a successful login (URL leaves the login page). */
  onConnect: () => void;
  /** Called when the user taps Disconnect. */
  onDisconnect: () => void;
  onBack: () => void;
}

export function ConnectionScreen({
  config,
  connected,
  onConnect,
  onDisconnect,
  onBack,
}: Props) {
  // The WebView lives for the lifetime of the screen; we re-key it via
  // `webviewKey` on Disconnect so it reloads to the login URL with a
  // fresh navigation stack.
  const [webviewKey, setWebviewKey] = useState(0);
  const [loading, setLoading] = useState(false);
  // Track whether we've already fired onConnect this session so the URL
  // listener doesn't fire it on every subsequent post-login navigation.
  const firedConnectRef = useRef<boolean>(connected);

  const handleNavigationStateChange = (event: WebViewNavigation) => {
    const url = event.url || '';
    const onLoginPage = config.loginUrlPattern.test(url);
    if (!onLoginPage && !firedConnectRef.current) {
      firedConnectRef.current = true;
      onConnect();
    }
    // We intentionally don't re-fire onConnect if the URL goes back to
    // login mid-session — that just means the user clicked "Sign out" or
    // the session expired. Disconnect handles the explicit case.
  };

  const handleDisconnect = () => {
    Alert.alert(
      `Disconnect ${config.serviceName}?`,
      'Your VBPlus connection flag will be cleared. To fully sign out, also tap the service\'s own Sign Out before disconnecting.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            firedConnectRef.current = false;
            onDisconnect();
            // Force the WebView back to the login URL.
            setWebviewKey((k) => k + 1);
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.heroBack}>{'< Back'}</Text>
        </TouchableOpacity>
        <View style={styles.heroRow}>
          <Text style={styles.heroTitle} numberOfLines={1}>
            {config.serviceName}
          </Text>
          <View
            style={[
              styles.statusChip,
              connected ? styles.statusChipOn : styles.statusChipOff,
            ]}
          >
            <Text
              style={[
                styles.statusChipText,
                connected ? styles.statusChipTextOn : styles.statusChipTextOff,
              ]}
            >
              {connected ? 'Connected' : 'Not connected'}
            </Text>
          </View>
        </View>
        <Text style={styles.heroSubtitle}>
          {connected
            ? 'Browse your account inside VBPlus.'
            : `Sign in with your ${config.serviceName} credentials below.`}
        </Text>
      </View>

      <View style={styles.webContainer}>
        <WebView
          key={webviewKey}
          source={{ uri: config.loginUrl }}
          onNavigationStateChange={handleNavigationStateChange}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          // Persist cookies so a logged-in session survives between launches.
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          // Most modern auth pages need JS.
          javaScriptEnabled
          domStorageEnabled
          // Mobile UA so the service serves its mobile-friendly layout.
          // Some services have separate mobile login routes; if either
          // service breaks here we can switch back to the default UA.
          // userAgent={... left to platform default ...}
          startInLoadingState
        />
        {loading ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : null}
      </View>

      {connected ? (
        <View style={styles.footer}>
          <TouchableOpacity
            onPress={handleDisconnect}
            style={styles.disconnectBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.disconnectBtnText}>
              Disconnect {config.serviceName}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

// ── Static configs ────────────────────────────────────────────────────────
//
// Exported so App.tsx can pass the right one without rebuilding it inline.

export const MRS_CONFIG: ConnectionConfig = {
  serviceName: 'OVA MRS',
  loginUrl: 'https://mrs.ontariovolleyball.org/Account/Login',
  loginUrlPattern: /\/Account\/Login/i,
};

export const CAC_LOCKER_CONFIG: ConnectionConfig = {
  serviceName: 'CAC Locker',
  loginUrl: 'https://thelocker.coach.ca/account/login',
  loginUrlPattern: /\/account\/login/i,
};

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
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
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  heroTitle: {
    color: colors.textOnPrimary,
    fontSize: fontSize.xxl,
    fontWeight: '800',
    flex: 1,
  },
  heroSubtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: fontSize.md,
    marginTop: 4,
  },
  statusChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  statusChipOn: { backgroundColor: 'rgba(255,255,255,0.85)' },
  statusChipOff: { backgroundColor: 'rgba(0,0,0,0.25)' },
  statusChipText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  statusChipTextOn: { color: colors.primary },
  statusChipTextOff: { color: '#ffffff' },

  webContainer: { flex: 1, position: 'relative' },
  loadingOverlay: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.85)',
    padding: 8,
    borderRadius: borderRadius.sm,
  },

  footer: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  disconnectBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.error,
    alignItems: 'center',
  },
  disconnectBtnText: {
    color: colors.error,
    fontWeight: '700',
    fontSize: fontSize.sm,
  },
});
