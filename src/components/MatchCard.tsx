import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Card } from './Card';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import { formatTime, getRelativeTime } from '../utils/dates';

interface MatchCardProps {
  matchCode?: string;
  startTime: string | number;
  courtName: string;
  homeTeam: string;
  awayTeam: string;
  homeSeed?: string;
  awaySeed?: string;
  sets?: { home: number; away: number }[];
  isComplete?: boolean;
  winnerId?: number | null;
  homeTeamId?: number;
  awayTeamId?: number;
  highlightTeamId?: number;
  onPress?: () => void;
}

export function MatchCard({
  matchCode,
  startTime,
  courtName,
  homeTeam,
  awayTeam,
  sets,
  isComplete,
  winnerId,
  homeTeamId,
  awayTeamId,
  highlightTeamId,
  onPress,
}: MatchCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isHomeHighlighted = highlightTeamId === homeTeamId;
  const isAwayHighlighted = highlightTeamId === awayTeamId;
  const homeWon = winnerId === homeTeamId;
  const awayWon = winnerId === awayTeamId;

  const content = (
    <Card variant="outlined">
      {/* Header row: time + court */}
      <View style={styles.header}>
        <View style={styles.timeContainer}>
          <Text style={styles.time}>{formatTime(startTime)}</Text>
          <Text style={styles.relative}>{getRelativeTime(startTime)}</Text>
        </View>
        <View style={styles.courtBadge}>
          <Text style={styles.courtText}>{courtName}</Text>
        </View>
      </View>

      {/* Teams */}
      <View style={styles.teamsContainer}>
        <View style={styles.teamRow}>
          <View style={[styles.teamIndicator, isHomeHighlighted && styles.highlightIndicator]} />
          <Text
            style={[
              styles.teamName,
              isHomeHighlighted && styles.highlightedTeam,
              isComplete && homeWon && styles.winnerTeam,
              isComplete && !homeWon && styles.loserTeam,
            ]}
            numberOfLines={1}
          >
            {homeTeam}
          </Text>
          {sets && sets.length > 0 && (
            <View style={styles.scoresRow}>
              {sets.map((s, i) => (
                <Text
                  key={i}
                  style={[
                    styles.score,
                    s.home > s.away ? styles.scoreWin : styles.scoreLoss,
                  ]}
                >
                  {s.home}
                </Text>
              ))}
            </View>
          )}
        </View>

        <View style={styles.teamRow}>
          <View style={[styles.teamIndicator, isAwayHighlighted && styles.highlightIndicator]} />
          <Text
            style={[
              styles.teamName,
              isAwayHighlighted && styles.highlightedTeam,
              isComplete && awayWon && styles.winnerTeam,
              isComplete && !awayWon && styles.loserTeam,
            ]}
            numberOfLines={1}
          >
            {awayTeam}
          </Text>
          {sets && sets.length > 0 && (
            <View style={styles.scoresRow}>
              {sets.map((s, i) => (
                <Text
                  key={i}
                  style={[
                    styles.score,
                    s.away > s.home ? styles.scoreWin : styles.scoreLoss,
                  ]}
                >
                  {s.away}
                </Text>
              ))}
            </View>
          )}
        </View>
      </View>

      {matchCode && (
        <Text style={styles.matchCode}>{matchCode}</Text>
      )}
    </Card>
  );

  if (onPress) {
    return <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{content}</TouchableOpacity>;
  }
  return content;
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  time: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    marginRight: spacing.sm,
  },
  relative: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  courtBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  courtText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
  },
  teamsContainer: {
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  teamIndicator: {
    width: 3,
    height: 20,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginRight: spacing.sm,
  },
  highlightIndicator: {
    backgroundColor: colors.primary,
  },
  teamName: {
    flex: 1,
    fontSize: fontSize.lg,
    color: colors.text,
  },
  highlightedTeam: {
    fontWeight: '700',
    color: colors.primary,
  },
  winnerTeam: {
    fontWeight: '700',
    color: colors.win,
  },
  loserTeam: {
    color: colors.textLight,
  },
  scoresRow: {
    flexDirection: 'row',
  },
  score: {
    width: 28,
    textAlign: 'center' as const,
    marginLeft: spacing.xs,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  scoreWin: {
    color: colors.win,
  },
  scoreLoss: {
    color: colors.textLight,
  },
  matchCode: {
    fontSize: fontSize.xs,
    color: colors.textLight,
    marginTop: spacing.xs,
  },
});
}
