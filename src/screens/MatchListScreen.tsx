// ── MatchListScreen ────────────────────────────────────────────────────────
//
// Tier 2 entry list. Shows saved matches (in-progress + complete +
// abandoned), with "+ New Match" CTA. Tap a match → resume scoring
// (or view summary if complete). Long-press → delete.
// ────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  RefreshControl,
} from 'react-native';
import {
  useTheme,
  spacing,
  fontSize,
  borderRadius,
} from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { Match } from '../types/match';
import { deleteMatch } from '../utils/scoredMatchStore';
import { deriveMatchState } from '../utils/matchEngine';
import { exportMatchScoresheetPdf } from '../utils/scoresheetPrint';
// Use the normalising loader so legacy matches missing the new
// classification fields (matchKind / includeInStats / source) still
// render with sensible defaults. The "In analytics" chip relies on
// `meta.includeInStats` being populated.
import { loadNormalisedMatches, setMatchInclusion } from '../utils/matchMeta';

interface Props {
  onBack: () => void;
  onNewMatch: () => void;
  onOpenMatch: (match: Match) => void;
  onOpenStats?: (teamProfileId: string, teamName: string) => void;
}

export function MatchListScreen({ onBack, onNewMatch, onOpenMatch, onOpenStats }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [matches, setMatches] = useState<Match[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await loadNormalisedMatches();
      setMatches(list);
    } catch {
      /* ignore */
    }
  }, []);

  // Flip the per-match `includeInStats` flag without leaving the list.
  // Optimistic local update so the chip animates immediately; the
  // store write happens in the background and a failure rolls back via
  // the next refresh.
  const onToggleInclude = useCallback(
    async (match: Match) => {
      const next = !match.meta.includeInStats;
      setMatches((prev) =>
        prev.map((m) =>
          m.id === match.id
            ? { ...m, meta: { ...m.meta, includeInStats: next } }
            : m
        )
      );
      try {
        await setMatchInclusion(match.id, next);
      } catch {
        await refresh();
      }
    },
    [refresh]
  );

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const onPull = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const onLongPress = useCallback(
    (match: Match) => {
      Alert.alert(
        'Delete match?',
        `${match.meta.matchLabel || match.meta.eventName || 'Match'} will be permanently removed.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              await deleteMatch(match.id);
              await refresh();
            },
          },
        ]
      );
    },
    [refresh]
  );

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backBtn}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>SCORE A MATCH</Text>
        <View style={{ width: 80 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPull} tintColor={colors.primary} />}
      >
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={[styles.newBtn, { flex: 1 }]} onPress={onNewMatch} activeOpacity={0.7}>
            <Text style={styles.newBtnText}>+ New Match</Text>
          </TouchableOpacity>
          {onOpenStats && matches.length > 0 ? (
            <TouchableOpacity
              style={[styles.newBtn, { flex: 1, backgroundColor: colors.accent }]}
              onPress={() => {
                // Find the first team profile in scored matches
                const m = matches[0];
                const profileId = m.meta.home.teamProfileId || m.meta.away.teamProfileId || m.id;
                const name = m.meta.home.teamProfileId ? m.meta.home.label : m.meta.away.label;
                onOpenStats(profileId, name);
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.newBtnText}>📊 Team Analytics</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {loading ? null : matches.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No matches yet</Text>
            <Text style={styles.emptyBody}>
              Tap "+ New Match" to set up rosters, lineups, and start scoring.
              Matches save automatically as you go and survive app restarts.
            </Text>
          </View>
        ) : (
          matches.map((m) => (
            <MatchRow
              key={m.id}
              match={m}
              onOpen={() => onOpenMatch(m)}
              onLongPress={() => onLongPress(m)}
              onToggleInclude={() => onToggleInclude(m)}
              colors={colors}
              styles={styles}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function MatchRow({
  match,
  onOpen,
  onLongPress,
  onToggleInclude,
  colors,
  styles,
}: {
  match: Match;
  onOpen: () => void;
  onLongPress: () => void;
  onToggleInclude: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const state = deriveMatchState(match);
  const status = state.abandoned ? 'abandoned' : state.matchComplete ? 'complete' : 'in-progress';
  const home = match.meta.home.label || 'Home';
  const away = match.meta.away.label || 'Away';
  const dateLabel = new Date(match.meta.dateMs).toLocaleDateString();
  const include = !!match.meta.includeInStats;

  let scoreLine: string;
  if (state.matchComplete && !state.abandoned) {
    scoreLine = `${home} ${state.setsWon.home}–${state.setsWon.away} ${away}`;
  } else if (state.currentSet) {
    scoreLine = `Set ${state.currentSetIndex + 1} · ${home} ${state.currentSet.score.home}–${state.currentSet.score.away} ${away}`;
  } else {
    scoreLine = `${home} vs ${away}`;
  }

  // Card is a plain View so the open/long-press touchable and the
  // include-toggle touchable can sit as siblings without nesting. The
  // include chip lives bottom-right under the meta line so it never
  // overlaps the status chip up top.
  return (
    <View style={styles.matchCard}>
      <TouchableOpacity
        style={styles.matchCardMain}
        onPress={onOpen}
        onLongPress={onLongPress}
        delayLongPress={500}
        activeOpacity={0.7}
      >
        <View style={styles.matchCardTop}>
          <Text style={styles.matchLabel} numberOfLines={1}>
            {match.meta.matchLabel || match.meta.eventName || 'Match'}
          </Text>
          <View style={[styles.statusChip, status === 'in-progress' ? styles.statusInProgress : status === 'complete' ? styles.statusComplete : styles.statusAbandoned]}>
            <Text style={styles.statusChipText}>{status}</Text>
          </View>
        </View>
        <Text style={styles.matchScore} numberOfLines={1}>
          {scoreLine}
        </Text>
        <Text style={styles.matchMeta} numberOfLines={1}>
          {match.meta.eventName ? match.meta.eventName + ' · ' : ''}
          {match.meta.division ? match.meta.division + ' · ' : ''}
          {dateLabel}
        </Text>
      </TouchableOpacity>
      <View style={styles.matchCardActions}>
        <TouchableOpacity
          style={[styles.includeChip, include && styles.includeChipOn]}
          onPress={onToggleInclude}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
          accessibilityRole="switch"
          accessibilityLabel={include ? 'Included in analytics' : 'Excluded from analytics'}
          accessibilityState={{ checked: include }}
        >
          <Text style={[styles.includeChipText, include && styles.includeChipTextOn]}>
            {include ? '✓ In analytics' : 'Excluded'}
          </Text>
        </TouchableOpacity>
        {status === 'complete' ? (
          <TouchableOpacity
            style={styles.printChip}
            onPress={() => void exportMatchScoresheetPdf(match)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Export scoresheet PDF"
          >
            <Text style={styles.printChipText}>🖨 PDF</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: spacing.lg,
      paddingRight: 64,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    backBtn: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
    title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800', letterSpacing: 1 },

    body: { padding: spacing.lg, paddingBottom: spacing.xxxl },

    newBtn: {
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginBottom: spacing.lg,
    },
    newBtnText: { color: colors.textOnPrimary, fontWeight: '800', fontSize: fontSize.md },

    emptyCard: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      padding: spacing.lg,
      alignItems: 'center',
    },
    emptyTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800', marginBottom: spacing.sm },
    emptyBody: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center', lineHeight: 20 },

    matchCard: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
    },
    // Wraps the open/long-press touchable inside the card so the
    // include-toggle chip can be a sibling without nesting touchables.
    matchCardMain: {},
    matchCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    matchLabel: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', flex: 1 },
    matchScore: { color: colors.text, fontSize: fontSize.sm, marginTop: 4, fontWeight: '600' },
    matchMeta: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },

    statusChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: borderRadius.sm,
      marginLeft: spacing.sm,
    },
    statusChipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, color: '#ffffff', textTransform: 'uppercase' },
    statusInProgress: { backgroundColor: colors.primary },
    statusComplete: { backgroundColor: colors.success },
    statusAbandoned: { backgroundColor: colors.error },

    // Bottom row inside each card. Right-aligns the include chip
    // beneath the meta line so it never sits next to the status chip.
    matchCardActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    includeChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: borderRadius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    includeChipOn: {
      backgroundColor: colors.success,
      borderColor: colors.success,
    },
    includeChipText: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.textSecondary,
      letterSpacing: 0.3,
    },
    includeChipTextOn: { color: '#ffffff' },
    printChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: borderRadius.full,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.background,
    },
    printChipText: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.primary,
      letterSpacing: 0.3,
    },
  });
}
