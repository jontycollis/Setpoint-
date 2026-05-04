// ── TimuTournamentScreen ────────────────────────────────────────────────────
//
// Tournament-level view for Timu-hosted events. Matches the AES visual
// language: light background, blue hero header, white Card components.
// Three tabbed views — Pools, Schedule, Rankings — with team names in the
// pool tab tappable to drill into a team dashboard.
//
// Also surfaces Timu's hamburger-menu features: venue info, host/venue/OVA
// contacts, OVA reference documents, and native share.
// ────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../utils/theme';
import { Card } from '../components/Card';
import {
  VenueInfoCard,
  ContactButtonsRow,
  OvaDocsSheet,
  TimuShareButton,
} from '../components/TimuInfoSheets';
import {
  getPools,
  getSchedule,
  getPlayoffs,
} from '../api/timuClient';
import { ensureIndexed } from '../utils/timuSeasonIndex';
import type {
  TimuTournamentInfo,
  TimuPool,
  TimuPoolTeam,
  TimuScheduleMatch,
  TimuFinalRanking,
} from '../types/timu';

type Tab = 'pools' | 'schedule' | 'rankings';

interface Props {
  tid: number;
  onBack: () => void;
  /** Invoked after tournament metadata has loaded, so parent can persist recent list. */
  onInfoLoaded?: (info: TimuTournamentInfo) => void;
  /** User tapped a team in the pool standings — navigate to team dashboard. */
  onTeamPress: (teamName: string) => void;
  /** Whether a given team (by name) is a favorite. */
  isFavorite: (teamName: string) => boolean;
}

