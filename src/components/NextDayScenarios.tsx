import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../utils/theme';
import { getTeamFutureSchedule, getPlayDetail, getPoolByPlayId } from '../api/aesClient';
import type { TeamFutureScheduleRow, BracketNode, PoolTeam } from '../api/aesClient';
import { Card } from './Card';
import { PoolStandings } from './PoolStandings';
import { formatTime, formatDate } from '../utils/dates';

interface Props {
  eventKey: string;
  divisionId: number;
  divisionName: string;
  teamId: number;
  myPoolShortName?: string;
  myFinishRank?: number | null;
  onViewBrackets?: (playId?: number) => void;
  onScoutOpponent?: (opponentTeamId: number, opponentName: string) => void;
  /** Active bracket play IDs the team is currently in (for next-round lookup) */
  playoffPlayIds?: number[];
}

/** Opponent info extracted from a bracket match */
interface OpponentInfo {
  teamId: number;
  teamName: string;
  teamText: string;
}

/** Info about the potential next round match in a bracket */
interface NextRoundInfo {
  playId: number;
  playName: string;
  matchFullName: string; // e.g. "Semi-Final 1"
  potentialOpponentText: string; // e.g. "Winner of QF2" or actual team name
  potentialOpponentId?: number;
  potentialOpponentName?: string;
  scheduledStartDateTime?: number;
  courtName?: string;
  /** 'win' = if team wins current match, 'loss' = if team loses */
  outcome: 'win' | 'loss';
}

/** Extract opponent info from a sibling bracket node */
function extractOpponentFromSibling(
  siblingNode: BracketNode | null,
  wantLoser: boolean,
): { text: string; id?: number; name?: string } {
  if (!siblingNode?.Match) return { text: 'TBD' };
  const sm = siblingNode.Match;
  if (sm.HasScores) {
    // Match decided — pick winner or loser based on wantLoser flag
    const pickFirst = wantLoser ? !sm.FirstTeamWon : sm.FirstTeamWon;
    if (pickFirst && sm.FirstTeam?.TeamId) {
      return {
        id: sm.FirstTeam.TeamId,
        name: sm.FirstTeam.TeamName || sm.FirstTeamText,
        text: sm.FirstTeamText || sm.FirstTeam.TeamName || 'TBD',
      };
    } else if (sm.SecondTeam?.TeamId) {
      return {
        id: sm.SecondTeam.TeamId,
        name: sm.SecondTeam.TeamName || sm.SecondTeamText,
        text: sm.SecondTeamText || sm.SecondTeam.TeamName || 'TBD',
      };
    }
  } else {
    const t1 = sm.FirstTeamText || sm.FirstTeam?.TeamName || '?';
    const t2 = sm.SecondTeamText || sm.SecondTeam?.TeamName || '?';
    const label = wantLoser ? 'Loser' : 'Winner';
    if (t1 !== '?' && t2 !== '?') {
      return { text: `${label} of ${t1} vs ${t2}` };
    }
    return { text: `${label} of ${sm.FullName || 'earlier match'}` };
  }
  return { text: 'TBD' };
}

/**
 * Walk a bracket tree to find the next-round matches for a team (both win and loss paths).
 * The bracket tree has roots (finals) with TopSource/BottomSource pointing to earlier rounds.
 * We build parent pointers, find the team's current match, then look at:
 *  - Win path: the parent node (next round in the main bracket)
 *  - Loss path: any separate root whose sources include the losers of the team's round
 */
