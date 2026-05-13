// ── PlayerDetailScreen ─────────────────────────────────────────────────────
//
// Drill-in view for a single player on the user's team. Reached from the
// per-player table on the Analytics dashboard. Shows:
//   • Season totals card (kills/blocks/aces/assists/digs/pass/errors)
//   • Splits stripe (All / AES / Timu / Standalone), with Pool/Playoff
//     sub-stripe under AES when phase data is present
//   • Standout-match callout (player's biggest scoring game)
//   • Match-by-match list with kind/phase badges
//
// Re-renders whenever the splits change. The aggregation pipeline is
// pure — `aggregatePlayerCareer()` rebuilt against the filtered slice
// each toggle.
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
import type { Match, MatchCategory, MatchKind } from '../types/match';
import { loadMatches } from '../utils/scoredMatchStore';
import { matchCategoryLabel } from '../utils/matchMetaPure';
import {
  aggregatePlayerCareer,
  computeOnCourtPercent,
  sliceHasPhaseInfo,
  teamSide,
  type PerMatchOnCourt,
  type Phase,
  type PlayerCareerStats,
  type PlayerMatchEntry,
} from '../utils/analytics';
import { ColumnKey } from '../components/ColumnKey';

type PlayerPositionCode = 'S' | 'OH' | 'MB' | 'OPP' | 'L' | 'DS';

/**
 * Look up the position to attribute to this player in this match. Per-
 * match override (set by the analytics tagger UI when it lands) wins
 * over the default `position` field on the roster snapshot. Returns
 * `null` when neither is set.
 */
function resolvePositionForMatch(
  match: Match,
  teamProfileId: string,
  shirt: number
): PlayerPositionCode | null {
  const side = teamSide(match, teamProfileId);
  if (!side) return null;
  const roster = side === 'home' ? match.rosters.home : match.rosters.away;
  const entry = roster.find((p) => p.shirt === shirt);
  if (!entry) return null;
  const override = entry.perMatchPositionOverrides?.[match.id];
  if (override) return override;
  return (entry.position as PlayerPositionCode | undefined) ?? null;
}

function positionLabel(code: PlayerPositionCode): string {
  switch (code) {
    case 'S': return 'Setter';
    case 'OH': return 'Outside Hitter';
    case 'MB': return 'Middle Blocker';
    case 'OPP': return 'Opposite';
    case 'L': return 'Libero';
    case 'DS': return 'Defensive Specialist';
  }
}

interface Props {
  teamProfileId: string;
  teamName: string;
  shirt: number;
  /** Optional initial display name — saves a flicker before stats load. */
  initialName?: string;
  onBack: () => void;
}

type KindFilter = 'all' | MatchKind;

