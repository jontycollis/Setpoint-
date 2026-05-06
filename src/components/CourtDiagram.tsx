// ── CourtDiagram ───────────────────────────────────────────────────────────
//
// Read-only 6-position court grid showing the team's current rotation
// with libero indicator and serve marker. Used by the Tier 2 scoring
// screen's "▦ Court" modal so the scorer can verify rotation matches
// the floor without a paper diagram.
//
// In Session B this is presentational only — Session C makes positions
// tappable for substitutions / sanctions / libero swaps.
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  useTheme,
  spacing,
  fontSize,
  borderRadius,
} from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { Lineup, RotationState, RosterPlayer } from '../types/match';

interface Props {
  /** Team label for the header strip. */
  teamLabel: string;
  /** Team accent colour (jersey colour). */
  teamColor: string;
  rotation: RotationState;
  /** True if this team currently has the serve. Highlights position I. */
  isServing: boolean;
  /** Roster snapshot from Match.rosters[side] — used to look up names. */
  roster: RosterPlayer[];
}

const POSITION_LABELS: Record<number, string> = {
  0: 'IV',
  1: 'III',
  2: 'II',
  3: 'V',
  4: 'VI',
  5: 'I',
};

// Top row of the on-screen grid is the front row (positions IV, III, II).
// Bottom row is back row (V, VI, I). Position I lives at bottom-right
// so the "server in I" affordance is visually obvious — top-right of
// the back row, mirroring the right-back court position.
const FRONT_ROW_INDICES = [3, 2, 1]; // IV, III, II
const BACK_ROW_INDICES = [4, 5, 0]; // V, VI, I

export function CourtDiagram({
  teamLabel,
  teamColor,
  rotation,
  isServing,
  roster,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  function nameFor(shirt: number): string {
    const p = roster.find((r) => r.shirt === shirt);
    return p?.name ?? '';
  }

  const liberoOnFloor = rotation.liberoOnFloor;

  function PositionCell({ idx }: { idx: number }) {
    const shirt = rotation.positions[idx];
    const isLibero = liberoOnFloor != null && shirt === liberoOnFloor;
    const isServer = isServing && idx === 0; // position I = index 0
    return (
      <View
        style={[
          styles.cell,
          isServer && {
            borderColor: teamColor,
            borderWidth: 3,
          },
          isLibero && { backgroundColor: colors.primaryLight },
        ]}
      >
        <Text style={styles.positionLabel}>{POSITION_LABELS[idx]}</Text>
        <Text style={styles.shirt} numberOfLines={1}>
          #{shirt}
          {isLibero ? ' L' : ''}
        </Text>
        {nameFor(shirt) ? (
          <Text style={styles.name} numberOfLines={1}>
            {nameFor(shirt)}
          </Text>
        ) : null}
        {isServer ? <Text style={styles.serveBadge}>🏐</Text> : null}
      </View>
    );
  }

  return (
    <View style={[styles.container, { borderTopColor: teamColor }]}>
      <View style={styles.header}>
        <View style={[styles.colorChip, { backgroundColor: teamColor }]} />
        <Text style={styles.teamLabel} numberOfLines={1}>
          {teamLabel}
        </Text>
        {isServing ? (
          <Text style={styles.servingBadge}>🏐 serving</Text>
        ) : (
          <Text style={styles.receivingBadge}>receiving</Text>
        )}
      </View>

      <View style={styles.netLabel}>
        <Text style={styles.netText}>NET</Text>
      </View>

      <View style={styles.row}>
        {FRONT_ROW_INDICES.map((i) => (
          <PositionCell key={`f${i}`} idx={i} />
        ))}
      </View>
      <View style={styles.row}>
        {BACK_ROW_INDICES.map((i) => (
          <PositionCell key={`b${i}`} idx={i} />
        ))}
      </View>

      {rotation.liberos.length > 0 ? (
        <View style={styles.liberoStrip}>
          <Text style={styles.liberoStripLabel}>Liberos:</Text>
          {rotation.liberos.map((shirt) => {
            const onFloor = shirt === liberoOnFloor;
            return (
              <View
                key={shirt}
                style={[
                  styles.liberoChip,
                  onFloor && { backgroundColor: teamColor },
                ]}
              >
                <Text
                  style={[
                    styles.liberoChipText,
                    onFloor && { color: '#ffffff' },
                  ]}
                >
                  #{shirt} {onFloor ? '(on)' : '(bench)'}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {rotation.lockedOut.length > 0 ? (
        <Text style={styles.lockedOut}>
          Locked out this set: {rotation.lockedOut.map((s) => `#${s}`).join(', ')}
        </Text>
      ) : null}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      borderTopWidth: 4,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    colorChip: {
      width: 14,
      height: 14,
      borderRadius: 7,
    },
    teamLabel: {
      flex: 1,
      fontSize: fontSize.lg,
      fontWeight: '800',
      color: colors.text,
    },
    servingBadge: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.success,
    },
    receivingBadge: {
      fontSize: fontSize.xs,
      fontWeight: '600',
      color: colors.textLight,
      fontStyle: 'italic',
    },
    netLabel: {
      paddingVertical: 4,
      backgroundColor: colors.primary,
      borderTopLeftRadius: borderRadius.sm,
      borderTopRightRadius: borderRadius.sm,
      alignItems: 'center',
    },
    netText: {
      color: colors.textOnPrimary,
      fontSize: fontSize.xs,
      fontWeight: '800',
      letterSpacing: 2,
    },
    row: {
      flexDirection: 'row',
    },
    cell: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.sm,
      minHeight: 72,
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    positionLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.textLight,
      letterSpacing: 1,
    },
    shirt: {
      fontSize: fontSize.lg,
      fontWeight: '800',
      color: colors.text,
      marginTop: 2,
    },
    name: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      marginTop: 1,
    },
    serveBadge: {
      position: 'absolute',
      top: 4,
      right: 4,
      fontSize: 14,
    },
    liberoStrip: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 6,
      marginTop: spacing.sm,
    },
    liberoStripLabel: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    liberoChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: borderRadius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    liberoChipText: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.text,
    },
    lockedOut: {
      marginTop: spacing.sm,
      fontSize: fontSize.xs,
      color: colors.error,
      fontStyle: 'italic',
    },
  });
}
