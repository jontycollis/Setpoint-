import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import { getTeamAssignments } from '../api/aesClient';
import type {
  AESEvent,
  AESDivision,
  AESTeamAssignment,
} from '../types/aes';

interface Props {
  event: AESEvent;
  onTeamSelected: (division: AESDivision, team: AESTeamAssignment) => void;
  onBack: () => void;
}

interface IndexEntry {
  division: AESDivision;
  team: AESTeamAssignment;
}

export function TeamSearchScreen({ event, onTeamSelected, onBack }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState<IndexEntry[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadAllTeams();
  }, []);

  async function loadAllTeams() {
    setLoading(true);
    setError(null);
    setIndex([]);
    const divisions = event.Divisions;
    setProgress({ done: 0, total: divisions.length });
    const collected: IndexEntry[] = [];
    try {
      // Load divisions in parallel batches to keep responsive
      const batchSize = 4;
      for (let i = 0; i < divisions.length; i += batchSize) {
        const batch = divisions.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (division) => {
            try {
              const teams = await getTeamAssignments(
                event.Key,
                division.DivisionId
              );
              return { division, teams };
            } catch {
              return { division, teams: [] as AESTeamAssignment[] };
            }
          })
        );
        for (const { division, teams } of results) {
          for (const team of teams) {
            collected.push({ division, team });
          }
        }
        setProgress((p) => ({ ...p, done: Math.min(p.done + batch.length, divisions.length) }));
        // Update the index incrementally so user can start searching
        setIndex([...collected]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load teams');
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return index.slice(0, 100);
    return index.filter((entry) => {
      const t = entry.team;
      const d = entry.division;
      return (
        (t.TeamName || '').toLowerCase().includes(q) ||
        (t.TeamText || '').toLowerCase().includes(q) ||
        (t.TeamCode || '').toLowerCase().includes(q) ||
        (t.TeamClub?.Name || '').toLowerCase().includes(q) ||
        (d.Name || '').toLowerCase().includes(q) ||
        (d.CodeAlias || '').toLowerCase().includes(q)
      );
    });
  }, [search, index]);

  function renderItem({ item }: { item: IndexEntry }) {
    return (
      <TouchableOpacity
        style={styles.teamCard}
        onPress={() => onTeamSelected(item.division, item.team)}
        activeOpacity={0.7}
      >
        <View
          style={[
            styles.colorBar,
            { backgroundColor: item.division.ColorHex },
          ]}
        />
        <View style={styles.teamInfo}>
          <Text style={styles.teamName} numberOfLines={1}>
            {item.team.TeamText || item.team.TeamName || 'Unknown Team'}
          </Text>
          <Text style={styles.clubName} numberOfLines={1}>
            {item.team.TeamClub?.Name || ''}
          </Text>
          <View style={styles.divisionRow}>
            <View
              style={[
                styles.divisionBadge,
                { backgroundColor: item.division.ColorHex },
              ]}
            >
              <Text style={styles.divisionBadgeText}>
                {item.division.CodeAlias}
              </Text>
            </View>
            <Text style={styles.divisionName} numberOfLines={1}>
              {item.division.Name}
            </Text>
          </View>
        </View>
        <Text style={styles.arrow}>{'>'}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton} hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Search Teams</Text>
        <Text style={styles.headerSubtitle} numberOfLines={1}>
          {event.Name}
        </Text>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by team, club or division..."
          placeholderTextColor={colors.textLight}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoFocus
        />
      </View>

      {loading && index.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>
            Loading all teams... ({progress.done}/{progress.total} divisions)
          </Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={loadAllTeams}>
            <Text style={styles.retryText}>Tap to retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {loading && (
            <Text style={styles.progressText}>
              Still loading... ({progress.done}/{progress.total} divisions)
            </Text>
          )}
          <FlatList
            data={filtered}
            keyExtractor={(item) => `${item.division.DivisionId}-${item.team.TeamId}`}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              search.trim() ? (
                <Text style={styles.emptyText}>No teams match "{search}"</Text>
              ) : (
                <Text style={styles.emptyText}>
                  Start typing to search all {index.length} teams
                </Text>
              )
            }
          />
        </>
      )}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    padding: spacing.lg,
    backgroundColor: colors.primary,
  },
  backButton: { marginBottom: spacing.sm },
  backText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.textOnPrimary,
    marginBottom: spacing.xs,
  },
  headerSubtitle: {
    fontSize: fontSize.sm,
    color: 'rgba(255,255,255,0.7)',
  },
  searchContainer: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  searchInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: fontSize.md,
    color: colors.text,
  },
  progressText: {
    textAlign: 'center',
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    paddingBottom: spacing.sm,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  teamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  colorBar: { width: 5, alignSelf: 'stretch' },
  teamInfo: { flex: 1, padding: spacing.lg },
  teamName: { fontSize: fontSize.lg, fontWeight: '600', color: colors.text },
  clubName: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  divisionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  divisionBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    marginRight: spacing.sm,
  },
  divisionBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: '#fff',
  },
  divisionName: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  arrow: {
    fontSize: 20,
    color: colors.textLight,
    paddingRight: spacing.lg,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl },
  loadingText: {
    marginTop: spacing.md,
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  errorText: {
    fontSize: fontSize.md,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  retryText: { fontSize: fontSize.md, color: colors.primary, fontWeight: '600' },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    padding: spacing.xxl,
  },
});
}
