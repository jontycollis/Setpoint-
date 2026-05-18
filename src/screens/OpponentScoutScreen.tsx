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
  getTeamCurrentSchedule,
  getTeamPastSchedule,
  extractAllScheduleMatches,
} from '../api/aesClient';
import type { TeamScheduleMatch, MatchResult, MatchSet } from '../api/aesClient';
import { Card } from '../components/Card';
import { formatTime, formatDate, parseScheduleTime, formatDualTime, formatDualDate } from '../utils/dates';
import { aesSnapshotKey, loadAesSeasonIndex } from '../utils/aesSeasonIndex';
import { useTzDisplayMode, effectiveTzForDisplay } from '../utils/tzDisplayPreference';
import type { AESEvent, AESDivision } from '../types/aes';

interface Props {
  event: AESEvent;
  division: AESDivision;
  opponentTeamId: number;
  opponentName: string;
  onBack: () => void;
}

/** Computed tournament-wide stats for the opponent */
interface OpponentStats {
  matchWins: number;
  matchLosses: number;
  setsWon: number;
  setsLost: number;
  // Deep-dive stats
  avgPointsScored: number;
  avgPointsConceded: number;
  totalPointsScored: number;
  totalPointsConceded: number;
  totalSetsPlayed: number;
  closeSets: number; // sets decided by 3 or fewer pts
  blowoutSets: number; // sets won/lost by 8+ pts
  bestSetScore: number; // highest single-set score
  worstSetScore: number; // lowest single-set score
  currentStreak: { count: number; type: 'W' | 'L' } | null;
  setDistribution: { won2_0: number; won2_1: number; lost0_2: number; lost1_2: number };
}

function computeStats(
  matches: TeamScheduleMatch[],
  teamId: number,
  venueTz: string | undefined
): OpponentStats {
  let matchWins = 0,
    matchLosses = 0,
    setsWon = 0,
    setsLost = 0,
    totalPtsFor = 0,
    totalPtsAgainst = 0,
    totalSetsPlayed = 0,
    closeSets = 0,
    blowoutSets = 0,
    bestSetScore = 0,
    worstSetScore = 999;

  const setDistribution = { won2_0: 0, won2_1: 0, lost0_2: 0, lost1_2: 0 };

  // For streak, process in chronological order
  const sorted = [...matches].filter((m) => m.HasScores).sort(
    (a, b) =>
      (parseScheduleTime(a.ScheduledStartDateTime, venueTz) ?? 0) -
      (parseScheduleTime(b.ScheduledStartDateTime, venueTz) ?? 0)
  );

  let streakCount = 0;
  let streakType: 'W' | 'L' | null = null;

  for (const m of sorted) {
    const isFirst = m.FirstTeamId === teamId;
    const won = isFirst ? m.FirstTeamWon : m.SecondTeamWon;
    if (won) matchWins++;
    else matchLosses++;

    // Streak tracking
    const thisType = won ? 'W' : 'L';
    if (thisType === streakType) {
      streakCount++;
    } else {
      streakType = thisType;
      streakCount = 1;
    }

    let matchSetsWon = 0;
    let matchSetsLost = 0;
    for (const s of m.Sets) {
      if (s.FirstTeamScore == null || s.SecondTeamScore == null) continue;
      const myScore = isFirst ? s.FirstTeamScore : s.SecondTeamScore;
      const oppScore = isFirst ? s.SecondTeamScore : s.FirstTeamScore;
      totalPtsFor += myScore;
      totalPtsAgainst += oppScore;
      totalSetsPlayed++;
      if (myScore > oppScore) { setsWon++; matchSetsWon++; }
      else if (oppScore > myScore) { setsLost++; matchSetsLost++; }
      const diff = Math.abs(myScore - oppScore);
      if (diff <= 3) closeSets++;
      if (diff >= 8) blowoutSets++;
      if (myScore > bestSetScore) bestSetScore = myScore;
      if (myScore < worstSetScore) worstSetScore = myScore;
    }

    // Set distribution
    if (won) {
      if (matchSetsLost === 0) setDistribution.won2_0++;
      else setDistribution.won2_1++;
    } else {
      if (matchSetsWon === 0) setDistribution.lost0_2++;
      else setDistribution.lost1_2++;
    }
  }

  return {
    matchWins,
    matchLosses,
    setsWon,
    setsLost,
    avgPointsScored: totalSetsPlayed > 0 ? totalPtsFor / totalSetsPlayed : 0,
    avgPointsConceded: totalSetsPlayed > 0 ? totalPtsAgainst / totalSetsPlayed : 0,
    totalPointsScored: totalPtsFor,
    totalPointsConceded: totalPtsAgainst,
    totalSetsPlayed,
    closeSets,
    blowoutSets,
    bestSetScore: bestSetScore > 0 ? bestSetScore : 0,
    worstSetScore: worstSetScore < 999 ? worstSetScore : 0,
    currentStreak: streakType ? { count: streakCount, type: streakType } : null,
    setDistribution,
  };
}

