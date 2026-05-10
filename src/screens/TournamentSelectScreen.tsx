import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  FlatList,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
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
import { loadDiscoveredRegistry } from '../api/aesClient';
import {
  buildGlobalSearchCorpus,
  matchesQuery,
  resultKey,
  type GlobalSearchResult,
} from '../utils/globalSearchCorpus';
import type { UserProfile } from '../types/profile';

const APP_LOGO = require('../../assets/setpoint-logo.png');

type Step = 'country' | 'tournament' | 'year';

interface Props {
  onTournamentSelected: (
    country: Country,
    tournament: Tournament,
    tournamentYear: TournamentYear
  ) => void;
  /** When supplied, skips the on-mount discovery fetch and uses this
   *  pre-enriched registry instead. App.tsx runs discovery at boot so the
   *  data is ready before the user reaches this screen. */
  initialRegistry?: Country[] | null;
  /** User profile drives the search corpus's "profile teams" rows so
   *  the user's own follow-list always floats to the top of results. */
  profile?: UserProfile | null;
  /** Tap a search result. App.tsx routes by kind, reusing the same
   *  navigation paths as the full-screen GlobalSearchScreen. Optional —
   *  when omitted the search input hides entirely (legacy callers). */
  onSearchSelect?: (result: GlobalSearchResult) => void;
  /** Tap the Timu discovery CTA. Routes to AddTournaments with the Timu
   *  paste card focused so the user can drop in a link straight away. */
  onOpenAddTimu?: () => void;
}

