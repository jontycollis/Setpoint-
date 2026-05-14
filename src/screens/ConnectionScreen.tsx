// ── ConnectionScreen ──────────────────────────────────────────────────────
//
// Generic WebView host for "log in to a third-party site and view your
// data inside Setpoint". Used by:
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

import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  BackHandler,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview';
// Error event types aren't re-exported from the top-level package, so
// pull them from the deep type module. They're plain
// `NativeSyntheticEvent<...>` aliases — no runtime cost.
import type {
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
} from 'react-native-webview/lib/WebViewTypes';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';

export interface ConnectionChip {
  /** Visible label on the chip. */
  label: string;
  /** Absolute URL the WebView navigates to when the chip is tapped. */
  url: string;
}

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
  /**
   * Optional CSS injected into every page after load. Used to make the
   * service's desktop layout legible on phones (larger inputs, larger
   * fonts, mobile-friendly viewport). Harmless on post-login pages —
   * just makes them more readable too.
   */
  injectedCss?: string;
  /**
   * Shortcut chips shown above the WebView when the user is logged in.
   * Each tap navigates the embedded site to a specific URL the user is
   * likely to want, instead of forcing them to find the link inside
   * the desktop-style nav. URLs are best-effort guesses — adjust per
   * service after testing.
   */
  chips?: ConnectionChip[];
  /**
   * Pattern: when navigation lands on a URL matching this RegExp, we
   * treat that URL as the user's "primary destination" for this service
   * and persist it. Subsequent logins auto-navigate there instead of
   * sitting on whatever default landing page the service chose. Useful
   * for per-user URLs like CAC Locker's /account/detail/{id}.
   */
  captureUrlPattern?: RegExp;
  /**
   * AsyncStorage key under which the captured URL is persisted. Only
   * meaningful when `captureUrlPattern` is set.
   */
  captureStorageKey?: string;
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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  // The WebView lives for the lifetime of the screen; we re-key it via
  // `webviewKey` on Disconnect so it reloads to the login URL with a
  // fresh navigation stack.
  const [webviewKey, setWebviewKey] = useState(0);
  const [loading, setLoading] = useState(false);
  // Track whether we've already fired onConnect this session so the URL
  // listener doesn't fire it on every subsequent post-login navigation.
  const firedConnectRef = useRef<boolean>(connected);
  // WebView ref so chip taps and post-login auto-redirect can drive
  // navigation via injectJavaScript.
  const webViewRef = useRef<WebView>(null);
  // Captured "primary destination" URL for services that have one
  // (e.g. CAC Locker's /account/detail/{coachId}). Loaded from
  // AsyncStorage on mount; refreshed when the user navigates to a URL
  // matching `config.captureUrlPattern`. Auto-redirect after login
  // jumps to this URL instead of sitting on the default dashboard.
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const autoRedirectedRef = useRef(false);

  // ── In-WebView navigation state ────────────────────────────────────
  // We mirror the WebView's own can-go-back / can-go-forward / current
  // URL so the in-app toolbar (and the smart hero Back) can drive the
  // session like a tiny embedded browser. Without this, every chip 404
  // is a dead end — there's no way to recover except disconnecting.
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [currentUrl, setCurrentUrl] = useState<string>(config.loginUrl);
  // Last load error — surfaces as a dismissible banner. Cleared on the
  // next successful navigation.
  const [lastError, setLastError] = useState<string | null>(null);

  // Load any persisted captured URL on mount so the very next login
  // can redirect there immediately.
  useEffect(() => {
    if (!config.captureStorageKey) return;
    AsyncStorage.getItem(config.captureStorageKey)
      .then((u) => {
        if (u) setCapturedUrl(u);
      })
      .catch(() => {});
  }, [config.captureStorageKey]);

  const handleNavigationStateChange = (event: WebViewNavigation) => {
    const url = event.url || '';
    // Mirror nav state into React so the toolbar buttons reflect what's
    // actually reachable from this point in the WebView's history.
    setCanGoBack(!!event.canGoBack);
    setCanGoForward(!!event.canGoForward);
    setCurrentUrl(url);
    // Any successful navigation supersedes the last error banner.
    if (lastError) setLastError(null);
    const onLoginPage = config.loginUrlPattern.test(url);
    if (!onLoginPage && !firedConnectRef.current) {
      firedConnectRef.current = true;
      onConnect();
    }
    // We intentionally don't re-fire onConnect if the URL goes back to
    // login mid-session — that just means the user clicked "Sign out" or
    // the session expired. Disconnect handles the explicit case.

    // If this navigation lands on a URL we've been told to remember
    // (e.g. CAC Locker's /account/detail/{coachId}), persist it so the
    // next session can auto-redirect.
    if (
      !onLoginPage &&
      config.captureUrlPattern &&
      config.captureStorageKey &&
      config.captureUrlPattern.test(url) &&
      url !== capturedUrl
    ) {
      setCapturedUrl(url);
      AsyncStorage.setItem(config.captureStorageKey, url).catch(() => {});
    }

    // First post-login navigation: if we have a captured URL and we're
    // not already there, redirect once to land on the user's primary
    // destination instead of the default dashboard. The ref guard
    // prevents the redirect from re-firing every subsequent navigation.
    if (
      !onLoginPage &&
      capturedUrl &&
      !autoRedirectedRef.current &&
      !sameUrl(url, capturedUrl)
    ) {
      autoRedirectedRef.current = true;
      // Brief delay so the page has a chance to settle before we send
      // the user away — otherwise some sites lose the session cookie.
      setTimeout(() => {
        webViewRef.current?.injectJavaScript(
          `window.location.replace(${JSON.stringify(capturedUrl)}); true;`
        );
      }, 250);
    }
  };

  const navigateTo = (url: string) => {
    webViewRef.current?.injectJavaScript(
      `window.location.href = ${JSON.stringify(url)}; true;`
    );
  };

  // ── In-WebView nav: back / forward / reload / home ────────────────
  // `home` lands the user on the most useful URL we know about:
  //   - capturedUrl (e.g. CAC Locker's /account/detail/{id}) when we've
  //     seen the user navigate to it
  //   - the loginUrl otherwise (which, post-login, redirects to whatever
  //     the service's default dashboard is)
  const goWebViewBack = useCallback(() => {
    webViewRef.current?.goBack();
  }, []);
  const goWebViewForward = useCallback(() => {
    webViewRef.current?.goForward();
  }, []);
  const reloadWebView = useCallback(() => {
    setLastError(null);
    webViewRef.current?.reload();
  }, []);
  const goHome = useCallback(() => {
    setLastError(null);
    navigateTo(capturedUrl || config.loginUrl);
  }, [capturedUrl, config.loginUrl]);

  // Smart hero-back + hardware-back: if there's somewhere to go in the
  // WebView, go there first; only exit the screen when we're at the
  // root of the WebView's history. Matches what users expect from a
  // browser-like surface.
  const handleSmartBack = useCallback(() => {
    if (canGoBack) {
      goWebViewBack();
      return true;
    }
    onBack();
    return true;
  }, [canGoBack, goWebViewBack, onBack]);

  // Android hardware back. Registers after the global App.tsx handler
  // so RN's reverse-order dispatch lets us intercept first. We return
  // true when we handle it (back-inside-WebView), false to let the
  // global handler exit the screen.
  useEffect(() => {
    const onHardware = () => {
      if (canGoBack) {
        goWebViewBack();
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onHardware);
    return () => sub.remove();
  }, [canGoBack, goWebViewBack]);

  const handleDisconnect = () => {
    Alert.alert(
      `Disconnect ${config.serviceName}?`,
      'Your Setpoint connection flag will be cleared. To fully sign out, also tap the service\'s own Sign Out before disconnecting.',
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
          onPress={handleSmartBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.heroBack}>
            {canGoBack ? '< Back' : '< Exit'}
          </Text>
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
            ? 'Browse your account inside Setpoint.'
            : `Sign in with your ${config.serviceName} credentials below.`}
        </Text>
      </View>

      {/* In-WebView nav toolbar. Always shown so users can recover from
          any state — including 404s on chip URLs that haven't been
          verified against the live site. Disabled buttons grey out
          when they aren't applicable (e.g. forward when at history
          head). */}
      <View style={styles.toolbar}>
        <ToolbarBtn
          label="‹"
          accessibilityLabel="Back"
          disabled={!canGoBack}
          onPress={goWebViewBack}
          styles={styles}
        />
        <ToolbarBtn
          label="›"
          accessibilityLabel="Forward"
          disabled={!canGoForward}
          onPress={goWebViewForward}
          styles={styles}
        />
        <ToolbarBtn
          label="↻"
          accessibilityLabel="Reload"
          onPress={reloadWebView}
          styles={styles}
        />
        <ToolbarBtn
          label="🏠"
          accessibilityLabel="Home"
          onPress={goHome}
          styles={styles}
        />
        <Text style={styles.toolbarUrl} numberOfLines={1}>
          {prettifyUrl(currentUrl)}
        </Text>
      </View>

      {connected && config.chips && config.chips.length > 0 && (
        <View style={styles.chipsBar}>
          <View style={styles.chipsBarInner}>
            {capturedUrl ? (
              <TouchableOpacity
                style={[styles.chip, styles.chipPrimary]}
                onPress={() => navigateTo(capturedUrl)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, styles.chipTextPrimary]}>
                  ↺ My Profile
                </Text>
              </TouchableOpacity>
            ) : null}
            {config.chips.map((c) => (
              <TouchableOpacity
                key={c.url}
                style={styles.chip}
                onPress={() => navigateTo(c.url)}
                activeOpacity={0.7}
              >
                <Text style={styles.chipText}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Last-load error banner — dismissible, non-blocking. Shows up
          when a chip URL 404s or a network call fails. The toolbar
          back/home buttons handle the recovery itself; this just tells
          the user something went wrong so they aren't staring at a
          blank or unfamiliar page wondering whether the tap worked. */}
      {lastError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText} numberOfLines={2}>
            {lastError}
          </Text>
          <TouchableOpacity
            onPress={() => setLastError(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.errorBannerDismiss}>{'✕'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.webContainer}>
        <WebView
          ref={webViewRef}
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
          // Make sure pinch-zoom and built-in scaling work for the
          // legacy desktop pages MRS / CAC Locker still serve.
          scalesPageToFit
          setBuiltInZoomControls
          // Inject a mobile-friendly viewport + readability CSS after
          // every page load. We do this rather than wrapping the page
          // because both services render the form via server templates
          // we can't easily restyle from the host side.
          injectedJavaScript={buildInjectedScript(
            config.loginUrlPattern.source,
            config.loginUrlPattern.flags,
            config.injectedCss
          )}
          // Surface load failures (404s on chip URLs, network errors,
          // certificate failures) in dev so we can fix bad chip routes
          // without the user having to flag each one. Best-effort logs;
          // shipped builds stay quiet.
          onError={(e: WebViewErrorEvent) => {
            const desc = e.nativeEvent.description || 'Network error';
            setLastError(`Couldn't load this page (${desc}). Tap ↻ to retry or 🏠 to go home.`);
            if (__DEV__) {
              // eslint-disable-next-line no-console
              console.warn(
                `[${config.serviceName}] WebView load FAILED:`,
                e.nativeEvent.url,
                'code',
                e.nativeEvent.code,
                'desc',
                e.nativeEvent.description
              );
            }
          }}
          onHttpError={(e: WebViewHttpErrorEvent) => {
            const status = e.nativeEvent.statusCode;
            // Most chip-URL 404s land here. The site's own 404 page still
            // renders, but we surface a banner so the user knows the link
            // is broken and can recover via the toolbar.
            if (status >= 400) {
              setLastError(
                status === 404
                  ? `That link isn't valid for ${config.serviceName} (404). Try ← back or 🏠 home.`
                  : `Server returned ${status}. Try ↻ reload or 🏠 home.`
              );
            }
            if (__DEV__) {
              // eslint-disable-next-line no-console
              console.warn(
                `[${config.serviceName}] WebView HTTP error:`,
                e.nativeEvent.url,
                'status',
                e.nativeEvent.statusCode
              );
            }
          }}
        />
        {loading ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : null}
      </View>

      {connected ? (
        <View
          style={[
            styles.footer,
            // Bottom safe-area inset clears the Android gesture-nav
            // indicators so the destructive button stays tappable.
            { paddingBottom: spacing.md + Math.max(insets.bottom, 0) },
          ]}
        >
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

// ── Injected readability script ───────────────────────────────────────────
//
// Both MRS and CAC Locker still serve a desktop-only login layout — tiny
// inputs, no viewport meta, narrow form panel. We patch this from the
// WebView host by injecting a viewport tag and a stylesheet that pushes
// every input to ~48px tall and 18px font, plus widens the form panel
// to use the available screen width on phones.
//
// The script returns `true;` so React Native treats the injection as
// successful (without that, RN warns).
// ────────────────────────────────────────────────────────────────────────────

// ── Minimal CSS (every page) ──────────────────────────────────────────────
// Conservative styling that won't break the service's own layout. We do
// just enough to make tap targets phone-friendly and to silence the
// most universally-annoying noise (cookie banners, ad slots). No
// container resets, no body padding overrides, no `form` selector —
// those broke post-login dashboards (MRS uses Bootstrap, so `.row`,
// `.col`, `.panel.panel-default` are load-bearing on its dashboards).
const MINIMAL_CSS = `
  html { -webkit-text-size-adjust: 100% !important; }

  /* Silence universally-annoying noise. Site-specific chrome (header,
     nav, footer) is NOT hidden here — that breaks the post-login
     dashboards. Login pages get those hidden via LOGIN_ONLY_CSS. */
  .cookie-notice, #cookieNotice, .cookie-banner,
  .ad, .ads, .advertisement,
  iframe[src*="googletag"], iframe[src*="doubleclick"] {
    display: none !important;
  }

  /* Touch-friendly inputs/buttons without forcing width or layout. */
  input[type="text"], input[type="email"], input[type="password"],
  input[type="tel"], input[type="number"], input[type="search"],
  select, textarea {
    min-height: 44px !important;
    font-size: 16px !important;
    box-sizing: border-box !important;
  }
  input[type="submit"], button, .btn {
    min-height: 44px !important;
    font-size: 16px !important;
    cursor: pointer !important;
  }
  input:focus, select:focus, textarea:focus {
    outline: 2px solid #1a73e8 !important;
    outline-offset: 1px !important;
  }

  /* Validation summary stays readable on a phone screen. */
  .validation-summary-errors, .alert-danger, .text-danger {
    background: #fff3ee !important;
    border-left: 4px solid #ff6b35 !important;
    color: #1a1a1a !important;
    padding: 12px !important;
    border-radius: 8px !important;
    margin: 12px 0 !important;
  }
`;

// ── Login-only CSS ────────────────────────────────────────────────────────
// Applied only when the URL matches the service's login pattern. Heavy-
// handed because the login pages are simple forms we can confidently
// restyle — no risk of nuking a dashboard's layout. Selectors include
// the form-card treatment, wrapper reset, and chrome hiding that used
// to live in the universal CSS.
const LOGIN_ONLY_CSS = `
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #f5f5f5 !important;
  }
  body {
    font-size: 17px !important;
    line-height: 1.5 !important;
    padding: 24px 16px !important;
    box-sizing: border-box !important;
    min-height: 100vh !important;
  }

  /* Hide layout chrome on the login page itself — it's just noise
     when the goal is "sign in and move on". These selectors stay
     scoped to login pages only. */
  header, footer, nav, aside,
  .navbar, .navbar-default, .navbar-fixed-top, .navbar-header,
  .site-header, .site-footer, .header, .footer,
  .top-bar, .topbar, .top-banner, .promo, .promo-banner,
  .breadcrumb, .breadcrumbs,
  .sidebar, .left-sidebar, .right-sidebar,
  .skip-link, .skiplinks {
    display: none !important;
  }

  /* Centered form card. Narrowly targeted — the bare 'form' selector
     caught too much; here we require a login-shaped class/id. */
  .login-form, .login-panel, .login-container,
  #loginForm, .auth-form, .signin-form,
  form[action*="Login" i], form[action*="signin" i], form[action*="account" i] {
    background: #ffffff !important;
    border: 1px solid #e0e0e0 !important;
    border-radius: 14px !important;
    padding: 24px !important;
    margin: 24px auto !important;
    max-width: 480px !important;
    width: 100% !important;
    box-sizing: border-box !important;
    box-shadow: 0 2px 12px rgba(0,0,0,0.06) !important;
  }

  /* On login pages only, reset wrapping containers so our card sits
     in clean whitespace instead of nested grey panels. */
  main, .main, .container, .container-fluid, .content, #content,
  .row, .col, [class^="col-"], .wrap, .wrapper {
    background: transparent !important;
    border: 0 !important;
    box-shadow: none !important;
    padding: 0 !important;
    margin: 0 !important;
    max-width: 100% !important;
  }

  h1, h2, h3, .panel-title, .login-title, .auth-title {
    font-size: 22px !important;
    line-height: 1.3 !important;
    margin: 0 0 16px 0 !important;
    color: #1a1a1a !important;
    font-weight: 700 !important;
  }

  /* Inputs get the full-width card treatment on the login page. */
  input[type="text"], input[type="email"], input[type="password"],
  input[type="tel"], select, textarea, .form-control {
    width: 100% !important;
    max-width: 100% !important;
    padding: 12px 14px !important;
    border-radius: 10px !important;
    border: 1px solid #c0c0c0 !important;
    background: #ffffff !important;
    color: #1a1a1a !important;
  }

  /* Login-page buttons go full-width too. */
  input[type="submit"], button[type="submit"], .btn-primary {
    width: 100% !important;
    background: #1a73e8 !important;
    color: #ffffff !important;
    border: 0 !important;
    border-radius: 10px !important;
    padding: 12px 16px !important;
    margin-top: 8px !important;
    font-weight: 700 !important;
  }

  label, .control-label, .form-label {
    font-size: 14px !important;
    font-weight: 600 !important;
    display: block !important;
    margin: 14px 0 6px 0 !important;
    color: #444 !important;
  }
  .form-group, .field, .form-field { margin-bottom: 14px !important; }

  a { color: #1a73e8 !important; }

  input[type="checkbox"], input[type="radio"] {
    width: auto !important;
    min-height: 0 !important;
    margin-right: 8px !important;
    transform: scale(1.2) !important;
  }
  .checkbox, .radio {
    display: flex !important;
    align-items: center !important;
    margin: 12px 0 !important;
  }
`;

// Build the injected JS. `loginUrlPatternSrc` lets us apply LOGIN_ONLY_CSS
// only when the current page is the login page; on every other URL the
// site gets to render natively (plus MINIMAL_CSS + any service-specific
// extras). The script re-evaluates on each navigation since RN re-runs
// `injectedJavaScript` after every page load.
function buildInjectedScript(
  loginUrlPatternSrc: string,
  loginUrlPatternFlags: string,
  extraCss?: string
): string {
  return `
    (function() {
      try {
        var existing = document.querySelector('meta[name="viewport"]');
        if (!existing) {
          var m = document.createElement('meta');
          m.name = 'viewport';
          m.content = 'width=device-width, initial-scale=1, maximum-scale=5';
          document.head.appendChild(m);
        } else {
          existing.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=5');
        }

        // Inject MINIMAL_CSS once (idempotent).
        if (!document.getElementById('__vbplus_minimal_css__')) {
          var s1 = document.createElement('style');
          s1.id = '__vbplus_minimal_css__';
          s1.textContent = ${JSON.stringify(MINIMAL_CSS)};
          document.head.appendChild(s1);
        }

        // Service-specific extras (always on). These have already been
        // tuned per-service to avoid the dashboard-breaking selectors.
        var extraCss = ${JSON.stringify(extraCss || '')};
        if (extraCss && !document.getElementById('__vbplus_extra_css__')) {
          var s2 = document.createElement('style');
          s2.id = '__vbplus_extra_css__';
          s2.textContent = extraCss;
          document.head.appendChild(s2);
        }

        // LOGIN_ONLY_CSS: gate by URL. Add when on login, remove when
        // we've navigated away (so post-login dashboards aren't
        // wrecked by the form-card and container-reset rules).
        var isLoginPage = new RegExp(
          ${JSON.stringify(loginUrlPatternSrc)},
          ${JSON.stringify(loginUrlPatternFlags)}
        ).test(location.href);
        var loginStyle = document.getElementById('__vbplus_login_css__');
        if (isLoginPage && !loginStyle) {
          var s3 = document.createElement('style');
          s3.id = '__vbplus_login_css__';
          s3.textContent = ${JSON.stringify(LOGIN_ONLY_CSS)};
          document.head.appendChild(s3);
        } else if (!isLoginPage && loginStyle) {
          loginStyle.parentNode && loginStyle.parentNode.removeChild(loginStyle);
        }
      } catch (e) {}
      true;
    })();
    true;
  `;
}

// ── URL helpers ───────────────────────────────────────────────────────────

// Compress a URL into something readable in the slim toolbar. We drop
// the protocol, surface just the host + path tail, and cap the total
// length so it never wraps onto a second line.
function prettifyUrl(url: string): string {
  if (!url) return '';
  let s = url.replace(/^https?:\/\//i, '');
  s = s.replace(/#.*$/, '').replace(/\?.*$/, '');
  if (s.length > 38) s = s.slice(0, 18) + '…' + s.slice(-18);
  return s;
}

// Small toolbar button — matches the surrounding chrome and dims when
// the action isn't currently available (e.g. forward when there's
// nothing forward to go to).
function ToolbarBtn({
  label,
  accessibilityLabel,
  disabled,
  onPress,
  styles,
}: {
  label: string;
  accessibilityLabel: string;
  disabled?: boolean;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityLabel={accessibilityLabel}
      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
      style={[styles.toolbarBtn, disabled && styles.toolbarBtnDisabled]}
    >
      <Text
        style={[
          styles.toolbarBtnText,
          disabled && styles.toolbarBtnTextDisabled,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// Loose URL comparator — strips the trailing slash and any anchor so
// `https://x/y` and `https://x/y/#tab=foo` are treated as the same page.
function sameUrl(a: string, b: string): boolean {
  const norm = (s: string) =>
    (s || '').replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase();
  return norm(a) === norm(b);
}

// ── Static configs ────────────────────────────────────────────────────────
//
// Exported so App.tsx can pass the right one without rebuilding it inline.

export const MRS_CONFIG: ConnectionConfig = {
  serviceName: 'OVA MRS',
  loginUrl: 'https://mrs.ontariovolleyball.org/Account/Login',
  loginUrlPattern: /\/Account\/Login/i,
  // The generic READABILITY_CSS already turns ASP.NET MVC markup into a
  // clean card. This slot is reserved for MRS-specific tweaks we
  // discover after testing on the actual page.
  // Best-effort shortcut chips. URLs are guesses based on common
  // ASP.NET MVC routing conventions — tell us which ones 404 and we'll
  // swap in the real routes.
  chips: [
    { label: 'My Profile', url: 'https://mrs.ontariovolleyball.org/Member/Profile' },
    { label: 'Affiliations', url: 'https://mrs.ontariovolleyball.org/Member/Affiliations' },
    { label: 'Memberships', url: 'https://mrs.ontariovolleyball.org/Member/Memberships' },
    { label: 'Events', url: 'https://mrs.ontariovolleyball.org/Member/Events' },
  ],
};

export const CAC_LOCKER_CONFIG: ConnectionConfig = {
  serviceName: 'CAC Locker',
  loginUrl: 'https://thelocker.coach.ca/account/login',
  loginUrlPattern: /\/account\/login/i,
  // CAC Locker-specific polish on top of READABILITY_CSS. The site uses
  // a custom .NET stack, not Bootstrap, so we add selectors that match
  // its actual class names. Defensive — selectors that don't exist
  // no-op silently.
  //
  // Strategy: don't force-card every wrapping container (that's what
  // produced the "empty white block" the user reported — empty
  // sub-containers were rendered as full-size cards). Style only the
  // small, content-bearing components — actual cards, alerts, tiles,
  // tables, and headings. Let the page's own layout handle the rest.
  injectedCss: `
    /* NOTE: we used to hide header/footer/nav universally here, but
       that left users stranded on Locker dashboards (their only
       navigation IS the site nav). The login page hides chrome via
       LOGIN_ONLY_CSS instead — post-login the site's own header/
       footer/nav render naturally. */

    /* Strip purely cosmetic noise (skip-nav links, promo banners) that
       have no navigation value. */
    .skip-nav, .skipNav, .accessibility-link, .alphabet-soup,
    .login-bar, .topBanner, .promoBanner {
      display: none !important;
    }

    /* Collapse empty containers so we don't get tall blank cards
       below "no certifications" / "no announcements" sections. Note
       :empty doesn't match whitespace, so this only catches truly
       empty children — a pure-whitespace empty parent will still
       render visibly. */
    .sfDataItem:empty,
    .card:empty, .panel:empty, .tile:empty,
    .dashboard-tile:empty, .cert-card:empty, .renewal-card:empty,
    section:empty, article:empty {
      display: none !important;
    }

    /* Headings — reset any background-image / absolute-positioned icon
       that CAC overlays on the heading text. The "small certificate
       icon rendering on top of the C" issue comes from a CSS rule
       that uses background-image + padding-left as an icon-on-text
       trick. We disable it here so the text stays readable, then any
       inline icon (img/svg/i/span) inside the heading gets proper
       horizontal spacing instead of overlapping. */
    h1, h2, h3, .pageTitle, .pageHeading, .sectionHeader {
      font-size: 22px !important;
      line-height: 1.3 !important;
      margin: 8px 0 16px 0 !important;
      color: #1a1a1a !important;
      background: none !important;
      background-image: none !important;
      padding-left: 0 !important;
      position: static !important;
    }
    h1::before, h2::before, h3::before,
    .pageTitle::before, .pageHeading::before, .sectionHeader::before {
      display: none !important;
      content: none !important;
    }
    h1 img, h2 img, h3 img,
    h1 svg, h2 svg, h3 svg,
    h1 i, h2 i, h3 i,
    h1 span.icon, h2 span.icon, h3 span.icon {
      width: auto !important;
      max-height: 1em !important;
      vertical-align: middle !important;
      display: inline-block !important;
      position: static !important;
      margin: 0 8px 0 0 !important;
    }

    /* Tables (cert lists, transcripts, history) */
    table, .sfTable, .data-table, .grid-table {
      width: 100% !important;
      border-collapse: collapse !important;
      font-size: 14px !important;
    }
    table th, table td, .sfTable th, .sfTable td {
      padding: 10px 8px !important;
      text-align: left !important;
      vertical-align: top !important;
    }
    table th, .sfTable th {
      background: #f0f4ff !important;
      color: #1a1a1a !important;
      font-weight: 700 !important;
      font-size: 13px !important;
    }
    table tr:nth-child(even) td {
      background: #fafafa !important;
    }

    /* Cert / dashboard tile cards (Sitefinity uses .sfDataItem; .NET MVC
       sites tend to use .card / .panel / .tile) */
    .sfDataItem, .card, .panel, .tile, .dashboard-tile,
    .cert-card, .renewal-card, .alert, .notification {
      background: #ffffff !important;
      border: 1px solid #e0e0e0 !important;
      border-radius: 12px !important;
      padding: 12px !important;
      margin-bottom: 10px !important;
    }

    /* Nav tabs sometimes used inside Locker pages — make them tap-able */
    .tab, .tabs a, .nav-tabs a, .pageTabs a, .accountTabs a {
      padding: 12px 14px !important;
      font-size: 15px !important;
      display: inline-block !important;
    }
  `,
  // CAC's coach detail URL is per-user (/account/detail/{coachId}). We
  // capture it the first time the user navigates to it, then auto-
  // redirect to it on subsequent logins so they land on their own
  // profile instead of the announcements dashboard.
  captureUrlPattern: /thelocker\.coach\.ca\/account\/detail\/\d+/i,
  captureStorageKey: 'connection.cac.coachDetailUrl',
  // Best-effort shortcut chips. URLs are guesses; correct any that 404.
  chips: [
    { label: 'My Certifications', url: 'https://thelocker.coach.ca/account/myCertifications' },
    { label: 'Transcript', url: 'https://thelocker.coach.ca/account/transcripts/personal/Index' },
    { label: 'Coach Info', url: 'https://thelocker.coach.ca/account/coachInfoSheet' },
    { label: 'Events', url: 'https://thelocker.coach.ca/account/myEvents' },
    { label: 'Renewals', url: 'https://thelocker.coach.ca/account/myRenewals' },
  ],
};

// ── Styles ────────────────────────────────────────────────────────────────

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

  // ── WebView nav toolbar ─────────────────────────────────────────────
  // Slim browser-style row: back / forward / reload / home + a
  // truncated URL display. Renders always so users can recover from
  // any state including chip-URL 404s.
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 2,
  },
  toolbarBtn: {
    minWidth: 36,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbarBtnDisabled: {
    opacity: 0.3,
  },
  toolbarBtnText: {
    color: colors.primary,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '700',
  },
  toolbarBtnTextDisabled: {
    color: colors.textLight,
  },
  toolbarUrl: {
    flex: 1,
    marginLeft: spacing.sm,
    color: colors.textSecondary,
    fontSize: fontSize.xs,
  },

  // ── Inline error banner ─────────────────────────────────────────────
  // Sits below the chips and above the WebView. Dismissible and
  // non-blocking so the user can still interact with the page below
  // (which on a 404 will be the site's own error page).
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warning ? `${colors.warning}22` : '#fff3ee',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.warning ?? '#f5a623',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  errorBannerText: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  errorBannerDismiss: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: '700',
  },

  // Shortcut chip strip shown above the WebView once the user is
  // logged in. Horizontally wraps so chips reflow on narrow screens.
  // Strip uses `colors.background` (light grey in light, near-black in
  // dark) and chips themselves use `colors.surface` (white in light,
  // dark grey in dark) so the chips visibly pop out from the strip in
  // both palettes.
  chipsBar: {
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  chipsBarInner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  chipTextPrimary: {
    color: colors.textOnPrimary,
  },
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
}
