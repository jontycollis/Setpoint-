// ── MyTeamSectionScreen ───────────────────────────────────────────────────
// Sub-tile landing for the My Team launcher tile.
//
// Layout (top → bottom):
//   1. SectionHeader (back + title)
//   2. Horizontal sub-tile strip — Analytics, Season History, Tournaments,
//      Roster, Import from Sideline HD, Add AES event, Add Timu event.
//   3. MyHomeScreen rendered verbatim below — Live Now, recently viewed,
//      teams list, career totals, etc. Its own ScrollView handles vertical
//      scrolling so we don't nest ScrollViews.
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { LauncherTile } from '../components/LauncherTile';
import { SectionHeader } from '../components/SectionHeader';
import { MyHomeScreen } from './MyHomeScreen';
import { useTheme, spacing, fontSize } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { UserProfile, TeamProfile } from '../types/profile';
import type { Match } from '../types/match';
import type { RecentItem } from '../utils/recentlyViewed';
import type { AutoDiscoverProgress } from '../utils/teamAutoDiscover';

interface Props {
  profile: UserProfile;
  // Sub-tile actions
  onOpenAnalytics: () => void;
  onOpenSeasonHistory: () => void;
  onOpenTournaments: () => void;
  onOpenRoster: () => void;
  onOpenSidelineImport: () => void;
  onAddAesEvent: () => void;
  onAddTimuEvent: () => void;
  // Forwarded to MyHomeScreen
  onOpenTeam: (team: TeamProfile) => void;
  onAddTeam: () => void;
  onFindInOvaRankings?: () => void;
  onBrowseTournaments?: () => void;
  onScoreAMatch?: () => void;
  onResumeMatch?: (match: Match) => void;
  onLongPressTeam?: (team: TeamProfile) => void;
  onOpenRecent?: (item: RecentItem) => void;
  onOpenAnalyticsForTeam?: (team: TeamProfile) => void;
  syncing?: boolean;
  syncProgress?: { done: number; total: number } | null;
  onSyncSeason?: () => void;
  discoveringTeamLabel?: string | null;
  discoveryProgress?: AutoDiscoverProgress | null;
  discoveryResult?: {
    teamId: string;
    teamLabel: string;
    aliases: string[];
    aesIndexed: number;
    timuIndexed: number;
  } | null;
  onDismissDiscoveryResult?: () => void;
  onViewDiscoveryResult?: () => void;
  onBack: () => void;
}

export function MyTeamSectionScreen({
  profile,
  onOpenAnalytics,
  onOpenSeasonHistory,
  onOpenTournaments,
  onOpenRoster,
  onOpenSidelineImport,
  onAddAesEvent,
  onAddTimuEvent,
  onOpenTeam,
  onAddTeam,
  onFindInOvaRankings,
  onBrowseTournaments,
  onScoreAMatch,
  onResumeMatch,
  onLongPressTeam,
  onOpenRecent,
  onOpenAnalyticsForTeam,
  syncing,
  syncProgress,
  onSyncSeason,
  discoveringTeamLabel,
  discoveryProgress,
  discoveryResult,
  onDismissDiscoveryResult,
  onViewDiscoveryResult,
  onBack,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const activeTeam: TeamProfile | null = profile.activeTeamId
    ? profile.teams.find((t) => t.id === profile.activeTeamId) ?? null
    : null;
  const meTeam = activeTeam?.kind === 'me' ? activeTeam : null;

  return (
    <View style={styles.container}>
      <SectionHeader
        title="My Team"
        subtitle={
          activeTeam
            ? `Active: ${activeTeam.label}`
            : 'Add a team to get started.'
        }
        onBack={onBack}
      />

      <View style={styles.tileStripWrap}>
        <Text style={styles.tileStripHeading}>Quick actions</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tileStripContent}
        >
          <View style={styles.tileMini}>
            <LauncherTile
              glyph="📊"
              title="Analytics"
              onPress={onOpenAnalytics}
              disabled={!activeTeam}
              testID="myteam-tile-analytics"
            />
          </View>
          <View style={styles.tileMini}>
            <LauncherTile
              glyph="📅"
              title="Season History"
              onPress={onOpenSeasonHistory}
              disabled={!activeTeam}
              testID="myteam-tile-season"
            />
          </View>
          <View style={styles.tileMini}>
            <LauncherTile
              glyph="🏆"
              title="Tournaments"
              onPress={onOpenTournaments}
              testID="myteam-tile-tournaments"
            />
          </View>
          <View style={styles.tileMini}>
            <LauncherTile
              glyph="👥"
              title="Roster"
              onPress={onOpenRoster}
              disabled={!meTeam}
              testID="myteam-tile-roster"
            />
          </View>
          <View style={styles.tileMini}>
            <LauncherTile
              glyph="📥"
              title="Import Sideline HD"
              onPress={onOpenSidelineImport}
              testID="myteam-tile-sideline"
            />
          </View>
          <View style={styles.tileMini}>
            <LauncherTile
              glyph="➕"
              title="Add AES event"
              onPress={onAddAesEvent}
              testID="myteam-tile-add-aes"
            />
          </View>
          <View style={styles.tileMini}>
            <LauncherTile
              glyph="➕"
              title="Add Timu event"
              onPress={onAddTimuEvent}
              testID="myteam-tile-add-timu"
            />
          </View>
        </ScrollView>
      </View>

      {/* Legacy home content — Live Now, recently viewed, teams,
          watching, career card. MyHomeScreen owns its own scroll
          container so we just give it the remaining vertical space. */}
      <View style={styles.embeddedHome}>
        <MyHomeScreen
          profile={profile}
          onOpenTeam={onOpenTeam}
          onAddTeam={onAddTeam}
          onFindInOvaRankings={onFindInOvaRankings}
          onBrowseTournaments={onBrowseTournaments}
          onScoreAMatch={onScoreAMatch}
          onResumeMatch={onResumeMatch}
          syncing={syncing}
          syncProgress={syncProgress}
          onSyncSeason={onSyncSeason}
          discoveringTeamLabel={discoveringTeamLabel}
          discoveryProgress={discoveryProgress}
          discoveryResult={discoveryResult}
          onDismissDiscoveryResult={onDismissDiscoveryResult}
          onViewDiscoveryResult={onViewDiscoveryResult}
          onLongPressTeam={onLongPressTeam}
          onOpenRecent={onOpenRecent}
          onOpenAnalytics={onOpenAnalyticsForTeam}
        />
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    tileStripWrap: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    tileStripHeading: {
      fontSize: fontSize.sm,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: spacing.sm,
    },
    tileStripContent: {
      gap: spacing.md,
      paddingRight: spacing.lg,
    },
    tileMini: {
      width: 140,
    },
    embeddedHome: {
      flex: 1,
    },
  });
}
