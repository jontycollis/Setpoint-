// ── StatsScreen (Analytics dashboard) ─────────────────────────────────────
//
// The team's analytics dashboard — Session γ rebuild on top of the
// Session-α data model. Sections, top-to-bottom:
//   • Season-at-a-glance card (record, top contributors, most-improved,
//     trend mini-chart)
//   • Splits stripe by matchKind (All / AES / Timu / Standalone),
//     sticky on scroll. Filters everything below.
//   • Sortable per-player table (drill-in → PlayerDetailScreen)
//   • Per-tournament rollup (drill-in → TournamentDetailScreen)
//   • Match-by-match list with kind/phase badges
//
// Pulls from `scored.matches.v1` via `loadMatches()` and respects
// `meta.includeInStats` for everything in the dashboard. The screen's
// own filter state lives locally — not persisted.
//
// Entry points:
//   • MatchList "📊 Team Stats" button (after the parallel session's
//     rename to "Analytics" lands)
//   • MyHome team-card "Analytics" chip
//   • Hamburger Tools → "Team Analytics"
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
import type { Match, MatchCategory, MatchKind, MatchSource } from '../types/match';
import { loadMatches } from '../utils/scoredMatchStore';
import { matchCategoryLabel } from '../utils/matchMetaPure';
import {
  aggregateSeasonStats,
  type PlayerStatLine,
  type SeasonStatSummary,
} from '../utils/statAggregator';
import {
  aggregateTournamentRollups,
  buildSeasonGlance,
  presentSplitKeys,
  getMatchPhase,
  splitKeyLabel,
  filterPlayersByPosition,
  type SeasonGlance,
  type TournamentRollup,
  type Phase,
} from '../utils/analytics';
import {
  aggregateServerSplits,
  type ServerSplitSummary,
  type ServerSplitLine,
} from '../utils/serverSplits';
import {
  aggregateOnCourtStats,
  type OnCourtSummary,
  type OnCourtPlayerLine,
} from '../utils/onCourtStats';
import {
  aggregateLineupCombos,
  topCombosByRallyWinPct,
  topCombosBySetDomination,
  type LineupComboLine,
} from '../utils/lineupCombos';
import {
  DEFAULT_ANALYTICS_VIEW_PREFERENCE,
  loadAnalyticsViewPreference,
  saveAnalyticsViewPreference,
  type AnalyticsSplitsAxis,
  type AnalyticsMetricSet,
} from '../utils/analyticsViewPreference';

type KindFilter = 'all' | MatchKind;
type PhaseFilter = 'all' | Phase;
type CategoryFilter = 'all' | MatchCategory | 'unknown';
type SourceFilter = 'all' | MatchSource;
type SortKey = 'kills' | 'blocks' | 'aces' | 'assists' | 'digs' | 'passAvg' | 'errors' | 'totalPoints';

// Workbook category iteration order — matches the workbook tab order
// the user is used to: champs → tournament → non-OVA → scrimmage →
// sunday league.
const CATEGORY_ORDER: MatchCategory[] = [
  'ova-champs',
  'ova-tournament',
  'non-ova-tournament',
  'scrimmage',
  'womens-sunday-league',
];

interface Props {
  teamProfileId: string;
  teamName: string;
  onBack: () => void;
  /** Drill-in to a single player. Caller pushes a PlayerDetailScreen
   *  with the same teamProfileId and the chosen shirt #. */
  onOpenPlayer?: (shirt: number, name: string) => void;
  /** Drill-in to a single tournament. Caller pushes a
   *  TournamentDetailScreen with the matchIds array. */
  onOpenTournament?: (
    tournamentName: string,
    matchIds: string[]
  ) => void;
}

