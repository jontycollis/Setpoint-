// ── LauncherTile ──────────────────────────────────────────────────────────
// Tappable square-ish card used by the home launcher and section landings.
// Renders a large emoji/icon glyph, a title, and an optional one-line hint.
// Pressed state dims the surface — no fancy animation per the spec.
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';

interface Props {
  glyph: string;
  title: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  /** Marks the tile as the section's primary action (orange accent). */
  accent?: boolean;
  /** Testing hook + analytics identifier. */
  testID?: string;
}

export function LauncherTile({
  glyph,
  title,
  hint,
  onPress,
  disabled = false,
  accent = false,
  testID,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.tile,
        accent && styles.tileAccent,
        disabled && styles.tileDisabled,
        pressed && !disabled && styles.tilePressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      testID={testID}
    >
      <Text style={[styles.glyph, disabled && styles.glyphDisabled]}>
        {glyph}
      </Text>
      <Text
        style={[
          styles.title,
          accent && styles.titleAccent,
          disabled && styles.titleDisabled,
        ]}
        numberOfLines={2}
      >
        {title}
      </Text>
      {hint ? (
        <Text
          style={[styles.hint, disabled && styles.hintDisabled]}
          numberOfLines={2}
        >
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    tile: {
      flex: 1,
      minHeight: 128,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      // Soft shadow that reads as a card on light + dark.
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 6,
      elevation: 2,
    },
    tileAccent: {
      borderColor: colors.accent,
      borderWidth: 1.5,
    },
    tilePressed: {
      backgroundColor: colors.surfaceElevated,
      opacity: 0.85,
      transform: [{ scale: 0.98 }],
    },
    tileDisabled: {
      opacity: 0.45,
    },
    glyph: {
      fontSize: 36,
      marginBottom: spacing.sm,
      textAlign: 'center',
    },
    glyphDisabled: {
      opacity: 0.7,
    },
    title: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },
    titleAccent: {
      color: colors.accent,
    },
    titleDisabled: {
      color: colors.textSecondary,
    },
    hint: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: spacing.xs,
    },
    hintDisabled: {
      color: colors.textLight,
    },
  });
}
