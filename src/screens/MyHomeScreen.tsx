// ── MyHomeScreen ──────────────────────────────────────────────────────────
//
// The user's landing page. The app boots here and the team-context Home
// button comes back here.
//
// Layout, top-to-bottom:
//   - Hero (optional display name + role kicker, generic fallback)
//   - "Recently viewed" horizontal strip (skipped when empty)
//   - "My Teams" section (TeamProfiles with kind === 'me')
//       Each team is a tappable card → enters that team's context.
//       Card carries a forward-looking "next tournament" line beneath the
//       meta — "No upcoming tournaments" placeholder when empty.
//       "+ Add team" CTA after the last me-team card.
//   - "Watching" section (kind === 'watching') — skipped if empty. Same
//     per-team "next tournament" treatment as My Teams.
//   - Connections section (OVA MRS + CAC Locker tiles).
//   - Career totals card (only when at least one me-team has indexed
//     tournaments matching its aliases).
//
// Note: the prior "Browse tournaments →" link was removed because Browse
// is now a bottom tab — the link became redundant.
// ────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { Card } from '../components/Card';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { UserProfile, TeamProfile } from '../types/profile';
import {
  buildMySeasonHistory,
  loadAllSeasonIndices,
  aggregateUnifiedStats,
  getNextUpcomingTournament,
  type LoadedIndices,
  type UnifiedAggregateStats,
  type UnifiedTournamentEntry,
} from '../utils/unifiedSeasonHistory';
import type { AutoDiscoverProgress } from '../utils/teamAutoDiscover';
import {
  DiscoveryProgressBanner,
  DiscoveryResultBanner,
} from '../components/DiscoveryBanners';
import {
  useRecentlyViewed,
  type RecentItem,
} from '../utils/recentlyViewed';

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
  /** Low-emphasis "Browse tournaments" entry. Optional now that Browse is
   *  a bottom tab — kept on the prop list for backwards compat with
   *  callers that still pass it. */
  onBrowseTournaments?: () => void;
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
  /** Long-press a team card → action sheet (Manage roster / Remove). */
  onLongPressTeam?: (team: TeamProfile) => void;
  /** Tap a recently-viewed entry — App routes by kind. */
  onOpenRecent?: (item: RecentItem) => void;
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
  onLongPressTeam,
  onOpenRecent,
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

  // ── Upcoming-tournament map ────────────────────────────────────────────
  // Read both indices once and compute the earliest future entry per team.
  // Reuses the existing `buildMySeasonHistory` adapter — no new fetchers.
  const [indices, setIndices] = useState<LoadedIndices | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadAllSeasonIndices();
        if (!cancelled) setIndices(loaded);
      } catch {
        /* ignore — strip just won't show anything */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const upcomingByTeamId = useMemo(() => {
    const out = new Map<string, UnifiedTournamentEntry | null>();
    if (!indices) return out;
    for (const team of profile.teams) {
      // Fall back to [team.label] when no aliases exist — same behaviour
      // as before. Strict matcher means even a slight spelling drift
      // between the alias and the indexed team-name will produce zero
      // matches; the DEV diagnostic in `getNextUpcomingTournament`
      // logs the gap so we can spot it without a debugger.
      const aliases = team.aliases.length ? team.aliases : [team.label];
      out.set(
        team.id,
        getNextUpcomingTournament(indices, aliases, {
          debugLabel: `MyHome team "${team.label}"`,
        })
      );
    }
    return out;
  }, [indices, profile.teams]);

  const recents = useRecentlyViewed(5);

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
        {recents.length > 0 && onOpenRecent ? (
          <RecentlyViewedStrip recents={recents} onOpen={onOpenRecent} />
        ) : null}

        <MyTeamsSection
          teams={meTeams}
          upcomingByTeamId={upcomingByTeamId}
          indicesLoaded={indices != null}
          onOpenTeam={onOpenTeam}
          onAddTeam={onAddTeam}
          onLongPressTeam={onLongPressTeam}
        />

        {watchingTeams.length > 0 ? (
          <WatchingSection
            teams={watchingTeams}
            upcomingByTeamId={upcomingByTeamId}
            indicesLoaded={indices != null}
            onOpenTeam={onOpenTeam}
            onLongPressTeam={onLongPressTeam}
          />
        ) : null}

        <ConnectionsSection
          mrsLinked={profile.mrsLinked}
          cacLinked={profile.cacLinked}
          onOpenMrsConnection={onOpenMrsConnection}
          onOpenCacConnection={onOpenCacConnection}
        />

        {meTeams.length > 0 ? <CareerCard profile={profile} /> : null}
      </ScrollView>
    </View>
  );
}

// ── Recently viewed ───────────────────────────────────────────────────────

function RecentlyViewedStrip({
  recents,
  onOpen,
}: {
  recents: RecentItem[];
  onOpen: (item: RecentItem) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: colors.textLight }]}>
        RECENTLY VIEWED
      </Text>
      <FlatList
        horizontal
        data={recents}
        keyExtractor={recentKey}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingVertical: 2 }}
        ItemSeparatorComponent={() => <View style={{ width: spacing.sm }} />}
        renderItem={({ item }) => (
          <RecentChip item={item} onPress={() => onOpen(item)} />
        )}
      />
    </View>
  );
}