function findNextRoundMatches(
  roots: BracketNode[],
  myTeamId: number,
  playId: number,
  playName: string,
): NextRoundInfo[] {
  // Build a map of node key → { parent, rootIndex }, and collect all nodes
  const parentMap = new Map<number, { parent: BracketNode; rootIndex: number }>();
  const allNodes: { node: BracketNode; rootIndex: number }[] = [];

  function walkTree(node: BracketNode | null, parent: BracketNode | null, rootIdx: number) {
    if (!node) return;
    allNodes.push({ node, rootIndex: rootIdx });
    if (parent) parentMap.set(node.Key, { parent, rootIndex: rootIdx });
    walkTree(node.TopSource, node, rootIdx);
    walkTree(node.BottomSource, node, rootIdx);
  }
  for (let i = 0; i < roots.length; i++) {
    walkTree(roots[i], null, i);
  }

  // Find the node where the team has an ACTIVE match (not yet decided)
  let myNode: BracketNode | null = null;
  let myRootIndex = 0;
  for (const { node, rootIndex } of allNodes) {
    const m = node.Match;
    if (!m) continue;
    const isTeamInMatch =
      m.FirstTeam?.TeamId === myTeamId || m.SecondTeam?.TeamId === myTeamId;
    if (isTeamInMatch && !m.HasScores) {
      myNode = node;
      myRootIndex = rootIndex;
      break;
    }
  }

  if (!myNode) return [];

  const results: NextRoundInfo[] = [];

  // === WIN PATH: parent node in the main championship tree ===
  const parentEntry = parentMap.get(myNode.Key);
  // Accept parent from same root, OR from any root that is the championship tree
  // (i.e., the root that contains the most nodes — typically root 0)
  const parentNode = parentEntry ? parentEntry.parent : null;
  if (parentNode) {
    const parentMatch = parentNode.Match;
    if (parentMatch) {
      const siblingNode =
        parentNode.TopSource?.Key === myNode.Key
          ? parentNode.BottomSource
          : parentNode.TopSource;
      const opp = extractOpponentFromSibling(siblingNode, false);
      results.push({
        playId,
        playName,
        matchFullName: parentMatch.FullName || 'Next Round',
        potentialOpponentText: opp.text,
        potentialOpponentId: opp.id,
        potentialOpponentName: opp.name,
        scheduledStartDateTime: parentMatch.ScheduledStartDateTime,
        courtName: parentMatch.Court?.Name,
        outcome: 'win',
      });
    }
  }

  // === LOSS PATH: look for a separate root (bronze/consolation) that feeds from losers ===
  // The bronze/consolation root takes losers from the semi-finals.
  // We check all non-championship roots to see if they reference our round.
  const myRound = myNode.X;
  for (let ri = 0; ri < roots.length; ri++) {
    if (ri === myRootIndex) continue;
    const bronzeRoot = roots[ri];
    if (!bronzeRoot.Match) continue;

    // Check multiple levels: the bronze root may directly reference our round,
    // or its sources might be at our round level
    const topRound = bronzeRoot.TopSource?.X;
    const bottomRound = bronzeRoot.BottomSource?.X;

    // Also check if the bronze root's FullName suggests it's a consolation/bronze match
    const bronzeName = (bronzeRoot.Match.FullName || '').toLowerCase();
    const isBronzeLike = bronzeName.includes('bronze') || bronzeName.includes('3rd') ||
      bronzeName.includes('3/4') || bronzeName.includes('consolation') ||
      bronzeName.includes('third');

    if (topRound === myRound || bottomRound === myRound || isBronzeLike) {
      const bronzeMatch = bronzeRoot.Match;
      // Determine which source is "ours" (same Y position or key)
      const topIsOurs = bronzeRoot.TopSource?.Key === myNode.Key ||
        (bronzeRoot.TopSource?.X === myRound && bronzeRoot.TopSource?.Y === myNode.Y);
      const siblingForBronze = topIsOurs ? bronzeRoot.BottomSource : bronzeRoot.TopSource;

      const opp = extractOpponentFromSibling(siblingForBronze, true);
      results.push({
        playId,
        playName,
        matchFullName: bronzeMatch.FullName || 'Bronze Match',
        potentialOpponentText: opp.text,
        potentialOpponentId: opp.id,
        potentialOpponentName: opp.name,
        scheduledStartDateTime: bronzeMatch.ScheduledStartDateTime,
        courtName: bronzeMatch.Court?.Name,
        outcome: 'loss',
      });
      break;
    }
  }

  return results;
}

