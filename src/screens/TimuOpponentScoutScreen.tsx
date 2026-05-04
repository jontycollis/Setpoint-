// ── TimuOpponentScoutScreen ────────────────────────────────────────────────
//
// Deep scout view for a Timu opponent. Leverages the cross-tournament
// season index built up as the user opens (or manually adds) Timu events.
// Surfaces:
//   • Aggregate stats — tournaments played, W-L, set %, best/avg pool rank
//   • Head-to-head (H2H) — direct matchups between user's team and opponent
//   • Season results — per-tournament pool rank & final rank
//   • Common opponents — teams both have faced this season, with records
// ────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../utils/theme';
import { Card } from '../components/Card';
import {
  loadSeasonIndex,
  ensureIndexed,
  getTeamHistory,
  getH2H,
  getCommonOpponents,
  aggregateStats,
  type SeasonIndex,
  type TeamSeasonEntry,
  type H2HMatch,
  type AggregateStats,
  type CommonOpponent,
} from '../utils/timuSeasonIndex';

interface Props {
  /** The current tournament id (provides context — indexing hook). */
  tid: number;
  /** The opponent team we're scouting. */
  opponentName: string;
  /** The user's own team name (for H2H + common opponents). Optional. */
  myTeamName?: string;
  onBack: () => void;
  /** Navigate to another team dashboard. */
  onNavigateToTeam: (teamName: string) => void;
  /** Open a specific tournament. */
  onNavigateToTournament: (tid: number) => void;
  /** Open the "manage season tournaments" screen to add more tids. */
  onManageSeason: () => void;
}

