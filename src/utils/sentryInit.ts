// ── Sentry initialization ─────────────────────────────────────────────────
//
// Wraps `@sentry/react-native` so the rest of the app can call
// `captureException` / `addBreadcrumb` without worrying about whether
// Sentry is initialized. If the DSN is empty (placeholder default,
// while we're still pre-launch) the init becomes a no-op and the
// re-exported `captureException` / `addBreadcrumb` quietly drop their
// arguments instead of crashing.
//
// One module per Sentry concern, so the App.tsx wiring is just one
// import + one call.
// ────────────────────────────────────────────────────────────────────────────

import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

/** Sentry project DSN. Public; safe to commit (write-only ingest key,
 *  not a secret). The Sentry auth token, which IS a secret, lives in
 *  `.env.local` (gitignored) for local development and as an EAS Build
 *  secret named SENTRY_AUTH_TOKEN for cloud builds — only used at
 *  build time for source-maps upload, never at runtime.
 *
 *  Sentry project: none-6v6/setpoint (US ingest). */
const SENTRY_DSN =
  'https://98a5036dacdf5bd0bffa09f9873d4e50@o4511395214393344.ingest.us.sentry.io/4511395230253056';

let _initialized = false;

/**
 * Initialize Sentry. Safe to call multiple times — subsequent calls
 * are no-ops. Call from the top of App.tsx before any render so
 * crashes during render are caught.
 */
export function initSentry(): void {
  if (_initialized) return;
  if (!SENTRY_DSN) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(
        '[sentry] DSN is empty — crash reporting disabled. Set SENTRY_DSN in src/utils/sentryInit.ts before submitting to the store.'
      );
    }
    _initialized = true;
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    // Explicit override of the (already-default) PII handling. PRIVACY.md
    // promises we don't collect IP / user data; the wizard's default
    // template tried to flip this to `true`, so we pin it false here to
    // make the privacy contract visible alongside the rest of the config.
    sendDefaultPii: false,
    // Wire dev / preview / production from the EAS channel so the
    // Sentry dashboard can separate noise from real users.
    environment: __DEV__ ? 'development' : 'production',
    // Light sample rates — these can be ratcheted up once we see
    // production traffic. 1.0 means "send everything" which is fine
    // for a launch but generates noise at scale.
    sampleRate: 1.0,
    tracesSampleRate: 0.0, // Performance tracing off; flip later if needed.
    // Tag releases with our app version + Android versionCode so we
    // can correlate a regression with the build that introduced it.
    release: `setpoint@${Constants.expoConfig?.version ?? 'unknown'}+${
      Constants.expoConfig?.android?.versionCode ?? '?'
    }`,
    // Strip noisy / personal data from outgoing events. The
    // beforeSend hook can also outright drop events here.
    beforeSend(event) {
      // Drop the user's IP — we don't need it and the privacy
      // policy promises we don't collect it.
      if (event.user) delete event.user.ip_address;
      return event;
    },
  });

  _initialized = true;
}

/**
 * Wrapper for ErrorBoundary's onError callback. Safe to call before
 * Sentry is initialized — drops the report if so.
 */
export function reportError(error: Error, componentStack?: string): void {
  if (!_initialized || !SENTRY_DSN) return;
  Sentry.captureException(error, {
    contexts: componentStack
      ? { react: { componentStack } }
      : undefined,
  });
}

/**
 * Re-export of Sentry.addBreadcrumb that's a no-op when Sentry isn't
 * initialized. Use this from navigation handlers etc. to leave a
 * trail of "what was the user doing right before the crash" markers.
 */
export function addBreadcrumb(message: string, category = 'app'): void {
  if (!_initialized || !SENTRY_DSN) return;
  Sentry.addBreadcrumb({ message, category, level: 'info' });
}
