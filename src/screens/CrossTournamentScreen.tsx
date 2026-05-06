// Cross-Tournament History — season-long view across multiple tournaments
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import {
  loadTournamentHistory,
  saveTournamentHistory,
} from '../utils/storage';
import type {
  TournamentHistoryEntry,
  TournamentMatchResult,
} from '../utils/storage';

interface Props {
  clubName?: string;
  teamFilter?: string; // Filter to specific team name/text
  onBack: () => void;
}

export function CrossTournamentScreen({ clubName, teamFilter, onBack }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [history, setHistory] = useState<TournamentHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      let entries = await loadTournamentHistory();
      // Filter by club or team if specified
      if (teamFilter) {
        const q = teamFilter.toLowerCase();
        entries = entries.filter(
          (e) =>
            e.teamText.toLowerCase().includes(q) ||
            e.teamName.toLowerCase().includes(q)
        );
      } else if (clubName) {
        const q = clubName.toLowerCase();
        entries = entries.filter((e) => e.clubName.toLowerCase().includes(q));
      }
      setHistory(entries);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [clubName, teamFilter]);

  useEffect(() => {
    loadData();
  }, []);

  const handleClearHistory = useCallback(() => {
    Alert.alert(
      'Clear History',
      'This will delete all saved tournament history. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await saveTournamentHistory([]);
            setHistory([]);
          },
        },
      ]
    );
  }, []);

  const toggleEvent = (key: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading history...</Text>
      </View>
    );
  }

  // Aggregate stats across all tournaments
  const totalWins = history.reduce((s, h) => s + h.wins, 0);
  const totalLosses = history.reduce((s, h) => s + h.losses, 0);
  const totalSetsWon = history.reduce((s, h) => s + h.setsWon, 0);
  const totalSetsLost = history.reduce((s, h) => s + h.setsLost, 0);
  const totalMatches = totalWins + totalLosses;
  const winPct = totalMatches > 0 ? Math.round((totalWins / totalMatches) * 100) : 0;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
        >
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Tournament History</Text>
        <Text style={styles.subtitle}>
          {teamFilter || clubName || 'All teams'} — {history.length} tournament
          {history.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {/* Season stats summary */}
      {totalMatches > 0 && (
        <View style={styles.statsCard}>
          <Text style={styles.statsTitle}>Season Overview</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{history.length}</Text>
              <Text style={styles.statLabel}>Tournaments</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{totalMatches}</Text>
              <Text style={styles.statLabel}>Matches</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.success }]}>
                {totalWins}W
              </Text>
              <Text style={styles.statLabel}>Wins</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.error }]}>
                {totalLosses}L
              </Text>
              <Text style={styles.statLabel}>Losses</Text>
            </View>
          </View>
          <View style={styles.winRateRow}>
            <Text style={styles.winRateLabel}>Win Rate</Text>
            <View style={styles.winRateBarTrack}>
              <View
                style={[
                  styles.winRateBarFill,
                  {
                    width: `${Math.max(winPct, 2)}%`,
                    backgroundColor: winPct >= 50 ? colors.success : colors.error,
                  },
                ]}
              />
            </View>
            <Text style={styles.winRatePct}>{winPct}%</Text>
          </View>
          <Text style={styles.setRecord}>
            Sets: {totalSetsWon}–{totalSetsLost}
          </Text>
        </View>
      )}

      {/* Tournament entries */}
      {history.map((entry) => {
        const eventId = `${entry.eventKey}-${entry.teamText}`;
        const isExpanded = expandedEvents.has(eventId);
        const entryWinPct =
          entry.wins + entry.losses > 0
            ? Math.round((entry.wins / (entry.wins + entry.losses)) * 100)
            : 0;

        return (
          <View key={eventId} style={styles.tournamentCard}>
            <TouchableOpacity
              style={styles.tournamentHeader}
              onPress={() => toggleEvent(eventId)}
              activeOpacity={0.7}
            >
              <View style={styles.tournamentHeaderLeft}>
                <Text style={styles.tournamentName} numberOfLines={1}>
                  {entry.eventName}
                </Text>
                <Text style={styles.tournamentMeta}>
                  {entry.divisionName} — {entry.teamText}
                </Text>
                <Text style={styles.tournamentDate}>{entry.date}</Text>
              </View>
              <View style={styles.tournamentHeaderRight}>
                <Text
                  style={[
                    styles.tournamentRecord,
                    entryWinPct >= 50
                      ? { color: colors.success }
                      : { color: colors.error },
                  ]}
                >
                  {entry.wins}W-{entry.losses}L
                </Text>
                {entry.finishRank && (
                  <Text style={styles.tournamentRank}>
                    #{entry.finishRank}/{entry.totalTeams}
                  </Text>
                )}
                <Text style={styles.expandIcon}>
                  {isExpanded ? '\u25B2' : '\u25BC'}
                </Text>
              </View>
            </TouchableOpacity>

            {isExpanded && entry.results.length > 0 && (
              <View style={styles.resultsList}>
                {entry.results.map((result, idx) => (
                  <View key={idx} style={styles.resultRow}>
                    <View
                      style={[
                        styles.resultDot,
                        {
                          backgroundColor: result.won
                            ? colors.success
                            : colors.error,
                        },
                      ]}
                    />
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultOpponent} numberOfLines={1}>
                        {result.won ? 'W' : 'L'} vs {result.opponentName}
                      </Text>
                      <Text style={styles.resultDetail}>
                        {result.matchType}
                        {result.setScores ? ` — ${result.setScores}` : ''}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}

      {history.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No History Yet</Text>
          <Text style={styles.emptyText}>
            Tournament results are saved automatically when you view a team's
            dashboard. Results will appear here across multiple tournaments.
          </Text>
        </View>
      )}

      {history.length > 0 && (
        <TouchableOpacity
          style={styles.clearButton}
          onPress={handleClearHistory}
          activeOpacity={0.7}
        >
          <Text style={styles.clearButtonText}>Clear All History</Text>
        </TouchableOpacity>
      )}

      <View style={{ height: 60 }} />
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  header: {
    padding: spacing.lg,
    paddingTop: spacing.xl,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  backText: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  // Season stats
  statsCard: {
    margin: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  statsTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  statsGrid: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.text,
  },
  statLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  winRateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  winRateLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    width: 70,
  },
  winRateBarTrack: {
    flex: 1,
    height: 8,
    backgroundColor: colors.divider,
    borderRadius: 4,
    overflow: 'hidden',
    marginHorizontal: spacing.sm,
  },
  winRateBarFill: {
    height: 8,
    borderRadius: 4,
  },
  winRatePct: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.text,
    width: 36,
    textAlign: 'right',
  },
  setRecord: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  // Tournament cards
  tournamentCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: 'hidden',
  },
  tournamentHeader: {
    flexDirection: 'row',
    padding: spacing.md,
  },
  tournamentHeaderLeft: {
    flex: 1,
  },
  tournamentName: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
  },
  tournamentMeta: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  tournamentDate: {
    fontSize: fontSize.xs,
    color: colors.textLight,
    marginTop: 2,
  },
  tournamentHeaderRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  tournamentRecord: {
    fontSize: fontSize.lg,
    fontWeight: '800',
  },
  tournamentRank: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  expandIcon: {
    fontSize: 10,
    color: colors.textLight,
    marginTop: spacing.xs,
  },
  // Results list
  resultsList: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingVertical: spacing.xs,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  resultDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.sm,
  },
  resultInfo: {
    flex: 1,
  },
  resultOpponent: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  resultDetail: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  // Empty state
  emptyState: {
    padding: spacing.xxxl,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  // Clear button
  clearButton: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  clearButtonText: {
    fontSize: fontSize.sm,
    color: colors.error,
    fontWeight: '600',
  },
});
}