/** Walk a bracket tree to find a match by MatchId and extract opponent info */
function findOpponentInBracket(
  roots: BracketNode[],
  matchId: number,
  myTeamId: number
): OpponentInfo | null {
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.Match?.MatchId === matchId) {
      const m = node.Match;
      // Check FirstTeam
      if (m.FirstTeam?.TeamId === myTeamId && m.SecondTeam?.TeamId) {
        return {
          teamId: m.SecondTeam.TeamId,
          teamName: m.SecondTeam.TeamName || '',
          teamText: m.SecondTeamText || m.SecondTeam.TeamName || '',
        };
      }
      // Check SecondTeam
      if (m.SecondTeam?.TeamId === myTeamId && m.FirstTeam?.TeamId) {
        return {
          teamId: m.FirstTeam.TeamId,
          teamName: m.FirstTeam.TeamName || '',
          teamText: m.FirstTeamText || m.FirstTeam.TeamName || '',
        };
      }
      // Team IDs might not match directly — try text-based
      // If one side has a real team and the other is TBD/placeholder, show what we have
      if (m.FirstTeam?.TeamId && m.SecondTeam?.TeamId) {
        // Both teams assigned — figure out which is ours by text
        if (m.SecondTeam.TeamId !== myTeamId) {
          return {
            teamId: m.SecondTeam.TeamId,
            teamName: m.SecondTeam.TeamName || '',
            teamText: m.SecondTeamText || m.SecondTeam.TeamName || '',
          };
        }
        if (m.FirstTeam.TeamId !== myTeamId) {
          return {
            teamId: m.FirstTeam.TeamId,
            teamName: m.FirstTeam.TeamName || '',
            teamText: m.FirstTeamText || m.FirstTeam.TeamName || '',
          };
        }
      }
      // If only opponent text is available (no team object yet)
      if (m.FirstTeamText && m.SecondTeamText) {
        return null; // Both texts exist but no team IDs — can't scout
      }
      return null;
    }
    if (node.TopSource) stack.push(node.TopSource);
    if (node.BottomSource) stack.push(node.BottomSource);
  }
  return null;
}

