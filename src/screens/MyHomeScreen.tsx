// ── MyHomeScreen ──────────────────────────────────────────────────────────
//
// The user's landing page (Phase 4 restructure). The app boots here and
// the team-context Home button comes back here.
//
// Layout, top-to-bottom:
//   - Hero (optional display name + role kicker, generic fallback)
//   - "My Teams" section (TeamProfiles with kind === 'me')
//       Each team is a tappable card → enters that team's context.
//       "+ Add team" CTA after the last me-team card.
//   - "Watching" section (kind === 'watching') — skipped if empty.
//   - Connections section (OVA MRS + CAC Locker tiles).
//       Each tile shows "Connected" / "Connect" state and routes to the
//       ConnectionScreen which embeds the live authenticated site.
//   - Career totals card (only when at least one me-team has indexed
//     tournaments matching its aliases).
//   - Browse Tournaments — low-emphasis link for explore-mode without
//     pinning a team.
//
// Note: this screen does NOT host the team-switcher on its own — switching
// is done by tapping a team card. The hamburger has the same switcher when
// the user is inside a team context (Phase 4 hamburger split).
// ────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Card } from '../components/Card';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { UserProfile, TeamProfile } from '../types/profile';
import {
  buildMySeasonHistory,
  loadAllSeasonIndices,
  aggregateUnifiedStats,
  type UnifiedAggregateStats,
} from '../utils/unifiedSeasonHistory';
import type { AutoDiscoverProgress } from '../utils/teamAutoDiscover';
import {
  DiscoveryProgressBanner,
  DiscoveryResultBanner,
} from '../components/DiscoveryBanners';

interface Props {
  profile: UserProfile;
  /** Tap a team card → enter that team's context. */
  onOpenTeam: (team: TeamProfile) => void;
  /** Tap "+ Add team" CTA. */
  onAddTeam: () => void;
  /** Tap the OVA MRS connection tile. */
  onOpenMrsConnection: () => void;
  /** Tap the CAC Locker connection tile. */
  onOpenCacConnection: () => void;
  /** Low-emphasis "Browse tournaments" entry (explore mode, no pin). */
  onBrowseTournaments: () => void;
  /** True while the boot refresh or a manual sync is running. */
  syncing?: boolean;
  /** {done, total} counts for the in-flight sync, or null when idle. */
  syncProgress?: { done: number; total: number } | null;
  /** Manual "Sync now" button. */
  onSyncSeason?: () => void;
  /** Display label of the team currently being auto-discovered, or null. */
  discoveringTeamLabel?: string | null;
  /** Progress of the in-flight auto-discovery, or null when idle. */
  discoveryProgress?: AutoDiscoverProgress | null;
  /** Result of the most recent discovery (lingers ~30s after completion). */
  discoveryResult?: {
    teamId: string;
    teamLabel: string;
    aesIndexed: number;
    timuIndexed: number;
  } | null;
  onDismissDiscoveryResult?: () => void;
  onViewDiscoveryResult?: () => void;
  /** Long-press a team card → confirm removal. */
  onRemoveTeam?: (team: TeamProfile) => void;
}

