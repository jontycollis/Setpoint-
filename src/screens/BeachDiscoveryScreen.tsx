// ── BeachDiscoveryScreen ──────────────────────────────────────────────────
//
// Renders the MyTeam.Click discovery flow (#5) — beach tournaments in
// a user-specified radius around a location. Pulls live data via
// `discoverBeachTournaments` (which already does sport classification +
// org/venue resolution); this screen owns the radius/location form,
// the loading + empty states, and the result list.
//
// Auth handoff: we require a saved MyTeam.Click session. If none is
// present, the screen renders a CTA back to the MyTeam.Click connect
// screen instead of the form — same pattern as the SidelineHD import
// flow.
// ──────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import {
  discoverBeachTournaments,
  type DiscoveredTournament,
} from '../utils/beachDiscovery';
import {
  loadMyTeamClickSession,
  type MyTeamClickSessionRecord,
} from '../utils/myteamClickSession';
import type { MtcSearchArea } from '../api/myteamClickClient';

interface Props {
  onBack: () => void;
  /** Tap a tournament → caller routes (typically to a detail screen
   *  or queues an index). Optional; row is read-only when undefined. */
  onOpenTournament?: (tournament: DiscoveredTournament) => void;
  /** Tap "Connect MyTeam.Click" → caller opens the connection screen.
   *  Optional; the CTA falls back to an alert when undefined. */
  onOpenConnect?: () => void;
}

const DEFAULT_SEARCH_AREA: MtcSearchArea = {
  // Toronto centroid — same default the SPA uses when geolocation
  // permission isn't granted yet. The user can edit before searching.
  loc: 'Toronto, ON, Canada',
  lat: 43.653226,
  long: -79.3831843,
  radius: 200,
};

