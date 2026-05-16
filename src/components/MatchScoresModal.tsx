import React, { useEffect, useState, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import { getMatchResult } from '../api/aesClient';
import type { MatchResult, FlatCourtMatch } from '../api/aesClient';
import { formatTime, formatDate } from '../utils/dates';

interface Props {
  visible: boolean;
  onClose: () => void;
  match: FlatCourtMatch | null;
  eventKey: string;
  preloadedResult?: MatchResult | null;
  /** IANA tz used to render the start time. Optional — defaults to
   *  device-local (preserves prior behaviour for callers that haven't
   *  been migrated). */
  displayTz?: string;
}

export function MatchScoresModal({
  visible,
  onClose,
  match,
  eventKey,
  preloadedResult,
  displayTz,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MatchResult | null>(null);

  useEffect(() => {
    if (!visible || !match) return;
    if (preloadedResult !== undefined && preloadedResult !== null) {
      setResult(preloadedResult);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setResult(null);
    getMatchResult(eventKey, match.MatchId, match.Division?.DivisionId)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch(() => {
        if (!cancelled) setResult(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, match?.MatchId, eventKey]);

  if (!match) return null;

  const firstWon = result?.FirstTeamWon;
  const secondWon = result?.SecondTeamWon;
  const sets = (result?.Sets || []).filter(
    (s) => s.FirstTeamScore !== null || s.SecondTeamScore !== null
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.division} numberOfLines={1}>
              {match.Division?.Name || 'Match'}
            </Text>
            <Text style={styles.meta}>
              {formatDate(match.ScheduledStartDateTime, displayTz)}
              {'  •  '}
              {formatTime(match.ScheduledStartDateTime, displayTz)}
              {match.CourtName ? `  •  ${match.CourtName}` : ''}
            </Text>
          </View>

          {loading && (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>Loading scores...</Text>
            </View>
          )}

          {!loading && !result && (
            <View style={styles.loadingBox}>
              <Text style={styles.noScores}>Set scores not available.</Text>
              <Text style={styles.noScoresHint}>
                The match may not have been scored yet, or AES has not published
                set-level detail for this match.
              </Text>
            </View>
          )}

          {!loading && result && sets.length === 0 && (
            <View style={styles.loadingBox}>
              <Text style={styles.noScores}>No set scores recorded.</Text>
            </View>
          )}

          {!loading && result && sets.length > 0 && (
            <View style={styles.scoresSection}>
              <View style={styles.setsHeaderRow}>
                <View style={styles.teamNameCol} />
                {sets.map((_, i) => (
                  <Text key={`h-${i}`} style={styles.setHeader}>
                    S{i + 1}
                  </Text>
                ))}
              </View>

              <View
                style={[
                  styles.teamRow,
                  firstWon && styles.teamRowWinner,
                ]}
              >
                <View style={styles.teamNameCol}>
                  <Text
                    style={[
                      styles.teamName,
                      firstWon && styles.teamNameWinner,
                    ]}
                    numberOfLines={2}
                  >
                    {result.FirstTeamText || match.FirstTeamText}
                  </Text>
                  {firstWon && <Text style={styles.wonBadge}>WON</Text>}
                </View>
                {sets.map((s, i) => {
                  const won =
                    (s.FirstTeamScore ?? 0) > (s.SecondTeamScore ?? 0);
                  return (
                    <Text
                      key={`first-${i}`}
                      style={[
                        styles.setScore,
                        won ? styles.setWin : styles.setLoss,
                      ]}
                    >
                      {s.FirstTeamScore ?? '-'}
                    </Text>
                  );
                })}
              </View>

              <View
                style={[
                  styles.teamRow,
                  secondWon && styles.teamRowWinner,
                ]}
              >
                <View style={styles.teamNameCol}>
                  <Text
                    style={[
                      styles.teamName,
                      secondWon && styles.teamNameWinner,
                    ]}
                    numberOfLines={2}
                  >
                    {result.SecondTeamText || match.SecondTeamText}
                  </Text>
                  {secondWon && <Text style={styles.wonBadge}>WON</Text>}
                </View>
                {sets.map((s, i) => {
                  const won =
                    (s.SecondTeamScore ?? 0) > (s.FirstTeamScore ?? 0);
                  return (
                    <Text
                      key={`second-${i}`}
                      style={[
                        styles.setScore,
                        won ? styles.setWin : styles.setLoss,
                      ]}
                    >
                      {s.SecondTeamScore ?? '-'}
                    </Text>
                  );
                })}
              </View>
            </View>
          )}

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    padding: spacing.lg,
  },
  header: {
    marginBottom: spacing.md,
  },
  division: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  meta: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  loadingBox: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  noScores: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  noScoresHint: {
    fontSize: fontSize.sm,
    color: colors.textLight,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  scoresSection: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  setsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    marginBottom: spacing.sm,
  },
  setHeader: {
    width: 40,
    textAlign: 'center',
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textLight,
    letterSpacing: 0.5,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.xs,
  },
  teamRowWinner: {
    backgroundColor: 'rgba(52, 168, 83, 0.08)',
  },
  teamNameCol: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  teamName: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  teamNameWinner: {
    fontWeight: '700',
    color: colors.win,
  },
  wonBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.win,
    letterSpacing: 1,
    marginTop: 2,
  },
  setScore: {
    width: 40,
    textAlign: 'center',
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  setWin: { color: colors.win },
  setLoss: { color: colors.textLight },
  closeBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  closeBtnText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
});
}
