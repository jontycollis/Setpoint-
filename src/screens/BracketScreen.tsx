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
  initialPlayId?: number;
  onTeamPress?: (teamId: number, teamName: string) => void;
}

interface BracketInfo {
  playId: number;
  name: string;
  matches: FlatBracketMatch[];
}

export function BracketScreen({ event, division, myTeamId, onBack, initialPlayId, onTeamPress }: Props) {
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
      // Track PlayIds we've already loaded — the same bracket can span
      // multiple days (e.g. U18 Boys Div 1 playoffs on Day 2 and Day 3).
      // Without dedup we'd show "Tier 1" twice.
      const seenPlayIds = new Set<number>();

      for (const day of bracketDays) {
        const plays = await getPlays(event.Key, division.DivisionId, day.DateTime);
        // Brackets have Type === 1
        const bracketPlays = plays.filter((p: any) => p.Type === 1);

        for (const bp of bracketPlays) {
          if (seenPlayIds.has(bp.PlayId)) continue; // Already loaded
          seenPlayIds.add(bp.PlayId);
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
            if (seenPlayIds.has(bp.PlayId)) continue;
            seenPlayIds.add(bp.PlayId);
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

      // Additional dedup: if two different PlayIds have the same name
      // (e.g. both called "Tier 1"), merge them — the one with more
      // matches is the most complete version.
      const dedupedByName: BracketInfo[] = [];
      const nameMap = new Map<string, BracketInfo>();
      for (const b of allBrackets) {
        const normalizedName = b.name.trim();
        const existing = nameMap.get(normalizedName);
        if (existing) {
          // Keep the one with more matches (more complete data)
          if (b.matches.length > existing.matches.length) {
            nameMap.set(normalizedName, b);
          }
        } else {
          nameMap.set(normalizedName, b);
        }
      }
      dedupedByName.push(...nameMap.values());

      setBrackets(dedupedByName);

      // Auto-select the bracket matching initialPlayId (if provided)
      if (initialPlayId) {
        const idx = dedupedByName.findIndex((b) => b.playId === initialPlayId);
        if (idx >= 0) {
          setSelectedBracket(idx);
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Check if the current bracket is a placement bracket (5th/7th, etc.)
   * so we can adjust round labels accordingly.
   */
  function isPlacementBracket(bracketName: string): boolean {
    const lower = bracketName.toLowerCase();
    return (
      /\b(5|7|9|11|13|15)(th|st|nd|rd)\b/.test(lower) ||
      /\b(5\/[678]|7\/[89]|9\/1[01]|11\/1[23])\b/.test(lower) ||
      lower.includes('placement')
    );
  }

  function getRoundLabel(round: number, maxRound: number, bracketName?: string): string {
    const isPlacement = bracketName ? isPlacementBracket(bracketName) : false;

    if (round === maxRound) {
      // For placement brackets, use the bracket name instead of "Final"
      if (isPlacement) return bracketName || 'Final';
      return 'Final';
    }
    if (round === maxRound - 1) return 'Semi-Finals';
    if (round === maxRound - 2) return 'Quarter-Finals';
    if (round === maxRound - 3) return 'Round of 16';
    if (round === maxRound - 4) return 'Round of 32';
    return `Round ${round + 1}`;
  }

  /**
   * Check if a match is a bronze/3rd-place match.
   * Strategy 1: Structural — if the match comes from a secondary root (rootIndex > 0)
   *   and is in the final round, it's a bronze/consolation match.
   * Strategy 2: Name-based fallback — check for common bronze match naming.
   */
  function isBronzeMatch(m: FlatBracketMatch): boolean {
    // Structural: secondary roots in the final round are bronze matches
    if (m.rootIndex > 0 && m.round === maxRound) return true;
    // Name-based fallback
    const name = (m.match.FullName || '').toLowerCase();
    return (
      name.includes('bronze') ||
      name.includes('3rd') ||
      name.includes('third') ||
      name.includes('consolation') ||
      name.includes('3rd/4th') ||
      name.includes('3/4')
    );
  }

  function renderTeamRow(
    teamObj: any | null,
    teamText: string,
    won: boolean,
    hasResult: boolean,
    sets: BracketMatch['Sets'],
    isFirst: boolean,
  ) {
    const hasTeam = teamObj?.TeamId != null && teamObj.TeamId !== 0;
    const isMe = hasTeam && myTeamId === teamObj.TeamId;
    const canTap = hasTeam && !isMe && !!onTeamPress;
    const displayText = teamText || 'TBD';

    const scores = sets.filter((s) =>
      isFirst ? s.FirstTeamScore !== null : s.SecondTeamScore !== null
    );

    const Container: any = canTap ? TouchableOpacity : View;
    const containerProps = canTap
      ? {
          onPress: () => onTeamPress!(teamObj.TeamId, teamObj.TeamName || teamText),
          activeOpacity: 0.6,
        }
      : {};

    return (
      <Container
        {...containerProps}
        style={[
          styles.teamRow,
          hasResult && won && styles.teamRowWinner,
        ]}
      >
        <Text
          style={[
            styles.teamText,
            hasResult && won && styles.teamTextWinner,
            hasResult && !won && styles.teamTextLoser,
            isMe && styles.teamTextMe,
            canTap && styles.teamTextTappable,
          ]}
          numberOfLines={1}
        >
          {displayText}
        </Text>
        {hasResult && (
          <View style={styles.setsRow}>
            {scores.map((s, i) => {
              const myScore = isFirst ? s.FirstTeamScore : s.SecondTeamScore;
              const oppScore = isFirst ? s.SecondTeamScore : s.FirstTeamScore;
              return (
                <Text
                  key={i}
                  style={[
                    styles.setScore,
                    (myScore || 0) > (oppScore || 0)
                      ? styles.setWin
                      : styles.setLoss,
                  ]}
                >
                  {myScore}
                </Text>
              );
            })}
          </View>
        )}
      </Container>
    );
  }

  function renderMatchCard(item: FlatBracketMatch, maxRound: number, idx?: number) {
    const m = item.match;

    return (
      <View key={`${item.rootIndex}-${item.round}-${item.position}-${m.MatchId || ''}-${idx ?? ''}`} style={styles.matchCard}>
        <Text style={styles.matchName}>{m.FullName}</Text>

        {renderTeamRow(m.FirstTeam, m.FirstTeamText, m.FirstTeamWon, m.HasScores, m.Sets, true)}

        <View style={styles.vsDivider}>
          <View style={styles.vsLine} />
          <Text style={styles.vsText}>vs</Text>
          <View style={styles.vsLine} />
        </View>

        {renderTeamRow(m.SecondTeam, m.SecondTeamText, m.SecondTeamWon, m.HasScores, m.Sets, false)}
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
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}>
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
              .map((round) => {
                const matches = roundGroups[round];

                // For the final round of non-placement brackets, separate gold/silver from bronze
                const bracketIsPlacement = currentBracket ? isPlacementBracket(currentBracket.name) : false;
                if (round === maxRound && matches.length > 1 && !bracketIsPlacement) {
                  const goldMatches = matches.filter((m) => !isBronzeMatch(m));
                  const bronzeMatches = matches.filter((m) => isBronzeMatch(m));

                  // If we detected bronze matches, render them separately
                  if (bronzeMatches.length > 0) {
                    return (
                      <View key={round}>
                        {/* Gold / Silver section */}
                        <View style={styles.roundSection}>
                          <View style={[styles.roundHeader, styles.goldRoundHeader]}>
                            <View style={styles.medalHeaderRow}>
                              <Text style={styles.medalEmoji}>🥇</Text>
                              <Text style={[styles.roundTitle, styles.goldRoundTitle]}>
                                Gold / Silver
                              </Text>
                            </View>
                            <Text style={styles.roundCount}>
                              {goldMatches.length} match{goldMatches.length !== 1 ? 'es' : ''}
                            </Text>
                          </View>
                          {goldMatches.map((m, i) => renderMatchCard(m, maxRound, i))}
                        </View>

                        {/* Bronze section */}
                        <View style={styles.roundSection}>
                          <View style={[styles.roundHeader, styles.bronzeRoundHeader]}>
                            <View style={styles.medalHeaderRow}>
                              <Text style={styles.medalEmoji}>🥉</Text>
                              <Text style={[styles.roundTitle, styles.bronzeRoundTitle]}>
                                Bronze
                              </Text>
                            </View>
                            <Text style={styles.roundCount}>
                              {bronzeMatches.length} match{bronzeMatches.length !== 1 ? 'es' : ''}
                            </Text>
                          </View>
                          {bronzeMatches.map((m, i) => renderMatchCard(m, maxRound, i))}
                        </View>
                      </View>
                    );
                  }
                }

                // Normal round rendering
                return (
                  <View key={round} style={styles.roundSection}>
                    <View style={styles.roundHeader}>
                      <Text style={styles.roundTitle}>
                        {getRoundLabel(round, maxRound, currentBracket?.name)}
                      </Text>
                      <Text style={styles.roundCount}>
                        {matches.length} match{matches.length !== 1 ? 'es' : ''}
                      </Text>
                    </View>
                    {matches.map((m, i) => renderMatchCard(m, maxRound, i))}
                  </View>
                );
              })}

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
  goldRoundHeader: {
    backgroundColor: '#FFF8E1',
    borderBottomWidth: 2,
    borderBottomColor: '#FFD54F',
  },
  bronzeRoundHeader: {
    backgroundColor: '#FBE9E7',
    borderBottomWidth: 2,
    borderBottomColor: '#BCAAA4',
  },
  medalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  medalEmoji: {
    fontSize: 20,
    lineHeight: 24,
    marginRight: spacing.xs,
  },
  roundTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.primary,
  },
  goldRoundTitle: {
    color: '#F57F17',
  },
  bronzeRoundTitle: {
    color: '#795548',
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
  teamTextMe: {
    fontWeight: '700',
    color: colors.primary,
  },
  teamTextTappable: {
    color: colors.primary,
    textDecorationLine: 'underline',
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
