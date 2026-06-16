// ── AthleteDetailScreen ────────────────────────────────────────────────────
//
// Per-athlete view. Reached by tapping an athlete card in the Athletes
// management screen (and eventually from a Home athlete chip). Surfaces
// what the user explicitly asked for in the strategic pivot:
//
//   "easily see their athletes, the teams, history for indoor, the
//    individual athlete and teams for beach etc"
//
// Layout:
//
//   [← Back]
//   Sarah                          [Edit]
//   Child · 3 teams (1 indoor, 2 beach)
//
//   [Indoor]  [Beach]              ← sport tabs
//   ──────────────────────────────
//   PVC 3D Royals U18              Indoor · PVC
//   PVC Mustangs 18U               Indoor · PVC
//   + Add team
//
//   INDOOR TOTALS
//   Tournaments  4    Record  12-6
//   Sets  28-19       Best finish  3rd
//
//   RECENT
//   Spring Showdown                3rd
//   Mar 23, 2026 · 18U Girls G · 4-2
//   …
//
// Tabs are stateful in-screen, default = whichever sport has teams
// (indoor wins on tie). Switching tabs filters BOTH the team list and
// the stats / recent-history strip — one mental model, no extra
// controls. The history pipeline is shared with MyHome's CareerCard
// (buildMySeasonHistory + aggregateUnifiedStats) so the numbers always
// agree.
//
// Deferred to a later pass: "where I fit in" relative-position
// analytics (#18), inline rename, drill straight to a specific history
// entry (currently routes to the team's full SeasonHistory).
// ──────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type {
  AthleteProfile,
  TeamProfile,
  UserProfile,
} from '../types/profile';
import {
  aggregateUnifiedStats,
  buildMySeasonHistory,
  loadAllSeasonIndices,
  type UnifiedAggregateStats,
  type UnifiedTournamentEntry,
} from '../utils/unifiedSeasonHistory';
import {
  computeRelativePosition,
  formatFinishPercentile,
} from '../utils/relativePosition';
import {
  aggregateByPartner,
  describePartnerRollup,
  type PartnerRollup,
} from '../utils/beachPartners';

export type AthleteDetailSport = 'indoor' | 'beach';

interface Props {
  userProfile: UserProfile;
  athleteId: string;
  /** Initial sport tab. Defaults to first sport the athlete has teams in. */
  initialSport?: AthleteDetailSport;
  onBack: () => void;
  /** Tap a team → drill into its dashboard. */
  onOpenTeam: (team: TeamProfile) => void;
  /** Tap "+ Add team" → enter the add-team flow for this athlete. */
  onAddTeam: (athleteId: string) => void;
  /** Tap "Edit" → return to AthletesScreen with rename modal open. */
  onEditAthlete?: (athleteId: string) => void;
  /** Tap a recent-history row → drill into the tournament. Passed the
   *  team profile so the parent can use the canonical history-routing
   *  flow (same one MyHome uses for upcoming-card taps). */
  onOpenHistoryEntry?: (
    team: TeamProfile,
    entry: UnifiedTournamentEntry
  ) => void;
  /** Tap "+ Add tournament manually" → open the manual-tournament
   *  form pre-targeting this team. Sport defaults to the team's sport
   *  but the form lets the user override. Optional; row hides when
   *  unwired. */
  onAddManualTournament?: (team: TeamProfile) => void;
}