export function TimuTournamentScreen({
  tid,
  onBack,
  onInfoLoaded,
  onTeamPress,
  isFavorite,
}: Props) {
  const [tab, setTab] = useState<Tab>('pools');
  const [info, setInfo] = useState<TimuTournamentInfo | null>(null);
  const [pools, setPools] = useState<TimuPool[] | null>(null);
  const [matches, setMatches] = useState<TimuScheduleMatch[] | null>(null);
  const [rankings, setRankings] = useState<TimuFinalRanking[] | null>(null);

  const [loadingPools, setLoadingPools] = useState(false);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [loadingRankings, setLoadingRankings] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);

  const loadPools = useCallback(async () => {
    setLoadingPools(true);
    try {
      const page = await getPools(tid);
      setPools(page.pools);
      setInfo(page.info);
      onInfoLoaded?.(page.info);
    } catch (err: any) {
      Alert.alert('Could not load pools', err?.message || 'Unknown error');
    } finally {
      setLoadingPools(false);
    }
  }, [tid, onInfoLoaded]);

  const loadSchedule = useCallback(async () => {
    setLoadingSchedule(true);
    try {
      const page = await getSchedule(tid);
      setMatches(page.matches);
      setInfo((prev) => prev ?? page.info);
    } catch (err: any) {
      Alert.alert('Could not load schedule', err?.message || 'Unknown error');
    } finally {
      setLoadingSchedule(false);
    }
  }, [tid]);

  const loadRankings = useCallback(async () => {
    setLoadingRankings(true);
    try {
      const page = await getPlayoffs(tid);
      setRankings(page.finalRankings);
    } catch (err: any) {
      Alert.alert('Could not load rankings', err?.message || 'Unknown error');
    } finally {
      setLoadingRankings(false);
    }
  }, [tid]);

  useEffect(() => {
    loadPools();
    // Auto-index this tournament into the season index (background). Uses
    // the 2-minute staleness window so tab-switches don't re-fetch.
    ensureIndexed(tid).catch(() => {
      /* non-fatal */
    });
  }, [loadPools, tid]);

  useEffect(() => {
    if (tab === 'schedule' && !matches && !loadingSchedule) loadSchedule();
    if (tab === 'rankings' && !rankings && !loadingRankings) loadRankings();
  }, [tab, matches, rankings, loadingSchedule, loadingRankings, loadSchedule, loadRankings]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (tab === 'pools') await loadPools();
    else if (tab === 'schedule') await loadSchedule();
    else if (tab === 'rankings') await loadRankings();
    setRefreshing(false);
  }, [tab, loadPools, loadSchedule, loadRankings]);

  return (
    <View style={styles.container}>
      <Header info={info} tid={tid} onBack={onBack} />
      <Tabs current={tab} onChange={setTab} />
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {tab === 'pools' && (
          <PoolsTab
            pools={pools}
            loading={loadingPools}
            onTeamPress={onTeamPress}
            isFavorite={isFavorite}
          />
        )}
        {tab === 'schedule' && (
          <ScheduleTab
            matches={matches}
            loading={loadingSchedule}
            onTeamPress={onTeamPress}
          />
        )}
        {tab === 'rankings' && (
          <RankingsTab
            rankings={rankings}
            loading={loadingRankings}
            onTeamPress={onTeamPress}
          />
        )}

        {/* Tournament resources — shown on every tab */}
        {info && (
          <View style={styles.resourcesSection}>
            <VenueInfoCard info={info} />
            <ContactButtonsRow info={info} />
            <TouchableOpacity
              style={styles.docsButton}
              onPress={() => setDocsOpen(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.docsIcon}>{'\u{1F4D6}'}</Text>
              <Text style={styles.docsLabel}>OVA Documents</Text>
              <Text style={styles.docsChev}>{'>'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <OvaDocsSheet visible={docsOpen} onClose={() => setDocsOpen(false)} />
    </View>
  );
}

// ── Header (hero) ─────────────────────────────────────────────────────────

function Header({
  info,
  tid,
  onBack,
}: {
  info: TimuTournamentInfo | null;
  tid: number;
  onBack: () => void;
}) {
  return (
    <View style={styles.hero}>
      <View style={styles.heroTop}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.heroBack}>{'< Back'}</Text>
        </TouchableOpacity>
        {info ? (
          <TimuShareButton
            tid={tid}
            tournamentName={info.name || `Tournament ${tid}`}
          />
        ) : null}
      </View>
      <Text style={styles.heroTitle} numberOfLines={2}>
        {info?.name || `Tournament ${tid}`}
      </Text>
      {info?.subtitle ? (
        <Text style={styles.heroSubtitle} numberOfLines={1}>
          {info.subtitle}
        </Text>
      ) : null}
      <View style={styles.heroMetaRow}>
        {info?.dateText ? (
          <Text style={styles.heroMeta}>{info.dateText}</Text>
        ) : null}
        {info?.venueName ? (
          <Text style={styles.heroMeta} numberOfLines={1}>
            {'  ·  ' + info.venueName}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────

function Tabs({ current, onChange }: { current: Tab; onChange: (t: Tab) => void }) {
  const items: Array<{ key: Tab; label: string }> = [
    { key: 'pools', label: 'Pools' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'rankings', label: 'Rankings' },
  ];
  return (
    <View style={styles.tabs}>
      {items.map((it) => (
        <TouchableOpacity
          key={it.key}
          style={[styles.tab, current === it.key && styles.tabActive]}
          onPress={() => onChange(it.key)}
          activeOpacity={0.7}
        >
          <Text
            style={[styles.tabLabel, current === it.key && styles.tabLabelActive]}
          >
            {it.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Pools tab ─────────────────────────────────────────────────────────────

function PoolsTab({
  pools,
  loading,
  onTeamPress,
  isFavorite,
}: {
  pools: TimuPool[] | null;
  loading: boolean;
  onTeamPress: (teamName: string) => void;
  isFavorite: (teamName: string) => boolean;
}) {
  if (loading && !pools) return <Spinner label="Loading pools..." />;
  if (!pools || pools.length === 0) {
    return <EmptyState label="No pool data available yet." />;
  }
  return (
    <View>
      {pools.map((pool) => (
        <PoolStandingsCard
          key={pool.poolId}
          pool={pool}
          onTeamPress={onTeamPress}
          isFavorite={isFavorite}
        />
      ))}
    </View>
  );
}

function PoolStandingsCard({
  pool,
  onTeamPress,
  isFavorite,
}: {
  pool: TimuPool;
  onTeamPress: (teamName: string) => void;
  isFavorite: (teamName: string) => boolean;
}) {
  const sorted = [...pool.teams].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  return (
    <View style={styles.poolContainer}>
      <View style={styles.poolLabelBar}>
        <Text style={styles.poolLabel}>{pool.name}</Text>
        {pool.matchesComplete ? (
          <Text style={styles.poolLabelMeta}>{pool.matchesComplete} played</Text>
        ) : null}
      </View>
      <View style={styles.tableHeader}>
        <Text style={[styles.headerCell, styles.rankCol]}>#</Text>
        <Text style={[styles.headerCell, styles.teamCol]}>Team</Text>
        <Text style={[styles.headerCell, styles.statCol]}>W</Text>
        <Text style={[styles.headerCell, styles.statCol]}>L</Text>
        <Text style={[styles.headerCell, styles.statCol]}>SW</Text>
        <Text style={[styles.headerCell, styles.statCol]}>SL</Text>
      </View>
      {sorted.map((team, idx) => (
        <TeamRow
          key={team.globalNumber}
          team={team}
          rowIndex={idx}
          onPress={() => onTeamPress(team.teamName)}
          fav={isFavorite(team.teamName)}
        />
      ))}
    </View>
  );
}

function TeamRow({
  team,
  rowIndex,
  onPress,
  fav,
}: {
  team: TimuPoolTeam;
  rowIndex: number;
  onPress: () => void;
  fav: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      style={[styles.poolRow, rowIndex % 2 === 1 && styles.poolRowAlt]}
    >
      <Text style={[styles.cell, styles.rankCol, styles.rankText]}>
        {team.rank ?? '–'}
      </Text>
      <View style={styles.teamCol}>
        <Text style={[styles.cell, styles.linkText]} numberOfLines={1}>
          {fav ? '★ ' : ''}{team.teamName}
          {team.day1Tag ? <Text style={styles.d1Tag}>  d1</Text> : null}
        </Text>
      </View>
      <Text style={[styles.cell, styles.statCol]}>{team.matchesFor}</Text>
      <Text style={[styles.cell, styles.statCol]}>{team.matchesAgainst}</Text>
      <Text style={[styles.cell, styles.statCol]}>{team.setsFor}</Text>
      <Text style={[styles.cell, styles.statCol]}>{team.setsAgainst}</Text>
    </TouchableOpacity>
  );
}

// ── Schedule tab ──────────────────────────────────────────────────────────

function ScheduleTab({
  matches,
  loading,
  onTeamPress,
}: {
  matches: TimuScheduleMatch[] | null;
  loading: boolean;
  onTeamPress: (teamName: string) => void;
}) {
  if (loading && !matches) return <Spinner label="Loading schedule..." />;
  if (!matches || matches.length === 0) {
    return <EmptyState label="No schedule available yet." />;
  }
  // Group by day / playoff
  const groups: Array<{ label: string; items: TimuScheduleMatch[] }> = [];
  for (const m of matches) {
    const key = m.isPlayoff ? 'Playoffs' : m.dayLabel;
    let g = groups.find((gr) => gr.label === key);
    if (!g) {
      g = { label: key, items: [] };
      groups.push(g);
    }
    g.items.push(m);
  }
  return (
    <View>
      {groups.map((group, gi) => (
        <Card key={`${group.label}-${gi}`} style={styles.dayCard}>
          <Text style={styles.dayCardTitle}>{group.label.replace(/\s+$/, '')}</Text>
          {group.items.map((m, i) => (
            <View key={i} style={styles.matchRow}>
              <View style={styles.matchTimeBox}>
                <Text style={styles.matchTime}>{m.time}</Text>
                <Text style={styles.matchCourt}>Crt {m.court}</Text>
              </View>
              <View style={styles.matchTeamsBox}>
                <TeamInline
                  name={m.home.name}
                  ref_={m.home.ref}
                  onPress={onTeamPress}
                />
                <Text style={styles.matchVs}>vs</Text>
                <TeamInline
                  name={m.away.name}
                  ref_={m.away.ref}
                  onPress={onTeamPress}
                />
              </View>
              {m.extraLabel ? (
                <Text style={styles.matchExtra}>({m.extraLabel})</Text>
              ) : null}
            </View>
          ))}
        </Card>
      ))}
    </View>
  );
}

function TeamInline({
  name,
  ref_,
  onPress,
}: {
  name?: string;
  ref_: string;
  onPress: (teamName: string) => void;
}) {
  if (name) {
    return (
      <TouchableOpacity onPress={() => onPress(name)} activeOpacity={0.6}>
        <Text style={styles.matchTeamLink}>{name}</Text>
      </TouchableOpacity>
    );
  }
  // Ref like "A1", "W3", "L2" — not yet resolved (e.g., future playoff spot)
  return <Text style={styles.matchTeamUnresolved}>{ref_}</Text>;
}

// ── Rankings tab ──────────────────────────────────────────────────────────

function RankingsTab({
  rankings,
  loading,
  onTeamPress,
}: {
  rankings: TimuFinalRanking[] | null;
  loading: boolean;
  onTeamPress: (teamName: string) => void;
}) {
  if (loading && !rankings) return <Spinner label="Loading rankings..." />;
  if (!rankings || rankings.length === 0) {
    return (
      <EmptyState label="Final rankings aren't posted yet. Check back after playoffs." />
    );
  }
  return (
    <Card style={styles.rankCard}>
      <Text style={styles.rankCardTitle}>Final Rankings</Text>
      {rankings.map((r, i) => (
        <TouchableOpacity
          key={i}
          style={styles.rankRow}
          onPress={() => onTeamPress(r.teamName)}
          activeOpacity={0.6}
        >
          <Text style={styles.rankLabel}>{r.rankLabel}</Text>
          <Text style={styles.rankTeam} numberOfLines={1}>
            {r.teamName}
          </Text>
        </TouchableOpacity>
      ))}
    </Card>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────

function Spinner({ label }: { label: string }) {
  return (
    <View style={styles.spinner}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.spinnerText}>{label}</Text>
    </View>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <Card variant="outlined" style={styles.empty}>
      <Text style={styles.emptyText}>{label}</Text>
    </Card>
  );
}

// ── styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  hero: {
    backgroundColor: colors.primary,
    padding: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  heroBack: { color: 'rgba(255,255,255,0.9)', fontSize: fontSize.md, fontWeight: '600' },
  heroTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.textOnPrimary,
    marginBottom: spacing.xs,
  },
  heroSubtitle: {
    fontSize: fontSize.md,
    color: 'rgba(255,255,255,0.85)',
    marginBottom: spacing.xs,
  },
  heroMetaRow: { flexDirection: 'row', flexWrap: 'wrap' },
  heroMeta: { fontSize: fontSize.sm, color: 'rgba(255,255,255,0.7)' },

  tabs: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: spacing.sm,
  },
  tab: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.full,
    backgroundColor: colors.background,
  },
  tabActive: { backgroundColor: colors.primary },
  tabLabel: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: '600' },
  tabLabelActive: { color: colors.textOnPrimary },

  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, paddingBottom: spacing.xxxl },

  // Pool standings table
  poolContainer: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.divider,
    marginBottom: spacing.md,
  },
  poolLabelBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.primaryLight,
  },
  poolLabel: { fontSize: fontSize.md, fontWeight: '700', color: colors.primary },
  poolLabelMeta: { fontSize: fontSize.xs, color: colors.primary, opacity: 0.7 },
  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  headerCell: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textOnPrimary },
  poolRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  poolRowAlt: { backgroundColor: '#fafafa' },
  cell: { fontSize: fontSize.sm, color: colors.text },
  rankCol: { width: 24, textAlign: 'center' },
  rankText: { fontWeight: '700' },
  teamCol: { flex: 1, paddingRight: spacing.xs },
  statCol: { width: 28, textAlign: 'center' },
  linkText: { color: colors.primary, fontWeight: '500' },
  d1Tag: { color: colors.accent, fontSize: fontSize.xs, fontWeight: '700' },

  // Schedule rows
  dayCard: {},
  dayCardTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: spacing.sm,
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  matchTimeBox: { width: 70 },
  matchTime: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  matchCourt: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  matchTeamsBox: { flex: 1 },
  matchTeamLink: { color: colors.primary, fontSize: fontSize.sm, fontWeight: '500' },
  matchTeamUnresolved: { color: colors.textSecondary, fontSize: fontSize.sm, fontStyle: 'italic' },
  matchVs: { color: colors.textLight, fontSize: fontSize.xs, marginVertical: 2 },
  matchExtra: { color: colors.accent, fontSize: fontSize.xs, marginLeft: spacing.sm },

  // Rankings
  rankCard: {},
  rankCardTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: spacing.sm,
  },
  rankRow: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  rankLabel: { width: 50, color: colors.accent, fontSize: fontSize.sm, fontWeight: '700' },
  rankTeam: { flex: 1, color: colors.primary, fontSize: fontSize.md, fontWeight: '500' },

  // Resources
  resourcesSection: { marginTop: spacing.lg },
  docsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  docsIcon: { fontSize: 20, marginRight: spacing.sm },
  docsLabel: { flex: 1, fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  docsChev: { fontSize: 20, color: colors.textLight },

  // Spinner / empty
  spinner: { alignItems: 'center', paddingVertical: spacing.xxxl },
  spinnerText: { color: colors.textSecondary, marginTop: spacing.md },
  empty: { alignItems: 'center', padding: spacing.xxl },
  emptyText: { color: colors.textSecondary, textAlign: 'center', fontSize: fontSize.md },
});
