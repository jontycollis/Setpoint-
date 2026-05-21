// ── MyHomeScreen ──────────────────────────────────────────────────────────
//
// The user's landing page. The app boots here and the team-context Home
// button comes back here.
//
// Layout, top-to-bottom:
//   - Slim status / sync row (sync banner / discovery banners only when
//     active — no tall blue hero anymore; the lead card carries the
//     orientation job)
//   - "Right Now" lead card (single primary card that infers the user's
//     current focus from data — see RightNowCard for the priority order)
//   - Quieter supporting cast: Recently-viewed strip → MY TEAMS list →
//     WATCHING list → Career totals card
//
// Connections (OVA MRS / CAC Locker) are no longer rendered here —
// reachable from the hamburger's Connections & settings group. They were
// promoted as a third large section before; for the role-agnostic Home
// they're a quiet utility, not the headline.
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
import type { Match } from '../types/match';
import { loadMatches } from '../utils/scoredMatchStore';
import { aggregateSeasonStats } from '../utils/statAggregator';

// ── Right Now state model ─────────────────────────────────────────────────
//
// First-match-wins priority order. Each branch returns the data needed by
// the lead card; the renderer just picks layout based on `kind`.
type RightNowState =
  | {
      kind: 'live-match';
      match: Match;
      /** "Court 5 · Set 2 · 18-15" derived from match state. */
      headline: string;
      subhead: string;
    }
  | {
      kind: 'today';
      tournament: UnifiedTournamentEntry;
      todaysMatchCount: number;
    }
  | {
      kind: 'this-week';
      tournament: UnifiedTournamentEntry;
      daysUntil: number;
    }
  | {
      kind: 'has-teams-no-events';
    }
  | {
      kind: 'no-teams';
    };

interface Props {
  profile: UserProfile;
  /** Tap a team card → enter that team's context. */
  onOpenTeam: (team: TeamProfile) => void;
  /** Tap "+ Add team" CTA. */
  onAddTeam: () => void;
  /**
   * Direct path to OVA Rankings as the primary discovery surface for
   * users with zero teams. When set, the no-teams empty state's
   * primary CTA routes here instead of through AddTeamChooser. R3
   * restructure: OVA Rankings drives most team discovery.
   * Optional — when undefined, falls back to onAddTeam.
   */
  onFindInOvaRankings?: () => void;
  /** Browse tournaments — used by lead-card secondary CTA and as a
   *  fallback when no team has any upcoming event. */
  onBrowseTournaments?: () => void;
  /** Open the Tier 2 / Score-a-match flow (gated on scorerMode at the
   *  caller). When undefined the secondary CTA hides. */
  onScoreAMatch?: () => void;
  /** Resume a live in-progress scored match. Caller routes to MatchScoring. */
  onResumeMatch?: (match: Match) => void;
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
  /** Tap the per-team "Analytics" chip → opens that team's analytics
   *  dashboard. Optional; the chip hides when undefined. Wired only on
   *  `kind: 'me'` cards (Watching teams have no team-scoped analytics). */
  onOpenAnalytics?: (team: TeamProfile) => void;
}

