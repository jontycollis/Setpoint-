import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../utils/theme';
import type { PoolTeam } from '../api/aesClient';

interface Props {
  poolShortName?: string | null;
  teams: PoolTeam[];
  myTeamId?: number;
  onTeamPress?: (teamId: number, teamName: string) => void;
}

export function PoolStandings({ poolShortName, teams, myTeamId, onTeamPress }: Props) {
  if (!teams || teams.length === 0) return null;

  // Sort: by FinishRank first (if posted), else by MatchesWon desc, then SetsWon desc
  const sorted = [...teams].sort((a, b) => {
    if (a.FinishRank != null && b.FinishRank != null) {
      return a.FinishRank - b.FinishRank;
    }
    if (a.FinishRank != null) return -1;
    if (b.FinishRank != null) return 1;
    if (b.MatchesWon !== a.MatchesWon) return b.MatchesWon - a.MatchesWon;
    return b.SetsWon - a.SetsWon;
  });

  return (
    <View style={styles.container}>
      {poolShortName && (
        <Text style={styles.poolLabel}>Pool {poolShortName}</Text>
      )}
      <View style={styles.tableHeader}>
        <Text style={[styles.headerCell, styles.rankCol]}>#</Text>
        <Text style={[styles.headerCell, styles.teamCol]}>Team</Text>
        <Text style={[styles.headerCell, styles.statCol]}>W</Text>
        <Text style={[styles.headerCell, styles.statCol]}>L</Text>
        <Text style={[styles.headerCell, styles.statCol]}>SW</Text>
        <Text style={[styles.headerCell, styles.statCol]}>SL</Text>
        <Text style={[styles.headerCell, styles.ratioCol]}>Pts</Text>
      </View>
      {sorted.map((t, idx) => {
        const rank = t.FinishRank ?? idx + 1;
        const isMine = myTeamId != null && t.TeamId === myTeamId;
        const canPress = !!onTeamPress && !isMine;
        const RowContainer: any = canPress ? TouchableOpacity : View;
        const rowProps = canPress
          ? {
              onPress: () =>
                onTeamPress!(t.TeamId, t.TeamName || t.TeamText || ''),
              activeOpacity: 0.6,
            }
          : {};
        return (
          <RowContainer
            key={t.TeamId ? `team-${t.TeamId}` : `slot-${idx}`}
            {...rowProps}
            style={[
              styles.row,
              idx % 2 === 1 && styles.rowAlt,
              isMine && styles.rowHighlight,
            ]}
          >
            <Text style={[styles.cell, styles.rankCol, styles.rankText]}>
              {rank}
            </Text>
            <View style={styles.teamCol}>
              <Text
                style={[
                  styles.cell,
                  isMine && styles.highlightText,
                  canPress && styles.linkText,
                ]}
                numberOfLines={1}
              >
                {t.TeamText || t.TeamName}
              </Text>
            </View>
            <Text style={[styles.cell, styles.statCol]}>{t.MatchesWon}</Text>
            <Text style={[styles.cell, styles.statCol]}>{t.MatchesLost}</Text>
            <Text style={[styles.cell, styles.statCol]}>{t.SetsWon}</Text>
            <Text style={[styles.cell, styles.statCol]}>{t.SetsLost}</Text>
            <Text style={[styles.cell, styles.ratioCol]} numberOfLines={1}>
              {(() => {
                const val = parseFloat(t.PointRatio);
                return isNaN(val) ? '0.00' : val.toFixed(2);
              })()}
            </Text>
          </RowContainer>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.divider,
  },
  poolLabel: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.primary,
    padding: spacing.sm,
    backgroundColor: colors.primaryLight,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  headerCell: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textOnPrimary,
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  rowAlt: { backgroundColor: '#fafafa' },
  rowHighlight: {
    backgroundColor: colors.primaryLight,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  cell: { fontSize: fontSize.sm, color: colors.text },
  rankCol: { width: 24, textAlign: 'center' },
  rankText: { fontWeight: '700' },
  teamCol: { flex: 1, paddingRight: spacing.xs },
  statCol: { width: 26, textAlign: 'center' },
  ratioCol: { width: 54, textAlign: 'right' },
  highlightText: { fontWeight: '700', color: colors.primary },
  linkText: { color: colors.primary, textDecorationLine: 'underline' },
});
