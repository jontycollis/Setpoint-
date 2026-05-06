import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import { getEvent, extractEventKey } from '../api/aesClient';
import type { AESEvent, SavedEvent } from '../types/aes';
import type {
  Country,
  Tournament,
  TournamentYear,
  TournamentEvent,
} from '../config/tournaments';

// Logos — loaded conditionally based on tournament
const LOGO_MAP: Record<string, any> = {
  'ontario-championships': {
    centre: require('../../assets/oc-2026-logo.png'),
    left: require('../../assets/ontario-volleyball-logo.png'),
    right: require('../../assets/pioneers-logo.png'),
  },
};

interface Props {
  onEventLoaded: (event: AESEvent) => void;
  onViewVenueMap: (venueMapUrl?: string, infoPageUrl?: string) => void;
  onBack: () => void;
  savedEvents: SavedEvent[];
  // Tournament context from selection screen
  country: Country;
  tournament: Tournament;
  tournamentYear: TournamentYear;
}

export function EventEntryScreen({
  onEventLoaded,
  onViewVenueMap,
  onBack,
  savedEvents,
  country,
  tournament,
  tournamentYear,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingEvent, setLoadingEvent] = useState<string | null>(null);

  const logos = LOGO_MAP[tournament.id];
  // Check if any events have venue maps, or if there's a year-level one
  const hasAnyVenueMap =
    !!tournamentYear.venueMapUrl ||
    !!tournamentYear.infoPageUrl ||
    tournamentYear.events.some((ev) => !!ev.venueMapUrl || !!ev.infoPageUrl);

  async function loadEvent(eventUrl: string) {
    const key = extractEventKey(eventUrl);
    if (!key) {
      Alert.alert('Invalid URL', 'Please paste a valid AES event URL.');
      return;
    }
    setLoading(true);
    try {
      const event = await getEvent(key);
      onEventLoaded(event);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to load event');
    } finally {
      setLoading(false);
    }
  }

  async function loadEventByKey(key: string) {
    setLoadingEvent(key);
    try {
      const event = await getEvent(key);
      onEventLoaded(event);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to load event');
    } finally {
      setLoadingEvent(null);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Back button */}
        <TouchableOpacity
          style={styles.backRow}
          onPress={onBack}
          activeOpacity={0.6}
        >
          <Text style={styles.backArrow}>{'‹'}</Text>
          <Text style={styles.backLabel}>Tournaments</Text>
        </TouchableOpacity>

        {/* Logos Row — tournament-specific or generic */}
        {logos ? (
          <View style={styles.logoContainer}>
            <Image
              source={logos.left}
              style={styles.logoSide}
              resizeMode="contain"
            />
            <Image
              source={logos.centre}
              style={styles.logoCentre}
              resizeMode="contain"
            />
            <Image
              source={logos.right}
              style={styles.logoSide}
              resizeMode="contain"
            />
          </View>
        ) : (
          <View style={styles.genericHeader}>
            <Text style={styles.genericIcon}>{tournament.icon}</Text>
          </View>
        )}

        {/* Tournament Title */}
        <View style={styles.ocSection}>
          <Text style={styles.ocTitle}>
            {tournamentYear.year} {tournament.name}
          </Text>
          {tournamentYear.venue && (
            <Text style={styles.ocVenue}>{tournamentYear.venue}</Text>
          )}

          {/* Event Cards */}
          {tournamentYear.events.map((ev) => {
            const isLoading = loadingEvent === ev.key;
            const eventVenueMap = ev.venueMapUrl || tournamentYear.venueMapUrl;
            const eventInfoPage = ev.infoPageUrl || tournamentYear.infoPageUrl;
            const showMapButton = !!eventVenueMap || !!eventInfoPage;
            return (
              <View key={ev.key}>
                <TouchableOpacity
                  style={[styles.eventCard, isLoading && styles.eventCardLoading]}
                  onPress={() => loadEventByKey(ev.key)}
                  disabled={!!loadingEvent}
                  activeOpacity={0.7}
                >
                  <View style={styles.eventCardLeft}>
                    <Text style={styles.eventLabel}>{ev.label}</Text>
                    <Text style={styles.eventSubtitle}>{ev.subtitle}</Text>
                    {ev.venue && (
                      <Text style={styles.eventVenue}>{ev.venue}</Text>
                    )}
                  </View>
                  <View style={styles.eventCardRight}>
                    <Text style={styles.eventDates}>{ev.dates}</Text>
                    <Text style={styles.eventArrow}>
                      {isLoading ? '...' : '>'}
                    </Text>
                  </View>
                </TouchableOpacity>
                {showMapButton && (
                  <TouchableOpacity
                    style={styles.venueMapButtonInline}
                    onPress={() => onViewVenueMap(eventVenueMap, eventInfoPage)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.venueMapIconSmall}>{'\u{1F5FA}'}</Text>
                    <Text style={styles.venueMapTextSmall}>Venue Map</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>

        {/* Divider */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or enter any AES event</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Manual URL Entry */}
        <View style={styles.inputSection}>
          <TextInput
            style={styles.input}
            placeholder="Paste an AES event URL..."
            placeholderTextColor={colors.textLight}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TouchableOpacity
            style={[
              styles.button,
              (loading || !url.trim()) && styles.buttonDisabled,
            ]}
            onPress={() => loadEvent(url)}
            disabled={loading || !url.trim()}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Loading...' : 'Load Event'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Saved Events */}
        {savedEvents.length > 0 && (
          <View style={styles.savedSection}>
            <Text style={styles.sectionTitle}>Recent Events</Text>
            {savedEvents.map((event) => (
              <TouchableOpacity
                key={event.key}
                style={styles.savedEvent}
                onPress={() =>
                  loadEvent(
                    `https://results.advancedeventsystems.com/event/${event.key}/home`
                  )
                }
                disabled={loading}
              >
                <Text style={styles.savedEventName} numberOfLines={2}>
                  {event.name}
                </Text>
                <Text style={styles.savedEventLocation} numberOfLines={1}>
                  {event.location}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingBottom: spacing.xxxl },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
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
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  logoSide: {
    width: 90,
    height: 90,
  },
  logoCentre: {
    width: 140,
    height: 140,
    marginHorizontal: spacing.sm,
  },
  genericHeader: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  genericIcon: {
    fontSize: 64,
  },
  ocSection: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  ocTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '900',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
    letterSpacing: -0.3,
  },
  ocVenue: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  eventCard: {
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
  eventCardLoading: {
    opacity: 0.6,
  },
  eventCardLeft: { flex: 1 },
  eventLabel: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  eventSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  eventVenue: {
    fontSize: fontSize.xs,
    color: colors.textLight,
    marginTop: 2,
  },
  eventCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eventDates: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: '700',
    marginRight: spacing.sm,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
  },
  eventArrow: {
    fontSize: 20,
    color: colors.textLight,
  },
  venueMapButtonInline: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    marginTop: -spacing.xs,
  },
  venueMapIconSmall: {
    fontSize: 14,
    marginRight: spacing.xs,
  },
  venueMapTextSmall: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.primary,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontSize: fontSize.sm,
    color: colors.textLight,
    paddingHorizontal: spacing.md,
  },
  inputSection: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    fontSize: fontSize.md,
    color: colors.text,
    marginBottom: spacing.md,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  savedSection: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  savedEvent: {
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
  savedEventName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  savedEventLocation: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
});
}
