import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Animated,
  AppState,
  Share,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import { BracketPredictions } from '../components/BracketPredictions';
import {
  getTeamAssignments,
  getPlays,
  getPlayDays,
  getCourtSchedule,
  getUtilizedDates,
  flattenCourtSchedule,
  filterMatchesForTeam,
  getAllDivisionMatchResults,
  getTeamCurrentSchedule,
  getTeamPastSchedule,
  extractAllScheduleMatches,
  getStandings,
} from '../api/aesClient';
import type {
  FlatCourtMatch,
  PoolTeam,
  MatchResult,
  EnrichedScheduleMatch,
} from '../api/aesClient';
import { Card } from '../components/Card';
import { NextDayScenarios } from '../components/NextDayScenarios';
import { ShareCard } from '../components/ShareCard';
import { LiveMatchTracker } from '../components/LiveMatchTracker';
import { PoolStandings } from '../components/PoolStandings';
import { MatchScoresModal } from '../components/MatchScoresModal';
import { WatchLiveButton } from '../components/WatchLiveButton';
import { loadCourtStreams, CourtStreamMap } from '../utils/storage';
// Note: the legacy `addTournamentHistoryEntry` write that used to live
// in this screen has been removed. CrossTournamentScreen now reads from
// the unified AES + Timu indices (`buildMySeasonHistory`), which the
// dashboard already populates via `indexAesSnapshot` on refresh, so the
// duplicate write is no longer needed. The legacy `tournamentHistory`
// store key is retained in storage.ts but is read-only / dead.
import { scheduleAllMatchNotifications } from '../utils/notifications';
import type { MatchNotification } from '../utils/notifications';
import { formatTime, formatDate, getRelativeTime } from '../utils/dates';
import type { AESEvent, AESDivision, AESTeamAssignment } from '../types/aes';
import { ensureAesIndexed, indexAesSnapshot, loadAesSeasonIndex, aesSnapshotKey } from '../utils/aesSeasonIndex';
import { addMyTeamAlias } from '../utils/seasonTeamIdentity';
import { UpcomingTournamentsSection } from '../components/UpcomingTournamentsSection';
import type { UnifiedTournamentEntry } from '../utils/unifiedSeasonHistory';

interface Props {
  event: AESEvent;
  division: AESDivision;
  team: AESTeamAssignment;
  onBack: () => void;
  onViewStandings: () => void;
  onViewCourtSchedule: () => void;
  onViewBrackets: (playId?: number) => void;
  onScoutOpponent: (opponentTeamId: number, opponentName: string) => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  isMyTeam: boolean;
  onSetAsMyTeam: () => void;
  onClearMyTeam: () => void;
  /** Open the cross-source Timu+AES season history for the given team. */
  onViewSeasonHistory?: (teamName: string) => void;
  // ── Follow toggle (single-pill replacement for ★/+Season/My Team) ────
  /** How many TeamProfile.kind === 'me' teams the user already has. Used
   *  to decide whether a fresh follow auto-promotes to primary (only
   *  when zero — otherwise the team starts as 'watching'). */
  meTeamCount?: number;
  /** Open the per-team roster editor for the matching TeamProfile.
   *  Surfaced in the Following action sheet only when this team is the
   *  user's primary me-team. Optional — when omitted, the row hides. */
  onManageRoster?: () => void;
  /** Tap on an "Upcoming Tournaments" card → caller routes to that
   *  tournament's TeamDashboard (AES or Timu, depending on the entry's
   *  source). When omitted the cards stay non-interactive. */
  onOpenUpcomingTournament?: (entry: UnifiedTournamentEntry) => void;
}

