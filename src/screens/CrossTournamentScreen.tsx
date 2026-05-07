// ── CrossTournamentScreen ─────────────────────────────────────────────────
//
// Season-long view across multiple tournaments for a single team. Reads
// the same unified AES + Timu indices (`loadAllSeasonIndices()` +
// `buildMySeasonHistory()`) that SeasonHistoryScreen and the MyHome
// next-tournament line use, so all three history surfaces stay in
// lockstep about which tournaments belong to a team.
//
// Was previously backed by a legacy AES-only `tournamentHistory` store
// (populated on TeamDashboard visits). That store was the cause of the
// "missing tournaments" complaint — Timu entries were never written to
// it, and AES entries only landed when the user actually opened the
// dashboard. This screen now reads the unified path; the legacy store
// is no longer written by anywhere and can be retired.
// ────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { borderRadius, fontSize, spacing, useTheme } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import {
  buildMySeasonHistory,
  loadAllSeasonIndices,
  type LoadedIndices,
  type UnifiedMatchEntry,
  type UnifiedTournamentEntry,
} from '../utils/unifiedSeasonHistory';

interface Props {
  /** Aliases identifying the team. Strict matcher applied downstream — the
   *  caller should supply the team's saved aliases (from TeamProfile)
   *  plus the team-name-as-displayed for fallback. */
  aliases: string[];
  /** Friendly label rendered in the header subtitle ("Defensa U18 Rob"). */
  headerLabel?: string;
  onBack: () => void;
}

