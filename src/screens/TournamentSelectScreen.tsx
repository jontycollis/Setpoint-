import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../utils/theme';
import {
  TOURNAMENT_REGISTRY,
  getAvailableYears,
  getTournamentYear,
} from '../config/tournaments';
import type {
  Country,
  Tournament,
  TournamentYear,
} from '../config/tournaments';
import {
  fetchCanadianEvents,
  groupIntoTournaments,
} from '../api/aesClient';
import type { DiscoveredTournament } from '../api/aesClient';

const APP_LOGO = require('../../assets/setpoint-logo.png');

type Step = 'country' | 'tournament' | 'year';

interface Props {
  onTournamentSelected: (
    country: Country,
    tournament: Tournament,
    tournamentYear: TournamentYear
  ) => void;
}

/**
 * Merge API-discovered tournaments into the static registry, adding any
 * events that aren't already present (matched by eventSchedulerKey).
 */
function mergeDiscoveredEvents(
  staticRegistry: Country[],
  discovered: DiscoveredTournament[]
): Country[] {
  // Deep-clone the registry so we don't mutate the import
  const registry: Country[] = JSON.parse(JSON.stringify(staticRegistry));

  const canada = registry.find((c) => c.id === 'canada');
  if (!canada) return registry;

  for (const disc of discovered) {
    // Find or create the tournament entry
    let tournament = canada.tournaments.find(
      (t) => t.id === disc.tournamentId
    );
    if (!tournament) {
      tournament = {
        id: disc.tournamentId,
        name: disc.tournamentName,
        shortName: disc.shortName,
        icon: disc.icon,
        years: [],
      };
      canada.tournaments.push(tournament);
    }

    // Find or create the year entry
    let yearEntry = tournament.years.find((y) => y.year === disc.year);
    if (!yearEntry) {
      yearEntry = { year: disc.year, events: [] };
      // Auto-generate infoPageUrl for known tournaments
      if (disc.tournamentId === 'ontario-championships') {
        yearEntry.infoPageUrl = 'https://www.ontariovolleyball.org/ocs-venue';
      } else if (disc.tournamentId === 'canadian-nationals') {
        yearEntry.infoPageUrl = `https://volleyball.ca/en/competitions/${disc.year}-youth-nationals`;
      }
      tournament.years.push(yearEntry);
    }

    // Merge events — only add if key not already present
    const existingKeys = new Set(yearEntry.events.map((e) => e.key));
    for (const de of disc.events) {
      if (!existingKeys.has(de.key)) {
        yearEntry.events.push({
          key: de.key,
          label: de.label,
          subtitle: de.subtitle,
          dates: de.dates,
          venue: de.venue,
        });
      }
    }

    // Sort events by label so numbering stays sequential
    // "Event 1" < "Event 2" < "Event 3" etc., then alphabetical for the rest
    yearEntry.events.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }

  return registry;
}

