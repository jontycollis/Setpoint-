// ── GlobalSearchScreen ────────────────────────────────────────────────────
//
// Reachable from the magnifying-glass icon on the MyHome top-bar. Indexes:
//
//   - Every AES team the user has touched (via aesSeasonIndex snapshots).
//     Each snapshot's `teams[]` contributes one searchable row.
//   - Every Timu team the user has touched (via timuSeasonIndex snapshots).
//   - The user's own TeamProfile rows (me + watching), so familiar teams
//     surface even before any snapshot has been built.
//
// Live-filtered as the user types, case-insensitive substring on team name
// + tournament name. Tapping a result calls onSelect with a discriminator
// — App.tsx routes by kind, reusing the same navigation paths as
// "open from favorites" / "open from MyHome".
//
// Out of scope: MRS member directory, Setpoint-scored matches.
// ────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { spacing, fontSize, borderRadius, useTheme } from '../utils/theme';
import type { UserProfile } from '../types/profile';
import {
  buildGlobalSearchCorpus,
  matchesQuery,
  resultKey,
  type GlobalSearchResult,
} from '../utils/globalSearchCorpus';

// Re-export so the existing App.tsx import still resolves.
export type { GlobalSearchResult } from '../utils/globalSearchCorpus';

interface Props {
  profile: UserProfile | null;
  onBack: () => void;
  onSelect: (result: GlobalSearchResult) => void;
}

export function GlobalSearchScreen({ profile, onBack, onSelect }: Props) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [allResults, setAllResults] = useState<GlobalSearchResult[] | null>(null);

  // Build the searchable corpus once on mount. Cheap — both indices are
  // already in AsyncStorage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out = await buildGlobalSearchCorpus(profile);
      if (cancelled) return;
      setAllResults(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const filtered = useMemo(() => {
    if (!allResults) return null;
    const q = query.trim().toLowerCase();
    if (!q) {
      // Empty query: show the first ~30 entries (profile teams + most-recent
      // touched AES/Timu) as a reasonable "see what's there" view.
      return allResults.slice(0, 30);
    }
    const out: GlobalSearchResult[] = [];
    for (const r of allResults) {
      if (matchesQuery(r, q)) {
        out.push(r);
        if (out.length >= 100) break;
      }
    }
    return out;
  }, [allResults, query]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.headerBar, { backgroundColor: theme.colors.primary }]}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Search</Text>
        <View style={{ width: 50 }} />
      </View>

      <View
        style={[
          styles.searchRow,
          {
            backgroundColor: theme.colors.surface,
            borderBottomColor: theme.colors.divider,
          },
        ]}
      >
        <Text style={[styles.searchIcon, { color: theme.colors.textSecondary }]}>
          {'\u{1F50D}'}
        </Text>
        <TextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder="Team or tournament name…"
          placeholderTextColor={theme.colors.textLight}
          style={[styles.input, { color: theme.colors.text }]}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity
            onPress={() => setQuery('')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.clear, { color: theme.colors.textSecondary }]}>
              Clear
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {filtered == null ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
            {query.trim() ? 'No matches.' : 'Nothing indexed yet.'}
          </Text>
          {!query.trim() && (
            <Text style={[styles.emptyHint, { color: theme.colors.textLight }]}>
              Open a tournament once and its teams will appear here.
            </Text>
          )}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={resultKey}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <ResultRow result={item} onPress={() => onSelect(item)} />
          )}
        />
      )}
    </View>
  );
}

// Filtering / row helpers live in `utils/globalSearchCorpus`.

// ── Row ───────────────────────────────────────────────────────────────────

function ResultRow({
  result,
  onPress,
}: {
  result: GlobalSearchResult;
  onPress: () => void;
}) {
  const theme = useTheme();

  let badgeLabel = '';
  let badgeColor = theme.colors.primary;
  let title = '';
  let subtitle = '';

  if (result.kind === 'aes-team') {
    badgeLabel = 'AES';
    badgeColor = theme.colors.primary;
    title = result.teamText || result.teamName;
    subtitle = `${result.divisionName} — ${result.eventName}`;
  } else if (result.kind === 'timu-team') {
    badgeLabel = 'TIMU';
    badgeColor = theme.colors.accent;
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
        ? theme.colors.accent
        : theme.colors.primary;
    title = team.label;
    subtitle = team.kind === 'watching' ? 'Watching' : 'Me';
    if (team.club) subtitle += ` · ${team.club}`;
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.row,
        {
          backgroundColor: theme.colors.surface,
          borderBottomColor: theme.colors.divider,
        },
      ]}
    >
      <View style={[styles.badge, { backgroundColor: badgeColor }]}>
        <Text style={styles.badgeText}>{badgeLabel}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <Text
          style={[styles.subtitle, { color: theme.colors.textSecondary }]}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      </View>
      <Text style={[styles.arrow, { color: theme.colors.textLight }]}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backText: { color: '#fff', fontSize: fontSize.md, fontWeight: '600' },
  headerTitle: {
    color: '#fff',
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    gap: spacing.sm,
  },
  searchIcon: { fontSize: 18 },
  input: {
    flex: 1,
    fontSize: fontSize.md,
    paddingVertical: 0,
  },
  clear: { fontSize: fontSize.sm, fontWeight: '600' },
  loading: { padding: spacing.xxl, alignItems: 'center' },
  empty: { padding: spacing.xxl, alignItems: 'center' },
  emptyText: { fontSize: fontSize.md, fontWeight: '600' },
  emptyHint: {
    marginTop: spacing.xs,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    minWidth: 36,
    alignItems: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  title: { fontSize: fontSize.md, fontWeight: '700' },
  subtitle: { fontSize: fontSize.xs, marginTop: 2 },
  arrow: { fontSize: fontSize.lg, fontWeight: '600' },
});