export function StatsScreen({
  teamProfileId,
  teamName,
  onBack,
  onOpenPlayer,
  onOpenTournament,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [loading, setLoading] = useState(true);
  const [allMatches, setAllMatches] = useState<Match[]>([]);
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [splitsAxis, setSplitsAxis] = useState<AnalyticsSplitsAxis>(
    DEFAULT_ANALYTICS_VIEW_PREFERENCE.splitsAxis
  );
  const [metricSet, setMetricSet] = useState<AnalyticsMetricSet>(
    DEFAULT_ANALYTICS_VIEW_PREFERENCE.metricSet
  );
  const [sortKey, setSortKey] = useState<SortKey>('totalPoints');
  // positionFilter is plumbed through but the UI control ships disabled —
  // future iteration enables the dropdown without code rewiring.
  const [positionFilter] = useState<'S' | 'OH' | 'MB' | 'OPP' | 'L' | 'DS' | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [matches, pref] = await Promise.all([
          loadMatches(),
          loadAnalyticsViewPreference(),
        ]);
        if (cancelled) return;
        const teamMatches = matches.filter(
          (m) =>
            m.meta.home.teamProfileId === teamProfileId ||
            m.meta.away.teamProfileId === teamProfileId
        );
        setAllMatches(teamMatches);
        setSplitsAxis(pref.splitsAxis);
        setMetricSet(pref.metricSet);
      } catch (err) {
        if (!cancelled) console.warn('[StatsScreen] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teamProfileId]);

  // Persist the view preference whenever it changes.
  useEffect(() => {
    if (loading) return; // skip the initial render before load completes
    void saveAnalyticsViewPreference({ splitsAxis, metricSet });
  }, [splitsAxis, metricSet, loading]);

  // When the splits axis changes, reset the active chip so we don't
  // carry e.g. a stale "AES" filter into a matchCategory axis where
  // the chip doesn't exist.
  useEffect(() => {
    setKindFilter('all');
    setPhaseFilter('all');
    setCategoryFilter('all');
    setSourceFilter('all');
  }, [splitsAxis]);

  // Apply includeInStats + the active axis filter. Everything below
  // (glance, season totals, tournament rollup) is built from this
  // pre-filtered list.
  const filteredMatches = useMemo(() => {
    return allMatches.filter((m) => {
      if (m.meta.includeInStats === false) return false;
      if (kindFilter !== 'all' && (m.meta.matchKind ?? 'standalone') !== kindFilter) {
        return false;
      }
      if (phaseFilter !== 'all' && getMatchPhase(m) !== phaseFilter) {
        return false;
      }
      if (categoryFilter !== 'all') {
        const cat = m.meta.matchCategory;
        if (categoryFilter === 'unknown') {
          if (cat) return false;
        } else if (cat !== categoryFilter) {
          return false;
        }
      }
      if (sourceFilter !== 'all' && (m.meta.source ?? 'tier2-live') !== sourceFilter) {
        return false;
      }
      return true;
    });
  }, [allMatches, kindFilter, phaseFilter, categoryFilter, sourceFilter]);

  const presentKinds = useMemo(
    () => presentSplitKeys(allMatches, teamProfileId, 'matchKind', { respectIncludeInStats: true }),
    [allMatches, teamProfileId]
  );
  const presentCategories = useMemo(
    () => presentSplitKeys(allMatches, teamProfileId, 'matchCategory', { respectIncludeInStats: true }),
    [allMatches, teamProfileId]
  );
  const presentSources = useMemo(
    () => presentSplitKeys(allMatches, teamProfileId, 'source', { respectIncludeInStats: true }),
    [allMatches, teamProfileId]
  );

  // Phase chips only show when the current kind slice has identifiable
  // pool/playoff data. Computed against the kind-filtered (but not
  // phase-filtered) set so toggling phase doesn't make the chips disappear.
  const kindFilteredMatches = useMemo(() => {
    return allMatches.filter((m) => {
      if (m.meta.includeInStats === false) return false;
      if (kindFilter !== 'all' && (m.meta.matchKind ?? 'standalone') !== kindFilter) return false;
      return true;
    });
  }, [allMatches, kindFilter]);
  const presentPhases = useMemo(
    () => presentSplitKeys(kindFilteredMatches, teamProfileId, 'phase', { respectIncludeInStats: false }),
    [kindFilteredMatches, teamProfileId]
  );

  const glance: SeasonGlance = useMemo(
    () => buildSeasonGlance(filteredMatches, teamProfileId, { respectIncludeInStats: false }),
    [filteredMatches, teamProfileId]
  );

  const seasonSummary: SeasonStatSummary = useMemo(
    () => aggregateSeasonStats(filteredMatches, teamProfileId),
    [filteredMatches, teamProfileId]
  );

  const tournamentRollups: TournamentRollup[] = useMemo(
    () =>
      aggregateTournamentRollups(filteredMatches, teamProfileId, {
        respectIncludeInStats: false,
      }),
    [filteredMatches, teamProfileId]
  );

  const serverSplits: ServerSplitSummary = useMemo(
    () =>
      aggregateServerSplits(filteredMatches, teamProfileId, {
        respectIncludeInStats: false,
      }),
    [filteredMatches, teamProfileId]
  );

  const onCourtSummary: OnCourtSummary = useMemo(
    () =>
      aggregateOnCourtStats(filteredMatches, teamProfileId, {
        respectIncludeInStats: false,
      }),
    [filteredMatches, teamProfileId]
  );

  const lineupCombos = useMemo(
    () =>
      aggregateLineupCombos(filteredMatches, teamProfileId, {
        respectIncludeInStats: false,
      }),
    [filteredMatches, teamProfileId]
  );

  const sortedPlayers = useMemo(() => {
    const sorted = filterPlayersByPosition(seasonSummary.players, positionFilter).slice();
    sorted.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        if (isNaN(aVal) && isNaN(bVal)) return 0;
        if (isNaN(aVal)) return 1;
        if (isNaN(bVal)) return -1;
        return bVal - aVal;
      }
      return 0;
    });
    return sorted;
  }, [seasonSummary, sortKey, positionFilter]);

  if (loading) {
    return (
      <View style={styles.container}>
        <Header onBack={onBack} title={`${teamName} Analytics`} colors={colors} styles={styles} />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading analytics…</Text>
        </View>
      </View>
    );
  }

  // Honest empty state — no matches at all.
  if (allMatches.length === 0) {
    return (
      <View style={styles.container}>
        <Header onBack={onBack} title={`${teamName} Analytics`} colors={colors} styles={styles} />
        <ScrollView contentContainerStyle={styles.scroll}>
          <EmptyState
            title="No scored matches yet"
            body="Score a match in Tier 2 to see analytics here. Every match counts toward your season totals once you save it."
            colors={colors}
            styles={styles}
          />
        </ScrollView>
      </View>
    );
  }

  // Empty after filter — but data exists.
  const noMatchesInSlice = filteredMatches.length === 0;

  return (
    <View style={styles.container}>
      <Header onBack={onBack} title={`${teamName} Analytics`} colors={colors} styles={styles} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        stickyHeaderIndices={[0]}
        showsVerticalScrollIndicator={true}
      >
        {/* Sticky picker + splits stripe */}
        <View style={styles.stripeWrap}>
          {/* "Pick view" chips — axis + metric set */}
          <ViewPicker
            splitsAxis={splitsAxis}
            metricSet={metricSet}
            onPickAxis={setSplitsAxis}
            onPickMetricSet={setMetricSet}
            colors={colors}
            styles={styles}
          />

          {/* Active-axis chip stripe */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.stripeRow}
          >
            {splitsAxis === 'matchCategory' ? (
              <>
                <Chip
                  label="All categories"
                  active={categoryFilter === 'all'}
                  onPress={() => setCategoryFilter('all')}
                  colors={colors}
                />
                {CATEGORY_ORDER.filter((c) => presentCategories.has(c)).map((c) => (
                  <Chip
                    key={c}
                    label={matchCategoryLabel(c)}
                    active={categoryFilter === c}
                    onPress={() => setCategoryFilter(c)}
                    colors={colors}
                  />
                ))}
                {presentCategories.has('unknown') ? (
                  <Chip
                    label="Untagged"
                    active={categoryFilter === 'unknown'}
                    onPress={() => setCategoryFilter('unknown')}
                    colors={colors}
                  />
                ) : null}
              </>
            ) : splitsAxis === 'matchKind' ? (
              <>
                <Chip label="All" active={kindFilter === 'all'} onPress={() => setKindFilter('all')} colors={colors} />
                {presentKinds.has('aes') ? (
                  <Chip label="AES" active={kindFilter === 'aes'} onPress={() => setKindFilter('aes')} colors={colors} />
                ) : null}
                {presentKinds.has('timu') ? (
                  <Chip label="Timu" active={kindFilter === 'timu'} onPress={() => setKindFilter('timu')} colors={colors} />
                ) : null}
                {presentKinds.has('standalone') ? (
                  <Chip label="Standalone" active={kindFilter === 'standalone'} onPress={() => setKindFilter('standalone')} colors={colors} />
                ) : null}
                {presentKinds.has('imported') ? (
                  <Chip label="Imported" active={kindFilter === 'imported'} onPress={() => setKindFilter('imported')} colors={colors} />
                ) : null}
              </>
            ) : splitsAxis === 'phase' ? (
              <>
                <Chip label="All phases" active={phaseFilter === 'all'} onPress={() => setPhaseFilter('all')} colors={colors} />
                {presentPhases.has('pool') ? (
                  <Chip label="Pool" active={phaseFilter === 'pool'} onPress={() => setPhaseFilter('pool')} colors={colors} />
                ) : null}
                {presentPhases.has('playoff') ? (
                  <Chip label="Playoff" active={phaseFilter === 'playoff'} onPress={() => setPhaseFilter('playoff')} colors={colors} />
                ) : null}
              </>
            ) : (
              // source axis
              <>
                <Chip label="All sources" active={sourceFilter === 'all'} onPress={() => setSourceFilter('all')} colors={colors} />
                {presentSources.has('tier2-live') ? (
                  <Chip label="Live" active={sourceFilter === 'tier2-live'} onPress={() => setSourceFilter('tier2-live')} colors={colors} />
                ) : null}
                {presentSources.has('sideline-hd-import') ? (
                  <Chip label="Imported" active={sourceFilter === 'sideline-hd-import'} onPress={() => setSourceFilter('sideline-hd-import')} colors={colors} />
                ) : null}
                {presentSources.has('manual-entry') ? (
                  <Chip label="Manual" active={sourceFilter === 'manual-entry'} onPress={() => setSourceFilter('manual-entry')} colors={colors} />
                ) : null}
              </>
            )}
          </ScrollView>

          {/* Phase sub-stripe still useful as a cross-cut when the primary
              axis isn't already phase — visible only when phase data is
              actually present in the current slice. */}
          {splitsAxis !== 'phase' && (presentPhases.has('pool') || presentPhases.has('playoff')) && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.stripeRow, { paddingTop: 0 }]}
            >
              <Chip label="All phases" active={phaseFilter === 'all'} onPress={() => setPhaseFilter('all')} colors={colors} />
              {presentPhases.has('pool') ? (
                <Chip label="Pool" active={phaseFilter === 'pool'} onPress={() => setPhaseFilter('pool')} colors={colors} />
              ) : null}
              {presentPhases.has('playoff') ? (
                <Chip label="Playoff" active={phaseFilter === 'playoff'} onPress={() => setPhaseFilter('playoff')} colors={colors} />
              ) : null}
            </ScrollView>
          )}

          {/* Disabled "Filter by position" — wired but inert this iteration */}
          <View style={styles.positionFilterRow}>
            <Text style={styles.positionFilterLabel}>Filter by position</Text>
            <View style={styles.positionFilterPicker}>
              <Text style={styles.positionFilterPickerText}>All positions</Text>
              <Text style={styles.positionFilterPickerChevron}>▾</Text>
            </View>
          </View>
        </View>

        {noMatchesInSlice ? (
          <EmptyState
            title="No matches in this view"
            body="Try a different split, or score more matches with this match-kind to see analytics here."
            colors={colors}
            styles={styles}
          />
        ) : (
          <>
            <SeasonGlanceCard glance={glance} colors={colors} styles={styles} />

            {/* Sortable per-player table */}
            <View style={styles.card}>
              <Text style={styles.kicker}>PLAYERS</Text>
              <Text style={styles.cardSubtitle}>Tap a row for the full per-player breakdown</Text>

              {/* Sort buttons */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
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

              {/* Header row */}
              <View style={styles.tableHeader}>
                <Text style={[styles.headerCell, { flex: 2 }]}>#</Text>
                <Text style={[styles.headerCell, { flex: 4 }]}>Player</Text>
                <Text style={styles.headerCell}>K</Text>
                <Text style={styles.headerCell}>B</Text>
                <Text style={styles.headerCell}>A</Text>
                <Text style={styles.headerCell}>Pts</Text>
              </View>

              {sortedPlayers.length === 0 ? (
                <Text style={styles.empty}>No player stats recorded yet.</Text>
              ) : (
                sortedPlayers
                  .filter(
                    (p) =>
                      p.kills > 0 ||
                      p.blocks > 0 ||
                      p.aces > 0 ||
                      p.assists > 0 ||
                      p.digs > 0 ||
                      p.passAttempts > 0 ||
                      p.errors > 0
                  )
                  .map((p) => (
                    <PlayerRow
                      key={p.shirt}
                      line={p}
                      onPress={
                        onOpenPlayer ? () => onOpenPlayer(p.shirt, p.name) : undefined
                      }
                      colors={colors}
                      styles={styles}
                    />
                  ))
              )}
            </View>

            {/* Workbook-port cards — gated by metric set */}
            {(metricSet === 'advanced' || metricSet === 'lineups') ? (
              <OnCourtStatsCard
                summary={onCourtSummary}
                colors={colors}
                styles={styles}
              />
            ) : null}

            {(metricSet === 'advanced' || metricSet === 'lineups') ? (
              <ServerSplitsCard
                splits={serverSplits}
                colors={colors}
                styles={styles}
              />
            ) : null}

            {/* Lineup combinations — always shown when metricSet=lineups,
                also surfaced under 'advanced' so the workbook port
                renders end-to-end by default. */}
            {(metricSet === 'lineups' || metricSet === 'advanced') ? (
              <LineupCombosCard
                summary={lineupCombos}
                colors={colors}
                styles={styles}
              />
            ) : null}

            {/* Per-tournament rollup */}
            {tournamentRollups.length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.kicker}>TOURNAMENTS</Text>
                <Text style={styles.cardSubtitle}>
                  {tournamentRollups.length} tournament{tournamentRollups.length === 1 ? '' : 's'}{' '}
                  · tap to drill in
                </Text>
                {tournamentRollups.map((row) => (
                  <TournamentRow
                    key={row.tournamentKey}
                    rollup={row}
                    onPress={
                      onOpenTournament
                        ? () => onOpenTournament(row.tournamentName, row.matchIds)
                        : undefined
                    }
                    colors={colors}
                    styles={styles}
                  />
                ))}
              </View>
            ) : null}

            {/* Match-by-match */}
            <View style={styles.card}>
              <Text style={styles.kicker}>MATCH BY MATCH</Text>
              {seasonSummary.matches.length === 0 ? (
                <Text style={styles.empty}>No matches in this view.</Text>
              ) : (
                seasonSummary.matches
                  .slice()
                  .sort((a, b) => b.dateMs - a.dateMs)
                  .map((m) => {
                    const match = filteredMatches.find((x) => x.id === m.matchId);
                    const kind = match?.meta.matchKind ?? 'standalone';
                    const category = match?.meta.matchCategory;
                    return (
                      <View key={m.matchId} style={styles.matchListRow}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                            <Text style={[styles.matchOpponent, { color: colors.text }]} numberOfLines={1}>
                              vs {m.opponent}
                            </Text>
                            <KindBadge kind={kind} colors={colors} />
                            {category ? <CategoryBadge category={category} colors={colors} /> : null}
                          </View>
                          <Text style={{ fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 }} numberOfLines={1}>
                            {m.matchLabel} · {new Date(m.dateMs).toLocaleDateString()}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'center', minWidth: 48 }}>
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
                    );
                  })
              )}
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
  colors,
  styles,
}: {
  onBack: () => void;
  title: string;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.topBar}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <Text style={styles.backBtn}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <View style={{ width: 50 }} />
    </View>
  );
}

