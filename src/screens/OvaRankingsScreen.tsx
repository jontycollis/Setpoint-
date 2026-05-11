// ── OvaRankingsScreen ──────────────────────────────────────────────────────
//
// Browse the OVA's published team rankings, filtered by gender and division.
// MyTeam aliases (if any) are highlighted in the list and we offer a quick
// "Jump to my team" action when a match is found.
// ────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import { Card } from '../components/Card';
import {
  getRankings,
  loadCachedRankings,
  type OvaDivisionRanking,
  type OvaGender,
  type OvaRankingsSnapshot,
} from '../api/ovaRankings';
import { loadMyTeamAliases, normalizeName } from '../utils/seasonTeamIdentity';

interface Props {
  onBack: () => void;
  /** Optional initial filters (e.g., from a tap on a team-dashboard rank badge). */
  initialDivisionKey?: string;
  initialGender?: OvaGender;
  /**
   * Tap-a-team handler. When set, ranking rows become tappable and call
   * back with the team's name + division label so the parent can create
   * a TeamProfile and kick off auto-discovery. When undefined, the screen
   * falls back to the read-only browse behaviour (no row tap).
   *
   * The parent decides what to render after — typically an Alert
   * confirmation, then a navigation to the team's dashboard.
   */
  onFollowTeam?: (params: {
    teamName: string;
    divisionLabel: string;
    /** True when the team already alias-matches one of the user's
     *  TeamProfiles — caller can offer "re-run discovery" rather than
     *  create a duplicate. */
    alreadyFollowed: boolean;
  }) => void;
}

const ALL_DIVISION_KEYS = ['18U', '17U', '16U', '15U', 'TLS', '6v6', '4v4'] as const;

