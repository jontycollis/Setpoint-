// ── LauncherHomeScreen ────────────────────────────────────────────────────
// New home: a 2-column tile grid (3 cols on tablets / landscape).
// Each tile routes either into a section landing (Scoreboard, My Team,
// Browse) or straight into a leaf screen. Hamburger + active-team pill
// stay rendered by the app shell; this screen owns only the grid itself.
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LauncherTile } from '../components/LauncherTile';
import { useTheme, spacing, fontSize } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { UserProfile } from '../types/profile';

export interface LauncherHomeScreenProps {
  profile: UserProfile | null;
  onOpenScoreboardSection: () => void;
  onOpenMyTeamSection: () => void;
  /** Routed when the user has no team profile yet — sends them to the
   *  add-team flow rather than landing in an empty MyTeam section. */
  onOpenMyTeamOnboarding: () => void;
  onOpenBrowseSection: () => void;
  onOpenVenueMaps: () => void;
  onOpenMrs: () => void;
  onOpenCacLocker: () => void;
  onOpenOvaRankings: () => void;
  onOpenHelp: () => void;
}

export function LauncherHomeScreen({
  profile,
  onOpenScoreboardSection,
  onOpenMyTeamSection,
  onOpenMyTeamOnboarding,
  onOpenBrowseSection,
  onOpenVenueMaps,
  onOpenMrs,
  onOpenCacLocker,
  onOpenOvaRankings,
  onOpenHelp,
}: LauncherHomeScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // 2 columns on phones; 3 on tablets / landscape phones to fit more
  // tiles per row without ballooning tile size.
  const wide = width >= 720 || width > height;
  const numColumns = wide ? 3 : 2;
  const hasTeams = (profile?.teams?.length ?? 0) > 0;

  const tiles = [
    {
      key: 'scoreboard',
      glyph: '🏐',
      title: 'Scoreboard',
      hint: 'Score a match',
      accent: true,
      onPress: onOpenScoreboardSection,
    },
    {
      key: 'myteam',
      glyph: '👥',
      title: 'My Team',
      hint: hasTeams ? undefined : 'Add a team to get started',
      onPress: hasTeams ? onOpenMyTeamSection : onOpenMyTeamOnboarding,
    },
    {
      key: 'browse',
      glyph: '🔍',
      title: 'Browse',
      hint: 'Tournaments & teams',
      onPress: onOpenBrowseSection,
    },
    {
      key: 'venue',
      glyph: '🏟',
      title: 'Venue maps',
      onPress: onOpenVenueMaps,
    },
    {
      key: 'mrs',
      glyph: '📋',
      title: 'MRS',
      hint: 'OVA Member Reg.',
      onPress: onOpenMrs,
    },
    {
      key: 'cac',
      glyph: '🎓',
      title: 'CAC Locker',
      hint: 'Coach Locker',
      onPress: onOpenCacLocker,
    },
    {
      key: 'ova',
      glyph: '🏆',
      title: 'OVA Rankings',
      onPress: onOpenOvaRankings,
    },
    {
      key: 'help',
      glyph: '❓',
      title: 'Help',
      onPress: onOpenHelp,
    },
  ];

  // Lay out tiles into rows. We render rows manually rather than via
  // FlatList because the grid is short, fixed, and we want all tiles
  // in the same row to share height via `flex: 1`.
  const rows: typeof tiles[] = [];
  for (let i = 0; i < tiles.length; i += numColumns) {
    rows.push(tiles.slice(i, i + numColumns));
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            // Leave room above for the safe-area + the floating top bar
            // overlay (pill + search left, hamburger right) that lives
            // outside this screen.
            paddingTop: spacing.xxxl + insets.top,
            paddingBottom: spacing.xxl,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.heading}>Home</Text>
        <Text style={styles.subheading}>
          {profile?.displayName
            ? `Welcome back, ${profile.displayName}.`
            : 'Pick where you want to start.'}
        </Text>

        <View style={styles.grid}>
          {rows.map((row, rowIdx) => (
            <View key={`row-${rowIdx}`} style={styles.row}>
              {row.map((t) => (
                <LauncherTile
                  key={t.key}
                  glyph={t.glyph}
                  title={t.title}
                  hint={t.hint}
                  accent={t.accent}
                  onPress={t.onPress}
                  testID={`launcher-tile-${t.key}`}
                />
              ))}
              {/* Pad short rows with invisible spacers so the last row
                  doesn't stretch its tiles to full width. */}
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
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scroll: {
      paddingHorizontal: spacing.lg,
    },
    heading: {
      fontSize: fontSize.title,
      fontWeight: '800',
      color: colors.text,
      marginBottom: spacing.xs,
    },
    subheading: {
      fontSize: fontSize.md,
      color: colors.textSecondary,
      marginBottom: spacing.xl,
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
