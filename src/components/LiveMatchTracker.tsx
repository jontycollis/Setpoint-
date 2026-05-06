/**
 * LiveMatchTracker — real-time set score tracking during an active match.
 * AES doesn't expose point-by-point data, so this polls for set score updates
 * at a faster interval (30s) during live matches, showing scores as they come in.
 */
import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  AppState,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import { getTeamCurrentSchedule, extractAllScheduleMatches } from '../api/aesClient';
import type { EnrichedScheduleMatch } from '../api/aesClient';

interface Props {
  eventKey: string;
  divisionId: number;
  teamId: number;
  matchId: number;
  teamName: string;
  opponentName: string;
}

export function LiveMatchTracker({
  eventKey,
  divisionId,
  teamId,
  matchId,
  teamName,
  opponentName,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [match, setMatch] = useState<EnrichedScheduleMatch | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulsing dot animation
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  // Fast polling (30s) for live score updates
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let active = true;

    async function fetchLatest() {
      try {
        const sched = await getTeamCurrentSchedule(eventKey, divisionId, teamId);
        const all = extractAllScheduleMatches(sched, []);
        const found = all.find((m) => m.MatchId === matchId);
        if (found && active) {
          setMatch(found);
          setLastUpdate(Date.now());
        }
      } catch {
        // ignore
      }
    }

    fetchLatest();
    interval = setInterval(fetchLatest, 30_000);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') fetchLatest();
    });

    return () => {
      active = false;
      if (interval) clearInterval(interval);
      sub.remove();
    };
  }, [eventKey, divisionId, teamId, matchId]);

  if (!match) return null;

  const isFirst = match.FirstTeamId === teamId;
  const sets = match.Sets?.filter((s) => s.FirstTeamScore != null) || [];
  const isComplete = match.HasScores || match.FirstTeamWon || match.SecondTeamWon;
  const iWon = isFirst ? match.FirstTeamWon : match.SecondTeamWon;

  let mySetsWon = 0;
  let oppSetsWon = 0;
  for (const s of sets) {
    const my = (isFirst ? s.FirstTeamScore : s.SecondTeamScore) ?? 0;
    const opp = (isFirst ? s.SecondTeamScore : s.FirstTeamScore) ?? 0;
    if (my > opp) mySetsWon++;
    else if (opp > my) oppSetsWon++;
  }

  return (
    <View style={[styles.container, isComplete && styles.containerComplete]}>
      {/* Live indicator */}
      <View style={styles.liveRow}>
        {!isComplete && (
          <Animated.View style={[styles.liveDot, { opacity: pulseAnim }]} />
        )}
        <Text style={isComplete ? styles.completeLabel : styles.liveLabel}>
          {isComplete ? (iWon ? 'MATCH WON' : 'MATCH LOST') : 'LIVE'}
        </Text>
      </View>

      {/* Team names and sets */}
      <View style={styles.scoreBoard}>
        <View style={styles.teamRow}>
          <Text style={[styles.teamText, styles.myTeamText]} numberOfLines={1}>
            {teamName}
          </Text>
          <Text style={styles.setsText}>{mySetsWon}</Text>
        </View>
        <View style={styles.teamRow}>
          <Text style={styles.teamText} numberOfLines={1}>
            {opponentName}
          </Text>
          <Text style={styles.setsText}>{oppSetsWon}</Text>
        </View>
      </View>

      {/* Individual set scores */}
      {sets.length > 0 && (
        <View style={styles.setsDetail}>
          {sets.map((s, idx) => {
            const my = (isFirst ? s.FirstTeamScore : s.SecondTeamScore) ?? 0;
            const opp = (isFirst ? s.SecondTeamScore : s.FirstTeamScore) ?? 0;
            const won = my > opp;
            return (
              <View key={idx} style={styles.setItem}>
                <Text style={styles.setLabel}>S{idx + 1}</Text>
                <Text style={[styles.setScore, won ? styles.setWon : styles.setLost]}>
                  {my}-{opp}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Update time */}
      <Text style={styles.updateTime}>
        Updated {Math.round((Date.now() - lastUpdate) / 1000)}s ago
      </Text>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: {
    backgroundColor: 'rgba(76, 175, 80, 0.08)',
    borderRadius: borderRadius.md,
    borderWidth: 2,
    borderColor: '#4CAF50',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  containerComplete: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f44336',
    marginRight: spacing.xs,
  },
  liveLabel: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    color: '#f44336',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  completeLabel: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  scoreBoard: {
    marginBottom: spacing.sm,
  },
  teamRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  teamText: {
    fontSize: fontSize.md,
    color: colors.text,
    flex: 1,
  },
  myTeamText: {
    fontWeight: '800',
  },
  setsText: {
    fontSize: fontSize.xxl,
    fontWeight: '900',
    color: colors.text,
    width: 32,
    textAlign: 'center',
  },
  setsDetail: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  setItem: {
    alignItems: 'center',
  },
  setLabel: {
    fontSize: fontSize.xs,
    color: colors.textLight,
    fontWeight: '600',
  },
  setScore: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  setWon: {
    color: colors.win,
  },
  setLost: {
    color: colors.loss,
  },
  updateTime: {
    fontSize: fontSize.xs,
    color: colors.textLight,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
}
