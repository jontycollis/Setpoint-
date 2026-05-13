// ── ColumnKey ─────────────────────────────────────────────────────────────
//
// Small "?" affordance + modal sheet that explains the abbreviated columns
// in the analytics tables. Used by StatsScreen, PlayerDetailScreen, and
// TournamentDetailScreen — every analytics surface that uses K / B / A /
// Ast / Set% / SO% / etc. should render a `<ColumnKey />` next to its
// kicker. Tap → glossary modal.
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';

interface KeyEntry {
  abbr: string;
  full: string;
  desc: string;
}

// Master glossary — covers every abbreviation used anywhere in the
// analytics surfaces. Keep in sync with the table headers in
// StatsScreen / PlayerDetailScreen / TournamentDetailScreen.
const GLOSSARY: KeyEntry[] = [
  { abbr: 'K', full: 'Kills', desc: 'Attack attempts that score' },
  { abbr: 'B', full: 'Blocks', desc: 'Kill blocks or assisted blocks' },
  { abbr: 'A', full: 'Aces', desc: 'Serves that score directly' },
  { abbr: 'Ast', full: 'Assists', desc: 'Sets that lead directly to a kill' },
  { abbr: 'D', full: 'Digs', desc: 'Defensive saves of attacks' },
  { abbr: 'Pass', full: 'Pass average', desc: 'Pass quality on a 0–3 scale; higher = better in-system passing' },
  { abbr: 'Err', full: 'Errors', desc: 'Any error attributed (serve, attack, etc.)' },
  { abbr: 'Pts', full: 'Total points', desc: 'Kills + blocks + aces — direct scoring contribution' },
  { abbr: 'Kill %', full: 'Kill percentage', desc: 'Kills ÷ attack attempts' },
  { abbr: 'M', full: 'Matches', desc: 'Matches the player appeared in' },
  { abbr: 'Set%', full: 'Set win %', desc: 'Sets won while on the floor ÷ total sets played' },
  { abbr: 'Rly%', full: 'Rally win %', desc: 'Rallies won while on the floor ÷ total rallies played' },
  { abbr: 'On', full: 'On-court rallies', desc: 'Number of rallies the player was on the floor' },
  { abbr: 'SO%', full: 'Side-out %', desc: 'Rallies won when receiving ÷ total receiving rallies (on-court)' },
  { abbr: 'SP%', full: 'Serve point %', desc: 'Rallies won when serving ÷ total serving rallies (on-court)' },
  { abbr: 'Rec', full: 'Receive rallies', desc: 'On-court rallies where the team was receiving' },
  { abbr: 'Srv', full: 'Serve rallies', desc: 'On-court rallies where the team was serving' },
  { abbr: 'Won', full: 'Personal serves won', desc: 'Rallies won during this player’s personal serve runs' },
  { abbr: 'Aces', full: 'Personal aces', desc: 'Aces from this player’s personal serves' },
  { abbr: 'Pt%', full: 'Personal serve point %', desc: 'Team rally wins during this player’s serve ÷ serves attempted' },
];

interface Props {
  /** Optional accessibility label override. Defaults to "Show column key". */
  label?: string;
}

export function ColumnKey({ label }: Props) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.btn}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={label ?? 'Show column key'}
      >
        <Text style={styles.btnGlyph}>?</Text>
        <Text style={styles.btnLabel}>Key</Text>
      </TouchableOpacity>
      <ColumnKeySheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

function ColumnKeySheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.panel}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Column key</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.close}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator
          >
            {GLOSSARY.map((e) => (
              <View key={e.abbr} style={styles.row}>
                <View style={styles.abbrChip}>
                  <Text style={styles.abbrText}>{e.abbr}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fullText}>{e.full}</Text>
                  <Text style={styles.descText}>{e.desc}</Text>
                </View>
              </View>
            ))}
            <Text style={styles.footnote}>
              Some tables show on-court splits (rallies the player was in the
              lineup), others show personal contribution (kills, aces, etc.).
              On-court % helps interpret per-player rate stats — players with
              very few rallies on court can swing wildly.
            </Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    btn: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: borderRadius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    btnGlyph: {
      fontSize: 11,
      fontWeight: '900',
      color: colors.primary,
      marginRight: 4,
    },
    btnLabel: {
      fontSize: 10,
      fontWeight: '800',
      color: colors.textSecondary,
      letterSpacing: 0.5,
    },

    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    panel: {
      maxHeight: '80%',
      backgroundColor: colors.surface,
      borderTopLeftRadius: borderRadius.lg,
      borderTopRightRadius: borderRadius.lg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    title: {
      fontSize: fontSize.lg,
      fontWeight: '800',
      color: colors.text,
    },
    close: {
      color: colors.primary,
      fontSize: fontSize.md,
      fontWeight: '700',
    },
    scroll: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.xxl,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    abbrChip: {
      minWidth: 56,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: borderRadius.sm,
      backgroundColor: colors.primaryLight,
      marginRight: spacing.md,
      alignItems: 'center',
    },
    abbrText: {
      fontSize: fontSize.sm,
      fontWeight: '800',
      color: colors.primary,
    },
    fullText: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    descText: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      marginTop: 2,
      lineHeight: 16,
    },
    footnote: {
      fontSize: fontSize.xs,
      color: colors.textLight,
      fontStyle: 'italic',
      marginTop: spacing.md,
      lineHeight: 16,
    },
  });
}