export function OpponentScoutScreen({
  event,
  division,
  opponentTeamId,
  opponentName,
  onBack,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [allMatches, setAllMatches] = useState<TeamScheduleMatch[]>([]);
  const [stats, setStats] = useState<OpponentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMatch, setSelectedMatch] = useState<TeamScheduleMatch | null>(null);
  const [venueTimeZone, setVenueTimeZone] = useState<string | undefined>(undefined);
  const [tzMode] = useTzDisplayMode();
  const displayTz = effectiveTzForDisplay(tzMode, venueTimeZone);

  useEffect(() => {
    // Pull the AES snapshot for this (event, division) so we can interpret
    // schedule strings in the venue's tz. If no snapshot exists yet we
    // fall back to device-local, matching pre-overhaul behaviour.
    loadAesSeasonIndex().then((idx) => {
      const snap = idx[aesSnapshotKey(event.Key, division.DivisionId)];
      setVenueTimeZone(snap?.venueTimeZone);
    });
    loadOpponentData();
  }, []);

  async function loadOpponentData() {
    setLoading(true);
    try {
      const [currentSched, pastSched] = await Promise.all([
        getTeamCurrentSchedule(event.Key, division.DivisionId, opponentTeamId).catch(() => []),
        getTeamPastSchedule(event.Key, division.DivisionId, opponentTeamId).catch(() => []),
      ]);
      const matches = extractAllScheduleMatches(currentSched, pastSched);
      // Sort by time ascending — tz-aware so cross-day boundaries near
      // midnight don't reorder near-simultaneous matches between venues.
      matches.sort(
        (a, b) =>
          (parseScheduleTime(a.ScheduledStartDateTime, venueTimeZone) ?? 0) -
          (parseScheduleTime(b.ScheduledStartDateTime, venueTimeZone) ?? 0)
      );
      setAllMatches(matches);
      setStats(computeStats(matches, opponentTeamId, venueTimeZone));
    } catch {
      // all data unavailable
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Scouting {opponentName}...</Text>
      </View>
    );
  }

  const completedMatches = allMatches.filter((m) => m.HasScores);
  const upcomingMatches = allMatches.filter((m) => !m.HasScores);

  function renderSetScores(match: TeamScheduleMatch) {
    const isFirst = match.FirstTeamId === opponentTeamId;
    const sets = match.Sets.filter(
      (s) => s.FirstTeamScore != null || s.SecondTeamScore != null
    );
    if (sets.length === 0) return null;
    const won = isFirst ? match.FirstTeamWon : match.SecondTeamWon;
    return (
      <View style={styles.scoreRow}>
        {sets.map((s, idx) => {
          const my = isFirst ? s.FirstTeamScore : s.SecondTeamScore;
          const opp = isFirst ? s.SecondTeamScore : s.FirstTeamScore;
          const setWon = (my ?? 0) > (opp ?? 0);
          return (
            <Text
              key={idx}
              style={[
                styles.scoreText,
                setWon ? styles.scoreWin : styles.scoreLoss,
              ]}
            >
              {my}-{opp}
            </Text>
          );
        })}
        <Text style={[styles.resultChip, won ? styles.winChip : styles.lossChip]}>
          {won ? 'W' : 'L'}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.scoutLabel}>OPPONENT SCOUTING REPORT</Text>
        <Text style={styles.opponentNameText}>{opponentName}</Text>
        <Text style={styles.divisionNameText}>{division.Name}</Text>
      </View>

      {/* Tournament Stats */}
      {stats && (stats.matchWins > 0 || stats.matchLosses > 0) && (
        <View style={styles.statsSection}>
          <View style={styles.statsGrid}>
            <Card style={styles.statCard}>
              <Text style={styles.statValue}>{stats.matchWins}</Text>
              <Text style={styles.statLabel}>Match Wins</Text>
            </Card>
            <Card style={styles.statCard}>
              <Text style={[styles.statValue, { color: colors.loss }]}>{stats.matchLosses}</Text>
              <Text style={styles.statLabel}>Match Losses</Text>
            </Card>
          </View>
          <View style={styles.statsGrid}>
            <Card style={styles.statCard}>
              <Text style={styles.statValue}>{stats.setsWon}</Text>
              <Text style={styles.statLabel}>Sets Won</Text>
            </Card>
            <Card style={styles.statCard}>
              <Text style={[styles.statValue, { color: colors.loss }]}>{stats.setsLost}</Text>
              <Text style={styles.statLabel}>Sets Lost</Text>
            </Card>
          </View>

          <Card>
            <View style={styles.winRateRow}>
              <Text style={styles.winRateLabel}>Match Win Rate</Text>
              <Text style={styles.winRateValue}>
                {stats.matchWins + stats.matchLosses > 0
                  ? `${Math.round(
                      (stats.matchWins / (stats.matchWins + stats.matchLosses)) * 100
                    )}%`
                  : 'N/A'}
              </Text>
            </View>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${
                      stats.matchWins + stats.matchLosses > 0
                        ? (stats.matchWins / (stats.matchWins + stats.matchLosses)) * 100
                        : 0
                    }%`,
                  },
                ]}
              />
            </View>
          </Card>

          {/* Streak */}
          {stats.currentStreak && stats.currentStreak.count >= 1 && (
            <Card style={{ marginTop: spacing.sm }}>
              <View style={styles.winRateRow}>
                <Text style={styles.winRateLabel}>Current Streak</Text>
                <Text style={[
                  styles.winRateValue,
                  stats.currentStreak.type === 'W'
                    ? { color: colors.win }
                    : { color: colors.loss },
                ]}>
                  {stats.currentStreak.count}{stats.currentStreak.type}
                </Text>
              </View>
            </Card>
          )}

          {/* Scoring Deep Dive */}
          {stats.totalSetsPlayed > 0 && (
            <View style={{ marginTop: spacing.lg }}>
              <Text style={styles.sectionTitle}>Scoring Analysis</Text>

              {/* Avg scoring */}
              <Card style={{ marginBottom: spacing.sm }}>
                <View style={styles.deepDiveRow}>
                  <View style={styles.deepDiveStat}>
                    <Text style={styles.deepDiveValue}>{stats.avgPointsScored.toFixed(1)}</Text>
                    <Text style={styles.deepDiveLabel}>Avg Scored/Set</Text>
                  </View>
                  <View style={styles.deepDiveDivider} />
                  <View style={styles.deepDiveStat}>
                    <Text style={styles.deepDiveValue}>{stats.avgPointsConceded.toFixed(1)}</Text>
                    <Text style={styles.deepDiveLabel}>Avg Conceded/Set</Text>
                  </View>
                  <View style={styles.deepDiveDivider} />
                  <View style={styles.deepDiveStat}>
                    <Text style={[
                      styles.deepDiveValue,
                      (stats.avgPointsScored - stats.avgPointsConceded) >= 0
                        ? { color: colors.win }
                        : { color: colors.loss },
                    ]}>
                      {(stats.avgPointsScored - stats.avgPointsConceded) >= 0 ? '+' : ''}
                      {(stats.avgPointsScored - stats.avgPointsConceded).toFixed(1)}
                    </Text>
                    <Text style={styles.deepDiveLabel}>Avg Margin</Text>
                  </View>
                </View>
              </Card>

              {/* Set score range */}
              <Card style={{ marginBottom: spacing.sm }}>
                <View style={styles.deepDiveRow}>
                  <View style={styles.deepDiveStat}>
                    <Text style={[styles.deepDiveValue, { color: colors.win }]}>{stats.bestSetScore}</Text>
                    <Text style={styles.deepDiveLabel}>Best Set Score</Text>
                  </View>
                  <View style={styles.deepDiveDivider} />
                  <View style={styles.deepDiveStat}>
                    <Text style={[styles.deepDiveValue, { color: colors.loss }]}>{stats.worstSetScore}</Text>
                    <Text style={styles.deepDiveLabel}>Worst Set Score</Text>
                  </View>
                </View>
              </Card>

              {/* Close sets & blowouts */}
              <Card style={{ marginBottom: spacing.sm }}>
                <View style={styles.deepDiveRow}>
                  <View style={styles.deepDiveStat}>
                    <Text style={styles.deepDiveValue}>{stats.closeSets}</Text>
                    <Text style={styles.deepDiveLabel}>Close Sets ({'\u2264'}3 pts)</Text>
                  </View>
                  <View style={styles.deepDiveDivider} />
                  <View style={styles.deepDiveStat}>
                    <Text style={styles.deepDiveValue}>{stats.blowoutSets}</Text>
                    <Text style={styles.deepDiveLabel}>Blowouts ({'\u2265'}8 pts)</Text>
                  </View>
                </View>
              </Card>

              {/* Match outcome patterns */}
              {(stats.matchWins + stats.matchLosses) >= 2 && (
                <Card>
                  <Text style={[styles.winRateLabel, { marginBottom: spacing.sm }]}>Match Patterns</Text>
                  <View style={styles.patternRow}>
                    <View style={[styles.patternBadge, { backgroundColor: 'rgba(46,125,50,0.1)' }]}>
                      <Text style={[styles.patternCount, { color: colors.win }]}>{stats.setDistribution.won2_0}</Text>
                      <Text style={styles.patternLabel}>Won 2-0</Text>
                    </View>
                    <View style={[styles.patternBadge, { backgroundColor: 'rgba(46,125,50,0.1)' }]}>
                      <Text style={[styles.patternCount, { color: colors.win }]}>{stats.setDistribution.won2_1}</Text>
                      <Text style={styles.patternLabel}>Won 2-1</Text>
                    </View>
                    <View style={[styles.patternBadge, { backgroundColor: 'rgba(198,40,40,0.1)' }]}>
                      <Text style={[styles.patternCount, { color: colors.loss }]}>{stats.setDistribution.lost1_2}</Text>
                      <Text style={styles.patternLabel}>Lost 1-2</Text>
                    </View>
                    <View style={[styles.patternBadge, { backgroundColor: 'rgba(198,40,40,0.1)' }]}>
                      <Text style={[styles.patternCount, { color: colors.loss }]}>{stats.setDistribution.lost0_2}</Text>
                      <Text style={styles.patternLabel}>Lost 0-2</Text>
                    </View>
                  </View>
                </Card>
              )}
            </View>
          )}
        </View>
      )}

      {/* No stats yet */}
      {(!stats || (stats.matchWins === 0 && stats.matchLosses === 0)) && completedMatches.length === 0 && (
        <Card style={{ margin: spacing.lg }}>
          <Text style={styles.noData}>
            No completed matches yet. Stats will appear once games are played.
          </Text>
        </Card>
      )}

      {/* Completed Matches with inline set scores */}
      {completedMatches.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Results ({completedMatches.length})
          </Text>
          {[...completedMatches].reverse().map((match) => {
            const isFirst = match.FirstTeamId === opponentTeamId;
            const otherTeam = isFirst ? match.SecondTeamText : match.FirstTeamText;
            return (
              <Card key={match.MatchId} variant="outlined" style={styles.matchItem}>
                <View style={styles.matchHeader}>
                  <Text style={styles.matchTime}>
                    {venueTimeZone
                      ? formatDualDate(match.ScheduledStartDateTime, venueTimeZone, tzMode)
                      : formatDate(match.ScheduledStartDateTime, displayTz)}
                  </Text>
                  {match.Court?.Name ? (
                    <View style={styles.courtBadge}>
                      <Text style={styles.courtBadgeText}>{match.Court.Name}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.matchVs}>vs {otherTeam}</Text>
                {renderSetScores(match)}
              </Card>
            );
          })}
        </View>
      )}

      {/* Upcoming Matches */}
      {upcomingMatches.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Upcoming ({upcomingMatches.length})
          </Text>
          {upcomingMatches.map((match) => {
            const isFirst = match.FirstTeamId === opponentTeamId;
            const otherTeam = isFirst ? match.SecondTeamText : match.FirstTeamText;
            return (
              <Card key={match.MatchId} variant="outlined" style={styles.matchItem}>
                <View style={styles.matchHeader}>
                  <Text style={styles.matchTime}>
                    {venueTimeZone
                      ? formatDualTime(
                          parseScheduleTime(match.ScheduledStartDateTime, venueTimeZone) ?? 0,
                          venueTimeZone,
                          { hour: 'numeric', minute: '2-digit', hour12: true },
                          tzMode,
                        )
                      : formatTime(match.ScheduledStartDateTime, displayTz)}
                  </Text>
                  {match.Court?.Name ? (
                    <View style={styles.courtBadge}>
                      <Text style={styles.courtBadgeText}>{match.Court.Name}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.matchVs}>vs {otherTeam}</Text>
                <Text style={styles.matchDate}>
                  {venueTimeZone
                    ? formatDualDate(match.ScheduledStartDateTime, venueTimeZone, tzMode)
                    : formatDate(match.ScheduledStartDateTime, displayTz)}
                </Text>
              </Card>
            );
          })}
        </View>
      )}

      {/* No matches at all */}
      {allMatches.length === 0 && (
        <Card style={{ margin: spacing.lg }}>
          <Text style={styles.noData}>
            No scheduled matches found. Check back closer to the tournament.
          </Text>
        </Card>
      )}

      <View style={{ height: spacing.xxxl }} />
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl },
  loadingText: { marginTop: spacing.md, fontSize: fontSize.md, color: colors.textSecondary },
  header: { backgroundColor: colors.accent, padding: spacing.xxl },
  backText: { color: 'rgba(255,255,255,0.9)', fontSize: fontSize.md, fontWeight: '600', marginBottom: spacing.sm },
  scoutLabel: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.8)',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  opponentNameText: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.textOnPrimary,
    marginBottom: spacing.xs,
  },
  divisionNameText: { fontSize: fontSize.md, color: 'rgba(255,255,255,0.7)' },
  statsSection: { padding: spacing.lg },
  statsGrid: { flexDirection: 'row', marginBottom: spacing.sm },
  statCard: { flex: 1, alignItems: 'center', margin: spacing.xs },
  statValue: { fontSize: fontSize.xxxl, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: spacing.xs },
  winRateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  winRateLabel: { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  winRateValue: { fontSize: fontSize.xl, fontWeight: '800', color: colors.primary },
  progressBar: { height: 8, backgroundColor: colors.divider, borderRadius: 4 },
  progressFill: { height: 8, backgroundColor: colors.primary, borderRadius: 4 },
  section: { padding: spacing.lg },
  sectionTitle: { fontSize: fontSize.xl, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  matchItem: { marginBottom: spacing.sm },
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
  matchVs: { fontSize: fontSize.lg, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  matchDate: { fontSize: fontSize.sm, color: colors.textSecondary },
  completedBadge: { fontSize: fontSize.sm, color: colors.win, fontWeight: '600' },
  noData: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center', padding: spacing.lg },
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
  scoreLoss: { color: colors.textLight },
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
  // Deep dive stats
  deepDiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deepDiveStat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  deepDiveValue: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.text,
  },
  deepDiveLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
    textAlign: 'center',
  },
  deepDiveDivider: {
    width: 1,
    height: 36,
    backgroundColor: colors.divider,
  },
  // Match patterns
  patternRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  patternBadge: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  patternCount: {
    fontSize: fontSize.xl,
    fontWeight: '800',
  },
  patternLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
}
