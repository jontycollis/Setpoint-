// ── StorageSnapshotScreen ─────────────────────────────────────────────────
//
// Lists pre-migration AsyncStorage snapshots and lets the user restore
// from one. Snapshots are taken on every cold-start (see
// `runPreMigrationSnapshotOnce` in App.tsx) and pruned to the most
// recent two so the disk footprint stays small.
//
// Restore is blocked while a Tier 2 match is in progress — overwriting
// `scored.matches.v1` mid-game would clobber unsaved events.
// ────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import {
  listSnapshots,
  restoreSnapshot,
  type SnapshotInfo,
} from '../utils/storageSnapshot';
import { loadMatches } from '../utils/scoredMatchStore';

interface Props {
  onBack: () => void;
}

export function StorageSnapshotScreen({ onBack }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [matchInProgress, setMatchInProgress] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [snaps, matches] = await Promise.all([
        listSnapshots(),
        loadMatches(),
      ]);
      setSnapshots(snaps);
      setMatchInProgress(matches.some((m) => m.status === 'in-progress'));
    } catch (err: any) {
      Alert.alert(
        'Could not load snapshots',
        err?.message || 'An unknown error occurred.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function onTapSnapshot(snap: SnapshotInfo) {
    const dateStr = formatTakenAt(snap.takenAt);
    Alert.alert(
      `Restore from ${dateStr}?`,
      'This will overwrite current data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: async () => {
            try {
              await restoreSnapshot(snap.key);
              Alert.alert(
                'Restore complete',
                'Please restart the app to see the previous state.'
              );
            } catch (err: any) {
              Alert.alert(
                'Restore failed',
                err?.message || 'An unknown error occurred.'
              );
            }
          },
        },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <Hero onBack={onBack} colors={colors} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {loading ? (
          <View style={styles.centeredBlock}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : matchInProgress ? (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyTitle}>Restore unavailable</Text>
            <Text style={styles.emptyBody}>
              A match is currently in progress. Finish or end the match
              before restoring from a backup, since restoring would
              overwrite the current match's events.
            </Text>
          </View>
        ) : snapshots.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyTitle}>No backups yet</Text>
            <Text style={styles.emptyBody}>
              Backups are taken automatically each time the app starts.
              Open the app on a fresh launch to create your first one.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.intro}>
              Tap a backup to restore. The app keeps the two most recent
              snapshots — older ones are pruned automatically.
            </Text>
            {snapshots.map((snap) => (
              <TouchableOpacity
                key={snap.key}
                style={styles.card}
                activeOpacity={0.7}
                onPress={() => onTapSnapshot(snap)}
              >
                <Text style={styles.cardTitle}>
                  {formatTakenAt(snap.takenAt)}
                </Text>
                <Text style={styles.cardMeta}>
                  {formatBytes(snap.totalBytes)}
                </Text>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Hero({
  onBack,
  colors,
}: {
  onBack: () => void;
  colors: ThemeColors;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.hero}>
      <TouchableOpacity
        onPress={onBack}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.heroBack}>{'< Back'}</Text>
      </TouchableOpacity>
      <Text style={styles.heroKicker}>SETTINGS</Text>
      <Text style={styles.heroTitle}>Restore from backup</Text>
    </View>
  );
}

function formatTakenAt(ms: number): string {
  if (!ms) return 'Unknown date';
  const d = new Date(ms);
  return d.toLocaleString();
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    hero: {
      backgroundColor: colors.primary,
      padding: spacing.xxl,
      paddingBottom: spacing.lg,
    },
    heroBack: {
      color: 'rgba(255,255,255,0.9)',
      fontSize: fontSize.md,
      fontWeight: '600',
      marginBottom: spacing.sm,
    },
    heroKicker: {
      color: 'rgba(255,255,255,0.7)',
      fontSize: fontSize.xs,
      fontWeight: '700',
      letterSpacing: 1,
    },
    heroTitle: {
      color: colors.textOnPrimary,
      fontSize: fontSize.xxl,
      fontWeight: '800',
    },
    scrollContent: {
      padding: spacing.lg,
    },
    centeredBlock: {
      paddingVertical: spacing.xxl,
      alignItems: 'center',
    },
    emptyBlock: {
      padding: spacing.xl,
      alignItems: 'center',
    },
    emptyTitle: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: colors.text,
      marginBottom: spacing.sm,
      textAlign: 'center',
    },
    emptyBody: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
    },
    intro: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      marginBottom: spacing.lg,
      lineHeight: 20,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      padding: spacing.lg,
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardTitle: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.text,
      marginBottom: spacing.xs,
    },
    cardMeta: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
    },
  });
}
