// ── ErrorBoundary ─────────────────────────────────────────────────────────
//
// Root-level React error boundary. Wraps the entire <App> render so a
// thrown error during render or in a child component's lifecycle
// surfaces a recovery screen instead of crashing JS and leaving the
// user staring at a white screen (Android) or a frozen splash (iOS).
//
// Why bother:
//   1) Required for a credible store launch. Without this, a single
//      render-time bug anywhere in the tree bricks the app until the
//      next force-close + reopen.
//   2) Pairs with Sentry — when Sentry lands in Phase 4, the
//      `componentDidCatch` callback hands the error + componentStack
//      to `Sentry.captureException`, giving us production crash
//      visibility on JS errors that wouldn't otherwise reach the
//      native crash channel.
//
// Limitations:
//   - Doesn't catch errors in event handlers (use try/catch there).
//   - Doesn't catch async errors thrown after the initial render.
//   - Doesn't catch errors in the boundary itself.
//
// Usage:
//   <ErrorBoundary>
//     <App />
//   </ErrorBoundary>
// ────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking } from 'react-native';

interface Props {
  children: React.ReactNode;
  /** Optional callback fired when an error is caught — wire up to
   *  Sentry in Phase 4. */
  onError?: (error: Error, componentStack: string) => void;
}

interface State {
  error: Error | null;
  /** Component stack from React's error info. Useful for debugging
   *  and for Sentry breadcrumbs. */
  componentStack: string | null;
  /** Number of resets attempted in this session — used to avoid an
   *  infinite reset loop if the recovery itself triggers the same
   *  error on next render. After 3 attempts we lock the recovery UI. */
  resetCount: number;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = {
    error: null,
    componentStack: null,
    resetCount: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const componentStack = info.componentStack ?? '';
    this.setState({ componentStack });

    // Forward to Sentry (or any other reporter) via the optional
    // callback. Keeping this generic so the boundary doesn't have a
    // direct Sentry dep — Sentry plumbing lives one level up.
    this.props.onError?.(error, componentStack);

    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary] caught:', error, componentStack);
    }
  }

  handleReset = () => {
    this.setState((s) => ({
      error: null,
      componentStack: null,
      resetCount: s.resetCount + 1,
    }));
  };

  render() {
    if (!this.state.error) return this.props.children;

    const lockedOut = this.state.resetCount >= 3;
    const errorMessage = this.state.error.message || 'Unknown error';

    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.emoji}>{'⚠️'}</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            The app hit an unexpected error. Tapping Reset will reload the
            current screen — your data is safe.
          </Text>

          {lockedOut ? (
            <Text style={styles.warningBody}>
              The same error has come back three times. Force-closing the app
              and reopening it will reset state more thoroughly.
            </Text>
          ) : null}

          {/* Dev/internal builds get the error message inline so we can
              act on it without attaching a debugger. Production builds
              hide it because the message can leak internal details. */}
          {__DEV__ ? (
            <View style={styles.devBlock}>
              <Text style={styles.devHeading}>Error (dev only)</Text>
              <Text style={styles.devMessage} selectable>
                {errorMessage}
              </Text>
              {this.state.componentStack ? (
                <Text style={styles.devStack} selectable>
                  {this.state.componentStack.split('\n').slice(0, 12).join('\n')}
                </Text>
              ) : null}
            </View>
          ) : null}

          <TouchableOpacity
            onPress={this.handleReset}
            disabled={lockedOut}
            style={[styles.button, lockedOut && styles.buttonDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Reset and continue"
          >
            <Text style={styles.buttonText}>
              {lockedOut ? 'Force-close and reopen' : 'Reset and continue'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() =>
              Linking.openURL(
                `mailto:jontycollis@gmail.com?subject=Bior%20error&body=${encodeURIComponent(
                  errorMessage
                )}`
              )
            }
            style={styles.secondaryButton}
            accessibilityRole="link"
            accessibilityLabel="Report this error"
          >
            <Text style={styles.secondaryButtonText}>Report this error</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }
}

// ── Styles ────────────────────────────────────────────────────────────────
//
// Self-contained styling — the boundary catches errors that may have
// originated in the theme provider, so we can't depend on useTheme().
// Hard-coded palette matches the light-mode Bior defaults.

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  emoji: {
    fontSize: 56,
    textAlign: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1a1a1a',
    textAlign: 'center',
    marginTop: 8,
  },
  body: {
    fontSize: 15,
    color: '#444',
    textAlign: 'center',
    lineHeight: 22,
  },
  warningBody: {
    fontSize: 14,
    color: '#b54708',
    textAlign: 'center',
    lineHeight: 20,
    backgroundColor: '#fff8eb',
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
    padding: 12,
    borderRadius: 6,
  },
  devBlock: {
    marginTop: 8,
    padding: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    gap: 6,
  },
  devHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
    letterSpacing: 0.5,
  },
  devMessage: {
    fontSize: 13,
    fontFamily: 'Courier',
    color: '#c00',
  },
  devStack: {
    fontSize: 11,
    fontFamily: 'Courier',
    color: '#666',
    marginTop: 4,
  },
  button: {
    backgroundColor: '#1a73e8',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#1a73e8',
    fontSize: 14,
    fontWeight: '600',
  },
});