export function OvaRankingsScreen({
  onBack,
  initialDivisionKey,
  initialGender,
  onFollowTeam,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [snap, setSnap] = useState<OvaRankingsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [gender, setGender] = useState<OvaGender>(initialGender || 'girls');
  const [divisionKey, setDivisionKey] = useState<string>(initialDivisionKey || '18U');
  const [search, setSearch] = useState('');
  const [aliases, setAliases] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      setAliases(await loadMyTeamAliases());
      // Show cached data instantly while we attempt to refresh in the
      // background.
      const cached = await loadCachedRankings();
      if (cached) setSnap(cached);
      try {
        const fresh = await getRankings();
        setSnap(fresh);
      } catch (err: any) {
        if (!cached) {
          Alert.alert(
            'Could not load rankings',
            err?.message || 'Check your network connection and try again.'
          );
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const fresh = await getRankings({ force: true });
      setSnap(fresh);
    } catch (err: any) {
      Alert.alert('Refresh failed', err?.message || 'Unknown error');
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Pick the active division
  const activeDivision: OvaDivisionRanking | null = useMemo(() => {
    if (!snap) return null;
    const list = gender === 'girls' ? snap.girls : snap.boys;
    return list.find((d) => d.divisionKey === divisionKey) || list[0] || null;
  }, [snap, gender, divisionKey]);

  // Choose which two stat columns to display in the table. Of the columns
  // OVA publishes per division, the user cares most about the "latest
  // average" (e.g. "Top 2 Average for OC's", "Top 2 Avg") — that's the
  // headline number that determines OC seeding. Specific cup point columns
  // ("Provincial Cup", "Bugarski Cup", etc.) come second; raw set/match
  // ratios are kept as a fallback for 4v4 / TLS divisions where averages
  // aren't published.
  const displayedStatColumns: string[] = useMemo(() => {
    if (!activeDivision) return [];
    const cols = activeDivision.statColumns.slice();

    const score = (name: string): number => {
      const n = name.toLowerCase();
      // Highest priority: latest average / OC-seed average.
      if (/top\s*2.*(avg|average)|average.*for.*oc|^avg|^average/i.test(name)) return 100;
      if (/avg|average/i.test(name)) return 80;
      // Set / match ratio (used by 4v4 + TLS where there's no avg yet).
      if (/set\s*ratio|match\s*ratio/i.test(name)) return 60;
      // Specific named cups — useful but not the headline.
      if (/cup|bugarski|mcgregor|provincial|challenge/i.test(name)) return 40;
      // Anything else gets a baseline.
      return 20;
    };

    const sorted = cols
      .map((c, idx) => ({ c, idx, s: score(c) }))
      // Stable: prefer higher score, then original page order.
      .sort((a, b) => b.s - a.s || a.idx - b.idx)
      .map((x) => x.c);

    return sorted.slice(0, 2);
  }, [activeDivision]);

  // Available divisions for the picker (some seasons may not have all)
  const availableKeys = useMemo(() => {
    if (!snap) return ALL_DIVISION_KEYS;
    const list = gender === 'girls' ? snap.girls : snap.boys;
    const present = new Set(list.map((d) => d.divisionKey));
    return ALL_DIVISION_KEYS.filter((k) => present.has(k));
  }, [snap, gender]);

  // Filter teams by search
  const filteredTeams = useMemo(() => {
    if (!activeDivision) return [];
    const q = search.toLowerCase().trim();
    if (!q) return activeDivision.teams;
    return activeDivision.teams.filter((t) =>
      t.teamName.toLowerCase().includes(q)
    );
  }, [activeDivision, search]);

  // Find user's team in the active division (if matched)
  const myTeamMatch = useMemo(() => {
    if (!activeDivision || aliases.length === 0) return null;
    const aliasesNorm = aliases.map(normalizeName);
    return activeDivision.teams.find((t) => {
      const n = normalizeName(t.teamName);
      return aliasesNorm.some((a) => a && n === a);
    });
  }, [activeDivision, aliases]);

  const scrollRef = useRef<ScrollView | null>(null);
  const myRowOffsetRef = useRef<number | null>(null);

  return (
    <View style={styles.container}>
      <Hero onBack={onBack} fetchedAt={snap?.fetchedAt} />

      {/* Gender + Division pickers */}
      <View style={styles.toggleBar}>
        <View style={styles.genderToggle}>
          {(['girls', 'boys'] as const).map((g) => (
            <TouchableOpacity
              key={g}
              style={[styles.genderBtn, gender === g && styles.genderBtnActive]}
              onPress={() => setGender(g)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.genderText,
                  gender === g && styles.genderTextActive,
                ]}
              >
                {g === 'girls' ? 'Girls' : 'Boys'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          backgroundColor: '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: '#eeeeee',
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        {availableKeys.map((k) => {
          const isActive = divisionKey === k;
          // FULLY inline-styled chip — bypasses StyleSheet.create entirely
          // because some hot-reload paths can leave a stale style cache that
          // strips the text color. This guarantees the labels render.
          return (
            <TouchableOpacity
              key={k}
              onPress={() => setDivisionKey(k)}
              activeOpacity={0.7}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 10,
                marginRight: 8,
                minWidth: 64,
                minHeight: 36,
                backgroundColor: isActive ? '#1a73e8' : '#ffffff',
                borderRadius: 18,
                borderWidth: 1,
                borderColor: isActive ? '#1a73e8' : '#cccccc',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                numberOfLines={1}
                allowFontScaling={false}
                style={{
                  color: isActive ? '#ffffff' : '#1a1a1a',
                  fontSize: 14,
                  lineHeight: 18,
                  fontWeight: '700',
                  textAlign: 'center',
                }}
              >
                {String(k || '?')}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Search + Jump-to-MyTeam */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search teams..."
          placeholderTextColor={colors.textLight}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {myTeamMatch && (
          <TouchableOpacity
            style={styles.jumpBtn}
            onPress={() => {
              if (myRowOffsetRef.current != null) {
                scrollRef.current?.scrollTo({
                  y: Math.max(0, myRowOffsetRef.current - 80),
                  animated: true,
                });
              }
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.jumpBtnText}>Find me</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading && !snap ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading rankings...</Text>
        </View>
      ) : !activeDivision ? (
        <Card variant="outlined" style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            No rankings available for this gender. Pull down to refresh.
          </Text>
        </Card>
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        >
          <Card style={styles.divHeaderCard}>
            <Text style={styles.divHeaderTitle}>
              {activeDivision.divisionLabel ||
                `${activeDivision.divisionKey} ${gender === 'girls' ? 'Girls' : 'Boys'}`}
            </Text>
            {activeDivision.updateTag ? (
              <Text style={styles.divHeaderTag}>{activeDivision.updateTag}</Text>
            ) : null}
            <Text style={styles.divHeaderCount}>
              {activeDivision.teams.length} teams
              {filteredTeams.length !== activeDivision.teams.length
                ? ` · showing ${filteredTeams.length}`
                : ''}
            </Text>
            {myTeamMatch ? (
              <Text style={styles.myTeamNote}>
                ★ {myTeamMatch.teamName} — rank {myTeamMatch.rank}
              </Text>
            ) : null}
          </Card>

          {/* Column header — uses headerCell* variants so labels are white on the blue bar. */}
          <View style={styles.tableHeader}>
            <Text style={[styles.headerCell, styles.rankCol, styles.headerCellRank]}>#</Text>
            <Text style={[styles.headerCell, styles.teamCol]}>Team</Text>
            {displayedStatColumns.map((c) => (
              <Text key={c} style={[styles.headerCell, styles.statCol]}>
                {abbreviateColumn(c)}
              </Text>
            ))}
          </View>

          {filteredTeams.map((team) => {
            const isMine =
              !!myTeamMatch && team.teamName === myTeamMatch.teamName;
            const rowInner = (
              <>
                <Text style={[styles.tableCell, styles.rankCol, styles.rankText]}>
                  {team.rank}
                </Text>
                <Text
                  style={[
                    styles.tableCell,
                    styles.teamCol,
                    isMine && styles.tableTextMine,
                  ]}
                  numberOfLines={2}
                >
                  {isMine ? '★ ' : ''}
                  {team.teamName}
                </Text>
                {displayedStatColumns.map((c) => (
                  <Text
                    key={c}
                    style={[
                      styles.tableCell,
                      styles.statCol,
                      isMine && styles.tableTextMine,
                    ]}
                  >
                    {team.stats[c] || ''}
                  </Text>
                ))}
                {onFollowTeam ? (
                  <Text
                    style={[
                      styles.followChevron,
                      isMine && { color: colors.primary },
                    ]}
                  >
                    {'›'}
                  </Text>
                ) : null}
              </>
            );
            const onLayout = (e: { nativeEvent: { layout: { y: number } } }) => {
              if (isMine) {
                myRowOffsetRef.current = e.nativeEvent.layout.y;
              }
            };
            const rowStyle = [
              styles.tableRow,
              isMine && styles.tableRowMine,
            ];
            if (onFollowTeam) {
              return (
                <TouchableOpacity
                  key={`${team.rank}-${team.teamName}`}
                  onLayout={onLayout}
                  style={rowStyle}
                  activeOpacity={0.6}
                  onPress={() =>
                    onFollowTeam({
                      teamName: team.teamName,
                      divisionLabel:
                        activeDivision?.divisionLabel ||
                        `${activeDivision?.divisionKey ?? ''} ${gender === 'girls' ? 'Girls' : 'Boys'}`.trim(),
                      alreadyFollowed: isMine,
                    })
                  }
                >
                  {rowInner}
                </TouchableOpacity>
              );
            }
            return (
              <View
                key={`${team.rank}-${team.teamName}`}
                onLayout={onLayout}
                style={rowStyle}
              >
                {rowInner}
              </View>
            );
          })}

          {/* Full-stats footer for the user's team — useful since the
              header only shows the first two stat columns. */}
          {myTeamMatch && activeDivision.statColumns.length > 2 ? (
            <Card style={styles.fullStatsCard}>
              <Text style={styles.fullStatsTitle}>
                {myTeamMatch.teamName} — full stats
              </Text>
              {activeDivision.statColumns.map((c) => (
                <View key={c} style={styles.fullStatsRow}>
                  <Text style={styles.fullStatsLabel}>{c}</Text>
                  <Text style={styles.fullStatsValue}>
                    {myTeamMatch.stats[c] || '—'}
                  </Text>
                </View>
              ))}
            </Card>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function Hero({
  onBack,
  fetchedAt,
}: {
  onBack: () => void;
  fetchedAt?: number;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.hero}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={styles.heroBack}>{'< Back'}</Text>
      </TouchableOpacity>
      <Text style={styles.heroKicker}>OVA</Text>
      <Text style={styles.heroTitle}>Team Rankings</Text>
      {fetchedAt ? (
        <Text style={styles.heroMeta}>{fetchedFreshness(fetchedAt)}</Text>
      ) : null}
    </View>
  );
}

function fetchedFreshness(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just refreshed';
  if (min < 60) return `Updated ${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `Updated ${hr} h ago`;
  const days = Math.round(hr / 24);
  return `Updated ${days} d ago`;
}

/** Squish long column names into something that fits in a narrow column. */
function abbreviateColumn(name: string): string {
  if (name.length <= 6) return name;
  return name
    .replace(/Tournament/i, 'Tourn')
    .replace(/Average/i, 'Avg')
    .replace(/Bugarski/i, 'Bug')
    .replace(/McGregor/i, 'McG')
    .replace(/Provincial/i, 'Prov')
    .replace(/Challenge/i, 'Chal')
    .replace(/Pre-Season|Pre Season/i, 'Pre')
    .replace(/Division Seed/i, 'Seed')
    .replace(/Set Ratio/i, 'Sets')
    .replace(/Top 2 (Average)?\s*for OC's/i, 'OC Avg')
    .replace(/Top 2( Average)?/i, 'Top 2');
}

// ── Styles ────────────────────────────────────────────────────────────────

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  hero: { backgroundColor: colors.primary, padding: spacing.xxl, paddingBottom: spacing.lg },
  heroBack: { color: 'rgba(255,255,255,0.9)', fontSize: fontSize.md, fontWeight: '600', marginBottom: spacing.sm },
  heroKicker: { color: 'rgba(255,255,255,0.7)', fontSize: fontSize.xs, fontWeight: '700', letterSpacing: 1 },
  heroTitle: { color: colors.textOnPrimary, fontSize: fontSize.xxl, fontWeight: '800' },
  heroMeta: { color: 'rgba(255,255,255,0.7)', fontSize: fontSize.xs, marginTop: 2 },

  toggleBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
  },
  genderToggle: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: borderRadius.full,
    padding: 3,
    alignSelf: 'center',
  },
  genderBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  genderBtnActive: { backgroundColor: colors.primary },
  genderText: { color: colors.textSecondary, fontWeight: '700', fontSize: fontSize.sm },
  genderTextActive: { color: colors.textOnPrimary },

  divRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    flexDirection: 'row',
    alignItems: 'center',
  },
  divChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 8,
    minWidth: 64,
    minHeight: 36,
    // No borderRadius:full / overflow:hidden combo — those have clipped
    // text on some Android RN versions. Use a fixed moderate radius.
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#cccccc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  divChipActive: { backgroundColor: '#1a73e8', borderColor: '#1a73e8' },
  divChipText: {
    // Hardcoded dark color so a theme/static-import mismatch can't make this
    // invisible. The labels here ("18U", "TLS", etc.) are critical — without
    // them every chip looks identical.
    color: '#1a1a1a',
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },
  divChipTextActive: { color: '#ffffff' },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  jumpBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: borderRadius.md,
  },
  jumpBtnText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '700' },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.textSecondary, marginTop: spacing.md },
  emptyCard: { margin: spacing.lg, alignItems: 'center' },
  emptyText: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center' },

  list: { padding: spacing.lg, paddingBottom: spacing.xxxl },

  divHeaderCard: {},
  divHeaderTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  divHeaderTag: { fontSize: fontSize.xs, color: colors.primary, marginTop: 2 },
  divHeaderCount: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: spacing.xs },
  myTeamNote: { fontSize: fontSize.sm, color: colors.accent, fontWeight: '700', marginTop: spacing.xs },

  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.xs,
  },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  tableRowMine: {
    backgroundColor: colors.primaryLight,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  tableCell: { fontSize: fontSize.sm, color: colors.text },
  // Used only inside the blue table header — forces white text so the
  // "Team" / stat-column labels remain readable on the primary bg.
  headerCell: {
    fontSize: fontSize.sm,
    color: colors.textOnPrimary,
    fontWeight: '700',
  },
  headerCellRank: { fontWeight: '700' },
  rankCol: { width: 36, textAlign: 'center' },
  rankText: { color: colors.text, fontWeight: '700' },
  teamCol: { flex: 1, paddingRight: spacing.xs },
  statCol: { width: 60, textAlign: 'center', fontVariant: ['tabular-nums'] },
  tableTextMine: { color: colors.primary, fontWeight: '700' },
  followChevron: {
    color: colors.textLight,
    fontSize: 22,
    lineHeight: 22,
    fontWeight: '700',
    marginLeft: spacing.xs,
    width: 16,
    textAlign: 'right',
  },

  fullStatsCard: { marginTop: spacing.md },
  fullStatsTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: spacing.sm,
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  fullStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  fullStatsLabel: { color: colors.textSecondary, fontSize: fontSize.sm },
  fullStatsValue: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
});
}
