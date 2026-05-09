// ── StatsScreen ───────────────────────────────────────────────────────────
//
// Team stats dashboard showing per-player statistics aggregated from
// scored matches. Displays:
//   • Season totals (all scored matches for this team)
//   • Per-player stat lines (kills, blocks, aces, assists, digs, pass avg)
//   • Match-by-match breakdown drill-down
//
// Data comes from the event-sourced match logs stored in AsyncStorage.
// ────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { Match, Side } from '../types/match';
import { loadMatches } from '../utils/scoredMatchStore';
import {
  aggregateMatchStats,
  buildMatchStatSummary,
  type PlayerStatLine,
  type TeamMatchStatSummary,
} from '../utils/statAggregator';

interface Props {
  teamProfileId: string;
  teamName: string;
  onBack: () => void;
}

type SortKey = 'kills' | 'blocks' | 'aces' | 'assists' | 'digs' | 'passAvg' | 'errors' | 'totalPoints';

export function StatsScreen({ teamProfileId, teamName, onBack }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [loading, setLoading] = useState(true);
  const [matchSummaries, setMatchSummaries] = useState<TeamMatchStatSummary[]>([]);
  const [seasonPlayers, setSeasonPlayers] = useState<PlayerStatLine[]>([]);
  const [seasonTotals, setSeasonTotals] = useState<PlayerStatLine | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('totalPoints');
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const allMatches = await loadMatches();
        // Filter to matches involving this team
        const teamMatches = allMatches.filter(
          (m) =>
            m.meta.home.teamProfileId === teamProfileId ||
            m.meta.away.teamProfileId === teamProfileId
        );

        // Build per-match summaries
        const summaries: TeamMatchStatSummary[] = [];
        const seasonLines = new Map<number, PlayerStatLine>();

        for (const match of teamMatches) {
          const side: Side =
            match.meta.home.teamProfileId === teamProfileId ? 'home' : 'away';
          const summary = buildMatchStatSummary(match, side);
          summaries.push(summary);

          // Merge into season totals
          for (const pl of summary.players) {
            let existing = seasonLines.get(pl.shirt);
            if (!existing) {
              existing = { ...pl };
              seasonLines.set(pl.shirt, existing);
            } else {
              existing.kills += pl.kills;
              existing.attacks += pl.attacks;
              existing.blocks += pl.blocks;
              existing.aces += pl.aces;
              existing.assists += pl.assists;
              existing.digs += pl.digs;
              existing.passAttempts += pl.passAttempts;
              existing.passQualitySum += pl.passQualitySum;
              existing.errors += pl.errors;
              existing.name = pl.name;
              if (pl.position) existing.position = pl.position;
            }
          }
        }

        // Recalculate derived fields
        const players: PlayerStatLine[] = [];
        let totKills = 0, totAttacks = 0, totBlocks = 0, totAces = 0;
        let totAssists = 0, totDigs = 0, totPassAtt = 0, totPassQ = 0, totErrors = 0;

        for (const line of seasonLines.values()) {
          line.totalPoints = line.kills + line.blocks + line.aces;
          line.killPct = line.attacks > 0 ? (line.kills - line.errors) / line.attacks : NaN;
          line.passAvg = line.passAttempts > 0 ? line.passQualitySum / line.passAttempts : NaN;
          players.push(line);

          totKills += line.kills;
          totAttacks += line.attacks;
          totBlocks += line.blocks;
          totAces += line.aces;
          totAssists += line.assists;
          totDigs += line.digs;
          totPassAtt += line.passAttempts;
          totPassQ += line.passQualitySum;
          totErrors += line.errors;
        }

        const totals: PlayerStatLine = {
          shirt: 0,
          name: 'Team',
          attacks: totAttacks,
          kills: totKills,
          killPct: totAttacks > 0 ? (totKills - totErrors) / totAttacks : NaN,
          blocks: totBlocks,
          aces: totAces,
          assists: totAssists,
          digs: totDigs,
          passAttempts: totPassAtt,
          passQualitySum: totPassQ,
          passAvg: totPassAtt > 0 ? totPassQ / totPassAtt : NaN,
          errors: totErrors,
          totalPoints: totKills + totBlocks + totAces,
        };

        summaries.sort((a, b) => b.dateMs - a.dateMs);
        setMatchSummaries(summaries);
        setSeasonPlayers(players);
        setSeasonTotals(totals);
      } catch (err) {
        console.warn('Failed to load stats:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [teamProfileId]);

  const sortedPlayers = useMemo(() => {
    const sorted = [...seasonPlayers];
    sorted.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      // NaN sorts last
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        if (isNaN(aVal) && isNaN(bVal)) return 0;
        if (isNaN(aVal)) return 1;
        if (isNaN(bVal)) return -1;
        return bVal - aVal;
      }
      return 0;
    });
    return sorted;
  }, [seasonPlayers, sortKey]);

  function formatNum(n: number): string {
    if (isNaN(n)) return '—';
    return n.toFixed(n % 1 === 0 ? 0 : 1);
  }

  function formatPct(n: number): string {
    if (isNaN(n)) return '—';
    return (n * 100).toFixed(1) + '%';
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onBack}>
            <Text style={styles.backBtn}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Analytics</Text>
          <View style={{ width: 50 }} />
        </View>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading analytics…</Text>
        </View>
      </View>
    );
  }

  const hasStats = seasonPlayers.some(
    (p) => p.kills > 0 || p.blocks > 0 || p.aces > 0 || p.assists > 0 || p.digs > 0 || p.passAttempts > 0 || p.errors > 0
  );

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backBtn}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{teamName} Analytics</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Season summary card */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Season Summary</Text>
          <Text style={styles.summarySubtitle}>
            {matchSummaries.length} match{matchSummaries.length !== 1 ? 'es' : ''} scored
          </Text>
          {seasonTotals && hasStats ? (
            <View style={styles.summaryGrid}>
              <StatBox label="Kills" value={seasonTotals.kills} colors={colors} />
              <StatBox label="Blocks" value={seasonTotals.blocks} colors={colors} />
              <StatBox label="Aces" value={seasonTotals.aces} colors={colors} />
              <StatBox label="Assists" value={seasonTotals.assists} colors={colors} />
              <StatBox label="Digs" value={seasonTotals.digs} colors={colors} />
              <StatBox label="Pass Avg" value={formatNum(seasonTotals.passAvg)} colors={colors} />
              <StatBox label="Kill %" value={formatPct(seasonTotals.killPct)} colors={colors} />
              <StatBox label="Errors" value={seasonTotals.errors} accent={colors.error} colors={colors} />
            </View>
          ) : (
            <Text style={styles.noStatsText}>
              No stats recorded yet. Tap a player on the court diagram during live scoring to start tracking stats.
            </Text>
          )}
        </View>

        {/* Player stat table */}
        {hasStats ? (
          <View style={styles.tableCard}>
            <Text style={styles.tableTitle}>Player Analytics</Text>

            {/* Sort buttons */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sortRow}>
              {([
                ['totalPoints', 'Pts'],
                ['kills', 'K'],
                ['blocks', 'B'],
                ['aces', 'A'],
                ['assists', 'Ast'],
                ['digs', 'D'],
                ['passAvg', 'Pass'],
                ['errors', 'Err'],
              ] as [SortKey, string][]).map(([key, label]) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.sortBtn, sortKey === key && styles.sortBtnActive]}
                  onPress={() => setSortKey(key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.sortBtnText, sortKey === key && styles.sortBtnTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Table header */}
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.tableHeaderCell, { flex: 2 }]}>#</Text>
              <Text style={[styles.tableHeaderCell, { flex: 4 }]}>Player</Text>
              <Text style={styles.tableHeaderCell}>K</Text>
              <Text style={styles.tableHeaderCell}>B</Text>
              <Text style={styles.tableHeaderCell}>A</Text>
              <Text style={styles.tableHeaderCell}>Ast</Text>
              <Text style={styles.tableHeaderCell}>D</Text>
              <Text style={styles.tableHeaderCell}>P</Text>
              <Text style={styles.tableHeaderCell}>E</Text>
              <Text style={styles.tableHeaderCell}>Pts</Text>
            </View>

            {/* Player rows */}
            {sortedPlayers.map((p) => {
              const hasAny = p.kills > 0 || p.blocks > 0 || p.aces > 0 || p.assists > 0 || p.digs > 0 || p.passAttempts > 0 || p.errors > 0;
              if (!hasAny) return null;
              return (
                <View key={p.shirt} style={styles.tableRow}>
                  <Text style={[styles.tableCell, { flex: 2, fontWeight: '800' }]}>
                    {p.shirt}
                  </Text>
                  <Text style={[styles.tableCell, { flex: 4 }]} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text style={styles.tableCell}>{p.kills || '—'}</Text>
                  <Text style={styles.tableCell}>{p.blocks || '—'}</Text>
                  <Text style={styles.tableCell}>{p.aces || '—'}</Text>
                  <Text style={styles.tableCell}>{p.assists || '—'}</Text>
                  <Text style={styles.tableCell}>{p.digs || '—'}</Text>
                  <Text style={styles.tableCell}>{formatNum(p.passAvg)}</Text>
                  <Text style={[styles.tableCell, p.errors > 0 && { color: colors.error }]}>
                    {p.errors || '—'}
                  </Text>
                  <Text style={[styles.tableCell, { fontWeight: '800', color: colors.primary }]}>
                    {p.totalPoints || '—'}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Match-by-match breakdown */}
        {matchSummaries.length > 0 ? (
          <View style={styles.matchSection}>
            <Text style={styles.matchSectionTitle}>Match Breakdown</Text>
            {matchSummaries.map((ms) => (
              <View key={ms.matchId} style={styles.matchCard}>
                <TouchableOpacity
                  onPress={() => setExpandedMatch(expandedMatch === ms.matchId ? null : ms.matchId)}
                  style={styles.matchCardHeader}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.matchOpponent} numberOfLines={1}>
                      vs {ms.opponent}
                    </Text>
                    <Text style={styles.matchDetail}>
                      {ms.matchLabel} · {new Date(ms.dateMs).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={styles.matchResultBadge}>
                    <Text style={[
                      styles.matchResultText,
                      ms.result === 'W' && { color: '#16a34a' },
                      ms.result === 'L' && { color: colors.error },
                    ]}>
                      {ms.result ?? '—'} {ms.setsWon}–{ms.setsLost}
                    </Text>
                  </View>
                  <Text style={styles.matchExpandArrow}>
                    {expandedMatch === ms.matchId ? '▾' : '▸'}
                  </Text>
                </TouchableOpacity>

                {expandedMatch === ms.matchId ? (
                  <View style={styles.matchExpanded}>
                    {/* Totals row */}
                    <View style={styles.matchTotalsRow}>
                      <Text style={styles.matchTotalLabel}>
                        K:{ms.totals.kills} B:{ms.totals.blocks} A:{ms.totals.aces} Ast:{ms.totals.assists} D:{ms.totals.digs} E:{ms.totals.errors}
                      </Text>
                    </View>
                    {/* Player rows */}
                    {ms.players
                      .filter((p) => p.kills > 0 || p.blocks > 0 || p.aces > 0 || p.assists > 0 || p.digs > 0 || p.passAttempts > 0 || p.errors > 0)
                      .map((p) => (
                        <View key={p.shirt} style={styles.matchPlayerRow}>
                          <Text style={styles.matchPlayerShirt}>#{p.shirt}</Text>
                          <Text style={styles.matchPlayerName} numberOfLines={1}>{p.name}</Text>
                          <Text style={styles.matchPlayerStats}>
                            {p.kills > 0 ? `K:${p.kills} ` : ''}
                            {p.blocks > 0 ? `B:${p.blocks} ` : ''}
                            {p.aces > 0 ? `A:${p.aces} ` : ''}
                            {p.assists > 0 ? `Ast:${p.assists} ` : ''}
                            {p.digs > 0 ? `D:${p.digs} ` : ''}
                            {p.passAttempts > 0 ? `P:${formatNum(p.passAvg)} ` : ''}
                            {p.errors > 0 ? `E:${p.errors}` : ''}
                          </Text>
                        </View>
                      ))}
                    {ms.players.every(
                      (p) => p.kills === 0 && p.blocks === 0 && p.aces === 0 && p.assists === 0 && p.digs === 0 && p.passAttempts === 0 && p.errors === 0
                    ) ? (
                      <Text style={styles.noStatsText}>No analytics recorded for this match.</Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {matchSummaries.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No Scored Matches</Text>
            <Text style={styles.emptyBody}>
              Score a match using the live scorer to start building your team analytics dashboard. Analytics are recorded when you tap a player on the court diagram during scoring.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ─── StatBox ──────────────────────────────────────────────────────────────

function StatBox({
  label,
  value,
  accent,
  colors,
}: {
  label: string;
  value: number | string;
  accent?: string;
  colors: ThemeColors;
}) {
  return (
    <View style={{
      alignItems: 'center',
      minWidth: 70,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.xs,
    }}>
      <Text style={{
        fontSize: fontSize.xxl,
        fontWeight: '900',
        color: accent ?? colors.primary,
      }}>
        {typeof value === 'number' ? value : value}
      </Text>
      <Text style={{
        fontSize: fontSize.xs,
        color: colors.textSecondary,
        fontWeight: '600',
        marginTop: 2,
      }}>
        {label}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    backBtn: {
      color: colors.primary,
      fontSize: fontSize.md,
      fontWeight: '600',
    },
    title: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: '800',
      flex: 1,
      textAlign: 'center',
    },
    scroll: {
      paddingBottom: spacing.xxxl + 40,
    },
    loadingWrap: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    loadingText: {
      color: colors.textSecondary,
      marginTop: spacing.sm,
    },

    // Summary card
    summaryCard: {
      backgroundColor: colors.surface,
      margin: spacing.md,
      borderRadius: borderRadius.lg,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    summaryTitle: {
      fontSize: fontSize.xl,
      fontWeight: '800',
      color: colors.text,
      marginBottom: 4,
    },
    summarySubtitle: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      marginBottom: spacing.md,
    },
    summaryGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-around',
    },
    noStatsText: {
      fontSize: fontSize.sm,
      color: colors.textLight,
      textAlign: 'center',
      lineHeight: 20,
      paddingVertical: spacing.md,
    },

    // Player table
    tableCard: {
      backgroundColor: colors.surface,
      marginHorizontal: spacing.md,
      marginBottom: spacing.md,
      borderRadius: borderRadius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    tableTitle: {
      fontSize: fontSize.lg,
      fontWeight: '800',
      color: colors.text,
      marginBottom: spacing.sm,
    },
    sortRow: {
      marginBottom: spacing.sm,
    },
    sortBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: borderRadius.full,
      backgroundColor: colors.background,
      marginRight: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sortBtnActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    sortBtnText: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    sortBtnTextActive: {
      color: colors.textOnPrimary,
    },
    tableHeaderRow: {
      flexDirection: 'row',
      paddingVertical: 6,
      borderBottomWidth: 2,
      borderBottomColor: colors.border,
    },
    tableHeaderCell: {
      flex: 1,
      fontSize: 10,
      fontWeight: '800',
      color: colors.textLight,
      textAlign: 'center',
      letterSpacing: 0.5,
    },
    tableRow: {
      flexDirection: 'row',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    tableCell: {
      flex: 1,
      fontSize: fontSize.sm,
      color: colors.text,
      textAlign: 'center',
    },

    // Match breakdown
    matchSection: {
      paddingHorizontal: spacing.md,
      marginBottom: spacing.md,
    },
    matchSectionTitle: {
      fontSize: fontSize.lg,
      fontWeight: '800',
      color: colors.text,
      marginBottom: spacing.sm,
    },
    matchCard: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.sm,
      overflow: 'hidden',
    },
    matchCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.md,
    },
    matchOpponent: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    matchDetail: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      marginTop: 2,
    },
    matchResultBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: borderRadius.sm,
      backgroundColor: colors.background,
      marginLeft: spacing.sm,
    },
    matchResultText: {
      fontSize: fontSize.sm,
      fontWeight: '800',
      color: colors.text,
    },
    matchExpandArrow: {
      fontSize: fontSize.md,
      color: colors.textLight,
      marginLeft: spacing.sm,
    },
    matchExpanded: {
      borderTopWidth: 1,
      borderTopColor: colors.divider,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    matchTotalsRow: {
      paddingVertical: 4,
      marginBottom: spacing.xs,
    },
    matchTotalLabel: {
      fontSize: fontSize.sm,
      fontWeight: '700',
      color: colors.primary,
    },
    matchPlayerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 4,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    matchPlayerShirt: {
      fontSize: fontSize.sm,
      fontWeight: '800',
      color: colors.text,
      width: 36,
    },
    matchPlayerName: {
      fontSize: fontSize.sm,
      color: colors.text,
      flex: 1,
      marginRight: spacing.sm,
    },
    matchPlayerStats: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      flexShrink: 0,
    },

    // Empty state
    emptyWrap: {
      alignItems: 'center',
      padding: spacing.xxl,
      marginTop: spacing.xxl,
    },
    emptyTitle: {
      fontSize: fontSize.xl,
      fontWeight: '800',
      color: colors.text,
      marginBottom: spacing.sm,
    },
    emptyBody: {
      fontSize: fontSize.md,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
    },
  });
}
