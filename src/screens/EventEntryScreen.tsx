import React, { useState } from 'react';
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
import { colors, spacing, fontSize, borderRadius } from '../utils/theme';
import { getEvent, extractEventKey } from '../api/aesClient';
import type { AESEvent, SavedEvent } from '../types/aes';

const PIONEERS_LOGO = require('../../assets/pioneers-logo.png');
const OC_LOGO = require('../../assets/oc-2026-logo.png');
const OVA_LOGO = require('../../assets/ontario-volleyball-logo.png');

// Ontario Championships 2026 events
const OC_EVENTS = [
  {
    key: 'MjAyNl9PbnRhcmlvX0NoYW1waW9uc2hpcHNfX19FdmVudF8xX19UTFNCX18xNVVHX18xN1VCX0df0',
    label: 'Event 1',
    subtitle: 'TLSB, 15UG, 17UB/G',
    dates: 'Apr 16 – 18',
  },
  {
    key: 'MjAyNl9PbnRhcmlvX0NoYW1waW9uc2hpcHNfX19FdmVudF8yX182djZHX19UTFNHX18xNVVCXw2',
    label: 'Event 2',
    subtitle: '6v6G, TLSG, 15UB',
    dates: 'Apr 19 – 21',
  },
  {
    key: 'MjAyNl9PbnRhcmlvX0NoYW1waW9uc2hpcHNfX19FdmVudF8zX182djZCX18xNlVfXzE4VV81',
    label: 'Event 3',
    subtitle: '6v6B, 16U, 18U',
    dates: 'Apr 23 – 25',
  },
];

const VENUE_MAP_URL =
  'https://cdn1.sportngin.com/attachments/document/b853-3557065/2026_OC_s_Map_Enercare.png';

interface Props {
  onEventLoaded: (event: AESEvent) => void;
  onViewVenueMap: () => void;
  savedEvents: SavedEvent[];
}

export function EventEntryScreen({ onEventLoaded, onViewVenueMap, savedEvents }: Props) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingEvent, setLoadingEvent] = useState<string | null>(null);

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
        {/* Logos Row */}
        <View style={styles.logoContainer}>
          <Image
            source={OVA_LOGO}
            style={styles.logoSide}
            resizeMode="contain"
          />
          <Image
            source={OC_LOGO}
            style={styles.logoCentre}
            resizeMode="contain"
          />
          <Image
            source={PIONEERS_LOGO}
            style={styles.logoSide}
            resizeMode="contain"
          />
        </View>

        {/* Ontario Championships Section */}
        <View style={styles.ocSection}>
          <Text style={styles.ocTitle}>2026 Ontario Championships</Text>
          <Text style={styles.ocVenue}>Enercare Centre, Toronto</Text>

          {OC_EVENTS.map((ev) => {
            const isLoading = loadingEvent === ev.key;
            return (
              <TouchableOpacity
                key={ev.key}
                style={[styles.eventCard, isLoading && styles.eventCardLoading]}
                onPress={() => loadEventByKey(ev.key)}
                disabled={!!loadingEvent}
                activeOpacity={0.7}
              >
                <View style={styles.eventCardLeft}>
                  <Text style={styles.eventLabel}>{ev.label}</Text>
                  <Text style={styles.eventSubtitle}>{ev.subtitle}</Text>
                </View>
                <View style={styles.eventCardRight}>
                  <Text style={styles.eventDates}>{ev.dates}</Text>
                  <Text style={styles.eventArrow}>
                    {isLoading ? '...' : '>'}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}

          {/* Venue Map Button */}
          <TouchableOpacity
            style={styles.venueMapButton}
            onPress={onViewVenueMap}
            activeOpacity={0.7}
          >
            <Text style={styles.venueMapIcon}>{'\u{1F5FA}'}</Text>
            <Text style={styles.venueMapText}>Venue Map</Text>
            <Text style={styles.venueMapArrow}>{'>'}</Text>
          </TouchableOpacity>
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
            style={[styles.button, (loading || !url.trim()) && styles.buttonDisabled]}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a1a' },
  scroll: { paddingBottom: spacing.xxxl },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.xl,
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
  ocSection: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  ocTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  ocVenue: {
    fontSize: fontSize.sm,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  eventCardLoading: {
    opacity: 0.6,
  },
  eventCardLeft: { flex: 1 },
  eventLabel: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 2,
  },
  eventSubtitle: {
    fontSize: fontSize.sm,
    color: 'rgba(255,255,255,0.6)',
  },
  eventCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eventDates: {
    fontSize: fontSize.sm,
    color: colors.accent,
    fontWeight: '600',
    marginRight: spacing.sm,
  },
  eventArrow: {
    fontSize: 20,
    color: 'rgba(255,255,255,0.4)',
  },
  venueMapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,107,53,0.15)',
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,107,53,0.3)',
  },
  venueMapIcon: {
    fontSize: 22,
    marginRight: spacing.sm,
  },
  venueMapText: {
    flex: 1,
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.accent,
  },
  venueMapArrow: {
    fontSize: 20,
    color: 'rgba(255,107,53,0.5)',
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
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  dividerText: {
    fontSize: fontSize.sm,
    color: 'rgba(255,255,255,0.4)',
    paddingHorizontal: spacing.md,
  },
  inputSection: {
    paddingHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    fontSize: fontSize.md,
    color: '#ffffff',
    marginBottom: spacing.md,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  savedSection: {
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: spacing.md,
  },
  savedEvent: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  savedEventName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: spacing.xs,
  },
  savedEventLocation: {
    fontSize: fontSize.sm,
    color: 'rgba(255,255,255,0.5)',
  },
});