export function AthleteDetailScreen({
  userProfile,
  athleteId,
  initialSport,
  onBack,
  onOpenTeam,
  onAddTeam,
  onEditAthlete,
  onOpenHistoryEntry,
  onAddManualTournament,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const athlete = userProfile.athletes.find((a) => a.id === athleteId);
  const teamsForAthlete = useMemo(
    () =>
      userProfile.teams.filter(
        (t) => t.kind === 'me' && t.athleteId === athleteId
      ),
    [userProfile.teams, athleteId]
  );
  const indoorTeams = useMemo(
    () => teamsForAthlete.filter((t) => t.sport === 'indoor'),
    [teamsForAthlete]
  );
  const beachTeams = useMemo(
    () => teamsForAthlete.filter((t) => t.sport === 'beach'),
    [teamsForAthlete]
  );

  // Choose default sport: respect initialSport, else first non-empty sport
  // (indoor wins on tie), else indoor as the most common starting case.
  const defaultSport: AthleteDetailSport = useMemo(() => {
    if (initialSport) return initialSport;
    if (indoorTeams.length === 0 && beachTeams.length > 0) return 'beach';
    return 'indoor';
  }, [initialSport, indoorTeams.length, beachTeams.length]);

  const [sport, setSport] = useState<AthleteDetailSport>(defaultSport);
  const visibleTeams = sport === 'indoor' ? indoorTeams : beachTeams;

  // ── Per-sport stats + history ───────────────────────────────────────────
  //
  // Mirrors CareerCard's approach in MyHome: load all season indices once,
  // build the unified history off this athlete's team aliases, then split
  // by sport. Switching tabs is in-memory — no refetch.
  //
  // Aliases come from each TeamProfile.aliases when populated, else fall
  // back to the team's label. Athlete-scope is enforced upstream
  // (teamsForAthlete already filters by athleteId).
  const aliases = useMemo(() => {
    const set = new Set<string>();
    for (const t of teamsForAthlete) {
      const src = t.aliases.length > 0 ? t.aliases : [t.label];
      for (const a of src) set.add(a);
    }
    return Array.from(set);
  }, [teamsForAthlete]);

  const [history, setHistory] = useState<UnifiedTournamentEntry[] | null>(
    null
  );
  const [historyLoading, setHistoryLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    if (aliases.length === 0) {
      setHistory([]);
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    (async () => {
      try {
        const indices = await loadAllSeasonIndices();
        if (cancelled) return;
        const built = buildMySeasonHistory(indices, aliases);
        if (cancelled) return;
        setHistory(built);
      } catch {
        if (!cancelled) setHistory([]);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [aliases]);

  const sportHistory = useMemo(() => {
    if (!history) return [];
    return history.filter((h) => h.sport === sport);
  }, [history, sport]);

  const sportStats = useMemo<UnifiedAggregateStats | null>(() => {
    if (!history) return null;
    return aggregateUnifiedStats(sportHistory);
  }, [history, sportHistory]);

  // "Where you fit in" — derived from the same per-sport slice as the
  // totals card so the two read consistently. Pure / cheap, no async.
  const relativePosition = useMemo(
    () => computeRelativePosition(sportHistory),
    [sportHistory]
  );

  // Per-partner rollup — beach only. Indoor teams don't have rotating
  // partnerships at this granularity, so the card hides on the indoor
  // tab.
  const partnerRollups = useMemo<PartnerRollup[]>(
    () => (sport === 'beach' ? aggregateByPartner(sportHistory) : []),
    [sport, sportHistory]
  );

  // Top history entries surfaced inline on this screen. Five matches the
  // density of the team dashboard's recent-history strip without
  // overwhelming the small-screen viewport.
  const recentHistory = sportHistory.slice(0, 5);

  // Athletes can be removed from AthletesScreen while this screen is open
  // (race). Guard explicitly with a friendly bounce-back rather than
  // crashing on a null read.
  if (!athlete) {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backLabel}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.missingCard}>
          <Text style={styles.missingTitle}>Athlete not found</Text>
          <Text style={styles.missingBody}>
            This athlete may have been removed. Head back and pick another.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn}>
        <Text style={styles.backLabel}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{athlete.displayName}</Text>
          <Text style={styles.subtitle}>
            {athleteSummary(athlete, indoorTeams.length, beachTeams.length)}
          </Text>
        </View>
        {onEditAthlete ? (
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => onEditAthlete(athlete.id)}
            activeOpacity={0.7}
          >
            <Text style={styles.editBtnLabel}>Edit</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.tabRow}>
        <SportTab
          label={`Indoor${indoorTeams.length ? ` (${indoorTeams.length})` : ''}`}
          active={sport === 'indoor'}
          onPress={() => setSport('indoor')}
          colors={colors}
        />
        <SportTab
          label={`Beach${beachTeams.length ? ` (${beachTeams.length})` : ''}`}
          active={sport === 'beach'}
          onPress={() => setSport('beach')}
          colors={colors}
        />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {visibleTeams.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              No {sport} teams yet
            </Text>
            <Text style={styles.emptyBody}>
              Add a {sport} team to start tracking {athlete.displayName}'s{' '}
              {sport === 'indoor' ? 'league play' : 'tour stops'}.
            </Text>
          </View>
        ) : (
          visibleTeams.map((team) => (
            <TouchableOpacity
              key={team.id}
              style={styles.teamRow}
              activeOpacity={0.7}
              onPress={() => onOpenTeam(team)}
            >
              <View style={styles.teamRowMain}>
                <Text style={styles.teamName}>{team.label}</Text>
                <Text style={styles.teamMeta}>
                  {teamMetaLabel(team, userProfile)}
                </Text>
              </View>
              <Text style={styles.teamChevron}>›</Text>
            </TouchableOpacity>
          ))
        )}

        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => onAddTeam(athlete.id)}
          activeOpacity={0.7}
        >
          <Text style={styles.addBtnLabel}>+ Add team</Text>
        </TouchableOpacity>

        {/* Add a manual tournament — primary path for beach pairs
            today (AES / Timu don't index beach). Targets the first
            team in the current sport tab so the entry binds to the
            right TeamProfile; the form lets the user reassign before
            saving. Hidden when this athlete has no team to bind to. */}
        {onAddManualTournament && visibleTeams[0] ? (
          <TouchableOpacity
            style={styles.addManualBtn}
            onPress={() => onAddManualTournament(visibleTeams[0]!)}
            activeOpacity={0.7}
          >
            <Text style={styles.addManualBtnLabel}>
              + Add a {sport} tournament manually
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* Per-sport totals. Mirrors MyHome's CareerCard but scoped to
            this athlete's indoor or beach play only. */}
        <View style={styles.statsCard}>
          <Text style={styles.cardKicker}>
            {sport === 'indoor' ? 'Indoor totals' : 'Beach totals'}
          </Text>
          {historyLoading ? (
            <Text style={styles.cardMuted}>Loading…</Text>
          ) : sportStats && sportStats.tournamentsPlayed > 0 ? (
            <View style={styles.statsGrid}>
              <StatCell
                label="Tournaments"
                value={String(sportStats.tournamentsPlayed)}
                colors={colors}
              />
              <StatCell
                label="Record"
                value={`${sportStats.totalMatchesWon}-${sportStats.totalMatchesLost}`}
                accent
                colors={colors}
              />
              <StatCell
                label="Sets"
                value={`${sportStats.totalSetsWon}-${sportStats.totalSetsLost}`}
                colors={colors}
              />
              <StatCell
                label="Best finish"
                value={
                  sportStats.bestFinish
                    ? sportStats.bestFinish.label
                    : '—'
                }
                accent={!!sportStats.bestFinish}
                colors={colors}
              />
            </View>
          ) : (
            <Text style={styles.cardMuted}>
              No {sport} tournaments indexed yet.
            </Text>
          )}
        </View>

        {/* "Where you fit in" — relative standing across this sport's
            tournaments. Hidden when we don't have enough rank+field
            data to make a meaningful claim (less than 1 finish-with-
            field-size entry). Renders independently of the totals card
            so a casual scan reads numbers → context → recent. */}
        {relativePosition.entriesWithFinish > 0 ? (
          <View style={styles.statsCard}>
            <Text style={styles.cardKicker}>Where you fit in</Text>
            <Text style={styles.fitInLine}>
              Avg finish:{' '}
              <Text style={styles.fitInValue}>
                {formatFinishPercentile(
                  relativePosition.averageFinishPercentile ?? 0
                )}
              </Text>
              {'  ·  '}
              {relativePosition.entriesWithFinish === 1
                ? '1 tournament'
                : `${relativePosition.entriesWithFinish} tournaments`}
            </Text>
            {relativePosition.bestFinishPercentile != null &&
            relativePosition.bestFinishPercentile <
              (relativePosition.averageFinishPercentile ?? 1) ? (
              <Text style={styles.fitInLine}>
                Best:{' '}
                <Text style={styles.fitInValue}>
                  {formatFinishPercentile(
                    relativePosition.bestFinishPercentile
                  )}
                </Text>
              </Text>
            ) : null}
            {relativePosition.matchWinRate != null ? (
              <Text style={styles.fitInLine}>
                Match win rate:{' '}
                <Text style={styles.fitInValue}>
                  {Math.round(relativePosition.matchWinRate * 100)}%
                </Text>
                {'  ·  '}
                Sets won:{' '}
                <Text style={styles.fitInValue}>
                  {Math.round((relativePosition.setWinRate ?? 0) * 100)}%
                </Text>
              </Text>
            ) : null}
            {/* Tiny distribution stripe — at-a-glance "what kind of
                tournaments has this been." Bars are coloured to match
                the bucket tier (top10 = primary, falling muted). */}
            <FinishDistribution
              buckets={relativePosition.finishBuckets}
              colors={colors}
            />
          </View>
        ) : null}

        {/* Per-partner rollup — beach tab only. Beach pairs rotate per
            tournament; this card shows how the athlete has done with
            each partner. Most-recent partner at the top. Hidden when
            no entries have a partner recorded. */}
        {partnerRollups.length > 0 ? (
          <View style={styles.historyCard}>
            <Text style={styles.cardKicker}>By partner</Text>
            {partnerRollups.map((rollup) => {
              const display = describePartnerRollup(rollup);
              return (
                <View
                  key={rollup.partnerName.toLowerCase()}
                  style={styles.partnerRow}
                >
                  <Text style={styles.partnerName} numberOfLines={1}>
                    {rollup.partnerName}
                  </Text>
                  <View style={styles.partnerMetaRow}>
                    <Text style={styles.partnerMeta}>
                      {display.tournamentCount}
                      {display.matchRecord
                        ? ` · ${display.matchRecord}`
                        : ''}
                    </Text>
                    {display.bestFinishLine ? (
                      <Text style={styles.partnerBest}>
                        {display.bestFinishLine}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Recent history strip — top 5 entries for this sport, newest
            first. Tap a row to drill into the tournament via the
            canonical history-routing handler the parent owns. */}
        {recentHistory.length > 0 ? (
          <View style={styles.historyCard}>
            <Text style={styles.cardKicker}>Recent</Text>
            {recentHistory.map((entry) => {
              // Try to find the team that owns this entry — needed by the
              // parent's history-routing flow. We match by alias against
              // the athlete's teams. Falls back to the first team if no
              // match (rare; mostly affects entries with quirky labels).
              const owningTeam =
                teamsForAthlete.find((t) =>
                  matchesEntryToTeam(t, entry)
                ) ?? teamsForAthlete[0] ?? null;
              const tappable = !!owningTeam && !!onOpenHistoryEntry;
              const row = (
                <View style={styles.historyRow}>
                  <View style={styles.historyMain}>
                    <Text style={styles.historyName} numberOfLines={1}>
                      {entry.tournamentName}
                    </Text>
                    <Text style={styles.historyMeta} numberOfLines={1}>
                      {historyMetaLabel(entry)}
                    </Text>
                  </View>
                  {entry.finalRankLabel ? (
                    <Text style={styles.historyRank}>
                      {entry.finalRankLabel}
                    </Text>
                  ) : null}
                </View>
              );
              if (tappable && owningTeam) {
                return (
                  <TouchableOpacity
                    key={`${entry.source}-${entry.sourceKey}`}
                    activeOpacity={0.7}
                    onPress={() =>
                      onOpenHistoryEntry!(owningTeam, entry)
                    }
                  >
                    {row}
                  </TouchableOpacity>
                );
              }
              return (
                <View key={`${entry.source}-${entry.sourceKey}`}>{row}</View>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/**
 * Heuristic: does this team profile own this history entry? Match on the
 * team's aliases (or label) appearing in the entry's `myTeamAsSeen` or
 * tournament name. Loose on purpose — the alternative is threading the
 * owning-team back through buildMySeasonHistory, which is a bigger
 * refactor than this screen warrants.
 */
function matchesEntryToTeam(
  team: TeamProfile,
  entry: UnifiedTournamentEntry
): boolean {
  const candidates = team.aliases.length > 0 ? team.aliases : [team.label];
  const haystacks = [
    entry.myTeamAsSeen ?? '',
    entry.tournamentName ?? '',
  ]
    .filter(Boolean)
    .map((s) => s.toLowerCase());
  if (haystacks.length === 0) return false;
  return candidates.some((c) =>
    haystacks.some((h) => h.includes(c.toLowerCase()))
  );
}

function historyMetaLabel(entry: UnifiedTournamentEntry): string {
  const parts: string[] = [];
  if (entry.dateText) parts.push(entry.dateText);
  if (entry.subtitle) parts.push(entry.subtitle);
  // Beach partner — surfaced inline on the row so the scan reads
  // "Tournament · Date · w/ Partner · Record." Only present for beach
  // entries that carry the partner; indoor rows skip this.
  if (entry.beachPartner?.name) {
    parts.push(`w/ ${entry.beachPartner.name}`);
  }
  // Match record where we have one — cheap signal that lands well in a
  // scan.
  if (entry.matchesFor + entry.matchesAgainst > 0) {
    parts.push(`${entry.matchesFor}-${entry.matchesAgainst}`);
  }
  return parts.join(' · ');
}

/**
 * Tiny histogram for the relative-position card. Renders one bar per
 * bucket, widths proportional to count, colors reflecting tier (top10
 * brightest, bottomHalf muted). Reads at a glance — "lots of bright
 * blue = mostly good finishes."
 */
function FinishDistribution({
  buckets,
  colors,
}: {
  buckets: {
    top10: number;
    top25: number;
    topHalf: number;
    bottomHalf: number;
  };
  colors: ThemeColors;
}) {
  const total =
    buckets.top10 + buckets.top25 + buckets.topHalf + buckets.bottomHalf;
  if (total === 0) return null;
  const rows: Array<{ label: string; count: number; color: string }> = [
    { label: 'Top 10%', count: buckets.top10, color: colors.primary },
    { label: 'Top 25%', count: buckets.top25, color: colors.primary + 'cc' },
    {
      label: 'Top half',
      count: buckets.topHalf,
      color: colors.textSecondary,
    },
    {
      label: 'Bottom half',
      count: buckets.bottomHalf,
      color: colors.textLight,
    },
  ];
  return (
    <View style={finishDistributionStyles.wrap}>
      {rows.map((r) => {
        if (r.count === 0) return null;
        const pct = (r.count / total) * 100;
        return (
          <View key={r.label} style={finishDistributionStyles.row}>
            <Text
              style={[
                finishDistributionStyles.label,
                { color: colors.textSecondary },
              ]}
            >
              {r.label}
            </Text>
            <View style={finishDistributionStyles.barTrack}>
              <View
                style={[
                  finishDistributionStyles.barFill,
                  { width: `${pct}%`, backgroundColor: r.color },
                ]}
              />
            </View>
            <Text
              style={[finishDistributionStyles.count, { color: colors.text }]}
            >
              {r.count}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const finishDistributionStyles = StyleSheet.create({
  wrap: {
    marginTop: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  label: {
    width: 90,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  barTrack: {
    flex: 1,
    height: 6,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 3,
    overflow: 'hidden',
    marginHorizontal: spacing.xs,
  },
  barFill: {
    height: '100%',
  },
  count: {
    width: 24,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textAlign: 'right',
  },
});

function StatCell({
  label,
  value,
  accent,
  colors,
}: {
  label: string;
  value: string;
  accent?: boolean;
  colors: ThemeColors;
}) {
  return (
    <View style={statCellStyles.cell}>
      <Text style={[statCellStyles.label, { color: colors.textLight }]}>
        {label}
      </Text>
      <Text
        style={[
          statCellStyles.value,
          { color: accent ? colors.primary : colors.text },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const statCellStyles = StyleSheet.create({
  cell: {
    width: '50%',
    paddingVertical: spacing.xs,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  value: {
    fontSize: fontSize.lg,
    fontWeight: '800',
  },
});

function SportTab({
  label,
  active,
  onPress,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: ThemeColors;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        sportTabStyles.tab,
        {
          backgroundColor: active ? colors.primary : 'transparent',
          borderColor: active ? colors.primary : colors.divider,
        },
      ]}
    >
      <Text
        style={[
          sportTabStyles.tabLabel,
          { color: active ? '#ffffff' : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function athleteSummary(
  athlete: AthleteProfile,
  indoorCount: number,
  beachCount: number
): string {
  const rel =
    athlete.relation === 'self'
      ? 'Me'
      : athlete.relation === 'child'
        ? 'Child'
        : 'Other';
  const total = indoorCount + beachCount;
  if (total === 0) return `${rel} · No teams yet`;
  const breakdown: string[] = [];
  if (indoorCount > 0) breakdown.push(`${indoorCount} indoor`);
  if (beachCount > 0) breakdown.push(`${beachCount} beach`);
  const totalLabel = total === 1 ? '1 team' : `${total} teams`;
  return `${rel} · ${totalLabel} (${breakdown.join(' · ')})`;
}

function teamMetaLabel(team: TeamProfile, profile: UserProfile): string {
  const parts: string[] = [team.sport === 'beach' ? 'Beach' : 'Indoor'];
  if (team.clubId) {
    const club = profile.clubs.find((c) => c.id === team.clubId);
    if (club) parts.push(club.name);
  }
  return parts.join(' · ');
}

const sportTabStyles = StyleSheet.create({
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
  },
  tabLabel: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
});

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    backBtn: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xs,
    },
    backLabel: {
      fontSize: fontSize.sm,
      color: colors.primary,
      fontWeight: '600',
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: spacing.md,
      marginBottom: spacing.md,
    },
    headerText: {
      flex: 1,
    },
    title: {
      fontSize: fontSize.xl,
      fontWeight: '800',
      color: colors.text,
      marginBottom: spacing.xs,
    },
    subtitle: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    editBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: borderRadius.sm,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    editBtnLabel: {
      color: colors.primary,
      fontSize: fontSize.sm,
      fontWeight: '700',
    },
    tabRow: {
      flexDirection: 'row',
      paddingHorizontal: spacing.md,
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    scroll: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xl,
      gap: spacing.sm,
    },
    emptyCard: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      padding: spacing.lg,
      alignItems: 'center',
    },
    emptyTitle: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.text,
      marginBottom: spacing.xs,
    },
    emptyBody: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
    },
    teamRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    teamRowMain: {
      flex: 1,
    },
    teamName: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    teamMeta: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      marginTop: 2,
    },
    teamChevron: {
      fontSize: fontSize.lg,
      color: colors.textLight,
      paddingLeft: spacing.sm,
    },
    addBtn: {
      marginTop: spacing.md,
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    addBtnLabel: {
      color: '#ffffff',
      fontSize: fontSize.md,
      fontWeight: '700',
    },
    addManualBtn: {
      marginTop: spacing.xs,
      paddingVertical: spacing.sm,
      alignItems: 'center',
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: 'transparent',
    },
    addManualBtnLabel: {
      color: colors.primary,
      fontSize: fontSize.sm,
      fontWeight: '700',
    },
    statsCard: {
      marginTop: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    cardKicker: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.textLight,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: spacing.xs,
    },
    cardMuted: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
    },
    fitInLine: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      marginBottom: 2,
      lineHeight: 20,
    },
    fitInValue: {
      color: colors.text,
      fontWeight: '700',
    },
    historyCard: {
      marginTop: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    historyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
    },
    historyMain: {
      flex: 1,
      paddingRight: spacing.sm,
    },
    historyName: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    historyMeta: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      marginTop: 2,
    },
    historyRank: {
      fontSize: fontSize.sm,
      fontWeight: '700',
      color: colors.primary,
    },
    partnerRow: {
      paddingVertical: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
    },
    partnerName: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    partnerMetaRow: {
      marginTop: 2,
    },
    partnerMeta: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
    },
    partnerBest: {
      fontSize: fontSize.xs,
      color: colors.primary,
      fontWeight: '600',
      marginTop: 2,
    },
    missingCard: {
      margin: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      padding: spacing.lg,
    },
    missingTitle: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.text,
      marginBottom: spacing.xs,
    },
    missingBody: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      lineHeight: 20,
    },
  });
}
