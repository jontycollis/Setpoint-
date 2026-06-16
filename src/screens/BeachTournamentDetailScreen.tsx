// ── BeachTournamentDetailScreen ───────────────────────────────────────────
//
// Per-event view for a MyTeam.Click tournament. Reached from
// BeachDiscoveryScreen when the user taps a result row, or from the
// future "indexed beach events" surface. Shows:
//
//   - Event header (name, date, venue, organizer)
//   - Per-division breakdown (group name, team count, registered/full)
//   - Team list per division when the schedule is published
//   - Big "Index this tournament" action that snapshots the event
//     into local storage so it flows into the unified history
//     (SeasonHistory, AthleteDetail, "Where you fit in" analytics)
//
// Auth: requires a saved MyTeam.Click session (same as Discovery).
// Falls back to a connect CTA when missing.
//
// Indexing pipeline:
//   fetchEventSchedule (already fetched at mount) →
//   buildMtcSnapshotFromSchedule (tied to session.playerId) →
//   saveMtcSnapshot
//
// Re-indexing is non-destructive — it replaces the prior snapshot for
// the same event id, picking up new results / brackets.
// ──────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import {
  fetchEventSchedule,
  type MtcScheduleResponse,
} from '../api/myteamClickClient';
import {
  loadMyTeamClickSession,
  type MyTeamClickSessionRecord,
} from '../utils/myteamClickSession';
import {
  buildMtcSnapshotFromSchedule,
  loadMtcSeasonIndex,
  saveMtcSnapshot,
} from '../utils/myteamClickSeasonIndex';

interface Props {
  eventId: string;
  /** Pre-known tournament name from the discovery row. Shown as the
   *  header until the full schedule loads. */
  initialName?: string;
  onBack: () => void;
  /** Optional cross-nav when no session is present. */
  onOpenConnect?: () => void;
  /** Called after a successful index — parent typically pops back to
   *  the discovery list and may want to surface a toast. */
  onIndexed?: (eventId: string) => void;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'no-session' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; schedule: MtcScheduleResponse };

