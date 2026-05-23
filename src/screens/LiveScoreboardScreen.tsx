// Live Scoreboard — division-wide match tracking with 60s polling
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  AppState,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import {
  getCourtSchedule,
  flattenCourtSchedule,
  filterMatchesForDivision,
  getAllDivisionMatchResults,
} from '../api/aesClient';
import type {
  FlatCourtMatch,
  MatchResult,
  CourtScheduleResponse,
} from '../api/aesClient';
import type { AESEvent, AESDivision } from '../types/aes';
import { parseScheduleTime, todayApiDate, formatMatchTime } from '../utils/dates';
import { loadAesSeasonIndex, aesSnapshotKey } from '../utils/aesSeasonIndex';
import { useTzDisplayMode, effectiveTzForDisplay } from '../utils/tzDisplayPreference';

interface Props {
  event: AESEvent;
  division: AESDivision;
  myTeamId?: number;
  myTeamText?: string;
  onBack: () => void;
  onTeamPress?: (divisionId: number, teamText: string) => void;
}

export function LiveScoreboardScreen({
  event,
  division,
  myTeamId,
  myTeamText,
  onBack,
  onTeamPress,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [matches, setMatches] = useState<FlatCourtMatch[]>([]);
  const [results, setResults] = useState<Map<number, MatchResult>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [venueTimeZone, setVenueTimeZone] = useState<string | undefined>(undefined);
  const [tzMode] = useTzDisplayMode();
  const displayTz = effectiveTzForDisplay(tzMode, venueTimeZone);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadAesSeasonIndex().then((idx) => {
      const snap = idx[aesSnapshotKey(event.Key, division.DivisionId)];
      setVenueTimeZone(snap?.venueTimeZone);
    });
  }, [event.Key, division.DivisionId]);

  // Tick for live time display
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Re-load when the venue tz becomes known: if we built the first request
  // before the snapshot lookup landed we'd have keyed off device-local; a
  // background refresh keeps the display tied to the venue's calendar.
  // (See loadData below — gated on venueTimeZone.)

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Today's date in the venue's calendar — `toISOString().split('T')[0]`
      // returns UTC, which can roll back to "yesterday" for users west of
      // UTC late at night and miss the current day's matches. Use
      // `todayApiDate(venueTimeZone)` which respects the venue's calendar
      // when known, falling back to device-local otherwise.
      const today = todayApiDate(venueTimeZone);
      const scheduleData = await getCourtSchedule(event.Key, today);
      const flat = flattenCourtSchedule(scheduleData);
      const divMatches = filterMatchesForDivision(flat, division.DivisionId);
      setMatches(divMatches);

      // Enrich with set scores
      const scoreMap = await getAllDivisionMatchResults(event.Key, division.DivisionId);
      setResults(scoreMap);
      setLastUpdate(Date.now());
    } catch (err) {
      console.warn('Scoreboard load failed:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [event.Key, division.DivisionId, venueTimeZone]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Poll every 60s
  useEffect(() => {
    pollRef.current = setInterval(() => loadData(true), 60_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') loadData(true);
    });
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      sub.remove();
    };
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  }, [loadData]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading scoreboard...</Text>
      </View>
    );
  }

  // Categorize matches
  const liveMatches: FlatCourtMatch[] = [];
  const upcomingMatches: FlatCourtMatch[] = [];
  const completedMatches: FlatCourtMatch[] = [];

  for (const m of matches) {
    // AES returns these as tz-less ISO strings — run them through
    // `parseScheduleTime(venueTimeZone)` to get a venue-anchored epoch.
    // Without venueTimeZone we fall back to device-local, which is the
    // legacy behaviour. Either branch yields a number for the `now`
    // comparisons below.
    const startMs = parseScheduleTime(m.ScheduledStartDateTime, venueTimeZone);
    const endMs = parseScheduleTime(m.ScheduledEndDateTime, venueTimeZone);
    if (m.HasOutcome) {
      completedMatches.push(m);
    } else if (startMs != null && endMs != null && now >= startMs && now <= endMs + 30 * 60_000) {
      // Consider "live" if between start and 30min after scheduled end
      liveMatches.push(m);
    } else if (startMs != null && now < startMs) {
      upcomingMatches.push(m);
    } else {
      completedMatches.push(m);
    }
  }

  function isMyTeamMatch(m: FlatCourtMatch): boolean {
    if (!myTeamText) return false;
    const search = myTeamText.toLowerCase().trim();
    return (
      m.FirstTeamText.toLowerCase().trim() === search ||
      m.SecondTeamText.toLowerCase().trim() === search
    );
  }

  function renderMatch(m: FlatCourtMatch, isLive: boolean) {
    const result = results.get(m.MatchId);
    const isMine = isMyTeamMatch(m);
    const sets = result?.Sets?.filter((s) => s.FirstTeamScore != null) || [];

    return (
      <View
        key={m.MatchId}
        style={[
          styles.matchCard,
          isLive && styles.matchCardLive,
          isMine && styles.matchCardMine,
        ]}
      >
        {/* Court & time header */}
        <View style={styles.matchMeta}>
          <Text style={styles.matchCourt}>{m.CourtName}</Text>
          <Text style={styles.matchTime}>
            {formatMatchTime(m.ScheduledStartDateTime, venueTimeZone, tzMode, displayTz)}
          </Text>
          {isLive && <View style={styles.liveDot} />}
          {m.CompleteShortName ? (
            <Text style={styles.matchRound} numberOfLines={1}>{m.CompleteShortName}</Text>
          ) : null}
        </View>

        {/* Teams & scores */}
        <View style={styles.teamsRow}>
          <TouchableOpacity
            style={styles.teamCol}
            disabled={!onTeamPress}
            onPress={() => onTeamPress?.(division.DivisionId, m.FirstTeamText)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.teamText,
                result?.FirstTeamWon && styles.teamTextWinner,
                m.FirstTeamText.toLowerCase().trim() === (myTeamText || '').toLowerCase().trim() && styles.teamTextMine,
              ]}
              numberOfLines={1}
            >
              {m.FirstTeamText}
            </Text>
          </TouchableOpacity>

          {sets.length > 0 ? (
            <View style={styles.scoresCol}>
              {sets.map((s, i) => (
                <View key={i} style={styles.setScore}>
                  <Text style={[
                    styles.setScoreNum,
                    (s.FirstTeamScore ?? 0) > (s.SecondTeamScore ?? 0) && styles.setScoreWin,
                  ]}>
                    {s.FirstTeamScore}
                  </Text>
                  <Text style={styles.setScoreDash}>-</Text>
                  <Text style={[
                    styles.setScoreNum,
                    (s.SecondTeamScore ?? 0) > (s.FirstTeamScore ?? 0) && styles.setScoreWin,
                  ]}>
                    {s.SecondTeamScore}
                  </Text>
                </View>
              ))}
            </View>
          ) : isLive ? (
            <Text style={styles.liveLabel}>LIVE</Text>
          ) : m.HasOutcome ? (
            <Text style={styles.completedLabel}>Final</Text>
          ) : (
            <Text style={styles.vsLabel}>vs</Text>
          )}

          <TouchableOpacity
            style={[styles.teamCol, { alignItems: 'flex-end' }]}
            disabled={!onTeamPress}
            onPress={() => onTeamPress?.(division.DivisionId, m.SecondTeamText)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.teamText,
                result?.SecondTeamWon && styles.teamTextWinner,
                m.SecondTeamText.toLowerCase().trim() === (myTeamText || '').toLowerCase().trim() && styles.teamTextMine,
              ]}
              numberOfLines={1}
            >
              {m.SecondTeamText}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const minsAgo = Math.round((now - lastUpdate) / 60000);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Live Scoreboard</Text>
        <Text style={styles.subtitle}>
          {division.Name} — {minsAgo === 0 ? 'Just updated' : `Updated ${minsAgo}m ago`}
        </Text>
      </View>

      {/* Live matches */}
      {liveMatches.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.liveDotLarge} />
            <Text style={styles.sectionTitle}>In Progress ({liveMatches.length})</Text>
          </View>
          {liveMatches.map((m) => renderMatch(m, true))}
        </View>
      )}

      {/* Upcoming */}
      {upcomingMatches.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Coming Up ({upcomingMatches.length})</Text>
          {upcomingMatches.map((m) => renderMatch(m, false))}
        </View>
      )}

      {/* Completed */}
      {completedMatches.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Completed ({completedMatches.length})</Text>
          {completedMatches.map((m) => renderMatch(m, false))}
        </View>
      )}

      {matches.length === 0 && (
        <View style={styles.section}>
          <Text style={styles.noData}>No matches scheduled for today in {division.Name}.</Text>
        </View>
      )}

      <View style={{ height: 60 }} />
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  loadingText: { marginTop: spacing.md, fontSize: fontSize.md, color: colors.textSecondary },
  header: {
    padding: spacing.lg,
    paddingTop: spacing.xl,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  backText: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600', marginBottom: spacing.sm },
  title: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  section: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  // Match card
  matchCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  matchCardLive: {
    borderColor: colors.success,
    borderWidth: 2,
  },
  matchCardMine: {
    backgroundColor: 'rgba(26, 115, 232, 0.06)',
  },
  matchMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  matchCourt: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: 'rgba(26, 115, 232, 0.1)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
  },
  matchTime: { fontSize: fontSize.sm, color: colors.textSecondary },
  matchRound: { fontSize: fontSize.xs, color: colors.textLight, flex: 1, textAlign: 'right' },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  liveDotLarge: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
    marginRight: spacing.sm,
  },
  teamsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  teamCol: { flex: 1 },
  teamText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  teamTextWinner: { fontWeight: '800' },
  teamTextMine: { color: colors.primary },
  scoresCol: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  setScore: { flexDirection: 'row', alignItems: 'center' },
  setScoreNum: { fontSize: fontSize.md, fontWeight: '600', color: colors.textSecondary, minWidth: 16, textAlign: 'center' },
  setScoreWin: { color: colors.success, fontWeight: '800' },
  setScoreDash: { fontSize: fontSize.sm, color: colors.textLight, marginHorizontal: 1 },
  vsLabel: { fontSize: fontSize.sm, color: colors.textLight, paddingHorizontal: spacing.md },
  liveLabel: {
    fontSize: fontSize.sm,
    fontWeight: '800',
    color: colors.success,
    paddingHorizontal: spacing.md,
  },
  completedLabel: {
    fontSize: fontSize.sm,
    color: colors.textLight,
    paddingHorizontal: spacing.md,
  },
  noData: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center', padding: spacing.xl },
});
}
