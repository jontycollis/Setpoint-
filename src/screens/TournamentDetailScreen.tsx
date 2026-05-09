// ── TournamentDetailScreen ─────────────────────────────────────────────────
//
// Drill-in for one row of the per-tournament rollup on the Analytics
// dashboard. Reuses the existing `aggregateSeasonStats` against just
// the matches contributing to this tournament — same per-player table
// pattern as the dashboard, scoped to a single tournament's matches.
// ────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
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
import type { Match } from '../types/match';
import { loadMatches } from '../utils/scoredMatchStore';
import { aggregateSeasonStats } from '../utils/statAggregator';

interface Props {
  teamProfileId: string;
  teamName: string;
  tournamentName: string;
  /** IDs of matches contributing to this tournament rollup. The
   *  Analytics dashboard computed these via `aggregateTournamentRollups`
   *  and passes them through; we re-aggregate against the freshest
   *  match data on screen mount. */
  matchIds: string[];
  onBack: () => void;
  onOpenPlayer: (shirt: number, name: string) => void;
}

export function TournamentDetailScreen({
  teamProfileId,
  teamName,
  tournamentName,
  matchIds,
  onBack,
  onOpenPlayer,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<Match[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await loadMatches();
        if (cancelled) return;
        const wanted = new Set(matchIds);
        setMatches(all.filter((m) => wanted.has(m.id)));
      } catch (err) {
        if (!cancelled) console.warn('[TournamentDetailScreen] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchIds]);

  const summary = useMemo(
    () => aggregateSeasonStats(matches, teamProfileId),
    [matches, teamProfileId]
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <Header onBack={onBack} title={tournamentName} subtitle={teamName} colors={colors} styles={styles} />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  let matchesWon = 0;
  let matchesLost = 0;
  for (const m of summary.matches) {
    if (m.result === 'W') matchesWon++;
    else if (m.result === 'L') matchesLost++;
  }
  const matchesAtRecord =
    matchesWon + matchesLost > 0 ? `${matchesWon}–${matchesLost}` : '—';

  return (
    <View style={styles.container}>
      <Header onBack={onBack} title={tournamentName} subtitle={teamName} colors={colors} styles={styles} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Tournament summary card */}
        <View style={styles.card}>
          <Text style={styles.kicker}>TOURNAMENT</Text>
          <View style={styles.recordRow}>
            <View style={styles.recordCell}>
              <Text style={styles.recordValue}>{summary.matchCount}</Text>
              <Text style={styles.recordLabel}>Matches</Text>
            </View>
            <View style={styles.recordCell}>
              <Text style={[styles.recordValue, { color: colors.primary }]}>{matchesAtRecord}</Text>
              <Text style={styles.recordLabel}>Record</Text>
            </View>
            <View style={styles.recordCell}>
              <Text style={styles.recordValue}>
                {sumSetsWon(summary)}–{sumSetsLost(summary)}
              </Text>
              <Text style={styles.recordLabel}>Sets</Text>
            </View>
          </View>
        </View>

        {/* Per-player table */}
        {summary.players.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.kicker}>PLAYERS</Text>
            <Text style={styles.cardSubtitle}>Tap a row for full season detail</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.headerCell, { flex: 2 }]}>#</Text>
              <Text style={[styles.headerCell, { flex: 4 }]}>Player</Text>
              <Text style={styles.headerCell}>K</Text>
              <Text style={styles.headerCell}>B</Text>
              <Text style={styles.headerCell}>A</Text>
              <Text style={styles.headerCell}>Pts</Text>
            </View>
            {summary.players
              .filter((p) => p.kills > 0 || p.blocks > 0 || p.aces > 0 || p.assists > 0 || p.digs > 0)
              .map((p) => (
                <TouchableOpacity
                  key={p.shirt}
                  onPress={() => onOpenPlayer(p.shirt, p.name)}
                  style={styles.tableRow}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.cell, { flex: 2, fontWeight: '800' }]}>{p.shirt}</Text>
                  <Text style={[styles.cell, { flex: 4 }]} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text style={styles.cell}>{p.kills || '—'}</Text>
                  <Text style={styles.cell}>{p.blocks || '—'}</Text>
                  <Text style={styles.cell}>{p.aces || '—'}</Text>
                  <Text style={[styles.cell, { fontWeight: '800', color: colors.primary }]}>
                    {p.totalPoints || '—'}
                  </Text>
                </TouchableOpacity>
              ))}
          </View>
        ) : null}

        {/* Match list */}
        <View style={styles.card}>
          <Text style={styles.kicker}>MATCHES</Text>
          {summary.matches.length === 0 ? (
            <Text style={styles.empty}>No matches in this tournament yet.</Text>
          ) : (
            summary.matches
              .slice()
              .sort((a, b) => b.dateMs - a.dateMs)
              .map((m) => (
                <View key={m.matchId} style={styles.matchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.matchOpponent, { color: colors.text }]} numberOfLines={1}>
                      vs {m.opponent}
                    </Text>
                    <Text style={{ fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 }} numberOfLines={1}>
                      {m.matchLabel} · {new Date(m.dateMs).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={styles.matchResultWrap}>
                    <Text
                      style={[
                        styles.matchResultText,
                        m.result === 'W'
                          ? { color: colors.success }
                          : m.result === 'L'
                          ? { color: colors.error }
                          : { color: colors.textSecondary },
                      ]}
                    >
                      {m.result ?? '—'}
                    </Text>
                    <Text style={{ fontSize: fontSize.xs, color: colors.textSecondary }}>
                      {m.setsWon}–{m.setsLost}
                    </Text>
                  </View>
                </View>
              ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function sumSetsWon(summary: { matches: { setsWon: number }[] }): number {
  return summary.matches.reduce((acc, m) => acc + m.setsWon, 0);
}
function sumSetsLost(summary: { matches: { setsLost: number }[] }): number {
  return summary.matches.reduce((acc, m) => acc + m.setsLost, 0);
}

function Header({
  onBack,
  title,
  subtitle,
  colors,
  styles,
}: {
  onBack: () => void;
  title: string;
  subtitle?: string;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.topBar}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <Text style={styles.backBtn}>‹ Back</Text>
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
        ) : null}
      </View>
      <View style={{ width: 50 }} />
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    backBtn: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
    title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800', textAlign: 'center' },
    subtitle: { color: colors.textSecondary, fontSize: fontSize.xs, textAlign: 'center', marginTop: 2 },
    scroll: { paddingBottom: spacing.xxxl + 40 },
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    card: {
      backgroundColor: colors.surface,
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      borderRadius: borderRadius.lg,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    kicker: { fontSize: 11, fontWeight: '800', color: colors.textLight, letterSpacing: 1 },
    cardSubtitle: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      marginTop: 2,
      marginBottom: spacing.sm,
    },
    empty: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      paddingVertical: spacing.md,
      textAlign: 'center',
    },

    recordRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.sm },
    recordCell: { alignItems: 'center', minWidth: 80 },
    recordValue: { fontSize: fontSize.xxl, fontWeight: '900', color: colors.text },
    recordLabel: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '600', marginTop: 2 },

    tableHeader: {
      flexDirection: 'row',
      paddingVertical: 6,
      borderBottomWidth: 2,
      borderBottomColor: colors.border,
      marginTop: spacing.sm,
    },
    headerCell: { flex: 1, fontSize: 10, fontWeight: '800', color: colors.textLight, textAlign: 'center', letterSpacing: 0.5 },
    tableRow: {
      flexDirection: 'row',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    cell: { flex: 1, fontSize: fontSize.sm, color: colors.text, textAlign: 'center' },

    matchRow: {
      flexDirection: 'row',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      alignItems: 'center',
    },
    matchOpponent: { fontSize: fontSize.md, fontWeight: '700' },
    matchResultWrap: { alignItems: 'center', justifyContent: 'center', minWidth: 48 },
    matchResultText: { fontSize: fontSize.lg, fontWeight: '900' },
  });
}
