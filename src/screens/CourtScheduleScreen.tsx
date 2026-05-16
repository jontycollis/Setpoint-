import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import {
  getCourtSchedule,
  getUtilizedDates,
  flattenCourtSchedule,
  getAllDivisionMatchResults,
  getTeamCurrentSchedule,
  getTeamPastSchedule,
  extractAllScheduleMatches,
} from '../api/aesClient';
import type {
  UtilizedDate,
  FlatCourtMatch,
  MatchResult,
} from '../api/aesClient';
import { formatDate, formatTime } from '../utils/dates';
import { loadCourtStreams, CourtStreamMap } from '../utils/storage';
import { loadAesSeasonIndex, aesSnapshotKey } from '../utils/aesSeasonIndex';
import { useTzDisplayMode, effectiveTzForDisplay } from '../utils/tzDisplayPreference';
import type { AESEvent } from '../types/aes';
import { WatchLiveButton } from '../components/WatchLiveButton';
import { CourtStreamConfig } from '../components/CourtStreamConfig';

interface Props {
  event: AESEvent;
  myTeamId?: number;
  myTeamText?: string;
  myDivisionId?: number;
  onBack: () => void;
  onTeamPress?: (divisionId: number, teamText: string) => void;
}

export function CourtScheduleScreen({
  event,
  myTeamId,
  myTeamText,
  myDivisionId,
  onBack,
  onTeamPress,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [dates, setDates] = useState<UtilizedDate[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [allMatches, setAllMatches] = useState<FlatCourtMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Map of MatchId → MatchResult for displaying scores
  const [scoreMap, setScoreMap] = useState<Map<number, MatchResult>>(new Map());
  const [loadingScores, setLoadingScores] = useState(false);
  // Court stream URL configuration
  const [courtStreamMap, setCourtStreamMap] = useState<CourtStreamMap>({});
  // Venue tz for display — pulled from any indexed snapshot for this event.
  // The court schedule screen is event-scoped (not division-scoped), so we
  // pick the first indexed division as the source of truth (all divisions
  // in a single event share a venue).
  const [venueTimeZone, setVenueTimeZone] = useState<string | undefined>(undefined);
  const [tzMode] = useTzDisplayMode();
  const displayTz = effectiveTzForDisplay(tzMode, venueTimeZone);
  useEffect(() => {
    loadAesSeasonIndex().then((idx) => {
      const match = Object.values(idx).find((snap) => snap.eventKey === event.Key);
      setVenueTimeZone(match?.venueTimeZone);
    });
  }, [event.Key]);
  const [showStreamConfig, setShowStreamConfig] = useState(false);

  useEffect(() => {
    loadDates();
    loadCourtStreams(event.Key).then(setCourtStreamMap);
  }, []);

  useEffect(() => {
    if (selectedDate) loadSchedule(selectedDate);
  }, [selectedDate]);

  async function loadDates() {
    try {
      const utilDates = await getUtilizedDates(event.Key);
      setDates(utilDates);
      const current = utilDates.find((d) => d.IsCurrent);
      setSelectedDate(current?.DateTime || utilDates[0]?.DateTime || '');
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  async function loadSchedule(date: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await getCourtSchedule(event.Key, date);
      const flat = flattenCourtSchedule(data);
      setAllMatches(flat);
      // Fetch scores for completed matches
      loadScoresForMatches(flat);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadScoresForMatches(matches: FlatCourtMatch[]) {
    const hasCompleted = matches.some((m) => m.HasOutcome);
    if (!hasCompleted) return;

    setLoadingScores(true);
    const combined = new Map<number, MatchResult>();

    try {
      // Strategy 1: Use the team schedule endpoints for the user's own team
      // These are the most reliable source of set scores
      if (myTeamId && myDivisionId) {
        try {
          const [currentSched, pastSched] = await Promise.all([
            getTeamCurrentSchedule(event.Key, myDivisionId, myTeamId).catch(() => []),
            getTeamPastSchedule(event.Key, myDivisionId, myTeamId).catch(() => []),
          ]);
          const allSchedMatches = extractAllScheduleMatches(currentSched, pastSched);
          for (const m of allSchedMatches) {
            if (m.HasScores && m.MatchId) {
              combined.set(m.MatchId, {
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
        } catch {
          // Team schedule failed, continue with other strategies
        }
      }

      // Strategy 2: For all divisions with completed matches, try getAllDivisionMatchResults
      // This picks up bracket scores and any pool scores that are available
      const completedDivisions = new Set<number>();
      for (const m of matches) {
        if (m.HasOutcome && m.Division?.DivisionId && !combined.has(m.MatchId)) {
          completedDivisions.add(m.Division.DivisionId);
        }
      }

      if (completedDivisions.size > 0) {
        const promises = Array.from(completedDivisions).map(async (divId) => {
          try {
            const divResults = await getAllDivisionMatchResults(event.Key, divId);
            divResults.forEach((result, matchId) => {
              if (!combined.has(matchId)) {
                combined.set(matchId, result);
              }
            });
          } catch {
            // Skip division on error
          }
        });
        await Promise.all(promises);
      }

      setScoreMap(combined);
    } catch {
      // Silently fail — scores just won't show
    } finally {
      setLoadingScores(false);
    }
  }

  // Group matches by court name
  const courtGroups: Record<string, FlatCourtMatch[]> = {};
  allMatches.forEach((match) => {
    const courtName = match.CourtName || 'Unknown';
    if (!courtGroups[courtName]) courtGroups[courtName] = [];
    courtGroups[courtName].push(match);
  });

  function isMyTeamMatch(match: FlatCourtMatch): boolean {
    if (!myTeamText) return false;
    const search = myTeamText.toLowerCase();
    return (
      match.FirstTeamText.toLowerCase() === search ||
      match.SecondTeamText.toLowerCase() === search
    );
  }

  function isMyTeamText(teamText: string): boolean {
    if (!myTeamText) return false;
    return teamText.toLowerCase() === myTeamText.toLowerCase();
  }

  function handleTeamPress(divisionId: number, teamText: string) {
    if (!onTeamPress) return;
    if (isMyTeamText(teamText)) return; // Don't navigate to own team
    onTeamPress(divisionId, teamText);
  }

  function renderScores(matchId: number): React.ReactNode {
    const result = scoreMap.get(matchId);
    if (!result || !result.HasScores || result.Sets.length === 0) return null;

    return (
      <View style={styles.scoresRow}>
        {result.Sets.map((set, idx) => {
          const s1 = set.FirstTeamScore ?? 0;
          const s2 = set.SecondTeamScore ?? 0;
          return (
            <View key={idx} style={styles.setScore}>
              <Text
                style={[
                  styles.setScoreText,
                  s1 > s2 && styles.setScoreWinner,
                ]}
              >
                {set.FirstTeamScore ?? '-'}
              </Text>
              <Text style={styles.setScoreDash}>-</Text>
              <Text
                style={[
                  styles.setScoreText,
                  s2 > s1 && styles.setScoreWinner,
                ]}
              >
                {set.SecondTeamScore ?? '-'}
              </Text>
            </View>
          );
        })}
      </View>
    );
  }

  function renderTeamName(
    teamText: string,
    divisionId: number,
    isFirst: boolean,
    matchResult?: MatchResult
  ): React.ReactNode {
    const isMine = isMyTeamText(teamText);
    const canTap = onTeamPress && !isMine;
    const won = matchResult
      ? isFirst
        ? matchResult.FirstTeamWon
        : matchResult.SecondTeamWon
      : false;

    const textStyle = [
      styles.teamNameText,
      isMine && styles.teamNameMe,
      canTap && styles.teamNameTappable,
      won && styles.teamNameWinner,
    ];

    if (canTap) {
      return (
        <TouchableOpacity
          onPress={() => handleTeamPress(divisionId, teamText)}
          activeOpacity={0.6}
        >
          <Text style={textStyle} numberOfLines={1}>
            {teamText}
          </Text>
        </TouchableOpacity>
      );
    }

    return (
      <Text style={textStyle} numberOfLines={1}>
        {teamText}
      </Text>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Court Schedule</Text>
          {!loading && allMatches.length > 0 && (
            <TouchableOpacity
              style={styles.streamConfigBtn}
              onPress={() => setShowStreamConfig(true)}
            >
              <Text style={styles.streamConfigBtnText}>
                {Object.keys(courtStreamMap).length > 0 ? '📹 Streams' : '+ Streams'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Date Selector */}
      <ScrollView
        horizontal
        style={styles.datePicker}
        showsHorizontalScrollIndicator={false}
      >
        {dates.map((dateObj) => (
          <TouchableOpacity
            key={dateObj.DateTime}
            style={[
              styles.dateChip,
              selectedDate === dateObj.DateTime && styles.dateChipActive,
            ]}
            onPress={() => setSelectedDate(dateObj.DateTime)}
          >
            <Text
              style={[
                styles.dateChipText,
                selectedDate === dateObj.DateTime && styles.dateChipTextActive,
              ]}
            >
              {formatDate(dateObj.DateTime)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {error && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView style={styles.scheduleScroll}>
          {Object.entries(courtGroups).map(([courtName, matches]) => {
            const videoLink = matches[0]?.CourtVideoLink || courtStreamMap[courtName] || '';
            return (
              <View key={courtName} style={styles.courtSection}>
                <View style={styles.courtHeader}>
                  <Text style={styles.courtName}>{courtName}</Text>
                  <WatchLiveButton videoLink={videoLink} compact />
                </View>
                {matches.map((match) => {
                  const isMyMatch = isMyTeamMatch(match);
                  const result = scoreMap.get(match.MatchId);
                  const hasScores = result?.HasScores && (result?.Sets?.length ?? 0) > 0;
                  return (
                    <View
                      key={match.MatchId}
                      style={[
                        styles.scheduleEntry,
                        isMyMatch && styles.scheduleEntryHighlight,
                        hasScores && styles.scheduleEntryCompleted,
                      ]}
                    >
                      <View style={styles.entryLeft}>
                        <Text style={styles.entryTime}>
                          {formatTime(match.ScheduledStartDateTime, displayTz)}
                        </Text>
                        {match.HasOutcome && !hasScores && (
                          <View style={styles.completedDot} />
                        )}
                      </View>
                      <View style={styles.entryDetails}>
                        <Text style={styles.entryDivision} numberOfLines={1}>
                          {match.Division.Name}
                          {match.CompleteShortName
                            ? ` — ${match.CompleteShortName}`
                            : ''}
                        </Text>
                        <View style={styles.teamsContainer}>
                          {renderTeamName(
                            match.FirstTeamText,
                            match.Division.DivisionId,
                            true,
                            result
                          )}
                          <Text style={styles.vsText}> vs </Text>
                          {renderTeamName(
                            match.SecondTeamText,
                            match.Division.DivisionId,
                            false,
                            result
                          )}
                        </View>
                        {hasScores && renderScores(match.MatchId)}
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })}

          {allMatches.length === 0 && !error && (
            <View style={styles.centered}>
              <Text style={styles.noData}>
                No court schedule available for this date.
              </Text>
            </View>
          )}

          <View style={{ height: spacing.xxxl }} />
        </ScrollView>
      )}

      <CourtStreamConfig
        visible={showStreamConfig}
        onClose={() => {
          setShowStreamConfig(false);
          // Reload saved streams after config closes
          loadCourtStreams(event.Key).then(setCourtStreamMap);
        }}
        eventKey={event.Key}
        courtNames={Object.keys(courtGroups).sort()}
      />
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.lg },
  backText: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.text, flex: 1 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  streamConfigBtn: {
    backgroundColor: colors.primaryLight,
    borderRadius: borderRadius.sm,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
  },
  streamConfigBtnText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.primary,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  errorText: {
    fontSize: fontSize.md,
    color: colors.loss,
    textAlign: 'center',
  },
  datePicker: {
    flexGrow: 0,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  dateChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.background,
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dateChipText: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
  dateChipTextActive: { color: colors.textOnPrimary, fontWeight: '700' },
  scheduleScroll: { flex: 1 },
  courtSection: { marginBottom: spacing.md },
  courtHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  courtName: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.primary,
    flex: 1,
  },
  scheduleEntry: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  scheduleEntryHighlight: {
    backgroundColor: '#fff8e1',
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  scheduleEntryCompleted: {
    backgroundColor: '#f5f5f5',
  },
  entryLeft: {
    width: 70,
    alignItems: 'center',
    paddingTop: 2,
  },
  entryTime: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  entryDetails: { flex: 1 },
  entryDivision: { fontSize: fontSize.xs, color: colors.textLight },
  teamsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 2,
  },
  teamNameText: {
    fontSize: fontSize.sm,
    color: colors.text,
  },
  teamNameMe: {
    fontWeight: '700',
    color: colors.primary,
  },
  teamNameTappable: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  teamNameWinner: {
    fontWeight: '700',
  },
  vsText: {
    fontSize: fontSize.sm,
    color: colors.textLight,
  },
  // Score display
  scoresRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    flexWrap: 'wrap',
  },
  setScore: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginRight: 6,
    marginBottom: 2,
  },
  setScoreText: {
    fontSize: fontSize.xs,
    color: colors.text,
    minWidth: 14,
    textAlign: 'center',
  },
  setScoreDash: {
    fontSize: fontSize.xs,
    color: colors.textLight,
    marginHorizontal: 1,
  },
  setScoreWinner: {
    fontWeight: '700',
  },
  completedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.win,
    marginTop: 4,
  },
  noData: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
}
