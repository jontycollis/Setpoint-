// ── AddTeamChooserScreen ──────────────────────────────────────────────────
//
// Reached from the "+ Add team" CTA on MyHome. Three options:
//
//   1. **Find your OVA team** (primary) → OVA Rankings screen.
//      Tap a row → confirm follow → app creates a TeamProfile and
//      kicks off the auto-discovery scan that finds the team's AES +
//      Timu tournaments by name. This is the path most users want.
//
//   2. AES tournament (secondary) → TournamentSelect → EventEntry →
//      DivisionSelect → TeamSelect → Set As My Team. Use case:
//      Ontario teams travelling to US AES events whose name doesn't
//      match an OVA ranking.
//
//   3. Timu tournament (secondary) → AddTournaments where the user
//      pastes a Timu URL/tid. Use case: niche Timu tournaments not
//      auto-discovered by the OVA path.
//
// Forward-looking: this screen is also the natural home for a future
// "pick team roster from a tournament for a scoring session" affordance
// (filter by match type / competition / stage), per Jon's note.
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { Card } from '../components/Card';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';

interface Props {
  onBack: () => void;
  onChooseOvaRankings: () => void;
  onChooseAes: () => void;
  onChooseTimu: () => void;
}

export function AddTeamChooserScreen({
  onBack,
  onChooseOvaRankings,
  onChooseAes,
  onChooseTimu,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
          Pick your team from the OVA rankings — the rest is automatic.
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {/* Primary — featured */}
        <FeaturedCard
          title="Find your OVA team"
          subtitle="Recommended"
          body="Browse the OVA rankings by gender and age group, then tap your team. We'll search AES and Timu for their tournaments automatically."
          accent={colors.primary}
          onPress={onChooseOvaRankings}
        />

        <Text style={styles.sectionLabel}>OR ADD ANOTHER WAY</Text>

        <ChoiceCard
          title="AES tournament"
          subtitle="For US events or Canadian tournaments not yet in OVA rankings — paste the AES event."
          accent={colors.primary}
          accentLabel="AES"
          onPress={onChooseAes}
        />
        <ChoiceCard
          title="Timu tournament"
          subtitle="For Timu tournaments outside the OVA rankings system — paste the URL or tid."
          accent={colors.accent}
          accentLabel="TIMU"
          onPress={onChooseTimu}
        />
      </ScrollView>
    </View>
  );
}

function FeaturedCard({
  title,
  subtitle,
  body,
  accent,
  onPress,
}: {
  title: string;
  subtitle: string;
  body: string;
  accent: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <View
        style={[
          styles.featuredCard,
          { borderColor: accent, backgroundColor: colors.primaryLight },
        ]}
      >
        <View style={[styles.featuredBadge, { backgroundColor: accent }]}>
          <Text style={styles.featuredBadgeText}>{subtitle.toUpperCase()}</Text>
        </View>
        <Text style={styles.featuredTitle}>{title}</Text>
        <Text style={styles.featuredBody}>{body}</Text>
        <View style={styles.featuredFooter}>
          <Text style={[styles.featuredCta, { color: accent }]}>
            Open OVA Rankings →
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function ChoiceCard({
  title,
  subtitle,
  accent,
  accentLabel,
  onPress,
}: {
  title: string;
  subtitle: string;
  accent: string;
  accentLabel: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
        <View style={styles.choiceFooter}>
          <Text style={[styles.choiceCta, { color: accent }]}>Continue →</Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
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

    featuredCard: {
      borderRadius: borderRadius.md,
      borderWidth: 2,
      padding: spacing.lg,
      marginBottom: spacing.lg,
    },
    featuredBadge: {
      alignSelf: 'flex-start',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: borderRadius.sm,
      marginBottom: spacing.sm,
    },
    featuredBadgeText: {
      color: '#fff',
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    featuredTitle: {
      fontSize: fontSize.xxl,
      fontWeight: '800',
      color: colors.text,
      marginBottom: spacing.xs,
    },
    featuredBody: {
      fontSize: fontSize.sm,
      color: colors.text,
      lineHeight: 20,
    },
    featuredFooter: {
      marginTop: spacing.md,
      alignItems: 'flex-end',
    },
    featuredCta: {
      fontSize: fontSize.md,
      fontWeight: '800',
    },

    sectionLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textLight,
      letterSpacing: 1,
      marginBottom: spacing.sm,
      marginTop: spacing.sm,
    },

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
    },
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
  });
}