function recentKey(item: RecentItem): string {
  if (item.kind === 'team-aes') {
    return `${item.kind}:${item.eventKey}:${item.divisionId}:${item.teamId}`;
  }
  if (item.kind === 'team-timu') {
    return `${item.kind}:${item.tid}:${item.teamName}`;
  }
  if (item.kind === 'tournament-aes') {
    return `${item.kind}:${item.eventKey}`;
  }
  return `${item.kind}:${item.tid}`;
}

function RecentChip({
  item,
  onPress,
}: {
  item: RecentItem;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isTimu = item.kind === 'team-timu' || item.kind === 'tournament-timu';
  const isTournament =
    item.kind === 'tournament-aes' || item.kind === 'tournament-timu';
  const badgeColor = isTimu ? colors.accent : colors.primary;
  const badgeLabel = isTournament ? 'TOUR' : isTimu ? 'TIMU' : 'AES';
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.recentChip,
        {
          backgroundColor: colors.surface,
          borderColor: colors.divider,
        },
      ]}
    >
      <View style={[styles.recentBadge, { backgroundColor: badgeColor }]}>
        <Text style={styles.recentBadgeText}>{badgeLabel}</Text>
      </View>
      <Text
        style={[styles.recentLabel, { color: colors.text }]}
        numberOfLines={1}
      >
        {item.label}
      </Text>
      {item.subtitle ? (
        <Text
          style={[styles.recentSubtitle, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {item.subtitle}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

// ── My Teams ──────────────────────────────────────────────────────────────

function MyTeamsSection({
  teams,
  upcomingByTeamId,
  indicesLoaded,
  onOpenTeam,
  onAddTeam,
  onLongPressTeam,
}: {
  teams: TeamProfile[];
  upcomingByTeamId: Map<string, UnifiedTournamentEntry | null>;
  indicesLoaded: boolean;
  onOpenTeam: (team: TeamProfile) => void;
  onAddTeam: () => void;
  onLongPressTeam?: (team: TeamProfile) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: colors.textLight }]}>
        MY TEAMS
      </Text>
      {teams.length === 0 ? (
        <Card variant="outlined" style={styles.emptyCard}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            No teams yet
          </Text>
          <Text
            style={[styles.emptyBody, { color: colors.textSecondary }]}
          >
            Find a tournament you're playing in and add the team you (or
            your child) play for. Past tournaments build career history.
          </Text>
        </Card>
      ) : (
        teams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            upcoming={upcomingByTeamId.get(team.id) ?? null}
            indicesLoaded={indicesLoaded}
            onOpen={() => onOpenTeam(team)}
            onLongPress={onLongPressTeam ? () => onLongPressTeam(team) : undefined}
          />
        ))
      )}
      <TouchableOpacity
        style={[styles.addTeamBtn, { backgroundColor: colors.primary }]}
        onPress={onAddTeam}
        activeOpacity={0.7}
      >
        <Text style={[styles.addTeamBtnText, { color: colors.textOnPrimary }]}>
          + Add team
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Watching ──────────────────────────────────────────────────────────────

function WatchingSection({
  teams,
  upcomingByTeamId,
  indicesLoaded,
  onOpenTeam,
  onLongPressTeam,
}: {
  teams: TeamProfile[];
  upcomingByTeamId: Map<string, UnifiedTournamentEntry | null>;
  indicesLoaded: boolean;
  onOpenTeam: (team: TeamProfile) => void;
  onLongPressTeam?: (team: TeamProfile) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: colors.textLight }]}>
        WATCHING
      </Text>
      <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>
        Teams you're tracking inside a tournament. Doesn't count toward
        your Career rollup.
      </Text>
      {teams.map((team) => (
        <TeamCard
          key={team.id}
          team={team}
          upcoming={upcomingByTeamId.get(team.id) ?? null}
          indicesLoaded={indicesLoaded}
          onOpen={() => onOpenTeam(team)}
          onLongPress={onLongPressTeam ? () => onLongPressTeam(team) : undefined}
          compact
        />
      ))}
    </View>
  );
}

// ── Team card ─────────────────────────────────────────────────────────────

