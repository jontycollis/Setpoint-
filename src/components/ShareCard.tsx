import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Share } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../utils/theme';

interface SetScore {
  FirstTeamScore: number | null;
  SecondTeamScore: number | null;
}

interface Props {
  teamName: string;
  clubName: string;
  divisionName: string;
  eventName: string;
  opponentName: string;
  won: boolean;
  sets: SetScore[];
  isFirst: boolean; // is our team the "first" team in the match
  matchLabel?: string; // "Pool A", "Gold Semi", etc.
  medalEmoji?: string;
  medalLabel?: string;
  onClose: () => void;
}

export function ShareCard({
  teamName,
  clubName,
  divisionName,
  eventName,
  opponentName,
  won,
  sets,
  isFirst,
  matchLabel,
  medalEmoji,
  medalLabel,
  onClose,
}: Props) {
  // Build set scores
  const setScores = sets
    .filter((s) => s.FirstTeamScore != null)
    .map((s) => {
      const my = isFirst ? s.FirstTeamScore : s.SecondTeamScore;
      const opp = isFirst ? s.SecondTeamScore : s.FirstTeamScore;
      return { my: my ?? 0, opp: opp ?? 0 };
    });

  const setsWon = setScores.filter((s) => s.my > s.opp).length;
  const setsLost = setScores.filter((s) => s.opp > s.my).length;

  const shareMessage = () => {
    const result = won ? 'won' : 'lost';
    const setStr = setScores.map((s) => `${s.my}-${s.opp}`).join(', ');
    const context = matchLabel ? ` in ${matchLabel}` : '';
    const medal = medalLabel ? ` ${medalEmoji} ${medalLabel}!` : '';
    const msg = `${teamName} ${result} vs ${opponentName}${context}${setStr ? ` (${setStr})` : ''}${medal}\n\n${divisionName} — ${eventName}\n\nTracked with SetPoint`;
    Share.share({ message: msg });
  };

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        {/* Header stripe */}
        <View style={[styles.header, won ? styles.headerWin : styles.headerLoss]}>
          <Text style={styles.resultText}>{won ? 'VICTORY' : 'DEFEAT'}</Text>
          {medalEmoji && medalLabel && (
            <Text style={styles.medalText}>{medalEmoji} {medalLabel}</Text>
          )}
        </View>

        {/* Team info */}
        <View style={styles.body}>
          <Text style={styles.teamName}>{teamName}</Text>
          <Text style={styles.clubText}>{clubName}</Text>

          {matchLabel && (
            <View style={styles.matchLabelBadge}>
              <Text style={styles.matchLabelText}>{matchLabel}</Text>
            </View>
          )}

          <Text style={styles.vsText}>vs</Text>
          <Text style={styles.opponentName}>{opponentName}</Text>

          {/* Score display */}
          <View style={styles.scoreSection}>
            <Text style={styles.setsResult}>{setsWon} — {setsLost}</Text>
            <Text style={styles.setsLabel}>SETS</Text>
            <View style={styles.setScoresRow}>
              {setScores.map((s, i) => (
                <View
                  key={i}
                  style={[
                    styles.setScoreBubble,
                    s.my > s.opp ? styles.setWon : styles.setLost,
                  ]}
                >
                  <Text style={styles.setScoreText}>{s.my}-{s.opp}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Event context */}
          <Text style={styles.eventText}>{divisionName}</Text>
          <Text style={styles.eventSubText}>{eventName}</Text>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.shareBtn} onPress={shareMessage}>
            <Text style={styles.shareBtnText}>Share Result</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
    padding: spacing.xl,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.lg,
    width: '100%',
    maxWidth: 360,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 12,
  },
  header: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  headerWin: {
    backgroundColor: '#2E7D32',
  },
  headerLoss: {
    backgroundColor: '#C62828',
  },
  resultText: {
    fontSize: fontSize.xxxl,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 3,
  },
  medalText: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: '#ffffff',
    marginTop: spacing.xs,
  },
  body: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  teamName: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  clubText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  matchLabelBadge: {
    backgroundColor: colors.accentLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    marginBottom: spacing.md,
  },
  matchLabelText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.accent,
  },
  vsText: {
    fontSize: fontSize.sm,
    color: colors.textLight,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  opponentName: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  scoreSection: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  setsResult: {
    fontSize: 40,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: 4,
  },
  setsLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textLight,
    letterSpacing: 2,
    marginBottom: spacing.sm,
  },
  setScoresRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  setScoreBubble: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  setWon: {
    backgroundColor: 'rgba(46, 125, 50, 0.12)',
  },
  setLost: {
    backgroundColor: 'rgba(198, 40, 40, 0.12)',
  },
  setScoreText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
  },
  eventText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  eventSubText: {
    fontSize: fontSize.xs,
    color: colors.textLight,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  shareBtn: {
    flex: 1,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: colors.divider,
  },
  shareBtnText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.primary,
  },
  closeBtn: {
    flex: 1,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