// ── ViewPicker — "Pick view" axis + metric set chips ─────────────────────

function ViewPicker({
  splitsAxis,
  metricSet,
  onPickAxis,
  onPickMetricSet,
  colors,
  styles,
}: {
  splitsAxis: AnalyticsSplitsAxis;
  metricSet: AnalyticsMetricSet;
  onPickAxis: (axis: AnalyticsSplitsAxis) => void;
  onPickMetricSet: (set: AnalyticsMetricSet) => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.viewPickerWrap}>
      <View style={styles.viewPickerRow}>
        <Text style={styles.viewPickerLabel}>SPLIT</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Chip label="Category" active={splitsAxis === 'matchCategory'} onPress={() => onPickAxis('matchCategory')} colors={colors} small />
          <Chip label="Match kind" active={splitsAxis === 'matchKind'} onPress={() => onPickAxis('matchKind')} colors={colors} small />
          <Chip label="Phase" active={splitsAxis === 'phase'} onPress={() => onPickAxis('phase')} colors={colors} small />
          <Chip label="Source" active={splitsAxis === 'source'} onPress={() => onPickAxis('source')} colors={colors} small />
        </ScrollView>
      </View>
      <View style={styles.viewPickerRow}>
        <Text style={styles.viewPickerLabel}>METRICS</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Chip label="Basic" active={metricSet === 'basic'} onPress={() => onPickMetricSet('basic')} colors={colors} small />
          <Chip label="Advanced" active={metricSet === 'advanced'} onPress={() => onPickMetricSet('advanced')} colors={colors} small />
          <Chip label="Lineups" active={metricSet === 'lineups'} onPress={() => onPickMetricSet('lineups')} colors={colors} small />
        </ScrollView>
      </View>
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

// ── Season-at-a-glance card ─────────────────────────────────────────────

function SeasonGlanceCard({
  glance,
  colors,
  styles,
}: {
  glance: SeasonGlance;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { record, topContributors, mostImproved, mostImprovedReason, trendPoints, sourceBreakdown } = glance;
  const sourceLine: string[] = [];
  if (sourceBreakdown.tier2Live > 0) sourceLine.push(`${sourceBreakdown.tier2Live} live`);
  if (sourceBreakdown.sidelineImport > 0) sourceLine.push(`${sourceBreakdown.sidelineImport} imported`);
  if (sourceBreakdown.manual > 0) sourceLine.push(`${sourceBreakdown.manual} manual`);

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>SEASON AT A GLANCE</Text>
      <Text style={styles.cardSubtitle}>
        {record.matchCount} match{record.matchCount === 1 ? '' : 'es'}
        {sourceLine.length > 0 ? ` · ${sourceLine.join(' · ')}` : ''}
      </Text>

      <View style={styles.glanceRecordRow}>
        <View style={styles.glanceRecordCell}>
          <Text style={[styles.glanceRecordValue, { color: colors.primary }]}>
            {record.matchesWon}–{record.matchesLost}
          </Text>
          <Text style={styles.glanceRecordLabel}>Match record</Text>
        </View>
        <View style={styles.glanceRecordCell}>
          <Text style={styles.glanceRecordValue}>
            {record.setsWon}–{record.setsLost}
          </Text>
          <Text style={styles.glanceRecordLabel}>Sets</Text>
        </View>
      </View>

      {topContributors.length > 0 ? (
        <View style={{ marginTop: spacing.md }}>
          <Text style={styles.glanceSubKicker}>TOP CONTRIBUTORS</Text>
          {topContributors.map((c, idx) => (
            <View key={c.shirt} style={styles.contribRow}>
              <Text style={[styles.contribRank, { color: colors.primary }]}>{idx + 1}</Text>
              <Text style={[styles.contribShirt, { color: colors.textSecondary }]}>#{c.shirt}</Text>
              <Text style={[styles.contribName, { color: colors.text }]} numberOfLines={1}>
                {c.name}
              </Text>
              <Text style={[styles.contribPoints, { color: colors.primary }]}>
                {c.totalPoints} pts
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ marginTop: spacing.md }}>
        <Text style={styles.glanceSubKicker}>MOST IMPROVED</Text>
        {mostImproved ? (
          <View style={{ marginTop: 4 }}>
            <Text style={{ fontSize: fontSize.md, fontWeight: '700', color: colors.text }}>
              #{mostImproved.shirt} {mostImproved.name}
            </Text>
            <Text style={{ fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 }}>
              +{mostImproved.delta.toFixed(1)} pts/match · {mostImproved.baseline.toFixed(1)} → {mostImproved.recent.toFixed(1)}
            </Text>
          </View>
        ) : (
          <Text style={{ fontSize: fontSize.xs, color: colors.textLight, fontStyle: 'italic', marginTop: 4 }}>
            {mostImprovedReason ?? 'No data'}
          </Text>
        )}
      </View>

      {trendPoints.length >= 2 ? (
        <View style={{ marginTop: spacing.lg }}>
          <Text style={styles.glanceSubKicker}>RALLY WIN % BY MATCH</Text>
          <TrendChart points={trendPoints} colors={colors} />
        </View>
      ) : null}
    </View>
  );
}

// Compact bar-style trend chart. Each bar is one match; height = rally
// win % (0..1). NaN entries render as a hollow bar so missing data is
// visible without faking a number. Tournament-start matches get a
// thin accent stripe at the bottom of the bar.
function TrendChart({
  points,
  colors,
}: {
  points: SeasonGlance['trendPoints'];
  colors: ThemeColors;
}) {
  const barW = 14;
  const gap = 4;
  const maxH = 60;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: spacing.sm, height: maxH + 8 }}>
      {points.map((p, idx) => {
        const valid = !isNaN(p.rallyWinPct);
        const h = valid ? Math.max(2, p.rallyWinPct * maxH) : 2;
        const bg = valid ? colors.primary : colors.border;
        return (
          <View key={p.matchId + idx} style={{ alignItems: 'center', marginRight: gap }}>
            <View
              style={{
                width: barW,
                height: h,
                backgroundColor: bg,
                borderRadius: 2,
                opacity: valid ? 1 : 0.5,
              }}
            />
            {p.tournamentName ? (
              <View
                style={{
                  width: barW,
                  height: 3,
                  backgroundColor: colors.accent,
                  marginTop: 2,
                }}
              />
            ) : (
              <View style={{ height: 5 }} />
            )}
          </View>
        );
      })}
    </View>
  );
}

// ── On-court / set wins card ─────────────────────────────────────────────

function OnCourtStatsCard({
  summary,
  colors,
  styles,
}: {
  summary: OnCourtSummary;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const t = summary.team;
  if (t.rallies === 0 && t.setsPlayed === 0) return null;
  const players = summary.players.filter((p) => p.rallies > 0);

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>ON-COURT &amp; SET WINS</Text>
      <Text style={styles.cardSubtitle}>
        Rally win % = % of on-court rallies the team won · Set win % = % of
        sets won when player was on court
      </Text>

      {/* Team totals strip */}
      <View
        style={{
          flexDirection: 'row',
          marginTop: spacing.sm,
          marginBottom: spacing.md,
        }}
      >
        <TeamMetric
          label="Rally Win %"
          pct={t.rallyWinPct}
          counts={`${t.ralliesWon} / ${t.rallies}`}
          colors={colors}
        />
        <View style={{ width: spacing.md }} />
        <TeamMetric
          label="Set Win %"
          pct={t.setWinPct}
          counts={`${t.setsWon} / ${t.setsPlayed}`}
          colors={colors}
        />
      </View>

      {/* Header row */}
      <View style={styles.tableHeader}>
        <Text style={[styles.headerCell, { flex: 2 }]}>#</Text>
        <Text style={[styles.headerCell, { flex: 4 }]}>Player</Text>
        <Text style={styles.headerCell}>M</Text>
        <Text style={styles.headerCell}>Set%</Text>
        <Text style={styles.headerCell}>Rly%</Text>
        <Text style={styles.headerCell}>On</Text>
      </View>

      {players.length === 0 ? (
        <Text style={styles.empty}>No qualifying data in this view.</Text>
      ) : (
        players.map((p) => (
          <OnCourtPlayerRow
            key={p.shirt}
            line={p}
            teamSetPct={t.setWinPct}
            teamRallyPct={t.rallyWinPct}
            colors={colors}
            styles={styles}
          />
        ))
      )}

      {summary.ambiguousRallies > 0 ? (
        <Text
          style={{
            fontSize: fontSize.xs,
            color: colors.textLight,
            marginTop: spacing.xs,
            fontStyle: 'italic',
          }}
        >
          {summary.ambiguousRallies} rallies not classified (missing
          lineup data).
        </Text>
      ) : null}
    </View>
  );
}

function OnCourtPlayerRow({
  line,
  teamSetPct,
  teamRallyPct,
  colors,
  styles,
}: {
  line: OnCourtPlayerLine;
  teamSetPct: number;
  teamRallyPct: number;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const setDelta = line.setsAppeared > 0 ? line.setWinPct - teamSetPct : NaN;
  const rallyDelta = line.rallies > 0 ? line.rallyWinPct - teamRallyPct : NaN;
  return (
    <View style={styles.tableRow}>
      <Text style={[styles.cell, { flex: 2, fontWeight: '800' }]}>{line.shirt}</Text>
      <Text
        style={[styles.cell, { flex: 4, textAlign: 'left', paddingLeft: spacing.xs }]}
        numberOfLines={1}
      >
        {line.name}
      </Text>
      <Text style={styles.cell}>{line.matchesAppeared || '—'}</Text>
      <Text
        style={[
          styles.cell,
          { color: deltaColor(setDelta, colors), fontWeight: '700' },
        ]}
      >
        {Number.isFinite(line.setWinPct) ? `${(line.setWinPct * 100).toFixed(0)}` : '—'}
      </Text>
      <Text
        style={[
          styles.cell,
          { color: deltaColor(rallyDelta, colors), fontWeight: '700' },
        ]}
      >
        {Number.isFinite(line.rallyWinPct) ? `${(line.rallyWinPct * 100).toFixed(0)}` : '—'}
      </Text>
      <Text style={styles.cell}>{line.rallies || '—'}</Text>
    </View>
  );
}

// ── Lineup combinations card ─────────────────────────────────────────────

function LineupCombosCard({
  summary,
  colors,
  styles,
}: {
  summary: { combos: LineupComboLine[]; totalRallies: number };
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [view, setView] = useState<'rally' | 'dominant'>('rally');
  if (summary.totalRallies === 0) return null;

  // Workbook-port thresholds: ≥50 rallies together, top 15 combos. Set
  // domination threshold stays at the workbook default (3).
  const MIN_RALLIES = 50;
  const TOP_N = 15;
  const rows =
    view === 'rally'
      ? topCombosByRallyWinPct(summary, MIN_RALLIES, TOP_N)
      : topCombosBySetDomination(summary, 3, TOP_N);
  const qualifyingCount = summary.combos.filter((c) => c.rallies >= MIN_RALLIES).length;

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>LINEUP COMBINATIONS</Text>
      <Text style={styles.cardSubtitle}>
        {view === 'rally'
          ? `Top ${TOP_N} 6-player combos by rally win % (min ${MIN_RALLIES} rallies together)`
          : `Top ${TOP_N} 6-player combos by set win % when dominant (min 3 dominated sets)`}
      </Text>

      {/* View toggle */}
      <View style={{ flexDirection: 'row', marginTop: spacing.sm, marginBottom: spacing.sm }}>
        <TouchableOpacity
          onPress={() => setView('rally')}
          activeOpacity={0.7}
          style={[styles.sortBtn, view === 'rally' && styles.sortBtnActive]}
        >
          <Text
            style={[styles.sortBtnText, view === 'rally' && styles.sortBtnTextActive]}
          >
            Rally win %
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setView('dominant')}
          activeOpacity={0.7}
          style={[styles.sortBtn, view === 'dominant' && styles.sortBtnActive]}
        >
          <Text
            style={[styles.sortBtnText, view === 'dominant' && styles.sortBtnTextActive]}
          >
            Set win % when dominant
          </Text>
        </TouchableOpacity>
      </View>

      {rows.length === 0 ? (
        <Text style={styles.empty}>
          Not enough data — need 6 distinct players playing
          {view === 'rally' ? ` ≥${MIN_RALLIES} rallies` : ' as the primary 6 for ≥3 sets'}{' '}
          together. {view === 'rally' && qualifyingCount === 0 && summary.combos.length > 0
            ? `(${summary.combos.length} combo${summary.combos.length === 1 ? '' : 's'} seen, none cleared the threshold)`
            : ''}
        </Text>
      ) : (
        rows.map((c) => (
          <LineupComboRow
            key={c.comboKey}
            combo={c}
            view={view}
            colors={colors}
            styles={styles}
          />
        ))
      )}
    </View>
  );
}

function LineupComboRow({
  combo,
  view,
  colors,
  styles,
}: {
  combo: LineupComboLine;
  view: 'rally' | 'dominant';
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const pct = view === 'rally' ? combo.rallyWinPct : combo.setDominatedWinPct;
  const primaryText =
    view === 'rally'
      ? `${combo.rallies} rallies · ${combo.ralliesWon} won`
      : `${combo.setsDominated} dominated · ${combo.setsDominatedWon} won`;
  return (
    <View
      style={{
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: spacing.sm }}>
          <Text
            style={{
              fontSize: fontSize.sm,
              fontWeight: '600',
              color: colors.text,
              lineHeight: 18,
            }}
          >
            {combo.playerNames.join(', ')}
          </Text>
          <Text
            style={{
              fontSize: fontSize.xs,
              color: colors.textSecondary,
              marginTop: 2,
            }}
          >
            {primaryText}
          </Text>
        </View>
        <Text
          style={{
            fontSize: fontSize.xl,
            fontWeight: '900',
            color: colors.primary,
            minWidth: 56,
            textAlign: 'right',
          }}
        >
          {Number.isFinite(pct) ? `${(pct * 100).toFixed(0)}%` : '—'}
        </Text>
      </View>
    </View>
  );
}

// ── Side-out & serving card ─────────────────────────────────────────────

function ServerSplitsCard({
  splits,
  colors,
  styles,
}: {
  splits: ServerSplitSummary;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [view, setView] = useState<'oncourt' | 'personal'>('oncourt');
  const t = splits.team;
  if (t.recvRallies === 0 && t.serveRallies === 0) return null;

  // Filter to players who actually contributed to the slice — the on-court
  // view wants anyone with rallies, personal view wants anyone who served.
  const rows: ServerSplitLine[] =
    view === 'oncourt'
      ? splits.players.filter((p) => p.recvRallies + p.serveRallies > 0)
      : splits.players
          .filter((p) => p.personalServes > 0)
          .slice()
          .sort((a, b) => b.personalServes - a.personalServes || a.shirt - b.shirt);

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>SIDE-OUT &amp; SERVING</Text>
      <Text style={styles.cardSubtitle}>
        Side-Out % = rallies won when receiving · Serve Pt % = rallies won
        when serving
      </Text>

      {/* Team totals strip */}
      <View
        style={{
          flexDirection: 'row',
          marginTop: spacing.sm,
          marginBottom: spacing.md,
        }}
      >
        <TeamMetric
          label="Side-Out %"
          pct={t.recvPct}
          counts={`${t.recvWon} / ${t.recvRallies}`}
          colors={colors}
        />
        <View style={{ width: spacing.md }} />
        <TeamMetric
          label="Serve Pt %"
          pct={t.servePct}
          counts={`${t.serveWon} / ${t.serveRallies}`}
          colors={colors}
        />
      </View>

      {/* View toggle */}
      <View style={{ flexDirection: 'row', marginBottom: spacing.sm }}>
        <TouchableOpacity
          onPress={() => setView('oncourt')}
          activeOpacity={0.7}
          style={[
            styles.sortBtn,
            view === 'oncourt' && styles.sortBtnActive,
          ]}
        >
          <Text
            style={[
              styles.sortBtnText,
              view === 'oncourt' && styles.sortBtnTextActive,
            ]}
          >
            On-court
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setView('personal')}
          activeOpacity={0.7}
          style={[
            styles.sortBtn,
            view === 'personal' && styles.sortBtnActive,
          ]}
        >
          <Text
            style={[
              styles.sortBtnText,
              view === 'personal' && styles.sortBtnTextActive,
            ]}
          >
            Personal serve
          </Text>
        </TouchableOpacity>
      </View>

      {/* Header row */}
      {view === 'oncourt' ? (
        <View style={styles.tableHeader}>
          <Text style={[styles.headerCell, { flex: 2 }]}>#</Text>
          <Text style={[styles.headerCell, { flex: 4 }]}>Player</Text>
          <Text style={styles.headerCell}>SO%</Text>
          <Text style={styles.headerCell}>SP%</Text>
          <Text style={styles.headerCell}>Rec</Text>
          <Text style={styles.headerCell}>Srv</Text>
        </View>
      ) : (
        <View style={styles.tableHeader}>
          <Text style={[styles.headerCell, { flex: 2 }]}>#</Text>
          <Text style={[styles.headerCell, { flex: 4 }]}>Player</Text>
          <Text style={styles.headerCell}>Srv</Text>
          <Text style={styles.headerCell}>Won</Text>
          <Text style={styles.headerCell}>Aces</Text>
          <Text style={styles.headerCell}>Pt%</Text>
        </View>
      )}

      {rows.length === 0 ? (
        <Text style={styles.empty}>No qualifying data in this view.</Text>
      ) : view === 'oncourt' ? (
        rows.map((p) => (
          <ServerOnCourtRow
            key={p.shirt}
            line={p}
            teamSidePct={t.recvPct}
            teamServePct={t.servePct}
            colors={colors}
            styles={styles}
          />
        ))
      ) : (
        rows.map((p) => (
          <ServerPersonalRow
            key={p.shirt}
            line={p}
            colors={colors}
            styles={styles}
          />
        ))
      )}

      {splits.team.ambiguousRallies > 0 ? (
        <Text
          style={{
            fontSize: fontSize.xs,
            color: colors.textLight,
            marginTop: spacing.xs,
            fontStyle: 'italic',
          }}
        >
          {splits.team.ambiguousRallies} rallies not classified (missing
          lineup data).
        </Text>
      ) : null}
    </View>
  );
}

function TeamMetric({
  label,
  pct,
  counts,
  colors,
}: {
  label: string;
  pct: number;
  counts: string;
  colors: ThemeColors;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.surfaceElevated,
        borderRadius: borderRadius.md,
        padding: spacing.md,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text
        style={{
          fontSize: 10,
          fontWeight: '700',
          color: colors.textLight,
          letterSpacing: 1,
        }}
      >
        {label.toUpperCase()}
      </Text>
      <Text
        style={{
          fontSize: fontSize.xxl,
          fontWeight: '900',
          color: colors.primary,
          marginTop: 2,
        }}
      >
        {Number.isFinite(pct) ? `${(pct * 100).toFixed(1)}%` : '—'}
      </Text>
      <Text style={{ fontSize: fontSize.xs, color: colors.textSecondary }}>
        {counts}
      </Text>
    </View>
  );
}

function ServerOnCourtRow({
  line,
  teamSidePct,
  teamServePct,
  colors,
  styles,
}: {
  line: ServerSplitLine;
  teamSidePct: number;
  teamServePct: number;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const soDelta = line.recvRallies > 0 ? line.recvPct - teamSidePct : NaN;
  const spDelta = line.serveRallies > 0 ? line.servePct - teamServePct : NaN;
  return (
    <View style={styles.tableRow}>
      <Text style={[styles.cell, { flex: 2, fontWeight: '800' }]}>{line.shirt}</Text>
      <Text
        style={[styles.cell, { flex: 4, textAlign: 'left', paddingLeft: spacing.xs }]}
        numberOfLines={1}
      >
        {line.name}
      </Text>
      <Text
        style={[
          styles.cell,
          { color: deltaColor(soDelta, colors), fontWeight: '700' },
        ]}
      >
        {Number.isFinite(line.recvPct) ? `${(line.recvPct * 100).toFixed(0)}` : '—'}
      </Text>
      <Text
        style={[
          styles.cell,
          { color: deltaColor(spDelta, colors), fontWeight: '700' },
        ]}
      >
        {Number.isFinite(line.servePct) ? `${(line.servePct * 100).toFixed(0)}` : '—'}
      </Text>
      <Text style={styles.cell}>{line.recvRallies || '—'}</Text>
      <Text style={styles.cell}>{line.serveRallies || '—'}</Text>
    </View>
  );
}

function ServerPersonalRow({
  line,
  colors,
  styles,
}: {
  line: ServerSplitLine;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.tableRow}>
      <Text style={[styles.cell, { flex: 2, fontWeight: '800' }]}>{line.shirt}</Text>
      <Text
        style={[styles.cell, { flex: 4, textAlign: 'left', paddingLeft: spacing.xs }]}
        numberOfLines={1}
      >
        {line.name}
      </Text>
      <Text style={styles.cell}>{line.personalServes || '—'}</Text>
      <Text style={styles.cell}>{line.personalServeWon || '—'}</Text>
      <Text style={[styles.cell, { color: colors.accent, fontWeight: '700' }]}>
        {line.personalServeAces || '—'}
      </Text>
      <Text
        style={[
          styles.cell,
          { fontWeight: '800', color: colors.primary },
        ]}
      >
        {Number.isFinite(line.personalServePct)
          ? `${(line.personalServePct * 100).toFixed(0)}`
          : '—'}
      </Text>
    </View>
  );
}

function deltaColor(delta: number, colors: ThemeColors): string {
  if (!Number.isFinite(delta)) return colors.text;
  if (delta >= 0.03) return colors.success;
  if (delta <= -0.03) return colors.error;
  return colors.text;
}

// ── Player row ───────────────────────────────────────────────────────────

function PlayerRow({
  line,
  onPress,
  colors,
  styles,
}: {
  line: PlayerStatLine;
  onPress?: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const inner = (
    <>
      <Text style={[styles.cell, { flex: 2, fontWeight: '800' }]}>{line.shirt}</Text>
      <Text style={[styles.cell, { flex: 4, textAlign: 'left', paddingLeft: spacing.xs }]} numberOfLines={1}>
        {line.name}
      </Text>
      <Text style={styles.cell}>{line.kills || '—'}</Text>
      <Text style={styles.cell}>{line.blocks || '—'}</Text>
      <Text style={styles.cell}>{line.aces || '—'}</Text>
      <Text style={[styles.cell, { fontWeight: '800', color: colors.primary }]}>
        {line.totalPoints || '—'}
      </Text>
    </>
  );
  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.6} style={styles.tableRow}>
        {inner}
      </TouchableOpacity>
    );
  }
  return <View style={styles.tableRow}>{inner}</View>;
}

