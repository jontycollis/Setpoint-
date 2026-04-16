import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../utils/theme';
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
} from '../api/aesClient';
import type {
  FlatCourtMatch,
  PoolTeam,
  MatchResult,
} from '../api/aesClient';
import { Card } from '../components/Card';
import { NextDayScenarios } from '../components/NextDayScenarios';
import { PoolStandings } from '../components/PoolStandings';
import { MatchScoresModal } from '../components/MatchScoresModal';
import { formatTime, formatDate, getRelativeTime } from '../utils/dates';
import type { AESEvent, AESDivision, AESTeamAssignment } from '../types/aes';

interface Props {
  event: AESEvent;
  division: AESDivision;
  team: AESTeamAssignment;
  onBack: () => void;
  onViewStandings: () => void;
  onViewCourtSchedule: () => void;
  onViewBrackets: () => void;
  onScoutOpponent: (opponentTeamId: number, opponentName: string) => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
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
}: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const [teamData, setTeamData] = useState<AESTeamAssignment | null>(null);
  const [teamMatches, setTeamMatches] = useState<FlatCourtMatch[]>([]);
  const [poolRecord, setPoolRecord] = useState<PoolTeam | null>(null);
  const [poolShortName, setPoolShortName] = useState<string | null>(null);
  const [poolCompleteShortName, setPoolCompleteShortName] = useState<string | null>(null);
  const [poolTeams, setPoolTeams] = useState<PoolTeam[]>([]);
  const [matchResults, setMatchResults] = useState<Map<number, MatchResult>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [scoresModalMatch, setScoresModalMatch] = useState<FlatCourtMatch | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
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

      // Load pool data for W/L record, full pool standings, and pool short name
      const playDays = await getPlayDays(event.Key, division.DivisionId);
      let foundPoolRecord = false;
      for (const day of playDays) {
        if (foundPoolRecord) break;
        try {
          const pools = await getPlays(event.Key, division.DivisionId, day.DateTime);
          for (const pool of pools) {
            const found = pool.Teams.find((t) => t.TeamId === team.TeamId);
            if (found) {
              setPoolRecord(found);
              setPoolShortName(pool.ShortName || null);
              setPoolCompleteShortName(pool.CompleteShortName || null);
              setPoolTeams(pool.Teams || []);
              foundPoolRecord = true;
              break;
            }
          }
        } catch {
          // Skip
        }
      }

      // Fetch match results with set scores via the team schedule endpoints.
      // These return actual set-by-set scores (unlike the court schedule which
      // only has HasOutcome boolean). Load both current + past schedule.
      try {
        const resultsMap = new Map<number, MatchResult>();
        const [currentSched, pastSched] = await Promise.all([
          getTeamCurrentSchedule(event.Key, division.DivisionId, team.TeamId).catch(() => []),
          getTeamPastSchedule(event.Key, division.DivisionId, team.TeamId).catch(() => []),
        ]);
        const allMatches = extractAllScheduleMatches(currentSched, pastSched);
        for (const m of allMatches) {
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
      } catch {
        // Fall back to the division-wide approach if team schedule fails
        getAllDivisionMatchResults(event.Key, division.DivisionId)
          .then(setMatchResults)
          .catch(() => {});
      }
    } catch (err) {
      console.error('Failed to load team data:', err);
    } finally {
      setLoading(false);
    }
  }

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
  const completedMatches = teamMatches.filter((m) => m.HasOutcome);

  // Render set scores for a completed match from my-team perspective
  function renderScoresForMyTeam(match: FlatCourtMatch, isHome: boolean) {
    const result = matchResults.get(match.MatchId);
    if (!result || !result.HasScores || result.Sets.length === 0) return null;
    const myAsFirst = isHome; // isHome === I am FirstTeamText
    const sets = result.Sets.filter(
      (s) => s.FirstTeamScore !== null || s.SecondTeamScore !== null
    );
    if (sets.length === 0) return null;
    const won = myAsFirst ? result.FirstTeamWon : result.SecondTeamWon;
    return (
      <View style={styles.scoreRow}>
        {sets.map((s, idx) => {
          const my = myAsFirst ? s.FirstTeamScore : s.SecondTeamScore;
          const opp = myAsFirst ? s.SecondTeamScore : s.FirstTeamScore;
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
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Team Header */}
      <View style={styles.teamHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <View style={styles.teamHeaderTop}>
          <View style={styles.teamHeaderInfo}>
            <Text style={styles.teamName}>{current.TeamName}</Text>
            <Text style={styles.clubName}>{current.TeamClub.Name}</Text>
            <Text style={styles.divisionName}>{division.Name}</Text>
          </View>
          <TouchableOpacity onPress={onToggleFavorite} style={styles.favButton}>
            <Text style={isFavorite ? styles.favStarActive : styles.favStar}>
              {isFavorite ? '\u2605' : '\u2606'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Pool Record */}
        {poolRecord && (poolRecord.MatchesWon > 0 || poolRecord.MatchesLost > 0) && (
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{poolRecord.MatchesWon}</Text>
              <Text style={styles.statLabel}>Wins</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: '#ffcdd2' }]}>{poolRecord.MatchesLost}</Text>
              <Text style={styles.statLabel}>Losses</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{poolRecord.SetsWon}</Text>
              <Text style={styles.statLabel}>Sets W</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: '#ffcdd2' }]}>{poolRecord.SetsLost}</Text>
              <Text style={styles.statLabel}>Sets L</Text>
            </View>
          </View>
        )}

        {/* Match count summary */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{teamMatches.length}</Text>
            <Text style={styles.statLabel}>Scheduled</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{completedMatches.length}</Text>
            <Text style={styles.statLabel}>Played</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{teamMatches.length - completedMatches.length}</Text>
            <Text style={styles.statLabel}>Remaining</Text>
          </View>
        </View>
      </View>

      {/* Next Match from assignments */}
      {current.NextMatch && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Next Match</Text>
          <Card variant="elevated">
            <Text style={styles.nextMatchTime}>
              {formatTime(current.NextMatch.ScheduledStartDateTime)}
              {'  '}
              <Text style={styles.nextMatchRelative}>
                {getRelativeTime(current.NextMatch.ScheduledStartDateTime)}
              </Text>
            </Text>
            <Text style={styles.nextMatchVs}>vs {current.OpponentTeamText}</Text>
            <View style={styles.nextMatchDetails}>
              <Text style={styles.nextMatchCourt}>{current.NextMatch.Court.Name}</Text>
              <Text style={styles.nextMatchDate}>
                {formatDate(current.NextMatch.ScheduledStartDateTime)}
              </Text>
            </View>
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
          </Card>
        </View>
      )}

      {/* Pool Standings */}
      {poolTeams.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pool Standings</Text>
          <PoolStandings
            poolShortName={poolShortName}
            teams={poolTeams}
            myTeamId={current.TeamId}
            onTeamPress={(teamId, teamName) =>
              onScoutOpponent(teamId, teamName)
            }
          />
        </View>
      )}

      {/* Future Matches (AES pool-sheet view) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Future Matches</Text>
        <NextDayScenarios
          eventKey={event.Key}
          divisionId={division.DivisionId}
          divisionName={division.Name}
          teamId={team.TeamId}
          myPoolShortName={poolShortName || undefined}
          myFinishRank={poolRecord?.FinishRank ?? null}
        />
      </View>

      {/* Completed Matches */}
      {completedMatches.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Results ({completedMatches.length})
          </Text>
          {[...completedMatches].reverse().map((match) => {
            const isHome = match.FirstTeamText.toLowerCase() === (current.TeamText || '').toLowerCase();
            const opponentText = isHome ? match.SecondTeamText : match.FirstTeamText;
            return (
              <TouchableOpacity
                key={match.MatchId}
                activeOpacity={0.7}
                onPress={() => setScoresModalMatch(match)}
              >
                <Card variant="outlined" style={styles.matchCard}>
                  <View style={styles.matchHeader}>
                    <Text style={styles.matchTime}>
                      {formatDate(match.ScheduledStartDateTime)}
                    </Text>
                    <View style={styles.courtBadge}>
                      <Text style={styles.courtBadgeText}>{match.CourtName}</Text>
                    </View>
                  </View>
                  <Text style={styles.matchVs}>vs {opponentText}</Text>
                  {renderScoresForMyTeam(match, isHome) || (
                    <Text style={styles.completedBadge}>Completed — tap for scores</Text>
                  )}
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
          onPress={onViewBrackets}
        >
          <Text style={styles.actionButtonText}>Playoff Brackets</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.actionButtonSecondary]}
          onPress={onViewCourtSchedule}
        >
          <Text style={styles.actionButtonTextSecondary}>Court Schedule</Text>
        </TouchableOpacity>
      </View>

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
  );
}

const styles = StyleSheet.create({
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
  favButton: { padding: spacing.sm },
  favStar: { fontSize: 28, color: 'rgba(255,255,255,0.4)' },
  favStarActive: { fontSize: 28, color: '#fdd835' },
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
  nextMatchTime: { fontSize: fontSize.xxl, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  nextMatchRelative: { fontSize: fontSize.md, fontWeight: '600', color: colors.accent },
  nextMatchVs: { fontSize: fontSize.xl, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
  nextMatchDetails: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  nextMatchCourt: { fontSize: fontSize.md, color: colors.primary, fontWeight: '600' },
  nextMatchDate: { fontSize: fontSize.md, color: colors.textSecondary },
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
  actionButtonText: { color: colors.textOnPrimary, fontSize: fontSize.lg, fontWeight: '600' },
  actionButtonTextSecondary: { color: colors.primary, fontSize: fontSize.lg, fontWeight: '600' },
});
