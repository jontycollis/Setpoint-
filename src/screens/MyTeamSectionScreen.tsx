// ── MyTeamSectionScreen ───────────────────────────────────────────────────
// "My Team(s)" landing — a team-picker. Each followed team gets its own
// LauncherTile; tapping one drills into SingleTeamSectionScreen scoped to
// that team. A trailing "Add team" tile routes to the add-team chooser.
//
// Below the tile grid we keep the legacy MyHome content (Live Now,
// recently viewed, watching list, career card) so the user still sees
// "what's live across all my teams" without having to pick one first.
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import {
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
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
  /** Tap a team tile → enter that team's section. */
  onOpenTeamSection: (team: TeamProfile) => void;
  /** Tap the "+ Add team" tile. */
  onAddTeam: () => void;
  // Forwarded to MyHomeScreen (embedded below the picker grid)
  onOpenTeam: (team: TeamProfile) => void;
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
  onOpenTeamSection,
  onAddTeam,
  onOpenTeam,
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

  const { width, height } = useWindowDimensions();
  const wide = width >= 720 || width > height;
  const numColumns = wide ? 3 : 2;

  // 'me' teams render first, then 'watching'. Both sort newest-first inside
  // their bucket so a freshly-added team surfaces at the top of the grid.
  const teamsSorted = useMemo(() => {
    const sorted = [...profile.teams].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'me' ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
    return sorted;
  }, [profile.teams]);

  type Tile =
    | { kind: 'team'; team: TeamProfile }
    | { kind: 'add' };
  const tiles: Tile[] = [
    ...teamsSorted.map((team) => ({ kind: 'team' as const, team })),
    { kind: 'add' as const },
  ];

  const rows: Tile[][] = [];
  for (let i = 0; i < tiles.length; i += numColumns) {
    rows.push(tiles.slice(i, i + numColumns));
  }

  return (
    <View style={styles.container}>
      <SectionHeader
        title="My Team(s)"
        subtitle={
          profile.teams.length === 0
            ? 'Add a team to get started.'
            : 'Pick a team to drill into its analytics, history, and roster.'
        }
        onBack={onBack}
      />

      <View style={styles.tileSection}>
        <Text style={styles.tileSectionHeading}>Your teams</Text>
        <View style={styles.grid}>
          {rows.map((row, rowIdx) => (
            <View key={`row-${rowIdx}`} style={styles.row}>
              {row.map((t, idx) => {
                if (t.kind === 'add') {
                  return (
                    <LauncherTile
                      key="add-team"
                      glyph="➕"
                      title="Add team"
                      hint="AES, Timu, or OVA roster"
                      onPress={onAddTeam}
                      testID="myteams-tile-add"
                    />
                  );
                }
                return (
                  <LauncherTile
                    key={t.team.id}
                    glyph={teamGlyph(t.team)}
                    title={t.team.label}
                    hint={teamSubtitle(t.team)}
                    onPress={() => onOpenTeamSection(t.team)}
                    testID={`myteams-tile-${t.team.id}`}
                  />
                );
              })}
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
      </View>

      {/* Legacy home content — Live Now, recently viewed, watching list,
          career card. MyHomeScreen owns its own scroll container so we
          just give it the remaining vertical space. */}
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

// Glyph hint per team: differentiate 'me' from 'watching' so the picker
// reads at a glance which teams roll up into Career.
function teamGlyph(team: TeamProfile): string {
  if (team.kind === 'watching') return '👀';
  return '🏐';
}

// Short identifier shown under the team name in the tile. Falls back from
// the rich "U18 · Defensa · 2025-26" line to whichever single field is set,
// or empty if the profile has no metadata.
function teamSubtitle(team: TeamProfile): string | undefined {
  const parts = [team.ageGroup, team.club, team.seasonLabel].filter(
    Boolean
  ) as string[];
  if (parts.length === 0) return undefined;
  return parts.join(' · ');
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    tileSection: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
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
    embeddedHome: {
      flex: 1,
    },
  });
}
