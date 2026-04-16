import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { colors, spacing, fontSize } from '../utils/theme';
import { getStandings } from '../api/aesClient';
import type { AESEvent, AESDivision, AESStanding } from '../types/aes';

interface Props {
  event: AESEvent;
  division: AESDivision;
  myTeamId?: number;
  onBack: () => void;
}

export function StandingsScreen({ event, division, myTeamId, onBack }: Props) {
  const [standings, setStandings] = useState<AESStanding[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    loadStandings();
  }, []);

  async function loadStandings() {
    setError(null);
    try {
      const data = await getStandings(event.Key, division.DivisionId);
      setStandings(data);
      setLastUpdated(Date.now());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadStandings();
    setRefreshing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function formatLastUpdated(ts: number): string {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 5) return 'just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{division.Name} Standings</Text>
        <View style={styles.headerMetaRow}>
          {lastUpdated && (
            <Text style={styles.updatedText}>
              Updated {formatLastUpdated(lastUpdated)}
            </Text>
          )}
          <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn}>
            <Text style={styles.refreshBtnText}>Refresh</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>Pull down to refresh</Text>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.tableHeader}>
        <Text style={[styles.headerCell, styles.rankCol]}>#</Text>
        <Text style={[styles.headerCell, styles.teamCol]}>Team</Text>
        <Text style={[styles.headerCell, styles.statCol]}>W</Text>
        <Text style={[styles.headerCell, styles.statCol]}>L</Text>
        <Text style={[styles.headerCell, styles.statCol]}>SW</Text>
        <Text style={[styles.headerCell, styles.statCol]}>SL</Text>
        <Text style={[styles.headerCell, styles.pctCol]}>M%</Text>
      </View>

      {standings.map((s, index) => {
        const isMyTeam = s.TeamId === myTeamId;
        return (
          <View
            key={s.TeamId}
            style={[
              styles.tableRow,
              index % 2 === 0 && styles.tableRowAlt,
              isMyTeam && styles.tableRowHighlight,
            ]}
          >
            <Text style={[styles.cell, styles.rankCol, styles.rankText]}>
              {s.OverallRank || s.FinishRank || index + 1}
            </Text>
            <View style={styles.teamCol}>
              <Text
                style={[styles.cell, isMyTeam && styles.highlightText]}
                numberOfLines={1}
              >
                {s.TeamText || s.TeamName}
              </Text>
            </View>
            <Text style={[styles.cell, styles.statCol]}>{s.MatchesWon}</Text>
            <Text style={[styles.cell, styles.statCol]}>{s.MatchesLost}</Text>
            <Text style={[styles.cell, styles.statCol]}>{s.SetsWon}</Text>
            <Text style={[styles.cell, styles.statCol]}>{s.SetsLost}</Text>
            <Text style={[styles.cell, styles.pctCol]}>
              {s.MatchPercent != null
                ? `${(s.MatchPercent * 100).toFixed(0)}%`
                : '-'}
            </Text>
          </View>
        );
      })}

      <View style={{ height: spacing.xxxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: spacing.lg },
  backText: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600', marginBottom: spacing.sm },
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.text },
  headerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  updatedText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  hint: {
    fontSize: fontSize.xs,
    color: colors.textLight,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  refreshBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: 6,
  },
  refreshBtnText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  errorBox: {
    padding: spacing.md,
    backgroundColor: 'rgba(220, 53, 69, 0.08)',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: 6,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.loss,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  headerCell: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textOnPrimary },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  tableRowAlt: { backgroundColor: '#fafafa' },
  tableRowHighlight: {
    backgroundColor: colors.primaryLight,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  cell: { fontSize: fontSize.sm, color: colors.text },
  rankCol: { width: 30, textAlign: 'center' },
  rankText: { fontWeight: '700' },
  teamCol: { flex: 1, paddingRight: spacing.sm },
  statCol: { width: 30, textAlign: 'center' },
  pctCol: { width: 40, textAlign: 'right' },
  highlightText: { fontWeight: '700', color: colors.primary },
});
