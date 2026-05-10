// ── AddTournamentsScreen ──────────────────────────────────────────────────
//
// Lets the user grow their scouting database by adding prior tournaments
// to the season index — AES *or* Timu. Shows currently-indexed events
// (both sources, source-badged) with team counts and last-indexed time;
// supports bulk add (paste multiple Timu URLs / bare 4-digit tids), tid-
// range discovery against aliases, manual AES event add (paste event
// key → pick division → pick team), and per-row remove/refresh.
//
// Renamed from TimuManageSeasonScreen — the screen always handled both
// sources, the old name was misleading. Reachable from:
//   • Hamburger menu
//   • Either team dashboard's "+ Add a tournament" pill (with the
//     `focusSource` prop set so the matching card is scrolled into
//     view + briefly highlighted on mount)
//   • Add-Team Timu fallback flow
// ────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import { Card } from '../components/Card';
import { extractTidFromInput } from '../api/timuClient';
import {
  loadSeasonIndex,
  bulkIndex,
  indexTournament,
  removeFromIndex,
  refreshAll,
  findStaleTids,
  sortedSnapshots,
  type SeasonIndex,
  type TimuTournamentSnapshot,
} from '../utils/timuSeasonIndex';
import {
  discoverTeamEvents,
  suggestRange,
  clearDiscoveryCache,
  type DiscoveredEvent,
  type ScanProgress,
} from '../utils/timuDiscover';
import {
  loadMyTeamAliases,
  addMyTeamAlias,
  matchesAnyAlias,
} from '../utils/seasonTeamIdentity';
import { loadMyTeam } from '../utils/storage';
import { listSeasons, type Season } from '../utils/season';
import { getEvent, loadDivisionTeams } from '../api/aesClient';
import type { LoaderResult } from '../utils/loaderResult';
import {
  loadAesSeasonIndex,
  indexAesSnapshot,
  removeAesSnapshot,
  sortedAesSnapshots,
  aesSnapshotKey,
  type AesSeasonIndex,
  type AesTournamentSnapshot,
} from '../utils/aesSeasonIndex';
import type { AESEvent, AESTeamAssignment } from '../types/aes';

interface Props {
  onBack: () => void;
  onOpenTid: (tid: number) => void;
  /** When set, scroll the matching card into view on first render and
   *  flash a highlight border for ~1.5s so the user sees where the
   *  source-specific paste field lives. Used by the team-dashboard
   *  "+ Add a tournament" buttons. */
  focusSource?: 'aes' | 'timu';
}

