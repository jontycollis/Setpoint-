// ── TournamentsSectionScreen ──────────────────────────────────────────────
// Sub-tile landing for the Tournaments launcher tile on the per-team page.
// Two sub-tiles:
//   • Current Tournament — the active tournament for this team (in-progress
//                          or starting within 7 days). Tap → routes to that
//                          tournament's dashboard, same as tapping a card
//                          in Season History. When none, tile falls back to
//                          the Add Tournaments destination so the user has
//                          a single path forward.
//   • Add Tournaments    — opens the AddTournaments chooser (AES / Timu).
// Patterned on RosterSectionScreen + ScoreboardSectionScreen.
// ────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LauncherTile } from '../components/LauncherTile';
import { SectionHeader } from '../components/SectionHeader';
import { useTheme, spacing } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { TeamProfile } from '../types/profile';
import {
  loadAllSeasonIndices,
  buildMySeasonHistory,
  getActiveTournaments,
  currentTournamentBadgeLabel,
  type UnifiedTournamentEntry,
} from '../utils/unifiedSeasonHistory';

interface Props {
  team: TeamProfile;
  onBack: () => void;
  /**
   * Called when the user taps the Current Tournament tile and there IS an
   * active tournament. Caller routes to the appropriate dashboard (AES
   * `TeamDashboard` or Timu `TimuTeamDashboard`) — same destination as a
   * Season-History tournament card tap.
   */
  onOpenCurrentTournament: (entry: UnifiedTournamentEntry) => void;
  /** Routes to the existing AddTournaments chooser. */
  onOpenAddTournaments: () => void;
}

export function TournamentsSectionScreen({
  team,
  onBack,
  onOpenCurrentTournament,
  onOpenAddTournaments,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // `undefined` while loading, `null` when checked and no active tournament,
  // otherwise the soonest active entry.
  const [active, setActive] = useState<
    UnifiedTournamentEntry | null | undefined
  >(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fullAliases = Array.from(
          new Set([team.label, ...(team.aliases ?? [])])
        ).filter((s) => s && s.trim().length > 0);
        const indices = await loadAllSeasonIndices();
        const history = buildMySeasonHistory(indices, fullAliases);
        const list = getActiveTournaments(history);
        if (!cancelled) setActive(list[0] ?? null);
      } catch {
        if (!cancelled) setActive(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [team.id]);

  const currentHint =
    active === undefined
      ? 'Checking…'
      : active
        ? `${active.tournamentName} · ${currentTournamentBadgeLabel(active.dateMs)}`
        : 'No active tournament — tap to add one';

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
          title="Tournaments"
          subtitle={team.label}
          onBack={onBack}
        />
        <View style={styles.grid}>
          <View style={styles.row}>
            <LauncherTile
              glyph="🏟"
              title="Current Tournament"
              hint={currentHint}
              accent={!!active}
              onPress={() => {
                if (active) onOpenCurrentTournament(active);
                else onOpenAddTournaments();
              }}
              testID="tournaments-tile-current"
            />
            <LauncherTile
              glyph="➕"
              title="Add Tournaments"
              hint="Connect AES or Timu events"
              onPress={onOpenAddTournaments}
              testID="tournaments-tile-add"
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
