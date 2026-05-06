import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import {
  getCachedTeamAssignments,
  getCachedEvent,
} from '../api/aesClient';
import type { AESTeamAssignment, FavoriteTeam } from '../types/aes';
import { formatTime, formatDate, getRelativeTime } from '../utils/dates';

interface Props {
  myTeam: FavoriteTeam | null;
  favoriteTeams: FavoriteTeam[];
  onNavigateToTeam: (fav: FavoriteTeam) => void;
  onBack: () => void;
}

/** All the teams we care about, deduped */
function getAllTrackedTeams(
  myTeam: FavoriteTeam | null,
  favorites: FavoriteTeam[]
): FavoriteTeam[] {
  const seen = new Set<string>();
  const result: FavoriteTeam[] = [];
  const all = myTeam ? [myTeam, ...favorites] : [...favorites];
  for (const t of all) {
    const key = `${t.eventKey}:${t.teamId}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(t);
    }
  }
  return result;
}

interface TeamMatchInfo {
  team: FavoriteTeam;
  assignment: AESTeamAssignment | null;
  loading: boolean;
  error: boolean;
}

export function MyTeamsScreen({
  myTeam,
  favoriteTeams,
  onNavigateToTeam,
  onBack,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [teamInfos, setTeamInfos] = useState<TeamMatchInfo[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const trackedTeams = getAllTrackedTeams(myTeam, favoriteTeams);

  const loadAllTeams = useCallback(
    async (forceRefresh = false) => {
      // Initialize the list with loading states
      setTeamInfos(
        trackedTeams.map((t) => ({
          team: t,
          assignment: null,
          loading: true,
          error: false,
        }))
      );

      // Fetch all team assignments concurrently
      const results = await Promise.allSettled(
        trackedTeams.map(async (t) => {
          const assignments = await getCachedTeamAssignments(
            t.eventKey,
            t.divisionId,
            null,
            [t.teamId],
            { forceRefresh }
          );
          return assignments.find((a) => a.TeamId === t.teamId) || null;
        })
      );

      setTeamInfos(
        trackedTeams.map((t, i) => {
          const r = results[i];
          return {
            team: t,
            assignment: r.status === 'fulfilled' ? r.value : null,
            loading: false,
            error: r.status === 'rejected',
          };
        })
      );
    },
    [trackedTeams.map((t) => `${t.eventKey}:${t.teamId}`).join(',')]
  );

  useEffect(() => {
    loadAllTeams().finally(() => setInitialLoading(false));
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAllTeams(true);
    setRefreshing(false);
  }, [loadAllTeams]);

  if (initialLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading your teams...</Text>
      </View>
    );
  }

  // Build a unified list of upcoming matches across all teams, sorted by time
  interface UpcomingMatch {
    team: FavoriteTeam;
    assignment: AESTeamAssignment;
    matchTime: Date;
    courtName: string;
    opponentName: string;
    isMyTeam: boolean;
  }

  const upcomingMatches: UpcomingMatch[] = [];
  for (const info of teamInfos) {
    if (!info.assignment?.NextMatch) continue;
    const nm = info.assignment.NextMatch;
    upcomingMatches.push({
      team: info.team,
      assignment: info.assignment,
      matchTime: new Date(nm.ScheduledStartDateTime),
      courtName: nm.Court?.Name || 'TBD',
      opponentName: info.assignment.OpponentTeamText || info.assignment.OpponentTeamName || 'TBD',
      isMyTeam: !!myTeam && info.team.teamId === myTeam.teamId && info.team.eventKey === myTeam.eventKey,
    });
  }
  upcomingMatches.sort((a, b) => a.matchTime.getTime() - b.matchTime.getTime());

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backButton}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
        >
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Team Tracker</Text>
        <Text style={styles.subtitle}>
          {trackedTeams.length} team{trackedTeams.length !== 1 ? 's' : ''} tracked
        </Text>
      </View>

      {/* Upcoming Matches — unified timeline */}
      {upcomingMatches.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Upcoming Matches</Text>
          {upcomingMatches.map((um, i) => {
            const diffMs = um.matchTime.getTime() - Date.now();
            const diffMins = Math.round(diffMs / 60000);
            const isImminent = diffMins >= 0 && diffMins <= 30;
            const isSoon = diffMins > 30 && diffMins <= 120;
            return (
              <TouchableOpacity
                key={`${um.team.eventKey}-${um.team.teamId}-${i}`}
                style={[
                  styles.matchCard,
                  isImminent && styles.matchCardImminent,
                ]}
                onPress={() => onNavigateToTeam(um.team)}
                activeOpacity={0.7}
              >
                <View style={styles.matchTimeCol}>
                  <Text
                    style={[
                      styles.matchCountdown,
                      isImminent && styles.matchCountdownImminent,
                      isSoon && styles.matchCountdownSoon,
                    ]}
                  >
                    {diffMins < 0
                      ? 'Now'
                      : diffMins < 60
                      ? `${diffMins}m`
                      : diffMins < 1440
                      ? `${Math.round(diffMins / 60)}h`
                      : formatDate(um.matchTime.toISOString())}
                  </Text>
                  <Text style={styles.matchTimeText}>
                    {formatTime(um.matchTime.toISOString())}
                  </Text>
                </View>
                <View style={styles.matchInfoCol}>
                  <View style={styles.matchTeamRow}>
                    {um.isMyTeam && (
                      <Text style={styles.myTeamBadge}>{'\u{1F3D0}'} </Text>
                    )}
                    <View
                      style={[
                        styles.matchDivDot,
                        { backgroundColor: um.team.divisionColorHex || colors.primary },
                      ]}
                    />
                    <Text style={styles.matchTeamName} numberOfLines={1}>
                      {um.team.teamText || um.team.teamName}
                    </Text>
                  </View>
                  <Text style={styles.matchOpponent} numberOfLines={1}>
                    vs {um.opponentName}
                  </Text>
                  <Text style={styles.matchMeta}>
                    {um.courtName} — {um.team.divisionName}
                  </Text>
                </View>
                <Text style={styles.matchArrow}>{'›'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* All Teams — grouped by event */}
      {(() => {
        // Group teams by event
        const eventGroups = new Map<string, TeamMatchInfo[]>();
        for (const info of teamInfos) {
          const key = info.team.eventKey;
          if (!eventGroups.has(key)) eventGroups.set(key, []);
          eventGroups.get(key)!.push(info);
        }
        const uniqueEvents = Array.from(eventGroups.entries());
        const multiEvent = uniqueEvents.length > 1;

        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>All Teams</Text>
            {uniqueEvents.map(([eventKey, infos]) => (
              <View key={eventKey}>
                {multiEvent && (
                  <View style={styles.eventGroupHeader}>
                    <Text style={styles.eventGroupName} numberOfLines={1}>
                      {infos[0].team.eventName}
                    </Text>
                    <Text style={styles.eventGroupCount}>
                      {infos.length} team{infos.length !== 1 ? 's' : ''}
                    </Text>
                  </View>
                )}
                {infos.map((info) => {
                  const isMyTeamFlag =
                    !!myTeam &&
                    info.team.teamId === myTeam.teamId &&
                    info.team.eventKey === myTeam.eventKey;
                  // Quick record from assignment (cast to any — the API may return these fields even if not in our type)
                  const a = info.assignment as Record<string, unknown> | null;
                  const hasRecord = a && (typeof a.MatchWins === 'number' || typeof a.MatchLosses === 'number');
                  const record = hasRecord
                    ? `${(a.MatchWins as number) ?? 0}W-${(a.MatchLosses as number) ?? 0}L`
                    : null;
                  return (
                    <TouchableOpacity
                      key={`${info.team.eventKey}-${info.team.teamId}`}
                      style={styles.teamCard}
                      onPress={() => onNavigateToTeam(info.team)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.teamCardLeft}>
                        <View
                          style={[
                            styles.teamDivDot,
                            {
                              backgroundColor:
                                info.team.divisionColorHex || colors.primary,
                            },
                          ]}
                        />
                        <View style={styles.teamCardInfo}>
                          <View style={styles.teamNameRow}>
                            {isMyTeamFlag && (
                              <Text style={styles.myTeamTag}>{'\u{1F3D0}'} </Text>
                            )}
                            <Text style={styles.teamName} numberOfLines={1}>
                              {info.team.teamText || info.team.teamName}
                            </Text>
                            {record && !info.loading && (
                              <View style={styles.recordBadge}>
                                <Text style={styles.recordText}>{record}</Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.teamMeta} numberOfLines={1}>
                            {info.team.divisionName} — {info.team.clubName}
                          </Text>
                          {!multiEvent && (
                            <Text style={styles.teamEventName} numberOfLines={1}>
                              {info.team.eventName}
                            </Text>
                          )}
                          {info.loading ? (
                            <ActivityIndicator
                              size="small"
                              color={colors.textSecondary}
                              style={{ marginTop: 4 }}
                            />
                          ) : info.error ? (
                            <Text style={styles.teamError}>
                              Could not load — tap to view cached data
                            </Text>
                          ) : info.assignment?.NextMatch ? (
                            <Text style={styles.teamNextMatch}>
                              Next: {formatTime(info.assignment.NextMatch.ScheduledStartDateTime)}{' '}
                              on {info.assignment.NextMatch.Court?.Name || 'TBD'} vs{' '}
                              {info.assignment.OpponentTeamText || 'TBD'}
                            </Text>
                          ) : (
                            <Text style={styles.teamNoMatch}>
                              No upcoming matches
                            </Text>
                          )}
                        </View>
                      </View>
                      <Text style={styles.teamArrow}>{'›'}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        );
      })()}

      <View style={{ height: 60 }} />
    </ScrollView>
  );
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
  backButton: { marginBottom: spacing.sm },
  backText: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  section: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  // ─── Upcoming match cards ────────────────────────────────
  matchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  matchCardImminent: {
    borderColor: '#4CAF50',
    borderWidth: 2,
    backgroundColor: 'rgba(76, 175, 80, 0.08)',
  },
  matchTimeCol: {
    width: 60,
    alignItems: 'center',
    marginRight: spacing.md,
  },
  matchCountdown: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    color: colors.text,
  },
  matchCountdownImminent: {
    color: '#4CAF50',
  },
  matchCountdownSoon: {
    color: '#FF9800',
  },
  matchTimeText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  matchInfoCol: {
    flex: 1,
  },
  matchTeamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  myTeamBadge: {
    fontSize: fontSize.sm,
  },
  matchDivDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  matchTeamName: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  matchOpponent: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  matchMeta: {
    fontSize: fontSize.xs,
    color: colors.textLight,
  },
  matchArrow: {
    fontSize: 20,
    color: colors.textLight,
    marginLeft: spacing.sm,
  },
  // ─── Team cards ────────────────────────────────────────
  teamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  teamCardLeft: {
    flexDirection: 'row',
    flex: 1,
    alignItems: 'flex-start',
  },
  teamDivDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: spacing.sm,
    marginTop: 5,
  },
  teamCardInfo: {
    flex: 1,
  },
  teamNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  myTeamTag: {
    fontSize: fontSize.sm,
  },
  teamName: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  teamMeta: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  teamNextMatch: {
    fontSize: fontSize.sm,
    color: '#4CAF50',
    marginTop: 4,
  },
  teamNoMatch: {
    fontSize: fontSize.sm,
    color: colors.textLight,
    marginTop: 4,
    fontStyle: 'italic',
  },
  teamError: {
    fontSize: fontSize.xs,
    color: '#FF9800',
    marginTop: 4,
  },
  teamArrow: {
    fontSize: 20,
    color: colors.textLight,
    marginLeft: spacing.sm,
  },
  // Event grouping
  eventGroupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  eventGroupName: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.primary,
    flex: 1,
  },
  eventGroupCount: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
  },
  teamEventName: {
    fontSize: fontSize.xs,
    color: colors.textLight,
    marginTop: 1,
  },
  recordBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: borderRadius.sm,
    marginLeft: spacing.sm,
  },
  recordText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.primary,
  },
});
}
