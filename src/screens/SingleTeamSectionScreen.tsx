// ── SingleTeamSectionScreen ───────────────────────────────────────────────
// Per-team landing reached from the My Team(s) section's team-tile grid.
// Renders the section header scoped to one TeamProfile, then the feature
// sub-tile grid (Analytics, Season History, Tournaments, Roster, Sideline
// import, Add AES event, Add Timu event). Caller pre-scopes the team via
// `handleSwitchActiveTeam(teamId)` before routing here so the existing
// feature screens pick up the right team context.
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { LauncherTile } from '../components/LauncherTile';
import { SectionHeader } from '../components/SectionHeader';
import { useTheme, spacing, fontSize } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { TeamProfile } from '../types/profile';

interface Props {
  team: TeamProfile;
  onOpenAnalytics: () => void;
  onOpenSeasonHistory: () => void;
  onOpenTournaments: () => void;
  onOpenRoster: () => void;
  onOpenSidelineImport: () => void;
  onAddAesEvent: () => void;
  onAddTimuEvent: () => void;
  onBack: () => void;
}

export function SingleTeamSectionScreen({
  team,
  onOpenAnalytics,
  onOpenSeasonHistory,
  onOpenTournaments,
  onOpenRoster,
  onOpenSidelineImport,
  onAddAesEvent,
  onAddTimuEvent,
  onBack,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const { width, height } = useWindowDimensions();
  const wide = width >= 720 || width > height;
  const numColumns = wide ? 3 : 2;

  const subtitleParts = [team.ageGroup, team.club, team.seasonLabel].filter(
    Boolean
  ) as string[];
  const subtitle =
    subtitleParts.length > 0
      ? subtitleParts.join(' · ')
      : team.kind === 'watching'
      ? 'Watching'
      : undefined;

  // Roster editing only applies to teams the user is on; watching teams
  // don't surface a roster editor (mirrors prior MyTeamSectionScreen gating).
  const meTeam = team.kind === 'me';

  const tiles = [
    {
      key: 'analytics',
      glyph: '📊',
      title: 'Analytics',
      onPress: onOpenAnalytics,
    },
    {
      key: 'season',
      glyph: '📅',
      title: 'Season History',
      onPress: onOpenSeasonHistory,
    },
    {
      key: 'tournaments',
      glyph: '🏆',
      title: 'Tournaments',
      onPress: onOpenTournaments,
    },
    {
      key: 'roster',
      glyph: '👥',
      title: 'Roster',
      onPress: onOpenRoster,
      disabled: !meTeam,
    },
    {
      key: 'sideline',
      glyph: '📥',
      title: 'Import Sideline HD',
      onPress: onOpenSidelineImport,
    },
    {
      key: 'add-aes',
      glyph: '➕',
      title: 'Add AES event',
      onPress: onAddAesEvent,
    },
    {
      key: 'add-timu',
      glyph: '➕',
      title: 'Add Timu event',
      onPress: onAddTimuEvent,
    },
  ];

  const rows: (typeof tiles)[] = [];
  for (let i = 0; i < tiles.length; i += numColumns) {
    rows.push(tiles.slice(i, i + numColumns));
  }

  return (
    <View style={styles.container}>
      <SectionHeader title={team.label} subtitle={subtitle} onBack={onBack} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.tileSectionHeading}>Team</Text>
        <View style={styles.grid}>
          {rows.map((row, rowIdx) => (
            <View key={`row-${rowIdx}`} style={styles.row}>
              {row.map((t) => (
                <LauncherTile
                  key={t.key}
                  glyph={t.glyph}
                  title={t.title}
                  onPress={t.onPress}
                  disabled={t.disabled}
                  testID={`singleteam-tile-${t.key}`}
                />
              ))}
              {row.length < numColumns
                ? Array.from({ length: numColumns - row.length }).map(
                    (_, idx) => (
                      <View
                        key={`spacer-${rowIdx}-${idx}`}
                        style={styles.spacer}
                      />
                    )
                  )
                : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    tileSectionHeading: {
      fontSize: fontSize.sm,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: spacing.sm,
    },
    grid: {
      gap: spacing.md,
    },
    row: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    spacer: {
      flex: 1,
    },
  });
}
