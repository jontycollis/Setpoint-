// ── SeasonHistoryScreen ────────────────────────────────────────────────────
//
// Cross-source (AES + Timu) season history for MyTeam. Auto-populated as
// the user opens tournaments with their team loaded; can be expanded via
// Manage Season (paste URLs/tids for both systems).
//
// Layout:
//   • Blue hero with team name + "SEASON HISTORY" kicker
//   • Aggregate totals card (across both AES + Timu)
//   • Per-tournament cards (newest first, both sources):
//       – Source badge (AES / TIMU)
//       – Event name, division/subtitle, date, venue
//       – Pool / final ranks (medal chips for 1/2/3)
//       – Matches grouped Pool / Playoffs with opponent + set scores + W/L
// ────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../utils/theme';
import { Card } from '../components/Card';
import {
  loadAllSeasonIndices,
  buildMySeasonHistory,
  aggregateUnifiedStats,
  type UnifiedTournamentEntry,
  type UnifiedMatchEntry,
  type UnifiedAggregateStats,
} from '../utils/unifiedSeasonHistory';
import { loadMyTeamAliases } from '../utils/seasonTeamIdentity';
import {
  findStaleTids,
  bulkIndex,
  indexTournament,
  getBuildDiagnostics,
} from '../utils/timuSeasonIndex';
import { seasonForDateOrSynth, distinctSeasons, type Season } from '../utils/season';

interface Props {
  /** Display name shown in the hero. Typically myTeam.teamText or teamName. */
  primaryName: string;
  onBack: () => void;
  /**
   * When the user taps an AES tournament card, the second arg is the
   * user's team name AS IT APPEARED in that event/division (used to find
   * the right team when names drift across age groups).
   */
  onOpenAesTournament?: (
    eventKey: string,
    divisionId: number,
    myTeamAsSeen?: string
  ) => void;
  /**
   * When the user taps a Timu tournament card, the second arg is the
   * user's team name AS IT APPEARED in that tournament's pool/results
   * data (e.g. "Defensa U17 Rob" in 2024–25 vs "Defensa Rob" today).
   */
  onOpenTimuTournament?: (tid: number, myTeamAsSeen?: string) => void;
  onScoutOpponent: (teamName: string) => void;
  onManageSeason: () => void;
}