// ── Tournament row ───────────────────────────────────────────────────────

function TournamentRow({
  rollup,
  onPress,
  colors,
  styles,
}: {
  rollup: TournamentRollup;
  onPress?: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const sourceLabel =
    rollup.source === 'aes' ? 'AES' : rollup.source === 'timu' ? 'TIMU' : rollup.source === 'imported' ? 'IMP' : 'STD';
  const sourceColor =
    rollup.source === 'aes' ? colors.primary : rollup.source === 'timu' ? colors.accent : colors.textLight;
  const inner = (
    <>
      <View
        style={{
          backgroundColor: sourceColor,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: borderRadius.sm,
          marginRight: spacing.sm,
        }}
      >
        <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }}>
          {sourceLabel}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.tournamentName, { color: colors.text }]} numberOfLines={1}>
          {rollup.tournamentName}
        </Text>
        <Text style={{ fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 }} numberOfLines={1}>
          {rollup.matchIds.length} match{rollup.matchIds.length === 1 ? '' : 'es'}
          {rollup.phaseLabel !== 'Unknown' ? ` · ${rollup.phaseLabel}` : ''}
          {' · '}
          {new Date(rollup.dateMs).toLocaleDateString()}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontSize: fontSize.md, fontWeight: '900', color: colors.primary }}>
          {rollup.matchesWon}–{rollup.matchesLost}
        </Text>
        <Text style={{ fontSize: fontSize.xs, color: colors.textSecondary }}>
          {rollup.setsWon}–{rollup.setsLost} sets
        </Text>
      </View>
    </>
  );
  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.6} style={styles.tournamentRow}>
        {inner}
      </TouchableOpacity>
    );
  }
  return <View style={styles.tournamentRow}>{inner}</View>;
}

