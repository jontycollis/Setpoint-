// ── VenueMapSelectorScreen ────────────────────────────────────────────────
// Standalone entry-point for the Home launcher's "Venue maps" tile.
// Lists every tournament/year/event in the registry that has a venue map
// or info-page URL configured. Tapping a row opens VenueMapScreen with
// those URLs.
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SectionHeader } from '../components/SectionHeader';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import {
  TOURNAMENT_REGISTRY,
  type Country,
} from '../config/tournaments';

interface Selection {
  label: string;
  subtitle?: string;
  venueMapUrl?: string;
  infoPageUrl?: string;
}

interface Props {
  /** Registry to draw from — pass the discovered (AES-merged) variant
   *  when available so freshly-published events show up too. Falls back
   *  to the bundled static registry. */
  registry?: Country[] | null;
  onBack: () => void;
  onOpenMap: (sel: Selection) => void;
}

export function VenueMapSelectorScreen({ registry, onBack, onOpenMap }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const rows = useMemo(() => buildRows(registry ?? TOURNAMENT_REGISTRY), [
    registry,
  ]);

  return (
    <View style={styles.container}>
      <SectionHeader
        title="Venue maps"
        subtitle="Pick a tournament to view its map."
        onBack={onBack}
      />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + spacing.xxl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {rows.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No maps configured yet.</Text>
            <Text style={styles.emptyBody}>
              Maps appear here once tournaments publish their venue layouts.
            </Text>
          </View>
        ) : (
          rows.map((row, idx) => (
            <TouchableOpacity
              key={`${row.label}-${idx}`}
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => onOpenMap(row)}
              accessibilityRole="button"
              accessibilityLabel={`Open map for ${row.label}`}
            >
              <Text style={styles.rowGlyph}>🏟</Text>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {row.label}
                </Text>
                {row.subtitle ? (
                  <Text style={styles.rowSubtitle} numberOfLines={1}>
                    {row.subtitle}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.rowChev}>›</Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function buildRows(registry: Country[]): Selection[] {
  const out: Selection[] = [];
  for (const country of registry) {
    for (const tournament of country.tournaments) {
      for (const year of tournament.years) {
        // Year-level map covers every event in the year — surface once.
        if (year.venueMapUrl || year.infoPageUrl) {
          out.push({
            label: `${tournament.name} ${year.year}`,
            subtitle: year.venue ?? country.name,
            venueMapUrl: year.venueMapUrl,
            infoPageUrl: year.infoPageUrl,
          });
        }
        // Event-level maps when the events override the year-level one.
        for (const event of year.events) {
          if (!event.venueMapUrl && !event.infoPageUrl) continue;
          // Skip if identical to the year-level map we just pushed.
          if (
            event.venueMapUrl === year.venueMapUrl &&
            event.infoPageUrl === year.infoPageUrl
          ) {
            continue;
          }
          out.push({
            label: `${tournament.name} ${year.year} — ${event.label}`,
            subtitle: event.venue ?? event.subtitle ?? country.name,
            venueMapUrl: event.venueMapUrl,
            infoPageUrl: event.infoPageUrl,
          });
        }
        // Standalone extra maps (e.g. multi-tournament Nationals weeks).
        for (const extra of year.extraVenueMaps ?? []) {
          out.push({
            label: extra.label,
            subtitle: extra.subtitle,
            venueMapUrl: extra.mapUrl,
            infoPageUrl: extra.infoPageUrl,
          });
        }
      }
    }
  }
  return out;
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      gap: spacing.md,
    },
    rowGlyph: { fontSize: 22 },
    rowText: { flex: 1 },
    rowTitle: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: '700',
    },
    rowSubtitle: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      marginTop: 2,
    },
    rowChev: {
      color: colors.textLight,
      fontSize: 24,
      fontWeight: '400',
    },
    empty: {
      paddingVertical: spacing.xxl,
      alignItems: 'center',
    },
    emptyTitle: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: '700',
      marginBottom: spacing.sm,
    },
    emptyBody: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      textAlign: 'center',
    },
  });
}
