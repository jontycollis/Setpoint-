// ── BrowseSectionScreen ───────────────────────────────────────────────────
// Sub-tile landing for the Browse launcher tile. Four sub-tiles:
//   • AES events       → TournamentSelect (CA/US AES registry)
//   • Timu events      → AddTournaments (paste-a-Timu-URL flow)
//   • OVA Rankings     → OvaRankings
//   • Search everything → GlobalSearch
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LauncherTile } from '../components/LauncherTile';
import { SectionHeader } from '../components/SectionHeader';
import { useTheme, spacing } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';

interface Props {
  onBack: () => void;
  onOpenAesEvents: () => void;
  onOpenTimuEvents: () => void;
  onOpenOvaRankings: () => void;
  onOpenSearch: () => void;
}

export function BrowseSectionScreen({
  onBack,
  onOpenAesEvents,
  onOpenTimuEvents,
  onOpenOvaRankings,
  onOpenSearch,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + spacing.xxl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <SectionHeader
          title="Browse"
          subtitle="Find tournaments, teams, and rankings."
          onBack={onBack}
        />
        <View style={styles.grid}>
          <View style={styles.row}>
            <LauncherTile
              glyph="🇨🇦"
              title="AES events"
              hint="Tournaments by region"
              onPress={onOpenAesEvents}
              testID="browse-tile-aes"
            />
            <LauncherTile
              glyph="🌐"
              title="Timu events"
              hint="Paste a Timu URL"
              onPress={onOpenTimuEvents}
              testID="browse-tile-timu"
            />
          </View>
          <View style={styles.row}>
            <LauncherTile
              glyph="🏆"
              title="OVA Rankings"
              hint="Provincial ranking lists"
              onPress={onOpenOvaRankings}
              testID="browse-tile-ova"
            />
            <LauncherTile
              glyph="🔎"
              title="Search everything"
              hint="Teams, events, players"
              onPress={onOpenSearch}
              testID="browse-tile-search"
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { paddingHorizontal: spacing.lg },
    grid: { gap: spacing.md, marginTop: spacing.md },
    row: { flexDirection: 'row', gap: spacing.md },
  });
}
