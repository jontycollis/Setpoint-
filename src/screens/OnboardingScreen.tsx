// ── OnboardingScreen ──────────────────────────────────────────────────────
//
// First-launch experience. Shown on a fresh install OR after a storage
// reset; dismissed once the user taps "Get started". The dismissal
// flag is stored in AsyncStorage under `onboarding.completed.v1` —
// versioned so we can re-trigger the flow after major releases that
// add features worth introducing (just bump to v2 and the flow shows
// again, once, for everyone).
//
// What this screen has to do for store submission:
//   1) Surface the "unofficial third-party app" disclaimer ON
//      FIRST LAUNCH so reviewers see it without hunting through the
//      hamburger.
//   2) Reassure users about credential handling (we never see MRS /
//      CAC passwords).
//   3) Give a 1-paragraph orientation so the empty MyHome doesn't
//      feel like a broken install.
//
// Non-goals: collecting any info, asking permissions (we never ask
// for any here — permission prompts come the first time the relevant
// feature is used).
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';

export const ONBOARDING_STORAGE_KEY = 'onboarding.completed.v1';

interface Props {
  onComplete: () => void;
}

export function OnboardingScreen({ onComplete }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + spacing.xxl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Welcome header */}
        <View style={styles.hero}>
          <Text style={styles.heroEmoji}>{'🏐'}</Text>
          <Text style={styles.heroTitle}>Welcome to Bior</Text>
          <Text style={styles.heroSubtitle}>
            Tournament browser, team dashboards, live scoring, and venue
            maps — for indoor volleyball.
          </Text>
        </View>

        {/* Feature highlights */}
        <View style={styles.featureBlock}>
          <Feature
            emoji="🔎"
            title="Find your team"
            body="Pick from the OVA rankings and Bior auto-discovers their AES and Timu tournaments."
          />
          <Feature
            emoji="📊"
            title="Live dashboards"
            body="Standings, brackets, court schedules, season history — all in one place."
          />
          <Feature
            emoji="📋"
            title="Score a match"
            body="Tier-1 scoreboard for casual play, Tier-2 paper-fidelity scoring with rotation tracking and stats."
          />
          <Feature
            emoji="🗺️"
            title="Venue maps"
            body="Pinch-to-zoom maps for OVA Championships, Nationals, and more."
          />
        </View>

        {/* THE disclaimer — accent card so it can't be missed on a
            casual scroll. Reviewers will see this. */}
        <View style={styles.disclaimerCard}>
          <Text style={styles.disclaimerHeading}>
            One thing before you start
          </Text>
          <Text style={styles.disclaimerBody}>
            Bior is an independent app.{' '}
            <Text style={styles.bold}>
              It's not affiliated with, endorsed by, or sponsored by
            </Text>{' '}
            Volleyball Canada, the Ontario Volleyball Association, the
            Coaching Association of Canada, Advanced Event Systems, or
            Timu Sports.
          </Text>
          <Text style={styles.disclaimerBody}>
            When you sign in to OVA MRS or CAC Locker inside the app,
            your credentials go straight to those services through an
            embedded web view.{' '}
            <Text style={styles.bold}>
              Bior never sees, captures, or stores your username
              or password.
            </Text>
          </Text>
          <Text style={styles.disclaimerBody}>
            Match scores, rosters, and favorites stay on this device —
            there's no Bior server.
          </Text>
        </View>

        <Text style={styles.fineprintText}>
          You can re-read the full disclaimer and privacy summary any time
          from the menu → About & privacy.
        </Text>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={onComplete}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Get started — dismiss the welcome screen and open the home tab"
        >
          <Text style={styles.primaryButtonText}>Get started</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────

function Feature({
  emoji,
  title,
  body,
}: {
  emoji: string;
  title: string;
  body: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.featureRow}>
      <Text style={styles.featureEmoji}>{emoji}</Text>
      <View style={styles.featureCopy}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureBody}>{body}</Text>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: {
      padding: spacing.xxl,
      gap: spacing.xl,
    },
    hero: {
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.lg,
    },
    heroEmoji: { fontSize: 56 },
    heroTitle: {
      fontSize: 28,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'center',
    },
    heroSubtitle: {
      fontSize: fontSize.md,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: fontSize.md * 1.5,
      paddingHorizontal: spacing.md,
    },

    featureBlock: { gap: spacing.lg },
    featureRow: {
      flexDirection: 'row',
      gap: spacing.md,
      alignItems: 'flex-start',
    },
    featureEmoji: { fontSize: 28, width: 36, textAlign: 'center' },
    featureCopy: { flex: 1, gap: 2 },
    featureTitle: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    featureBody: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      lineHeight: fontSize.sm * 1.45,
    },

    disclaimerCard: {
      backgroundColor: colors.accentLight,
      borderLeftWidth: 4,
      borderLeftColor: colors.accent,
      borderRadius: borderRadius.md,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    disclaimerHeading: {
      fontSize: fontSize.md,
      fontWeight: '800',
      color: colors.text,
      marginBottom: 2,
    },
    disclaimerBody: {
      fontSize: fontSize.sm,
      color: colors.text,
      lineHeight: fontSize.sm * 1.5,
    },
    bold: { fontWeight: '800' },

    fineprintText: {
      fontSize: fontSize.xs,
      color: colors.textLight,
      textAlign: 'center',
      paddingHorizontal: spacing.md,
    },

    primaryButton: {
      backgroundColor: colors.primary,
      paddingVertical: spacing.lg,
      borderRadius: borderRadius.md,
      alignItems: 'center',
      marginTop: spacing.md,
    },
    primaryButtonText: {
      color: colors.textOnPrimary,
      fontSize: fontSize.lg,
      fontWeight: '800',
    },
  });
}