export function PlayerDetailScreen({
  teamProfileId,
  teamName,
  shirt,
  initialName,
  onBack,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [loading, setLoading] = useState(true);
  const [allMatches, setAllMatches] = useState<Match[]>([]);
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [phaseFilter, setPhaseFilter] = useState<'all' | Phase>('all');
  const [positionSplit, setPositionSplit] = useState<PlayerPositionCode | 'all'>('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const matches = await loadMatches();
        if (cancelled) return;
        const teamMatches = matches.filter(
          (m) =>
            m.meta.home.teamProfileId === teamProfileId ||
            m.meta.away.teamProfileId === teamProfileId
        );
        setAllMatches(teamMatches);
      } catch (err) {
        if (!cancelled) console.warn('[PlayerDetailScreen] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teamProfileId]);

  // Reset phase to 'all' when leaving AES — the sub-stripe disappears.
  useEffect(() => {
    if (kindFilter !== 'aes') setPhaseFilter('all');
  }, [kindFilter]);

  // Build a per-match position map (matchId → position). When the user
  // has tagged the player's per-match position (or set a default on the
  // roster snapshot), the screen can split the season totals by it.
  const positionByMatchId = useMemo(() => {
    const m = new Map<string, PlayerPositionCode>();
    for (const match of allMatches) {
      const pos = resolvePositionForMatch(match, teamProfileId, shirt);
      if (pos) m.set(match.id, pos);
    }
    return m;
  }, [allMatches, teamProfileId, shirt]);

  // Distinct positions seen across this player's matches — empty / single
  // entry means we don't render the position split picker.
  const positionsSeen = useMemo(() => {
    const seen = new Set<PlayerPositionCode>();
    for (const pos of positionByMatchId.values()) seen.add(pos);
    return Array.from(seen);
  }, [positionByMatchId]);

  // Match slice with active filters applied. The position-split filter
  // narrows below the kindFilter/phaseFilter slice.
  const matchesForCareer = useMemo(() => {
    if (positionSplit === 'all') return allMatches;
    return allMatches.filter((m) => positionByMatchId.get(m.id) === positionSplit);
  }, [allMatches, positionSplit, positionByMatchId]);

  // Build player career rollup against the filtered slice.
  const career: PlayerCareerStats = useMemo(() => {
    const filter = {
      respectIncludeInStats: true as const,
      matchKind: (kindFilter === 'all' ? undefined : kindFilter) as
        | MatchKind
        | undefined,
      phase: phaseFilter === 'all' ? undefined : phaseFilter,
    };
    return aggregatePlayerCareer(matchesForCareer, teamProfileId, shirt, filter);
  }, [matchesForCareer, teamProfileId, shirt, kindFilter, phaseFilter]);

  // Per-match on-court % for this player in the current slice (workbook
  // "On-Court %" column at match grain).
  const onCourtPerMatch: PerMatchOnCourt[] = useMemo(() => {
    const filter = {
      respectIncludeInStats: true as const,
      matchKind: (kindFilter === 'all' ? undefined : kindFilter) as
        | MatchKind
        | undefined,
      phase: phaseFilter === 'all' ? undefined : phaseFilter,
    };
    return computeOnCourtPercent(matchesForCareer, teamProfileId, shirt, filter);
  }, [matchesForCareer, teamProfileId, shirt, kindFilter, phaseFilter]);
  const onCourtByMatchId = useMemo(() => {
    const m = new Map<string, PerMatchOnCourt>();
    for (const r of onCourtPerMatch) m.set(r.matchId, r);
    return m;
  }, [onCourtPerMatch]);
  const seasonOnCourtPct = useMemo(() => {
    let totalRallies = 0;
    let onCourtRallies = 0;
    for (const r of onCourtPerMatch) {
      totalRallies += r.rallies;
      onCourtRallies += r.ralliesOnCourt;
    }
    return totalRallies > 0 ? onCourtRallies / totalRallies : NaN;
  }, [onCourtPerMatch]);

  // Phase sub-stripe is only meaningful when AES is selected and at
  // least one AES match in the slice has phase info.
  const aesMatches = useMemo(
    () =>
      allMatches.filter(
        (m) =>
          (m.meta.matchKind ?? 'standalone') === 'aes' &&
          m.meta.includeInStats !== false
      ),
    [allMatches]
  );
  const showPhaseStripe = kindFilter === 'aes' && sliceHasPhaseInfo(aesMatches);

  const playerName = career.totals.name || initialName || `#${shirt}`;
  const appearedMatches = career.matches.filter((e) => e.appeared);

  if (loading) {
    return (
      <View style={styles.container}>
        <Header onBack={onBack} title={initialName || `#${shirt}`} subtitle={teamName} colors={colors} styles={styles} />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header
        onBack={onBack}
        title={`#${shirt} ${playerName}`}
        subtitle={teamName}
        colors={colors}
        styles={styles}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Splits stripe */}
        <View style={styles.stripeWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.stripeRow}
          >
            <Chip label="All" active={kindFilter === 'all'} onPress={() => setKindFilter('all')} colors={colors} />
            <Chip label="AES" active={kindFilter === 'aes'} onPress={() => setKindFilter('aes')} colors={colors} />
            <Chip label="Timu" active={kindFilter === 'timu'} onPress={() => setKindFilter('timu')} colors={colors} />
            <Chip label="Standalone" active={kindFilter === 'standalone'} onPress={() => setKindFilter('standalone')} colors={colors} />
          </ScrollView>
          {showPhaseStripe ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.stripeRow, styles.subStripe]}
            >
              <Chip label="All phases" active={phaseFilter === 'all'} onPress={() => setPhaseFilter('all')} colors={colors} small />
              <Chip label="Pool" active={phaseFilter === 'pool'} onPress={() => setPhaseFilter('pool')} colors={colors} small />
              <Chip label="Playoff" active={phaseFilter === 'playoff'} onPress={() => setPhaseFilter('playoff')} colors={colors} small />
            </ScrollView>
          ) : null}
          {/* Position split — only renders when this player has played
              multiple positions across their matches. Lets the user view
              e.g. "Abby (Left)" vs "Abby (Libero)" splits independently. */}
          {positionsSeen.length >= 2 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.stripeRow, styles.subStripe]}
            >
              <Chip
                label={`All positions (${positionsSeen.length})`}
                active={positionSplit === 'all'}
                onPress={() => setPositionSplit('all')}
                colors={colors}
                small
              />
              {positionsSeen.map((pos) => (
                <Chip
                  key={pos}
                  label={positionLabel(pos)}
                  active={positionSplit === pos}
                  onPress={() => setPositionSplit(pos)}
                  colors={colors}
                  small
                />
              ))}
            </ScrollView>
          ) : null}
        </View>

        {appearedMatches.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No matches in this view</Text>
            <Text style={styles.emptyBody}>
              {kindFilter === 'all'
                ? 'This player has no scored matches yet. Score a match in Tier 2 to see analytics here.'
                : `No ${kindFilter} matches recorded for this player. Try a different split.`}
            </Text>
          </View>
        ) : (
          <>
            {/* Totals card */}
            <View style={styles.card}>
              <View style={styles.kickerRow}>
                <Text style={styles.cardKicker}>SEASON TOTALS</Text>
                <ColumnKey />
              </View>
              <Text style={styles.cardSubtitle}>
                {appearedMatches.length} match{appearedMatches.length === 1 ? '' : 'es'} in this view
              </Text>
              <View style={styles.statGrid}>
                <StatCell label="Kills" value={career.totals.kills} colors={colors} accent />
                <StatCell label="Blocks" value={career.totals.blocks} colors={colors} />
                <StatCell label="Aces" value={career.totals.aces} colors={colors} />
                <StatCell label="Assists" value={career.totals.assists} colors={colors} />
                <StatCell label="Digs" value={career.totals.digs} colors={colors} />
                <StatCell
                  label="Pass avg"
                  value={isNaN(career.totals.passAvg) ? '—' : career.totals.passAvg.toFixed(2)}
                  colors={colors}
                />
                <StatCell
                  label="Kill %"
                  value={isNaN(career.totals.killPct) ? '—' : (career.totals.killPct * 100).toFixed(0) + '%'}
                  colors={colors}
                />
                <StatCell label="Errors" value={career.totals.errors} colors={colors} bad={career.totals.errors > 0} />
                <StatCell
                  label="On-court %"
                  value={isNaN(seasonOnCourtPct) ? '—' : (seasonOnCourtPct * 100).toFixed(0) + '%'}
                  colors={colors}
                />
              </View>
            </View>

            {/* Standout match */}
            {career.standoutMatch ? (
              <StandoutCard entry={career.standoutMatch} colors={colors} styles={styles} />
            ) : null}

            {/* Match-by-match */}
            <View style={styles.card}>
              <Text style={styles.cardKicker}>MATCH BY MATCH</Text>
              <Text style={styles.cardSubtitle}>
                Most recent first · "On" = on-court % for that match
              </Text>
              {appearedMatches.map((entry) => {
                const match = allMatches.find((m) => m.id === entry.matchId);
                return (
                  <MatchRow
                    key={entry.matchId}
                    entry={entry}
                    onCourt={onCourtByMatchId.get(entry.matchId) ?? null}
                    category={match?.meta.matchCategory ?? null}
                    colors={colors}
                    styles={styles}
                  />
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Header ───────────────────────────────────────────────────────────────

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
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={{ width: 50 }} />
    </View>
  );
}

// ── Chip ─────────────────────────────────────────────────────────────────

function Chip({
  label,
  active,
  onPress,
  colors,
  small,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: ThemeColors;
  small?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        {
          paddingHorizontal: small ? spacing.sm : spacing.md,
          paddingVertical: small ? 4 : 6,
          borderRadius: borderRadius.full,
          marginRight: 6,
          borderWidth: 1,
        },
        active
          ? { backgroundColor: colors.primary, borderColor: colors.primary }
          : { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Text
        style={{
          fontSize: small ? 11 : fontSize.xs,
          fontWeight: '700',
          color: active ? colors.textOnPrimary : colors.textSecondary,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ── StatCell ─────────────────────────────────────────────────────────────

function StatCell({
  label,
  value,
  colors,
  accent,
  bad,
}: {
  label: string;
  value: number | string;
  colors: ThemeColors;
  accent?: boolean;
  bad?: boolean;
}) {
  const color = bad ? colors.error : accent ? colors.primary : colors.text;
  return (
    <View
      style={{
        alignItems: 'center',
        minWidth: 72,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.xs,
      }}
    >
      <Text style={{ fontSize: fontSize.xxl, fontWeight: '900', color }}>
        {typeof value === 'number' ? (value === 0 ? '0' : value) : value}
      </Text>
      <Text style={{ fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '600', marginTop: 2 }}>
        {label}
      </Text>
    </View>
  );
}

// ── Standout card ───────────────────────────────────────────────────────

function StandoutCard({
  entry,
  colors,
  styles,
}: {
  entry: PlayerMatchEntry;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const score = entry.line.kills + entry.line.blocks + entry.line.aces;
  return (
    <View style={[styles.card, styles.standoutCard, { borderColor: colors.accent }]}>
      <Text style={[styles.cardKicker, { color: colors.accent }]}>STANDOUT MATCH</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
        <Text style={{ fontSize: fontSize.xxxl, fontWeight: '900', color: colors.accent }}>
          {score}
        </Text>
        <Text style={{ fontSize: fontSize.sm, color: colors.textSecondary, marginLeft: spacing.sm }}>
          K+B+A · biggest scoring game
        </Text>
      </View>
      <Text style={[styles.standoutOpponent, { color: colors.text }]} numberOfLines={1}>
        vs {entry.opponent}
      </Text>
      <Text style={[styles.standoutMeta, { color: colors.textSecondary }]} numberOfLines={1}>
        {entry.matchLabel} · {new Date(entry.dateMs).toLocaleDateString()}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm }}>
        {entry.line.kills > 0 ? <PillStat label="K" value={entry.line.kills} colors={colors} /> : null}
        {entry.line.blocks > 0 ? <PillStat label="B" value={entry.line.blocks} colors={colors} /> : null}
        {entry.line.aces > 0 ? <PillStat label="A" value={entry.line.aces} colors={colors} /> : null}
        {entry.line.assists > 0 ? <PillStat label="Ast" value={entry.line.assists} colors={colors} /> : null}
        {entry.line.digs > 0 ? <PillStat label="D" value={entry.line.digs} colors={colors} /> : null}
      </View>
    </View>
  );
}

function PillStat({
  label,
  value,
  colors,
}: {
  label: string;
  value: number;
  colors: ThemeColors;
}) {
  return (
    <View
      style={{
        backgroundColor: colors.background,
        borderRadius: borderRadius.full,
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        marginRight: 6,
        marginBottom: 4,
      }}
    >
      <Text style={{ fontSize: fontSize.xs, fontWeight: '800', color: colors.text }}>
        {label}: <Text style={{ color: colors.primary }}>{value}</Text>
      </Text>
    </View>
  );
}

// ── Match-by-match row ──────────────────────────────────────────────────

function MatchRow({
  entry,
  onCourt,
  category,
  colors,
  styles,
}: {
  entry: PlayerMatchEntry;
  onCourt: PerMatchOnCourt | null;
  category: MatchCategory | null;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.matchRow}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
          <Text style={[styles.matchOpponent, { color: colors.text }]} numberOfLines={1}>
            vs {entry.opponent}
          </Text>
          <KindBadge kind={entry.matchKind} colors={colors} />
          {entry.phase !== 'unknown' ? <PhaseBadge phase={entry.phase} colors={colors} /> : null}
          {category ? (
            <View
              style={{
                backgroundColor: colors.background,
                paddingHorizontal: 5,
                paddingVertical: 1,
                borderRadius: borderRadius.sm,
                marginLeft: 4,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ fontSize: 9, fontWeight: '700', color: colors.textSecondary }}>
                {matchCategoryLabel(category).toUpperCase()}
              </Text>
            </View>
          ) : null}
          {entry.source === 'sideline-hd-import' ? (
            <View style={{ backgroundColor: colors.accentLight, paddingHorizontal: 6, paddingVertical: 1, borderRadius: borderRadius.sm, marginLeft: 4 }}>
              <Text style={{ fontSize: 9, fontWeight: '800', color: colors.accent }}>IMPORTED</Text>
            </View>
          ) : null}
        </View>
        <Text style={{ fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 }} numberOfLines={1}>
          {entry.matchLabel} · {new Date(entry.dateMs).toLocaleDateString()}
        </Text>
        <Text style={{ fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 4 }}>
          K {entry.line.kills} · B {entry.line.blocks} · A {entry.line.aces}
          {entry.line.assists > 0 ? ` · Ast ${entry.line.assists}` : ''}
          {entry.line.digs > 0 ? ` · D ${entry.line.digs}` : ''}
          {entry.line.errors > 0 ? ` · E ${entry.line.errors}` : ''}
          {onCourt && Number.isFinite(onCourt.onCourtPct)
            ? ` · On ${(onCourt.onCourtPct * 100).toFixed(0)}%`
            : ''}
        </Text>
      </View>
      <View style={styles.matchResult}>
        <Text
          style={[
            styles.matchResultText,
            entry.result === 'W'
              ? { color: colors.success }
              : entry.result === 'L'
              ? { color: colors.error }
              : { color: colors.textSecondary },
          ]}
        >
          {entry.result ?? '—'}
        </Text>
        <Text style={{ fontSize: fontSize.xs, color: colors.textSecondary }}>
          {entry.setsWon}–{entry.setsLost}
        </Text>
      </View>
    </View>
  );
}

function KindBadge({ kind, colors }: { kind: MatchKind; colors: ThemeColors }) {
  const label = kind === 'aes' ? 'AES' : kind === 'timu' ? 'TIMU' : kind === 'imported' ? 'IMP' : 'STD';
  const bg =
    kind === 'aes' ? colors.primary : kind === 'timu' ? colors.accent : colors.textLight;
  return (
    <View
      style={{
        backgroundColor: bg,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: borderRadius.sm,
        marginLeft: 6,
      }}
    >
      <Text style={{ fontSize: 9, fontWeight: '800', color: '#fff' }}>{label}</Text>
    </View>
  );
}

function PhaseBadge({ phase, colors }: { phase: 'pool' | 'playoff'; colors: ThemeColors }) {
  return (
    <View
      style={{
        backgroundColor: colors.background,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: borderRadius.sm,
        marginLeft: 4,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ fontSize: 9, fontWeight: '800', color: colors.textSecondary }}>
        {phase === 'pool' ? 'POOL' : 'PLAYOFF'}
      </Text>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────

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
    backBtn: {
      color: colors.primary,
      fontSize: fontSize.md,
      fontWeight: '600',
    },
    title: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: '800',
      textAlign: 'center',
    },
    subtitle: {
      color: colors.textSecondary,
      fontSize: fontSize.xs,
      textAlign: 'center',
      marginTop: 2,
    },
    scroll: {
      paddingBottom: spacing.xxxl + 40,
    },
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    stripeWrap: {
      backgroundColor: colors.surface,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    stripeRow: {
      paddingHorizontal: spacing.md,
      flexDirection: 'row',
    },
    subStripe: { paddingTop: spacing.xs },

    card: {
      backgroundColor: colors.surface,
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      borderRadius: borderRadius.lg,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardKicker: {
      fontSize: 11,
      fontWeight: '800',
      color: colors.textLight,
      letterSpacing: 1,
    },
    kickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    cardSubtitle: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      marginTop: 2,
      marginBottom: spacing.md,
    },
    statGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-around',
    },

    standoutCard: {
      borderWidth: 2,
    },
    standoutOpponent: {
      fontSize: fontSize.md,
      fontWeight: '700',
      marginTop: spacing.sm,
    },
    standoutMeta: {
      fontSize: fontSize.xs,
      marginTop: 2,
    },

    emptyCard: {
      backgroundColor: colors.surface,
      marginHorizontal: spacing.md,
      marginTop: spacing.xxl,
      borderRadius: borderRadius.lg,
      padding: spacing.xl,
      alignItems: 'center',
    },
    emptyTitle: {
      fontSize: fontSize.lg,
      fontWeight: '800',
      color: colors.text,
      marginBottom: spacing.sm,
    },
    emptyBody: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
    },

    matchRow: {
      flexDirection: 'row',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    matchOpponent: {
      fontSize: fontSize.md,
      fontWeight: '700',
    },
    matchResult: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 48,
    },
    matchResultText: {
      fontSize: fontSize.lg,
      fontWeight: '900',
    },
  });
}