function TeamCard({
  team,
  upcoming,
  indicesLoaded,
  onOpen,
  onLongPress,
  compact,
}: {
  team: TeamProfile;
  upcoming: UnifiedTournamentEntry | null;
  /** Have we attempted to read indices yet? Guards the empty placeholder. */
  indicesLoaded: boolean;
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
      style={[
        styles.teamCard,
        compact && styles.teamCardCompact,
        {
          backgroundColor: colors.surface,
          borderColor: colors.divider,
        },
      ]}
    >
      <View style={[styles.sourceBadge, { backgroundColor: sourceColor }]}>
        <Text style={styles.sourceBadgeText}>{sourceLabel}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.teamCardTitle,
            compact && styles.teamCardTitleCompact,
            { color: colors.text },
          ]}
          numberOfLines={1}
        >
          {team.label}
        </Text>
        {meta ? (
          <Text
            style={[styles.teamCardMeta, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {meta}
          </Text>
        ) : null}
        {!team.primaryRef ? (
          <Text style={[styles.teamCardWarn, { color: colors.warning }]}>
            No tournament linked yet — open to add one
          </Text>
        ) : indicesLoaded ? (
          <UpcomingLine entry={upcoming} />
        ) : null}
      </View>
      <Text style={[styles.teamCardArrow, { color: colors.textLight }]}>
        ›
      </Text>
    </TouchableOpacity>
  );
}

function UpcomingLine({ entry }: { entry: UnifiedTournamentEntry | null }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!entry) {
    return (
      <Text
        style={[
          styles.upcomingPlaceholder,
          { color: colors.textLight },
        ]}
        numberOfLines={1}
      >
        No upcoming tournaments
      </Text>
    );
  }
  const days = daysUntil(entry.dateMs);
  const trailing = [
    days != null
      ? days <= 0
        ? 'Today'
        : days === 1
        ? 'Tomorrow'
        : `in ${days}d`
      : null,
    entry.venueName,
    entry.dateText,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Text
      style={[styles.upcomingLine, { color: colors.primary }]}
      numberOfLines={1}
    >
      <Text style={{ fontWeight: '700' }}>{'\u{1F4C5} '}{entry.tournamentName}</Text>
      {trailing ? <Text style={{ fontWeight: '500' }}> · {trailing}</Text> : null}
    </Text>
  );
}

function daysUntil(dateMs?: number): number | null {
  if (dateMs == null) return null;
  const ms = dateMs - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
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
      <Text style={[styles.sectionLabel, { color: colors.textLight }]}>
        CONNECTIONS
      </Text>
      <Text style={[styles.sectionHint, { color: colors.textSecondary }]}>
        Sign in to OVA and CAC inside Setpoint to view your data without
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
      style={[
        styles.connectionRow,
        {
          backgroundColor: colors.surface,
          borderColor: colors.divider,
        },
      ]}
    >
      <Text style={styles.connectionIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.connectionTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <Text
          style={[styles.connectionSubtitle, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      </View>
      <View
        style={[
          styles.connectionStatus,
          connected
            ? { backgroundColor: colors.primaryLight }
            : { backgroundColor: colors.primary },
        ]}
      >
        <Text
          style={[
            styles.connectionStatusText,
            connected
              ? { color: colors.primary }
              : { color: '#fff' },
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
      <Text style={[styles.careerKicker, { color: colors.textLight }]}>
        {meCount > 1 ? 'CAREER TOTALS' : 'SEASON TOTALS'}
      </Text>
      {loading ? (
        <Text style={[styles.careerLoading, { color: colors.textSecondary }]}>
          Loading…
        </Text>
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
        <Text style={[styles.careerLoading, { color: colors.textSecondary }]}>
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
      <Text
        style={[
          styles.careerValue,
          { color: accent ? colors.primary : colors.text },
        ]}
      >
        {value}
      </Text>
      <Text style={[styles.careerLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
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
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  sectionHint: {
    fontSize: fontSize.xs,
    marginBottom: spacing.sm,
  },

  emptyCard: { alignItems: 'flex-start' },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  emptyBody: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },

  teamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
  },
  teamCardCompact: { paddingVertical: spacing.sm },
  teamCardTitle: { fontSize: fontSize.md, fontWeight: '700' },
  teamCardTitleCompact: { fontSize: fontSize.sm, fontWeight: '600' },
  teamCardMeta: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  teamCardWarn: {
    fontSize: fontSize.xs,
    marginTop: 2,
    fontStyle: 'italic',
  },
  upcomingLine: {
    fontSize: fontSize.xs,
    marginTop: 4,
  },
  upcomingPlaceholder: {
    fontSize: fontSize.xs,
    marginTop: 4,
    fontStyle: 'italic',
  },
  teamCardArrow: {
    fontSize: fontSize.lg,
    fontWeight: '600',
  },

  addTeamBtn: {
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  addTeamBtnText: {
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

  // Recently viewed strip
  recentChip: {
    width: 160,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
  },
  recentBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: borderRadius.sm,
    marginBottom: 4,
  },
  recentBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  recentLabel: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  recentSubtitle: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },

  connectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
  },
  connectionIcon: { fontSize: 22 },
  connectionTitle: { fontSize: fontSize.md, fontWeight: '700' },
  connectionSubtitle: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  connectionStatus: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  connectionStatusText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  careerCard: { marginTop: spacing.xs },
  careerKicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  careerLoading: {
    fontSize: fontSize.sm,
    fontStyle: 'italic',
  },
  careerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  careerCell: { flexBasis: '47%', flexGrow: 1 },
  careerValue: { fontSize: fontSize.lg, fontWeight: '800' },
  careerLabel: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
});
}
