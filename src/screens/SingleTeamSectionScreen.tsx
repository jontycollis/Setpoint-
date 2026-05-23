// ── SingleTeamSectionScreen ───────────────────────────────────────────────
// Per-team landing reached from the My Team(s) section's team-tile grid.
// Renders the section header scoped to one TeamProfile, then the feature
// sub-tile grid (Analytics, Season History, Tournaments, Roster, Sideline
// import, Add event). Caller pre-scopes the team via
// `handleSwitchActiveTeam(teamId)` before routing here so the existing
// feature screens pick up the right team context.
//
// Roster fans out into View/Manage on RosterSectionScreen; the top-level
// tile is enabled for every team (View works on watching teams too).
//
// "Add event" leads to the AddTournaments chooser, which itself handles
// the AES vs Timu split — one tile pointing at a chooser is cleaner than
// two tiles both leading there.
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
import { TeamAvatar } from '../components/TeamAvatar';
import { useTheme, spacing, fontSize } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { TeamProfile } from '../types/profile';
import { useTeamAvatarOverrides } from '../utils/teamAvatarStore';

interface Props {
  team: TeamProfile;
  onOpenAnalytics: () => void;
  onOpenSeasonHistory: () => void;
  onOpenTournaments: () => void;
  onOpenRoster: () => void;
  onOpenSidelineImport: () => void;
  onAddEvent: () => void;
  onBack: () => void;
}

export function SingleTeamSectionScreen({
  team,
  onOpenAnalytics,
  onOpenSeasonHistory,
  onOpenTournaments,
  onOpenRoster,
  onOpenSidelineImport,
  onAddEvent,
  onBack,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const overrides = useTeamAvatarOverrides();
  const customImageUri = overrides[team.id]?.uri;

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
    },
    {
      key: 'sideline',
      glyph: '📥',
      title: 'Import Sideline HD',
      onPress: onOpenSidelineImport,
    },
    {
      key: 'add-event',
      glyph: '➕',
      title: 'Add event',
      onPress: onAddEvent,
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
        <View style={styles.identity}>
          <TeamAvatar
            teamProfile={team}
            customImageUri={customImageUri}
            size={72}
          />
        </View>
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
    identity: {
      alignItems: 'center',
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
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
