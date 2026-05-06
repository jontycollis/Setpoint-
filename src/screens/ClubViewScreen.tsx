import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import { getTeamAssignments } from '../api/aesClient';
import type { AESEvent, AESDivision, AESTeamAssignment } from '../types/aes';
// Club View — groups all teams in the event by their club

interface Props {
  event: AESEvent;
  clubName?: string; // Pre-select the user's club
  onBack: () => void;
  onTeamPress?: (divisionId: number, teamText: string) => void;
}

interface ClubEntry {
  clubId: number;
  clubName: string;
  teams: {
    team: AESTeamAssignment;
    division: AESDivision;
  }[];
}

export function ClubViewScreen({ event, clubName, onBack, onTeamPress }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [clubs, setClubs] = useState<ClubEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedClubs, setExpandedClubs] = useState<Set<number>>(new Set());

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Fetch teams from all divisions concurrently
      const divisionPromises = event.Divisions.map(async (div) => {
        try {
          const teams = await getTeamAssignments(event.Key, div.DivisionId);
          return { division: div, teams };
        } catch {
          return { division: div, teams: [] as AESTeamAssignment[] };
        }
      });

      const divisionResults = await Promise.all(divisionPromises);

      // Group by club
      const clubMap = new Map<number, ClubEntry>();

      for (const { division, teams } of divisionResults) {
        for (const team of teams) {
          const cId = team.TeamClub?.ClubId ?? 0;
          const cName = team.TeamClub?.Name || 'Unknown Club';

          if (!clubMap.has(cId)) {
            clubMap.set(cId, { clubId: cId, clubName: cName, teams: [] });
          }
          clubMap.get(cId)!.teams.push({ team, division });
        }
      }

      // Sort clubs alphabetically, but put user's club first
      const sorted = Array.from(clubMap.values()).sort((a, b) => {
        if (clubName) {
          const aMatch = a.clubName.toLowerCase() === clubName.toLowerCase();
          const bMatch = b.clubName.toLowerCase() === clubName.toLowerCase();
          if (aMatch && !bMatch) return -1;
          if (!aMatch && bMatch) return 1;
        }
        return a.clubName.localeCompare(b.clubName);
      });

      // Sort teams within each club by division name then team code
      for (const club of sorted) {
        club.teams.sort((a, b) => {
          const divCmp = a.division.Name.localeCompare(b.division.Name);
          if (divCmp !== 0) return divCmp;
          return (a.team.TeamCode || '').localeCompare(b.team.TeamCode || '');
        });
      }

      setClubs(sorted);

      // Auto-expand user's club
      if (clubName) {
        const myClub = sorted.find(
          (c) => c.clubName.toLowerCase() === clubName.toLowerCase()
        );
        if (myClub) {
          setExpandedClubs(new Set([myClub.clubId]));
        }
      }
    } catch (err) {
      console.warn('Club view load failed:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [event.Key, event.Divisions, clubName]);

  useEffect(() => {
    loadData();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  }, [loadData]);

  const toggleClub = (clubId: number) => {
    setExpandedClubs((prev) => {
      const next = new Set(prev);
      if (next.has(clubId)) {
        next.delete(clubId);
      } else {
        next.add(clubId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading clubs...</Text>
      </View>
    );
  }

  // Filter clubs by search
  const q = search.toLowerCase().trim();
  const filteredClubs = q
    ? clubs.filter(
        (c) =>
          c.clubName.toLowerCase().includes(q) ||
          c.teams.some(
            (t) =>
              t.team.TeamText.toLowerCase().includes(q) ||
              t.team.TeamName.toLowerCase().includes(q) ||
              t.division.Name.toLowerCase().includes(q)
          )
      )
    : clubs;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
        >
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Club View</Text>
        <Text style={styles.subtitle}>
          {clubs.length} clubs across {event.Divisions.length} divisions
        </Text>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search clubs or teams..."
          placeholderTextColor={colors.textLight}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {search.length > 0 && (
          <TouchableOpacity
            style={styles.searchClear}
            onPress={() => setSearch('')}
          >
            <Text style={styles.searchClearText}>X</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Club list */}
      {filteredClubs.map((club) => {
        const isExpanded = expandedClubs.has(club.clubId) || q.length > 0;
        const isMyClub =
          clubName &&
          club.clubName.toLowerCase() === clubName.toLowerCase();

        // Group teams by division for display
        const divGroups = new Map<number, { division: AESDivision; teams: AESTeamAssignment[] }>();
        for (const { team, division } of club.teams) {
          if (!divGroups.has(division.DivisionId)) {
            divGroups.set(division.DivisionId, { division, teams: [] });
          }
          divGroups.get(division.DivisionId)!.teams.push(team);
        }

        return (
          <View key={club.clubId} style={styles.clubSection}>
            <TouchableOpacity
              style={[
                styles.clubHeader,
                isMyClub && styles.clubHeaderMine,
              ]}
              onPress={() => toggleClub(club.clubId)}
              activeOpacity={0.7}
            >
              <View style={styles.clubHeaderLeft}>
                <Text style={styles.clubName}>{club.clubName}</Text>
                <Text style={styles.clubMeta}>
                  {club.teams.length} team{club.teams.length !== 1 ? 's' : ''} in{' '}
                  {divGroups.size} division{divGroups.size !== 1 ? 's' : ''}
                </Text>
              </View>
              {isMyClub && (
                <View style={styles.myClubBadge}>
                  <Text style={styles.myClubBadgeText}>My Club</Text>
                </View>
              )}
              <Text style={styles.expandIcon}>{isExpanded ? '\u25B2' : '\u25BC'}</Text>
            </TouchableOpacity>

            {isExpanded && (
              <View style={styles.clubBody}>
                {Array.from(divGroups.values()).map(({ division, teams }) => (
                  <View key={division.DivisionId} style={styles.divGroup}>
                    <View style={styles.divGroupHeader}>
                      <View
                        style={[
                          styles.divDot,
                          { backgroundColor: `#${division.ColorHex}` || colors.primary },
                        ]}
                      />
                      <Text style={styles.divGroupName}>{division.Name}</Text>
                    </View>
                    {teams.map((team) => {
                      const hasNext = !!team.NextMatch;
                      return (
                        <TouchableOpacity
                          key={team.TeamId}
                          style={styles.teamRow}
                          disabled={!onTeamPress}
                          onPress={() =>
                            onTeamPress?.(division.DivisionId, team.TeamText)
                          }
                          activeOpacity={0.7}
                        >
                          <View style={styles.teamInfo}>
                            <Text style={styles.teamText} numberOfLines={1}>
                              {team.TeamText}
                            </Text>
                            {team.OpponentTeamText ? (
                              <Text style={styles.teamNext} numberOfLines={1}>
                                Next: vs {team.OpponentTeamText}
                              </Text>
                            ) : (
                              <Text style={styles.teamNoNext}>No upcoming match</Text>
                            )}
                          </View>
                          {onTeamPress && (
                            <Text style={styles.teamArrow}>{'\u203A'}</Text>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}

      {filteredClubs.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            {q ? `No clubs matching "${search}"` : 'No clubs found'}
          </Text>
        </View>
      )}

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
  backText: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: '600',
    marginBottom: spacing.sm,
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
  // Search
  searchContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: fontSize.md,
    color: colors.text,
  },
  searchClear: {
    marginLeft: spacing.sm,
    padding: spacing.xs,
  },
  searchClearText: {
    fontSize: fontSize.md,
    color: colors.textLight,
    fontWeight: '700',
  },
  // Club sections
  clubSection: {
    marginTop: spacing.sm,
  },
  clubHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  clubHeaderMine: {
    backgroundColor: 'rgba(26, 115, 232, 0.06)',
  },
  clubHeaderLeft: {
    flex: 1,
  },
  clubName: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  clubMeta: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  myClubBadge: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginRight: spacing.sm,
  },
  myClubBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: '#ffffff',
  },
  expandIcon: {
    fontSize: 12,
    color: colors.textLight,
    marginLeft: spacing.sm,
  },
  clubBody: {
    backgroundColor: colors.surface,
    paddingBottom: spacing.sm,
  },
  // Division groups
  divGroup: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  divGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  divDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: spacing.sm,
  },
  divGroupName: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  // Team rows
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingLeft: spacing.xl + spacing.sm,
    paddingRight: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  teamInfo: {
    flex: 1,
  },
  teamText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  teamNext: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 1,
  },
  teamNoNext: {
    fontSize: fontSize.xs,
    color: colors.textLight,
    fontStyle: 'italic',
    marginTop: 1,
  },
  teamArrow: {
    fontSize: 22,
    color: colors.textLight,
    marginLeft: spacing.sm,
  },
  // Empty state
  emptyState: {
    padding: spacing.xxxl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
}
