// ── OfflineBanner ─────────────────────────────────────────────────────────
//
// Slim global banner that appears at the bottom of the screen (above
// the bottom-tab bar / native gesture nav indicator) when NetInfo
// reports the device offline. Bottom anchoring rather than top so it
// doesn't compete with the global TopBar / HamburgerMenu overlays.
//
// Wired in App.tsx as a global overlay so every screen benefits — no
// per-screen plumbing needed. Hidden entirely when online (returns
// null), so it adds zero visual weight in the common case.
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNetworkStatus } from '../utils/useNetworkStatus';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';

export function OfflineBanner() {
  const { online } = useNetworkStatus();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (online) return null;

  return (
    <View
      style={[styles.wrap, { bottom: insets.bottom + spacing.xl }]}
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLabel="You are offline. The app is using cached data."
    >
      <View style={styles.pill}>
        <Text style={styles.icon}>{'⚠️'}</Text>
        <Text style={styles.text}>You're offline — using cached data</Text>
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      alignItems: 'center',
      // High zIndex so the banner floats above scroll content but
      // not above modals / alerts (those use elevation: 200+).
      zIndex: 30,
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: 'rgba(40, 40, 40, 0.92)',
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: borderRadius.full,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    icon: { fontSize: 14 },
    text: {
      color: '#ffffff',
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
  });
}
