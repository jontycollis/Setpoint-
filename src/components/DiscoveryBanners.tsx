// ── Discovery banners ─────────────────────────────────────────────────────
//
// In-flight progress + post-completion result banners shared between
// MyHomeScreen and SeasonHistoryScreen so the user sees the same status
// regardless of which screen they triggered the auto-discovery from.
//
// State lives in App.tsx; both screens receive the same props and decide
// whether to render. We render here, not at the App-level, so each
// screen keeps the banner inside its scroll area (the hero / back button
// stays at the top).
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import {
  useTheme,
  spacing,
  fontSize,
  borderRadius,
} from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { AutoDiscoverProgress } from '../utils/teamAutoDiscover';

export function DiscoveryProgressBanner({
  teamLabel,
  progress,
}: {
  teamLabel: string;
  progress: AutoDiscoverProgress | null;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const phaseLabel = (() => {
    if (!progress) return 'Searching tournaments…';
    switch (progress.phase) {
      case 'starting':
        return 'Starting search…';
      case 'aes-scan':
        return progress.total > 0
          ? `Scanning AES events… ${progress.done}/${progress.total}`
          : 'Scanning AES events…';
      case 'aes-index':
        return 'Indexing AES results…';
      case 'timu-scan':
        return progress.total > 0
          ? `Scanning Timu… ${progress.done}/${progress.total}`
          : 'Scanning Timu…';
      case 'timu-index':
        return progress.total > 0
          ? `Indexing Timu… ${progress.done}/${progress.total}`
          : 'Indexing Timu…';
      case 'done':
        return progress.matched > 0
          ? `Found ${progress.matched} tournaments`
          : 'Done';
      default:
        return 'Searching tournaments…';
    }
  })();
  return (
    <View style={styles.progressRow}>
      <ActivityIndicator size="small" color={colors.primary} />
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        <Text style={styles.progressTitle} numberOfLines={1}>
          Searching for {teamLabel}
        </Text>
        <Text style={styles.progressSub} numberOfLines={1}>
          {phaseLabel}
          {progress && progress.matched > 0
            ? ` · ${progress.matched} matched`
            : ''}
        </Text>
      </View>
    </View>
  );
}

export function DiscoveryResultBanner({
  result,
  onView,
  onDismiss,
}: {
  result: { teamLabel: string; aesIndexed: number; timuIndexed: number };
  onView?: () => void;
  onDismiss?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const total = result.aesIndexed + result.timuIndexed;
  const summary =
    total === 0
      ? `No new tournaments found for ${result.teamLabel}. The team may not have AES or Timu data this season yet.`
      : `Found ${total} tournament${total === 1 ? '' : 's'} for ${result.teamLabel} ` +
        `(${result.aesIndexed} AES · ${result.timuIndexed} Timu). Tap to view.`;
  return (
    <View style={styles.resultRow}>
      <Text style={styles.resultIcon}>{total > 0 ? '✓' : 'ⓘ'}</Text>
      <TouchableOpacity
        style={styles.resultMain}
        onPress={total > 0 ? onView : undefined}
        activeOpacity={total > 0 ? 0.6 : 1}
        disabled={total === 0}
      >
        <Text style={styles.resultText}>{summary}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.resultDismiss}
        onPress={onDismiss}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.resultDismissText}>{'✕'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.primaryLight,
    borderRadius: borderRadius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  progressTitle: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  progressSub: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.primaryLight,
    borderRadius: borderRadius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.success,
  },
  resultIcon: {
    color: colors.success,
    fontSize: fontSize.lg,
    fontWeight: '800',
    marginRight: spacing.sm,
  },
  resultMain: { flex: 1 },
  resultText: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: 18,
  },
  resultDismiss: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginLeft: spacing.sm,
  },
  resultDismissText: {
    color: colors.textLight,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
});
}
