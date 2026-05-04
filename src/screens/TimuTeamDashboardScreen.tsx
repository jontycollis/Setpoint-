// ── TimuTeamDashboardScreen ────────────────────────────────────────────────
//
// Team-level view for a Timu-hosted tournament. Designed to feel like the
// AES TeamDashboard: blue hero, light body, Card sections.
//
// Sections (top-to-bottom):
//   1. Hero — team name, pool + rank, Favorite/MyTeam toggles, Share
//   2. Next Match card (if there's an upcoming match)
//   3. Quick Stats row — W/L record, sets, current rank, final rank
//   4. Upcoming matches list
//   5. Past results with per-set scores
//   6. My pool standings (team highlighted)
//   7. Action tiles — All Pools, Schedule, Rankings
//   8. Venue info, contact buttons, OVA docs sheet
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
  VenueInfoCard,
  ContactButtonsRow,
  OvaDocsSheet,
  TimuShareButton,
} from '../components/TimuInfoSheets';
import {
  getPools,
  getSchedule,
  getResults,
  getPlayoffs,
} from '../api/timuClient';
import { snapshotFromLoaded } from '../utils/timuSeasonIndex';
import {
  addMyTeamAlias,
  loadMyTeamAliases,
  matchesAnyAlias,
} from '../utils/seasonTeamIdentity';
import type {
  TimuTournamentInfo,
  TimuPool,
  TimuPoolTeam,
  TimuScheduleMatch,
  TimuMatchResult,
  TimuFinalRanking,
} from '../types/timu';

interface Props {
  tid: number;
  teamName: string;
  onBack: () => void;
  onViewAllPools: () => void;
  onViewSchedule: () => void;
  onViewRankings: () => void;
  /** Navigate to another team's dashboard (tap-to-scout). */
  onNavigateToTeam: (teamName: string) => void;
  /** Open the deep opponent-scout view for a given team. */
  onScoutOpponent: (teamName: string) => void;
  /** Open the team's full season history across all indexed tournaments. */
  onViewSeasonHistory?: (teamName: string) => void;
  /** Open the "Manage Season" screen to add prior tournaments. */
  onManageSeason?: () => void;

  isFavorite: boolean;
  onToggleFavorite: () => void;
  isMyTeam: boolean;
  onSetAsMyTeam: () => void;
  onClearMyTeam: () => void;

  onInfoLoaded?: (info: TimuTournamentInfo) => void;
}