export function MyHomeScreen({
  profile,
  onOpenTeam,
  onAddTeam,
  onFindInOvaRankings,
  onBrowseTournaments,
  onScoreAMatch,
  onResumeMatch,
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
  onOpenAnalytics,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const meTeams = profile.teams.filter((t) => t.kind === 'me');
  const watchingTeams = profile.teams.filter((t) => t.kind === 'watching');

  // ── Indices + scored matches ───────────────────────────────────────────
  // Both feed the Right Now inference. We re-load scored matches on a
  // 30s tick so an in-progress match that just ticked over the freshness
  // window flips off (or a freshly-started one flips on) without the
  // user pulling-to-refresh.
  const [indices, setIndices] = useState<LoadedIndices | null>(null);
  const [scoredMatches, setScoredMatches] = useState<Match[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

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

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const ms = await loadMatches();
        if (!cancelled) setScoredMatches(ms);
      } catch {
        if (!cancelled) setScoredMatches([]);
      }
    };
    refresh();
    const tick = setInterval(() => {
      setNow(Date.now());
      refresh();
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, []);

  // ── Per-team upcoming tournament map (used by team cards' next-line) ──
  const upcomingByTeamId = useMemo(() => {
    const out = new Map<string, UnifiedTournamentEntry | null>();
    if (!indices) return out;
    for (const team of profile.teams) {
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

  // ── Right Now state inference ─────────────────────────────────────────
  const rightNow = useMemo<RightNowState>(
    () => inferRightNow(profile, indices, scoredMatches, now),
    [profile, indices, scoredMatches, now]
  );

  const recents = useRecentlyViewed(5);

  return (
    <View style={styles.container}>
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

        <RightNowCard
          state={rightNow}
          displayName={profile.displayName}
          onOpenTeam={onOpenTeam}
          onResumeMatch={onResumeMatch}
          onAddTeam={onAddTeam}
          onFindInOvaRankings={onFindInOvaRankings}
          onBrowseTournaments={onBrowseTournaments}
          onScoreAMatch={onScoreAMatch}
          scorerMode={profile.scorerMode === true}
          profile={profile}
        />

        {recents.length > 0 && onOpenRecent ? (
          <RecentlyViewedStrip recents={recents} onOpen={onOpenRecent} />
        ) : null}

        {meTeams.length > 0 ? (
          <MyTeamsSection
            teams={meTeams}
            upcomingByTeamId={upcomingByTeamId}
            indicesLoaded={indices != null}
            onOpenTeam={onOpenTeam}
            onAddTeam={onAddTeam}
            onLongPressTeam={onLongPressTeam}
            onOpenAnalytics={onOpenAnalytics}
          />
        ) : (
          // No me-teams yet — still surface the "+ Add team" affordance
          // here as a quiet secondary so the lead card stays the headline.
          <AddTeamRow onAddTeam={onAddTeam} />
        )}

        <WatchingSection
          teams={watchingTeams}
          upcomingByTeamId={upcomingByTeamId}
          indicesLoaded={indices != null}
          onOpenTeam={onOpenTeam}
          onLongPressTeam={onLongPressTeam}
        />

        {meTeams.length > 0 ? <CareerCard profile={profile} /> : null}
        {meTeams.length > 0 && onOpenAnalytics ? (
          <LiveScoringStrip
            profile={profile}
            onOpen={(team) => onOpenAnalytics(team)}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

// ── Right Now inference ───────────────────────────────────────────────────

const LIVE_MATCH_FRESHNESS_MS = 30 * 60 * 1000; // 30 min

function inferRightNow(
  profile: UserProfile,
  indices: LoadedIndices | null,
  scoredMatches: Match[] | null,
  now: number
): RightNowState {
  // 1) Live match in progress — any in-progress scored match whose last
  //    event timestamp is within the freshness window. If multiple, pick
  //    the most recently-active one (tightest "really happening now" signal).
  if (scoredMatches && scoredMatches.length > 0) {
    const live = scoredMatches
      .filter((m) => m.status === 'in-progress')
      .map((m) => {
        const lastEventTs =
          m.events.length > 0
            ? m.events[m.events.length - 1].ts
            : m.updatedAt;
        return { match: m, lastEventTs };
      })
      .filter((x) => now - x.lastEventTs < LIVE_MATCH_FRESHNESS_MS)
      .sort((a, b) => b.lastEventTs - a.lastEventTs);
    if (live.length > 0) {
      const m = live[0].match;
      const headline = liveMatchHeadline(m);
      const subhead = liveMatchSubhead(m);
      return { kind: 'live-match', match: m, headline, subhead };
    }
  }

  // Build a per-team aliased list for upcoming/active lookups.
  const followedTeams = profile.teams.filter((t) => t.kind === 'me' || t.kind === 'watching');
  if (followedTeams.length === 0) return { kind: 'no-teams' };

  // Without indices we can't tell what's active or upcoming — fall back
  // to the "has teams" copy until indices land.
  if (!indices) return { kind: 'has-teams-no-events' };

  // 2) Active tournament happening today — any followed team's tournament
  //    where today is within [start, end]. We approximate by treating each
  //    indexed entry with `dateMs` as a single-day event unless its name /
  //    snapshot includes multi-day metadata. Most tournaments span a
  //    weekend; we extend the active window to ±2 days around dateMs to
  //    cover the typical Sat-Sun shape without needing a full end-date.
  //    Multiple candidates → pick the one with the most matches today,
  //    breaking ties by earliest dateMs.
  const todayStart = startOfDay(now);
  const todayEnd = todayStart + 24 * 60 * 60 * 1000;
  type Candidate = {
    tournament: UnifiedTournamentEntry;
    matchesToday: number;
  };
  const todayCandidates: Candidate[] = [];
  const upcomingCandidates: { tournament: UnifiedTournamentEntry; daysUntil: number }[] = [];

  // Mon-Sun bracket of today (week ends Sunday inclusive).
  const weekEnd = startOfWeekEnd(now);

  for (const team of followedTeams) {
    const aliases = team.aliases.length ? team.aliases : [team.label];
    // One history pass per team — derive both "today" and "this week"
    // candidates from the same list so we don't pay the matcher cost
    // twice. (The earlier draft also called getUpcomingTournaments,
    // which itself calls buildMySeasonHistory — double work for the
    // same answer.)
    const history = buildMySeasonHistory(indices, aliases);
    for (const entry of history) {
      if (entry.dateMs == null) continue;
      const start = startOfDay(entry.dateMs);
      // Treat each indexed entry as covering its nominal date plus the
      // two days that follow — most tournaments span Sat-Sun-(Mon),
      // and the snapshot's `dateMs` is typically the first day. This
      // means a Saturday tournament is still "TODAY" on Sunday and
      // Monday morning without us needing an explicit endDate field.
      const end = start + 3 * 24 * 60 * 60 * 1000;
      if (todayStart < end && todayEnd > start) {
        // Active today. We don't have per-match scheduled dates that
        // are reliably stamped, so the count below is an approximation
        // of "matches the user might watch today" rather than a
        // calendar filter.
        const matchesToday = entry.matches.length;
        todayCandidates.push({ tournament: entry, matchesToday });
      } else if (entry.dateMs > now && entry.dateMs <= weekEnd) {
        const days = Math.max(0, Math.ceil((entry.dateMs - now) / 86_400_000));
        upcomingCandidates.push({ tournament: entry, daysUntil: days });
      }
    }
  }

  if (todayCandidates.length > 0) {
    todayCandidates.sort((a, b) => {
      if (b.matchesToday !== a.matchesToday) return b.matchesToday - a.matchesToday;
      return (a.tournament.dateMs ?? 0) - (b.tournament.dateMs ?? 0);
    });
    const top = todayCandidates[0];
    return {
      kind: 'today',
      tournament: top.tournament,
      todaysMatchCount: top.matchesToday,
    };
  }

  if (upcomingCandidates.length > 0) {
    upcomingCandidates.sort((a, b) => a.daysUntil - b.daysUntil);
    const top = upcomingCandidates[0];
    return {
      kind: 'this-week',
      tournament: top.tournament,
      daysUntil: top.daysUntil,
    };
  }

  return { kind: 'has-teams-no-events' };
}

function liveMatchHeadline(m: Match): string {
  const court = m.meta.courtName ? `${m.meta.courtName}` : 'Live match';
  // Compute the current set + score from setHistory + final scores would
  // require deriveMatchState. Cheaper proxy: look at point events for
  // the current set. The exact score isn't critical — the call to action
  // is "open the scoring console", not "decide based on the score".
  const points = m.events.filter(
    (e): e is Extract<typeof e, { type: 'point' }> => e.type === 'point'
  );
  if (points.length === 0) return `${court} · Live`;
  // Last point's setIndex tells us which set we're in.
  const lastSet = points[points.length - 1].setIndex;
  const setLabel = `Set ${lastSet + 1}`;
  let home = 0;
  let away = 0;
  for (const p of points) {
    if (p.setIndex !== lastSet) continue;
    if (p.scoringTeam === 'home') home++;
    else away++;
  }
  return `${court} · ${setLabel} · ${home}-${away}`;
}

function liveMatchSubhead(m: Match): string {
  const home = m.meta.home.label;
  const away = m.meta.away.label;
  if (home && away) return `${home} vs ${away}`;
  return m.meta.matchLabel || 'Match in progress';
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** End of the current week (Sunday 23:59:59.999 ms). Mon-Sun bracket. */
function startOfWeekEnd(ms: number): number {
  const d = new Date(ms);
  d.setHours(23, 59, 59, 999);
  // JS day-of-week: 0=Sun, 1=Mon, ..., 6=Sat. We want to land on this
  // week's Sunday; if today IS Sunday, that's today.
  const dayOfWeek = d.getDay();
  const daysToSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  d.setDate(d.getDate() + daysToSunday);
  return d.getTime();
}

// ── Right Now lead card ──────────────────────────────────────────────────

function RightNowCard({
  state,
  displayName,
  onOpenTeam,
  onResumeMatch,
  onAddTeam,
  onFindInOvaRankings,
  onBrowseTournaments,
  onScoreAMatch,
  scorerMode,
  profile,
}: {
  state: RightNowState;
  displayName?: string;
  onOpenTeam: (team: TeamProfile) => void;
  onResumeMatch?: (match: Match) => void;
  onAddTeam: () => void;
  onFindInOvaRankings?: () => void;
  onBrowseTournaments?: () => void;
  onScoreAMatch?: () => void;
  scorerMode: boolean;
  profile: UserProfile;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const kicker = kickerFor(state);
  const kickerColor = kickerColorFor(state);
  const { headline, subhead, primary, secondary } = renderableFor(state, {
    displayName,
    onOpenTeam,
    onResumeMatch,
    onAddTeam,
    onFindInOvaRankings,
    onBrowseTournaments,
    onScoreAMatch,
    scorerMode,
    profile,
  });

  return (
    <View
      style={[
        styles.leadCard,
        {
          backgroundColor: colors.primary,
        },
      ]}
    >
      <Text style={[styles.leadKicker, { color: kickerColor }]}>{kicker}</Text>
      <Text style={styles.leadHeadline} numberOfLines={2}>
        {headline}
      </Text>
      {subhead ? (
        <Text style={styles.leadSubhead} numberOfLines={2}>
          {subhead}
        </Text>
      ) : null}
      <View style={styles.leadCtaRow}>
        {secondary ? (
          <TouchableOpacity
            style={styles.leadCtaSecondary}
            onPress={secondary.onPress}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={secondary.label}
          >
            <Text style={styles.leadCtaSecondaryText}>{secondary.label}</Text>
          </TouchableOpacity>
        ) : (
          <View />
        )}
        {primary ? (
          <TouchableOpacity
            style={[styles.leadCtaPrimary, { backgroundColor: '#fff' }]}
            onPress={primary.onPress}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={primary.label}
          >
            <Text style={[styles.leadCtaPrimaryText, { color: colors.primary }]}>
              {primary.label}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function kickerFor(state: RightNowState): string {
  switch (state.kind) {
    case 'live-match':
      return 'LIVE NOW';
    case 'today':
      return 'TODAY';
    case 'this-week':
      return 'THIS WEEK';
    case 'has-teams-no-events':
      return 'WELCOME BACK';
    case 'no-teams':
      return 'GET STARTED';
  }
}

function kickerColorFor(state: RightNowState): string {
  if (state.kind === 'live-match') return '#ffd54f';
  return 'rgba(255,255,255,0.85)';
}

interface RenderableArgs {
  displayName?: string;
  onOpenTeam: (team: TeamProfile) => void;
  onResumeMatch?: (match: Match) => void;
  onAddTeam: () => void;
  onFindInOvaRankings?: () => void;
  onBrowseTournaments?: () => void;
  onScoreAMatch?: () => void;
  scorerMode: boolean;
  profile: UserProfile;
}

interface Renderable {
  headline: string;
  subhead: string | null;
  primary: { label: string; onPress: () => void } | null;
  secondary: { label: string; onPress: () => void } | null;
}

function renderableFor(state: RightNowState, args: RenderableArgs): Renderable {
  switch (state.kind) {
    case 'live-match': {
      return {
        headline: state.headline,
        subhead: state.subhead,
        primary: args.onResumeMatch
          ? { label: 'Open scoring', onPress: () => args.onResumeMatch!(state.match) }
          : null,
        secondary: null,
      };
    }
    case 'today': {
      const t = state.tournament;
      const headline = t.tournamentName;
      const todayStr = formatDayLabel(Date.now());
      const subParts = [todayStr];
      if (state.todaysMatchCount > 0) {
        subParts.push(
          `${state.todaysMatchCount} match${state.todaysMatchCount === 1 ? '' : 'es'}`
        );
      }
      if (t.venueName) subParts.push(t.venueName);
      return {
        headline,
        subhead: subParts.join(' · '),
        primary: {
          label: 'Open tournament',
          onPress: () => openTournamentEntry(t, args),
        },
        secondary: null,
      };
    }
    case 'this-week': {
      const t = state.tournament;
      const startsIn =
        state.daysUntil <= 0
          ? 'Starting soon'
          : state.daysUntil === 1
          ? 'Starts tomorrow'
          : `Starts in ${state.daysUntil} days`;
      const subParts = [startsIn];
      if (t.venueName) subParts.push(t.venueName);
      return {
        headline: t.tournamentName,
        subhead: subParts.join(' · '),
        primary: {
          label: 'Open tournament',
          onPress: () => openTournamentEntry(t, args),
        },
        secondary: null,
      };
    }
    case 'has-teams-no-events': {
      const greet = args.displayName
        ? `Welcome back, ${args.displayName}`
        : 'Welcome back';
      return {
        headline: greet,
        subhead: 'No tournaments scheduled this week.',
        primary: args.onBrowseTournaments
          ? { label: 'Browse tournaments', onPress: args.onBrowseTournaments }
          : null,
        secondary:
          args.scorerMode && args.onScoreAMatch
            ? { label: 'Score a match', onPress: args.onScoreAMatch }
            : null,
      };
    }
    case 'no-teams': {
      // R3: OVA Rankings is the primary discovery surface. Falls back to
      // AddTeamChooser when the OVA path isn't wired in (defensive).
      const primary = args.onFindInOvaRankings
        ? { label: 'Find my OVA team', onPress: args.onFindInOvaRankings }
        : { label: 'Add a team', onPress: args.onAddTeam };
      const secondary = args.onFindInOvaRankings
        ? { label: 'Add another way', onPress: args.onAddTeam }
        : args.onBrowseTournaments
        ? { label: 'Browse tournaments', onPress: args.onBrowseTournaments }
        : null;
      return {
        headline: 'Welcome to Bior',
        subhead: 'Pick your team from the OVA rankings to follow their tournaments, score matches, and track stats.',
        primary,
        secondary,
      };
    }
  }
}

/**
 * Route a Right Now tournament entry back to the right place. We try to
 * match the entry's source/key against the user's TeamProfile list so we
 * land on the team's dashboard for that tournament. If no profile matches
 * (rare — Right Now only surfaces entries that came from a followed
 * team), fall back to opening the user's first me-team.
 */
function openTournamentEntry(
  entry: UnifiedTournamentEntry,
  args: RenderableArgs
) {
  const teams = args.profile.teams;
  // Find the team profile this entry belongs to via alias overlap.
  const myTeamAsSeen = (entry.myTeamAsSeen || '').toLowerCase().trim();
  let team =
    teams.find((t) =>
      t.aliases.some((a) => a.toLowerCase().trim() === myTeamAsSeen)
    ) ?? null;
  if (!team) {
    team = teams.find((t) => t.kind === 'me') ?? teams[0] ?? null;
  }
  if (team) args.onOpenTeam(team);
}

function formatDayLabel(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
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
        Recently viewed
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
      accessibilityRole="button"
      accessibilityLabel={`${badgeLabel} ${isTournament ? 'tournament' : 'team'}: ${item.label}${item.subtitle ? `, ${item.subtitle}` : ''}`}
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
  onOpenAnalytics,
}: {
  teams: TeamProfile[];
  upcomingByTeamId: Map<string, UnifiedTournamentEntry | null>;
  indicesLoaded: boolean;
  onOpenTeam: (team: TeamProfile) => void;
  onAddTeam: () => void;
  onLongPressTeam?: (team: TeamProfile) => void;
  onOpenAnalytics?: (team: TeamProfile) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: colors.textLight }]}>
        My teams
      </Text>
      {teams.map((team) => (
        <TeamCard
          key={team.id}
          team={team}
          upcoming={upcomingByTeamId.get(team.id) ?? null}
          indicesLoaded={indicesLoaded}
          onOpen={() => onOpenTeam(team)}
          onLongPress={onLongPressTeam ? () => onLongPressTeam(team) : undefined}
          onOpenAnalytics={onOpenAnalytics ? () => onOpenAnalytics(team) : undefined}
          compact
        />
      ))}
      <TouchableOpacity
        style={[styles.addTeamLink]}
        onPress={onAddTeam}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel="Add a team"
      >
        <Text style={[styles.addTeamLinkText, { color: colors.primary }]}>
          + Add team
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function AddTeamRow({ onAddTeam }: { onAddTeam: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: colors.textLight }]}>
        My teams
      </Text>
      <TouchableOpacity
        style={[styles.addTeamLink]}
        onPress={onAddTeam}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel="Add a team"
      >
        <Text style={[styles.addTeamLinkText, { color: colors.primary }]}>
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
        Watching
      </Text>
      {teams.length === 0 ? (
        <View style={[styles.watchingEmpty, { borderColor: colors.divider }]}>
          <Text style={[styles.watchingEmptyText, { color: colors.textSecondary }]}>
            No teams you're watching. Browse tournaments and tap the star to follow a team.
          </Text>
        </View>
      ) : (
        teams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            upcoming={upcomingByTeamId.get(team.id) ?? null}
            indicesLoaded={indicesLoaded}
            onOpen={() => onOpenTeam(team)}
            onLongPress={onLongPressTeam ? () => onLongPressTeam(team) : undefined}
            compact
          />
        ))
      )}
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
  onOpenAnalytics,
  compact,
}: {
  team: TeamProfile;
  upcoming: UnifiedTournamentEntry | null;
  indicesLoaded: boolean;
  onOpen: () => void;
  onLongPress?: () => void;
  onOpenAnalytics?: () => void;
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
      accessibilityRole="button"
      accessibilityLabel={`Open ${team.label} (${sourceLabel})${meta ? `, ${meta}` : ''}`}
      accessibilityHint={onLongPress ? 'Long press for team options' : undefined}
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
      {onOpenAnalytics && !compact ? (
        <TouchableOpacity
          onPress={onOpenAnalytics}
          activeOpacity={0.6}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={[styles.analyticsChip, { borderColor: colors.primary }]}
        >
          <Text style={[styles.analyticsChipText, { color: colors.primary }]}>
            {'\u{1F4CA}'} Analytics
          </Text>
        </TouchableOpacity>
      ) : null}
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

// ── Live-scoring strip ────────────────────────────────────────────────────
//
// Compact summary below the Career card showing live-scored matches
// only. Reads `scored.matches.v1` and filters to the user's active
// team (or any 'me' team when there's no active selection). Hidden
// when there are no `source: 'tier2-live'` matches with
// `includeInStats: true` — the user just sees their Career card.

function LiveScoringStrip({
  profile,
  onOpen,
}: {
  profile: UserProfile;
  onOpen: (team: TeamProfile) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [stats, setStats] = useState<{
    matchCount: number;
    kills: number;
    topName: string | null;
    topScore: number;
    team: TeamProfile;
  } | null>(null);

  // Pick the team to scope by: active team if set, else the first
  // `kind: 'me'` team. The strip is hidden when the user has no me-teams,
  // so meTeams[0] always exists when this effect runs.
  const meTeams = useMemo(
    () => profile.teams.filter((t) => t.kind === 'me'),
    [profile.teams]
  );
  const scopedTeam = useMemo(() => {
    if (profile.activeTeamId) {
      const active = profile.teams.find((t) => t.id === profile.activeTeamId);
      if (active && active.kind === 'me') return active;
    }
    return meTeams[0] ?? null;
  }, [profile.activeTeamId, profile.teams, meTeams]);

  useEffect(() => {
    let cancelled = false;
    if (!scopedTeam) {
      setStats(null);
      return;
    }
    (async () => {
      try {
        const all = await loadMatches();
        if (cancelled) return;
        const liveScored = all.filter(
          (m: Match) =>
            (m.meta.home.teamProfileId === scopedTeam.id ||
              m.meta.away.teamProfileId === scopedTeam.id) &&
            (m.meta.source ?? 'tier2-live') === 'tier2-live' &&
            m.meta.includeInStats !== false
        );
        if (liveScored.length === 0) {
          setStats(null);
          return;
        }
        const summary = aggregateSeasonStats(liveScored, scopedTeam.id);
        const topPlayer = summary.players[0];
        setStats({
          matchCount: liveScored.length,
          kills: summary.totals.kills,
          topName: topPlayer && topPlayer.totalPoints > 0 ? topPlayer.name : null,
          topScore: topPlayer ? topPlayer.totalPoints : 0,
          team: scopedTeam,
        });
      } catch {
        if (!cancelled) setStats(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scopedTeam]);

  if (!stats) return null;

  return (
    <TouchableOpacity
      onPress={() => onOpen(stats.team)}
      activeOpacity={0.7}
      style={[styles.liveStrip, { borderColor: colors.divider, backgroundColor: colors.surface }]}
    >
      <View style={[styles.liveStripBadge, { backgroundColor: colors.primary }]}>
        <Text style={styles.liveStripBadgeText}>LIVE</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.liveStripTitle, { color: colors.text }]} numberOfLines={1}>
          Live scoring · {stats.team.label}
        </Text>
        <Text style={[styles.liveStripMeta, { color: colors.textSecondary }]} numberOfLines={1}>
          {stats.matchCount} match{stats.matchCount === 1 ? '' : 'es'} · {stats.kills} kills
          {stats.topName ? ` · top: ${stats.topName} (${stats.topScore})` : ''}
        </Text>
      </View>
      <Text style={[styles.liveStripArrow, { color: colors.textLight }]}>›</Text>
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
        {meCount > 1 ? 'Career totals' : 'Season totals'}
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
  body: { padding: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxxl },

  // ── Right Now lead card ────────────────────────────────────────────────
  leadCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    minHeight: 160,
    justifyContent: 'space-between',
  },
  leadKicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: spacing.xs,
  },
  leadHeadline: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: spacing.xs,
  },
  leadSubhead: {
    fontSize: fontSize.md,
    color: 'rgba(255,255,255,0.92)',
    marginBottom: spacing.md,
  },
  leadCtaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  leadCtaPrimary: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.full,
  },
  leadCtaPrimaryText: { fontWeight: '800', fontSize: fontSize.md },
  leadCtaSecondary: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  leadCtaSecondaryText: {
    color: 'rgba(255,255,255,0.92)',
    fontWeight: '700',
    fontSize: fontSize.sm,
  },

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

  section: { marginBottom: spacing.md },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  sectionHint: {
    fontSize: fontSize.xs,
    marginBottom: spacing.sm,
  },

  watchingEmpty: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    opacity: 0.6,
  },
  watchingEmptyText: {
    fontSize: fontSize.sm,
    lineHeight: 18,
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
  analyticsChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    marginRight: spacing.xs,
  },
  analyticsChipText: {
    fontSize: 11,
    fontWeight: '700',
  },

  addTeamLink: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: 'flex-start',
  },
  addTeamLinkText: {
    fontWeight: '700',
    fontSize: fontSize.sm,
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

  careerCard: { marginTop: spacing.xs },
  careerKicker: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
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

  liveStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  liveStripBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  liveStripBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  liveStripTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  liveStripMeta: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  liveStripArrow: {
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
});
}
