// ── AddTeamChooserScreen ──────────────────────────────────────────────────
//
// Tiny intermediate screen reached from the "+ Add team" CTA on
// MyHomeScreen. Two buttons:
//
//   AES tournament  → routes through TournamentSelect → EventEntry →
//                     DivisionSelect → TeamSelect → Set As My Team.
//                     The existing flow's "Set As My Team" now
//                     upserts a TeamProfile (Phase 2 wiring).
//
//   Timu tournament → routes through TimuManageSeason where the user
//                     pastes a Timu URL/tid → indexed → tap into
//                     tournament → tap their team → Set As My Team.
//                     Same upsert wiring lands them on Home with the
//                     team appended to MY TEAMS.
//
// The page itself is pure choice; the heavy lifting lives in those
// downstream flows. Two buttons + a back affordance is enough.
// ────────────────────────────────────────────────────────────────────────────

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { Card } from '../components/Card';
import { colors, spacing, fontSize, borderRadius } from '../utils/theme';

interface Props {
  onBack: () => void;
  onChooseAes: () => void;
  onChooseTimu: () => void;
}

export function AddTeamChooserScreen({
  onBack,
  onChooseAes,
  onChooseTimu,
}: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.heroBack}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.heroTitle}>Add a team</Text>
        <Text style={styles.heroSubtitle}>
          Where will you find your team?
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <ChoiceCard
          title="AES tournament"
          subtitle="Advanced Event Systems — most US tournaments and major Canadian events."
          hint="Pick a country, year, then your tournament. Find your team and tap 'Set As My Team'."
          accent={colors.primary}
          accentLabel="AES"
          onPress={onChooseAes}
        />
        <ChoiceCard
          title="Timu tournament"
          subtitle="OVA-hosted tournaments and most Ontario events."
          hint="Paste the Timu URL (or tid). Open the tournament, find your team, tap 'Set As My Team'."
          accent={colors.accent}
          accentLabel="TIMU"
          onPress={onChooseTimu}
        />
        <Card variant="outlined" style={styles.helpCard}>
          <Text style={styles.helpText}>
            Not sure which? AES events live at{' '}
            <Text style={styles.helpEm}>results.advancedeventsystems.com</Text>.
            Timu lives at <Text style={styles.helpEm}>timu.ca/scoreboards</Text>.
            If your team's URL matches one of those, that's the one.
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}

function ChoiceCard({
  title,
  subtitle,
  hint,
  accent,
  accentLabel,
  onPress,
}: {
  title: string;
  subtitle: string;
  hint: string;
  accent: string;
  accentLabel: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <Card style={styles.choiceCard}>
        <View style={styles.choiceHeader}>
          <View style={[styles.sourceBadge, { backgroundColor: accent }]}>
            <Text style={styles.sourceBadgeText}>{accentLabel}</Text>
          </View>
          <Text style={styles.choiceTitle}>{title}</Text>
        </View>
        <Text style={styles.choiceSubtitle}>{subtitle}</Text>
        <Text style={styles.choiceHint}>{hint}</Text>
        <View style={styles.choiceFooter}>
          <Text style={[styles.choiceCta, { color: accent }]}>Continue →</Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
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
  heroTitle: {
    color: colors.textOnPrimary,
    fontSize: fontSize.xxl,
    fontWeight: '800',
  },
  heroSubtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: fontSize.md,
    marginTop: 2,
  },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl },

  choiceCard: { marginBottom: spacing.md },
  choiceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  choiceTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  choiceSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  choiceHint: { fontSize: fontSize.xs, color: colors.textLight, lineHeight: 18 },
  choiceFooter: { marginTop: spacing.sm, alignItems: 'flex-end' },
  choiceCta: { fontSize: fontSize.sm, fontWeight: '700' },

  sourceBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    minWidth: 36,
    alignItems: 'center',
  },
  sourceBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  helpCard: { marginTop: spacing.md },
  helpText: { fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 18 },
  helpEm: { fontWeight: '700', color: colors.text },
});