export function BeachTournamentDetailScreen({
  eventId,
  initialName,
  onBack,
  onOpenConnect,
  onIndexed,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [session, setSession] = useState<MyTeamClickSessionRecord | null>(
    null
  );
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [alreadyIndexed, setAlreadyIndexed] = useState(false);
  const [indexing, setIndexing] = useState(false);

  // Load session + schedule on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await loadMyTeamClickSession();
      if (cancelled) return;
      setSession(s);
      if (!s) {
        setState({ kind: 'no-session' });
        return;
      }
      try {
        const schedule = await fetchEventSchedule(
          { jwt: s.jwt },
          { eventId }
        );
        if (cancelled) return;
        setState({ kind: 'ready', schedule });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // Reflect "already indexed" state from the local store so the user
  // sees "Re-index (last indexed Jun 5)" rather than a generic prompt.
  const [lastIndexedAt, setLastIndexedAt] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadMtcSeasonIndex().then((idx) => {
      if (cancelled) return;
      const snap = idx[eventId];
      if (snap) {
        setAlreadyIndexed(true);
        setLastIndexedAt(snap.indexedAt);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const handleIndex = useCallback(async () => {
    if (state.kind !== 'ready' || !session) return;
    setIndexing(true);
    try {
      const snapshot = buildMtcSnapshotFromSchedule({
        response: state.schedule,
        myPlayerId: session.playerId,
        myPlayerName: {
          firstName: session.firstName,
          lastName: session.lastName,
        },
      });
      await saveMtcSnapshot(snapshot);
      setAlreadyIndexed(true);
      setLastIndexedAt(snapshot.indexedAt);
      if (onIndexed) onIndexed(eventId);
      else
        Alert.alert(
          'Indexed',
          'This tournament now appears in your beach history.'
        );
    } catch (err) {
      Alert.alert(
        'Indexing failed',
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      setIndexing(false);
    }
  }, [state, session, eventId, onIndexed]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backLabel}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {state.kind === 'ready' ? state.schedule.event.name : initialName ?? 'Tournament'}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {state.kind === 'loading' ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingLabel}>Loading tournament…</Text>
          </View>
        ) : null}

        {state.kind === 'no-session' ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Link MyTeam.Click first</Text>
            <Text style={styles.emptyBody}>
              Sign in once and this tournament — plus every other one
              you can see in the discovery list — becomes browsable
              and indexable.
            </Text>
            {onOpenConnect ? (
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={onOpenConnect}
                activeOpacity={0.7}
              >
                <Text style={styles.primaryBtnLabel}>
                  Connect MyTeam.Click
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {state.kind === 'error' ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Couldn’t load tournament</Text>
            <Text style={styles.emptyBody}>{state.message}</Text>
          </View>
        ) : null}

        {state.kind === 'ready' ? (
          <DetailBody
            schedule={state.schedule}
            colors={colors}
            styles={styles}
            onIndex={handleIndex}
            indexing={indexing}
            alreadyIndexed={alreadyIndexed}
            lastIndexedAt={lastIndexedAt}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function DetailBody({
  schedule,
  colors,
  styles,
  onIndex,
  indexing,
  alreadyIndexed,
  lastIndexedAt,
}: {
  schedule: MtcScheduleResponse;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  onIndex: () => void;
  indexing: boolean;
  alreadyIndexed: boolean;
  lastIndexedAt: number | null;
}) {
  const ev = schedule.event;
  const venue = ev.locList[0]?.name;
  const totalTeams = ev.groups.reduce((n, g) => n + (g.teams?.length ?? 0), 0);

  return (
    <>
      {/* Header card — single source of "what is this event" */}
      <View style={styles.headerCard}>
        <Text style={styles.headerTitle}>{ev.name}</Text>
        <Text style={styles.headerMeta}>
          {formatDate(ev.date)}
          {venue ? ` · ${venue}` : ''}
        </Text>
        {ev.orgRef?.name ? (
          <Text style={styles.headerOrg}>
            Hosted by {ev.orgRef.name}
          </Text>
        ) : null}
        <Text style={styles.headerSummary}>
          {ev.groups.length === 1 ? '1 division' : `${ev.groups.length} divisions`}
          {totalTeams > 0
            ? ` · ${totalTeams === 1 ? '1 team' : `${totalTeams} teams`}`
            : ''}
        </Text>
      </View>

      {/* Index CTA */}
      <View style={styles.indexCard}>
        <Text style={styles.indexKicker}>Save to your history</Text>
        <Text style={styles.indexBody}>
          {alreadyIndexed
            ? 'This tournament is already in your history. Re-index to pick up updated results.'
            : 'Index this tournament so it appears in SeasonHistory, AthleteDetail, and your beach analytics.'}
        </Text>
        <TouchableOpacity
          style={[styles.primaryBtn, indexing && styles.primaryBtnDisabled]}
          disabled={indexing}
          onPress={onIndex}
          activeOpacity={0.7}
        >
          <Text style={styles.primaryBtnLabel}>
            {indexing
              ? 'Indexing…'
              : alreadyIndexed
                ? 'Re-index this tournament'
                : 'Index this tournament'}
          </Text>
        </TouchableOpacity>
        {alreadyIndexed && lastIndexedAt != null ? (
          <Text style={styles.indexMeta}>
            Last indexed {formatRelative(lastIndexedAt)}
          </Text>
        ) : null}
      </View>

      {/* Per-group breakdown */}
      {ev.groups.map((group) => (
        <View key={group._id} style={styles.groupCard}>
          <Text style={styles.groupName}>{group.name}</Text>
          <Text style={styles.groupMeta}>
            {groupTeamsLabel(group.teams)}
          </Text>
          {(group.teams ?? []).length > 0 ? (
            <View style={styles.teamList}>
              {(group.teams ?? []).slice(0, 12).map((team) => (
                <View key={team._id} style={styles.teamRow}>
                  <Text style={styles.teamName} numberOfLines={1}>
                    {team.name && team.name !== '?'
                      ? team.name
                      : formatSlots(team.slots)}
                  </Text>
                  {team.groupPos != null ? (
                    <Text style={styles.teamPos}>#{team.groupPos}</Text>
                  ) : null}
                </View>
              ))}
              {(group.teams?.length ?? 0) > 12 ? (
                <Text style={styles.teamMore}>
                  + {(group.teams?.length ?? 0) - 12} more
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ))}
    </>
  );
}

function groupTeamsLabel(
  teams: MtcScheduleResponse['event']['groups'][number]['teams']
): string {
  const list = teams ?? [];
  if (list.length === 0) return 'No teams registered yet';
  const withFinish = list.filter((t) => t.groupPos != null).length;
  if (withFinish === list.length && list.length > 0) {
    return `${list.length} teams · final standings published`;
  }
  return `${list.length} ${list.length === 1 ? 'team' : 'teams'} registered`;
}

function formatSlots(
  slots: MtcScheduleResponse['event']['groups'][number]['teams'][number]['slots']
): string {
  const list = slots ?? [];
  if (list.length === 0) return 'Unnamed team';
  return list
    .map((s) => {
      const fn = (s.firstName ?? '').trim();
      const ln = (s.lastName ?? '').trim();
      if (!fn && !ln) return '';
      // Beach pair format ("A.Collis" style) when the firstName looks
      // like an initial; otherwise "First Last".
      return /^[A-Z]\.?$/.test(fn) ? `${fn}${ln}` : `${fn}${fn && ln ? ' ' : ''}${ln}`;
    })
    .filter(Boolean)
    .join(' / ');
}

function formatDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
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
    scroll: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xl,
      gap: spacing.sm,
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.lg,
      justifyContent: 'center',
    },
    loadingLabel: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
    emptyCard: {
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
    headerCard: {
      padding: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    headerTitle: {
      fontSize: fontSize.lg,
      fontWeight: '800',
      color: colors.text,
      marginBottom: spacing.xs,
    },
    headerMeta: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      marginBottom: 2,
    },
    headerOrg: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      marginBottom: spacing.xs,
    },
    headerSummary: {
      fontSize: fontSize.xs,
      color: colors.textLight,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    indexCard: {
      padding: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    indexKicker: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.textLight,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: spacing.xs,
    },
    indexBody: {
      fontSize: fontSize.sm,
      color: colors.textSecondary,
      marginBottom: spacing.md,
      lineHeight: 20,
    },
    indexMeta: {
      marginTop: spacing.sm,
      fontSize: fontSize.xs,
      color: colors.textLight,
      textAlign: 'center',
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
    groupCard: {
      padding: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    groupName: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 2,
    },
    groupMeta: {
      fontSize: fontSize.xs,
      color: colors.textSecondary,
      marginBottom: spacing.sm,
    },
    teamList: {
      borderTopWidth: 1,
      borderTopColor: colors.divider,
    },
    teamRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    teamName: {
      flex: 1,
      fontSize: fontSize.sm,
      color: colors.text,
    },
    teamPos: {
      fontSize: fontSize.sm,
      color: colors.primary,
      fontWeight: '700',
      paddingLeft: spacing.sm,
    },
    teamMore: {
      paddingTop: spacing.xs,
      fontSize: fontSize.xs,
      color: colors.textLight,
      fontStyle: 'italic',
    },
  });
}