export function TeamDashboardScreen({
  event,
  division,
  team,
  onBack,
  onViewStandings,
  onViewCourtSchedule,
  onViewBrackets,
  onScoutOpponent,
  isFavorite,
  onToggleFavorite,
  isMyTeam,
  onSetAsMyTeam,
  onClearMyTeam,
  onViewSeasonHistory,
  meTeamCount = 0,
  onManageRoster,
  onOpenUpcomingTournament,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Each pool the team belongs to (Day 1 pools, Day 2 power pools, etc.)
  interface PoolEntry {
    poolRecord: PoolTeam;
    shortName: string | null;
    completeShortName: string | null;
    teams: PoolTeam[];
    dayIndex: number; // 0-based index into playDays array
  }

  const [refreshing, setRefreshing] = useState(false);
  const [teamData, setTeamData] = useState<AESTeamAssignment | null>(null);
  const [teamMatches, setTeamMatches] = useState<FlatCourtMatch[]>([]);
  const [allPools, setAllPools] = useState<PoolEntry[]>([]);
  const [matchResults, setMatchResults] = useState<Map<number, MatchResult>>(
    new Map()
  );
  const [scheduleMatches, setScheduleMatches] = useState<EnrichedScheduleMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [scoresModalMatch, setScoresModalMatch] = useState<FlatCourtMatch | null>(null);
  const [courtStreamMap, setCourtStreamMap] = useState<CourtStreamMap>({});
  const [dayFilter, setDayFilter] = useState<'today' | 'yesterday' | 'all'>('all');
  const [workDutyMatches, setWorkDutyMatches] = useState<FlatCourtMatch[]>([]);
  const [leaderboardRank, setLeaderboardRank] = useState<{ rank: number; total: number } | null>(null);
  const [divisionStandings, setDivisionStandings] = useState<import('../types/aes').AESStanding[]>([]);
  const [shareMatch, setShareMatch] = useState<EnrichedScheduleMatch | null>(null);
  // ─── Manual season-history index state ───────────────────────────────
  // Tracks whether THIS event/division is already in the AES season index
  // (so we can show "Indexed ✓" vs "Add to Season History"). Refreshed on
  // mount and after a successful manual add.
  const [aesIndexed, setAesIndexed] = useState<boolean>(false);
  const [adding, setAdding] = useState<boolean>(false);
  const refreshIndexedFlag = useCallback(async () => {
    try {
      const idx = await loadAesSeasonIndex();
      setAesIndexed(!!idx[aesSnapshotKey(event.Key, division.DivisionId)]);
    } catch {
      /* ignore */
    }
  }, [event.Key, division.DivisionId]);
  useEffect(() => {
    refreshIndexedFlag();
  }, [refreshIndexedFlag]);
  const handleAddToSeasonHistory = useCallback(async () => {
    if (adding) return;
    setAdding(true);
    try {
      // Index this event into the AES snapshot store so SeasonHistory
      // can render it. We deliberately no longer touch the global
      // `addMyTeamAlias` list — it caused cross-team pollution. The
      // canonical alias list now lives on the per-team TeamProfile,
      // which `onToggleFavorite` (below) keeps in sync via
      // `addWatchingTeamProfile` in App.tsx.
      const aliasName = team.TeamText || team.TeamName;
      await indexAesSnapshot(event.Key, division.DivisionId, team.TeamId);
      setAesIndexed(true);
      // "+ Season" should also follow the team — otherwise the user
      // can index a tournament but the team never lands in their
      // hamburger / MyTeams / MyHome lists.
      if (!isFavorite) {
        onToggleFavorite();
      }
      Alert.alert(
        'Added to season history',
        `"${aliasName}" at ${event.Name} is now part of your season history.`,
      );
    } catch (err: any) {
      Alert.alert(
        'Could not add to season history',
        err?.message || 'Something went wrong while indexing this event. Try again in a moment.',
      );
    } finally {
      setAdding(false);
    }
  }, [adding, event.Key, event.Name, division.DivisionId, team.TeamId, team.TeamText, team.TeamName, isFavorite, onToggleFavorite]);

  // ─── Follow toggle (single-pill consolidation) ────────────────────────
  // Replaces the prior cluster of ★ Favorite / + Season / 🏐 My Team.
  // The audit's call: one button labelled "Follow" / "Following ✓" that
  // does the right thing on first tap. The chevron next to "Following ✓"
  // opens an action sheet for primary-team / manage-roster / unfollow.
  //
  // Following = isFavorite OR isMyTeam. (Adding a favorite already
  // creates a watching TeamProfile via App.tsx's setUserProfile in
  // toggleFavorite, so the favourite flag is the canonical "I follow
  // this team" signal.)
  const isFollowing = isFavorite || isMyTeam;

  const handleFollow = useCallback(async () => {
    // First tap = full follow: favourite + season-add + (if no other
    // me-team exists, also set as primary so the "Welcome back"
    // surface lands here). handleAddToSeasonHistory already toggles
    // the favourite flag if it isn't on yet.
    await handleAddToSeasonHistory();
    if (!isMyTeam && meTeamCount === 0) {
      onSetAsMyTeam();
    }
  }, [handleAddToSeasonHistory, isMyTeam, meTeamCount, onSetAsMyTeam]);

  const handleStopFollowing = useCallback(() => {
    // Drop favourite + clear my-team status. We deliberately keep the
    // indexed AES snapshot — losing the snapshot would erase the
    // user's history rows for this tournament, and unfollowing a
    // team is supposed to be quiet, not destructive.
    if (isFavorite) onToggleFavorite();
    if (isMyTeam) onClearMyTeam();
  }, [isFavorite, isMyTeam, onToggleFavorite, onClearMyTeam]);

  const openFollowSheet = useCallback(() => {
    const teamLabel = team.TeamText || team.TeamName;
    const buttons: Array<{
      text: string;
      style?: 'cancel' | 'destructive';
      onPress?: () => void;
    }> = [];
    if (!isMyTeam) {
      buttons.push({ text: 'Set as primary team', onPress: onSetAsMyTeam });
    }
    if (isMyTeam && onManageRoster) {
      buttons.push({ text: 'Manage roster', onPress: onManageRoster });
    }
    buttons.push({
      text: 'Stop following',
      style: 'destructive',
      onPress: handleStopFollowing,
    });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(teamLabel, undefined, buttons);
  }, [team.TeamText, team.TeamName, isMyTeam, onManageRoster, onSetAsMyTeam, handleStopFollowing]);

  // ─── Live countdown tick (updates every 30s) ───────────────────────────
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  // ─── Background polling & change detection ──────────────────────────────
  const POLL_INTERVAL = 120_000; // 2 minutes
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [updateBanner, setUpdateBanner] = useState<string | null>(null);
  const bannerOpacity = useRef(new Animated.Value(0)).current;
  const [lastRefreshTime, setLastRefreshTime] = useState<number>(Date.now());
  // Snapshot of key data for change detection
  const prevMatchCountRef = useRef<number>(0);
  const prevScoreHashRef = useRef<string>('');

  /** Build a simple hash of score state for change detection */
  function buildScoreHash(matches: EnrichedScheduleMatch[]): string {
    return matches
      .filter((m) => m.HasScores)
      .map((m) => `${m.MatchId}:${m.FirstTeamWon ? 'W' : ''}${m.SecondTeamWon ? 'L' : ''}:${m.Sets.map((s) => `${s.FirstTeamScore}-${s.SecondTeamScore}`).join(',')}`)
      .join('|');
  }

  /** Show an animated banner that auto-dismisses */
  function showBanner(message: string) {
    setUpdateBanner(message);
    Animated.sequence([
      Animated.timing(bannerOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(4000),
      Animated.timing(bannerOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start(() => setUpdateBanner(null));
  }

  // Start/stop polling based on component lifecycle + app foreground state
  useEffect(() => {
    function startPolling() {
      if (pollRef.current) return;
      pollRef.current = setInterval(() => {
        loadData(true); // silent = true (no loading spinner)
      }, POLL_INTERVAL);
    }
    function stopPolling() {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }

    startPolling();

    // Pause polling when app goes to background, resume on foreground
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        loadData(true); // Refresh immediately when foregrounding
        startPolling();
      } else {
        stopPolling();
      }
    });

    return () => {
      stopPolling();
      sub.remove();
    };
  }, [event.Key, division.DivisionId, team.TeamId]);

  useEffect(() => {
    loadData();
    loadCourtStreams(event.Key).then(setCourtStreamMap);
    // Auto-snapshot this event+division for the cross-source season view.
    // Non-blocking; uses a 2-minute freshness window. Also adds the team's
    // text to My-Team aliases so cross-source matching picks it up later.
    if (isMyTeam) {
      ensureAesIndexed(event.Key, division.DivisionId, team.TeamId)
        .then(() => refreshIndexedFlag())
        .catch(() => {
          /* ignore */
        });
      const nameForAlias = team.TeamText || team.TeamName;
      if (nameForAlias) {
        addMyTeamAlias(nameForAlias).catch(() => {
          /* ignore */
        });
      }
    }
  }, [event.Key, division.DivisionId, team.TeamId, isMyTeam, refreshIndexedFlag]);

  async function loadData(silent = false) {
    if (!silent) setLoading(true);
    try {
      // Load team assignment (next match info)
      const assignments = await getTeamAssignments(
        event.Key, division.DivisionId, null, [team.TeamId]
      );
      const freshTeam = assignments.find((a) => a.TeamId === team.TeamId);
      if (freshTeam) setTeamData(freshTeam);

      // Load court schedule to find all matches for this team
      const utilDates = await getUtilizedDates(event.Key);
      const allMatches: FlatCourtMatch[] = [];
      for (const dateObj of utilDates) {
        try {
          const scheduleData = await getCourtSchedule(event.Key, dateObj.DateTime);
          const flat = flattenCourtSchedule(scheduleData);
          const teamText = freshTeam?.TeamText || team.TeamText;
          const filtered = filterMatchesForTeam(flat, teamText);
          allMatches.push(...filtered);
        } catch {
          // Skip days that fail
        }
      }
      allMatches.sort((a, b) => a.ScheduledStartDateTime - b.ScheduledStartDateTime);
      setTeamMatches(allMatches);

      // Load pool data for ALL play days.
      // Only include actual pool plays (PlayType !== 1) in the pool standings.
      // Bracket plays (PlayType === 1) are displayed on the bracket screen instead.
      // This prevents divisions like U18 Boys Div 1 (playoffs on Day 2 + 3)
      // from showing bracket data in the "Pool Standings" section.
      const playDays = await getPlayDays(event.Key, division.DivisionId);
      const collectedPools: PoolEntry[] = [];
      for (let dayIdx = 0; dayIdx < playDays.length; dayIdx++) {
        const day = playDays[dayIdx];
        try {
          const pools = await getPlays(event.Key, division.DivisionId, day.DateTime);
          for (const pool of pools) {
            // Skip bracket plays — they belong on the bracket screen
            if (pool.PlayType === 1) continue;
            const found = pool.Teams.find((t) => t.TeamId === team.TeamId);
            if (found) {
              collectedPools.push({
                poolRecord: found,
                shortName: pool.ShortName || null,
                completeShortName: pool.CompleteShortName || null,
                teams: pool.Teams || [],
                dayIndex: dayIdx,
              });
            }
          }
        } catch {
          // Skip
        }
      }
      setAllPools(collectedPools);

      // Fetch match results with set scores via the team schedule endpoints.
      // These return actual set-by-set scores (unlike the court schedule which
      // only has HasOutcome boolean). Load both current + past schedule.
      try {
        const resultsMap = new Map<number, MatchResult>();
        const [currentSched, pastSched] = await Promise.all([
          getTeamCurrentSchedule(event.Key, division.DivisionId, team.TeamId).catch(() => []),
          getTeamPastSchedule(event.Key, division.DivisionId, team.TeamId).catch(() => []),
        ]);
        const allSchedMatches = extractAllScheduleMatches(currentSched, pastSched);
        // Store all schedule matches (these have team IDs for scout links)
        setScheduleMatches(allSchedMatches);
        for (const m of allSchedMatches) {
          if (m.HasScores && m.MatchId) {
            resultsMap.set(m.MatchId, {
              MatchId: m.MatchId,
              HasScores: m.HasScores,
              FirstTeamWon: m.FirstTeamWon,
              SecondTeamWon: m.SecondTeamWon,
              FirstTeamText: m.FirstTeamText,
              SecondTeamText: m.SecondTeamText,
              Sets: m.Sets.map((s) => ({
                FirstTeamScore: s.FirstTeamScore,
                SecondTeamScore: s.SecondTeamScore,
                ScoreText: s.ScoreText,
                IsDecidingSet: s.IsDecidingSet,
              })),
            });
          }
        }
        setMatchResults(resultsMap);

        // ── Change detection (for silent polls) ──
        if (silent) {
          const newScoreHash = buildScoreHash(allSchedMatches);
          const newMatchCount = allMatches.length;
          if (prevScoreHashRef.current && newScoreHash !== prevScoreHashRef.current) {
            showBanner('🏐 Scores updated!');
          } else if (prevMatchCountRef.current > 0 && newMatchCount !== prevMatchCountRef.current) {
            showBanner('📋 Schedule updated!');
          }
          prevScoreHashRef.current = newScoreHash;
          prevMatchCountRef.current = newMatchCount;
        } else {
          // First load — set baseline for future comparisons
          prevScoreHashRef.current = buildScoreHash(allSchedMatches);
          prevMatchCountRef.current = allMatches.length;
        }
      } catch {
        // Fall back to the division-wide approach if team schedule fails
        getAllDivisionMatchResults(event.Key, division.DivisionId)
          .then(setMatchResults)
          .catch(() => {});
      }
      // ── Work duty detection ──
      // Check court schedule for matches where this team is the work team
      const teamText = (freshTeam?.TeamText || team.TeamText || '').toLowerCase().trim();
      const workMatches = allMatches.filter((m) => {
        const workText = (m.WorkTeamText || '').toLowerCase().trim();
        return workText.length > 0 && workText === teamText;
      });
      setWorkDutyMatches(workMatches.filter((m) => m.ScheduledStartDateTime > Date.now()));

      // ── Leaderboard rank + division overview ──
      try {
        const standings = await getStandings(event.Key, division.DivisionId);
        // Sort by rank when available; use TeamCode/TeamId as seed fallback
        // Helper: extract seed number from TeamText e.g. "Team Name (32)" → 32
        const getSeed = (s: import('../types/aes').AESStanding): number => {
          const m = (s.TeamText || '').match(/\((\d+)\)\s*$/);
          if (m) return parseInt(m[1], 10);
          const c = parseInt(s.TeamCode, 10);
          if (!isNaN(c)) return c;
          return 9999;
        };
        // Always sort client-side; API order is not reliable
        const sorted = [...standings].sort((a, b) => {
          // Treat 0 as "no rank" (API returns 0 when unranked)
          const rankA = (a.OverallRank && a.OverallRank > 0) ? a.OverallRank : null;
          const rankB = (b.OverallRank && b.OverallRank > 0) ? b.OverallRank : null;
          if (rankA != null && rankB != null) return rankA - rankB;
          if (rankA != null && rankB == null) return -1;
          if (rankA == null && rankB != null) return 1;
          // Sort by record (most wins first, then fewest losses)
          if (a.MatchesWon !== b.MatchesWon) return b.MatchesWon - a.MatchesWon;
          if (a.MatchesLost !== b.MatchesLost) return a.MatchesLost - b.MatchesLost;
          // Fall back to seed number (from TeamText parenthetical or TeamCode)
          return getSeed(a) - getSeed(b);
        });
        setDivisionStandings(sorted);
        const myStanding = sorted.find((s) => s.TeamId === team.TeamId);
        if (myStanding && (myStanding.OverallRank || myStanding.FinishRank)) {
          setLeaderboardRank({
            rank: myStanding.OverallRank ?? myStanding.FinishRank ?? 0,
            total: sorted.length,
          });
        }
      } catch {
        // standings not available yet
      }
    } catch (err) {
      console.error('Failed to load team data:', err);
    } finally {
      if (!silent) setLoading(false);
      setLastRefreshTime(Date.now());
    }
  }

  // (Legacy `addTournamentHistoryEntry` auto-save removed — see import-block
  // comment above. The cross-tournament screen now reads from the unified
  // AES + Timu indices populated by `indexAesSnapshot`, which already runs
  // on this screen's refresh path.)

  // Auto-schedule notifications for upcoming matches
  useEffect(() => {
    if (scheduleMatches.length === 0) return;
    const upcoming = scheduleMatches.filter(
      (m) => !m.HasScores && !m.FirstTeamWon && !m.SecondTeamWon
    );
    if (upcoming.length === 0) return;

    const notifs: MatchNotification[] = upcoming.map((m) => {
      const isFirst = m.FirstTeamId === team.TeamId;
      return {
        matchId: m.MatchId,
        teamText: team.TeamText || team.TeamName,
        opponentText: isFirst
          ? m.SecondTeamText || m.SecondTeamName || 'TBD'
          : m.FirstTeamText || m.FirstTeamName || 'TBD',
        scheduledStart: m.ScheduledStartDateTime,
        courtName: m.Court?.Name || 'TBD',
        eventName: event.Name,
        divisionName: division.Name,
      };
    });

    scheduleAllMatchNotifications(notifs).catch(() => {});
  }, [scheduleMatches]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading team data...</Text>
      </View>
    );
  }

  const current = teamData || team;

  // For NextDayScenarios, use the latest pool (last in order = most recent day)
  const latestPool = allPools.length > 0 ? allPools[allPools.length - 1] : null;

  // Collect unique playoff play IDs from upcoming bracket matches
  const playoffPlayIds = Array.from(
    new Set(
      scheduleMatches
        .filter((m) => m.PlayType === 1 && m.PlayId != null && !m.HasScores && !m.FirstTeamWon && !m.SecondTeamWon)
        .map((m) => m.PlayId!)
    )
  );

  // Confirmed upcoming matches (from team schedule endpoints, which have team IDs for scouting)
  // Drop entries whose scheduled time is well in the past — keeps "upcoming"
  // honest when AES hasn't ingested a result yet. 30-min grace so an
  // in-progress match still surfaces while it's actually being played.
  const upcomingMatches = scheduleMatches
    .filter((m) => !m.HasScores && !m.FirstTeamWon && !m.SecondTeamWon)
    .filter((m) => {
      const startMs = new Date(m.ScheduledStartDateTime).getTime();
      if (!isFinite(startMs)) return true;
      return startMs > Date.now() - 30 * 60 * 1000;
    })
    .sort((a, b) => new Date(a.ScheduledStartDateTime).getTime() - new Date(b.ScheduledStartDateTime).getTime());

  // Past results (completed matches with scores from team schedule endpoints)
  // This includes BOTH pool and playoff matches — the authoritative source
  const pastResults = scheduleMatches
    .filter((m) => m.HasScores || m.FirstTeamWon || m.SecondTeamWon)
    .sort((a, b) => new Date(b.ScheduledStartDateTime).getTime() - new Date(a.ScheduledStartDateTime).getTime());

  // ─── Derive all stats from pastResults (covers pools + playoffs) ──────
  let totalWins = 0;
  let totalLosses = 0;
  let totalSetsWon = 0;
  let totalSetsLost = 0;
  for (const m of pastResults) {
    const isFirst = m.FirstTeamId === team.TeamId;
    const iWon = isFirst ? m.FirstTeamWon : m.SecondTeamWon;
    if (iWon) totalWins++; else totalLosses++;
    const sets = m.Sets?.filter((s) => s.FirstTeamScore != null) || [];
    for (const s of sets) {
      const my = (isFirst ? s.FirstTeamScore : s.SecondTeamScore) ?? 0;
      const opp = (isFirst ? s.SecondTeamScore : s.FirstTeamScore) ?? 0;
      if (my > opp) totalSetsWon++; else if (opp > my) totalSetsLost++;
    }
  }

  // Detect whether the tournament is over for this team:
  // At least one match played AND no more upcoming matches AND no next match.
  const tournamentOver =
    pastResults.length > 0 &&
    upcomingMatches.length === 0 &&
    !current.NextMatch;

  // Total matches = played + upcoming (both from scheduleMatches, same source)
  const totalScheduled = scheduleMatches.length;

  // ─── Day filter helpers ──────────────────────────────────────────────
  function isToday(dateStr: string): boolean {
    const d = new Date(dateStr);
    const today = new Date();
    return d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
  }
  function isYesterday(dateStr: string): boolean {
    const d = new Date(dateStr);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return d.getFullYear() === yesterday.getFullYear() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getDate() === yesterday.getDate();
  }
  function filterByDay<T extends { ScheduledStartDateTime: string }>(items: T[]): T[] {
    if (dayFilter === 'all') return items;
    return items.filter((m) =>
      dayFilter === 'today' ? isToday(m.ScheduledStartDateTime) : isYesterday(m.ScheduledStartDateTime)
    );
  }

  const filteredPastResults = filterByDay(pastResults);
  const filteredUpcoming = filterByDay(upcomingMatches);

  function ordinal(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // ─── Next work duty ──────────────────────────────────────────────────
  const nextWorkDuty = workDutyMatches.length > 0
    ? workDutyMatches.sort((a, b) => a.ScheduledStartDateTime - b.ScheduledStartDateTime)[0]
    : null;

  return (
    <View style={{ flex: 1 }}>
      {/* Update banner — transient toast that floats above the scroll
          content. `top` is patched at render so the banner clears the
          status bar (insets.top) AND the global TopBar / Hamburger
          overlay (which lives at insets.top + 8, ~36px tall). Sliding
          it below those means the toast doesn't cover the team-pill or
          the hamburger button while it's animating in. The 56px offset
          works in both portrait and landscape — banner shifts with the
          inset, not with the orientation. */}
      {updateBanner && (
        <Animated.View
          style={[
            styles.updateBanner,
            { top: insets.top + 56, opacity: bannerOpacity },
          ]}
        >
          <Text style={styles.updateBannerText}>{updateBanner}</Text>
        </Animated.View>
      )}
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Team Header */}
      <View style={styles.teamHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backButton} hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <View style={styles.teamHeaderTop}>
          <View style={styles.teamHeaderInfo}>
            <Text style={styles.teamName}>{current.TeamName}</Text>
            {/* TeamClub is typed non-null but the AES API returns null
                for unaffiliated teams — guard before reading .Name. */}
            {current.TeamClub?.Name ? (
              <Text style={styles.clubName}>{current.TeamClub.Name}</Text>
            ) : null}
            <Text style={styles.divisionName}>{division.Name}</Text>
          </View>
          <View style={styles.headerActions}>
            {/* Single "Follow" / "Following \u2713" pill replacing the prior
                cluster (\u2605 Favorite / + Season / \ud83c\udfd0 My Team). When already
                following, tapping the pill opens an action sheet for
                primary-team / manage-roster / unfollow \u2014 equivalent to
                the chevron affordance the audit calls out. */}
            <TouchableOpacity
              onPress={isFollowing ? openFollowSheet : handleFollow}
              disabled={adding}
              style={[
                styles.followPill,
                isFollowing && styles.followPillActive,
                adding && styles.followPillBusy,
              ]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text
                style={[
                  styles.followPillText,
                  isFollowing && styles.followPillTextActive,
                ]}
              >
                {adding
                  ? 'Following\u2026'
                  : isFollowing
                  ? `\u2713 Following${isMyTeam ? ' \u00b7 Primary' : ''}  \u25be`
                  : '+ Follow'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Overall record — derived from all matches (pool + playoff) */}
        {(totalWins > 0 || totalLosses > 0) && (
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{totalWins}</Text>
              <Text style={styles.statLabel}>Wins</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: '#ffcdd2' }]}>{totalLosses}</Text>
              <Text style={styles.statLabel}>Losses</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{totalSetsWon}</Text>
              <Text style={styles.statLabel}>Sets W</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: '#ffcdd2' }]}>{totalSetsLost}</Text>
              <Text style={styles.statLabel}>Sets L</Text>
            </View>
          </View>
        )}

        {/* Last updated timestamp */}
        <Text style={styles.lastUpdated}>
          Updated {getRelativeTime(new Date(lastRefreshTime).toISOString())}
        </Text>

        {/* Match count summary — all from scheduleMatches for consistency */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{totalScheduled}</Text>
            <Text style={styles.statLabel}>Scheduled</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{pastResults.length}</Text>
            <Text style={styles.statLabel}>Played</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{upcomingMatches.length}</Text>
            <Text style={styles.statLabel}>Remaining</Text>
          </View>
        </View>
      </View>

      {/* Upcoming Tournaments — forward-looking metadata: which events
          this team is registered for next, across both AES and Timu.
          Distinct from the "Upcoming Matches" section below (which is
          about individual matches WITHIN the current event). Same data
          source as MyHome's per-team next-tournament line. */}
      <UpcomingTournamentsSection
        aliases={[current.TeamName, current.TeamText].filter(Boolean) as string[]}
        debugLabel={`AES TeamDashboard "${current.TeamName}"`}
        onOpenEntry={onOpenUpcomingTournament}
      />


      {/* Work Duty Reminder */}
      {nextWorkDuty && (
        <View style={styles.workDutyBanner}>
          <View style={styles.workDutyIconRow}>
            <Text style={styles.workDutyIcon}>{'\u{1F6A8}'}</Text>
            <Text style={styles.workDutyTitle}>Work Duty</Text>
          </View>
          <Text style={styles.workDutyText}>
            You have referee/work duty at{' '}
            <Text style={{ fontWeight: '800' }}>{nextWorkDuty.CourtName}</Text>
            {' '}at{' '}
            <Text style={{ fontWeight: '800' }}>
              {formatTime(nextWorkDuty.ScheduledStartDateTime)}
            </Text>
          </Text>
          {workDutyMatches.length > 1 && (
            <Text style={styles.workDutyExtra}>
              +{workDutyMatches.length - 1} more work {workDutyMatches.length - 1 === 1 ? 'assignment' : 'assignments'} today
            </Text>
          )}
        </View>
      )}

      {/* Leaderboard Position */}
      {leaderboardRank && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Division Standing</Text>
          <Card variant="elevated">
            <View style={styles.leaderboardCard}>
              <View style={styles.leaderboardRankCircle}>
                <Text style={styles.leaderboardRankText}>{leaderboardRank.rank}</Text>
              </View>
              <View style={styles.leaderboardInfo}>
                <Text style={styles.leaderboardLabel}>
                  {leaderboardRank.rank === 1
                    ? 'Leading the division!'
                    : leaderboardRank.rank <= 3
                    ? 'Top 3 in division'
                    : leaderboardRank.rank <= Math.ceil(leaderboardRank.total / 2)
                    ? 'Upper half'
                    : 'Keep pushing!'}
                </Text>
                <Text style={styles.leaderboardSub}>
                  {ordinal(leaderboardRank.rank)} of {leaderboardRank.total} teams
                </Text>
              </View>
            </View>
            <View style={styles.leaderboardBarTrack}>
              <View
                style={[
                  styles.leaderboardBarFill,
                  {
                    width: `${Math.max(
                      100 - ((leaderboardRank.rank - 1) / Math.max(leaderboardRank.total - 1, 1)) * 100,
                      5
                    )}%`,
                  },
                  leaderboardRank.rank <= 3
                    ? { backgroundColor: colors.success }
                    : leaderboardRank.rank <= Math.ceil(leaderboardRank.total / 2)
                    ? { backgroundColor: colors.primary }
                    : { backgroundColor: colors.warning },
                ]}
              />
            </View>
          </Card>
        </View>
      )}

      {/* Next Match from assignments — hidden once tournament is over */}
      {!tournamentOver && current.NextMatch && (() => {
        // Check if the next match is a playoff/bracket match
        const nextMatchEnriched = scheduleMatches.find(
          (m) => m.MatchId === current.NextMatch!.MatchId
        );
        const isPlayoff = nextMatchEnriched?.PlayType === 1;
        const playoffPlayId = nextMatchEnriched?.PlayId;
        const playoffName = nextMatchEnriched?.PlayName;

        // Live countdown
        const matchMs = new Date(current.NextMatch.ScheduledStartDateTime).getTime();
        const diffMs = matchMs - now;
        const diffMins = Math.floor(diffMs / 60000);
        const isLive = diffMins < 0;
        const isImminent = diffMins >= 0 && diffMins <= 15;
        const isSoon = diffMins > 15 && diffMins <= 60;

        let countdownText = '';
        if (isLive) {
          countdownText = 'Match underway';
        } else if (diffMins < 60) {
          countdownText = `In ${diffMins} min`;
        } else if (diffMins < 1440) {
          const hrs = Math.floor(diffMins / 60);
          const mins = diffMins % 60;
          countdownText = mins > 0 ? `In ${hrs}h ${mins}m` : `In ${hrs}h`;
        } else {
          // For matches 1+ days away, use calendar-day logic
          const matchDate = new Date(current.NextMatch.ScheduledStartDateTime);
          const todayMid = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
          const matchMid = new Date(matchDate.getFullYear(), matchDate.getMonth(), matchDate.getDate());
          const dayDiff = Math.round((matchMid.getTime() - todayMid.getTime()) / 86400000);
          if (dayDiff === 1) {
            countdownText = 'Tomorrow';
          } else {
            // Show day name, e.g. "Thursday"
            const dayName = matchDate.toLocaleDateString('en-US', { weekday: 'long' });
            countdownText = dayName;
          }
        }

        // Head-to-head: check if we've played this opponent before
        const opponentId = current.OpponentTeamId;
        const h2hResults = opponentId
          ? pastResults.filter((m) => m.FirstTeamId === opponentId || m.SecondTeamId === opponentId)
          : [];

        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Next Match</Text>
            {/* Live score tracker when match is underway */}
            {isLive && nextMatchEnriched?.MatchId && (
              <LiveMatchTracker
                eventKey={event.Key}
                divisionId={division.DivisionId}
                teamId={team.TeamId}
                matchId={nextMatchEnriched.MatchId}
                teamName={current.TeamName}
                opponentName={current.OpponentTeamText || current.OpponentTeamName || 'TBD'}
              />
            )}
            <TouchableOpacity
              activeOpacity={isPlayoff ? 0.7 : 1}
              onPress={() => {
                if (isPlayoff && playoffPlayId) {
                  onViewBrackets(playoffPlayId);
                }
              }}
            >
              <Card variant="elevated">
                {isPlayoff && playoffName && (
                  <View style={styles.playoffBadge}>
                    <Text style={styles.playoffBadgeText}>{playoffName}</Text>
                  </View>
                )}
                {/* Countdown timer — prominent */}
                <View style={styles.countdownRow}>
                  <Text style={[
                    styles.countdownText,
                    isLive && styles.countdownLive,
                    isImminent && styles.countdownImminent,
                    isSoon && styles.countdownSoon,
                  ]}>
                    {countdownText}
                  </Text>
                  <Text style={styles.countdownCourt}>
                    {current.NextMatch.Court.Name}
                  </Text>
                </View>
                <Text style={styles.nextMatchTime}>
                  {formatTime(current.NextMatch.ScheduledStartDateTime)}
                  {'  '}
                  {formatDate(current.NextMatch.ScheduledStartDateTime)}
                </Text>
                <Text style={styles.nextMatchVs}>vs {current.OpponentTeamText}</Text>
                {/* Head-to-head previous result */}
                {h2hResults.length > 0 && (() => {
                  const prev = h2hResults[0]; // Most recent
                  const isFirst = prev.FirstTeamId === team.TeamId;
                  const iWon = isFirst ? prev.FirstTeamWon : prev.SecondTeamWon;
                  const sets = prev.Sets?.filter((s) => s.FirstTeamScore != null) || [];
                  const setScores = sets.map((s) => {
                    const my = isFirst ? s.FirstTeamScore : s.SecondTeamScore;
                    const opp = isFirst ? s.SecondTeamScore : s.FirstTeamScore;
                    return `${my}-${opp}`;
                  }).join(', ');
                  return (
                    <View style={styles.h2hBanner}>
                      <Text style={styles.h2hText}>
                        {iWon ? 'Won' : 'Lost'} vs them earlier{setScores ? `: ${setScores}` : ''}
                      </Text>
                    </View>
                  );
                })()}
                {current.OpponentTeamId !== 0 && (
                  <TouchableOpacity
                    style={styles.scoutButton}
                    onPress={() => onScoutOpponent(current.OpponentTeamId, current.OpponentTeamName)}
                  >
                    <Text style={styles.scoutButtonText}>
                      Scout {current.OpponentTeamName}
                    </Text>
                  </TouchableOpacity>
                )}
                {isPlayoff && (
                  <Text style={styles.viewBracketHint}>Tap to view bracket</Text>
                )}
                <WatchLiveButton videoLink={current.NextMatch.Court.VideoLink || courtStreamMap[current.NextMatch.Court.Name] || ''} />
              </Card>
            </TouchableOpacity>
          </View>
        );
      })()}

      {/* Pool Standings — one section per pool (Day 1, Power Pools, etc.) */}
      {allPools.length > 0 && (() => {
        // Check if pools span multiple days — if so, show day labels
        const uniqueDays = new Set(allPools.map((p) => p.dayIndex));
        const multiDay = uniqueDays.size > 1;

        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pool Standings</Text>
            {allPools.map((pool, idx) => {
              // Show a day header when entering a new day
              const showDayLabel = multiDay && (idx === 0 || pool.dayIndex !== allPools[idx - 1].dayIndex);
              return (
                <View key={`pool-${idx}`} style={idx > 0 ? { marginTop: spacing.md } : undefined}>
                  {showDayLabel && (
                    <Text style={styles.dayLabel}>Day {pool.dayIndex + 1}</Text>
                  )}
                  <PoolStandings
                    poolShortName={pool.shortName}
                    teams={pool.teams}
                    myTeamId={current.TeamId}
                    onTeamPress={(teamId, teamName) =>
                      onScoutOpponent(teamId, teamName)
                    }
                  />
                </View>
              );
            })}
          </View>
        );
      })()}

      {/* Stats & Trends */}
      {pastResults.length >= 2 && (() => {
        // Compute stats from past results
        let totalPtsFor = 0;
        let totalPtsAgainst = 0;
        let totalSets = 0;
        let matchWins = 0;
        let matchLosses = 0;
        let currentStreak = 0;
        let streakType: 'W' | 'L' | null = null;
        let streakBroken = false;

        // pastResults is sorted newest-first — iterate for streak + stats
        for (const m of pastResults) {
          const isFirst = m.FirstTeamId === team.TeamId;
          const iWon = isFirst ? m.FirstTeamWon : m.SecondTeamWon;
          if (iWon) matchWins++; else matchLosses++;

          // Points
          const sets = m.Sets?.filter((s) => s.FirstTeamScore != null) || [];
          for (const s of sets) {
            const my = (isFirst ? s.FirstTeamScore : s.SecondTeamScore) ?? 0;
            const opp = (isFirst ? s.SecondTeamScore : s.FirstTeamScore) ?? 0;
            totalPtsFor += my;
            totalPtsAgainst += opp;
            totalSets++;
          }

          // Streak (from newest — stop extending once it breaks)
          if (!streakBroken) {
            if (streakType === null) {
              streakType = iWon ? 'W' : 'L';
              currentStreak = 1;
            } else if ((iWon && streakType === 'W') || (!iWon && streakType === 'L')) {
              currentStreak++;
            } else {
              streakBroken = true; // Pattern broken — freeze streak count
            }
          }
        }

        const ptDiff = totalPtsFor - totalPtsAgainst;
        const avgPtsFor = totalSets > 0 ? (totalPtsFor / totalSets).toFixed(1) : '—';
        const avgPtsAgainst = totalSets > 0 ? (totalPtsAgainst / totalSets).toFixed(1) : '—';
        const streakText = streakType && currentStreak > 1
          ? `${currentStreak}${streakType}`
          : streakType === 'W' ? '1W' : streakType === 'L' ? '1L' : '—';

        const winPct = matchWins + matchLosses > 0
          ? Math.round((matchWins / (matchWins + matchLosses)) * 100)
          : 0;

        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Performance</Text>
            {/* Top row — two wide tiles */}
            <View style={styles.perfRow}>
              <View style={[styles.perfTile, styles.perfTileWide]}>
                <Text style={styles.perfTileLabel}>Point Diff</Text>
                <Text style={[
                  styles.perfTileValue,
                  ptDiff >= 0 ? { color: colors.success } : { color: colors.error },
                ]}>
                  {ptDiff >= 0 ? '+' : ''}{ptDiff}
                </Text>
                <Text style={styles.perfTileSub}>
                  {avgPtsFor} scored — {avgPtsAgainst} conceded per set
                </Text>
              </View>
              <View style={[styles.perfTile, styles.perfTileNarrow]}>
                <Text style={styles.perfTileLabel}>Streak</Text>
                <Text style={[
                  styles.perfTileValue,
                  streakType === 'W' ? { color: colors.success } : { color: colors.error },
                ]}>
                  {currentStreak}{streakType || ''}
                </Text>
                <Text style={styles.perfTileSub}>
                  {streakType === 'W' ? 'wins' : streakType === 'L' ? 'losses' : ''}
                </Text>
              </View>
            </View>
            {/* Bottom row — win rate bar */}
            <View style={styles.perfWinRateCard}>
              <View style={styles.perfWinRateHeader}>
                <Text style={styles.perfTileLabel}>Win Rate</Text>
                <Text style={styles.perfWinRatePct}>{winPct}%</Text>
              </View>
              <View style={styles.perfBarTrack}>
                <View style={[
                  styles.perfBarFill,
                  { width: `${Math.max(winPct, 2)}%` },
                  winPct >= 50 ? { backgroundColor: colors.success } : { backgroundColor: colors.error },
                ]} />
              </View>
              <Text style={styles.perfWinRateSub}>
                {matchWins}W – {matchLosses}L across {pastResults.length} matches
              </Text>
            </View>
          </View>
        );
      })()}

      {/* Bracket Predictions — hidden once tournament is over */}
      {!tournamentOver && pastResults.length >= 2 && (
        <BracketPredictions
          eventKey={event.Key}
          divisionId={division.DivisionId}
          myTeamId={team.TeamId}
          divisionTeamCount={division.TeamCount}
          onViewBrackets={() => onViewBrackets?.()}
        />
      )}

      {/* Day Filter Pills */}
      {(pastResults.length > 0 || upcomingMatches.length > 0) && (
        <View style={styles.dayFilterRow}>
          {(['all', 'today', 'yesterday'] as const).map((filter) => (
            <TouchableOpacity
              key={filter}
              style={[
                styles.dayFilterPill,
                dayFilter === filter && styles.dayFilterPillActive,
              ]}
              onPress={() => setDayFilter(filter)}
            >
              <Text
                style={[
                  styles.dayFilterText,
                  dayFilter === filter && styles.dayFilterTextActive,
                ]}
              >
                {filter === 'all' ? 'All Days' : filter === 'today' ? 'Today' : 'Yesterday'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Upcoming Matches — confirmed opponents with scout links; hidden once tournament is over */}
      {!tournamentOver && filteredUpcoming.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Upcoming Matches ({filteredUpcoming.length})
          </Text>
          {filteredUpcoming.map((match, idx) => {
            // Determine which side we are — try ID first, then text
            const myId = team.TeamId;
            const myText = (team.TeamText || '').toLowerCase().trim();
            const isFirstById = match.FirstTeamId === myId;
            const isSecondById = match.SecondTeamId === myId;
            const isFirstByText = !isFirstById && !isSecondById &&
              myText.length > 0 && (match.FirstTeamText || '').toLowerCase().trim() === myText;
            const isFirst = isFirstById || isFirstByText;
            const opponentName = isFirst ? match.SecondTeamName : match.FirstTeamName;
            const opponentText = isFirst ? match.SecondTeamText : match.FirstTeamText;
            const opponentId = isFirst ? match.SecondTeamId : match.FirstTeamId;
            const displayName = opponentText || opponentName || 'TBD';
            const hasOpponentId = opponentId != null && opponentId !== 0;
            const isPlayoff = match.PlayType === 1;
            // Count completed matches to give this a sequential game number
            const gameNumber = pastResults.length + idx + 1;

            return (
              <TouchableOpacity
                key={`upcoming-${match.MatchId || idx}`}
                activeOpacity={hasOpponentId ? 0.7 : 1}
                onPress={() => {
                  if (hasOpponentId) {
                    onScoutOpponent(opponentId, opponentName || opponentText || displayName);
                  }
                }}
              >
                <Card variant="outlined" style={styles.matchCard}>
                  {isPlayoff && match.PlayName && (
                    <View style={styles.playoffBadge}>
                      <Text style={styles.playoffBadgeText}>{match.PlayName}</Text>
                    </View>
                  )}
                  <View style={styles.matchHeader}>
                    <Text style={styles.matchTime}>
                      {formatDate(match.ScheduledStartDateTime)}
                      {'  '}
                      {formatTime(match.ScheduledStartDateTime)}
                    </Text>
                    <View style={styles.courtBadge}>
                      <Text style={styles.courtBadgeText}>{match.Court?.Name || ''}</Text>
                    </View>
                  </View>
                  <Text style={styles.upcomingPoolName}>Game {gameNumber}{match.MatchShortName ? ` — ${match.MatchShortName}` : ''}</Text>
                  <Text style={styles.matchVs}>vs {displayName}</Text>
                  {hasOpponentId ? (
                    <Text style={styles.scoutHint}>Tap to scout {displayName}</Text>
                  ) : null}
                  <WatchLiveButton videoLink={match.Court?.VideoLink || courtStreamMap[match.Court?.Name || ''] || ''} />
                </Card>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Future Matches (AES pool-sheet view) — hidden once tournament is over */}
      {!tournamentOver && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Future Matches</Text>
          <NextDayScenarios
            eventKey={event.Key}
            divisionId={division.DivisionId}
            divisionName={division.Name}
            teamId={team.TeamId}
            myPoolShortName={latestPool?.shortName || undefined}
            myFinishRank={latestPool?.poolRecord.FinishRank ?? null}
            onViewBrackets={onViewBrackets}
            onScoutOpponent={onScoutOpponent}
            playoffPlayIds={playoffPlayIds.length > 0 ? playoffPlayIds : undefined}
          />
        </View>
      )}

      {/* Past Results */}
      {filteredPastResults.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Results ({filteredPastResults.length}{dayFilter !== 'all' ? ` of ${pastResults.length}` : ''})
          </Text>
          {filteredPastResults.map((match, idx) => {
            const myId = team.TeamId;
            const isFirst = match.FirstTeamId === myId;
            const opponentName = isFirst ? match.SecondTeamName : match.FirstTeamName;
            const opponentText = isFirst ? match.SecondTeamText : match.FirstTeamText;
            const opponentId = isFirst ? match.SecondTeamId : match.FirstTeamId;
            const displayName = opponentText || opponentName || 'TBD';
            const iWon = isFirst ? match.FirstTeamWon : match.SecondTeamWon;
            const hasOpponentId = opponentId != null && opponentId !== 0;
            const isPlayoff = match.PlayType === 1;

            // Detect medal matches:
            // First check if this bracket is a placement bracket (5th, 7th, 9th, etc.)
            // Placement brackets never award medals — only gold/silver/bronze brackets do.
            const playNameLower = (match.PlayName || '').toLowerCase();
            const matchLabel = ((match.PlayName || '') + ' ' + (match.MatchFullName || '') + ' ' + (match.MatchShortName || '')).toLowerCase();
            const isPlacementBracket = isPlayoff && (
              /\b(5|7|9|11|13|15)(th|st|nd|rd)\b/.test(playNameLower) ||
              /\b(5\/[678]|7\/[89]|9\/1[01]|11\/1[23])\b/.test(playNameLower) ||
              playNameLower.includes('5th') ||
              playNameLower.includes('7th') ||
              playNameLower.includes('9th') ||
              playNameLower.includes('11th') ||
              playNameLower.includes('13th') ||
              playNameLower.includes('placement')
            );

            let isGoldMatch = false;
            let isBronzeMatch = false;

            if (isPlayoff && !isPlacementBracket) {
              // Strategy 1: Name-based detection from play/match names
              isGoldMatch = (
                matchLabel.includes('gold') ||
                matchLabel.includes('championship') ||
                matchLabel.includes('1st') ||
                matchLabel.includes('first place') ||
                matchLabel.includes('1/2') ||
                (matchLabel.includes('final') && !matchLabel.includes('semi') && !matchLabel.includes('quarter'))
              );
              isBronzeMatch = (
                matchLabel.includes('bronze') ||
                matchLabel.includes('3rd') ||
                matchLabel.includes('third') ||
                matchLabel.includes('consolation') ||
                matchLabel.includes('3/4')
              );

              // Strategy 2: Structural fallback — if this is the LAST playoff match
              // for this team (most recent result, no more upcoming bracket matches),
              // AND it's not in a placement bracket, it's likely a medal match.
              // IMPORTANT: Only apply this if the match is clearly a final-round match.
              // Quarter-final and round-of-16 losses should NOT get medal icons.
              if (!isGoldMatch && !isBronzeMatch && idx === 0) {
                const hasMorePlayoffMatches = upcomingMatches.some((m) => m.PlayType === 1);
                // Exclude early-round matches from medal consideration
                const isEarlyRound =
                  matchLabel.includes('quarter') ||
                  matchLabel.includes('qf') ||
                  matchLabel.includes('round of') ||
                  matchLabel.includes('r16') ||
                  matchLabel.includes('r32') ||
                  /\bro?und\s*\d/i.test(matchLabel);
                if (!hasMorePlayoffMatches && !isEarlyRound) {
                  // Must look like a true final (not semi-final or quarter-final):
                  // "final" (but not semi/quarter), "1/2", "3/4", or bracket named "gold"/"championship"
                  const looksLikeFinalRound =
                    (matchLabel.includes('final') && !matchLabel.includes('semi') && !matchLabel.includes('quarter')) ||
                    matchLabel.includes('1/2') ||
                    matchLabel.includes('3/4') ||
                    (playNameLower.includes('gold') && !matchLabel.includes('semi') && !matchLabel.includes('quarter')) ||
                    (playNameLower.includes('championship') && !matchLabel.includes('semi') && !matchLabel.includes('quarter'));
                  if (looksLikeFinalRound) {
                    const looksLikeBronzeBracket =
                      playNameLower.includes('bronze') ||
                      playNameLower.includes('3rd') ||
                      playNameLower.includes('3/4');
                    if (looksLikeBronzeBracket) {
                      isBronzeMatch = true;
                    } else {
                      isGoldMatch = true;
                    }
                  }
                }
              }
            }

            let medalEmoji = '';
            let medalLabel = '';
            let medalColor = '';
            if (isGoldMatch) {
              if (iWon) {
                medalEmoji = '🥇';
                medalLabel = 'GOLD';
                medalColor = '#FFD700';
              } else {
                medalEmoji = '🥈';
                medalLabel = 'SILVER';
                medalColor = '#C0C0C0';
              }
            } else if (isBronzeMatch) {
              if (iWon) {
                medalEmoji = '🥉';
                medalLabel = 'BRONZE';
                medalColor = '#CD7F32';
              }
            }

            // Build set scores display
            const sets = match.Sets?.filter(
              (s) => s.FirstTeamScore != null || s.SecondTeamScore != null
            ) || [];

            return (
              <TouchableOpacity
                key={match.MatchId || `result-${idx}`}
                activeOpacity={hasOpponentId ? 0.7 : 1}
                onPress={() => {
                  if (hasOpponentId) {
                    onScoutOpponent(opponentId, opponentName || opponentText || displayName);
                  }
                }}
              >
                <Card variant="outlined" style={styles.matchCard}>
                  {isPlayoff && match.PlayName && (
                    <View style={styles.playoffBadge}>
                      <Text style={styles.playoffBadgeText}>{match.PlayName}</Text>
                    </View>
                  )}
                  <View style={styles.matchHeader}>
                    <Text style={styles.matchTime}>
                      {formatDate(match.ScheduledStartDateTime)}
                      {'  '}
                      {formatTime(match.ScheduledStartDateTime)}
                    </Text>
                    <View style={styles.courtBadge}>
                      <Text style={styles.courtBadgeText}>{match.Court?.Name || ''}</Text>
                    </View>
                  </View>
                  {match.MatchShortName ? (
                    <Text style={styles.upcomingPoolName}>{match.MatchShortName}</Text>
                  ) : null}
                  <Text style={styles.matchVs}>vs {displayName}</Text>
                  {sets.length > 0 && (
                    <View style={styles.scoreRow}>
                      {sets.map((s, sIdx) => {
                        const my = isFirst ? s.FirstTeamScore : s.SecondTeamScore;
                        const opp = isFirst ? s.SecondTeamScore : s.FirstTeamScore;
                        const setWon = (my ?? 0) > (opp ?? 0);
                        return (
                          <Text
                            key={sIdx}
                            style={[
                              styles.scoreText,
                              setWon ? styles.scoreWin : styles.scoreLoss,
                            ]}
                          >
                            {my}-{opp}
                          </Text>
                        );
                      })}
                      <Text style={[styles.resultChip, iWon ? styles.winChip : styles.lossChip]}>
                        {iWon ? 'W' : 'L'}
                      </Text>
                      {medalEmoji ? (
                        <View style={[styles.medalBadge, { backgroundColor: medalColor }]}>
                          <Text style={styles.medalEmoji}>{medalEmoji}</Text>
                          <Text style={styles.medalLabel}>{medalLabel}</Text>
                        </View>
                      ) : null}
                    </View>
                  )}
                  {!match.HasScores && (
                    <Text style={styles.completedBadge}>Completed</Text>
                  )}
                  {hasOpponentId && (
                    <Text style={styles.scoutHint}>Tap to scout {displayName}</Text>
                  )}
                  {isPlayoff && match.PlayId && (
                    <TouchableOpacity
                      style={styles.viewBracketButton}
                      onPress={() => onViewBrackets(match.PlayId!)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.viewBracketButtonText}>View Bracket</Text>
                    </TouchableOpacity>
                  )}
                  {/* Share Result — opens styled card */}
                  <TouchableOpacity
                    style={styles.shareButton}
                    onPress={() => setShareMatch(match)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.shareButtonText}>Share Result</Text>
                  </TouchableOpacity>
                </Card>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* No matches message */}
      {teamMatches.length === 0 && !current.NextMatch && (
        <Card style={{ margin: spacing.lg }}>
          <Text style={styles.noData}>
            No matches scheduled yet. Check back closer to the tournament start.
          </Text>
        </Card>
      )}

      {/* Action Buttons */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.actionButton} onPress={onViewStandings}>
          <Text style={styles.actionButtonText}>View Division Standings</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionButtonBracket]}
          onPress={() => onViewBrackets()}
        >
          <Text style={styles.actionButtonText}>Playoff Brackets</Text>
        </TouchableOpacity>
        {/* Manual "Add to Season History" — shown for any team. For MyTeam
            this also runs automatically on dashboard mount, so the button
            doubles as a confirmation badge. */}
        <TouchableOpacity
          style={[
            styles.actionButton,
            styles.actionButtonSecondary,
            (aesIndexed || adding) && styles.actionButtonSecondaryDisabled,
          ]}
          disabled={aesIndexed || adding}
          onPress={handleAddToSeasonHistory}
        >
          <Text style={styles.actionButtonTextSecondary}>
            {adding
              ? 'Adding…'
              : aesIndexed
                ? '✓ In Season History'
                : 'Add to Season History'}
          </Text>
        </TouchableOpacity>
        {onViewSeasonHistory && (
          <TouchableOpacity
            style={[styles.actionButton, styles.actionButtonSecondary]}
            onPress={() => onViewSeasonHistory(team.TeamText || team.TeamName)}
          >
            <Text style={styles.actionButtonTextSecondary}>My Season History</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Division Overview — at the bottom of the dashboard */}
      {divisionStandings.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Division Overview</Text>
            <TouchableOpacity onPress={onViewStandings} activeOpacity={0.7}>
              <Text style={styles.seeAllText}>Full Standings →</Text>
            </TouchableOpacity>
          </View>
          <Card variant="elevated">
            <View style={styles.divOverviewHeader}>
              <Text style={styles.divOverviewHeaderRank}>#</Text>
              <Text style={styles.divOverviewHeaderTeam}>Team</Text>
              <Text style={styles.divOverviewHeaderRecord}>W-L</Text>
              <Text style={styles.divOverviewHeaderPct}>Pct</Text>
            </View>
            {divisionStandings.slice(0, 8).map((standing, idx) => {
              const isMyTeam = standing.TeamId === team.TeamId;
              const rank = standing.OverallRank ?? standing.FinishRank ?? idx + 1;
              const pctVal = standing.MatchesWon + standing.MatchesLost === 0
                ? 0
                : Number(standing.MatchPercent) * 100;
              return (
                <TouchableOpacity
                  key={standing.TeamId}
                  style={[
                    styles.divOverviewRow,
                    isMyTeam && styles.divOverviewRowHighlight,
                    idx < divisionStandings.slice(0, 8).length - 1 && styles.divOverviewRowBorder,
                  ]}
                  onPress={() => {
                    if (!isMyTeam) {
                      onScoutOpponent(standing.TeamId, standing.TeamName);
                    }
                  }}
                  activeOpacity={isMyTeam ? 1 : 0.7}
                >
                  <Text style={[styles.divOverviewRank, isMyTeam && styles.divOverviewTextHighlight]}>
                    {rank}
                  </Text>
                  <View style={styles.divOverviewTeamCol}>
                    <Text
                      style={[styles.divOverviewTeamName, isMyTeam && styles.divOverviewTextHighlight]}
                      numberOfLines={1}
                    >
                      {standing.TeamText || standing.TeamName}
                      {isMyTeam ? ' ★' : ''}
                    </Text>
                  </View>
                  <Text style={[styles.divOverviewRecord, isMyTeam && styles.divOverviewTextHighlight]}>
                    {standing.MatchesWon}-{standing.MatchesLost}
                  </Text>
                  <Text style={[styles.divOverviewPct, isMyTeam && styles.divOverviewTextHighlight]}>
                    {isNaN(pctVal) ? '0%' : `${pctVal.toFixed(0)}%`}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {divisionStandings.length > 8 && (
              <TouchableOpacity style={styles.divOverviewMore} onPress={onViewStandings} activeOpacity={0.7}>
                <Text style={styles.divOverviewMoreText}>
                  +{divisionStandings.length - 8} more teams — View All
                </Text>
              </TouchableOpacity>
            )}
          </Card>
        </View>
      )}

      <View style={{ height: spacing.xxxl }} />

      <MatchScoresModal
        visible={scoresModalMatch !== null}
        onClose={() => setScoresModalMatch(null)}
        match={scoresModalMatch}
        eventKey={event.Key}
        preloadedResult={
          scoresModalMatch ? matchResults.get(scoresModalMatch.MatchId) ?? null : null
        }
      />
    </ScrollView>

      {/* Styled Share Card overlay */}
      {shareMatch && (() => {
        const isFirst = shareMatch.FirstTeamId === team.TeamId;
        const iWon = isFirst ? shareMatch.FirstTeamWon : shareMatch.SecondTeamWon;
        const opponentText = isFirst ? shareMatch.SecondTeamText : shareMatch.FirstTeamText;
        const opponentName = isFirst ? shareMatch.SecondTeamName : shareMatch.FirstTeamName;
        const matchLabel2 = shareMatch.PlayName || shareMatch.MatchShortName || '';
        // Recalculate medal for this specific match
        const ml = ((shareMatch.PlayName || '') + ' ' + (shareMatch.MatchFullName || '') + ' ' + (shareMatch.MatchShortName || '')).toLowerCase();
        let mEmoji = '';
        let mLabel = '';
        const isGM = ml.includes('gold') || ml.includes('championship') || ml.includes('1st') || ml.includes('1/2') || (ml.includes('final') && !ml.includes('semi') && !ml.includes('quarter'));
        const isBM = ml.includes('bronze') || ml.includes('3rd') || ml.includes('3/4');
        if (isGM) { mEmoji = iWon ? '\u{1F947}' : '\u{1F948}'; mLabel = iWon ? 'GOLD' : 'SILVER'; }
        else if (isBM && iWon) { mEmoji = '\u{1F949}'; mLabel = 'BRONZE'; }

        return (
          <ShareCard
            teamName={current.TeamName}
            clubName={current.TeamClub?.Name ?? ''}
            divisionName={division.Name}
            eventName={event.Name}
            opponentName={opponentText || opponentName || 'TBD'}
            won={!!iWon}
            sets={shareMatch.Sets || []}
            isFirst={isFirst}
            matchLabel={matchLabel2}
            medalEmoji={mEmoji || undefined}
            medalLabel={mLabel || undefined}
            onClose={() => setShareMatch(null)}
          />
        );
      })()}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: spacing.md, fontSize: fontSize.md, color: colors.textSecondary },
  teamHeader: { backgroundColor: colors.primary, padding: spacing.xxl },
  backButton: { marginBottom: spacing.sm },
  backText: { color: 'rgba(255,255,255,0.9)', fontSize: fontSize.md, fontWeight: '600' },
  teamHeaderTop: { flexDirection: 'row', justifyContent: 'space-between' },
  teamHeaderInfo: { flex: 1 },
  teamName: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.textOnPrimary, marginBottom: spacing.xs },
  clubName: { fontSize: fontSize.md, color: 'rgba(255,255,255,0.8)', marginBottom: spacing.xs },
  divisionName: { fontSize: fontSize.sm, color: 'rgba(255,255,255,0.7)' },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  // Single-pill follow toggle (replaces star + season + my-team cluster).
  // White-on-blue when followed; ghost outline when not.
  followPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
  },
  followPillActive: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
  },
  followPillBusy: { opacity: 0.6 },
  followPillText: {
    color: '#ffffff',
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  followPillTextActive: {
    color: colors.primary,
  },
  myTeamButton: { padding: spacing.xs, marginRight: 4 },
  myTeamBadge: {
    fontSize: fontSize.xs,
    color: 'rgba(255,255,255,0.5)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
  },
  myTeamBadgeActive: {
    fontSize: fontSize.xs,
    color: '#ffffff',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
    fontWeight: '700',
  },
  favButton: { padding: spacing.sm },
  favStar: { fontSize: 28, color: 'rgba(255,255,255,0.4)' },
  favStarActive: { fontSize: 28, color: '#fdd835' },
  // Compact pill in the header for "Add to Season History". White-on-blue
  // by default; flips to ghosted state once the event is indexed.
  seasonAddPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: borderRadius.sm,
    marginRight: spacing.xs,
  },
  seasonAddPillDone: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  seasonAddPillText: {
    color: '#fff',
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  seasonAddPillTextDone: {
    color: 'rgba(255,255,255,0.7)',
  },
  statsRow: { flexDirection: 'row', marginTop: spacing.lg },
  statBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    alignItems: 'center',
    marginRight: spacing.xs,
  },
  statValue: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.textOnPrimary },
  statLabel: { fontSize: fontSize.xs, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  section: { padding: spacing.lg },
  sectionTitle: { fontSize: fontSize.xl, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  dayLabel: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // Countdown timer styles
  countdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  countdownText: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.text,
  },
  countdownLive: { color: '#4CAF50' },
  countdownImminent: { color: '#4CAF50' },
  countdownSoon: { color: '#FF9800' },
  countdownCourt: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
  },
  nextMatchTime: { fontSize: fontSize.md, color: colors.textSecondary, marginBottom: spacing.xs },
  nextMatchVs: { fontSize: fontSize.xl, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
  // Head-to-head banner
  h2hBanner: {
    backgroundColor: 'rgba(255, 193, 7, 0.12)',
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: '#FFC107',
  },
  h2hText: {
    fontSize: fontSize.sm,
    color: '#F9A825',
    fontWeight: '600',
  },
  // Performance tiles
  perfRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  perfTile: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  perfTileWide: { flex: 2 },
  perfTileNarrow: { flex: 1, alignItems: 'center' },
  perfTileLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  perfTileValue: {
    fontSize: fontSize.xxxl,
    fontWeight: '800',
    color: colors.text,
  },
  perfTileSub: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  perfWinRateCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  perfWinRateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  perfWinRatePct: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    color: colors.text,
  },
  perfBarTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.divider,
    marginBottom: spacing.xs,
    overflow: 'hidden',
  },
  perfBarFill: {
    height: 8,
    borderRadius: 4,
  },
  perfWinRateSub: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  // Share button
  shareButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
  shareButtonText: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: '600',
  },
  scoutButton: {
    backgroundColor: colors.accentLight,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    alignItems: 'center',
  },
  scoutButtonText: { color: colors.accent, fontWeight: '700', fontSize: fontSize.md },
  matchCard: { marginBottom: spacing.sm },
  matchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  matchTime: { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  courtBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  courtBadgeText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.primary },
  upcomingPoolName: { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.xs },
  scoutHint: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '600', marginTop: spacing.xs },
  matchVs: { fontSize: fontSize.lg, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  matchDate: { fontSize: fontSize.sm, color: colors.textSecondary },
  completedBadge: { fontSize: fontSize.sm, color: colors.win, fontWeight: '600' },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: spacing.xs,
  },
  scoreText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    marginRight: spacing.sm,
  },
  scoreWin: { color: colors.win },
  scoreLoss: { color: colors.textSecondary },
  resultChip: {
    fontSize: fontSize.sm,
    fontWeight: '800',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
    marginLeft: spacing.xs,
  },
  winChip: { backgroundColor: colors.win, color: colors.textOnPrimary },
  lossChip: { backgroundColor: colors.error, color: colors.textOnPrimary },
  medalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  medalEmoji: { fontSize: 18, marginRight: 4, lineHeight: 22 },
  medalLabel: { fontSize: fontSize.xs, fontWeight: '800', color: '#ffffff' },
  noData: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center', padding: spacing.lg },
  actionButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  actionButtonBracket: {
    backgroundColor: colors.accent,
  },
  actionButtonSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  actionButtonSecondaryDisabled: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  actionButtonText: { color: colors.textOnPrimary, fontSize: fontSize.lg, fontWeight: '600' },
  actionButtonTextSecondary: { color: colors.primary, fontSize: fontSize.lg, fontWeight: '600' },
  playoffBadge: {
    backgroundColor: colors.accent,
    alignSelf: 'flex-start',
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginBottom: spacing.sm,
  },
  playoffBadgeText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.xs,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  viewBracketHint: {
    fontSize: fontSize.sm,
    color: colors.accent,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  viewBracketButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    alignItems: 'center',
  },
  viewBracketButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.primary,
  },
  lastUpdated: {
    fontSize: fontSize.xs,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  updateBanner: {
    // `top` is patched at render time from insets.top + 56 so the
    // toast clears both the status bar AND the global TopBar /
    // Hamburger overlay zone. Keeping it out of this style block
    // forces the call site to supply it consciously.
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 20,
    backgroundColor: 'rgba(76, 175, 80, 0.95)',
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  updateBannerText: {
    color: '#ffffff',
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  // Work Duty Banner
  workDutyBanner: {
    backgroundColor: '#FFF3E0',
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
  },
  workDutyIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  workDutyIcon: {
    fontSize: 18,
    marginRight: spacing.sm,
  },
  workDutyTitle: {
    fontSize: fontSize.md,
    fontWeight: '800',
    color: '#E65100',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  workDutyText: {
    fontSize: fontSize.md,
    color: '#BF360C',
    lineHeight: 20,
  },
  workDutyExtra: {
    fontSize: fontSize.sm,
    color: '#E65100',
    marginTop: spacing.xs,
    fontWeight: '600',
  },
  // Leaderboard Card
  leaderboardCard: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leaderboardRankCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  leaderboardRankText: {
    fontSize: fontSize.xxl,
    fontWeight: '900',
    color: '#ffffff',
  },
  leaderboardInfo: {
    flex: 1,
  },
  leaderboardLabel: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  leaderboardSub: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  leaderboardBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.divider,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  leaderboardBarFill: {
    height: 6,
    borderRadius: 3,
  },
  // Division Overview Card
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  seeAllText: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: '600',
  },
  divOverviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.sm,
    marginBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  divOverviewHeaderRank: {
    width: 28,
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  divOverviewHeaderTeam: {
    flex: 1,
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textSecondary,
    paddingLeft: spacing.sm,
  },
  divOverviewHeaderRecord: {
    width: 44,
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  divOverviewHeaderPct: {
    width: 40,
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textSecondary,
    textAlign: 'right',
  },
  divOverviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  divOverviewRowHighlight: {
    backgroundColor: `${colors.primary}15`,
    marginHorizontal: -spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
  },
  divOverviewRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  divOverviewRank: {
    width: 28,
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  divOverviewTeamCol: {
    flex: 1,
    paddingLeft: spacing.sm,
  },
  divOverviewTeamName: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  divOverviewRecord: {
    width: 44,
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  divOverviewPct: {
    width: 40,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'right',
  },
  divOverviewTextHighlight: {
    color: colors.primary,
    fontWeight: '800',
  },
  divOverviewMore: {
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  divOverviewMoreText: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: '600',
  },
  // Day Filter Pills
  dayFilterRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  dayFilterPill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayFilterPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dayFilterText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  dayFilterTextActive: {
    color: '#ffffff',
  },
});
}