export function TournamentSelectScreen({
  onTournamentSelected,
  initialRegistry,
  profile,
  onSearchSelect,
  onOpenAddTimu,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [step, setStep] = useState<Step>('country');
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
  const [selectedTournament, setSelectedTournament] =
    useState<Tournament | null>(null);
  const [registry, setRegistry] = useState<Country[]>(initialRegistry ?? TOURNAMENT_REGISTRY);
  // Discovery surfaces three distinct UI states: in-flight ("checking…"),
  // succeeded (silent — registry just updated), or failed (banner + tap-to-
  // retry). The previous boolean pair couldn't carry the failure message
  // and had no path back to a successful retry.
  const [discoveryLoading, setDiscoveryLoading] = useState(!initialRegistry);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  // ── Search-first state ───────────────────────────────────────────────
  // Corpus is built once on mount; the FlatList below filters live as
  // the user types. Empty query hides the result list and reveals the
  // country/tournament/year tree as the secondary "Browse all" affordance.
  const [query, setQuery] = useState('');
  const [corpus, setCorpus] = useState<GlobalSearchResult[] | null>(null);
  useEffect(() => {
    if (!onSearchSelect) return; // Search hidden — skip the build.
    let cancelled = false;
    (async () => {
      try {
        const out = await buildGlobalSearchCorpus(profile ?? null);
        if (!cancelled) setCorpus(out);
      } catch {
        if (!cancelled) setCorpus([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, onSearchSelect]);

  const filteredResults = useMemo(() => {
    if (!corpus) return null;
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: GlobalSearchResult[] = [];
    for (const r of corpus) {
      if (matchesQuery(r, q)) {
        out.push(r);
        if (out.length >= 50) break;
      }
    }
    return out;
  }, [corpus, query]);

  // Sync from parent when it finishes boot-time discovery
  useEffect(() => {
    if (initialRegistry) {
      setRegistry(initialRegistry);
      setDiscoveryLoading(false);
    }
  }, [initialRegistry]);

  // Fetch and merge dynamic events on mount (only if no pre-fetched data).
  // The loader returns a tagged result so we can show a retry surface on
  // failure rather than silently falling back to the static registry.
  const runDiscovery = useCallback(async () => {
    setDiscoveryLoading(true);
    setDiscoveryError(null);
    const result = await loadDiscoveredRegistry(TOURNAMENT_REGISTRY);
    if (result.status === 'ok') {
      setRegistry(result.data);
      setDiscoveryError(null);
    } else if (result.status === 'error') {
      setDiscoveryError(result.message);
    }
    setDiscoveryLoading(false);
  }, []);

  useEffect(() => {
    if (initialRegistry) return; // App.tsx already ran discovery
    let cancelled = false;
    (async () => {
      const result = await loadDiscoveredRegistry(TOURNAMENT_REGISTRY);
      if (cancelled) return;
      if (result.status === 'ok') {
        setRegistry(result.data);
        setDiscoveryError(null);
      } else if (result.status === 'error') {
        console.warn('Tournament discovery failed:', result.message);
        setDiscoveryError(result.message);
      }
      setDiscoveryLoading(false);
    })();
    return () => { cancelled = true; };
  }, [initialRegistry]);

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

  const showSearch = !!onSearchSelect;
  const querying = !!query.trim();

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* App Header */}
        <View style={styles.headerArea}>
          <Image source={APP_LOGO} style={styles.logoImage} resizeMode="contain" />
        </View>

        {/* ── Search-first input ────────────────────────────────────── */}
        {showSearch && (
          <View style={styles.searchSection}>
            <View
              style={[
                styles.searchRow,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text style={[styles.searchIcon, { color: colors.textSecondary }]}>
                {'\u{1F50D}'}
              </Text>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search tournaments and teams"
                placeholderTextColor={colors.textLight}
                style={[styles.searchInput, { color: colors.text }]}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {query.length > 0 && (
                <TouchableOpacity
                  onPress={() => setQuery('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text
                    style={[styles.searchClear, { color: colors.textSecondary }]}
                  >
                    Clear
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            {/* Timu discovery escape hatch — visible directly under the
                search input whenever the query is empty, and again as the
                last row inside the results list (any count). Gives the
                user a way out when AES search misses a Timu tournament. */}
            {onOpenAddTimu && !querying && (
              <TimuCtaCard onPress={onOpenAddTimu} colors={colors} />
            )}
            {querying && (
              <View style={styles.searchResults}>
                {filteredResults == null ? (
                  <View style={styles.searchEmpty}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : filteredResults.length === 0 ? (
                  <View style={styles.searchEmpty}>
                    <Text
                      style={[
                        styles.searchEmptyText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      No matches yet — try a different spelling, or scroll down to browse by country.
                    </Text>
                  </View>
                ) : (
                  <FlatList
                    data={filteredResults}
                    keyExtractor={resultKey}
                    keyboardShouldPersistTaps="handled"
                    scrollEnabled={false}
                    renderItem={({ item }) => (
                      <SearchRow
                        result={item}
                        onPress={() => {
                          setQuery('');
                          onSearchSelect!(item);
                        }}
                      />
                    )}
                  />
                )}
                {onOpenAddTimu && filteredResults != null && (
                  <TimuCtaCard onPress={onOpenAddTimu} colors={colors} inList />
                )}
              </View>
            )}
          </View>
        )}

        {/* ── Browse-by-country (de-emphasised when search is active) ── */}
        <View style={querying ? styles.browseDimmed : null}>
          {showSearch && !querying && (
            <Text
              style={[styles.browseSectionLabel, { color: colors.textLight }]}
            >
              BROWSE BY COUNTRY
            </Text>
          )}

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
              {!showSearch && <Text style={styles.sectionTitle}>Select Country</Text>}
              {discoveryLoading && (
                <View style={styles.discoveryRow}>
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text style={styles.discoveryText}>
                    Checking for new tournaments…
                  </Text>
                </View>
              )}
              {discoveryError && !discoveryLoading && (
                <TouchableOpacity
                  style={styles.discoveryRetryRow}
                  onPress={runDiscovery}
                  activeOpacity={0.7}
                >
                  <Text style={styles.discoveryErrorText}>
                    Failed to load. Tap to retry.
                  </Text>
                </TouchableOpacity>
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
        </View>
      </ScrollView>
    </View>
  );
}

// ── Timu discovery CTA ─────────────────────────────────────────────────────
// Compact secondary-styled card pointing the user at the AddTournaments
// paste-a-link flow with the Timu source pre-focused. Rendered twice on
// the Browse tab: once below the search input (empty-state) and once as
// the trailing row inside the results list (any result count, including
// zero). The `inList` flag swaps the spacing/border so it sits flush with
// preceding result rows rather than floating as its own card.
function TimuCtaCard({
  onPress,
  colors,
  inList,
}: {
  onPress: () => void;
  colors: ThemeColors;
  inList?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        inList ? timuCtaStyles.rowInList : timuCtaStyles.rowStandalone,
        {
          backgroundColor: colors.surface,
          borderColor: colors.accent,
        },
      ]}
    >
      <View
        style={[
          timuCtaStyles.iconBubble,
          { backgroundColor: colors.accent + '22' },
        ]}
      >
        <Text style={[timuCtaStyles.iconText, { color: colors.accent }]}>
          {'\u{1F517}'}
        </Text>
      </View>
      <View style={timuCtaStyles.body}>
        <Text style={[timuCtaStyles.title, { color: colors.text }]}>
          Looking for a Timu tournament?
        </Text>
        <Text style={[timuCtaStyles.subtitle, { color: colors.textSecondary }]}>
          Paste a link to add it →
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const timuCtaStyles = StyleSheet.create({
  rowStandalone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  rowInList: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderStyle: 'dashed',
  },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 16 },
  body: { flex: 1 },
  title: { fontSize: fontSize.sm, fontWeight: '700' },
  subtitle: { fontSize: fontSize.xs, marginTop: 2 },
});

// ── Inline search row ──────────────────────────────────────────────────────

function SearchRow({
  result,
  onPress,
}: {
  result: GlobalSearchResult;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  let badgeLabel = '';
  let badgeColor = colors.primary;
  let title = '';
  let subtitle = '';

  if (result.kind === 'aes-team') {
    badgeLabel = 'AES';
    badgeColor = colors.primary;
    title = result.teamText || result.teamName;
    subtitle = `${result.divisionName} — ${result.eventName}`;
  } else if (result.kind === 'timu-team') {
    badgeLabel = 'TIMU';
    badgeColor = colors.accent;
    title = result.teamName;
    subtitle = result.tournamentName;
  } else {
    const team = result.team;
    badgeLabel =
      team.source === 'mrs-linked'
        ? 'OVA'
        : team.source === 'mixed'
        ? 'AES+TIMU'
        : team.source.toUpperCase();
    badgeColor =
      team.source === 'timu' || team.source === 'mixed'
        ? colors.accent
        : colors.primary;
    title = team.label;
    subtitle = team.kind === 'watching' ? 'Watching' : 'Me';
    if (team.club) subtitle += ` · ${team.club}`;
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.searchResultRow,
        {
          backgroundColor: colors.surface,
          borderBottomColor: colors.divider,
        },
      ]}
    >
      <View style={[styles.searchBadge, { backgroundColor: badgeColor }]}>
        <Text style={styles.searchBadgeText}>{badgeLabel}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.searchResultTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <Text
          style={[styles.searchResultSub, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      </View>
      <Text style={[styles.searchResultArrow, { color: colors.textLight }]}>›</Text>
    </TouchableOpacity>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
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

  // ── Search section ─────────────────────────────────────────────────────
  searchSection: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    gap: spacing.sm,
  },
  searchIcon: { fontSize: 18 },
  searchInput: {
    flex: 1,
    fontSize: fontSize.md,
    paddingVertical: 4,
  },
  searchClear: { fontSize: fontSize.sm, fontWeight: '600' },
  searchResults: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: 'hidden',
  },
  searchEmpty: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  searchEmptyText: {
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
  },
  searchBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    minWidth: 36,
    alignItems: 'center',
  },
  searchBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  searchResultTitle: { fontSize: fontSize.md, fontWeight: '700' },
  searchResultSub: { fontSize: fontSize.xs, marginTop: 2 },
  searchResultArrow: { fontSize: fontSize.lg, fontWeight: '600' },

  // De-emphasis treatment for the country tree when the user is mid-search.
  browseDimmed: { opacity: 0.55 },
  browseSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
    textTransform: 'uppercase',
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
    fontWeight: '600',
  },
  discoveryRetryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.surface,
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
}
