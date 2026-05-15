// ── AboutScreen ───────────────────────────────────────────────────────────
//
// In-app about / disclaimer / privacy surface. Required for store
// submission — we need a place users can:
//   1) See the "unofficial / third-party" disclaimer for AES, OVA MRS,
//      CAC Locker, Timu. (Apple in particular rejects apps that look
//      like official versions of services they don't represent.)
//   2) Read the privacy policy (link out to the hosted version once
//      it's published; falls back to a brief in-app summary).
//   3) See the app version + build for support requests.
//
// Surfaced from the hamburger menu under both Home and Team contexts.
// Read-only screen — no destructive actions, no settings. Settings get
// their own screen later if we ever need any.
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Linking,
  Alert,
} from 'react-native';
import Constants from 'expo-constants';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';

interface Props {
  onBack: () => void;
}

// Replace this with the hosted policy URL once published. The fallback
// behavior (when this is left empty) shows the same wording inline.
const PRIVACY_POLICY_URL = '';

// Primary contact for SetPoint support / feedback / privacy
// questions. Surfaced in the About screen "Contact" section, in the
// ErrorBoundary "Report this error" mailto link, and in PRIVACY.md.
const SUPPORT_EMAIL = 'jontycollis@gmail.com';

export function AboutScreen({ onBack }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const appName = Constants.expoConfig?.name || 'SetPoint';
  const appVersion = Constants.expoConfig?.version || '—';
  const buildNumber =
    Constants.expoConfig?.android?.versionCode ??
    Constants.expoConfig?.ios?.buildNumber ??
    '—';

  const openPrivacyPolicy = () => {
    if (PRIVACY_POLICY_URL) {
      Linking.openURL(PRIVACY_POLICY_URL).catch(() => {
        Alert.alert(
          'Could not open',
          'Try again later, or copy the URL from the screen.'
        );
      });
    } else {
      Alert.alert(
        'Privacy policy',
        // Inline summary used until the hosted URL is set. Full text
        // lives in PRIVACY.md in the repo.
        "SetPoint is a client-only app. There's no SetPoint server, no SetPoint account, and no SetPoint analytics. Match scores, team rosters, and connection state live on your device only. When you sign in to OVA MRS or CAC Locker, your credentials go to those services directly — SetPoint never sees them. Crash reports (when enabled) are anonymized and sent to Sentry to help fix bugs.\n\nFull policy: see PRIVACY.md in the project repo."
      );
    }
  };

  const openContact = () => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=SetPoint%20feedback`).catch(
      () => {
        Alert.alert('Could not open mail', `Reach us at ${SUPPORT_EMAIL}.`);
      }
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="Back"
          accessibilityRole="button"
        >
          <Text style={styles.heroBack}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.heroTitle}>About SetPoint</Text>
        <Text style={styles.heroSubtitle}>
          {appName} · v{appVersion} (build {String(buildNumber)})
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* Disclaimer — the most important block on this screen and
            the reason it exists. Displayed prominently in an accent
            card so reviewers can't miss it. */}
        <View style={styles.disclaimerCard}>
          <Text style={styles.disclaimerHeading}>
            Unofficial third-party app
          </Text>
          <Text style={styles.disclaimerBody}>
            SetPoint is an independent companion tool. It is{' '}
            <Text style={styles.bold}>not affiliated with, endorsed by, or sponsored by</Text>:
          </Text>
          <View style={styles.disclaimerList}>
            <Text style={styles.disclaimerListItem}>• Volleyball Canada</Text>
            <Text style={styles.disclaimerListItem}>
              • Ontario Volleyball Association (OVA)
            </Text>
            <Text style={styles.disclaimerListItem}>
              • Coaching Association of Canada (CAC)
            </Text>
            <Text style={styles.disclaimerListItem}>
              • Advanced Event Systems (AES)
            </Text>
            <Text style={styles.disclaimerListItem}>• Timu Sports</Text>
          </View>
          <Text style={styles.disclaimerBody}>
            All trademarks and tournament data are the property of their
            respective owners. SetPoint reads publicly-available tournament
            information and embeds the OVA MRS / CAC Locker member portals
            inside a web view for convenience. Your credentials and session
            cookies stay in the embedded web view — SetPoint never sees or
            stores them.
          </Text>
        </View>

        {/* Privacy summary. Tap → full policy or inline summary. */}
        <Section title="Privacy">
          <Text style={styles.body}>
            Everything SetPoint creates or fetches lives on your device.
            There is no SetPoint server, no account system, and no
            cross-device sync. Match scores, team rosters, and favorites
            never leave your phone.
          </Text>
          <LinkButton
            label={
              PRIVACY_POLICY_URL ? 'Read full privacy policy' : 'Read privacy summary'
            }
            onPress={openPrivacyPolicy}
          />
        </Section>

        {/* Data summary — short version of what's stored where. */}
        <Section title="What's stored on this device">
          <Bullet>Followed teams, favorite tournaments, and recently-viewed strip</Bullet>
          <Bullet>Match scores you've recorded (scoreboard + Tier 2 scoring)</Bullet>
          <Bullet>Roster / lineup history per team</Bullet>
          <Bullet>Connection status (whether you've signed in to MRS / CAC before — never the credentials themselves)</Bullet>
          <Bullet>Cached AES + Timu tournament data so the app works on weak signals</Bullet>
        </Section>

        <Section title="What we don't collect">
          <Bullet>Your name, email, phone, or location</Bullet>
          <Bullet>Your MRS or CAC Locker username / password</Bullet>
          <Bullet>Behavioural analytics (no Mixpanel / Amplitude / Firebase)</Bullet>
        </Section>

        <Section title="Crash reports">
          <Text style={styles.body}>
            Production builds may send anonymized crash traces to Sentry so
            we can fix bugs. Crash reports include stack traces, the screen
            you were on, and your OS / device model — never personal data,
            tournament data, or credentials.
          </Text>
        </Section>

        <Section title="Contact">
          <Text style={styles.body}>
            Bug reports, feature requests, or privacy questions:
          </Text>
          <LinkButton label={SUPPORT_EMAIL} onPress={openContact} />
        </Section>

        <Text style={styles.footerText}>
          © {new Date().getFullYear()} Jon Collis. All rights reserved.
        </Text>
      </ScrollView>
    </View>
  );
}

// ── Local subcomponents ───────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={styles.linkButton}
      accessibilityRole="link"
      accessibilityLabel={label}
    >
      <Text style={styles.linkButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

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
      color: 'rgba(255,255,255,0.8)',
      fontSize: fontSize.md,
      marginTop: 4,
    },
    body: {
      padding: spacing.lg,
      gap: spacing.lg,
      color: colors.text,
      fontSize: fontSize.md,
      lineHeight: fontSize.md * 1.5,
    },
    // Accent-bordered card so the disclaimer is visually distinct
    // from the rest of the body content — required so app-store
    // reviewers see it on first scroll.
    disclaimerCard: {
      backgroundColor: colors.accentLight,
      borderLeftWidth: 4,
      borderLeftColor: colors.accent,
      borderRadius: borderRadius.md,
      padding: spacing.lg,
      gap: spacing.md,
    },
    disclaimerHeading: {
      fontSize: fontSize.lg,
      fontWeight: '800',
      color: colors.text,
    },
    disclaimerBody: {
      fontSize: fontSize.md,
      lineHeight: fontSize.md * 1.45,
      color: colors.text,
    },
    disclaimerList: {
      paddingLeft: spacing.sm,
      gap: 2,
    },
    disclaimerListItem: {
      fontSize: fontSize.md,
      color: colors.text,
      lineHeight: fontSize.md * 1.5,
    },
    bold: { fontWeight: '800' },

    section: {
      gap: spacing.sm,
    },
    sectionTitle: {
      fontSize: fontSize.lg,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 4,
    },

    bulletRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      paddingLeft: spacing.xs,
    },
    bulletDot: {
      fontSize: fontSize.md,
      color: colors.textSecondary,
      width: 12,
    },
    bulletText: {
      flex: 1,
      fontSize: fontSize.md,
      color: colors.text,
      lineHeight: fontSize.md * 1.5,
    },

    linkButton: {
      paddingVertical: spacing.sm,
    },
    linkButtonText: {
      color: colors.primary,
      fontWeight: '700',
      fontSize: fontSize.md,
    },

    footerText: {
      fontSize: fontSize.xs,
      color: colors.textLight,
      textAlign: 'center',
      marginTop: spacing.lg,
      marginBottom: spacing.xxxl,
    },
  });
}
