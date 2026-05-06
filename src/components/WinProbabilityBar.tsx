// ── WinProbabilityBar ──────────────────────────────────────────────────────
//
// Horizontal indicator showing the live probability of each team winning
// the CURRENT set. Used by both the Tier 1 hold-up scoreboard and the
// Tier 2 advanced-scoring screen. Both consume the same util
// (`computeSetWinProbability`) so the source of truth is shared.
//
// Layout: [home% label]  [home-colour fill ║ away-colour fill]  [away% label]
//
// The pivot point in the bar tracks the home win-probability, animated
// with `Animated.timing` (~250ms ease-out) on every score change. Match-
// point situations get a small "★" badge next to the corresponding
// percentage. When the set is over, the bar freezes at 100/0 for the
// winner until the next set's lineup events fire.
// ────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import {
  useTheme,
  spacing,
  fontSize,
  borderRadius,
} from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import {
  computeSetWinProbability,
  computeMatchPoint,
  type Side,
} from '../utils/winProbability';

export interface WinProbabilityBarProps {
  homeScore: number;
  awayScore: number;
  /** First-to-N for the current set (25 / 21 / 15 etc.). */
  target: number;
  /** Almost always 2. */
  winBy?: number;
  /** Side currently serving. Affects the per-rally probability. */
  server: Side;
  /** Number of sets each team has already won — used for match-point. */
  setsWonHome: number;
  setsWonAway: number;
  /** Sets needed to win the MATCH (best-of-3 → 2, best-of-5 → 3). */
  setsToWin: number;
  /** Team colours from the match meta. Defaults to theme primary/accent. */
  homeColor?: string;
  awayColor?: string;
  /** When true, the bar freezes at 100/0 for the side passed in `setWinner`.
   *  Used between sets and when the match is over. */
  setEnded?: boolean;
  setWinner?: Side | null;
  /** P(serving team wins a rally). Defaults to 0.55 per the article. */
  pServeAdvantage?: number;
  /** Compact mode shrinks paddings + font size for the Tier 1 layout
   *  where vertical space is at a premium. */
  compact?: boolean;
}

export function WinProbabilityBar({
  homeScore,
  awayScore,
  target,
  winBy = 2,
  server,
  setsWonHome,
  setsWonAway,
  setsToWin,
  homeColor,
  awayColor,
  setEnded = false,
  setWinner = null,
  pServeAdvantage,
  compact = false,
}: WinProbabilityBarProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors, compact), [colors, compact]);
  const homeC = homeColor ?? colors.primary;
  const awayC = awayColor ?? colors.accent;

  // Compute probability + set-point flags. Pure recursion, fast in
  // practice (target² memo entries, ~625 for indoor).
  const prob = useMemo(
    () =>
      computeSetWinProbability({
        homeScore,
        awayScore,
        target,
        winBy,
        server,
        pServeAdvantage,
      }),
    [homeScore, awayScore, target, winBy, server, pServeAdvantage]
  );

  // Match-point detection layered on top of set-point.
  const mp = useMemo(
    () =>
      computeMatchPoint({
        setsWonHome,
        setsWonAway,
        setsToWin,
        homeSetPoint: prob.homeSetPoint,
        awaySetPoint: prob.awaySetPoint,
      }),
    [setsWonHome, setsWonAway, setsToWin, prob.homeSetPoint, prob.awaySetPoint]
  );

  // Freeze at 100/0 when the set has ended (either side won).
  const targetPct = setEnded
    ? setWinner === 'home'
      ? 1
      : setWinner === 'away'
      ? 0
      : 0.5
    : prob.pHomeWins;

  // Animate the bar fill — width transitions smoothly on each point.
  // useNativeDriver:false because we're animating a percentage-string
  // width, which the native driver doesn't support.
  const animated = useRef(new Animated.Value(targetPct)).current;
  useEffect(() => {
    Animated.timing(animated, {
      toValue: targetPct,
      duration: 250,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [targetPct, animated]);

  const homeFillWidth = animated.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const homePctText = `${Math.round(prob.pHomeWins * 100)}%`;
  const awayPctText = `${Math.round((1 - prob.pHomeWins) * 100)}%`;

  return (
    <View style={styles.container} accessibilityLabel={`Win probability: home ${homePctText}, away ${awayPctText}`}>
      <View style={styles.endLabel}>
        <Text style={[styles.pct, { color: homeC }]} numberOfLines={1}>
          {homePctText}
        </Text>
        {mp.homeMatchPoint ? <Text style={styles.starBadge}>★</Text> : null}
      </View>
      <View style={styles.barTrack}>
        {/* Background = away colour fills the entire track. */}
        <View style={[styles.fill, { backgroundColor: awayC }]} />
        {/* Foreground = home colour fills from the left up to pHome%. */}
        <Animated.View
          style={[
            styles.fill,
            { backgroundColor: homeC, width: homeFillWidth },
          ]}
        />
      </View>
      <View style={styles.endLabel}>
        {mp.awayMatchPoint ? <Text style={styles.starBadge}>★</Text> : null}
        <Text style={[styles.pct, { color: awayC }]} numberOfLines={1}>
          {awayPctText}
        </Text>
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors, compact: boolean) {
  const trackHeight = compact ? 8 : 10;
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: compact ? 4 : 6,
    },
    endLabel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      minWidth: 44,
    },
    pct: {
      fontSize: compact ? fontSize.xs : fontSize.sm,
      fontWeight: '900',
      letterSpacing: 0.5,
    },
    barTrack: {
      flex: 1,
      height: trackHeight,
      borderRadius: borderRadius.full,
      overflow: 'hidden',
      backgroundColor: colors.border,
      position: 'relative',
    },
    fill: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      // Away fill (no width specified) covers the full track.
      // Home fill (width animated) overlays from the left.
      width: '100%',
    },
    starBadge: {
      fontSize: compact ? fontSize.xs : fontSize.sm,
      color: colors.warning ?? '#f5a623',
      fontWeight: '900',
    },
  });
}
