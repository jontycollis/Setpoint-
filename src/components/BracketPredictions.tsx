// Bracket Predictions — predicts playoff seeding from pool standings
import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import { getStandings } from '../api/aesClient';
import type { AESStanding } from '../types/aes';

interface Props {
  eventKey: string;
  divisionId: number;
  myTeamId: number;
  divisionTeamCount: number;
  onViewBrackets?: () => void;
}

/**
 * Predicts playoff seedings based on current pool standings.
 * Shows where the team is projected to finish and who they'd likely face.
 */
export function BracketPredictions({
  eventKey,
  divisionId,
  myTeamId,
  divisionTeamCount,
  onViewBrackets,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [standings, setStandings] = useState<AESStanding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getStandings(eventKey, divisionId);
        if (!cancelled) {
          setStandings(data);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventKey, divisionId]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  if (error || standings.length === 0) return null;

  // Find my team's standing
  const myStanding = standings.find((s) => s.TeamId === myTeamId);
  if (!myStanding) return null;

  const myRank = myStanding.OverallRank ?? myStanding.FinishRank ?? 0;
  if (myRank === 0) return null;

  // Determine bracket size (nearest power of 2 >= team count, or common sizes)
  // AES typically uses all teams in playoffs with placement brackets
  const teamCount = standings.length;

  // Predict placement bracket
  // Common structures: top half (gold bracket), bottom half (placement)
  // With 12 teams: top 8 = gold, bottom 4 = 9-12 placement
  // With 16 teams: top 8 = gold, next 8 = placement
  // With 8 teams: all in single bracket

  const goldCutoff = teamCount <= 8 ? teamCount : Math.ceil(teamCount / 2);
  const inGoldBracket = myRank <= goldCutoff;

  // Predict first round opponent (standard seeding: 1v8, 2v7, 3v6, 4v5)
  const bracketSize = inGoldBracket
    ? nearestPowerOf2(goldCutoff)
    : nearestPowerOf2(teamCount - goldCutoff);

  const seedInBracket = inGoldBracket ? myRank : myRank - goldCutoff;
  const opponentSeed = bracketSize + 1 - seedInBracket;

  // Find the projected opponent
  const opponentRank = inGoldBracket ? opponentSeed : opponentSeed + goldCutoff;
  const projectedOpponent = standings.find(
    (s) => (s.OverallRank ?? s.FinishRank) === opponentRank
  );

  // Calculate strength of schedule
  const matchPct = parseFloat(myStanding.MatchPercent?.toString() || '0');
  const setPct = parseFloat(myStanding.SetPercent?.toString() || '0');

  // Determine confidence label
  const gamesPlayed = myStanding.MatchesWon + myStanding.MatchesLost;
  let confidence: 'Early' | 'Developing' | 'Likely';
  if (gamesPlayed <= 1) confidence = 'Early';
  else if (gamesPlayed <= 3) confidence = 'Developing';
  else confidence = 'Likely';

  const confidenceColor = {
    Early: colors.warning,
    Developing: colors.info,
    Likely: colors.success,
  }[confidence];

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>Playoff Projection</Text>
        <View style={[styles.confidenceBadge, { backgroundColor: confidenceColor }]}>
          <Text style={styles.confidenceText}>{confidence}</Text>
        </View>
      </View>

      <View style={styles.predictionCard}>
        {/* Current seed */}
        <View style={styles.seedRow}>
          <View style={styles.seedCircle}>
            <Text style={styles.seedNumber}>{myRank}</Text>
          </View>
          <View style={styles.seedInfo}>
            <Text style={styles.seedLabel}>
              Current Overall Ranking
            </Text>
            <Text style={styles.seedDetail}>
              {myStanding.MatchesWon}W-{myStanding.MatchesLost}L
              {matchPct > 0 ? ` (${(matchPct * 100).toFixed(0)}%)` : ''}
            </Text>
          </View>
        </View>

        {/* Bracket prediction */}
        <View style={styles.bracketInfo}>
          <View style={[
            styles.bracketBadge,
            inGoldBracket ? styles.bracketBadgeGold : styles.bracketBadgePlacement,
          ]}>
            <Text style={[
              styles.bracketBadgeText,
              inGoldBracket ? styles.bracketBadgeTextGold : styles.bracketBadgeTextPlacement,
            ]}>
              {inGoldBracket ? 'Gold Bracket' : 'Placement Bracket'}
            </Text>
          </View>
          <Text style={styles.bracketSeedText}>
            #{seedInBracket} seed {inGoldBracket ? '' : `(${goldCutoff + 1}-${teamCount})`}
          </Text>
        </View>

        {/* Projected first match */}
        {projectedOpponent && (
          <View style={styles.projectedMatch}>
            <Text style={styles.projectedLabel}>Projected 1st Match</Text>
            <View style={styles.projectedMatchup}>
              <Text style={styles.projectedYou}>You (#{seedInBracket})</Text>
              <Text style={styles.projectedVs}>vs</Text>
              <View style={styles.projectedOpponentCol}>
                <Text style={styles.projectedOpponentName} numberOfLines={1}>
                  {projectedOpponent.TeamText || projectedOpponent.TeamName}
                </Text>
                <Text style={styles.projectedOpponentRecord}>
                  #{opponentSeed} — {projectedOpponent.MatchesWon}W-{projectedOpponent.MatchesLost}L
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Bubble warning */}
        {myRank === goldCutoff && (
          <View style={styles.bubbleWarning}>
            <Text style={styles.bubbleText}>
              On the bubble — one spot from {inGoldBracket ? 'placement' : 'gold'} bracket
            </Text>
          </View>
        )}
      </View>

      {onViewBrackets && (
        <TouchableOpacity
          style={styles.viewBracketsBtn}
          onPress={onViewBrackets}
          activeOpacity={0.7}
        >
          <Text style={styles.viewBracketsText}>View Playoff Brackets</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function nearestPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  confidenceBadge: {
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  confidenceText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textOnPrimary,
  },
  predictionCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  seedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  seedCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  seedNumber: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.textOnPrimary,
  },
  seedInfo: {
    flex: 1,
  },
  seedLabel: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  seedDetail: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 1,
  },
  bracketInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  bracketBadge: {
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  bracketBadgeGold: {
    backgroundColor: 'rgba(251, 188, 4, 0.2)',
  },
  bracketBadgePlacement: {
    backgroundColor: colors.divider,
  },
  bracketBadgeText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  bracketBadgeTextGold: {
    color: colors.warning,
  },
  bracketBadgeTextPlacement: {
    color: colors.textSecondary,
  },
  bracketSeedText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  projectedMatch: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
  },
  projectedLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  projectedMatchup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  projectedYou: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.primary,
    flex: 1,
  },
  projectedVs: {
    fontSize: fontSize.sm,
    color: colors.textLight,
    paddingHorizontal: spacing.sm,
  },
  projectedOpponentCol: {
    flex: 1,
    alignItems: 'flex-end',
  },
  projectedOpponentName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  projectedOpponentRecord: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 1,
  },
  bubbleWarning: {
    marginTop: spacing.sm,
    backgroundColor: `${colors.warning}20`,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
  },
  bubbleText: {
    fontSize: fontSize.sm,
    color: colors.warning,
    fontWeight: '600',
    textAlign: 'center',
  },
  viewBracketsBtn: {
    marginTop: spacing.md,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  viewBracketsText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.primary,
  },
});
}