export function NextDayScenarios({
  eventKey,
  divisionId,
  divisionName,
  teamId,
  myPoolShortName,
  myFinishRank,
  onViewBrackets,
  onScoutOpponent,
  playoffPlayIds,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TeamFutureScheduleRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Map of MatchId → OpponentInfo for bracket matches where opponent is known
  const [opponents, setOpponents] = useState<Map<number, OpponentInfo>>(new Map());
  // Next-round matches from active brackets
  const [nextRoundMatches, setNextRoundMatches] = useState<NextRoundInfo[]>([]);
  // Pool modal state
  const [poolModalVisible, setPoolModalVisible] = useState(false);
  const [poolModalName, setPoolModalName] = useState('');
  const [poolModalTeams, setPoolModalTeams] = useState<PoolTeam[]>([]);
  const [poolModalLoading, setPoolModalLoading] = useState(false);

  useEffect(() => {
    loadFutureSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventKey, divisionId, teamId, playoffPlayIds?.join(',')]);

  async function loadFutureSchedule() {
    setLoading(true);
    setError(null);
    try {
      const data = await getTeamFutureSchedule(eventKey, divisionId, teamId);
      setRows(data);

      // For each unique PlayId that has a NextMatch, fetch bracket details
      // to find known opponents
      const oppMap = new Map<number, OpponentInfo>();
      const seenPlayIds = new Set<number>();
      const playMatches: { playId: number; matchId: number }[] = [];

      for (const row of data) {
        if (row.NextPlay?.PlayId && row.NextMatch?.MatchId) {
          if (!seenPlayIds.has(row.NextPlay.PlayId)) {
            seenPlayIds.add(row.NextPlay.PlayId);
          }
          playMatches.push({
            playId: row.NextPlay.PlayId,
            matchId: row.NextMatch.MatchId,
          });
        }
      }

      // Fetch bracket details for each unique play
      const bracketCache = new Map<number, BracketNode[]>();
      for (const playId of seenPlayIds) {
        try {
          const detail = await getPlayDetail(eventKey, playId);
          if (detail?.Roots && detail.Roots.length > 0) {
            bracketCache.set(playId, detail.Roots);
          }
        } catch {
          // Skip — bracket data might not be available yet
        }
      }

      // Find opponents for each match
      for (const { playId, matchId } of playMatches) {
        const roots = bracketCache.get(playId);
        if (!roots) continue;
        const opp = findOpponentInBracket(roots, matchId, teamId);
        if (opp) {
          oppMap.set(matchId, opp);
        }
      }

      setOpponents(oppMap);

      // If team is in active brackets, find potential next-round matches
      if (playoffPlayIds && playoffPlayIds.length > 0) {
        const nextRounds: NextRoundInfo[] = [];
        for (const pid of playoffPlayIds) {
          // We may already have cached this bracket
          let roots = bracketCache.get(pid);
          if (!roots) {
            try {
              const detail = await getPlayDetail(eventKey, pid);
              if (detail?.Roots && detail.Roots.length > 0) {
                roots = detail.Roots;
              }
            } catch {
              // Skip
            }
          }
          if (!roots) continue;
          const playName =
            data.find((r) => r.NextPlay?.PlayId === pid)?.NextPlay?.FullName || '';
          const nrInfos = findNextRoundMatches(roots, teamId, pid, playName);
          nextRounds.push(...nrInfos);
        }
        setNextRoundMatches(nextRounds);
      } else {
        setNextRoundMatches([]);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load future schedule.');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.loadingText}>Looking up future matches...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <Card variant="outlined" style={styles.noData}>
        <Text style={styles.noDataTitle}>Future matches unavailable</Text>
        <Text style={styles.noDataHint}>{error}</Text>
      </Card>
    );
  }

  if (rows.length === 0 && nextRoundMatches.length === 0) {
    return (
      <Card variant="outlined" style={styles.noData}>
        <Text style={styles.noDataTitle}>
          No future matches posted yet.
        </Text>
        <Text style={styles.noDataHint}>
          Future {divisionName} matches will appear here once the bracket or next-day pools are published.
        </Text>
      </Card>
    );
  }

  const ordinal = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  return (
    <View>
      {/* Bracket next-round matches — win and loss paths */}
      {nextRoundMatches.length > 0 && (() => {
        const winMatches = nextRoundMatches.filter((nr) => nr.outcome === 'win');
        const lossMatches = nextRoundMatches.filter((nr) => nr.outcome === 'loss');

        function renderNextRoundCard(nr: NextRoundInfo, idx: number) {
          const isLoss = nr.outcome === 'loss';
          return (
            <TouchableOpacity
              key={`nr-${nr.outcome}-${idx}`}
              onPress={() => onViewBrackets?.(nr.playId)}
              disabled={!onViewBrackets}
              activeOpacity={onViewBrackets ? 0.6 : 1}
            >
              <Card
                variant="outlined"
                style={isLoss ? styles.lossPathCard : styles.nextRoundCard}
              >
                <View style={isLoss ? styles.lossPathBadge : styles.nextRoundBadge}>
                  <Text style={styles.nextRoundBadgeText}>
                    {isLoss ? 'BRONZE MATCH' : 'NEXT ROUND'}
                  </Text>
                </View>
                <Text style={styles.nextRoundMatchName}>{nr.matchFullName}</Text>
                <View style={styles.nextRoundOpponentRow}>
                  <Text style={styles.nextRoundVs}>vs </Text>
                  {nr.potentialOpponentId && onScoutOpponent ? (
                    <TouchableOpacity
                      onPress={() =>
                        onScoutOpponent!(
                          nr.potentialOpponentId!,
                          nr.potentialOpponentName || nr.potentialOpponentText
                        )
                      }
                      activeOpacity={0.6}
                    >
                      <Text style={styles.nextRoundOpponentLink}>
                        {nr.potentialOpponentText}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.nextRoundOpponentText}>
                      {nr.potentialOpponentText}
                    </Text>
                  )}
                </View>
                {nr.scheduledStartDateTime != null && (
                  <View style={styles.scenarioHeader}>
                    <Text style={styles.timeText}>
                      {formatDate(nr.scheduledStartDateTime)}{' '}
                      {formatTime(nr.scheduledStartDateTime)}
                    </Text>
                    {nr.courtName && (
                      <View style={styles.courtBadge}>
                        <Text style={styles.courtBadgeText}>{nr.courtName}</Text>
                      </View>
                    )}
                  </View>
                )}
                {onViewBrackets && (
                  <Text style={styles.bracketHint}>Tap to view bracket</Text>
                )}
              </Card>
            </TouchableOpacity>
          );
        }

        return (
          <View style={styles.nextRoundSection}>
            {winMatches.length > 0 && (
              <>
                <Text style={styles.nextRoundTitle}>If You Win...</Text>
                {winMatches.map((nr, idx) => renderNextRoundCard(nr, idx))}
              </>
            )}
            {lossMatches.length > 0 && (
              <>
                <Text style={styles.lossPathTitle}>If You Lose...</Text>
                {lossMatches.map((nr, idx) => renderNextRoundCard(nr, idx))}
              </>
            )}
          </View>
        );
      })()}

      {/* Pool finish scenarios */}
      {rows.length > 0 && (
      <Text style={styles.disclaimer}>
        Based on how you finish your current schedule.
      </Text>
      )}
      {rows.map((row) => {
        const rankHit = myFinishRank != null && myFinishRank === row.PotentialRank;
        const nextMatch = row.NextMatch;
        const nextPlay = row.NextPlay;
        const workMatch = row.WorkMatch;
        const opponent = nextMatch ? opponents.get(nextMatch.MatchId) : null;

        return (
          <Card
            key={`rank-${row.PotentialRank}`}
            variant="outlined"
            style={{
              ...styles.scenarioCard,
              ...(rankHit ? styles.scenarioCardHit : {}),
            }}
          >
            <View style={styles.ifRow}>
              <View
                style={[
                  styles.rankBadge,
                  rankHit && styles.rankBadgeHit,
                ]}
              >
                <Text
                  style={[
                    styles.rankBadgeText,
                    rankHit && styles.rankBadgeTextHit,
                  ]}
                >
                  {ordinal(row.PotentialRank)}
                </Text>
              </View>
              <Text style={styles.ifText}>
                If you finish {ordinal(row.PotentialRank)}
                {myPoolShortName ? ` in Pool ${myPoolShortName}` : ''}
              </Text>
            </View>

            {/* Next pool/bracket assignment — tappable */}
            {nextPlay && (() => {
              const isBracketPlay = nextPlay.Type === 1;
              const canTap = isBracketPlay ? !!onViewBrackets : true;
              const handlePlayPress = async () => {
                if (isBracketPlay) {
                  onViewBrackets?.(nextPlay.PlayId);
                } else {
                  // Pool play — fetch and show pool standings in modal
                  setPoolModalName(nextPlay.CompleteFullName || nextPlay.FullName);
                  setPoolModalTeams([]);
                  setPoolModalLoading(true);
                  setPoolModalVisible(true);
                  try {
                    const pool = await getPoolByPlayId(eventKey, divisionId, nextPlay.PlayId);
                    if (pool?.Teams) {
                      setPoolModalTeams(pool.Teams);
                    }
                  } catch {
                    // Pool data not available yet
                  } finally {
                    setPoolModalLoading(false);
                  }
                }
              };
              return (
                <TouchableOpacity
                  onPress={handlePlayPress}
                  disabled={!canTap}
                  activeOpacity={canTap ? 0.6 : 1}
                >
                  <Text
                    style={[
                      styles.nextPlayText,
                      canTap && styles.nextPlayTextLink,
                    ]}
                    numberOfLines={1}
                  >
                    {nextPlay.CompleteFullName || nextPlay.FullName}
                    {canTap ? '  >' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })()}

            {/* Known opponent from bracket */}
            {opponent && (
              <TouchableOpacity
                style={styles.opponentRow}
                onPress={() => onScoutOpponent?.(opponent.teamId, opponent.teamName || opponent.teamText)}
                disabled={!onScoutOpponent}
                activeOpacity={onScoutOpponent ? 0.6 : 1}
              >
                <Text style={styles.opponentLabel}>vs </Text>
                <Text
                  style={[
                    styles.opponentName,
                    onScoutOpponent && styles.opponentNameLink,
                  ]}
                  numberOfLines={1}
                >
                  {opponent.teamText || opponent.teamName}
                </Text>
                {onScoutOpponent && (
                  <Text style={styles.scoutTag}>Scout</Text>
                )}
              </TouchableOpacity>
            )}

            {/* Match time and court */}
            {nextMatch && (
              <View style={styles.scenarioHeader}>
                <Text style={styles.timeText}>
                  {formatDate(nextMatch.ScheduledStartDateTime)}{' '}
                  {formatTime(nextMatch.ScheduledStartDateTime)}
                </Text>
                {nextMatch.Court && (
                  <View style={styles.courtBadge}>
                    <Text style={styles.courtBadgeText}>
                      {nextMatch.Court.Name}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Work assignment */}
            {workMatch ? (
              <Text style={styles.workLine}>
                Work: {formatTime(workMatch.ScheduledStartDateTime)}{' '}
                {workMatch.Court?.Name || ''}
              </Text>
            ) : (
              <Text style={styles.workLine}>No Future Assignment</Text>
            )}
          </Card>
        );
      })}

      {/* Pool Standings Modal */}
      <Modal
        visible={poolModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPoolModalVisible(false)}
      >
        <View style={styles.poolModalContainer}>
          <View style={styles.poolModalHeader}>
            <TouchableOpacity onPress={() => setPoolModalVisible(false)}>
              <Text style={styles.poolModalClose}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.poolModalTitle} numberOfLines={1}>
              {poolModalName}
            </Text>
            <View style={{ width: 50 }} />
          </View>
          {poolModalLoading ? (
            <View style={styles.poolModalCentered}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>Loading pool...</Text>
            </View>
          ) : poolModalTeams.length > 0 ? (
            <ScrollView style={styles.poolModalScroll}>
              <View style={{ padding: spacing.lg }}>
                <PoolStandings
                  teams={poolModalTeams}
                  myTeamId={teamId}
                  onTeamPress={onScoutOpponent ? (id, name) => {
                    setPoolModalVisible(false);
                    onScoutOpponent!(id, name);
                  } : undefined}
                />
              </View>
              <View style={{ height: spacing.xxxl }} />
            </ScrollView>
          ) : (
            <View style={styles.poolModalCentered}>
              <Text style={styles.poolModalEmpty}>
                Pool standings are not available yet.{'\n'}
                They will appear once matches begin.
              </Text>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  loadingText: {
    marginLeft: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  scenarioCard: {
    marginBottom: spacing.sm,
  },
  scenarioCardHit: {
    borderColor: colors.accent,
    borderWidth: 2,
    backgroundColor: 'rgba(255,107,53,0.06)',
  },
  ifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  rankBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    marginRight: spacing.sm,
  },
  rankBadgeHit: {
    backgroundColor: colors.accent,
  },
  rankBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.primary,
  },
  rankBadgeTextHit: {
    color: colors.textOnPrimary,
  },
  ifText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  nextPlayText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  nextPlayTextLink: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  opponentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingVertical: spacing.xs,
  },
  opponentLabel: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  opponentName: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  opponentNameLink: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  scoutTag: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textOnPrimary,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
    marginLeft: spacing.sm,
  },
  scenarioHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  timeText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  courtBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  courtBadgeText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
  },
  workLine: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  disclaimer: {
    fontSize: fontSize.xs,
    color: colors.textLight,
    fontStyle: 'italic',
    marginBottom: spacing.sm,
  },
  nextRoundSection: {
    marginBottom: spacing.md,
  },
  nextRoundTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.accent,
    marginBottom: spacing.sm,
  },
  nextRoundCard: {
    marginBottom: spacing.sm,
    borderColor: colors.accent,
    borderWidth: 1.5,
    backgroundColor: 'rgba(255,107,53,0.04)',
  },
  nextRoundBadge: {
    backgroundColor: colors.accent,
    alignSelf: 'flex-start',
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginBottom: spacing.sm,
  },
  nextRoundBadgeText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.xs,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  nextRoundMatchName: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  nextRoundOpponentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  nextRoundVs: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  nextRoundOpponentText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  nextRoundOpponentLink: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  lossPathTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  lossPathCard: {
    marginBottom: spacing.sm,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: '#fafafa',
  },
  lossPathBadge: {
    backgroundColor: colors.textSecondary,
    alignSelf: 'flex-start',
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginBottom: spacing.sm,
  },
  bracketHint: {
    fontSize: fontSize.sm,
    color: colors.accent,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  poolModalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  poolModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  poolModalClose: {
    fontSize: fontSize.md,
    color: colors.primary,
    fontWeight: '600',
    width: 50,
  },
  poolModalTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
    textAlign: 'center',
  },
  poolModalScroll: {
    flex: 1,
  },
  poolModalCentered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  poolModalEmpty: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  noData: {
    padding: spacing.md,
  },
  noDataTitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  noDataHint: {
    fontSize: fontSize.sm,
    color: colors.textLight,
    marginTop: spacing.xs,
  },
});