export function TournamentSelectScreen({ onTournamentSelected }: Props) {
  const [step, setStep] = useState<Step>('country');
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
  const [selectedTournament, setSelectedTournament] =
    useState<Tournament | null>(null);
  const [registry, setRegistry] = useState<Country[]>(TOURNAMENT_REGISTRY);
  const [discoveryLoading, setDiscoveryLoading] = useState(true);
  const [discoveryError, setDiscoveryError] = useState(false);

  // Fetch and merge dynamic events on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const caEvents = await fetchCanadianEvents();
        const grouped = groupIntoTournaments(caEvents);
        if (!cancelled) {
          setRegistry((prev) => mergeDiscoveredEvents(prev, grouped));
          setDiscoveryError(false);
        }
      } catch (err) {
        console.warn('Tournament discovery failed:', err);
        if (!cancelled) setDiscoveryError(true);
      } finally {
        if (!cancelled) setDiscoveryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function handleCountrySelect(country: Country) {
    // Always use the latest version from registry (may have been enriched)
    const fresh = registry.find((c) => c.id === country.id) || country;
    setSelectedCountry(fresh);
    setStep('tournament');
  }

  function handleTournamentSelect(tournament: Tournament) {
    if (tournament.years.length === 0) return; // Coming soon — disabled
    setSelectedTournament(tournament);
    // If only one year, skip the year picker
    if (tournament.years.length === 1) {
      onTournamentSelected(
        selectedCountry!,
        tournament,
        tournament.years[0]
      );
      return;
    }
    setStep('year');
  }

  function handleYearSelect(year: number) {
    const ty = getTournamentYear(selectedTournament!, year);
    if (ty) {
      onTournamentSelected(selectedCountry!, selectedTournament!, ty);
    }
  }

  function handleBack() {
    if (step === 'year') {
      setStep('tournament');
      setSelectedTournament(null);
    } else if (step === 'tournament') {
      setStep('country');
      setSelectedCountry(null);
    }
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* App Header */}
        <View style={styles.headerArea}>
          <Image source={APP_LOGO} style={styles.logoImage} resizeMode="contain" />
        </View>

        {/* Breadcrumb / Back */}
        {step !== 'country' && (
          <TouchableOpacity
            style={styles.backRow}
            onPress={handleBack}
            activeOpacity={0.6}
          >
            <Text style={styles.backArrow}>{'‹'}</Text>
            <Text style={styles.backLabel}>
              {step === 'tournament'
                ? 'Countries'
                : selectedCountry?.name ?? 'Back'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Step: Country */}
        {step === 'country' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Select Country</Text>
            {discoveryLoading && (
              <View style={styles.discoveryRow}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={styles.discoveryText}>
                  Checking for new tournaments…
                </Text>
              </View>
            )}
            {discoveryError && !discoveryLoading && (
              <View style={styles.discoveryRow}>
                <Text style={styles.discoveryErrorText}>
                  Could not check for new events — showing saved tournaments
                </Text>
              </View>
            )}
            {registry.map((country) => (
              <TouchableOpacity
                key={country.id}
                style={styles.card}
                onPress={() => handleCountrySelect(country)}
                activeOpacity={0.7}
              >
                <Text style={styles.cardFlag}>{country.flag}</Text>
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{country.name}</Text>
                  <Text style={styles.cardSubtitle}>
                    {country.tournaments.length} tournament
                    {country.tournaments.length !== 1 ? 's' : ''}
                  </Text>
                </View>
                <Text style={styles.cardArrow}>{'›'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Step: Tournament */}
        {step === 'tournament' && selectedCountry && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {selectedCountry.flag} {selectedCountry.name} Tournaments
            </Text>
            {selectedCountry.tournaments.map((tournament) => {
              const years = getAvailableYears(tournament);
              const isAvailable = years.length > 0;
              return (
                <TouchableOpacity
                  key={tournament.id}
                  style={[styles.card, !isAvailable && styles.cardDisabled]}
                  onPress={() => handleTournamentSelect(tournament)}
                  activeOpacity={isAvailable ? 0.7 : 1}
                  disabled={!isAvailable}
                >
                  <Text style={styles.cardIcon}>{tournament.icon}</Text>
                  <View style={styles.cardBody}>
                    <Text
                      style={[
                        styles.cardTitle,
                        !isAvailable && styles.cardTitleDisabled,
                      ]}
                    >
                      {tournament.name}
                    </Text>
                    <Text style={styles.cardSubtitle}>
                      {isAvailable
                        ? years.join(', ')
                        : 'Coming Soon'}
                    </Text>
                  </View>
                  <Text style={styles.cardArrow}>
                    {isAvailable ? '›' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Step: Year */}
        {step === 'year' && selectedTournament && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {selectedTournament.icon} {selectedTournament.name}
            </Text>
            <Text style={styles.sectionSubtitle}>Select Year</Text>
            <View style={styles.yearGrid}>
              {getAvailableYears(selectedTournament).map((year) => {
                const ty = getTournamentYear(selectedTournament, year)!;
                return (
                  <TouchableOpacity
                    key={year}
                    style={styles.yearCard}
                    onPress={() => handleYearSelect(year)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.yearNumber}>{year}</Text>
                    {ty.venue && (
                      <Text style={styles.yearVenue} numberOfLines={1}>
                        {ty.venue}
                      </Text>
                    )}
                    <Text style={styles.yearEvents}>
                      {ty.events.length} event
                      {ty.events.length !== 1 ? 's' : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Manual URL entry hint */}
        <View style={styles.hintSection}>
          <View style={styles.hintDivider}>
            <View style={styles.hintLine} />
            <Text style={styles.hintDividerText}>or</Text>
            <View style={styles.hintLine} />
          </View>
          <Text style={styles.hintText}>
            Don't see your tournament? You can enter any AES event URL after
            selecting a tournament above, or pick one from your recent events.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    paddingBottom: spacing.xxxl + 40,
  },
  headerArea: {
    paddingTop: spacing.xxxl + 10,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
    alignItems: 'center',
  },
  logoImage: {
    width: 300,
    height: 100,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.sm,
  },
  backArrow: {
    fontSize: 28,
    color: colors.primary,
    marginRight: spacing.xs,
    lineHeight: 28,
  },
  backLabel: {
    fontSize: fontSize.md,
    color: colors.primary,
    fontWeight: '600',
  },
  section: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  sectionSubtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
    marginTop: -spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  cardDisabled: {
    opacity: 0.35,
  },
  cardFlag: {
    fontSize: 36,
    marginRight: spacing.lg,
    width: 48,
    textAlign: 'center',
  },
  cardIcon: {
    fontSize: 30,
    marginRight: spacing.lg,
    width: 48,
    textAlign: 'center',
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 3,
  },
  cardTitleDisabled: {
    color: colors.textLight,
  },
  cardSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  cardArrow: {
    fontSize: 22,
    color: colors.textLight,
    marginLeft: spacing.sm,
    fontWeight: '300',
  },
  yearGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacing.xs,
  },
  yearCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    margin: spacing.xs,
    minWidth: 140,
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  yearNumber: {
    fontSize: fontSize.title,
    fontWeight: '900',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  yearVenue: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 2,
  },
  yearEvents: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: '700',
  },
  discoveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
  },
  discoveryText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
  },
  discoveryErrorText: {
    fontSize: fontSize.sm,
    color: colors.warning,
  },
  hintSection: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
  },
  hintDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  hintLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  hintDividerText: {
    fontSize: fontSize.sm,
    color: colors.textLight,
    paddingHorizontal: spacing.md,
  },
  hintText: {
    fontSize: fontSize.sm,
    color: colors.textLight,
    textAlign: 'center',
    lineHeight: 20,
  },
});