export function SeasonHistoryScreen({
  primaryName,
  onBack,
  onOpenAesTournament,
  onOpenTimuTournament,
  onScoutOpponent,
  onManageSeason,
}: Props) {
  const [history, setHistory] = useState<UnifiedTournamentEntry[]>([]);
  const [stats, setStats] = useState<UnifiedAggregateStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [autoHealing, setAutoHealing] = useState(false);

  const refresh = async () => {
    const [indices, storedAliases] = await Promise.all([
      loadAllSeasonIndices(),
      loadMyTeamAliases(),
    ]);
    // Always include the primary name as an implicit alias.
    const aliases = Array.from(new Set([primaryName, ...storedAliases])).filter(
      (s) => s && s.trim().length > 0
    );
    const h = buildMySeasonHistory(indices, aliases);
    setHistory(h);
    setStats(aggregateUnifiedStats(h));

    // Background auto-heal: if any indexed Timu snapshots look stale
    // (tournament finished, no playoff matches captured), silently
    // re-fetch them. The view will re-render once they're updated.
    const stale = findStaleTids(indices.timu);
    if (stale.length > 0 && !autoHealing) {
      setAutoHealing(true);
      bulkIndex(stale)
        .then(() => {
          // Re-run the unified build with the freshened data.
          loadAllSeasonIndices().then((freshIndices) => {
            const h2 = buildMySeasonHistory(freshIndices, aliases);
            setHistory(h2);
            setStats(aggregateUnifiedStats(h2));
          });
        })
        .finally(() => setAutoHealing(false));
    }
  };

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [primaryName]);

  const onPull = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  /**
   * Refresh a single tournament's snapshot in place. Used by the
   * "Refresh tournament" button on cards that have no matches.
   */
  const onRefreshEntry = useCallback(async (entry: UnifiedTournamentEntry) => {
    if (entry.source !== 'timu' || entry.tid == null) return;
    try {
      await indexTournament(entry.tid);
      const diag = getBuildDiagnostics(entry.tid);
      await refresh();
      if (diag) {
        // Surface what each of the three Timu pages returned so the user
        // can see whether results.php is the failing endpoint.
        const lines: string[] = [];
        lines.push(`Pools: ${diag.poolsOk ? 'OK' : `FAILED — ${diag.poolsError || 'unknown error'}`}`);
        lines.push(
          `Results: ${
            diag.resultsOk
              ? `OK — ${diag.resultsCount} match${diag.resultsCount === 1 ? '' : 'es'}`
              : `FAILED — ${diag.resultsError || 'unknown error'}`
          }`
        );
        lines.push(
          `Playoffs: ${
            diag.playoffsOk
              ? `OK — ${diag.finalRankingsCount} final ranking${diag.finalRankingsCount === 1 ? '' : 's'}`
              : `FAILED — ${diag.playoffsError || 'unknown error'}`
          }`
        );
        Alert.alert(
          `tid ${entry.tid} — ${entry.tournamentName}`,
          lines.join('\n')
        );
      }
    } catch (err: any) {
      Alert.alert(
        'Refresh failed',
        err?.message || 'Could not refresh that tournament.'
      );
    }
  }, []);

  return (
    <View style={styles.container}>
      <Hero teamName={primaryName} onBack={onBack} />

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPull} tintColor={colors.primary} />}
      >
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading history...</Text>
          </View>
        ) : history.length === 0 ? (
          <EmptyState teamName={primaryName} onManageSeason={onManageSeason} />
        ) : (
          <>
            {autoHealing && (
              <View style={styles.autoHealBanner}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.autoHealText}>
                  Refreshing playoff results from Timu...
                </Text>
              </View>
            )}
            {stats && (
              <SummaryCard stats={stats} label={
                distinctSeasons(history).length > 1 ? 'Career Totals' : 'Season Totals'
              } />
            )}
            {distinctSeasons(history).length > 1 && (
              <YearComparisonCard history={history} />
            )}
            {(() => {
              // Group history by season (newest first), preserving order within each.
              const groups = new Map<string, { season: Season; items: UnifiedTournamentEntry[] }>();
              for (const entry of history) {
                const season = seasonForDateOrSynth(entry.dateMs);
                const key = season?.id || 'unknown';
                if (!groups.has(key)) {
                  groups.set(key, {
                    season:
                      season ?? {
                        id: 'unknown',
                        startYear: 0,
                        endYear: 0,
                        label: 'Unknown season',
                        tidStart: 0,
                        tidEnd: 0,
                      },
                    items: [],
                  });
                }
                groups.get(key)!.items.push(entry);
              }
              const ordered = Array.from(groups.values()).sort(
                (a, b) => b.season.startYear - a.season.startYear
              );
              return ordered.map((group) => (
                <SeasonSection
                  key={group.season.id}
                  season={group.season}
                  items={group.items}
                  onOpenTimuTournament={(tid, asSeen) =>
                    onOpenTimuTournament?.(tid, asSeen)
                  }
                  onOpenAesTournament={(ek, did, asSeen) =>
                    onOpenAesTournament?.(ek, did, asSeen)
                  }
                  onScoutOpponent={onScoutOpponent}
                  onRefreshEntry={onRefreshEntry}
                />
              ));
            })()}
            <TouchableOpacity
              style={styles.footerBtn}
              onPress={onManageSeason}
              activeOpacity={0.7}
            >
              <Text style={styles.footerBtnText}>
                Manage Season ({history.length} indexed)
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────