export function BeachDiscoveryScreen({
  onBack,
  onOpenTournament,
  onOpenConnect,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [session, setSession] = useState<MyTeamClickSessionRecord | null>(
    null
  );
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [searchArea, setSearchArea] =
    useState<MtcSearchArea>(DEFAULT_SEARCH_AREA);
  const [radiusInput, setRadiusInput] = useState(String(searchArea.radius));
  const [results, setResults] = useState<DiscoveredTournament[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Load saved session on mount. Drives the "connect" CTA vs the
  // search form choice.
  useEffect(() => {
    let cancelled = false;
    void loadMyTeamClickSession().then((s) => {
      if (cancelled) return;
      setSession(s);
      setSessionLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const runSearch = useCallback(async () => {
    if (!session) return;
    const radius = parseInt(radiusInput, 10);
    const nextArea: MtcSearchArea = {
      ...searchArea,
      radius: Number.isFinite(radius) && radius > 0 ? radius : searchArea.radius,
    };
    setSearchArea(nextArea);
    setLoading(true);
    setErrorMessage(null);
    try {
      const tournaments = await discoverBeachTournaments({
        session: { jwt: session.jwt },
        searchArea: nextArea,
        sport: 'beach',
      });
      setResults(tournaments);
      setHasSearched(true);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [session, radiusInput, searchArea]);

  // ── Connect CTA (no session) ────────────────────────────────────────────
  if (sessionLoaded && !session) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn}>
            <Text style={styles.backLabel}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Discover beach tournaments</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>
            Link your MyTeam.Click account
          </Text>
          <Text style={styles.emptyBody}>
            Bior surfaces beach tournaments from MyTeam.Click — the
            platform OPVC, Helix Volley, JNP Memorial and others use.
            Sign in once and your linked account stays connected.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => {
              if (onOpenConnect) onOpenConnect();
              else
                Alert.alert(
                  'Not wired',
                  'The connection flow is available from Connections & Settings.'
                );
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.primaryBtnLabel}>Connect MyTeam.Click</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Main form + results ─────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backLabel}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Discover beach tournaments</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.formCard}>
        <Text style={styles.formLabel}>Search radius (km)</Text>
        <TextInput
          style={styles.radiusInput}
          value={radiusInput}
          onChangeText={setRadiusInput}
          keyboardType="number-pad"
          placeholder="200"
          placeholderTextColor={colors.textLight}
          returnKeyType="search"
          onSubmitEditing={runSearch}
        />
        <Text style={styles.formMeta}>Around {searchArea.loc}</Text>
        <TouchableOpacity
          style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
          onPress={runSearch}
          disabled={loading}
          activeOpacity={0.7}
        >
          <Text style={styles.primaryBtnLabel}>
            {loading ? 'Searching…' : 'Search'}
          </Text>
        </TouchableOpacity>
        {errorMessage ? (
          <Text style={styles.errorText}>{errorMessage}</Text>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading && results.length === 0 ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingLabel}>
              Searching MyTeam.Click…
            </Text>
          </View>
        ) : null}

        {!loading && hasSearched && results.length === 0 ? (
          <View style={styles.emptyCardSmall}>
            <Text style={styles.emptyTitle}>No beach tournaments</Text>
            <Text style={styles.emptyBody}>
              Try widening the radius or shifting your search center.
              Indoor-only events are filtered out — connect the indoor
              platforms (AES, Timu) from the team picker instead.
            </Text>
          </View>
        ) : null}

        {results.map((t) => (
          <TouchableOpacity
            key={t.eventId}
            style={[
              styles.row,
              t.canceled && styles.rowCanceled,
            ]}
            activeOpacity={onOpenTournament ? 0.7 : 1}
            disabled={!onOpenTournament}
            onPress={() => onOpenTournament?.(t)}
          >
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {t.tournamentName}
                {t.canceled ? '  (Canceled)' : ''}
              </Text>
              <Text style={styles.rowMeta}>
                {formatRowMeta(t)}
              </Text>
              <Text style={styles.rowCapacity}>
                {capacitySummary(t)}
              </Text>
              {t.regStartDate ? (
                <Text style={styles.rowReg}>
                  Registration opens {formatDate(t.regStartDate)}
                </Text>
              ) : null}
            </View>
            {onOpenTournament ? (
              <Text style={styles.chevron}>›</Text>
            ) : null}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function formatRowMeta(t: DiscoveredTournament): string {
  const parts: string[] = [];
  parts.push(formatDate(t.dateText));
  if (t.venueName) parts.push(t.venueName);
  if (t.orgName) parts.push(t.orgName);
  return parts.join(' · ');
}

function capacitySummary(t: DiscoveredTournament): string {
  if (t.totalCapacity === 0) return 'Open registration';
  return `${t.totalRegistered} / ${t.totalCapacity} teams across ${t.groups.length} divisions`;
}

function formatDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    backBtn: {
      paddingVertical: spacing.xs,
    },
    backLabel: {
      fontSize: fontSize.sm,
      color: colors.primary,
      fontWeight: '600',
    },
    title: {
      fontSize: fontSize.md,
      fontWeight: '800',
      color: colors.text,
      flex: 1,
      textAlign: 'center',
    },
    headerSpacer: {
      width: 60,
    },
    formCard: {
      marginHorizontal: spacing.md,
      marginBottom: spacing.sm,
      padding: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    formLabel: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.textLight,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: spacing.xs,
    },
    radiusInput: {
      borderWidth: 1,
      borderColor: colors.divider,
      borderRadius: borderRadius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      fontSize: fontSize.md,
      color: colors.text,
      marginBottom: spacing.xs,
    },
    formMeta: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      marginBottom: spacing.sm,
    },
    primaryBtn: {
      paddingVertical: spacing.md,
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      alignItems: 'center',
    },
    primaryBtnDisabled: {
      opacity: 0.6,
    },
    primaryBtnLabel: {
      color: '#ffffff',
      fontSize: fontSize.md,
      fontWeight: '700',
    },
    errorText: {
      marginTop: spacing.xs,
      color: '#c0392b',
      fontSize: fontSize.xs,
    },
    scroll: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xl,
      gap: spacing.sm,
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.md,
      justifyContent: 'center',
    },
    loadingLabel: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
    emptyCard: {
      margin: spacing.md,
      padding: spacing.lg,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    emptyCardSmall: {
      padding: spacing.lg,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    emptyTitle: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.text,
      marginBottom: spacing.xs,
    },
    emptyBody: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: spacing.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    rowCanceled: {
      opacity: 0.55,
    },
    rowMain: {
      flex: 1,
    },
    rowTitle: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    rowMeta: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      marginTop: 2,
    },
    rowCapacity: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      marginTop: 2,
    },
    rowReg: {
      fontSize: fontSize.xs,
      color: colors.primary,
      fontWeight: '600',
      marginTop: 2,
    },
    chevron: {
      fontSize: fontSize.lg,
      color: colors.textLight,
      paddingLeft: spacing.sm,
    },
  });
}
