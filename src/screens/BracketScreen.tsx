import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../utils/theme';
import {
  getPlayDays,
  getPlays,
  getPlayDetail,
  flattenBracketTree,
} from '../api/aesClient';
import type { PlayDay, FlatBracketMatch, BracketMatch } from '../api/aesClient';
import { Card } from '../components/Card';
import type { AESEvent, AESDivision } from '../types/aes';

interface Props {
  event: AESEvent;
  division: AESDivision;
  myTeamId?: number;
  onBack: () => void;
}

interface BracketInfo {
  playId: number;
  name: string;
  matches: FlatBracketMatch[];
}

export function BracketScreen({ event, division, myTeamId, onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brackets, setBrackets] = useState<BracketInfo[]>([]);
  const [selectedBracket, setSelectedBracket] = useState<number>(0);

  useEffect(() => {
    loadBrackets();
  }, []);

  async function loadBrackets() {
    setLoading(true);
    setError(null);
    try {
      const playDays = await getPlayDays(event.Key, division.DivisionId);

      // Find days that have brackets
      const bracketDays = playDays.filter((d: PlayDay) => d.HasBrackets);

      const allBrackets: BracketInfo[] = [];

      for (const day of bracketDays) {
        const plays = await getPlays(event.Key, division.DivisionId, day.DateTime);
        // Brackets have Type === 1
        const bracketPlays = plays.filter((p: any) => p.Type === 1);

        for (const bp of bracketPlays) {
          try {
            const detail = await getPlayDetail(event.Key, bp.PlayId);
            if (detail.Roots && detail.Roots.length > 0) {
              const matches = flattenBracketTree(detail.Roots);
              allBrackets.push({
                playId: bp.PlayId,
                name: detail.FullName || detail.CompleteFullName,
                matches,
              });
            }
          } catch {
            // Skip brackets that fail to load
          }
        }
      }

      if (allBrackets.length === 0) {
        // Check pool days too — some events have brackets embedded
        for (const day of playDays) {
          if (bracketDays.includes(day)) continue;
          const plays = await getPlays(event.Key, division.DivisionId, day.DateTime);
          const bracketPlays = plays.filter((p: any) => p.Type === 1);
          for (const bp of bracketPlays) {
            try {
              const detail = await getPlayDetail(event.Key, bp.PlayId);
              if (detail.Roots && detail.Roots.length > 0) {
                const matches = flattenBracketTree(detail.Roots);
                allBrackets.push({
                  playId: bp.PlayId,
                  name: detail.FullName || detail.CompleteFullName,
                  matches,
                });
              }
            } catch {}
          }
        }
      }

      setBrackets(allBrackets);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function getRoundLabel(round: number, maxRound: number): string {
    if (round === maxRound) return 'Final';
    if (round === maxRound - 1) return 'Semi-Finals';
    if (round === maxRound - 2) return 'Quarter-Finals';
    return `Round ${round + 1}`;
  }

  function renderMatchCard(item: FlatBracketMatch, maxRound: number) {
    const m = item.match;
    const team1Won = m.FirstTeamWon;
    const team2Won = m.SecondTeamWon;
    const hasResult = m.HasScores;

    return (
      <View key={`${item.round}-${item.position}`} style={styles.matchCard}>
        <Text style={styles.matchName}>{m.FullName}</Text>

        {/* Team 1 */}
        <View
          style={[
            styles.teamRow,
            hasResult && team1Won && styles.teamRowWinner,
          ]}
        >
          <Text
            style={[
              styles.teamText,
              hasResult && team1Won && styles.teamTextWinner,
              hasResult && !team1Won && styles.teamTextLoser,
            ]}
            numberOfLines={1}
          >
            {m.FirstTeamText || 'TBD'}
          </Text>
          {hasResult && (
            <View style={styles.setsRow}>
              {m.Sets.filter((s) => s.FirstTeamScore !== null).map((s, i) => (
                <Text
                  key={i}
                  style={[
                    styles.setScore,
                    (s.FirstTeamScore || 0) > (s.SecondTeamScore || 0)
                      ? styles.setWin
                      : styles.setLoss,
                  ]}
                >
                  {s.FirstTeamScore}
                </Text>
              ))}
            </View>
          )}
        </View>

        {/* VS divider */}
        <View style={styles.vsDivider}>
          <View style={styles.vsLine} />
          <Text style={styles.vsText}>vs</Text>
          <View style={styles.vsLine} />
        </View>

        {/* Team 2 */}
        <View
          style={[
            styles.teamRow,
            hasResult && team2Won && styles.teamRowWinner,
          ]}
        >
          <Text
            style={[
              styles.teamText,
              hasResult && team2Won && styles.teamTextWinner,
              hasResult && !team2Won && styles.teamTextLoser,
            ]}
            numberOfLines={1}
          >
            {m.SecondTeamText || 'TBD'}
          </Text>
          {hasResult && (
            <View style={styles.setsRow}>
              {m.Sets.filter((s) => s.SecondTeamScore !== null).map((s, i) => (
                <Text
                  key={i}
                  style={[
                    styles.setScore,
                    (s.SecondTeamScore || 0) > (s.FirstTeamScore || 0)
                      ? styles.setWin
                      : styles.setLoss,
                  ]}
                >
                  {s.SecondTeamScore}
                </Text>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading brackets...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity onPress={loadBrackets}>
          <Text style={styles.retryText}>Tap to retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentBracket = brackets[selectedBracket];

  // Group matches by round
  const roundGroups: Record<number, FlatBracketMatch[]> = {};
  let maxRound = 0;
  if (currentBracket) {
    for (const m of currentBracket.matches) {
      if (!roundGroups[m.round]) roundGroups[m.round] = [];
      roundGroups[m.round].push(m);
      if (m.round > maxRound) maxRound = m.round;
    }
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Playoff Brackets</Text>
        <Text style={styles.subtitle}>{division.Name}</Text>
      </View>

      {brackets.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.noBrackets}>
            No playoff brackets available yet.{'\n'}
            Brackets will appear once pool play is complete.
          </Text>
        </View>
      ) : (
        <>
          {/* Bracket/Tier Selector */}
          {brackets.length > 1 && (
            <ScrollView
              horizontal
              style={styles.tierPicker}
              showsHorizontalScrollIndicator={false}
            >
              {brackets.map((b, index) => (
                <TouchableOpacity
                  key={b.playId}
                  style={[
                    styles.tierChip,
                    selectedBracket === index && styles.tierChipActive,
                  ]}
                  onPress={() => setSelectedBracket(index)}
                >
                  <Text
                    style={[
                      styles.tierChipText,
                      selectedBracket === index && styles.tierChipTextActive,
                    ]}
                  >
                    {b.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Bracket Rounds */}
          <ScrollView style={styles.bracketScroll}>
            {Object.keys(roundGroups)
              .map(Number)
              .sort((a, b) => a - b)
              .map((round) => (
                <View key={round} style={styles.roundSection}>
                  <View style={styles.roundHeader}>
                    <Text style={styles.roundTitle}>
                      {getRoundLabel(round, maxRound)}
                    </Text>
                    <Text style={styles.roundCount}>
                      {roundGroups[round].length} match
                      {roundGroups[round].length !== 1 ? 'es' : ''}
                    </Text>
                  </View>
                  {roundGroups[round].map((m) =>
                    renderMatchCard(m, maxRound)
                  )}
                </View>
              ))}

            <View style={{ height: spacing.xxxl }} />
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  errorText: {
    fontSize: fontSize.md,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  retryText: {
    fontSize: fontSize.md,
    color: colors.primary,
    fontWeight: '600',
  },
  header: {
    padding: spacing.lg,
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
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  noBrackets: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  tierPicker: {
    flexGrow: 0,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  tierChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.background,
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tierChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tierChipText: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
  tierChipTextActive: {
    color: colors.textOnPrimary,
    fontWeight: '700',
  },
  bracketScroll: { flex: 1 },
  roundSection: {
    marginBottom: spacing.md,
  },
  roundHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.primaryLight,
  },
  roundTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.primary,
  },
  roundCount: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  matchCard: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  matchName: {
    fontSize: fontSize.xs,
    color: colors.textLight,
    fontWeight: '600',
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  teamRowWinner: {
    backgroundColor: 'rgba(52, 168, 83, 0.08)',
  },
  teamText: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.text,
  },
  teamTextWinner: {
    fontWeight: '700',
    color: colors.win,
  },
  teamTextLoser: {
    color: colors.textLight,
  },
  setsRow: {
    flexDirection: 'row',
  },
  setScore: {
    width: 28,
    textAlign: 'center' as const,
    fontSize: fontSize.md,
    fontWeight: '600',
    marginLeft: 2,
  },
  setWin: { color: colors.win },
  setLoss: { color: colors.textLight },
  vsDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  vsLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.divider,
  },
  vsText: {
    fontSize: fontSize.xs,
    color: colors.textLight,
    paddingHorizontal: spacing.sm,
  },
});
