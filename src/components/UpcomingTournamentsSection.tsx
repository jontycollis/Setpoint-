// ── UpcomingTournamentsSection ────────────────────────────────────────────
//
// Forward-looking tournament metadata for a single team — which events the
// team is registered for in the future. Source: the unified AES + Timu
// season indices (`loadAllSeasonIndices()`), filtered by alias matching
// against the team's known names. Same data path that drives the
// per-team upcoming line on MyHome's team cards, factored into a
// component so the AES + Timu team dashboards can render the same list
// without re-implementing the lookup.
//
// Empty-state: render the placeholder ("No upcoming tournaments
// scheduled.") rather than hiding the section. Keeps the user
// oriented — they know the section exists and can tell at a glance
// whether anything is on the calendar.
// ────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  borderRadius,
  fontSize,
  spacing,
  useTheme,
} from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import {
  getUpcomingTournaments,
  loadAllSeasonIndices,
  type LoadedIndices,
  type UnifiedTournamentEntry,
} from '../utils/unifiedSeasonHistory';

interface Props {
  /** Aliases identifying the team — typically `[team.name, ...savedAliases]`.
   *  When the caller doesn't have a saved profile, passing just the team's
   *  current name is fine; the strict matcher will still catch indexed
   *  entries whose `myTeamName` matches after normalisation. */
  aliases: string[];
  /** Used in __DEV__ logs to identify which team's upcoming-lookup is
   *  reporting empty. Skipped in production builds. */
  debugLabel?: string;
  /** Tap an upcoming card → caller routes to that tournament. */
  onOpenEntry?: (entry: UnifiedTournamentEntry) => void;
  /** Source keys to hide from the upcoming list — used by Season
   *  History to keep active tournaments out of the Upcoming section
   *  once they've been pinned at the top. */
  excludeKeys?: ReadonlySet<string>;
}

export function UpcomingTournamentsSection({
  aliases,
  debugLabel,
  onOpenEntry,
  excludeKeys,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [indices, setIndices] = useState<LoadedIndices | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadAllSeasonIndices();
        if (!cancelled) setIndices(loaded);
      } catch {
        /* ignore — we'll just render the empty placeholder */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const upcoming = useMemo(() => {
    if (!indices) return [];
    const list = getUpcomingTournaments(indices, aliases, { debugLabel });
    if (!excludeKeys || excludeKeys.size === 0) return list;
    return list.filter((e) => !excludeKeys.has(e.sourceKey));
  }, [indices, aliases, debugLabel, excludeKeys]);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>UPCOMING TOURNAMENTS</Text>
      {upcoming.length === 0 ? (
        <Text style={styles.emptyText}>
          No upcoming tournaments scheduled. Pull down to refresh after registering for a new event.
        </Text>
      ) : (
        upcoming.map((entry) => (
          <TouchableOpacity
            key={entry.sourceKey}
            style={styles.card}
            activeOpacity={onOpenEntry ? 0.7 : 1}
            disabled={!onOpenEntry}
            onPress={() => onOpenEntry?.(entry)}
          >
            <View style={[styles.sourceBadge, entry.source === 'timu' ? styles.sourceBadgeTimu : styles.sourceBadgeAes]}>
              <Text style={styles.sourceBadgeText}>{entry.source.toUpperCase()}</Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {entry.tournamentName}
              </Text>
              {entry.subtitle ? (
                <Text style={styles.cardSubtitle} numberOfLines={1}>
                  {entry.subtitle}
                </Text>
              ) : null}
              <Text style={styles.cardMeta} numberOfLines={1}>
                {entry.dateText ?? formatRelativeDate(entry.dateMs)}
                {entry.venueName ? ` · ${entry.venueName}` : ''}
              </Text>
            </View>
            {onOpenEntry ? (
              <Text style={styles.chevron} accessible={false}>
                {'›'}
              </Text>
            ) : null}
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

function formatRelativeDate(ms?: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    section: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      backgroundColor: colors.background,
    },
    sectionLabel: {
      fontSize: 11,
      fontWeight: '800',
      color: colors.primary,
      letterSpacing: 1.2,
      marginBottom: spacing.sm,
    },
    emptyText: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      fontStyle: 'italic',
      paddingVertical: spacing.sm,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
    },
    sourceBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: borderRadius.sm,
      minWidth: 38,
      alignItems: 'center',
    },
    sourceBadgeAes: { backgroundColor: colors.primary },
    sourceBadgeTimu: { backgroundColor: colors.accent },
    sourceBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
    cardBody: { flex: 1 },
    cardTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
    cardSubtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
    cardMeta: { fontSize: fontSize.xs, color: colors.textLight, marginTop: 2 },
    chevron: {
      fontSize: 24,
      color: colors.textLight,
      marginLeft: spacing.xs,
      lineHeight: 24,
    },
  });
}
