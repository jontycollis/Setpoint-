// ── ToolsScreen ───────────────────────────────────────────────────────────
//
// Reachable from the bottom Tools tab. Surfaces the connection screens and
// (when scorerMode is on) the "Score a Match" entry point. Live Scoreboard
// is intentionally absent — it requires an event+division context, which
// only exists once a user is inside a tournament; surfacing it here without
// context would be a dead end.
//
// The Tier 2 scoring session (parallel worktree) is expected to add a real
// Scoreboard tool here later. The list-of-rows shape is deliberately simple
// so adding a row is one entry.
// ────────────────────────────────────────────────────────────────────────────

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { spacing, fontSize, borderRadius, useTheme } from '../utils/theme';
import type { UserProfile } from '../types/profile';

interface Props {
  profile: UserProfile | null;
  onOpenMrsConnection: () => void;
  onOpenCacConnection: () => void;
  /** Score-a-match tap. Only invoked when profile.scorerMode === true. */
  onOpenScoreAMatch: () => void;
}

export function ToolsScreen({
  profile,
  onOpenMrsConnection,
  onOpenCacConnection,
  onOpenScoreAMatch,
}: Props) {
  const theme = useTheme();
  const scorerOn = profile?.scorerMode === true;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.hero, { backgroundColor: theme.colors.primary }]}>
        <Text style={[styles.heroKicker, { color: 'rgba(255,255,255,0.85)' }]}>
          TOOLS
        </Text>
        <Text style={[styles.heroTitle, { color: theme.colors.textOnPrimary }]}>
          Connections & utilities
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Section label="CONNECTIONS">
          <ToolRow
            icon={'\u{1F517}'}
            title="OVA MRS"
            subtitle={
              profile?.mrsLinked
                ? 'Connected — view your account'
                : 'Connect to view team affiliations'
            }
            badge={profile?.mrsLinked ? 'Connected' : 'Connect'}
            badgeOn={!!profile?.mrsLinked}
            onPress={onOpenMrsConnection}
          />
          <ToolRow
            icon={'\u{1F3CB}'}
            title="CAC Locker"
            subtitle={
              profile?.cacLinked
                ? 'Connected — view your transcript'
                : 'Connect to view NCCP certifications'
            }
            badge={profile?.cacLinked ? 'Connected' : 'Connect'}
            badgeOn={!!profile?.cacLinked}
            onPress={onOpenCacConnection}
          />
        </Section>

        {scorerOn && (
          <Section label="SCORING">
            <ToolRow
              icon={'\u{1F3D0}'}
              title="Score a Match"
              subtitle="Open the Setpoint scoring console"
              onPress={onOpenScoreAMatch}
            />
          </Section>
        )}
      </ScrollView>
    </View>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: theme.colors.textLight }]}>
        {label}
      </Text>
      {children}
    </View>
  );
}

function ToolRow({
  icon,
  title,
  subtitle,
  badge,
  badgeOn,
  onPress,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeOn?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.row,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.divider,
        },
      ]}
    >
      <Text style={styles.rowIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: theme.colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[styles.rowSubtitle, { color: theme.colors.textSecondary }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {badge ? (
        <View
          style={[
            styles.badge,
            badgeOn
              ? { backgroundColor: theme.colors.primaryLight }
              : { backgroundColor: theme.colors.primary },
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              badgeOn ? { color: theme.colors.primary } : { color: '#fff' },
            ]}
          >
            {badge}
          </Text>
        </View>
      ) : (
        <Text style={[styles.rowArrow, { color: theme.colors.textLight }]}>›</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hero: {
    padding: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  heroKicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  heroTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
  },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  section: { marginBottom: spacing.lg },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
  },
  rowIcon: { fontSize: 22 },
  rowTitle: { fontSize: fontSize.md, fontWeight: '700' },
  rowSubtitle: { fontSize: fontSize.xs, marginTop: 2 },
  rowArrow: { fontSize: fontSize.lg, fontWeight: '600' },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
});