export function CrossTournamentScreen({ aliases, headerLabel, onBack }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [history, setHistory] = useState<UnifiedTournamentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const indices: LoadedIndices = await loadAllSeasonIndices();
      // buildMySeasonHistory already returns the merged AES + Timu list
      // sorted newest → oldest. Past + future entries both included; the
      // "Tournament History" label is intentionally past-leaning but we
      // keep future entries in too — the user can see the full picture
      // of registered events on one screen.
      setHistory(buildMySeasonHistory(indices, aliases));
    } catch {
      // No diagnostic spam on render path; the upcoming-tournaments
      // helper already logs alias-matching gaps in __DEV__.
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [aliases]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggle = (key: string) => {
    setExpandedKeys((prev) => {
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

  // Aggregate stats — match counts come from the per-match lists so pool
  // and playoff matches both contribute. (The pool-only `matchesFor`
  // and `setsFor` fields on the entry would underreport for divisions
  // with playoffs.)
  let totalWins = 0;
  let totalLosses = 0;
  let totalSetsWon = 0;
  let totalSetsLost = 0;
  for (const entry of history) {
    for (const m of entry.matches) {
      if (m.iWon) totalWins++;
      else totalLosses++;
      totalSetsWon += m.mySetsWon;
      totalSetsLost += m.oppSetsWon;
    }
  }
  const totalMatches = totalWins + totalLosses;
  const winPct =
    totalMatches > 0 ? Math.round((totalWins / totalMatches) * 100) : 0;

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
          {headerLabel || aliases[0] || 'All teams'} — {history.length} tournament
          {history.length !== 1 ? 's' : ''}
        </Text>
      </View>

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
                    backgroundColor:
                      winPct >= 50 ? colors.success : colors.error,
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

      {history.map((entry) => {
        const expanded = expandedKeys.has(entry.sourceKey);
        const wins = entry.matches.filter((m) => m.iWon).length;
        const losses = entry.matches.length - wins;
        const entryWinPct =
          wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
        const sourceBadgeStyle =
          entry.source === 'timu' ? styles.sourceBadgeTimu : styles.sourceBadgeAes;

        return (
          <View key={entry.sourceKey} style={styles.tournamentCard}>
            <TouchableOpacity
              style={styles.tournamentHeader}
              onPress={() => toggle(entry.sourceKey)}
              activeOpacity={0.7}
            >
              <View style={[styles.sourceBadge, sourceBadgeStyle]}>
                <Text style={styles.sourceBadgeText}>
                  {entry.source.toUpperCase()}
                </Text>
              </View>
              <View style={styles.tournamentHeaderLeft}>
                <Text style={styles.tournamentName} numberOfLines={1}>
                  {entry.tournamentName}
                </Text>
                {entry.subtitle ? (
                  <Text style={styles.tournamentMeta} numberOfLines={1}>
                    {entry.subtitle}
                  </Text>
                ) : null}
                <Text style={styles.tournamentDate}>
                  {entry.dateText || formatDate(entry.dateMs)}
                  {entry.venueName ? ` · ${entry.venueName}` : ''}
                </Text>
              </View>
              <View style={styles.tournamentHeaderRight}>
                {wins + losses > 0 ? (
                  <Text
                    style={[
                      styles.tournamentRecord,
                      entryWinPct >= 50
                        ? { color: colors.success }
                        : { color: colors.error },
                    ]}
                  >
                    {wins}W-{losses}L
                  </Text>
                ) : null}
                {entry.finalRankLabel ? (
                  <Text style={styles.tournamentRank}>{entry.finalRankLabel}</Text>
                ) : null}
                <Text style={styles.expandIcon}>{expanded ? '▲' : '▼'}</Text>
              </View>
            </TouchableOpacity>

            {expanded && entry.matches.length > 0 && (
              <View style={styles.resultsList}>
                {entry.matches.map((m, idx) => (
                  <ResultRow key={idx} match={m} colors={colors} styles={styles} />
                ))}
              </View>
            )}
          </View>
        );
      })}

      {history.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No tournaments yet</Text>
          <Text style={styles.emptyText}>
            Tournaments are indexed automatically when you open them. Discover this team's history from MyHome's "Find more tournaments" button if events are missing.
          </Text>
        </View>
      )}

      <View style={{ height: 60 }} />
    </ScrollView>
  );
}

function ResultRow({
  match,
  colors,
  styles,
}: {
  match: UnifiedMatchEntry;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const setScores =
    match.myScores && match.oppScores && match.myScores.length > 0
      ? match.myScores
          .map((s, i) => `${s}-${match.oppScores[i] ?? 0}`)
          .join(', ')
      : '';
  return (
    <View style={styles.resultRow}>
      <View
        style={[
          styles.resultDot,
          { backgroundColor: match.iWon ? colors.success : colors.error },
        ]}
      />
      <View style={styles.resultInfo}>
        <Text style={styles.resultOpponent} numberOfLines={1}>
          {match.iWon ? 'W' : 'L'} vs {match.opponentName || 'Unknown'}
        </Text>
        <Text style={styles.resultDetail}>
          {match.roundLabel}
          {setScores ? ` — ${setScores}` : ''}
        </Text>
      </View>
    </View>
  );
}

function formatDate(ms?: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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
    title: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.text },
    subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },

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
    statsGrid: { flexDirection: 'row', marginBottom: spacing.md },
    statItem: { flex: 1, alignItems: 'center' },
    statValue: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.text },
    statLabel: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
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
    winRateBarFill: { height: 8, borderRadius: 4 },
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
      alignItems: 'center',
      padding: spacing.md,
      gap: spacing.sm,
    },
    sourceBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: borderRadius.sm,
      minWidth: 38,
      alignItems: 'center',
    },
    sourceBadgeAes: { backgroundColor: colors.primary },
    sourceBadgeTimu: { backgroundColor: colors.accent },
    sourceBadgeText: {
      color: '#fff',
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    tournamentHeaderLeft: { flex: 1 },
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
    tournamentRecord: { fontSize: fontSize.lg, fontWeight: '800' },
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
    resultInfo: { flex: 1 },
    resultOpponent: {
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: colors.text,
    },
    resultDetail: { fontSize: fontSize.xs, color: colors.textSecondary },

    // Empty state
    emptyState: { padding: spacing.xxxl, alignItems: 'center' },
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
  });
}