export function TimuOpponentScoutScreen({
  tid,
  opponentName,
  myTeamName,
  onBack,
  onNavigateToTeam,
  onNavigateToTournament,
  onManageSeason,
}: Props) {
  const [index, setIndex] = useState<SeasonIndex>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    (async () => {
      const cur = await loadSeasonIndex();
      setIndex(cur);
      // Freshen the current tid in the background if stale.
      try {
        const refreshed = await ensureIndexed(tid);
        setIndex(refreshed);
      } catch {
        /* ignore */
      }
      setLoading(false);
    })();
  }, [tid]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const refreshed = await ensureIndexed(tid, 0);
      setIndex(refreshed);
    } catch {
      /* ignore */
    }
    setRefreshing(false);
  };

  const history = useMemo(
    () => getTeamHistory(index, opponentName),
    [index, opponentName]
  );
  const stats = useMemo(
    () => aggregateStats(index, opponentName),
    [index, opponentName]
  );
  const h2h = useMemo(
    () => (myTeamName ? getH2H(index, myTeamName, opponentName) : []),
    [index, myTeamName, opponentName]
  );
  const common = useMemo(
    () => (myTeamName ? getCommonOpponents(index, myTeamName, opponentName) : []),
    [index, myTeamName, opponentName]
  );

  const tournamentCount = Object.keys(index).length;

  return (
    <View style={styles.container}>
      <Hero opponentName={opponentName} onBack={onBack} />
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {loading && tournamentCount === 0 ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading season data...</Text>
          </View>
        ) : tournamentCount === 0 ? (
          <EmptyIndexState onManageSeason={onManageSeason} />
        ) : (
          <>
            <AggregateStatsCard stats={stats} />
            {myTeamName ? <HeadToHeadCard me={myTeamName} opp={opponentName} h2h={h2h} onOpen={onNavigateToTournament} /> : null}
            <SeasonResultsCard history={history} onOpenTid={onNavigateToTournament} />
            {myTeamName ? <CommonOpponentsCard common={common} onPressTeam={onNavigateToTeam} /> : null}
            <ManageSeasonFooter tournamentCount={tournamentCount} onManageSeason={onManageSeason} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────

function Hero({ opponentName, onBack }: { opponentName: string; onBack: () => void }) {
  return (
    <View style={styles.hero}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={styles.heroBack}>{'< Back'}</Text>
      </TouchableOpacity>
      <Text style={styles.heroKicker}>SCOUT</Text>
      <Text style={styles.heroTitle} numberOfLines={2}>{opponentName}</Text>
    </View>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────

function EmptyIndexState({ onManageSeason }: { onManageSeason: () => void }) {
  return (
    <Card variant="outlined" style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>No season history yet</Text>
      <Text style={styles.emptyBody}>
        Scouting improves the more Timu tournaments you've opened or indexed this season.
        Add tournaments the opponent has played in to see their record, head-to-head against
        you, and common opponents.
      </Text>
      <TouchableOpacity style={styles.primaryBtn} onPress={onManageSeason} activeOpacity={0.7}>
        <Text style={styles.primaryBtnText}>Manage Season Tournaments</Text>
      </TouchableOpacity>
    </Card>
  );
}

// ── Aggregate stats card ──────────────────────────────────────────────────

function AggregateStatsCard({ stats }: { stats: AggregateStats }) {
  if (stats.tournamentsPlayed === 0) return null;
  const setPct = stats.setWinPercentage.toFixed(0);
  const matchPct = stats.matchWinPercentage.toFixed(0);
  const avgPool =
    stats.averagePoolRank != null ? stats.averagePoolRank.toFixed(1) : '—';
  const bestPool = stats.bestPoolRank != null ? String(stats.bestPoolRank) : '—';
  const bestFinal = stats.bestFinalRank != null ? String(stats.bestFinalRank) : '—';

  // Recent form: W-L over last 5 matches
  const rfMatch = `${stats.recentFormMatchWon}-${stats.recentFormMatchLost}`;
  const rfSet = `${stats.recentFormSetWon}-${stats.recentFormSetLost}`;

  return (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>Season Profile</Text>
      <View style={styles.statsGrid}>
        <Stat label="Tournaments" value={String(stats.tournamentsPlayed)} />
        <Stat label="Record" value={`${stats.matchesWon}-${stats.matchesLost}`} accent />
        <Stat label="Match Win %" value={`${matchPct}%`} />
        <Stat label="Sets" value={`${stats.setsWon}-${stats.setsLost}`} />
        <Stat label="Set Win %" value={`${setPct}%`} />
        <Stat label="Avg Pool Rank" value={avgPool} />
        <Stat label="Best Pool Rank" value={bestPool} />
        <Stat label="Best Finish" value={bestFinal} accent />
      </View>
      <View style={styles.recentFormRow}>
        <Text style={styles.recentFormLabel}>Recent Form (last 5 matches)</Text>
        <Text style={styles.recentFormValue}>
          {rfMatch} match · {rfSet} sets
        </Text>
      </View>
    </Card>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.statCell}>
      <Text style={[styles.statValue, accent && styles.statValueAccent]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ── Head-to-head ──────────────────────────────────────────────────────────

function HeadToHeadCard({
  me,
  opp,
  h2h,
  onOpen,
}: {
  me: string;
  opp: string;
  h2h: H2HMatch[];
  onOpen: (tid: number) => void;
}) {
  const wins = h2h.filter((m) => m.iWon).length;
  const losses = h2h.length - wins;
  const setWon = h2h.reduce((n, m) => n + m.mySetsWon, 0);
  const setLost = h2h.reduce((n, m) => n + m.oppSetsWon, 0);

  return (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>Head-to-Head</Text>
      {h2h.length === 0 ? (
        <Text style={styles.emptyInline}>
          You and {opp} haven't played this season (in indexed tournaments).
        </Text>
      ) : (
        <>
          <View style={styles.h2hSummary}>
            <Text style={styles.h2hSummaryValue}>
              {wins}-{losses}
            </Text>
            <Text style={styles.h2hSummaryLabel}>
              vs {opp} this season · {setWon}-{setLost} sets
            </Text>
          </View>
          {h2h.map((m, i) => {
            // Equal sets means in-progress / no result, not a loss.
            const decided = m.mySetsWon !== m.oppSetsWon;
            return (
            <TouchableOpacity
              key={i}
              style={styles.h2hRow}
              onPress={() => onOpen(m.tid)}
              activeOpacity={0.7}
            >
              <View style={styles.h2hTopRow}>
                <Text style={styles.h2hDate}>{m.dateText || ''}</Text>
                <Text style={styles.h2hLabel}>{m.matchLabel}</Text>
                <View
                  style={[
                    styles.wlChip,
                    !decided ? styles.wlChipNeutral : m.iWon ? styles.wlChipWin : styles.wlChipLoss,
                  ]}
                >
                  <Text style={styles.wlChipText}>
                    {!decided ? '—' : m.iWon ? 'W' : 'L'}
                  </Text>
                </View>
              </View>
              <View style={styles.h2hScoreRow}>
                <Text style={styles.h2hTourney} numberOfLines={1}>{m.tournamentName}</Text>
                <View style={styles.h2hScores}>
                  {m.myScores.map((s, si) => {
                    const other = m.oppScores[si] ?? 0;
                    const won = s > other;
                    return (
                      <Text
                        key={si}
                        style={[styles.h2hScore, won ? styles.h2hScoreWin : styles.h2hScoreLoss]}
                      >
                        {s}-{other}
                      </Text>
                    );
                  })}
                </View>
              </View>
            </TouchableOpacity>
            );
          })}
        </>
      )}
    </Card>
  );
}

// ── Season results ────────────────────────────────────────────────────────

function SeasonResultsCard({
  history,
  onOpenTid,
}: {
  history: TeamSeasonEntry[];
  onOpenTid: (tid: number) => void;
}) {
  if (history.length === 0) {
    return (
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Season Results</Text>
        <Text style={styles.emptyInline}>
          This team isn't in any indexed tournament yet.
        </Text>
      </Card>
    );
  }
  return (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>Season Results ({history.length})</Text>
      {history.map((e) => (
        <TouchableOpacity
          key={e.tid}
          style={styles.histRow}
          onPress={() => onOpenTid(e.tid)}
          activeOpacity={0.7}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.histTitle} numberOfLines={1}>{e.tournamentName}</Text>
            <Text style={styles.histSubtitle} numberOfLines={1}>
              {e.dateText || 'Date unknown'}
              {e.subtitle ? ` · ${e.subtitle}` : ''}
            </Text>
          </View>
          <View style={styles.histStats}>
            {e.poolRank != null ? (
              <Text style={styles.histStatText}>Pool {e.poolId} #{e.poolRank}</Text>
            ) : null}
            <Text style={styles.histStatText}>
              {e.matchesFor}-{e.matchesAgainst} · {e.setsFor}-{e.setsAgainst}
            </Text>
            {e.finalRankLabel ? (
              <Text style={styles.histFinalRank}>{e.finalRankLabel}</Text>
            ) : null}
          </View>
        </TouchableOpacity>
      ))}
    </Card>
  );
}

// ── Common opponents ──────────────────────────────────────────────────────

function CommonOpponentsCard({
  common,
  onPressTeam,
}: {
  common: CommonOpponent[];
  onPressTeam: (teamName: string) => void;
}) {
  if (common.length === 0) {
    return (
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Common Opponents</Text>
        <Text style={styles.emptyInline}>
          No overlapping opponents in the indexed season.
        </Text>
      </Card>
    );
  }
  return (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>Common Opponents ({common.length})</Text>
      <View style={styles.commonHeader}>
        <Text style={[styles.commonCell, styles.commonNameCol]}>Team</Text>
        <Text style={[styles.commonCell, styles.commonStatCol]}>Me</Text>
        <Text style={[styles.commonCell, styles.commonStatCol]}>Them</Text>
      </View>
      {common.map((c) => {
        const myPct = c.myMatches ? Math.round((c.myWins * 100) / c.myMatches) : 0;
        const theirPct = c.theirMatches ? Math.round((c.theirWins * 100) / c.theirMatches) : 0;
        const betterSide: 'me' | 'them' | 'tie' =
          myPct > theirPct ? 'me' : theirPct > myPct ? 'them' : 'tie';
        return (
          <TouchableOpacity
            key={c.teamName}
            style={styles.commonRow}
            onPress={() => onPressTeam(c.teamName)}
            activeOpacity={0.7}
          >
            <Text style={[styles.commonCell, styles.commonNameCol, styles.commonLink]} numberOfLines={1}>
              {c.teamName}
            </Text>
            <Text
              style={[
                styles.commonCell,
                styles.commonStatCol,
                betterSide === 'me' && styles.commonBetter,
              ]}
            >
              {c.myWins}-{c.myMatches - c.myWins}
            </Text>
            <Text
              style={[
                styles.commonCell,
                styles.commonStatCol,
                betterSide === 'them' && styles.commonBetter,
              ]}
            >
              {c.theirWins}-{c.theirMatches - c.theirWins}
            </Text>
          </TouchableOpacity>
        );
      })}
    </Card>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────

function ManageSeasonFooter({
  tournamentCount,
  onManageSeason,
}: {
  tournamentCount: number;
  onManageSeason: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.footerBtn}
      onPress={onManageSeason}
      activeOpacity={0.7}
    >
      <Text style={styles.footerBtnText}>
        Manage Season ({tournamentCount} indexed)
      </Text>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, paddingBottom: spacing.xxxl },

  hero: {
    backgroundColor: colors.primary,
    padding: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  heroBack: { color: 'rgba(255,255,255,0.9)', fontSize: fontSize.md, fontWeight: '600', marginBottom: spacing.sm },
  heroKicker: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
  },
  heroTitle: { color: colors.textOnPrimary, fontSize: fontSize.xxl, fontWeight: '800' },

  loading: { alignItems: 'center', paddingVertical: spacing.xxxl },
  loadingText: { color: colors.textSecondary, marginTop: spacing.md },

  emptyCard: { alignItems: 'center' },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  emptyBody: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md, lineHeight: 20 },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  primaryBtnText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: fontSize.md },

  card: {},
  cardTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: spacing.sm,
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  statCell: { width: '25%', alignItems: 'center', paddingVertical: spacing.sm },
  statValue: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  statValueAccent: { color: colors.accent },
  statLabel: { fontSize: 10, color: colors.textSecondary, marginTop: 2, textTransform: 'uppercase' },

  recentFormRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recentFormLabel: { fontSize: fontSize.xs, color: colors.textSecondary, textTransform: 'uppercase' },
  recentFormValue: { fontSize: fontSize.sm, color: colors.text, fontWeight: '700' },

  h2hSummary: { flexDirection: 'row', alignItems: 'baseline', marginBottom: spacing.sm },
  h2hSummaryValue: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.primary },
  h2hSummaryLabel: { fontSize: fontSize.sm, color: colors.textSecondary, marginLeft: spacing.sm, flex: 1 },
  h2hRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  h2hTopRow: { flexDirection: 'row', alignItems: 'center' },
  h2hDate: { fontSize: fontSize.xs, color: colors.textSecondary, flex: 1 },
  h2hLabel: { fontSize: fontSize.xs, color: colors.primary, marginRight: spacing.sm },
  h2hScoreRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  h2hTourney: { flex: 1, fontSize: fontSize.sm, color: colors.text, fontWeight: '500' },
  h2hScores: { flexDirection: 'row', gap: spacing.xs },
  h2hScore: { fontSize: fontSize.sm, fontWeight: '600', fontVariant: ['tabular-nums'] },
  h2hScoreWin: { color: colors.success },
  h2hScoreLoss: { color: colors.loss },

  wlChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: borderRadius.sm },
  wlChipWin: { backgroundColor: colors.success },
  wlChipLoss: { backgroundColor: colors.loss },
  wlChipNeutral: { backgroundColor: colors.textLight },
  wlChipText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '700' },

  histRow: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  histTitle: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '600' },
  histSubtitle: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  histStats: { alignItems: 'flex-end' },
  histStatText: { fontSize: fontSize.xs, color: colors.text, fontVariant: ['tabular-nums'] },
  histFinalRank: { fontSize: fontSize.xs, color: colors.accent, fontWeight: '700', marginTop: 2 },

  commonHeader: {
    flexDirection: 'row',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  commonRow: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  commonCell: { fontSize: fontSize.sm, color: colors.text },
  commonNameCol: { flex: 1, paddingRight: spacing.xs },
  commonStatCol: { width: 70, textAlign: 'center' },
  commonLink: { color: colors.primary, fontWeight: '500' },
  commonBetter: { color: colors.success, fontWeight: '700' },

  emptyInline: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.sm },

  footerBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  footerBtnText: { color: colors.primary, fontWeight: '600', fontSize: fontSize.sm },
});
