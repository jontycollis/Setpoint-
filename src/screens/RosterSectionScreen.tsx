// ── RosterSectionScreen ───────────────────────────────────────────────────
// Sub-tile landing for the Roster launcher tile on the per-team page.
// Two sub-tiles:
//   • View roster   — read-only player list (TeamRosterScreen with
//                     `readOnly`). Always enabled.
//   • Manage roster — existing roster editor flow. Disabled for
//                     watching-only teams since you can't edit a roster
//                     that isn't yours.
// Patterned on ScoreboardSectionScreen.
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LauncherTile } from '../components/LauncherTile';
import { SectionHeader } from '../components/SectionHeader';
import { useTheme, spacing } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { TeamProfile } from '../types/profile';

interface Props {
  team: TeamProfile;
  onBack: () => void;
  onOpenView: () => void;
  onOpenManage: () => void;
}

export function RosterSectionScreen({
  team,
  onBack,
  onOpenView,
  onOpenManage,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const canManage = team.kind === 'me';
  const playerCount = (team.roster ?? []).filter((p) => p.active).length;
  const viewHint =
    playerCount > 0
      ? `${playerCount} player${playerCount === 1 ? '' : 's'}`
      : 'No players yet';

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
          title="Roster"
          subtitle={team.label}
          onBack={onBack}
        />
        <View style={styles.grid}>
          <View style={styles.row}>
            <LauncherTile
              glyph="👀"
              title="View roster"
              hint={viewHint}
              onPress={onOpenView}
              testID="roster-tile-view"
            />
            <LauncherTile
              glyph="✏️"
              title="Manage roster"
              hint={canManage ? 'Add, edit, remove players' : 'Available for your own teams'}
              disabled={!canManage}
              onPress={onOpenManage}
              testID="roster-tile-manage"
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
