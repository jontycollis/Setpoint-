import React, { useEffect, useState, useMemo } from 'react';
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
import type { AESEvent, AESDivision, AESTeamAssignment } from '../types/aes';

interface Props {
  event: AESEvent;
  division: AESDivision;
  onTeamSelected: (team: AESTeamAssignment) => void;
  onBack: () => void;
  isFavorite: (teamId: number) => boolean;
}

export function TeamSelectScreen({
  event,
  division,
  onTeamSelected,
  onBack,
  isFavorite,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [teams, setTeams] = useState<AESTeamAssignment[]>([]);
  const [filtered, setFiltered] = useState<AESTeamAssignment[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTeams();
  }, []);

  useEffect(() => {
    if (!search.trim()) {
      setFiltered(teams);
    } else {
      const q = search.toLowerCase();
      setFiltered(
        teams.filter(
          (t) =>
            (t.TeamName ?? '').toLowerCase().includes(q) ||
            (t.TeamText ?? '').toLowerCase().includes(q) ||
            (t.TeamClub?.Name ?? '').toLowerCase().includes(q)
        )
      );
    }
  }, [search, teams]);

  async function loadTeams() {
    setLoading(true);
    setError(null);
    try {
      const data = await getTeamAssignments(event.Key, division.DivisionId);
      // Drop placeholder / withdrawn slots whose name fields are all empty —
      // they crash search and otherwise render as blank rows.
      const usable = data.filter((t) => {
        const hasName = !!(t.TeamName || t.TeamText || t.TeamClub?.Name);
        if (!hasName && __DEV__) {
          // eslint-disable-next-line no-console
          console.warn(
            `[AES] TeamAssignment with null Name in ${event.Key} / division ${division.DivisionId}`,
            { TeamId: t.TeamId }
          );
        }
        return hasName;
      });
      setTeams(usable);
      setFiltered(usable);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function renderTeam({ item }: { item: AESTeamAssignment }) {
    const fav = isFavorite(item.TeamId);
    return (
      <TouchableOpacity
        style={styles.teamCard}
        onPress={() => onTeamSelected(item)}
        activeOpacity={0.7}
      >
        <View style={styles.teamInfo}>
          <Text style={styles.teamName}>{item.TeamText || item.TeamName || 'Unknown Team'}</Text>
          {item.TeamClub?.Name ? (
            <Text style={styles.clubName}>{item.TeamClub.Name}</Text>
          ) : null}
          {item.NextMatch && (
            <Text style={styles.nextMatch}>
              Next: vs {item.OpponentTeamName} - {item.NextMatch.Court?.Name || 'TBD'}
            </Text>
          )}
        </View>
        {fav && <Text style={styles.star}>★</Text>}
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
        <View style={styles.headerRow}>
          <View style={[styles.divisionBadge, { backgroundColor: division.ColorHex }]}>
            <Text style={styles.divisionBadgeText}>{division.CodeAlias}</Text>
          </View>
          <Text style={styles.headerTitle}>{division.Name}</Text>
        </View>
        <Text style={styles.headerSubtitle}>{division.TeamCount} teams</Text>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search teams or clubs..."
          placeholderTextColor={colors.textLight}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading teams...</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={loadTeams}>
            <Text style={styles.retryText}>Tap to retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.TeamId)}
          renderItem={renderTeam}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    padding: spacing.lg,
    paddingBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomLeftRadius: borderRadius.xl,
    borderBottomRightRadius: borderRadius.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  backButton: { marginBottom: spacing.sm },
  backText: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  divisionBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    marginRight: spacing.sm,
  },
  divisionBadgeText: { fontSize: fontSize.sm, fontWeight: '800', color: '#fff' },
  headerTitle: { fontSize: fontSize.xl, fontWeight: '800', color: colors.text },
  headerSubtitle: { fontSize: fontSize.sm, color: colors.textSecondary },
  searchContainer: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  searchInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    fontSize: fontSize.md,
    color: colors.text,
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  teamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  teamInfo: { flex: 1 },
  teamName: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  clubName: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  nextMatch: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '600', marginTop: spacing.xs },
  star: { fontSize: 18, color: colors.warning, marginRight: spacing.sm },
  arrow: { fontSize: 20, color: colors.textLight },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl },
  loadingText: { marginTop: spacing.md, fontSize: fontSize.md, color: colors.textSecondary },
  errorText: { fontSize: fontSize.md, color: colors.error, textAlign: 'center', marginBottom: spacing.md },
  retryText: { fontSize: fontSize.md, color: colors.primary, fontWeight: '600' },
});
}
