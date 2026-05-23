// ── MyTeamSectionScreen ───────────────────────────────────────────────────
// "My Team(s)" landing — a team-picker. Each followed team gets its own
// tile rendered as a TeamAvatar (auto-generated initials + hashed color)
// or, when the user has picked one, their own image. Tapping a tile
// drills into SingleTeamSectionScreen scoped to that team; long-pressing
// opens the "change image" action sheet. A trailing "Add team" tile
// routes to the add-team chooser.
//
// Below the tile grid we keep the legacy MyHome content (Live Now,
// recently viewed, watching list, career card) so the user still sees
// "what's live across all my teams" without having to pick one first.
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { LauncherTile } from '../components/LauncherTile';
import { SectionHeader } from '../components/SectionHeader';
import { TeamAvatar } from '../components/TeamAvatar';
import { MyHomeScreen } from './MyHomeScreen';
import {
  useTheme,
  spacing,
  fontSize,
  borderRadius,
} from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { UserProfile, TeamProfile } from '../types/profile';
import type { Match } from '../types/match';
import type { RecentItem } from '../utils/recentlyViewed';
import type { AutoDiscoverProgress } from '../utils/teamAutoDiscover';
import {
  clearOverride,
  setOverride,
  useTeamAvatarOverrides,
} from '../utils/teamAvatarStore';
import {
  isImagePickerAvailable,
  pickFromLibrary,
  takePhoto,
} from '../utils/imagePickerModule';

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

  const overrides = useTeamAvatarOverrides();

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

  const handleEditAvatar = (team: TeamProfile) => {
    showAvatarActionSheet(team, overrides[team.id]?.uri != null);
  };

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
                  <TeamTile
                    key={t.team.id}
                    team={t.team}
                    customImageUri={overrides[t.team.id]?.uri}
                    onPress={() => onOpenTeamSection(t.team)}
                    onLongPress={() => handleEditAvatar(t.team)}
                    colors={colors}
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

// ── TeamTile ──────────────────────────────────────────────────────────────
// Tile that renders the team's avatar (or uploaded image) above the label.
// Same outer affordance as LauncherTile so the picker grid stays visually
// consistent with the "Add team" tile sitting alongside it. Tap drills
// into the team section; long-press opens the change-image action sheet.

interface TeamTileProps {
  team: TeamProfile;
  customImageUri?: string;
  onPress: () => void;
  onLongPress: () => void;
  colors: ThemeColors;
}

function TeamTile({
  team,
  customImageUri,
  onPress,
  onLongPress,
  colors,
}: TeamTileProps) {
  const styles = useMemo(() => makeTileStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      style={({ pressed }) => [
        styles.tile,
        pressed && styles.tilePressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={team.label}
      accessibilityHint="Long-press to change image"
      testID={`myteams-tile-${team.id}`}
    >
      <TeamAvatar
        teamProfile={team}
        customImageUri={customImageUri}
        size={56}
        style={styles.avatar}
      />
      <Text style={styles.title} numberOfLines={2}>
        {team.label}
      </Text>
      {(() => {
        const sub = teamSubtitle(team);
        return sub ? (
          <Text style={styles.hint} numberOfLines={2}>
            {sub}
          </Text>
        ) : null;
      })()}
      {team.kind === 'watching' ? (
        <Text style={styles.watchingBadge}>Watching</Text>
      ) : null}
    </Pressable>
  );
}

// ── Action sheet for the "change image" affordance ────────────────────────
//
// Uses RN's Alert with up to four buttons. iOS shows them all; Android's
// material dialog renders the first three (positive/neutral/negative
// slots) — when the camera button gets clipped, the user still has
// library + reset reachable and can capture-then-pick via the library
// flow. If expo-image-picker isn't compiled into the APK at all we just
// show a Reset / Cancel sheet so the user can still revert to the
// auto-generated avatar.
async function showAvatarActionSheet(
  team: TeamProfile,
  hasOverride: boolean
): Promise<void> {
  const pickerOn = isImagePickerAvailable();

  const buttons: Array<{
    text: string;
    onPress?: () => void;
    style?: 'default' | 'cancel' | 'destructive';
  }> = [];

  if (pickerOn) {
    buttons.push({
      text: 'Choose photo',
      onPress: async () => {
        const result = await pickFromLibrary();
        if (result) await setOverride(team.id, result.uri);
      },
    });
    buttons.push({
      text: 'Take photo',
      onPress: async () => {
        const result = await takePhoto();
        if (result) await setOverride(team.id, result.uri);
      },
    });
  }

  if (hasOverride) {
    buttons.push({
      text: 'Reset to auto',
      style: 'destructive',
      onPress: () => {
        void clearOverride(team.id);
      },
    });
  }

  buttons.push({ text: 'Cancel', style: 'cancel' });

  if (!pickerOn && !hasOverride) {
    // Nothing actionable — let the user know rather than showing a sheet
    // that only contains Cancel.
    Alert.alert(
      team.label,
      'Custom team images are available in the next app version.'
    );
    return;
  }

  Alert.alert(
    team.label,
    pickerOn
      ? 'Replace the auto-generated icon for this team.'
      : 'Reset this team to the auto-generated icon.',
    buttons,
    { cancelable: true }
  );
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

function makeTileStyles(colors: ThemeColors) {
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
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 6,
      elevation: 2,
    },
    tilePressed: {
      backgroundColor: colors.surfaceElevated,
      opacity: 0.85,
      transform: [{ scale: 0.98 }],
    },
    avatar: {
      marginBottom: spacing.sm,
    },
    title: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },
    hint: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: spacing.xs,
    },
    watchingBadge: {
      fontSize: fontSize.xs,
      color: colors.textLight,
      marginTop: spacing.xs,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
  });
}