// ── Kind badge ──────────────────────────────────────────────────────────

function KindBadge({ kind, colors }: { kind: MatchKind; colors: ThemeColors }) {
  const label = kind === 'aes' ? 'AES' : kind === 'timu' ? 'TIMU' : kind === 'imported' ? 'IMP' : 'STD';
  const bg = kind === 'aes' ? colors.primary : kind === 'timu' ? colors.accent : colors.textLight;
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

function CategoryBadge({ category, colors }: { category: MatchCategory; colors: ThemeColors }) {
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
      <Text style={{ fontSize: 9, fontWeight: '700', color: colors.textSecondary }}>
        {matchCategoryLabel(category).toUpperCase()}
      </Text>
    </View>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────

function EmptyState({
  title,
  body,
  colors,
  styles,
}: {
  title: string;
  body: string;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
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
    backBtn: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
    title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800', flex: 1, textAlign: 'center' },
    scroll: { paddingBottom: spacing.xxxl + 40 },
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: { color: colors.textSecondary, marginTop: spacing.sm },

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
    viewPickerWrap: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xs,
    },
    viewPickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 2,
    },
    viewPickerLabel: {
      width: 64,
      fontSize: 10,
      fontWeight: '800',
      color: colors.textLight,
      letterSpacing: 1,
    },
    positionFilterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      paddingBottom: 2,
      opacity: 0.5,
    },
    positionFilterLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textLight,
      letterSpacing: 0.5,
    },
    positionFilterPicker: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
    },
    positionFilterPickerText: {
      fontSize: 11,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    positionFilterPickerChevron: {
      fontSize: 10,
      color: colors.textLight,
      marginLeft: 6,
    },

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
      marginBottom: spacing.md,
    },
    empty: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      paddingVertical: spacing.md,
      textAlign: 'center',
    },

    glanceRecordRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.sm },
    glanceRecordCell: { alignItems: 'center', minWidth: 80 },
    glanceRecordValue: { fontSize: fontSize.xxxl, fontWeight: '900', color: colors.text },
    glanceRecordLabel: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '600', marginTop: 2 },

    glanceSubKicker: {
      fontSize: 10,
      fontWeight: '800',
      color: colors.textLight,
      letterSpacing: 1,
      marginBottom: spacing.xs,
    },
    contribRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 4,
    },
    contribRank: { width: 18, fontSize: fontSize.md, fontWeight: '900' },
    contribShirt: { width: 32, fontSize: fontSize.xs, fontWeight: '700' },
    contribName: { flex: 1, fontSize: fontSize.sm, fontWeight: '600' },
    contribPoints: { fontSize: fontSize.sm, fontWeight: '800' },

    sortBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: borderRadius.full,
      backgroundColor: colors.background,
      marginRight: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sortBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    sortBtnText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textSecondary },
    sortBtnTextActive: { color: colors.textOnPrimary },

    tableHeader: {
      flexDirection: 'row',
      paddingVertical: 6,
      borderBottomWidth: 2,
      borderBottomColor: colors.border,
    },
    headerCell: {
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
      alignItems: 'center',
    },
    cell: { flex: 1, fontSize: fontSize.sm, color: colors.text, textAlign: 'center' },

    tournamentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    tournamentName: { fontSize: fontSize.md, fontWeight: '700' },

    matchListRow: {
      flexDirection: 'row',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      alignItems: 'center',
    },
    matchOpponent: { fontSize: fontSize.md, fontWeight: '700' },
    matchResultText: { fontSize: fontSize.lg, fontWeight: '900' },

    emptyCard: {
      backgroundColor: colors.surface,
      marginHorizontal: spacing.md,
      marginTop: spacing.xxl,
      borderRadius: borderRadius.lg,
      padding: spacing.xl,
      alignItems: 'center',
    },
    emptyTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
    emptyBody: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  });
}
