import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../utils/theme';
import {
  getTeamCurrentSchedule,
  getTeamPastSchedule,
  extractAllScheduleMatches,
} from '../api/aesClient';
import type { TeamScheduleMatch, MatchResult, MatchSet } from '../api/aesClient';
import { Card } from '../components/Card';
import { formatTime, formatDate } from '../utils/dates';
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
}

function computeStats(
  matches: TeamScheduleMatch[],
  teamId: number
): OpponentStats {
  let matchWins = 0,
    matchLosses = 0,
    setsWon = 0,
    setsLost = 0;
  for (const m of matches) {
    if (!m.HasScores) continue;
    const isFirst = m.FirstTeamId === teamId;
    const won = isFirst ? m.FirstTeamWon : m.SecondTeamWon;
    if (won) matchWins++;
    else matchLosses++;
    for (const s of m.Sets) {
      if (s.FirstTeamScore == null || s.SecondTeamScore == null) continue;
      const myScore = isFirst ? s.FirstTeamScore : s.SecondTeamScore;
      const oppScore = isFirst ? s.SecondTeamScore : s.FirstTeamScore;
      if (myScore > oppScore) setsWon++;
      else if (oppScore > myScore) setsLost++;
    }
  }
  return { matchWins, matchLosses, setsWon, setsLost };
}

export function OpponentScoutScreen({
  event,
  division,
  opponentTeamId,
  opponentName,
  onBack,
}: Props) {
  const [allMatches, setAllMatches] = useState<TeamScheduleMatch[]>([]);
  const [stats, setStats] = useState<OpponentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMatch, setSelectedMatch] = useState<TeamScheduleMatch | null>(null);

  useEffect(() => {
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
      // Sort by time ascending
      matches.sort(
        (a, b) =>
          new Date(a.ScheduledStartDateTime).getTime() -
          new Date(b.ScheduledStartDateTime).getTime()
      );
      setAllMatches(matches);
      setStats(computeStats(matches, opponentTeamId));
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
        <TouchableOpacity onPress={onBack}>
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
                    {formatDate(match.ScheduledStartDateTime)}
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
                    {formatTime(match.ScheduledStartDateTime)}
                  </Text>
                  {match.Court?.Name ? (
                    <View style={styles.courtBadge}>
                      <Text style={styles.courtBadgeText}>{match.Court.Name}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.matchVs}>vs {otherTeam}</Text>
                <Text style={styles.matchDate}>
                  {formatDate(match.ScheduledStartDateTime)}
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

const styles = StyleSheet.create({
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
});
