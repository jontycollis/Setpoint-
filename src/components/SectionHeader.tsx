// ── SectionHeader ─────────────────────────────────────────────────────────
// Shared header for the launcher section landings (Scoreboard / My Team /
// Browse). Renders a back affordance + title; section screens drop their
// sub-tile grid underneath.
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, spacing, fontSize } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';

interface Props {
  title: string;
  subtitle?: string;
  onBack: () => void;
}

export function SectionHeader({ title, subtitle, onBack }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.xxxl }]}>
      <Pressable
        onPress={onBack}
        style={({ pressed }) => [
          styles.back,
          pressed && styles.backPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Back to home"
        hitSlop={8}
      >
        <Text style={styles.backText}>← Home</Text>
      </Pressable>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
    },
    back: {
      alignSelf: 'flex-start',
      paddingVertical: spacing.xs,
      marginBottom: spacing.sm,
    },
    backPressed: {
      opacity: 0.6,
    },
    backText: {
      color: colors.primary,
      fontSize: fontSize.md,
      fontWeight: '600',
    },
    title: {
      fontSize: fontSize.xxxl,
      fontWeight: '800',
      color: colors.text,
    },
    subtitle: {
      marginTop: spacing.xs,
      fontSize: fontSize.md,
      color: colors.textSecondary,
    },
  });
}