export function MyHomeScreen({
  profile,
  onOpenTeam,
  onAddTeam,
  onOpenMrsConnection,
  onOpenCacConnection,
  onBrowseTournaments,
  syncing = false,
  syncProgress = null,
  onSyncSeason,
  discoveringTeamLabel = null,
  discoveryProgress = null,
  discoveryResult = null,
  onDismissDiscoveryResult,
  onViewDiscoveryResult,
  onRemoveTeam,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const meTeams = profile.teams.filter((t) => t.kind === 'me');
  const watchingTeams = profile.teams.filter((t) => t.kind === 'watching');
  const heroLabel = profile.displayName
    ? `${profile.displayName}'s home`
    : 'My home';
  const heroKicker =
    profile.role === 'parent'
      ? 'PARENT'
      : profile.role === 'coach'
      ? 'COACH'
      : profile.role === 'athlete'
      ? 'ATHLETE'
      : '';

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        {heroKicker ? (
          <Text style={styles.heroKicker}>{heroKicker}</Text>
        ) : null}
        <Text style={styles.heroTitle} numberOfLines={2}>
          {heroLabel}
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {discoveringTeamLabel ? (
          <DiscoveryProgressBanner
            teamLabel={discoveringTeamLabel}
            progress={discoveryProgress}
          />
        ) : discoveryResult ? (
          <DiscoveryResultBanner
            result={discoveryResult}
            onView={onViewDiscoveryResult}
            onDismiss={onDismissDiscoveryResult}
          />
        ) : (
          <SyncStatusRow
            syncing={syncing}
            progress={syncProgress}
            onSync={onSyncSeason}
          />
        )}
        <MyTeamsSection
          teams={meTeams}
          onOpenTeam={onOpenTeam}
          onAddTeam={onAddTeam}
          onRemoveTeam={onRemoveTeam}
        />

        {watchingTeams.length > 0 ? (
          <WatchingSection
            teams={watchingTeams}
            onOpenTeam={onOpenTeam}
            onRemoveTeam={onRemoveTeam}
          />
        ) : null}

        <ConnectionsSection
          mrsLinked={profile.mrsLinked}
          cacLinked={profile.cacLinked}
          onOpenMrsConnection={onOpenMrsConnection}
          onOpenCacConnection={onOpenCacConnection}
        />

        {meTeams.length > 0 ? <CareerCard profile={profile} /> : null}

        <TouchableOpacity
          style={styles.browseLink}
          onPress={onBrowseTournaments}
          activeOpacity={0.7}
        >
          <Text style={styles.browseLinkText}>Browse tournaments →</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ── My Teams ──────────────────────────────────────────────────────────────

function MyTeamsSection({
  teams,
  onOpenTeam,
  onAddTeam,
  onRemoveTeam,
}: {
  teams: TeamProfile[];
  onOpenTeam: (team: TeamProfile) => void;
  onAddTeam: () => void;
  onRemoveTeam?: (team: TeamProfile) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>MY TEAMS</Text>
      {teams.length === 0 ? (
        <Card variant="outlined" style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No teams yet</Text>
          <Text style={styles.emptyBody}>
            Find a tournament you're playing in and add the team you (or
            your child) play for. Past tournaments build career history.
          </Text>
        </Card>
      ) : (
        teams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            onOpen={() => onOpenTeam(team)}
            onLongPress={onRemoveTeam ? () => onRemoveTeam(team) : undefined}
          />
        ))
      )}
      <TouchableOpacity
        style={styles.addTeamBtn}
        onPress={onAddTeam}
        activeOpacity={0.7}
      >
        <Text style={styles.addTeamBtnText}>+ Add team</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Watching ──────────────────────────────────────────────────────────────

function WatchingSection({
  teams,
  onOpenTeam,
  onRemoveTeam,
}: {
  teams: TeamProfile[];
  onOpenTeam: (team: TeamProfile) => void;
  onRemoveTeam?: (team: TeamProfile) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>WATCHING</Text>
      <Text style={styles.sectionHint}>
        Teams you're tracking inside a tournament. Doesn't count toward
        your Career rollup.
      </Text>
      {teams.map((team) => (
        <TeamCard
          key={team.id}
          team={team}
          onOpen={() => onOpenTeam(team)}
          onLongPress={onRemoveTeam ? () => onRemoveTeam(team) : undefined}
          compact
        />
      ))}
    </View>
  );
}

// ── Team card ─────────────────────────────────────────────────────────────

function TeamCard({
  team,
  onOpen,
  onLongPress,
  compact,
}: {
  team: TeamProfile;
  onOpen: () => void;
  onLongPress?: () => void;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const sourceLabel =
    team.source === 'mrs-linked'
      ? 'OVA'
      : team.source === 'mixed'
      ? 'AES+TIMU'
      : team.source.toUpperCase();
  const sourceColor =
    team.source === 'timu' || team.source === 'mixed'
      ? colors.accent
      : colors.primary;
  const meta =
    [team.ageGroup, team.club, team.seasonLabel].filter(Boolean).join(' · ') ||
    null;
  return (
    <TouchableOpacity
      onPress={onOpen}
      onLongPress={onLongPress}
      delayLongPress={400}
      activeOpacity={0.7}
      style={[styles.teamCard, compact && styles.teamCardCompact]}
    >
      <View style={[styles.sourceBadge, { backgroundColor: sourceColor }]}>
        <Text style={styles.sourceBadgeText}>{sourceLabel}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[styles.teamCardTitle, compact && styles.teamCardTitleCompact]}
          numberOfLines={1}
        >
          {team.label}
        </Text>
        {meta ? (
          <Text style={styles.teamCardMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        {!team.primaryRef ? (
          <Text style={styles.teamCardWarn}>
            No tournament linked yet — open to add one
          </Text>
        ) : null}
      </View>
      <Text style={styles.teamCardArrow}>›</Text>
    </TouchableOpacity>
  );
}

// ── Connections ───────────────────────────────────────────────────────────

function ConnectionsSection({
  mrsLinked,
  cacLinked,
  onOpenMrsConnection,
  onOpenCacConnection,
}: {
  mrsLinked: boolean;
  cacLinked: boolean;
  onOpenMrsConnection: () => void;
  onOpenCacConnection: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>CONNECTIONS</Text>
      <Text style={styles.sectionHint}>
        Sign in to OVA and CAC inside VBPlus to view your data without
        switching apps.
      </Text>
      <ConnectionRow
        title="OVA MRS"
        subtitle={
          mrsLinked
            ? 'Connected — view your account'
            : 'Connect to view team affiliations'
        }
        connected={mrsLinked}
        onPress={onOpenMrsConnection}
        icon={'\u{1F517}'}
      />
      <ConnectionRow
        title="CAC Locker"
        subtitle={
          cacLinked
            ? 'Connected — view your transcript'
            : 'Connect to view NCCP certifications'
        }
        connected={cacLinked}
        onPress={onOpenCacConnection}
        icon={'\u{1F3CB}'}
      />
    </View>
  );
}

function ConnectionRow({
  title,
  subtitle,
  connected,
  onPress,
  icon,
}: {
  title: string;
  subtitle: string;
  connected: boolean;
  onPress: () => void;
  icon: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={styles.connectionRow}
    >
      <Text style={styles.connectionIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.connectionTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.connectionSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View
        style={[
          styles.connectionStatus,
          connected ? styles.connectionStatusOn : styles.connectionStatusOff,
        ]}
      >
        <Text
          style={[
            styles.connectionStatusText,
            connected
              ? styles.connectionStatusTextOn
              : styles.connectionStatusTextOff,
          ]}
        >
          {connected ? 'Connected' : 'Connect'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Career card ───────────────────────────────────────────────────────────

function CareerCard({ profile }: { profile: UserProfile }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [stats, setStats] = useState<UnifiedAggregateStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const meTeams = profile.teams.filter((t) => t.kind === 'me');
    if (meTeams.length === 0) {
      setStats(null);
      setLoading(false);
      return;
    }
    const allAliases = Array.from(
      new Set(
        meTeams.flatMap((t) => (t.aliases.length ? t.aliases : [t.label]))
      )
    );
    setLoading(true);
    (async () => {
      try {
        const indices = await loadAllSeasonIndices();
        if (cancelled) return;
        const history = buildMySeasonHistory(indices, allAliases);
        if (cancelled) return;
        setStats(aggregateUnifiedStats(history));
      } catch {
        if (!cancelled) setStats(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const meCount = profile.teams.filter((t) => t.kind === 'me').length;

  return (
    <Card style={styles.careerCard}>
      <Text style={styles.careerKicker}>
        {meCount > 1 ? 'CAREER TOTALS' : 'SEASON TOTALS'}
      </Text>
      {loading ? (
        <Text style={styles.careerLoading}>Loading…</Text>
      ) : stats ? (
        <View style={styles.careerGrid}>
          <CareerCell
            label="Tournaments"
            value={String(stats.tournamentsPlayed)}
          />
          <CareerCell
            label="Record"
            value={`${stats.totalMatchesWon}-${stats.totalMatchesLost}`}
            accent
          />
          <CareerCell
            label="Sets"
            value={`${stats.totalSetsWon}-${stats.totalSetsLost}`}
          />
          <CareerCell
            label="Best finish"
            value={
              stats.bestFinish
                ? `${medalEmoji(stats.bestFinish.rank)}${
                    medalEmoji(stats.bestFinish.rank) ? ' ' : ''
                  }${stats.bestFinish.label}`
                : '—'
            }
            accent={!!stats.bestFinish}
          />
        </View>
      ) : (
        <Text style={styles.careerLoading}>
          No tournaments indexed yet for your teams.
        </Text>
      )}
    </Card>
  );
}

function CareerCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.careerCell}>
      <Text style={[styles.careerValue, accent && styles.careerValueAccent]}>
        {value}
      </Text>
      <Text style={styles.careerLabel}>{label}</Text>
    </View>
  );
}

function medalEmoji(rank: number | null): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return '';
}

// ── Sync status row ───────────────────────────────────────────────────────

function SyncStatusRow({
  syncing,
  progress,
  onSync,
}: {
  syncing: boolean;
  progress: { done: number; total: number } | null;
  onSync?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (syncing) {
    const total = progress?.total ?? 0;
    const done = progress?.done ?? 0;
    const label = total > 0
      ? `Syncing tournaments… ${done} of ${total}`
      : 'Syncing tournaments…';
    return (
      <View style={styles.syncRow}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.syncRowText}>{label}</Text>
      </View>
    );
  }
  // Idle: render the explicit "Sync now" button only when a handler is wired.
  if (!onSync) return null;
  return (
    <TouchableOpacity
      style={styles.syncRow}
      onPress={onSync}
      activeOpacity={0.6}
    >
      <Text style={styles.syncRowIcon}>↻</Text>
      <Text style={styles.syncRowText}>Sync season data</Text>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  hero: {
    backgroundColor: colors.primary,
    padding: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  heroKicker: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  heroTitle: {
    color: colors.textOnPrimary,
    fontSize: fontSize.xxl,
    fontWeight: '800',
  },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl },

  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.primaryLight,
    borderRadius: borderRadius.md,
    alignSelf: 'flex-start',
  },
  syncRowIcon: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: '800',
    marginRight: spacing.sm,
  },
  syncRowText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginLeft: spacing.sm,
  },

  discoveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.primaryLight,
    borderRadius: borderRadius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  discoveryRowTitle: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  discoveryRowSub: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginTop: 2,
  },

  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.primaryLight,
    borderRadius: borderRadius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.success,
  },
  resultIcon: {
    color: colors.success,
    fontSize: fontSize.lg,
    fontWeight: '800',
    marginRight: spacing.sm,
  },
  resultMain: { flex: 1 },
  resultText: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: 18,
  },
  resultDismiss: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginLeft: spacing.sm,
  },
  resultDismissText: {
    color: colors.textLight,
    fontSize: fontSize.md,
    fontWeight: '700',
  },

  section: { marginBottom: spacing.lg },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textLight,
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  sectionHint: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },

  emptyCard: { alignItems: 'flex-start' },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  emptyBody: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },

  teamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  teamCardCompact: { paddingVertical: spacing.sm },
  teamCardTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  teamCardTitleCompact: { fontSize: fontSize.sm, fontWeight: '600' },
  teamCardMeta: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  teamCardWarn: {
    fontSize: fontSize.xs,
    color: colors.warning,
    marginTop: 2,
    fontStyle: 'italic',
  },
  teamCardArrow: {
    color: colors.textLight,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },

  addTeamBtn: {
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  addTeamBtnText: {
    color: colors.textOnPrimary,
    fontWeight: '700',
    fontSize: fontSize.md,
  },

  sourceBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    minWidth: 36,
    alignItems: 'center',
  },
  sourceBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  connectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  connectionIcon: { fontSize: 22 },
  connectionTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  connectionSubtitle: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  connectionStatus: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  connectionStatusOn: { backgroundColor: colors.primaryLight },
  connectionStatusOff: { backgroundColor: colors.primary },
  connectionStatusText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  connectionStatusTextOn: { color: colors.primary },
  connectionStatusTextOff: { color: '#fff' },

  careerCard: { marginTop: spacing.xs },
  careerKicker: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textLight,
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  careerLoading: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  careerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  careerCell: { flexBasis: '47%', flexGrow: 1 },
  careerValue: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  careerValueAccent: { color: colors.primary },
  careerLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },

  browseLink: {
    alignSelf: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  browseLinkText: {
    color: colors.textLight,
    fontSize: fontSize.sm,
    textDecorationLine: 'underline',
  },
});
}