export function AddTournamentsScreen({ onBack, onOpenTid, focusSource }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [index, setIndex] = useState<SeasonIndex>({});
  const [aesIndex, setAesIndex] = useState<AesSeasonIndex>({});
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [addingState, setAddingState] = useState<{
    total: number;
    done: number;
    failures: number[];
  } | null>(null);

  // ── Focus-source highlight (for arrivals from a team dashboard) ─────────
  // When focusSource is 'aes' or 'timu', we scroll the corresponding card
  // into view on first render and flash its border for ~1.5s. The
  // ScrollView ref + per-card y-offset state are populated via onLayout
  // so the scroll is correct regardless of dynamic content above (the
  // intro card, indexed-events list, etc).
  const scrollRef = useRef<ScrollView | null>(null);
  const [timuCardY, setTimuCardY] = useState<number | null>(null);
  const [aesCardY, setAesCardY] = useState<number | null>(null);
  const [highlightedCard, setHighlightedCard] = useState<'aes' | 'timu' | null>(
    focusSource ?? null
  );
  useEffect(() => {
    if (!focusSource) return;
    // Wait for both layouts before scrolling (the matching y is the one
    // we need; the other ensures intervening cards have been measured).
    const targetY = focusSource === 'aes' ? aesCardY : timuCardY;
    if (targetY == null) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, targetY - 16), animated: true });
    const t = setTimeout(() => setHighlightedCard(null), 1600);
    return () => clearTimeout(t);
  }, [focusSource, aesCardY, timuCardY]);

  // ── Discovery state ─────────────────────────────────────────────────────
  const [aliases, setAliases] = useState<string[]>([]);
  const [extraAlias, setExtraAlias] = useState('');
  const [tidStartStr, setTidStartStr] = useState('');
  const [tidEndStr, setTidEndStr] = useState('');
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredEvent[] | null>(null);
  const [selectedTids, setSelectedTids] = useState<Set<number>>(new Set());

  // ── AES manual-add state ─────────────────────────────────────────────────
  // Three-step flow: paste event key → pick division → pick team. Each
  // stage's output drives the next; stale state is cleared whenever an
  // earlier step changes.
  const [aesEventInput, setAesEventInput] = useState('');
  const [aesEvent, setAesEvent] = useState<AESEvent | null>(null);
  const [aesEventLoading, setAesEventLoading] = useState(false);
  const [aesEventError, setAesEventError] = useState<string | null>(null);
  const [aesSelectedDivisionId, setAesSelectedDivisionId] = useState<number | null>(null);
  const [aesDivisionTeams, setAesDivisionTeams] = useState<AESTeamAssignment[]>([]);
  const [aesDivisionTeamsLoading, setAesDivisionTeamsLoading] = useState(false);
  // Tagged-union result for the team-assignment fetch. Lets the picker
  // distinguish "no teams in this division" from "the request failed" —
  // the latter shows a tap-to-retry surface instead of an empty list.
  const [aesDivisionTeamsResult, setAesDivisionTeamsResult] = useState<
    LoaderResult<AESTeamAssignment[]> | null
  >(null);
  const [aesSelectedTeamId, setAesSelectedTeamId] = useState<number | null>(null);
  const [aesAdding, setAesAdding] = useState(false);

  useEffect(() => {
    (async () => {
      const [cur, aesCur] = await Promise.all([
        loadSeasonIndex(),
        loadAesSeasonIndex(),
      ]);
      setIndex(cur);
      setAesIndex(aesCur);
      // Compose aliases from explicit list + MyTeam (whichever source).
      const stored = await loadMyTeamAliases();
      const myTeam = await loadMyTeam();
      const seedAliases = new Set<string>(stored);
      if (myTeam) {
        if (myTeam.teamText) seedAliases.add(myTeam.teamText);
        if (myTeam.teamName) seedAliases.add(myTeam.teamName);
      }
      setAliases(Array.from(seedAliases));
      // Default tid range based on existing index (or hardcoded fallback).
      const existingTids = Object.keys(cur).map((k) => Number(k)).filter(Number.isFinite);
      const range = suggestRange(existingTids);
      setTidStartStr(String(range.tidStart));
      setTidEndStr(String(range.tidEnd));
      setLoading(false);
    })();
  }, []);

  const snapshots = sortedSnapshots(index);
  const aesSnapshots = sortedAesSnapshots(aesIndex);

  // ── Add (parse input, validate, bulk-fetch) ─────────────────────────────

  const onAdd = useCallback(async () => {
    const lines = input
      .split(/[\s,]+/)
      .map((l) => l.trim())
      .filter(Boolean);
    const tids: number[] = [];
    const rejected: string[] = [];
    for (const line of lines) {
      const tid = extractTidFromInput(line);
      if (tid) tids.push(tid);
      else rejected.push(line);
    }
    // Dedup & remove ones already indexed
    const uniqTids = Array.from(new Set(tids));
    if (uniqTids.length === 0) {
      Alert.alert('No valid tids', 'Paste Timu URLs or numeric tids (one per line or comma-separated).');
      return;
    }

    setAddingState({ total: uniqTids.length, done: 0, failures: [] });
    const failures: number[] = [];
    const next = await bulkIndex(uniqTids, (done, total, tid, ok) => {
      if (!ok) failures.push(tid);
      setAddingState({ total, done, failures: [...failures] });
    });
    setIndex(next);
    setInput('');
    setAddingState(null);
    if (failures.length) {
      Alert.alert(
        'Some tournaments failed',
        `${failures.length} of ${uniqTids.length} tids couldn't be indexed:\n${failures.join(', ')}`
      );
    } else if (rejected.length) {
      Alert.alert('Some inputs ignored', `Couldn't parse: ${rejected.join(', ')}`);
    }
  }, [input]);

  // ── Discover ────────────────────────────────────────────────────────────

  const onAddExtraAlias = useCallback(async () => {
    const name = extraAlias.trim();
    if (!name) return;
    const updated = await addMyTeamAlias(name);
    setAliases(updated);
    setExtraAlias('');
  }, [extraAlias]);

  const effectiveAliases = aliases.length || extraAlias.trim()
    ? Array.from(new Set([...aliases, extraAlias.trim()].filter(Boolean)))
    : [];

  const onDiscover = useCallback(async () => {
    const start = parseInt(tidStartStr, 10);
    const end = parseInt(tidEndStr, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0) {
      Alert.alert('Tid range required', 'Enter both a start and end tournament id.');
      return;
    }
    if (effectiveAliases.length === 0) {
      Alert.alert(
        'No team to search for',
        'Set a My Team or add a search name below before discovering events.'
      );
      return;
    }
    const span = Math.abs(end - start) + 1;
    if (span > 1500) {
      Alert.alert(
        'Range is very wide',
        `That range covers ${span} tournaments and could take a while. Narrow it down or run twice.`
      );
      return;
    }
    setDiscovered(null);
    setSelectedTids(new Set());
    setScanProgress({ done: 0, total: span, found: 0, skipped: 0, current: 0 });
    try {
      const results = await discoverTeamEvents(
        effectiveAliases,
        start,
        end,
        (p) => setScanProgress(p),
        { concurrency: 3 }
      );
      // Default-select results that aren't already in the index.
      const indexedTids = new Set(Object.keys(index).map((k) => Number(k)));
      const newSelection = new Set(
        results.filter((r) => !indexedTids.has(r.tid)).map((r) => r.tid)
      );
      setSelectedTids(newSelection);
      setDiscovered(results);
    } catch (err: any) {
      Alert.alert('Discovery failed', err?.message || 'Unknown error');
    } finally {
      setScanProgress(null);
    }
  }, [tidStartStr, tidEndStr, effectiveAliases, index]);

  const onClearDiscoveryCache = useCallback(async () => {
    Alert.alert(
      'Clear discovery cache?',
      'Future scans will re-fetch every tid in the range from scratch. Useful if Timu has new tournaments you want to pick up.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearDiscoveryCache();
            Alert.alert('Cache cleared', 'Next discovery scan will hit Timu fresh.');
          },
        },
      ]
    );
  }, []);

  const toggleSelected = useCallback((tid: number) => {
    setSelectedTids((prev) => {
      const next = new Set(prev);
      if (next.has(tid)) next.delete(tid);
      else next.add(tid);
      return next;
    });
  }, []);

  const onIndexSelected = useCallback(async () => {
    const tids = Array.from(selectedTids);
    if (tids.length === 0) {
      Alert.alert('No tournaments selected', 'Tick at least one tournament to add to the season index.');
      return;
    }
    setAddingState({ total: tids.length, done: 0, failures: [] });
    const failures: number[] = [];
    const next = await bulkIndex(tids, (done, total, tid, ok) => {
      if (!ok) failures.push(tid);
      setAddingState({ total, done, failures: [...failures] });
    });
    setIndex(next);
    setAddingState(null);
    // Drop indexed tids out of the selected set so the user sees what's left.
    setSelectedTids((prev) => {
      const remaining = new Set(prev);
      tids.forEach((t) => {
        if (!failures.includes(t)) remaining.delete(t);
      });
      return remaining;
    });
    if (failures.length) {
      Alert.alert(
        'Some tournaments failed',
        `${failures.length} of ${tids.length} couldn't be indexed:\n${failures.join(', ')}`
      );
    } else {
      Alert.alert(
        'Added to season',
        `Indexed ${tids.length} tournament${tids.length === 1 ? '' : 's'}.`
      );
    }
  }, [selectedTids]);

  // ── AES manual add ─────────────────────────────────────────────────────

  /** Reset the per-step state below the event lookup. */
  const resetAesBelowEvent = useCallback(() => {
    setAesSelectedDivisionId(null);
    setAesDivisionTeams([]);
    setAesSelectedTeamId(null);
    setAesAdding(false);
  }, []);

  const onLookupAesEvent = useCallback(async () => {
    const raw = aesEventInput.trim();
    if (!raw) return;
    // Accept either a bare key or the full results.advancedeventsystems URL.
    // Event keys are typically alphanumeric tokens; if the input is a URL,
    // try to extract the key segment after `/event/`.
    let key = raw;
    const urlMatch = raw.match(/\/event\/([^/?#]+)/i);
    if (urlMatch) key = urlMatch[1];
    setAesEventLoading(true);
    setAesEventError(null);
    setAesEvent(null);
    resetAesBelowEvent();
    try {
      const event = await getEvent(key);
      setAesEvent(event);
      // If exactly one division, auto-select it. Multi-division events
      // (typical) leave the picker for the user.
      if (event.Divisions.length === 1) {
        setAesSelectedDivisionId(event.Divisions[0].DivisionId);
      }
    } catch (err: any) {
      setAesEventError(
        err?.message ||
          'Could not find that AES event. Double-check the event key.'
      );
    } finally {
      setAesEventLoading(false);
    }
  }, [aesEventInput, resetAesBelowEvent]);

  // Whenever the user picks a division, fetch its team assignments. We
  // also auto-select the team if any of the user's aliases matches.
  // The loader returns a tagged result (ok/empty/error); we keep the raw
  // team list in `aesDivisionTeams` for the picker rendering and surface
  // the error variant separately so the user gets a retry affordance.
  const fetchAesDivisionTeams = useCallback(async () => {
    if (!aesEvent || aesSelectedDivisionId == null) return;
    setAesDivisionTeamsLoading(true);
    setAesSelectedTeamId(null);
    setAesDivisionTeamsResult(null);
    const result = await loadDivisionTeams(aesEvent.Key, aesSelectedDivisionId);
    setAesDivisionTeamsResult(result);
    if (result.status === 'ok') {
      setAesDivisionTeams(result.data);
      const aliasMatch = result.data.find(
        (t) =>
          matchesAnyAlias(t.TeamName, aliases) ||
          matchesAnyAlias(t.TeamText, aliases)
      );
      if (aliasMatch) setAesSelectedTeamId(aliasMatch.TeamId);
    } else {
      setAesDivisionTeams([]);
    }
    setAesDivisionTeamsLoading(false);
  }, [aesEvent, aesSelectedDivisionId, aliases]);

  useEffect(() => {
    if (!aesEvent || aesSelectedDivisionId == null) {
      setAesDivisionTeams([]);
      setAesSelectedTeamId(null);
      setAesDivisionTeamsResult(null);
      return;
    }
    fetchAesDivisionTeams();
  }, [aesEvent, aesSelectedDivisionId, fetchAesDivisionTeams]);

  const onAddAesEvent = useCallback(async () => {
    if (!aesEvent || aesSelectedDivisionId == null || aesSelectedTeamId == null) {
      return;
    }
    setAesAdding(true);
    try {
      const next = await indexAesSnapshot(
        aesEvent.Key,
        aesSelectedDivisionId,
        aesSelectedTeamId
      );
      setAesIndex(next);
      // Add the chosen team's name(s) to alias storage so future
      // discovery + cross-source matching picks them up.
      const team = aesDivisionTeams.find((t) => t.TeamId === aesSelectedTeamId);
      if (team) {
        if (team.TeamName) {
          const updated = await addMyTeamAlias(team.TeamName);
          setAliases(updated);
        }
        if (team.TeamText && team.TeamText !== team.TeamName) {
          const updated = await addMyTeamAlias(team.TeamText);
          setAliases(updated);
        }
      }
      // Clear the form for the next add.
      setAesEventInput('');
      setAesEvent(null);
      resetAesBelowEvent();
      Alert.alert(
        'Added to season',
        `Indexed ${team?.TeamName || 'team'} from "${aesEvent.Name}".`
      );
    } catch (err: any) {
      Alert.alert('Add failed', err?.message || 'Could not index that event.');
    } finally {
      setAesAdding(false);
    }
  }, [
    aesEvent,
    aesSelectedDivisionId,
    aesSelectedTeamId,
    aesDivisionTeams,
    resetAesBelowEvent,
  ]);

  const onRefreshAesSnapshot = useCallback(
    async (snap: AesTournamentSnapshot) => {
      try {
        const next = await indexAesSnapshot(
          snap.eventKey,
          snap.divisionId,
          snap.myTeamId
        );
        setAesIndex(next);
      } catch (err: any) {
        Alert.alert('Refresh failed', err?.message || 'Unknown error');
      }
    },
    []
  );

  const onRemoveAesSnapshot = useCallback(
    (snap: AesTournamentSnapshot) => {
      Alert.alert(
        'Remove from index?',
        'This AES tournament snapshot will be re-fetched if you ever open the team\'s dashboard again.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              const next = await removeAesSnapshot(snap.eventKey, snap.divisionId);
              setAesIndex(next);
            },
          },
        ]
      );
    },
    []
  );

  /** Combined newest-first list of AES + Timu snapshots for the indexed list. */
  const indexedRows = useMemo(() => {
    type Row =
      | { kind: 'timu'; key: string; dateMs: number; snap: TimuTournamentSnapshot }
      | { kind: 'aes'; key: string; dateMs: number; snap: AesTournamentSnapshot };
    const rows: Row[] = [
      ...snapshots.map((s) => ({
        kind: 'timu' as const,
        key: `timu:${s.tid}`,
        dateMs: s.dateMs ?? 0,
        snap: s,
      })),
      ...aesSnapshots.map((s) => ({
        kind: 'aes' as const,
        key: `aes:${aesSnapshotKey(s.eventKey, s.divisionId)}`,
        dateMs: s.dateMs ?? 0,
        snap: s,
      })),
    ];
    rows.sort((a, b) => b.dateMs - a.dateMs);
    return rows;
  }, [snapshots, aesSnapshots]);

  const onRefreshAll = useCallback(async () => {
    const tidCount = Object.keys(index).length;
    if (tidCount === 0) {
      Alert.alert('Nothing to refresh', 'Add some tournaments first.');
      return;
    }
    setAddingState({ total: tidCount, done: 0, failures: [] });
    const failures: number[] = [];
    const next = await refreshAll((done, total, tid, ok) => {
      if (!ok) failures.push(tid);
      setAddingState({ total, done, failures: [...failures] });
    });
    setIndex(next);
    setAddingState(null);
    if (failures.length) {
      Alert.alert(
        'Some tournaments failed to refresh',
        `${failures.length} of ${tidCount} couldn't be re-fetched:\n${failures.join(', ')}`
      );
    } else {
      Alert.alert(
        'Refreshed',
        `Re-fetched all ${tidCount} tournament${tidCount === 1 ? '' : 's'} — playoff results and final rankings are now up to date.`
      );
    }
  }, [index]);

  const onRefreshStale = useCallback(async () => {
    const stale = findStaleTids(index);
    if (stale.length === 0) {
      Alert.alert(
        'Nothing to refresh',
        'All your indexed tournaments already have playoff data (or are still upcoming).'
      );
      return;
    }
    setAddingState({ total: stale.length, done: 0, failures: [] });
    const failures: number[] = [];
    const next = await bulkIndex(stale, (done, total, tid, ok) => {
      if (!ok) failures.push(tid);
      setAddingState({ total, done, failures: [...failures] });
    });
    setIndex(next);
    setAddingState(null);
    if (failures.length) {
      Alert.alert(
        'Some tournaments failed',
        `${failures.length} of ${stale.length} couldn't be re-fetched:\n${failures.join(', ')}`
      );
    } else {
      Alert.alert(
        'Refreshed',
        `Updated ${stale.length} tournament${stale.length === 1 ? '' : 's'} that may have had missing playoff data.`
      );
    }
  }, [index]);

  const onRefreshTid = useCallback(async (tid: number) => {
    try {
      const next = await indexTournament(tid);
      setIndex(next);
    } catch (err: any) {
      Alert.alert('Refresh failed', err?.message || 'Unknown error');
    }
  }, []);

  const onRemoveTid = useCallback(
    (tid: number) => {
      Alert.alert(
        'Remove from index?',
        'The tournament data will be re-fetched if you ever open it again.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              const next = await removeFromIndex(tid);
              setIndex(next);
            },
          },
        ]
      );
    },
    []
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Header onBack={onBack} />
      <ScrollView ref={scrollRef} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* Intro */}
        <Card variant="outlined" style={styles.introCard}>
          <Text style={styles.introTitle}>Season tournaments</Text>
          <Text style={styles.introBody}>
            Add tournaments your team has played in this season — Timu (paste URL or
            tid) or AES (paste event key, then pick division and team). Indexed events
            power Season History, scouting records, head-to-head, and common opponents.
          </Text>
        </Card>

        {/* Add form (Timu) */}
        <View
          onLayout={(e) => setTimuCardY(e.nativeEvent.layout.y)}
          style={highlightedCard === 'timu' ? styles.cardHighlightWrap : undefined}
        >
        <Card style={styles.addCard}>
          <Text style={styles.sectionLabel}>Add tournaments</Text>
          <Text style={styles.help}>
            Paste one or more Timu URLs (or numeric tids). Separate with new lines, spaces, or commas.
          </Text>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={'3792\nhttps://www.timu.ca/scoreboards/schedule.php?tid=4130'}
            placeholderTextColor={colors.textLight}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={[
              styles.primaryBtn,
              (!input.trim() || addingState !== null) && styles.primaryBtnDisabled,
            ]}
            onPress={onAdd}
            disabled={!input.trim() || addingState !== null}
          >
            <Text style={styles.primaryBtnText}>
              {addingState
                ? `Indexing ${addingState.done}/${addingState.total}...`
                : 'Add to season'}
            </Text>
          </TouchableOpacity>
          {addingState ? (
            <View style={styles.progressRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.progressText}>
                {addingState.done}/{addingState.total} fetched
                {addingState.failures.length > 0
                  ? ` · ${addingState.failures.length} failed`
                  : ''}
              </Text>
            </View>
          ) : null}
        </Card>
        </View>

        {/* Add AES event (manual) */}
        <View
          onLayout={(e) => setAesCardY(e.nativeEvent.layout.y)}
          style={highlightedCard === 'aes' ? styles.cardHighlightWrap : undefined}
        >
        <Card style={styles.aesAddCard}>
          <Text style={styles.sectionLabel}>Add an AES event</Text>
          <Text style={styles.help}>
            Paste an AES event key (or the full results.advancedeventsystems URL).
            We'll fetch the event, then let you pick the division and your team.
          </Text>
          <View style={styles.aesEventRow}>
            <TextInput
              style={styles.aesEventInput}
              value={aesEventInput}
              onChangeText={setAesEventInput}
              placeholder="e.g. PVA2025 or full results URL"
              placeholderTextColor={colors.textLight}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[
                styles.smallBtn,
                (!aesEventInput.trim() || aesEventLoading) && styles.primaryBtnDisabled,
              ]}
              onPress={onLookupAesEvent}
              disabled={!aesEventInput.trim() || aesEventLoading}
            >
              <Text style={styles.smallBtnText}>
                {aesEventLoading ? 'Looking…' : 'Look up'}
              </Text>
            </TouchableOpacity>
          </View>

          {aesEventError ? (
            <Text style={styles.errorText}>{aesEventError}</Text>
          ) : null}

          {aesEvent ? (
            <View style={styles.aesStepBlock}>
              <Text style={styles.aesEventNameText} numberOfLines={2}>
                {aesEvent.Name}
              </Text>
              {aesEvent.Location ? (
                <Text style={styles.aesEventMetaText} numberOfLines={1}>
                  {aesEvent.Location}
                </Text>
              ) : null}

              <Text style={styles.aesStepLabel}>Division</Text>
              <View style={styles.aesDivisionList}>
                {aesEvent.Divisions.length === 0 ? (
                  <Text style={styles.emptyText}>
                    This event has no divisions yet.
                  </Text>
                ) : (
                  aesEvent.Divisions.map((d) => {
                    const selected = aesSelectedDivisionId === d.DivisionId;
                    const indexed = aesSnapshotKey(aesEvent.Key, d.DivisionId) in aesIndex;
                    return (
                      <TouchableOpacity
                        key={d.DivisionId}
                        style={[
                          styles.aesPickerRow,
                          selected && styles.aesPickerRowSelected,
                        ]}
                        onPress={() => setAesSelectedDivisionId(d.DivisionId)}
                        activeOpacity={0.7}
                      >
                        <View
                          style={[
                            styles.radioDot,
                            selected && styles.radioDotOn,
                          ]}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.aesPickerTitle} numberOfLines={1}>
                            {d.Name}
                          </Text>
                          <Text style={styles.aesPickerMeta} numberOfLines={1}>
                            {d.TeamCount} teams
                            {indexed ? ' · already indexed' : ''}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>

              {aesSelectedDivisionId != null ? (
                <>
                  <Text style={styles.aesStepLabel}>Team</Text>
                  {aesDivisionTeamsLoading ? (
                    <View style={styles.progressDetailRow}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.progressText}>Loading teams…</Text>
                    </View>
                  ) : aesDivisionTeamsResult?.status === 'error' ? (
                    <TouchableOpacity
                      style={styles.aesTeamsRetry}
                      onPress={fetchAesDivisionTeams}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.aesTeamsRetryText}>
                        Failed to load. Tap to retry.
                      </Text>
                    </TouchableOpacity>
                  ) : aesDivisionTeams.length === 0 ? (
                    <Text style={styles.emptyText}>
                      No teams listed in this division yet.
                    </Text>
                  ) : (
                    <View style={styles.aesTeamList}>
                      {aesDivisionTeams.map((t) => {
                        const selected = aesSelectedTeamId === t.TeamId;
                        const aliasMatched =
                          matchesAnyAlias(t.TeamName, aliases) ||
                          matchesAnyAlias(t.TeamText, aliases);
                        return (
                          <TouchableOpacity
                            key={t.TeamId}
                            style={[
                              styles.aesPickerRow,
                              selected && styles.aesPickerRowSelected,
                            ]}
                            onPress={() => setAesSelectedTeamId(t.TeamId)}
                            activeOpacity={0.7}
                          >
                            <View
                              style={[
                                styles.radioDot,
                                selected && styles.radioDotOn,
                              ]}
                            />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.aesPickerTitle} numberOfLines={1}>
                                {t.TeamName}
                                {aliasMatched ? (
                                  <Text style={styles.aliasMatchTag}>  · matches alias</Text>
                                ) : null}
                              </Text>
                              {t.TeamClub?.Name ? (
                                <Text style={styles.aesPickerMeta} numberOfLines={1}>
                                  {t.TeamClub.Name}
                                </Text>
                              ) : null}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}

                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      (aesSelectedTeamId == null || aesAdding) && styles.primaryBtnDisabled,
                      { marginTop: spacing.md },
                    ]}
                    onPress={onAddAesEvent}
                    disabled={aesSelectedTeamId == null || aesAdding}
                  >
                    <Text style={styles.primaryBtnText}>
                      {aesAdding ? 'Indexing…' : 'Add to season'}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          ) : null}
        </Card>
        </View>

        {/* Discover team's events */}
        <Card style={styles.discoverCard}>
          <Text style={styles.sectionLabel}>Find my team's events</Text>
          <Text style={styles.help}>
            Scans Timu's tournaments in a tid range and pulls up events that mention your
            team. Searches names from My Team and any aliases you've collected; results are
            cached for a week so re-running is quick.
          </Text>

          {/* Aliases display */}
          {effectiveAliases.length > 0 ? (
            <View style={styles.aliasRow}>
              <Text style={styles.aliasLabel}>Searching:</Text>
              {effectiveAliases.map((a) => (
                <View key={a} style={styles.aliasChip}>
                  <Text style={styles.aliasChipText}>{a}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.warningText}>
              No team aliases yet — set a My Team or add one below.
            </Text>
          )}

          {/* Add another search name */}
          <View style={styles.aliasInputRow}>
            <TextInput
              style={styles.aliasInput}
              value={extraAlias}
              onChangeText={setExtraAlias}
              placeholder="Add another team name (optional)"
              placeholderTextColor={colors.textLight}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.smallBtn, !extraAlias.trim() && styles.primaryBtnDisabled]}
              onPress={onAddExtraAlias}
              disabled={!extraAlias.trim()}
            >
              <Text style={styles.smallBtnText}>Add</Text>
            </TouchableOpacity>
          </View>

          {/* Season preset chips */}
          <View style={styles.presetRow}>
            {listSeasons().map((s) => (
              <TouchableOpacity
                key={s.id}
                style={styles.presetChip}
                onPress={() => {
                  setTidStartStr(String(s.tidStart));
                  setTidEndStr(String(s.tidEnd));
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.presetChipText}>{s.id}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.rangeHint}>
            Tip: pick a season to auto-fill the range. Aliases ignore age-group markers
            (U17/U18/etc.), so prior years usually link up automatically.
          </Text>

          {/* Tid range */}
          <View style={styles.rangeRow}>
            <View style={styles.rangeField}>
              <Text style={styles.rangeLabel}>From tid</Text>
              <TextInput
                style={styles.rangeInput}
                value={tidStartStr}
                onChangeText={setTidStartStr}
                keyboardType="number-pad"
                autoCorrect={false}
              />
            </View>
            <Text style={styles.rangeSep}>—</Text>
            <View style={styles.rangeField}>
              <Text style={styles.rangeLabel}>To tid</Text>
              <TextInput
                style={styles.rangeInput}
                value={tidEndStr}
                onChangeText={setTidEndStr}
                keyboardType="number-pad"
                autoCorrect={false}
              />
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              (scanProgress !== null || effectiveAliases.length === 0) &&
                styles.primaryBtnDisabled,
            ]}
            onPress={onDiscover}
            disabled={scanProgress !== null || effectiveAliases.length === 0}
          >
            <Text style={styles.primaryBtnText}>
              {scanProgress
                ? `Scanning ${scanProgress.done}/${scanProgress.total}...`
                : 'Find my team\'s events'}
            </Text>
          </TouchableOpacity>

          {scanProgress && (
            <View style={styles.progressDetailRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.progressText}>
                {scanProgress.found} match{scanProgress.found === 1 ? '' : 'es'}
                {scanProgress.skipped > 0 ? ` · ${scanProgress.skipped} cached` : ''}
                {' · '}tid {scanProgress.current}
              </Text>
            </View>
          )}

          <TouchableOpacity onPress={onClearDiscoveryCache} style={styles.cacheClearLink}>
            <Text style={styles.cacheClearText}>Clear scan cache</Text>
          </TouchableOpacity>
        </Card>

        {/* Discovered results */}
        {discovered !== null && (
          <Card style={styles.resultsCard}>
            <Text style={styles.sectionLabel}>
              Results ({discovered.length})
            </Text>
            {discovered.length === 0 ? (
              <Text style={styles.emptyText}>
                No events found in this range. Try widening the tid range or check that
                your team name is spelled the way it appears on Timu.
              </Text>
            ) : (
              <>
                <Text style={styles.help}>
                  Tick the tournaments to add to your season. Already-indexed events are
                  unchecked by default.
                </Text>
                {discovered.map((d) => {
                  const isIndexed = d.tid in index;
                  const isSelected = selectedTids.has(d.tid);
                  return (
                    <TouchableOpacity
                      key={d.tid}
                      style={styles.discoveredRow}
                      onPress={() => toggleSelected(d.tid)}
                      activeOpacity={0.7}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          isSelected && styles.checkboxOn,
                        ]}
                      >
                        {isSelected ? <Text style={styles.checkmark}>✓</Text> : null}
                      </View>
                      <View style={styles.discoveredMain}>
                        <Text style={styles.discoveredTitle} numberOfLines={2}>
                          {d.name}
                          {isIndexed ? <Text style={styles.indexedTag}>  · already indexed</Text> : null}
                        </Text>
                        <Text style={styles.discoveredMeta} numberOfLines={1}>
                          tid {d.tid}
                          {d.subtitle ? ` · ${d.subtitle}` : ''}
                          {d.dateText ? ` · ${d.dateText}` : ''}
                        </Text>
                        {d.matchedTeams.length > 0 && (
                          <Text style={styles.matchedTeamsText} numberOfLines={1}>
                            Matched: {d.matchedTeams.join(', ')}
                          </Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={[
                    styles.primaryBtn,
                    (selectedTids.size === 0 || addingState !== null) &&
                      styles.primaryBtnDisabled,
                    { marginTop: spacing.md },
                  ]}
                  onPress={onIndexSelected}
                  disabled={selectedTids.size === 0 || addingState !== null}
                >
                  <Text style={styles.primaryBtnText}>
                    {addingState
                      ? `Indexing ${addingState.done}/${addingState.total}...`
                      : `Add ${selectedTids.size} to season`}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </Card>
        )}

        {/* Indexed list (AES + Timu, source-badged, newest first) */}
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : indexedRows.length === 0 ? (
          <Card variant="outlined" style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              Nothing indexed yet. Add a tournament above to get started.
            </Text>
          </Card>
        ) : (
          <Card style={styles.listCard}>
            <View style={styles.listCardHeader}>
              <Text style={styles.sectionLabel}>
                Indexed ({indexedRows.length})
              </Text>
              <View style={styles.listCardActions}>
                <TouchableOpacity
                  onPress={onRefreshStale}
                  style={styles.headerActionBtn}
                  disabled={addingState !== null}
                >
                  <Text
                    style={[
                      styles.headerActionText,
                      addingState !== null && styles.headerActionTextDisabled,
                    ]}
                  >
                    Refresh stale
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={onRefreshAll}
                  style={styles.headerActionBtn}
                  disabled={addingState !== null}
                >
                  <Text
                    style={[
                      styles.headerActionText,
                      addingState !== null && styles.headerActionTextDisabled,
                    ]}
                  >
                    Refresh all
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.listCardHint}>
              "Refresh stale" + "Refresh all" only re-fetch Timu tournaments. Use the
              per-row Refresh button to update an AES snapshot.
            </Text>
            {indexedRows.map((row) =>
              row.kind === 'timu' ? (
                <SnapshotRow
                  key={row.key}
                  snapshot={row.snap}
                  onOpen={() => onOpenTid(row.snap.tid)}
                  onRefresh={() => onRefreshTid(row.snap.tid)}
                  onRemove={() => onRemoveTid(row.snap.tid)}
                />
              ) : (
                <AesSnapshotRow
                  key={row.key}
                  snapshot={row.snap}
                  onRefresh={() => onRefreshAesSnapshot(row.snap)}
                  onRemove={() => onRemoveAesSnapshot(row.snap)}
                />
              )
            )}
          </Card>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.hero}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={styles.heroBack}>{'< Back'}</Text>
      </TouchableOpacity>
      <Text style={styles.heroTitle}>Manage Season</Text>
      <Text style={styles.heroSubtitle}>Tournaments indexed for season history</Text>
    </View>
  );
}

function SnapshotRow({
  snapshot,
  onOpen,
  onRefresh,
  onRemove,
}: {
  snapshot: TimuTournamentSnapshot;
  onOpen: () => void;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const indexed = new Date(snapshot.indexedAt);
  const relIndexed = humanRelativeTime(indexed);
  const numResults = snapshot.results.length;
  const numTeams = snapshot.teams.length;
  return (
    <View style={styles.row}>
      <TouchableOpacity style={styles.rowMain} onPress={onOpen} activeOpacity={0.7}>
        <View style={styles.rowTitleRow}>
          <View style={[styles.sourceBadge, styles.sourceBadgeTimu]}>
            <Text style={styles.sourceBadgeText}>TIMU</Text>
          </View>
          <Text style={styles.rowTitle} numberOfLines={1}>{snapshot.name}</Text>
        </View>
        <Text style={styles.rowMeta} numberOfLines={1}>
          tid {snapshot.tid}
          {snapshot.subtitle ? ` · ${snapshot.subtitle}` : ''}
          {snapshot.dateText ? ` · ${snapshot.dateText}` : ''}
        </Text>
        <Text style={styles.rowCounts}>
          {numTeams} teams · {numResults} matches · indexed {relIndexed}
        </Text>
      </TouchableOpacity>
      <View style={styles.rowActions}>
        <TouchableOpacity onPress={onRefresh} style={styles.rowActionBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.rowActionText}>Refresh</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onRemove} style={styles.rowActionBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={[styles.rowActionText, styles.rowRemoveText]}>Remove</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function AesSnapshotRow({
  snapshot,
  onRefresh,
  onRemove,
}: {
  snapshot: AesTournamentSnapshot;
  onRefresh: () => Promise<void>;
  onRemove: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const indexed = new Date(snapshot.indexedAt);
  const relIndexed = humanRelativeTime(indexed);
  const numMatches = snapshot.matches.length;
  const numTeams = snapshot.teams.length;
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <View style={styles.rowTitleRow}>
          <View style={[styles.sourceBadge, styles.sourceBadgeAes]}>
            <Text style={styles.sourceBadgeText}>AES</Text>
          </View>
          <Text style={styles.rowTitle} numberOfLines={1}>{snapshot.eventName}</Text>
        </View>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {snapshot.divisionName}
          {snapshot.dateText ? ` · ${snapshot.dateText}` : ''}
          {snapshot.venueName ? ` · ${snapshot.venueName}` : ''}
        </Text>
        <Text style={styles.rowCounts}>
          {snapshot.myTeamName || snapshot.myTeamText} · {numTeams} teams · {numMatches} matches · indexed {relIndexed}
        </Text>
      </View>
      <View style={styles.rowActions}>
        <TouchableOpacity onPress={handleRefresh} style={styles.rowActionBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} disabled={refreshing}>
          <Text style={[styles.rowActionText, refreshing && styles.rowActionTextDisabled]}>
            {refreshing ? '…' : 'Refresh'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onRemove} style={styles.rowActionBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={[styles.rowActionText, styles.rowRemoveText]}>Remove</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// "2 min ago", "4 days ago", etc.
function humanRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const days = Math.round(hr / 24);
  if (days < 30) return `${days} d ago`;
  return date.toLocaleDateString();
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  hero: {
    backgroundColor: colors.primary,
    padding: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  heroBack: { color: 'rgba(255,255,255,0.9)', fontSize: fontSize.md, fontWeight: '600', marginBottom: spacing.sm },
  heroTitle: { color: colors.textOnPrimary, fontSize: fontSize.xxl, fontWeight: '800' },
  heroSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: fontSize.md, marginTop: 2 },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl },

  introCard: { backgroundColor: colors.primaryLight },
  // Wrapper applied to whichever card matches `focusSource` on first
  // render. Brief flash + thicker border so the user sees where the
  // dashboard's "+ Add a tournament" jumped them to.
  cardHighlightWrap: {
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: borderRadius.lg,
    padding: 2,
    marginBottom: spacing.md,
  },
  introTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.primary, marginBottom: spacing.xs },
  introBody: { fontSize: fontSize.sm, color: colors.text, lineHeight: 20 },

  addCard: {},
  sectionLabel: { fontSize: fontSize.md, fontWeight: '700', color: colors.primary, marginBottom: spacing.xs },
  help: { fontSize: fontSize.xs, color: colors.textSecondary, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: fontSize.sm,
    color: colors.text,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: spacing.sm,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: fontSize.md },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  progressText: { marginLeft: spacing.sm, color: colors.textSecondary, fontSize: fontSize.sm },

  loading: { alignItems: 'center', padding: spacing.xxxl },
  emptyCard: { alignItems: 'center' },
  emptyText: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center' },

  listCard: {},
  listCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listCardActions: { flexDirection: 'row', gap: spacing.sm },
  headerActionBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.sm,
  },
  headerActionText: { color: colors.primary, fontSize: fontSize.xs, fontWeight: '700' },
  headerActionTextDisabled: { opacity: 0.5 },
  listCardHint: { color: colors.textLight, fontSize: fontSize.xs, marginTop: 4, marginBottom: spacing.sm },
  row: { flexDirection: 'row', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowMain: { flex: 1, paddingRight: spacing.sm },
  rowTitle: { fontSize: fontSize.md, color: colors.text, fontWeight: '600' },
  rowMeta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  rowCounts: { fontSize: fontSize.xs, color: colors.textLight, marginTop: 4 },
  rowActions: { justifyContent: 'center' },
  rowActionBtn: { paddingVertical: 4 },
  rowActionText: { color: colors.primary, fontSize: fontSize.xs, fontWeight: '600' },
  rowRemoveText: { color: colors.error },

  // ── Discovery section ────────────────────────────────────────────────
  discoverCard: { borderLeftWidth: 4, borderLeftColor: colors.accent },
  warningText: {
    color: colors.warning,
    fontSize: fontSize.xs,
    marginBottom: spacing.sm,
    fontStyle: 'italic',
  },
  aliasRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: 6,
  },
  aliasLabel: { color: colors.textSecondary, fontSize: fontSize.xs, marginRight: 4 },
  aliasChip: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
  },
  aliasChipText: { color: colors.primary, fontSize: fontSize.xs, fontWeight: '600' },
  aliasInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  aliasInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  smallBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  smallBtnText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: fontSize.sm },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  rangeField: { flex: 1 },
  rangeLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rangeInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
    textAlign: 'center',
  },
  rangeSep: { color: colors.textSecondary, fontSize: fontSize.lg, paddingBottom: spacing.sm },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xs },
  presetChip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
  },
  presetChipText: { color: colors.primary, fontSize: fontSize.xs, fontWeight: '700' },
  rangeHint: { color: colors.textLight, fontSize: fontSize.xs, marginBottom: spacing.sm },
  progressDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  cacheClearLink: { alignSelf: 'flex-start', marginTop: spacing.sm, paddingVertical: 4 },
  cacheClearText: { color: colors.textLight, fontSize: fontSize.xs, textDecorationLine: 'underline' },

  // ── Discovered results ───────────────────────────────────────────────
  resultsCard: {},
  discoveredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  discoveredMain: { flex: 1 },
  discoveredTitle: { fontSize: fontSize.sm, color: colors.text, fontWeight: '600' },
  indexedTag: { color: colors.textLight, fontSize: fontSize.xs, fontWeight: '400' },
  discoveredMeta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  matchedTeamsText: { fontSize: fontSize.xs, color: colors.accent, marginTop: 2, fontStyle: 'italic' },

  // ── AES manual-add card ───────────────────────────────────────────────
  aesAddCard: { borderLeftWidth: 4, borderLeftColor: colors.primary },
  aesEventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  aesEventInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  errorText: {
    color: colors.error,
    fontSize: fontSize.xs,
    marginBottom: spacing.sm,
  },
  aesStepBlock: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  aesEventNameText: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
  },
  aesEventMetaText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  aesStepLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  aesDivisionList: {},
  aesTeamList: {},
  aesTeamsRetry: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  aesTeamsRetryText: {
    color: colors.warning,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  aesPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: spacing.sm,
  },
  aesPickerRowSelected: {
    backgroundColor: colors.primaryLight,
  },
  radioDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  radioDotOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  aesPickerTitle: { fontSize: fontSize.sm, color: colors.text, fontWeight: '600' },
  aesPickerMeta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  aliasMatchTag: { color: colors.accent, fontSize: fontSize.xs, fontWeight: '400' },

  // ── Source badges (Timu/AES rows) ─────────────────────────────────────
  rowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sourceBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    minWidth: 36,
    alignItems: 'center',
  },
  sourceBadgeTimu: { backgroundColor: colors.accent },
  sourceBadgeAes: { backgroundColor: colors.primary },
  sourceBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  rowActionTextDisabled: { opacity: 0.5 },
});
}