function Hero({ teamName, onBack }: { teamName: string; onBack: () => void }) {
  return (
    <View style={styles.hero}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={styles.heroBack}>{'< Back'}</Text>
      </TouchableOpacity>
      <Text style={styles.heroKicker}>SEASON HISTORY</Text>
      <Text style={styles.heroTitle} numberOfLines={2}>{teamName}</Text>
    </View>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────

function EmptyState({
  teamName,
  onManageSeason,
}: {
  teamName: string;
  onManageSeason: () => void;
}) {
  return (
    <Card variant="outlined" style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>No history yet</Text>
      <Text style={styles.emptyBody}>
        We haven't indexed any tournament where {teamName} appears. As you open AES events
        and Timu tournaments, they'll be snapshotted here with every match and final placing.
        You can also add prior events manually in Manage Season.
      </Text>
      <TouchableOpacity style={styles.primaryBtn} onPress={onManageSeason} activeOpacity={0.7}>
        <Text style={styles.primaryBtnText}>Manage Season</Text>
      </TouchableOpacity>
    </Card>
  );
}

// ── Summary ───────────────────────────────────────────────────────────────

function SummaryCard({
  stats,
  label = 'Season Totals',
}: {
  stats: UnifiedAggregateStats;
  label?: string;
}) {
  return (
    <Card style={styles.summaryCard}>
      <Text style={styles.summaryTitle}>{label}</Text>
      <View style={styles.summaryGrid}>
        <SummaryCell label="Tournaments" value={String(stats.tournamentsPlayed)} />
        <SummaryCell
          label="Record"
          value={`${stats.totalMatchesWon}-${stats.totalMatchesLost}`}
          accent
        />
        <SummaryCell
          label="Sets"
          value={`${stats.totalSetsWon}-${stats.totalSetsLost}`}
        />
        <SummaryCell
          label="Best Rank"
          value={stats.bestPoolRank != null ? `#${stats.bestPoolRank}` : '—'}
        />
        <SummaryCell
          label="Best Finish"
          value={
            stats.bestFinish
              ? `${medalEmoji(stats.bestFinish.rank)}${medalEmoji(stats.bestFinish.rank) ? ' ' : ''}${stats.bestFinish.label}`
              : '—'
          }
          accent={!!stats.bestFinish}
        />
      </View>
      {stats.bestFinish ? (
        <Text style={styles.summaryBestNote} numberOfLines={1}>
          {stats.bestFinish.label} at {stats.bestFinish.tournamentName}
        </Text>
      ) : null}
    </Card>
  );
}

function SummaryCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <View style={styles.summaryCell}>
      <Text style={[styles.summaryValue, accent && styles.summaryValueAccent]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

// ── Year-on-year comparison ─────────────────────────────────────────────

interface SeasonRow {
  seasonId: string;
  seasonLabel: string;
  events: number;
  matchesWon: number;
  matchesLost: number;
  setsWon: number;
  setsLost: number;
  bestFinish: number | null;
  avgPoolRank: number | null;
}

function buildSeasonRows(history: UnifiedTournamentEntry[]): SeasonRow[] {
  const map = new Map<string, { season: Season; items: UnifiedTournamentEntry[] }>();
  for (const entry of history) {
    const season = seasonForDateOrSynth(entry.dateMs);
    if (!season) continue;
    if (!map.has(season.id)) map.set(season.id, { season, items: [] });
    map.get(season.id)!.items.push(entry);
  }
  const rows: SeasonRow[] = [];
  for (const { season, items } of map.values()) {
    const matchesWon = items.reduce((n, t) => n + t.matchesFor, 0);
    const matchesLost = items.reduce((n, t) => n + t.matchesAgainst, 0);
    const setsWon = items.reduce((n, t) => n + t.setsFor, 0);
    const setsLost = items.reduce((n, t) => n + t.setsAgainst, 0);
    const finishes = items.map((t) => t.finalRank).filter((n): n is number => n != null);
    const bestFinish = finishes.length ? Math.min(...finishes) : null;
    const ranks = items.map((t) => t.poolRank).filter((n): n is number => n != null);
    const avgPoolRank = ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null;
    rows.push({
      seasonId: season.id,
      seasonLabel: season.id,
      events: items.length,
      matchesWon,
      matchesLost,
      setsWon,
      setsLost,
      bestFinish,
      avgPoolRank,
    });
  }
  // Newest first.
  return rows.sort((a, b) => b.seasonId.localeCompare(a.seasonId));
}

function YearComparisonCard({ history }: { history: UnifiedTournamentEntry[] }) {
  const rows = buildSeasonRows(history);
  if (rows.length < 2) return null;

  // Compute per-column "best" so we can highlight improvements.
  const matchPcts = rows.map((r) => {
    const t = r.matchesWon + r.matchesLost;
    return t ? r.matchesWon / t : 0;
  });
  const setPcts = rows.map((r) => {
    const t = r.setsWon + r.setsLost;
    return t ? r.setsWon / t : 0;
  });
  const bestMatchPct = Math.max(...matchPcts);
  const bestSetPct = Math.max(...setPcts);
  const bestFinish =
    rows.map((r) => r.bestFinish).filter((n): n is number => n != null).length
      ? Math.min(...rows.map((r) => r.bestFinish ?? 99))
      : null;

  return (
    <Card style={styles.yoyCard}>
      <Text style={styles.yoyTitle}>Year on Year</Text>
      <View style={styles.yoyHeader}>
        <Text style={[styles.yoyCell, styles.yoySeasonCol]}>Season</Text>
        <Text style={[styles.yoyCell, styles.yoyNumCol]}>Events</Text>
        <Text style={[styles.yoyCell, styles.yoyRecordCol]}>Record</Text>
        <Text style={[styles.yoyCell, styles.yoyRecordCol]}>Sets</Text>
        <Text style={[styles.yoyCell, styles.yoyNumCol]}>Best</Text>
      </View>
      {rows.map((r, idx) => {
        const t = r.matchesWon + r.matchesLost;
        const matchPct = t ? r.matchesWon / t : 0;
        const matchPctIsBest = matchPct === bestMatchPct && matchPct > 0;
        const sT = r.setsWon + r.setsLost;
        const setPct = sT ? r.setsWon / sT : 0;
        const setPctIsBest = setPct === bestSetPct && setPct > 0;
        const finishIsBest = r.bestFinish != null && r.bestFinish === bestFinish;
        return (
          <View key={r.seasonId} style={styles.yoyRow}>
            <Text style={[styles.yoyCell, styles.yoySeasonCol, styles.yoySeasonText]}>
              {r.seasonLabel}
            </Text>
            <Text style={[styles.yoyCell, styles.yoyNumCol]}>{r.events}</Text>
            <View style={styles.yoyRecordCol}>
              <Text
                style={[
                  styles.yoyCell,
                  styles.yoyRecordPrimary,
                  matchPctIsBest && styles.yoyBest,
                ]}
              >
                {r.matchesWon}-{r.matchesLost}
              </Text>
              {t > 0 && (
                <Text style={styles.yoyRecordSecondary}>
                  {Math.round(matchPct * 100)}%
                </Text>
              )}
            </View>
            <View style={styles.yoyRecordCol}>
              <Text
                style={[
                  styles.yoyCell,
                  styles.yoyRecordPrimary,
                  setPctIsBest && styles.yoyBest,
                ]}
              >
                {r.setsWon}-{r.setsLost}
              </Text>
              {sT > 0 && (
                <Text style={styles.yoyRecordSecondary}>
                  {Math.round(setPct * 100)}%
                </Text>
              )}
            </View>
            <Text
              style={[
                styles.yoyCell,
                styles.yoyNumCol,
                finishIsBest && styles.yoyBest,
              ]}
            >
              {r.bestFinish != null ? `#${r.bestFinish}` : '—'}
            </Text>
          </View>
        );
      })}
      {rows.length >= 2 && <YearTrendStrip rows={rows} />}
    </Card>
  );
}

/** Tiny inline arrow showing year-over-year direction on key metrics. */
function YearTrendStrip({ rows }: { rows: SeasonRow[] }) {
  // Compare the most recent two seasons (rows are newest first).
  const cur = rows[0];
  const prev = rows[1];
  function arrow(a: number, b: number): { ch: string; color: string } {
    if (a > b) return { ch: '▲', color: colors.success };
    if (a < b) return { ch: '▼', color: colors.loss };
    return { ch: '→', color: colors.textLight };
  }
  const tCur = cur.matchesWon + cur.matchesLost;
  const tPrev = prev.matchesWon + prev.matchesLost;
  const matchPctCur = tCur ? cur.matchesWon / tCur : 0;
  const matchPctPrev = tPrev ? prev.matchesWon / tPrev : 0;
  const sCur = cur.setsWon + cur.setsLost;
  const sPrev = prev.setsWon + prev.setsLost;
  const setPctCur = sCur ? cur.setsWon / sCur : 0;
  const setPctPrev = sPrev ? prev.setsWon / sPrev : 0;
  // For finish rank, lower is better → invert
  const finishCur = cur.bestFinish ?? 99;
  const finishPrev = prev.bestFinish ?? 99;

  const matchTrend = arrow(matchPctCur, matchPctPrev);
  const setTrend = arrow(setPctCur, setPctPrev);
  const finishTrend = arrow(-finishCur, -finishPrev);

  return (
    <View style={styles.trendRow}>
      <Text style={styles.trendLabel}>vs. prior season:</Text>
      <Text style={[styles.trendItem, { color: matchTrend.color }]}>
        {matchTrend.ch} match win %
      </Text>
      <Text style={[styles.trendItem, { color: setTrend.color }]}>
        {setTrend.ch} set win %
      </Text>
      <Text style={[styles.trendItem, { color: finishTrend.color }]}>
        {finishTrend.ch} best finish
      </Text>
    </View>
  );
}

// ── Season section (multi-year grouping) ─────────────────────────────────

function SeasonSection({
  season,
  items,
  onOpenTimuTournament,
  onOpenAesTournament,
  onScoutOpponent,
  onRefreshEntry,
}: {
  season: Season;
  items: UnifiedTournamentEntry[];
  onOpenTimuTournament?: (tid: number, myTeamAsSeen?: string) => void;
  onOpenAesTournament?: (
    eventKey: string,
    divisionId: number,
    myTeamAsSeen?: string
  ) => void;
  onScoutOpponent: (teamName: string) => void;
  onRefreshEntry?: (entry: UnifiedTournamentEntry) => Promise<void>;
}) {
  // Per-season totals (separate from the career totals at top).
  const matchesWon = items.reduce((n, t) => n + t.matchesFor, 0);
  const matchesLost = items.reduce((n, t) => n + t.matchesAgainst, 0);
  const setsWon = items.reduce((n, t) => n + t.setsFor, 0);
  const setsLost = items.reduce((n, t) => n + t.setsAgainst, 0);
  const finishes = items
    .map((t) => t.finalRank)
    .filter((n): n is number => n != null);
  const bestFinish = finishes.length ? Math.min(...finishes) : null;

  return (
    <View style={styles.seasonSection}>
      <View style={styles.seasonHeader}>
        <Text style={styles.seasonTitle}>{season.label}</Text>
        <Text style={styles.seasonMeta}>
          {items.length} event{items.length === 1 ? '' : 's'} · {matchesWon}-{matchesLost} ·{' '}
          {setsWon}-{setsLost} sets
          {bestFinish != null ? ` · best #${bestFinish}` : ''}
        </Text>
      </View>
      {items.map((entry) => (
        <TournamentCard
          key={entry.sourceKey}
          entry={entry}
          onOpen={() => {
            if (entry.source === 'timu' && entry.tid != null) {
              onOpenTimuTournament?.(entry.tid, entry.myTeamAsSeen);
            } else if (
              entry.source === 'aes' &&
              entry.eventKey &&
              entry.divisionId != null
            ) {
              onOpenAesTournament?.(
                entry.eventKey,
                entry.divisionId,
                entry.myTeamAsSeen
              );
            }
          }}
          onScoutOpponent={onScoutOpponent}
          onRefresh={onRefreshEntry}
        />
      ))}
    </View>
  );
}

// ── Tournament card ───────────────────────────────────────────────────────

function TournamentCard({
  entry,
  onOpen,
  onScoutOpponent,
  onRefresh,
}: {
  entry: UnifiedTournamentEntry;
  onOpen: () => void;
  onScoutOpponent: (name: string) => void;
  onRefresh?: (entry: UnifiedTournamentEntry) => void;
}) {
  const poolMatches = entry.matches.filter((m) => m.isPool);
  const playoffMatches = entry.matches.filter((m) => !m.isPool);
  const finalColor = medalColor(entry.finalRank);
  const sourceBadgeColor = entry.source === 'aes' ? colors.primary : colors.accent;
  const noMatches = entry.matches.length === 0;
  const totalInSnapshot = entry.totalMatchesInSnapshot ?? 0;
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh(entry);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Card style={styles.card}>
      <TouchableOpacity onPress={onOpen} activeOpacity={0.7}>
        <View style={styles.tournamentTop}>
          <View style={{ flex: 1 }}>
            <View style={styles.sourceRow}>
              <View style={[styles.sourceBadge, { backgroundColor: sourceBadgeColor }]}>
                <Text style={styles.sourceBadgeText}>
                  {entry.source === 'aes' ? 'AES' : 'TIMU'}
                </Text>
              </View>
              <Text style={styles.tournamentName} numberOfLines={2}>
                {entry.tournamentName}
              </Text>
            </View>
            {entry.subtitle ? (
              <Text style={styles.tournamentDivision} numberOfLines={1}>
                {entry.subtitle}
              </Text>
            ) : null}
            <Text style={styles.tournamentMeta} numberOfLines={1}>
              {entry.dateText || 'Date unknown'}
              {entry.venueName ? ` · ${entry.venueName}` : ''}
            </Text>
          </View>
          {entry.finalRankLabel ? (
            <View style={[styles.finalRankChip, { backgroundColor: finalColor }]}>
              {medalEmoji(entry.finalRank) ? (
                <Text style={styles.finalRankMedal}>{medalEmoji(entry.finalRank)}</Text>
              ) : null}
              <Text style={styles.finalRankText}>{entry.finalRankLabel}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.poolSummaryRow}>
          {entry.poolId ? (
            <View style={styles.poolBadge}>
              <Text style={styles.poolBadgeText}>Pool {entry.poolId}</Text>
            </View>
          ) : null}
          {entry.poolRank != null ? (
            <Text style={styles.poolRankText}>
              {entry.poolId ? `#${entry.poolRank} in pool` : `#${entry.poolRank} overall`}
            </Text>
          ) : null}
          <Text style={styles.poolRecord}>
            {entry.matchesFor}-{entry.matchesAgainst} · {entry.setsFor}-{entry.setsAgainst} sets
          </Text>
        </View>
      </TouchableOpacity>

      {poolMatches.length > 0 && (
        <View style={styles.matchesSection}>
          <Text style={styles.matchesSectionTitle}>Pool Play</Text>
          {poolMatches.map((m, i) => (
            <MatchRow key={`pool-${i}`} match={m} onScout={() => onScoutOpponent(m.opponentName)} />
          ))}
        </View>
      )}
      {playoffMatches.length > 0 && (
        <View style={styles.matchesSection}>
          <Text style={styles.matchesSectionTitle}>Playoffs</Text>
          {playoffMatches.map((m, i) => (
            <MatchRow key={`p-${i}`} match={m} onScout={() => onScoutOpponent(m.opponentName)} />
          ))}
        </View>
      )}

      {/* Diagnostic + manual refresh: shown when we have ZERO match
          entries for the user. Helps the user distinguish "snapshot is
          empty (refresh me)" from "snapshot has data but my team's name
          didn't match (alias issue)". */}
      {noMatches && entry.source === 'timu' && onRefresh && (
        <View style={styles.diagnosticBox}>
          {totalInSnapshot === 0 ? (
            <Text style={styles.diagnosticText}>
              No match data cached for this tournament yet. Tap refresh to
              pull pool play and playoff results from Timu.
            </Text>
          ) : (
            <Text style={styles.diagnosticText}>
              Snapshot has {totalInSnapshot} match{totalInSnapshot === 1 ? '' : 'es'}
              {' '}but none matched your team's name. Refresh in case Timu
              updated the spelling.
            </Text>
          )}
          <TouchableOpacity
            style={styles.diagnosticBtn}
            onPress={handleRefresh}
            disabled={refreshing}
            activeOpacity={0.7}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.diagnosticBtnText}>Refresh tournament</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </Card>
  );
}

function MatchRow({ match, onScout }: { match: UnifiedMatchEntry; onScout: () => void }) {
  // A match is "decided" only when one team has more sets won than the other.
  // Equal sets (incl. 0-0) means in-progress / no result, never a loss.
  const decided = match.mySetsWon !== match.oppSetsWon;
  return (
    <View style={styles.matchRow}>
      <View style={styles.matchLeft}>
        <Text style={styles.matchRoundLabel} numberOfLines={1}>{match.roundLabel}</Text>
        <Text style={styles.matchMeta}>
          {match.time || '—'}{match.court ? ` · ${match.court}` : ''}
        </Text>
      </View>
      <View style={styles.matchCenter}>
        <TouchableOpacity onPress={onScout} activeOpacity={0.6}>
          <Text style={styles.matchOpp} numberOfLines={1}>vs {match.opponentName || 'TBD'}</Text>
        </TouchableOpacity>
        <View style={styles.matchScoresRow}>
          {match.myScores.map((my, i) => {
            const opp = match.oppScores[i] ?? 0;
            const won = my > opp;
            return (
              <Text
                key={i}
                style={[styles.matchScore, won ? styles.matchScoreWin : styles.matchScoreLoss]}
              >
                {my}-{opp}
              </Text>
            );
          })}
        </View>
      </View>
      <View
        style={[
          styles.wlChip,
          !decided ? styles.wlChipNeutral : match.iWon ? styles.wlChipWin : styles.wlChipLoss,
        ]}
      >
        <Text style={styles.wlChipText}>
          {!decided ? '—' : match.iWon ? 'W' : 'L'}
        </Text>
      </View>
    </View>
  );
}

function medalColor(rank: number | null): string {
  if (rank === 1) return '#d4af37';
  if (rank === 2) return '#b0b0b0';
  if (rank === 3) return '#cd7f32';
  return colors.primary;
}

/**
 * Medal emoji for top-3 finishes. Returns empty string for any other rank
 * so the chip falls back to its plain ordinal label.
 */
function medalEmoji(rank: number | null): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return '';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, paddingBottom: spacing.xxxl },

  hero: { backgroundColor: colors.primary, padding: spacing.xxl, paddingBottom: spacing.lg },
  heroBack: { color: 'rgba(255,255,255,0.9)', fontSize: fontSize.md, fontWeight: '600', marginBottom: spacing.sm },
  heroKicker: { color: 'rgba(255,255,255,0.7)', fontSize: fontSize.xs, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  heroTitle: { color: colors.textOnPrimary, fontSize: fontSize.xxl, fontWeight: '800' },

  loading: { alignItems: 'center', paddingVertical: spacing.xxxl },
  loadingText: { color: colors.textSecondary, marginTop: spacing.md },

  emptyCard: { alignItems: 'center' },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  emptyBody: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md, lineHeight: 20 },
  primaryBtn: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderRadius: borderRadius.md },
  primaryBtnText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: fontSize.md },

  summaryCard: {},
  summaryTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.primary, marginBottom: spacing.sm, paddingBottom: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.divider },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  summaryCell: { width: '20%', alignItems: 'center', paddingVertical: spacing.sm },
  summaryValue: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  summaryValueAccent: { color: colors.accent },
  summaryLabel: { fontSize: 10, color: colors.textSecondary, marginTop: 2, textTransform: 'uppercase', textAlign: 'center' },
  summaryBestNote: { fontSize: fontSize.xs, color: colors.accent, marginTop: spacing.xs, textAlign: 'center' },

  diagnosticBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: borderRadius.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  diagnosticText: {
    color: colors.text,
    fontSize: fontSize.xs,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  diagnosticBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
    alignSelf: 'flex-start',
    minHeight: 30,
    justifyContent: 'center',
  },
  diagnosticBtnText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },

  autoHealBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.sm,
  },
  autoHealText: {
    color: colors.primary,
    fontSize: fontSize.xs,
    marginLeft: spacing.sm,
    flex: 1,
  },

  // ── YoY card ──────────────────────────────────────────────────────
  yoyCard: { borderLeftWidth: 4, borderLeftColor: colors.accent },
  yoyTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: spacing.sm,
  },
  yoyHeader: {
    flexDirection: 'row',
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  yoyRow: {
    flexDirection: 'row',
    paddingVertical: spacing.xs,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  yoyCell: { fontSize: fontSize.xs, color: colors.text, fontVariant: ['tabular-nums'] },
  yoySeasonCol: { width: 60 },
  yoySeasonText: { fontWeight: '700', color: colors.primary },
  yoyNumCol: { width: 50, textAlign: 'center' },
  yoyRecordCol: { flex: 1, alignItems: 'center' },
  yoyRecordPrimary: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text },
  yoyRecordSecondary: { fontSize: 10, color: colors.textSecondary },
  yoyBest: { color: colors.success },
  trendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  trendLabel: { color: colors.textSecondary, fontSize: fontSize.xs },
  trendItem: { fontSize: fontSize.xs, fontWeight: '700' },

  seasonSection: { marginTop: spacing.lg, marginBottom: spacing.sm },
  seasonHeader: {
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
  },
  seasonTitle: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: -0.2,
  },
  seasonMeta: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },

  card: {},
  tournamentTop: { flexDirection: 'row', alignItems: 'flex-start' },
  sourceRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  sourceBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: spacing.sm,
  },
  sourceBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  tournamentName: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text, flexShrink: 1 },
  tournamentDivision: { fontSize: fontSize.sm, color: colors.primary, marginTop: 2 },
  tournamentMeta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  finalRankChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
    marginLeft: spacing.sm,
  },
  finalRankMedal: { fontSize: fontSize.md, lineHeight: fontSize.md + 2 },
  finalRankText: { color: '#fff', fontSize: fontSize.sm, fontWeight: '800' },

  poolSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: spacing.sm,
  },
  poolBadge: { backgroundColor: colors.primaryLight, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: borderRadius.sm },
  poolBadgeText: { color: colors.primary, fontSize: fontSize.xs, fontWeight: '700' },
  poolRankText: { fontSize: fontSize.sm, color: colors.text, fontWeight: '600' },
  poolRecord: { marginLeft: 'auto', fontSize: fontSize.xs, color: colors.textSecondary, fontVariant: ['tabular-nums'] },

  matchesSection: { marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  matchesSectionTitle: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  matchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.sm },
  matchLeft: { width: 110 },
  matchRoundLabel: { fontSize: fontSize.xs, color: colors.primary, fontWeight: '700' },
  matchMeta: { fontSize: 10, color: colors.textSecondary, marginTop: 2 },
  matchCenter: { flex: 1 },
  matchOpp: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '500' },
  matchScoresRow: { flexDirection: 'row', gap: 6, marginTop: 2 },
  matchScore: { fontSize: fontSize.xs, fontWeight: '600', fontVariant: ['tabular-nums'] },
  matchScoreWin: { color: colors.success },
  matchScoreLoss: { color: colors.loss },
  wlChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: borderRadius.sm },
  wlChipWin: { backgroundColor: colors.success },
  wlChipLoss: { backgroundColor: colors.loss },
  wlChipNeutral: { backgroundColor: colors.textLight },
  wlChipText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '700' },

  footerBtn: { marginTop: spacing.md, paddingVertical: spacing.md, alignItems: 'center', backgroundColor: colors.surface, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border },
  footerBtnText: { color: colors.primary, fontWeight: '600', fontSize: fontSize.sm },
});