export function TimuTeamDashboardScreen({
  tid,
  teamName,
  onBack,
  onViewAllPools,
  onViewSchedule,
  onViewRankings,
  onNavigateToTeam,
  onScoutOpponent,
  onViewSeasonHistory,
  onManageSeason,
  isFavorite,
  onToggleFavorite,
  isMyTeam,
  onSetAsMyTeam,
  onClearMyTeam,
  onInfoLoaded,
}: Props) {
  const [info, setInfo] = useState<TimuTournamentInfo | null>(null);
  const [pools, setPools] = useState<TimuPool[] | null>(null);
  const [schedule, setSchedule] = useState<TimuScheduleMatch[] | null>(null);
  const [results, setResults] = useState<TimuMatchResult[] | null>(null);
  const [finalRanking, setFinalRanking] = useState<TimuFinalRanking | null>(null);
  const [storedAliases, setStoredAliases] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);

  // The team's identity for matching against pool/result rows. Always
  // includes the prop teamName + any persisted MyTeam aliases so that a
  // tournament where the team is spelled slightly differently still
  // resolves correctly (e.g. "Defensa U17 Rob" vs "Defensa Rob").
  const matchAliases = useMemo(
    () => Array.from(new Set([teamName, ...storedAliases].filter(Boolean))),
    [teamName, storedAliases]
  );

  const loadAll = useCallback(async () => {
    // Load pools + schedule + results in parallel — playoffs last (only
    // needed for final rank, so failure is non-fatal).
    try {
      const [poolsPage, schedPage, resultsPage] = await Promise.all([
        getPools(tid),
        getSchedule(tid).catch(() => null),
        getResults(tid).catch(() => null),
      ]);
      setPools(poolsPage.pools);
      setInfo(poolsPage.info);
      onInfoLoaded?.(poolsPage.info);
      if (schedPage) setSchedule(schedPage.matches);
      if (resultsPage) setResults(resultsPage.matches);

      // Final ranking lookup + season-index snapshot.
      let finalRankings: Array<{ rank: number; rankLabel: string; teamName: string }> = [];
      try {
        const pl = await getPlayoffs(tid);
        finalRankings = pl.finalRankings;
        const mine = pl.finalRankings.find(
          (r) =>
            matchesAnyAlias(r.teamName, [teamName, ...storedAliases].filter(Boolean))
        );
        setFinalRanking(mine || null);
      } catch {
        /* ignore */
      }

      // Persist this tournament to the season index so scouting has
      // fresh data next time. We already have everything in memory so
      // this is a no-cost operation beyond AsyncStorage write.
      try {
        const flatTeams = poolsPage.pools.flatMap((p) =>
          p.teams.map((t) => ({
            teamName: t.teamName,
            poolId: p.poolId,
            rank: t.rank,
            setsFor: t.setsFor,
            setsAgainst: t.setsAgainst,
            matchesFor: t.matchesFor,
            matchesAgainst: t.matchesAgainst,
          }))
        );
        await snapshotFromLoaded(
          poolsPage.info,
          flatTeams,
          resultsPage?.matches || [],
          finalRankings
        );
      } catch {
        /* non-fatal */
      }
    } catch (err: any) {
      Alert.alert('Could not load team data', err?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [tid, teamName, onInfoLoaded]);

  useEffect(() => {
    loadAll();
    // Pull the persisted alias list so our match filters can recognise
    // older spellings of the user's team in this tournament's data.
    loadMyTeamAliases().then(setStoredAliases).catch(() => {});
    // When viewing our own team, register the team name as an alias so
    // cross-source season queries can match it. No-op for non-MyTeam.
    if (isMyTeam) {
      addMyTeamAlias(teamName).catch(() => {
        /* ignore */
      });
    }
  }, [loadAll, isMyTeam, teamName]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  // ── Derived data ────────────────────────────────────────────────────────

  const myPool: TimuPool | null = useMemo(() => {
    if (!pools) return null;
    return (
      pools.find((p) => p.teams.some((t) => matchesAnyAlias(t.teamName, matchAliases))) ||
      null
    );
  }, [pools, matchAliases]);

  const myStanding: TimuPoolTeam | null = useMemo(() => {
    if (!myPool) return null;
    return myPool.teams.find((t) => matchesAnyAlias(t.teamName, matchAliases)) || null;
  }, [myPool, matchAliases]);

  // Whether the tournament is completed — controls whether we surface
  // the "Next Match" + Upcoming sections (irrelevant for past events).
  // Signals: a final ranking is posted, OR the event date is more than
  // 36 hours in the past.
  const tournamentCompleted = useMemo(() => {
    if (finalRanking) return true;
    const dateMs = info?.dateMs;
    if (dateMs && Date.now() - dateMs > 36 * 60 * 60 * 1000) return true;
    return false;
  }, [finalRanking, info]);

  const upcomingMatches = useMemo(() => {
    if (tournamentCompleted) return [];
    if (!schedule) return [];
    const played = new Set(
      (results || []).map(
        (r) =>
          `${normalize(r.home.name)}|${normalize(r.away.name)}|${(r.time || '').toLowerCase()}|${r.court}`
      )
    );
    return schedule.filter((m) => {
      const homeName = m.home.name || '';
      const awayName = m.away.name || '';
      if (!matchesAnyAlias(homeName, matchAliases) && !matchesAnyAlias(awayName, matchAliases)) {
        return false;
      }
      // Skip matches we already have results for (try both orderings).
      const h = normalize(homeName);
      const a = normalize(awayName);
      const t = (m.time || '').toLowerCase();
      if (
        (h && a && played.has(`${h}|${a}|${t}|${m.court}`)) ||
        (h && a && played.has(`${a}|${h}|${t}|${m.court}`))
      ) {
        return false;
      }
      return true;
    });
  }, [schedule, results, matchAliases, tournamentCompleted]);

  const pastResults = useMemo(() => {
    if (!results) return [];
    return results.filter(
      (r) =>
        matchesAnyAlias(r.home.name, matchAliases) ||
        matchesAnyAlias(r.away.name, matchAliases)
    );
  }, [results, matchAliases]);

  const nextMatch = upcomingMatches[0] || null;

  // Helper: which side am I on? Use alias matching, not strict equality,
  // so a slight name drift between pool table and results doesn't drop
  // us from our own match.
  const iAmHomeIn = useCallback(
    (r: TimuMatchResult) => matchesAnyAlias(r.home.name, matchAliases),
    [matchAliases]
  );

  // Quick-stats derivation. Ties (incl. 0-0 unscored matches) are excluded
  // from both wins and losses — they represent in-progress / no-result rows
  // rather than legitimate outcomes.
  const wins = pastResults.filter((r) => {
    const my = iAmHomeIn(r) ? r.home : r.away;
    const opp = iAmHomeIn(r) ? r.away : r.home;
    return my.setsWon > opp.setsWon;
  }).length;
  const losses = pastResults.filter((r) => {
    const my = iAmHomeIn(r) ? r.home : r.away;
    const opp = iAmHomeIn(r) ? r.away : r.home;
    return opp.setsWon > my.setsWon;
  }).length;
  const setsWonTotal = pastResults.reduce(
    (n, r) => n + (iAmHomeIn(r) ? r.home.setsWon : r.away.setsWon),
    0
  );
  const setsLostTotal = pastResults.reduce(
    (n, r) => n + (iAmHomeIn(r) ? r.away.setsWon : r.home.setsWon),
    0
  );

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading && !pools) {
    return (
      <View style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading team...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Hero
        teamName={teamName}
        poolName={myPool?.name}
        rank={myStanding?.rank ?? null}
        tournamentName={info?.name || ''}
        tid={tid}
        onBack={onBack}
        isFavorite={isFavorite}
        onToggleFavorite={onToggleFavorite}
        isMyTeam={isMyTeam}
        onSetAsMyTeam={onSetAsMyTeam}
        onClearMyTeam={onClearMyTeam}
      />
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* Quick stats */}
        <QuickStats
          wins={wins}
          losses={losses}
          setsWon={setsWonTotal}
          setsLost={setsLostTotal}
          poolRank={myStanding?.rank ?? null}
          finalRank={finalRanking?.rankLabel}
        />

        {/* Next match — only shown if the tournament hasn't completed. */}
        {!tournamentCompleted && nextMatch && (
          <NextMatchCard
            match={nextMatch}
            meAliases={matchAliases}
            onPressOpponent={onNavigateToTeam}
            onScout={onScoutOpponent}
          />
        )}

        {/* Upcoming matches — also hidden when the tournament is over. */}
        {!tournamentCompleted && upcomingMatches.length > 1 && (
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>
              Upcoming Matches ({upcomingMatches.length - 1})
            </Text>
            {upcomingMatches.slice(1).map((m, i) => (
              <UpcomingRow
                key={i}
                match={m}
                meAliases={matchAliases}
                onPressOpponent={onNavigateToTeam}
                onScout={onScoutOpponent}
              />
            ))}
          </Card>
        )}

        {/* Results — relabel to "Final Results" when the tournament is done. */}
        {pastResults.length > 0 && (
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>
              {tournamentCompleted ? 'Final Results' : 'Results'} ({pastResults.length})
            </Text>
            {pastResults.map((r, i) => (
              <ResultRow
                key={i}
                match={r}
                meAliases={matchAliases}
                onPressOpponent={onNavigateToTeam}
                onScout={onScoutOpponent}
              />
            ))}
          </Card>
        )}

        {/* My pool standings */}
        {myPool && (
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>{myPool.name} Standings</Text>
            <View style={styles.standingsHeader}>
              <Text style={[styles.standingsHeaderCell, styles.rankCol]}>#</Text>
              <Text style={[styles.standingsHeaderCell, styles.teamCol]}>Team</Text>
              <Text style={[styles.standingsHeaderCell, styles.statCol]}>W</Text>
              <Text style={[styles.standingsHeaderCell, styles.statCol]}>L</Text>
              <Text style={[styles.standingsHeaderCell, styles.statCol]}>SW</Text>
              <Text style={[styles.standingsHeaderCell, styles.statCol]}>SL</Text>
            </View>
            {[...myPool.teams]
              .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
              .map((t, idx) => {
                const mine = matchesAnyAlias(t.teamName, matchAliases);
                const RowC: any = mine ? View : TouchableOpacity;
                return (
                  <RowC
                    key={t.globalNumber}
                    style={[
                      styles.standingsRow,
                      idx % 2 === 1 && styles.standingsRowAlt,
                      mine && styles.standingsRowMe,
                    ]}
                    onPress={mine ? undefined : () => onNavigateToTeam(t.teamName)}
                    activeOpacity={0.6}
                  >
                    <Text style={[styles.cell, styles.rankCol, styles.rankText, mine && styles.meText]}>
                      {t.rank ?? '–'}
                    </Text>
                    <Text
                      style={[
                        styles.cell,
                        styles.teamCol,
                        mine ? styles.meText : styles.linkText,
                      ]}
                      numberOfLines={1}
                    >
                      {t.teamName}
                    </Text>
                    <Text style={[styles.cell, styles.statCol, mine && styles.meText]}>{t.matchesFor}</Text>
                    <Text style={[styles.cell, styles.statCol, mine && styles.meText]}>{t.matchesAgainst}</Text>
                    <Text style={[styles.cell, styles.statCol, mine && styles.meText]}>{t.setsFor}</Text>
                    <Text style={[styles.cell, styles.statCol, mine && styles.meText]}>{t.setsAgainst}</Text>
                  </RowC>
                );
              })}
          </Card>
        )}

        {/* Action tiles */}
        <View style={styles.actionsRow}>
          <ActionTile label="All Pools" onPress={onViewAllPools} />
          <ActionTile label="Schedule" onPress={onViewSchedule} />
          <ActionTile label="Rankings" onPress={onViewRankings} />
        </View>

        {/* Season History — across all indexed tournaments */}
        {onViewSeasonHistory ? (
          <TouchableOpacity
            style={styles.historyBtn}
            onPress={() => onViewSeasonHistory(teamName)}
            activeOpacity={0.7}
          >
            <Text style={styles.historyIcon}>{'\u{1F3C5}'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.historyLabel}>Season History</Text>
              <Text style={styles.historySub}>Every indexed tournament with scores</Text>
            </View>
            <Text style={styles.historyChev}>{'>'}</Text>
          </TouchableOpacity>
        ) : null}

        {/* Manage Season — grows the scouting database */}
        {onManageSeason ? (
          <TouchableOpacity
            style={styles.manageSeasonBtn}
            onPress={onManageSeason}
            activeOpacity={0.7}
          >
            <Text style={styles.manageSeasonIcon}>{'\u{1F4CA}'}</Text>
            <Text style={styles.manageSeasonText}>Manage Season Tournaments</Text>
            <Text style={styles.manageSeasonChev}>{'>'}</Text>
          </TouchableOpacity>
        ) : null}

        {/* Tournament resources */}
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

// ── Hero ──────────────────────────────────────────────────────────────────

function Hero({
  teamName,
  poolName,
  rank,
  tournamentName,
  tid,
  onBack,
  isFavorite,
  onToggleFavorite,
  isMyTeam,
  onSetAsMyTeam,
  onClearMyTeam,
}: {
  teamName: string;
  poolName?: string;
  rank: number | null;
  tournamentName: string;
  tid: number;
  onBack: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  isMyTeam: boolean;
  onSetAsMyTeam: () => void;
  onClearMyTeam: () => void;
}) {
  return (
    <View style={styles.hero}>
      <View style={styles.heroTop}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.heroBack}>{'< Back'}</Text>
        </TouchableOpacity>
        <View style={styles.heroTopRight}>
          <TouchableOpacity onPress={onToggleFavorite} style={styles.favBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={[styles.fav, isFavorite && styles.favActive]}>{isFavorite ? '★' : '☆'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={isMyTeam ? onClearMyTeam : onSetAsMyTeam}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            style={styles.myTeamBtn}
          >
            <Text style={[styles.myTeam, isMyTeam && styles.myTeamActive]}>My Team</Text>
          </TouchableOpacity>
          <TimuShareButton tid={tid} tournamentName={tournamentName} />
        </View>
      </View>
      <Text style={styles.heroTitle} numberOfLines={2}>
        {teamName}
      </Text>
      <View style={styles.heroMeta}>
        {poolName ? <Text style={styles.heroMetaText}>{poolName}</Text> : null}
        {rank != null ? (
          <Text style={styles.heroMetaText}>  ·  Pool rank {rank}</Text>
        ) : null}
      </View>
    </View>
  );
}

// ── Quick stats ───────────────────────────────────────────────────────────

function QuickStats({
  wins,
  losses,
  setsWon,
  setsLost,
  poolRank,
  finalRank,
}: {
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  poolRank: number | null;
  finalRank?: string;
}) {
  const stats: Array<{ label: string; value: string; accent?: boolean }> = [
    { label: 'Record', value: `${wins}-${losses}` },
    { label: 'Sets', value: `${setsWon}-${setsLost}` },
  ];
  if (poolRank != null) stats.push({ label: 'Pool Rank', value: String(poolRank) });
  if (finalRank) stats.push({ label: 'Finish', value: finalRank, accent: true });

  return (
    <View style={styles.quickStats}>
      {stats.map((s) => (
        <View key={s.label} style={styles.quickStat}>
          <Text style={[styles.quickStatValue, s.accent && styles.quickStatAccent]}>
            {s.value}
          </Text>
          <Text style={styles.quickStatLabel}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Next match ────────────────────────────────────────────────────────────

function NextMatchCard({
  match,
  meAliases,
  onPressOpponent,
  onScout,
}: {
  match: TimuScheduleMatch;
  meAliases: string[];
  onPressOpponent: (name: string) => void;
  onScout: (name: string) => void;
}) {
  const iAmHome =
    !!match.home.name && matchesAnyAlias(match.home.name, meAliases);
  const oppName = iAmHome ? match.away.name : match.home.name;
  const oppRef = iAmHome ? match.away.ref : match.home.ref;
  return (
    <Card style={styles.nextMatchCard}>
      <Text style={styles.nextMatchLabel}>Next Match</Text>
      <View style={styles.nextMatchTopRow}>
        <Text style={styles.nextMatchTime}>{match.time}</Text>
        <View style={styles.courtBadge}>
          <Text style={styles.courtBadgeText}>Court {match.court}</Text>
        </View>
      </View>
      <Text style={styles.nextMatchDay}>{match.dayLabel.replace(/\s+$/, '')}</Text>
      <View style={styles.nextMatchOpp}>
        <Text style={styles.nextMatchVs}>vs </Text>
        {oppName ? (
          <TouchableOpacity onPress={() => onPressOpponent(oppName!)} activeOpacity={0.6}>
            <Text style={styles.nextMatchOppName}>{oppName}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.nextMatchOppRef}>{oppRef}</Text>
        )}
      </View>
      {match.extraLabel ? (
        <Text style={styles.nextMatchExtra}>({match.extraLabel})</Text>
      ) : null}
      {oppName ? (
        <TouchableOpacity
          style={styles.scoutBtn}
          onPress={() => onScout(oppName!)}
          activeOpacity={0.7}
        >
          <Text style={styles.scoutBtnText}>Scout {oppName}</Text>
        </TouchableOpacity>
      ) : null}
    </Card>
  );
}

// ── Upcoming row ──────────────────────────────────────────────────────────

function UpcomingRow({
  match,
  meAliases,
  onPressOpponent,
  onScout,
}: {
  match: TimuScheduleMatch;
  meAliases: string[];
  onPressOpponent: (name: string) => void;
  onScout: (name: string) => void;
}) {
  const iAmHome =
    !!match.home.name && matchesAnyAlias(match.home.name, meAliases);
  const oppName = iAmHome ? match.away.name : match.home.name;
  const oppRef = iAmHome ? match.away.ref : match.home.ref;
  return (
    <View style={styles.upcomingRow}>
      <View style={styles.matchTimeBox}>
        <Text style={styles.matchTime}>{match.time}</Text>
        <Text style={styles.matchCourt}>Crt {match.court}</Text>
      </View>
      <View style={styles.matchOppBox}>
        <Text style={styles.matchDay}>{match.dayLabel.replace(/\s+$/, '')}</Text>
        {oppName ? (
          <TouchableOpacity onPress={() => onPressOpponent(oppName!)} activeOpacity={0.6}>
            <Text style={styles.matchOppLink}>vs {oppName}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.matchOppUnresolved}>vs {oppRef}</Text>
        )}
      </View>
      {oppName ? (
        <TouchableOpacity
          onPress={() => onScout(oppName!)}
          style={styles.scoutInlineBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.scoutInlineText}>Scout</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ── Result row ────────────────────────────────────────────────────────────

function ResultRow({
  match,
  meAliases,
  onPressOpponent,
  onScout,
}: {
  match: TimuMatchResult;
  meAliases: string[];
  onPressOpponent: (name: string) => void;
  onScout: (name: string) => void;
}) {
  const iAmHome = matchesAnyAlias(match.home.name, meAliases);
  const myBox = iAmHome ? match.home : match.away;
  const oppBox = iAmHome ? match.away : match.home;
  // A match counts as decided only when one side has more sets won than the
  // other. Equal sets (including 0-0) means in-progress / no result yet —
  // never a loss. We display the W chip for wins, L for losses, and a "—"
  // chip for not-yet-decided.
  const decided = myBox.setsWon !== oppBox.setsWon;
  const iWon = decided && myBox.setsWon > oppBox.setsWon;

  return (
    <View style={styles.resultRow}>
      <View style={styles.resultTop}>
        <Text style={styles.resultMeta}>
          {match.dateText} · {match.time}
        </Text>
        <Text style={styles.resultCourt}>Crt {match.court}</Text>
      </View>
      {match.matchLabel ? (
        <Text style={styles.resultLabel}>{match.matchLabel}</Text>
      ) : null}
      <View style={styles.resultScoreRow}>
        <TouchableOpacity onPress={() => onPressOpponent(oppBox.name)} activeOpacity={0.6} style={{ flex: 1 }}>
          <Text style={styles.resultOpp}>vs {oppBox.name}</Text>
        </TouchableOpacity>
        <View style={styles.resultScores}>
          {myBox.scores.map((my, i) => {
            const opp = oppBox.scores[i] ?? 0;
            const setWon = my > opp;
            return (
              <Text
                key={i}
                style={[styles.resultScore, setWon ? styles.resultScoreWin : styles.resultScoreLoss]}
              >
                {my}-{opp}
              </Text>
            );
          })}
          <View
            style={[
              styles.wlChip,
              !decided ? styles.wlChipNeutral : iWon ? styles.wlChipWin : styles.wlChipLoss,
            ]}
          >
            <Text style={styles.wlChipText}>{!decided ? '—' : iWon ? 'W' : 'L'}</Text>
          </View>
        </View>
      </View>
      <TouchableOpacity
        onPress={() => onScout(oppBox.name)}
        style={styles.scoutInlineRow}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Text style={styles.scoutInlineText}>Scout {oppBox.name}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Action tile ───────────────────────────────────────────────────────────

function ActionTile({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.actionTile} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.actionTileText}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── pure helpers ──────────────────────────────────────────────────────────

function normalize(s: string): string {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function homeIs(r: TimuMatchResult, me: string): boolean {
  return normalize(r.home.name) === normalize(me);
}

function isWinnerFor(r: TimuMatchResult, me: string): boolean {
  const box = homeIs(r, me) ? r.home : r.away;
  const other = homeIs(r, me) ? r.away : r.home;
  return box.setsWon > other.setsWon;
}

// ── styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: spacing.md, color: colors.textSecondary },

  hero: { backgroundColor: colors.primary, padding: spacing.xxl, paddingBottom: spacing.lg },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  heroBack: { color: 'rgba(255,255,255,0.9)', fontSize: fontSize.md, fontWeight: '600' },
  heroTopRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  favBtn: { padding: spacing.xs },
  fav: { fontSize: 22, color: 'rgba(255,255,255,0.6)' },
  favActive: { color: colors.warning },
  myTeamBtn: { paddingHorizontal: spacing.sm, paddingVertical: 4 },
  myTeam: {
    fontSize: fontSize.xs,
    color: 'rgba(255,255,255,0.5)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
    fontWeight: '600',
  },
  myTeamActive: {
    color: colors.primary,
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  heroTitle: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.textOnPrimary, marginBottom: spacing.xs },
  heroMeta: { flexDirection: 'row', flexWrap: 'wrap' },
  heroMetaText: { fontSize: fontSize.sm, color: 'rgba(255,255,255,0.8)' },

  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, paddingBottom: spacing.xxxl },

  quickStats: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  quickStat: { flex: 1, alignItems: 'center' },
  quickStatValue: { fontSize: fontSize.xl, fontWeight: '800', color: colors.text },
  quickStatAccent: { color: colors.accent },
  quickStatLabel: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2, textTransform: 'uppercase' },

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

  nextMatchCard: { borderLeftWidth: 4, borderLeftColor: colors.accent },
  nextMatchLabel: {
    fontSize: fontSize.xs,
    color: colors.accent,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  nextMatchTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  nextMatchTime: { fontSize: fontSize.xl, fontWeight: '800', color: colors.text },
  courtBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
  },
  courtBadgeText: { color: colors.textOnPrimary, fontSize: fontSize.sm, fontWeight: '700' },
  nextMatchDay: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: spacing.xs },
  nextMatchOpp: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  nextMatchVs: { fontSize: fontSize.md, color: colors.textSecondary },
  nextMatchOppName: { fontSize: fontSize.md, fontWeight: '700', color: colors.primary },
  nextMatchOppRef: { fontSize: fontSize.md, color: colors.textSecondary, fontStyle: 'italic' },
  nextMatchExtra: { fontSize: fontSize.xs, color: colors.accent, marginTop: spacing.xs },

  upcomingRow: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  matchTimeBox: { width: 70 },
  matchTime: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  matchCourt: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  matchOppBox: { flex: 1 },
  matchDay: { color: colors.textLight, fontSize: fontSize.xs },
  matchOppLink: { color: colors.primary, fontSize: fontSize.sm, fontWeight: '500', marginTop: 2 },
  matchOppUnresolved: { color: colors.textSecondary, fontSize: fontSize.sm, fontStyle: 'italic', marginTop: 2 },

  resultRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  resultTop: { flexDirection: 'row', justifyContent: 'space-between' },
  resultMeta: { fontSize: fontSize.xs, color: colors.textSecondary },
  resultCourt: { fontSize: fontSize.xs, color: colors.textSecondary },
  resultLabel: { fontSize: fontSize.xs, color: colors.primary, marginTop: 2 },
  resultScoreRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  resultOpp: { color: colors.primary, fontSize: fontSize.sm, fontWeight: '500' },
  resultScores: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  resultScore: {
    fontSize: fontSize.sm,
    fontVariant: ['tabular-nums'],
    paddingHorizontal: 4,
    fontWeight: '600',
  },
  resultScoreWin: { color: colors.success },
  resultScoreLoss: { color: colors.loss },
  wlChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    marginLeft: spacing.xs,
  },
  wlChipWin: { backgroundColor: colors.success },
  wlChipLoss: { backgroundColor: colors.loss },
  wlChipNeutral: { backgroundColor: colors.textLight },
  wlChipText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '700' },

  standingsHeader: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.xs,
  },
  standingsHeaderCell: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textOnPrimary },
  standingsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  standingsRowAlt: { backgroundColor: '#fafafa' },
  standingsRowMe: {
    backgroundColor: colors.primaryLight,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  cell: { fontSize: fontSize.sm, color: colors.text },
  rankCol: { width: 24, textAlign: 'center' },
  rankText: { fontWeight: '700' },
  teamCol: { flex: 1, paddingRight: spacing.xs },
  statCol: { width: 28, textAlign: 'center' },
  linkText: { color: colors.primary, fontWeight: '500' },
  meText: { fontWeight: '700', color: colors.primary },

  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  actionTile: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  actionTileText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: fontSize.sm },

  scoutBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
  },
  scoutBtnText: { color: '#fff', fontWeight: '700', fontSize: fontSize.sm },
  scoutInlineBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: colors.primaryLight,
    borderRadius: borderRadius.sm,
  },
  scoutInlineText: { color: colors.primary, fontSize: fontSize.xs, fontWeight: '700' },
  scoutInlineRow: { alignSelf: 'flex-start', marginTop: spacing.xs, paddingVertical: 2 },
  historyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  historyIcon: { fontSize: 20, marginRight: spacing.sm },
  historyLabel: { color: colors.primary, fontWeight: '700', fontSize: fontSize.md },
  historySub: { color: colors.primary, fontSize: fontSize.xs, marginTop: 2, opacity: 0.8 },
  historyChev: { fontSize: 20, color: colors.primary },

  manageSeasonBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  manageSeasonIcon: { fontSize: 18, marginRight: spacing.sm },
  manageSeasonText: { flex: 1, color: colors.text, fontWeight: '600', fontSize: fontSize.md },
  manageSeasonChev: { fontSize: 20, color: colors.textLight },

  resourcesSection: { marginTop: spacing.md },
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
});
