// ── SidelineImportPlaceholderScreen ───────────────────────────────────────
// Placeholder for the Sideline HD importer surfaced from the My Team
// section's "Import from Sideline HD" sub-tile. A parallel work stream
// is building the real importer — once it lands, swap this screen for
// the live one without touching navigation.
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SectionHeader } from '../components/SectionHeader';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';

interface Props {
  onBack: () => void;
}

export function SidelineImportPlaceholderScreen({ onBack }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.container}>
      <SectionHeader
        title="Import from Sideline HD"
        onBack={onBack}
      />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + spacing.xxl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <Text style={styles.cardEmoji}>📥</Text>
          <Text style={styles.cardTitle}>Coming soon</Text>
          <Text style={styles.cardBody}>
            Sideline HD import will be bundled with the next APK release.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
    card: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.xl,
      alignItems: 'center',
    },
    cardEmoji: { fontSize: 44, marginBottom: spacing.md },
    cardTitle: {
      color: colors.text,
      fontSize: fontSize.xxl,
      fontWeight: '800',
      marginBottom: spacing.sm,
    },
    cardBody: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      textAlign: 'center',
      lineHeight: 22,
    },
  });
}
