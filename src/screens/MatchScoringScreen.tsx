// ── MatchScoringScreen ─────────────────────────────────────────────────────
//
// Tier 2 Session B+C main scoring screen. Tap home / tap away to score;
// undo last event; open the read-only court diagram; auto-detect set
// end and prompt to confirm; auto-detect match end. Now includes:
//   • Substitutions (out → in) modal
//   • Libero on/off + officially-replaced
//   • Timeouts, sanctions
//   • Live sub-count display per side
//   • Mini rotation strip below the score panels
//   • Points-by-server timeline view
//   • Per-set start/end times derived from event timestamps
//   • Bottom safe-area padding so the shelf clears phone gesture bars
//
// State: every event mutation goes through the engine's pure helpers
// then writes the new Match to AsyncStorage. Re-derive runs on every
// render, which is cheap (event log < 1000 entries even for the
// busiest match).
// ────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  ScrollView,
  TextInput,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
// Note: this screen used to read safe-area insets directly to pad its
// shelf and top container. After the navigation pass, the App.tsx
// wrapper handles paddingTop (insets.top) and paddingBottom
// (BOTTOM_TAB_BAR_HEIGHT + insets.bottom) on every screen. The
// useSafeAreaInsets call here was dropped to avoid double-counting.
import {
  useTheme,
  spacing,
  fontSize,
  borderRadius,
} from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type {
  Match,
  MatchEvent,
  Side,
  PointEvent,
  StatEvent,
  StatCategory,
  CourtSnapshot,
  SetEndEvent,
  MatchEndEvent,
  MatchAbandonedEvent,
  LineupEvent,
  Lineup,
  SubEvent,
  LiberoOnEvent,
  LiberoOffEvent,
  LiberoOfficiallyReplacedEvent,
  TimeoutEvent,
  SanctionEvent,
  RosterPlayer,
  RotationState,
  MatchKind,
} from '../types/match';
import {
  appendEvent,
  removeEventById,
  deriveMatchState,
  makeEventId,
  canApplySub,
} from '../utils/matchEngine';
import { saveMatch, deleteMatch } from '../utils/scoredMatchStore';
import { CourtDiagram } from '../components/CourtDiagram';
import { WinProbabilityBar } from '../components/WinProbabilityBar';
import { snapshotFromState } from '../utils/statAggregator';
import {
  defaultIncludeInStats,
  getRecentTournamentsForLinking,
  getOpposingTeamsForTournament,
  type TournamentPickerEntry,
} from '../utils/matchMeta';

interface Props {
  initialMatch: Match;
  onBack: () => void;
}

type ActionKind =
  | 'menu'
  | 'sub'
  | 'libero-on'
  | 'libero-off'
  | 'libero-officially-replaced'
  | 'timeout'
  | 'sanction'
  | 'points-by-server'
  | 'edit-lineup'
  | 'edit-last-point'
  | 'match-info';

export function MatchScoringScreen({ initialMatch, onBack }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [match, setMatch] = useState<Match>(initialMatch);
  const state = useMemo(() => deriveMatchState(match), [match]);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeAction, setActiveAction] = useState<ActionKind | null>(null);
  const [actionTeam, setActionTeam] = useState<Side>('home');
  const [editLineupSelected, setEditLineupSelected] = useState<{ team: Side; posIdx: number } | undefined>(undefined);
  const [confirmSetEndAt, setConfirmSetEndAt] = useState<{
    home: number;
    away: number;
  } | null>(null);
  /** Score at which the user last dismissed the "End Set?" prompt.
   *  Prevents the auto-detect useEffect from re-opening the modal
   *  for the same score after the user tapped "Not yet". Resets when
   *  the score changes (i.e. another point is scored). */
  const [dismissedEndAt, setDismissedEndAt] = useState<{
    home: number;
    away: number;
  } | null>(null);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [abandonReason, setAbandonReason] = useState('');

  // Post-match save sheet — fires once when match-end is recognised
  // during this scoring session. We track "matchComplete on initial
  // load" via a ref so resuming a previously-completed match doesn't
  // re-pop the sheet. The sheet is purely opt-in metadata: until the
  // user picks Save / Don't save, the match remains in storage as it
  // was during scoring (Tier 2 saves on every mutation).
  const matchAlreadyCompleteOnLoadRef = useRef(
    initialMatch.status === 'complete' || initialMatch.status === 'abandoned'
  );
  const [postMatchSaveOpen, setPostMatchSaveOpen] = useState(false);
  const [postMatchSaveShown, setPostMatchSaveShown] = useState(false);

  // ── Stat tagging ────────────────────────────────────────────────────────
  // When a player cell is tapped on the court diagram, we enter "stat mode"
  // instead of opening the lineup editor. The selected player's shirt # and
  // team are stored here; a floating stat bar appears with action buttons.
  const [statSelection, setStatSelection] = useState<{
    team: Side;
    shirt: number;
    posIdx: number;
  } | null>(null);

  // Persist on every mutation. Synchronous-looking from the UI's POV
  // but actually fire-and-forget to AsyncStorage.
  useEffect(() => {
    saveMatch(match).catch(() => {});
  }, [match]);

  // Open the post-match save sheet on the *first* match-end recognised
  // this session. Resumed-already-complete matches don't re-prompt.
  useEffect(() => {
    if (matchAlreadyCompleteOnLoadRef.current) return;
    if (postMatchSaveShown) return;
    if (state.matchComplete) {
      setPostMatchSaveOpen(true);
      setPostMatchSaveShown(true);
    }
  }, [state.matchComplete, postMatchSaveShown]);

  /**
   * Save the match with the user's chosen classification metadata.
   * Mutates `match.meta` in place; the auto-save useEffect picks it
   * up on the next render.
   */
  function applyPostMatchSave(args: {
    matchKind: MatchKind;
    tournamentPick: TournamentPickerEntry | null;
    opponentName: string | null;
    matchLabel: string;
    includeInStats: boolean;
  }) {
    setMatch((m) => {
      const nextAway = args.opponentName
        ? { ...m.meta.away, label: args.opponentName }
        : m.meta.away;
      return {
        ...m,
        meta: {
          ...m.meta,
          matchKind: args.matchKind,
          includeInStats: args.includeInStats,
          matchLabel: args.matchLabel.trim() || m.meta.matchLabel,
          away: nextAway,
          linkedAesEvent:
            args.tournamentPick?.source === 'aes'
              ? args.tournamentPick.aes
              : undefined,
          linkedTimuTournament:
            args.tournamentPick?.source === 'timu'
              ? args.tournamentPick.timu
              : undefined,
        },
        updatedAt: Date.now(),
      };
    });
    setPostMatchSaveOpen(false);
  }

  /**
   * "Don't save": purge this match from `scored.matches.v1` and bounce
   * back to the prior screen. Tier 2 has been auto-saving the match
   * the whole time, so we have to actively delete it.
   */
  async function discardMatchAndExit() {
    setPostMatchSaveOpen(false);
    try {
      await deleteMatch(match.id);
    } catch {
      /* best effort */
    }
    onBack();
  }

  // ── Derived UI shape ────────────────────────────────────────────────────
  const homeMeta = match.meta.home;
  const awayMeta = match.meta.away;
  const homeColor = homeMeta.colorHex || colors.primary;
  const awayColor = awayMeta.colorHex || colors.accent;

  const score = state.currentSet?.score ?? { home: 0, away: 0 };
  const target = state.currentSet?.target ?? match.meta.setTargets.regular;
  const isDecider = state.currentSet?.isDecider ?? false;
  const winBy = match.meta.setTargets.winBy;
  const subRule = match.meta.subRule ?? 'vc';
  const isBeach = match.meta.sport === 'beach';

  // Detect if the most recent point closed a set per the rules but no
  // set-end event has been fired yet.
  useEffect(() => {
    if (!state.currentSet) return;
    if (state.matchComplete) return;
    if (confirmSetEndAt) return;
    // Don't re-prompt if the user already dismissed for this exact score
    if (
      dismissedEndAt &&
      dismissedEndAt.home === score.home &&
      dismissedEndAt.away === score.away
    ) return;
    const max = Math.max(score.home, score.away);
    const diff = Math.abs(score.home - score.away);
    if (max >= target && diff >= winBy) {
      setConfirmSetEndAt({ home: score.home, away: score.away });
    }
  }, [state.currentSet, score.home, score.away, target, winBy, state.matchComplete, confirmSetEndAt, dismissedEndAt]);

  // Auto-suggest: bring the libero back on for the new server after a
  // side-out. Triggered when (a) we just had a rotation (server changed
  // sides), (b) the team that just took over the serve has a libero off
  // the floor who's eligible to return, and (c) the new position-I
  // player normally would be back-row-replaced by the libero. We don't
  // fire automatically — we open the LiberoOnModal pre-populated so the
  // user just confirms or changes who's coming on.
  const [autoLibOnSuggested, setAutoLibOnSuggested] = useState<{ team: Side; rallyKey: number } | null>(null);
  useEffect(() => {
    if (!state.currentSet) { setAutoLibOnSuggested(null); return; }
    if (activeAction != null) return; // user is mid-action; don't interrupt
    const cs = state.currentSet;
    // Only trigger right after a side-out (server changed). We detect
    // that by checking the LAST point event was a side-out.
    const lastPoint = [...match.events].reverse().find((e): e is PointEvent => e.type === 'point');
    if (!lastPoint) return;
    // The serving side AFTER the point: cs.server. If lastPoint.scoringTeam
    // matches cs.server, that was a side-out.
    if (lastPoint.scoringTeam !== cs.server) return;
    const team = cs.server!;
    const rot = cs.rotation[team];
    if (rot.liberos.length === 0) return; // no libero to bring on
    if (rot.liberoOnFloor != null) return; // already on
    if (rot.liberoCameOffAtRally == null) return; // libero hasn't been used this set yet — don't pre-empt the first manual swap-in
    // Re-entry rule: libero must rest at least one rally. cs.rallyCount
    // is monotonically increasing per rally; canApplyLiberoOn validates
    // the rest period, so we can defer to that.
    // The rotation has rotated: the new position I is now serving. They
    // shouldn't be replaced by the libero (they're serving). The candidate
    // for libero replacement is whoever's at position V (left back). If
    // the team has libero-may-serve configured, the position-I server
    // could also be a libero substitution target — we leave that path
    // out for now since it requires per-team config awareness.
    const candidateBackRowShirt = rot.positions[4]; // position V (left back)
    if (candidateBackRowShirt == null || candidateBackRowShirt === 0) return;
    // Don't re-fire for the same rally.
    const key = cs.rallyCount;
    if (autoLibOnSuggested && autoLibOnSuggested.team === team && autoLibOnSuggested.rallyKey === key) return;
    setAutoLibOnSuggested({ team, rallyKey: key });
    // Libero placement supersedes any in-progress stat tagging — clear
    // the StatBar selection so the user isn't looking at two competing
    // surfaces when the modal pops.
    setStatSelection(null);
    // Open the libero-on modal pre-populated. The modal already defaults
    // to libero #liberos[0] and lets the user pick the back-row player.
    setActionTeam(team);
    setActiveAction('libero-on');
  }, [state.currentSet, match.events, activeAction, autoLibOnSuggested]);

  // (Note: the libero-in-front-row enforcement is now done in the engine
  // itself — see `autoSwapLiberoOffIfFront` in matchEngine.ts. Doing it
  // there means the libero state is corrected during state derivation,
  // not via a delayed React side-effect, so no rally can happen with the
  // libero in an illegal position regardless of UI timing.)

  // ── Mutators ────────────────────────────────────────────────────────────
  function fire(event: MatchEvent) {
    setMatch((m) => appendEvent(m, event));
  }

  function tapScore(team: Side) {
    if (state.matchComplete || state.abandoned) return;
    const ev: PointEvent = {
      id: makeEventId(),
      ts: Date.now(),
      setIndex: state.currentSetIndex,
      type: 'point',
      scoringTeam: team,
    };
    fire(ev);
  }

  function undoLast() {
    setMatch((m) => {
      const last = m.events[m.events.length - 1];
      if (!last) return m;
      return removeEventById(m, last.id);
    });
  }

  // ── Stat tagging mutators ──────────────────────────────────────────────
  /**
   * Fire a stat event for the currently selected player. For point-scoring
   * stats (kill, block, ace), also fire a PointEvent so the score updates.
   */
  function fireStat(category: StatCategory) {
    if (!statSelection || !state.currentSet) return;
    const { team, shirt } = statSelection;

    const snapshot = snapshotFromState(state);
    if (!snapshot) return;

    const statEv: StatEvent = {
      id: makeEventId(),
      ts: Date.now(),
      setIndex: state.currentSetIndex,
      type: 'stat',
      team,
      shirt,
      category,
      courtSnapshot: snapshot,
    };
    fire(statEv);

    // Point-scoring stats also award the point
    if (category === 'kill' || category === 'block' || category === 'ace') {
      const pointEv: PointEvent = {
        id: makeEventId(),
        ts: Date.now(),
        setIndex: state.currentSetIndex,
        type: 'point',
        scoringTeam: team,
        reason: category === 'kill' ? 'kill' : category === 'block' ? 'block' : 'ace',
        shirt,
        courtSnapshot: snapshot,
      };
      fire(pointEv);
    }

    // Clear the stat selection after firing
    setStatSelection(null);
  }

  /**
   * Fire a pass stat with a quality grade (0-3).
   */
  function firePassStat(quality: 0 | 1 | 2 | 3) {
    if (!statSelection || !state.currentSet) return;
    const { team, shirt } = statSelection;
    const snapshot = snapshotFromState(state);
    if (!snapshot) return;

    const statEv: StatEvent = {
      id: makeEventId(),
      ts: Date.now(),
      setIndex: state.currentSetIndex,
      type: 'stat',
      team,
      shirt,
      category: 'pass',
      quality,
      courtSnapshot: snapshot,
    };
    fire(statEv);
    setStatSelection(null);
  }

  /** Look up a player name from the roster by shirt # and side. */
  function playerName(team: Side, shirt: number): string {
    const roster = team === 'home' ? match.rosters.home : match.rosters.away;
    const p = roster.find((r) => r.shirt === shirt);
    return p?.name ?? `#${shirt}`;
  }

  function confirmSetEnd() {
    if (!confirmSetEndAt) return;
    const ev: SetEndEvent = {
      id: makeEventId(),
      ts: Date.now(),
      setIndex: state.currentSetIndex,
      type: 'set-end',
      homeFinal: confirmSetEndAt.home,
      awayFinal: confirmSetEndAt.away,
      durationMs: deriveSetDurationMs(match, state.currentSetIndex),
    };
    setMatch((m) => appendEvent(m, ev));
    setConfirmSetEndAt(null);

    // If the set-end completes the match, fire match-end automatically.
    // For normal between-set transitions, we DON'T pop a modal anymore —
    // the between-sets banner handles "set up next lineup" affordance so
    // dismissing it doesn't lock the user out.
    setTimeout(() => {
      setMatch((m) => {
        const s = deriveMatchState(m);
        if (s.matchComplete && !m.events.some((e) => e.type === 'match-end')) {
          const me: MatchEndEvent = {
            id: makeEventId(),
            ts: Date.now(),
            setIndex: s.currentSetIndex,
            type: 'match-end',
            setsHome: s.setsWon.home,
            setsAway: s.setsWon.away,
            durationMs: deriveMatchDurationMs(m),
          };
          return { ...appendEvent(m, me), status: 'complete' };
        }
        return m;
      });
    }, 0);
  }

  function dismissSetEnd() {
    // Remember the score so the auto-detect effect won't re-open the
    // modal immediately. The guard resets once another point is scored
    // (score changes), so the prompt will reappear at a new score.
    if (confirmSetEndAt) {
      setDismissedEndAt({ home: confirmSetEndAt.home, away: confirmSetEndAt.away });
    }
    setConfirmSetEndAt(null);
  }

  /** Re-fires the previous set's starting lineup events for the new set
   *  index so scoring + subs can resume. Idempotent: if a lineup already
   *  exists for the next set, this is a no-op. */
  function continueWithSameLineup() {
    setMatch((m) => {
      const nextSetIndex = deriveMatchState(m).setHistory.length;
      // Already has lineups for this set? Nothing to do.
      const hasHome = m.events.some((e) => e.type === 'lineup' && e.team === 'home' && e.setIndex === nextSetIndex);
      const hasAway = m.events.some((e) => e.type === 'lineup' && e.team === 'away' && e.setIndex === nextSetIndex);
      if (hasHome && hasAway) return m;

      const lastHomeLineup = [...m.events]
        .reverse()
        .find((e): e is LineupEvent => e.type === 'lineup' && e.team === 'home');
      const lastAwayLineup = [...m.events]
        .reverse()
        .find((e): e is LineupEvent => e.type === 'lineup' && e.team === 'away');
      if (!lastHomeLineup || !lastAwayLineup) return m;
      const ts = Date.now();
      let next = m;
      if (!hasHome) {
        next = appendEvent(next, {
          ...lastHomeLineup,
          id: makeEventId(),
          ts,
          setIndex: nextSetIndex,
        });
      }
      if (!hasAway) {
        next = appendEvent(next, {
          ...lastAwayLineup,
          id: makeEventId(),
          ts: ts + 1,
          setIndex: nextSetIndex,
        });
      }
      return next;
    });
  }

  function abandonMatch() {
    if (!abandonReason.trim()) {
      Alert.alert('Reason required', 'Add a short reason for the abandonment.');
      return;
    }
    const ev: MatchAbandonedEvent = {
      id: makeEventId(),
      ts: Date.now(),
      setIndex: state.currentSetIndex,
      type: 'match-abandoned',
      reason: abandonReason.trim(),
    };
    setMatch((m) => ({ ...appendEvent(m, ev), status: 'abandoned' }));
    setAbandonOpen(false);
    setAbandonReason('');
  }

  function manualEndSet() {
    setConfirmSetEndAt({ home: score.home, away: score.away });
  }

  /**
   * Undo an accidental "End set" / match-end. Pops the most recent
   * match-end event (if any) plus the most recent set-end event so the
   * previous set is "live" again — score and rotation re-derive from
   * the remaining events. Also resets `match.status` from the persisted
   * 'complete' / 'abandoned' tag so the saved match shows in-progress
   * after the undo.
   */
  function reopenPreviousSet() {
    setMatch((m) => {
      let next = m;
      // Walk backwards, removing the trailing match-end first (if any)
      // and then exactly one set-end. Stop after.
      let removedSetEnd = false;
      while (next.events.length > 0 && !removedSetEnd) {
        const last = next.events[next.events.length - 1];
        if (last.type === 'match-end') {
          next = removeEventById(next, last.id);
          continue;
        }
        if (last.type === 'set-end') {
          next = removeEventById(next, last.id);
          removedSetEnd = true;
          break;
        }
        // Hit a non-end event without finding a set-end: nothing to do.
        break;
      }
      return { ...next, status: 'in-progress' as const, updatedAt: Date.now() };
    });
  }

  /**
   * Apply a `firstServer` override on the current set's lineup events.
   * Used by LineupEditModal's "First serve" picker. Also accepts a
   * blank value to clear the override (fall back to alternation).
   */
  function applyFirstServerOverride(setIdx: number, firstServer: Side | null) {
    setMatch((m) => {
      const events = m.events.map((e) => {
        if (e.type !== 'lineup' || e.setIndex !== setIdx) return e;
        return { ...e, firstServer: firstServer ?? undefined } as LineupEvent;
      });
      return { ...m, events, updatedAt: Date.now() };
    });
  }

  // ── Action helpers ──────────────────────────────────────────────────────
  function openAction(kind: ActionKind, team: Side = 'home') {
    setActionTeam(team);
    setActiveAction(kind);
  }

  function fireSub(team: Side, outShirt: number, inShirt: number) {
    const ev: SubEvent = {
      id: makeEventId(),
      ts: Date.now(),
      setIndex: state.currentSetIndex,
      type: 'sub',
      team,
      out: outShirt,
      in: inShirt,
    };
    fire(ev);
    setActiveAction(null);
  }

  function fireLiberoOn(team: Side, libero: number, replaces: number) {
    const ev: LiberoOnEvent = {
      id: makeEventId(),
      ts: Date.now(),
      setIndex: state.currentSetIndex,
      type: 'libero-on',
      team,
      libero,
      replaces,
    };
    fire(ev);
    setActiveAction(null);
  }

  function fireLiberoOff(team: Side, libero: number, replacedBy: number) {
    const ev: LiberoOffEvent = {
      id: makeEventId(),
      ts: Date.now(),
      setIndex: state.currentSetIndex,
      type: 'libero-off',
      team,
      libero,
      replacedBy,
    };
    fire(ev);
    setActiveAction(null);
  }

  function fireLiberoOfficiallyReplaced(team: Side, libero: number, replacedBy: number, reason?: string) {
    const ev: LiberoOfficiallyReplacedEvent = {
      id: makeEventId(),
      ts: Date.now(),
      setIndex: state.currentSetIndex,
      type: 'libero-officially-replaced',
      team,
      libero,
      replacedBy,
      reason: reason?.trim() || undefined,
    };
    fire(ev);
    setActiveAction(null);
  }

  function fireTimeout(team: Side) {
    const ev: TimeoutEvent = {
      id: makeEventId(),
      ts: Date.now(),
      setIndex: state.currentSetIndex,
      type: 'timeout',
      team,
    };
    fire(ev);
    setActiveAction(null);
  }

  /**
   * Replace (or insert) the lineup events for a given set index. Used at
   * start-of-set and between-sets where rotation is at index 0 — the
   * "starting six" tuple equals what's on the floor. Mid-set lineup
   * changes go through `applyMidSetLineupChange` which fires sub events
   * instead, since the engine treats lineup events as the post-coin-toss
   * starting six and replays rotation from there.
   */
  function applyLineupEdit(targetSetIndex: number, homeLineup: Lineup, awayLineup: Lineup, homeLiberos: number[], awayLiberos: number[]) {
    setMatch((m) => {
      // Remove any existing lineup events for this set.
      let next: Match = {
        ...m,
        events: m.events.filter((e) => !(e.type === 'lineup' && e.setIndex === targetSetIndex)),
        updatedAt: Date.now(),
      };
      const events = next.events.slice();
      const firstSetEventIdx = events.findIndex((e) => e.setIndex === targetSetIndex);
      const ts = Date.now();
      const homeEv: LineupEvent = {
        id: makeEventId(),
        ts,
        setIndex: targetSetIndex,
        type: 'lineup',
        team: 'home',
        positions: homeLineup,
        liberos: homeLiberos,
      };
      const awayEv: LineupEvent = {
        id: makeEventId(),
        ts: ts + 1,
        setIndex: targetSetIndex,
        type: 'lineup',
        team: 'away',
        positions: awayLineup,
        liberos: awayLiberos,
      };
      if (firstSetEventIdx < 0) {
        events.push(homeEv, awayEv);
      } else {
        events.splice(firstSetEventIdx, 0, homeEv, awayEv);
      }
      return { ...next, events };
    });
    setActiveAction(null);
  }

  /**
   * Compare the previous libero-on state to the new intent, and fire
   * the right combination of libero-on / libero-off events. Used after a
   * mid-set lineup save so the engine's libero state matches what the
   * user just configured in the editor.
   */
  function applyLiberoIntentDiff(
    team: Side,
    before: { libero: number; replaces: number } | null,
    after: { libero: number; replaces: number } | null
  ) {
    if (!before && !after) return;
    if (before && after && before.libero === after.libero && before.replaces === after.replaces) return;
    setMatch((m) => {
      let next = m;
      const setIdx = deriveMatchState(next).currentSetIndex;
      if (before) {
        // Take the existing libero off first.
        const ev: LiberoOffEvent = {
          id: makeEventId(),
          ts: Date.now(),
          setIndex: setIdx,
          type: 'libero-off',
          team,
          libero: before.libero,
          replacedBy: before.replaces,
        };
        next = appendEvent(next, ev);
      }
      if (after) {
        const ev: LiberoOnEvent = {
          id: makeEventId(),
          ts: Date.now() + 1,
          setIndex: setIdx,
          type: 'libero-on',
          team,
          libero: after.libero,
          replaces: after.replaces,
        };
        next = appendEvent(next, ev);
      }
      return next;
    });
  }

  /**
   * Mid-set lineup adjustment. Diffs the new lineup against the current
   * floor and fires one `sub` event per position whose shirt changed.
   * Refuses on-floor swaps (where two existing players exchange positions),
   * which aren't legal volleyball anyway. Libero changes are handled
   * separately by the auto-pop libero modals.
   */
  function applyMidSetLineupChange(team: Side, oldOnFloor: number[], newOnFloor: number[]) {
    if (oldOnFloor.length !== 6 || newOnFloor.length !== 6) return;
    const oldSet = new Set(oldOnFloor);
    const newSet = new Set(newOnFloor);
    const subs: Array<{ out: number; in: number }> = [];
    for (let i = 0; i < 6; i++) {
      if (oldOnFloor[i] === newOnFloor[i]) continue;
      // The new shirt at this position arrived from somewhere — bench or another floor slot.
      const newShirt = newOnFloor[i];
      const oldShirt = oldOnFloor[i];
      if (oldSet.has(newShirt)) {
        // The new shirt was already on the floor (different position) — that's
        // a position swap, not a sub. Refuse.
        Alert.alert('Position swap not allowed mid-set', 'Players cannot exchange positions on the floor mid-set. Only bench-substitutions are legal.');
        return;
      }
      if (newSet.has(oldShirt)) {
        // The old shirt is still on the floor (moved elsewhere via paired diff) — also a swap.
        Alert.alert('Position swap not allowed mid-set', 'Players cannot exchange positions on the floor mid-set.');
        return;
      }
      subs.push({ out: oldShirt, in: newShirt });
    }
    if (subs.length === 0) return;
    setMatch((m) => {
      let next = m;
      const baseTs = Date.now();
      subs.forEach(({ out, in: inn }, idx) => {
        const ev: SubEvent = {
          id: makeEventId(),
          ts: baseTs + idx,
          setIndex: deriveMatchState(next).currentSetIndex,
          type: 'sub',
          team,
          out,
          in: inn,
        };
        next = appendEvent(next, ev);
      });
      return next;
    });
    setActiveAction(null);
  }

  /**
   * Replace the most recent point event with a corrected one. Used by
   * EditLastPointModal to fix mis-tapped points (wrong team / wrong
   * scoring reason / attribute to a player after the fact).
   */
  function applyEditLastPoint(targetTeam: Side, reason: PointEvent['reason'], shirt: number | undefined) {
    setMatch((m) => {
      // Find the most recent point event (across all sets, in case the
      // match has just transitioned to set-end and the user wants to
      // undo a final point).
      let lastPointIdx = -1;
      for (let i = m.events.length - 1; i >= 0; i--) {
        if (m.events[i].type === 'point') { lastPointIdx = i; break; }
      }
      if (lastPointIdx < 0) return m;
      const old = m.events[lastPointIdx] as PointEvent;
      const replacement: PointEvent = {
        ...old,
        scoringTeam: targetTeam,
        reason: reason ?? null,
        shirt,
      };
      const events = m.events.slice();
      events[lastPointIdx] = replacement;
      return { ...m, events, updatedAt: Date.now() };
    });
    setActiveAction(null);
  }

  function fireSanction(team: Side, level: SanctionEvent['level'], target: SanctionEvent['target'], shirt: number | undefined, reason: string) {
    const ev: SanctionEvent = {
      id: makeEventId(),
      ts: Date.now(),
      setIndex: state.currentSetIndex,
      type: 'sanction',
      team,
      target,
      shirt,
      level,
      reason: reason.trim() || undefined,
    };
    fire(ev);
    setActiveAction(null);
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const winner = state.winner;
  const matchOver = state.matchComplete || state.abandoned;
  const setLabel = (state.currentSetIndex + 1).toString();

  const homeRot = state.currentSet?.rotation.home;
  const awayRot = state.currentSet?.rotation.away;

  const setStartedAt = useMemo(
    () => deriveSetStartMs(match, state.currentSetIndex),
    [match, state.currentSetIndex]
  );

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, isLandscape && styles.topBarLandscape]}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backBtn}>{'< Back'}</Text>
        </TouchableOpacity>
        {!isLandscape ? (
          <TouchableOpacity
            style={{ flex: 1, alignItems: 'center' }}
            onPress={() => setActiveAction('match-info')}
            activeOpacity={0.7}
          >
            <Text style={styles.title} numberOfLines={1}>{match.meta.matchLabel || 'Match'}</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{match.meta.eventName} · {match.meta.division} · ✎</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={() => setAbandonOpen(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.abandonBtn}>End</Text>
        </TouchableOpacity>
      </View>

      {/* Status strip — set #, target, sets won, sub counts, set timer */}
      <View style={styles.statusStrip}>
        <Text style={styles.statusText} numberOfLines={1}>
          Set {setLabel}{isDecider ? ' (deciding)' : ''} · target {target} · sets {state.setsWon.home}–{state.setsWon.away}
          {!isBeach && homeRot && awayRot ? ` · subs ${formatSubCount(homeRot, subRule)}/${formatSubCount(awayRot, subRule)}` : ''}
          {state.currentSet ? ` · TO ${state.currentSet.timeoutsUsed.home}–${state.currentSet.timeoutsUsed.away}` : ''}
          {setStartedAt ? ` · started ${formatHM(setStartedAt)}` : ''}
        </Text>
      </View>

      {/* Between-sets banner — appears whenever the previous set ended
          but no lineup has been fired for the next set yet. Lineup
          changes between sets do NOT count against the in-set sub cap
          per FIVB rules — they're a fresh starting six. */}
      {!matchOver && !state.currentSet && state.setHistory.length > 0 ? (
        <View style={styles.betweenSetsBanner}>
          <Text style={styles.betweenSetsTitle}>
            Set {state.setHistory.length + 1} ready
          </Text>
          <Text style={styles.betweenSetsBody}>
            The previous set ended. Continue with the same starting six, or edit the lineup before serve — between-set lineup changes don't count as substitutions.
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TouchableOpacity onPress={continueWithSameLineup} style={[styles.betweenSetsBtn, { flex: 1 }]} activeOpacity={0.7}>
              <Text style={styles.betweenSetsBtnText}>Continue same lineup</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                // First fire the same lineup so currentSet exists, then
                // open the editor so the user can swap players. The
                // editor will replace those just-created lineup events.
                continueWithSameLineup();
                setTimeout(() => setActiveAction('edit-lineup'), 0);
              }}
              style={[styles.betweenSetsBtnSecondary, { flex: 1 }]}
              activeOpacity={0.7}
            >
              <Text style={styles.betweenSetsBtnSecondaryText}>Edit lineup</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={reopenPreviousSet} style={[styles.betweenSetsBtnSecondary, { marginTop: spacing.sm }]} activeOpacity={0.7}>
            <Text style={styles.betweenSetsBtnSecondaryText}>↶ Reopen Set {state.setHistory.length} (undo last End Set)</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Start-of-set quick edit — visible only when score is 0–0 in the
          current set so the scorer can still fix a mis-typed initial
          rotation before the first serve goes up. Also exposes the first-
          server toggle so the scorer can override the alternation rule
          without diving into the lineup editor. */}
      {state.currentSet && score.home === 0 && score.away === 0 && !matchOver ? (
        <View style={styles.startSetEditBar}>
          <Text style={styles.startSetEditText}>Set {state.currentSetIndex + 1} ready · 0–0</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <TouchableOpacity
              onPress={() => {
                // Toggle: if home currently serves first, override to away;
                // if away serves first, override to home; if "auto" matches
                // home, override to away.
                const newSide: Side = state.currentSet?.server === 'home' ? 'away' : 'home';
                applyFirstServerOverride(state.currentSetIndex, newSide);
              }}
              style={styles.startSetEditBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.startSetEditBtnText}>
                Serving: {state.currentSet?.server === 'home' ? homeMeta.label : awayMeta.label} ↻
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setActiveAction('edit-lineup')} style={styles.startSetEditBtn} activeOpacity={0.7}>
              <Text style={styles.startSetEditBtnText}>Edit ✎</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Last-point bar — lets the user fix a misclick (wrong team) and
          attribute the point to a player after the fact for stats. */}
      {(() => {
        const lastPoint = [...match.events].reverse().find((e): e is PointEvent => e.type === 'point');
        if (!lastPoint || matchOver) return null;
        const teamLabel = lastPoint.scoringTeam === 'home' ? homeMeta.label : awayMeta.label;
        const teamColor = lastPoint.scoringTeam === 'home' ? homeColor : awayColor;
        return (
          <TouchableOpacity
            onPress={() => setActiveAction('edit-last-point')}
            style={styles.lastPointBar}
            activeOpacity={0.7}
          >
            <View style={[styles.lastPointDot, { backgroundColor: teamColor }]} />
            <Text style={styles.lastPointText} numberOfLines={1}>
              Last: {teamLabel} +1{lastPoint.shirt ? ` (#${lastPoint.shirt})` : ''}{lastPoint.reason ? ` · ${lastPoint.reason}` : ''}
            </Text>
            <Text style={styles.lastPointEdit}>Edit ›</Text>
          </TouchableOpacity>
        );
      })()}

      {/* Score panels — flex 3 so mini-court below can take meaningful
          real estate (flex 2). Without explicit weights the panel ate
          almost the entire screen and the rotation strip was a sliver. */}
      <View style={[styles.boardRow, { flex: 3 }]}>
        <ScorePanel
          label={homeMeta.label}
          color={homeColor}
          score={score.home}
          isServing={state.currentSet?.server === 'home'}
          serverShirt={state.currentSet?.server === 'home' ? state.currentSet.serverShirt : null}
          setsWon={state.setsWon.home}
          onTap={() => tapScore('home')}
          isWinner={winner === 'home'}
          disabled={matchOver || !state.currentSet}
          isLandscape={isLandscape}
          colors={colors}
          styles={styles}
        />
        <View style={styles.separator} />
        <ScorePanel
          label={awayMeta.label}
          color={awayColor}
          score={score.away}
          isServing={state.currentSet?.server === 'away'}
          serverShirt={state.currentSet?.server === 'away' ? state.currentSet.serverShirt : null}
          setsWon={state.setsWon.away}
          onTap={() => tapScore('away')}
          isWinner={winner === 'away'}
          disabled={matchOver || !state.currentSet}
          isLandscape={isLandscape}
          colors={colors}
          styles={styles}
        />
      </View>

      {/* Rotation mini-court (indoor only — beach has no rotation).
          Rendered as a real court: away on top, home on bottom, with a
          net divider in the middle. Each team's positions are mirrored
          from their own perspective so the scorer sees the layout as
          they would see it from the audience side: away's right-back
          (position I) appears in the user's TOP-LEFT because away faces
          the user. Home's right-back is BOTTOM-RIGHT.  */}
      {!isBeach && state.currentSet ? (
        <View style={[styles.miniCourtWrap, { flex: 2 }]}>
          <CourtRotationView
            homeLabel={homeMeta.label}
            awayLabel={awayMeta.label}
            homeColor={homeColor}
            awayColor={awayColor}
            homeRot={state.currentSet.rotation.home}
            awayRot={state.currentSet.rotation.away}
            server={state.currentSet.server}
            homeServerShirt={state.currentSet.server === 'home' ? state.currentSet.serverShirt : null}
            awayServerShirt={state.currentSet.server === 'away' ? state.currentSet.serverShirt : null}
            selectedCell={statSelection ? { team: statSelection.team, posIdx: statSelection.posIdx } : undefined}
            onCellPress={(team, posIdx) => {
              // Determine the shirt # at this position
              const rot = team === 'home'
                ? state.currentSet!.rotation.home
                : state.currentSet!.rotation.away;
              const shirt = rot.positions[posIdx];
              if (shirt == null || shirt === 0) return;
              // Toggle stat selection: if already selected, deselect;
              // if a different player, switch to them.
              if (statSelection && statSelection.team === team && statSelection.posIdx === posIdx) {
                setStatSelection(null);
              } else {
                setStatSelection({ team, shirt, posIdx });
              }
            }}
            colors={colors}
            styles={styles}
          />
        </View>
      ) : null}

      {/* ── Stat bar — appears when a player cell is tapped ─────────── */}
      {statSelection && state.currentSet && !matchOver ? (
        <StatBar
          team={statSelection.team}
          shirt={statSelection.shirt}
          playerName={playerName(statSelection.team, statSelection.shirt)}
          teamLabel={statSelection.team === 'home' ? homeMeta.label : awayMeta.label}
          teamColor={statSelection.team === 'home' ? homeColor : awayColor}
          onStat={fireStat}
          onPassWithQuality={firePassStat}
          onSub={(benchShirt) => {
            const team = statSelection.team;
            const outShirt = statSelection.shirt;
            // Validate against engine rules (sub cap, locked-out re-entry,
            // etc.) before firing. If anything's wrong, surface as an
            // Alert and abort — same UX as the other action modals.
            const ev: SubEvent = {
              id: makeEventId(),
              ts: Date.now(),
              setIndex: state.currentSetIndex,
              type: 'sub',
              team,
              out: outShirt,
              in: benchShirt,
            };
            const validation = canApplySub(state, ev, match.rosters, subRule);
            if (validation.warnings.length > 0) {
              Alert.alert(
                'Substitution not allowed',
                validation.warnings.join('\n')
              );
              return;
            }
            fireSub(team, outShirt, benchShirt);
            setStatSelection(null);
          }}
          benchShirts={(() => {
            const rot = state.currentSet!.rotation[statSelection.team];
            const onFloor = rot.positions;
            const roster = match.rosters[statSelection.team];
            return roster
              .filter((p) => p.active && !p.isLibero && !onFloor.includes(p.shirt))
              .map((p) => p.shirt);
          })()}
          onDismiss={() => setStatSelection(null)}
          onEditLineup={() => {
            setEditLineupSelected({ team: statSelection.team, posIdx: statSelection.posIdx });
            setStatSelection(null);
            setActiveAction('edit-lineup');
          }}
          colors={colors}
          styles={styles}
        />
      ) : null}

      {/* Past-sets strip */}
      {state.setHistory.length > 0 ? (
        <Text style={styles.pastSetsLine} numberOfLines={1}>
          {state.setHistory.map((s) => `S${s.setIndex + 1} ${s.homeFinal}–${s.awayFinal} (${formatDuration(s.durationMs)})`).join('  ·  ')}
        </Text>
      ) : null}

      {/* Win-probability indicator — between past-sets strip and shelf.
          Shares the WinProbabilityBar component with the Tier 1 hold-up
          scoreboard so the math has a single source of truth. */}
      {state.currentSet && state.currentSet.server != null ? (
        <WinProbabilityBar
          homeScore={state.currentSet.score.home}
          awayScore={state.currentSet.score.away}
          target={state.currentSet.target}
          winBy={match.meta.setTargets.winBy}
          server={state.currentSet.server}
          setsWonHome={state.setsWon.home}
          setsWonAway={state.setsWon.away}
          setsToWin={Math.ceil(match.meta.bestOf / 2)}
          homeColor={homeColor}
          awayColor={awayColor}
          setEnded={matchOver}
          setWinner={state.winner === 'home' || state.winner === 'away' ? state.winner : null}
          compact
        />
      ) : null}

      {/* Action shelf — sits at the bottom of the screen content. The
          parent App.tsx wrapper reserves BOTTOM_TAB_BAR_HEIGHT + safe-area
          inset below this screen so the tab bar never overlaps; the shelf
          itself just needs its standard internal padding. */}
      <View style={[styles.shelf, { paddingBottom: spacing.sm }]}>
        <ShelfBtn label="↶ Undo" onPress={undoLast} disabled={match.events.length === 0 || matchOver} colors={colors} styles={styles} />
        <ShelfBtn
          label="▦ Line ups"
          onPress={() => { setEditLineupSelected(undefined); setActiveAction('edit-lineup'); }}
          disabled={matchOver || !state.currentSet || isBeach}
          colors={colors}
          styles={styles}
        />
        <ShelfBtn label="⋯ More" onPress={() => setActiveAction('menu')} disabled={matchOver} colors={colors} styles={styles} />
        <ShelfBtn label="🕘 Log" onPress={() => setHistoryOpen(true)} colors={colors} styles={styles} />
        <ShelfBtn label="End Set" onPress={manualEndSet} disabled={matchOver} colors={colors} styles={styles} />
      </View>

      {/* Bottom info: match-complete banner. Includes a "Reopen previous set"
          escape hatch so an accidental "End Set" tap on the deciding set
          (which auto-fires match-end) can be undone in one tap. */}
      {matchOver ? (
        <View style={styles.bottomBar}>
          <Text style={styles.bottomText}>
            {state.abandoned
              ? `Abandoned · ${state.abandonedReason ?? ''}${winner ? ` · ${winner === 'home' ? homeMeta.label : awayMeta.label} awarded` : ''}`
              : winner === 'tie'
              ? `Match · Tied ${state.setsWon.home}–${state.setsWon.away}`
              : `Match · ${winner === 'home' ? homeMeta.label : awayMeta.label} wins ${state.setsWon.home}–${state.setsWon.away}`}
          </Text>
          {!state.abandoned && state.setHistory.length > 0 ? (
            <TouchableOpacity onPress={reopenPreviousSet} style={[styles.betweenSetsBtnSecondary, { marginTop: spacing.sm, alignSelf: 'stretch' }]} activeOpacity={0.7}>
              <Text style={styles.betweenSetsBtnSecondaryText}>↶ Reopen Set {state.setHistory.length} (oops, didn't mean to end)</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* (Court popup removed — the "Line ups" shelf button now opens the
          full-featured LineupEditModal directly so the user no longer
          has to navigate through a viewer first.) */}

      {/* History scrubber modal — read-only in Session B. Each row now shows
          the running score as of the moment that event landed, so the user
          can see "sub at 14–9" / "timeout at 21–18" etc. */}
      <Modal visible={historyOpen} transparent animationType="slide" onRequestClose={() => setHistoryOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCardLg}>
            <Text style={styles.modalTitle}>Event log</Text>
            <ScrollView style={{ maxHeight: 460 }}>
              {match.events.length === 0 ? (
                <Text style={styles.fieldHint}>No events yet.</Text>
              ) : null}
              {buildEventLogRows(match).map((r) => (
                <View key={r.event.id} style={styles.historyRow}>
                  <View style={styles.historyRowTop}>
                    <Text style={styles.historyType}>{r.event.type}</Text>
                    <Text style={styles.historyScore}>S{r.event.setIndex + 1} · {r.score.home}–{r.score.away}</Text>
                  </View>
                  <Text style={styles.historyDetail} numberOfLines={2}>
                    {summarizeEvent(r.event)}
                  </Text>
                </View>
              ))}
            </ScrollView>
            <Text style={styles.fieldHint}>Read-only in this build. Edit / delete arrives in Session D.</Text>
            <TouchableOpacity onPress={() => setHistoryOpen(false)} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* "More" action sheet — picks the action then routes to the right modal.
          Uses the same `activeAction` state as the destination modals so we never
          have two Modals stacked on top of each other (which on Android can
          swallow taps and result in the destination modal not appearing). */}
      <Modal visible={activeAction === 'menu'} transparent animationType="fade" onRequestClose={() => setActiveAction(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.actionSheet}>
            <Text style={styles.modalTitle}>Match action</Text>
            <View style={styles.actionGrid}>
              {/* Sub / Libero on / Libero off are now folded into the Line ups
                  modal: tap a player to swap with bench, tap a libero chip
                  with a back-row position selected to bring the libero on,
                  etc. The auto-pop modals handle the most common libero
                  flows (front-row exit, side-out re-entry).  */}
              <ActionTile label="Edit lineup" emoji="✎" onPress={() => openAction('edit-lineup')} disabled={isBeach || !state.currentSet} styles={styles} />
              <ActionTile label="Timeout" emoji="⏱" onPress={() => openAction('timeout')} styles={styles} />
              <ActionTile label="Sanction" emoji="🟨🟥" onPress={() => openAction('sanction')} styles={styles} />
              <ActionTile label="Libero replaced" emoji="L→R" onPress={() => openAction('libero-officially-replaced')} disabled={isBeach} styles={styles} />
              <ActionTile label="Edit last point" emoji="↩" onPress={() => openAction('edit-last-point')} styles={styles} />
              <ActionTile label="Match info" emoji="ℹ" onPress={() => openAction('match-info')} styles={styles} />
              <ActionTile label="Points by server" emoji="📋" onPress={() => openAction('points-by-server')} styles={styles} />
            </View>
            <TouchableOpacity onPress={() => setActiveAction(null)} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Action-specific modal */}
      {activeAction === 'sub' && state.currentSet ? (
        <SubModal
          visible
          team={actionTeam}
          setActionTeam={setActionTeam}
          rot={state.currentSet.rotation[actionTeam]}
          roster={match.rosters[actionTeam]}
          score={state.currentSet.score}
          homeLabel={homeMeta.label}
          awayLabel={awayMeta.label}
          subRule={subRule}
          onClose={() => setActiveAction(null)}
          onSubmit={(out, inn) => fireSub(actionTeam, out, inn)}
          colors={colors}
          styles={styles}
        />
      ) : null}

      {activeAction === 'libero-on' && state.currentSet ? (
        <LiberoOnModal
          visible
          team={actionTeam}
          setActionTeam={setActionTeam}
          rot={state.currentSet.rotation[actionTeam]}
          homeLabel={homeMeta.label}
          awayLabel={awayMeta.label}
          onClose={() => setActiveAction(null)}
          onSubmit={(libero, replaces) => fireLiberoOn(actionTeam, libero, replaces)}
          colors={colors}
          styles={styles}
        />
      ) : null}

      {activeAction === 'libero-off' && state.currentSet ? (
        <LiberoOffModal
          visible
          team={actionTeam}
          setActionTeam={setActionTeam}
          rot={state.currentSet.rotation[actionTeam]}
          roster={match.rosters[actionTeam]}
          homeLabel={homeMeta.label}
          awayLabel={awayMeta.label}
          onClose={() => setActiveAction(null)}
          onSubmit={(libero, replacedBy) => fireLiberoOff(actionTeam, libero, replacedBy)}
          colors={colors}
          styles={styles}
        />
      ) : null}

      {activeAction === 'libero-officially-replaced' && state.currentSet ? (
        <LiberoOfficiallyReplacedModal
          visible
          team={actionTeam}
          setActionTeam={setActionTeam}
          rot={state.currentSet.rotation[actionTeam]}
          roster={match.rosters[actionTeam]}
          homeLabel={homeMeta.label}
          awayLabel={awayMeta.label}
          onClose={() => setActiveAction(null)}
          onSubmit={(libero, replacedBy, reason) => fireLiberoOfficiallyReplaced(actionTeam, libero, replacedBy, reason)}
          colors={colors}
          styles={styles}
        />
      ) : null}

      {activeAction === 'timeout' && state.currentSet ? (
        <TimeoutModal
          visible
          team={actionTeam}
          setActionTeam={setActionTeam}
          timeoutsUsed={state.currentSet.timeoutsUsed}
          score={state.currentSet.score}
          homeLabel={homeMeta.label}
          awayLabel={awayMeta.label}
          onClose={() => setActiveAction(null)}
          onSubmit={() => fireTimeout(actionTeam)}
          colors={colors}
          styles={styles}
        />
      ) : null}

      {activeAction === 'sanction' ? (
        <SanctionModal
          visible
          team={actionTeam}
          setActionTeam={setActionTeam}
          homeLabel={homeMeta.label}
          awayLabel={awayMeta.label}
          onClose={() => setActiveAction(null)}
          onSubmit={(level, target, shirt, reason) => fireSanction(actionTeam, level, target, shirt, reason)}
          colors={colors}
          styles={styles}
        />
      ) : null}

      {activeAction === 'edit-lineup' && state.currentSet ? (
        <LineupEditModal
          visible
          homeLabel={homeMeta.label}
          awayLabel={awayMeta.label}
          homeColor={homeColor}
          awayColor={awayColor}
          homeRot={state.currentSet.rotation.home}
          awayRot={state.currentSet.rotation.away}
          homeRoster={match.rosters.home}
          awayRoster={match.rosters.away}
          targetSetIndex={state.currentSetIndex}
          isStartOfSet={state.currentSet.score.home === 0 && state.currentSet.score.away === 0}
          initialSelected={editLineupSelected}
          initialFirstServer={
            (match.events.find(
              (e): e is LineupEvent => e.type === 'lineup' && e.setIndex === state.currentSetIndex && e.firstServer != null
            )?.firstServer) ?? null
          }
          effectiveFirstServer={state.currentSet.server}
          onClose={() => { setActiveAction(null); setEditLineupSelected(undefined); }}
          onSubmit={(homeLineup, awayLineup, homeLib, awayLib, homeLiberoOn, awayLiberoOn) => {
            const cs = state.currentSet!;
            const isStart = cs.score.home === 0 && cs.score.away === 0;
            const setIdx = state.currentSetIndex;
            if (isStart) {
              // Replace the lineup events for this set, then queue libero-on
              // events for any team where the user placed a libero on the
              // floor. Libero events fire AFTER the lineup events so the
              // engine first builds the rotation, then applies the libero
              // substitution on top.
              applyLineupEdit(setIdx, homeLineup, awayLineup, homeLib, awayLib);
              setTimeout(() => {
                if (homeLiberoOn) {
                  fireLiberoOn('home', homeLiberoOn.libero, homeLiberoOn.replaces);
                }
                if (awayLiberoOn) {
                  fireLiberoOn('away', awayLiberoOn.libero, awayLiberoOn.replaces);
                }
              }, 0);
            } else {
              // Mid-set: diff each side's UN-SUBBED lineup vs current
              // un-subbed rotation. The modal's `homeLineup` is the
              // original starters (the libero is overlaid via
              // `homeLiberoOn`), so the engine's positions tuple — which
              // has the libero substituted in — needs to be un-subbed
              // before diffing or every libero swap would look like
              // a regular sub. Sub events fire for true position
              // changes; libero on/off events are fired separately
              // by `applyLiberoIntentDiff`.
              function unsub(rot: RotationState): number[] {
                const positions = [...rot.positions];
                if (rot.liberoOnFloor != null && rot.liberoReplacesShirt != null) {
                  const idx = positions.indexOf(rot.liberoOnFloor);
                  if (idx >= 0) positions[idx] = rot.liberoReplacesShirt;
                }
                return positions;
              }
              applyMidSetLineupChange('home', unsub(cs.rotation.home), [...homeLineup]);
              applyMidSetLineupChange('away', unsub(cs.rotation.away), [...awayLineup]);
              const beforeHomeLib: LiberoOnIntent | null =
                cs.rotation.home.liberoOnFloor != null && cs.rotation.home.liberoReplacesShirt != null
                  ? { libero: cs.rotation.home.liberoOnFloor, replaces: cs.rotation.home.liberoReplacesShirt }
                  : null;
              const beforeAwayLib: LiberoOnIntent | null =
                cs.rotation.away.liberoOnFloor != null && cs.rotation.away.liberoReplacesShirt != null
                  ? { libero: cs.rotation.away.liberoOnFloor, replaces: cs.rotation.away.liberoReplacesShirt }
                  : null;
              setTimeout(() => {
                applyLiberoIntentDiff('home', beforeHomeLib, homeLiberoOn);
                applyLiberoIntentDiff('away', beforeAwayLib, awayLiberoOn);
              }, 0);
            }
            setEditLineupSelected(undefined);
          }}
          onFirstServerChange={(fs) => applyFirstServerOverride(state.currentSetIndex, fs)}
          colors={colors}
          styles={styles}
        />
      ) : null}

      {activeAction === 'match-info' ? (
        <MatchInfoModal
          visible
          meta={match.meta}
          onClose={() => setActiveAction(null)}
          onSubmit={(nextMeta) => {
            setMatch((m) => ({ ...m, meta: nextMeta, updatedAt: Date.now() }));
            setActiveAction(null);
          }}
          colors={colors}
          styles={styles}
        />
      ) : null}

      {activeAction === 'edit-last-point' ? (
        <EditLastPointModal
          visible
          match={match}
          state={state}
          homeLabel={homeMeta.label}
          awayLabel={awayMeta.label}
          onClose={() => setActiveAction(null)}
          onSubmit={(team, reason, shirt) => applyEditLastPoint(team, reason, shirt)}
          colors={colors}
          styles={styles}
        />
      ) : null}

      {activeAction === 'points-by-server' ? (
        <PointsByServerModal
          visible
          match={match}
          homeLabel={homeMeta.label}
          awayLabel={awayMeta.label}
          homeColor={homeColor}
          awayColor={awayColor}
          onClose={() => setActiveAction(null)}
          colors={colors}
          styles={styles}
        />
      ) : null}

      {/* Set-end confirm modal */}
      <Modal visible={!!confirmSetEndAt} transparent animationType="fade" onRequestClose={dismissSetEnd}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>End Set {setLabel}?</Text>
            {confirmSetEndAt ? (
              <Text style={styles.modalBody}>
                Final: {homeMeta.label} {confirmSetEndAt.home} – {confirmSetEndAt.away} {awayMeta.label}
                {'\n'}Duration: {formatDuration(deriveSetDurationMs(match, state.currentSetIndex))}
              </Text>
            ) : null}
            <View style={styles.modalButtonsRow}>
              <TouchableOpacity onPress={dismissSetEnd} style={[styles.modalBtn, styles.modalBtnCancel]}>
                <Text style={styles.modalBtnTextCancel}>Not yet</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmSetEnd} style={[styles.modalBtn, styles.modalBtnPrimary]}>
                <Text style={styles.modalBtnTextPrimary}>End Set</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>


      {/* (The libero-front-row confirmation modal was replaced with an
          auto-fire libero-off effect — see the useEffect above. There's
          nothing legitimate the user could decide here, and the rules
          don't allow play to continue with the libero in front court.) */}

      {/* Abandon match modal */}
      <Modal visible={abandonOpen} transparent animationType="fade" onRequestClose={() => setAbandonOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Abandon match?</Text>
            <Text style={styles.modalBody}>Records the reason and locks the match. Cannot be resumed.</Text>
            <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>Reason</Text>
            <TextInput
              style={styles.input}
              value={abandonReason}
              onChangeText={setAbandonReason}
              placeholder="Injury / weather / forfeit / …"
              placeholderTextColor={colors.textLight}
            />
            <View style={styles.modalButtonsRow}>
              <TouchableOpacity onPress={() => setAbandonOpen(false)} style={[styles.modalBtn, styles.modalBtnCancel]}>
                <Text style={styles.modalBtnTextCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={abandonMatch} style={[styles.modalBtn, styles.modalBtnPrimary]}>
                <Text style={styles.modalBtnTextPrimary}>Abandon</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Post-match save sheet — fires once when match-end is recognised
          this session. Lets the user classify the match (AES / Timu /
          Standalone), optionally link it to an indexed tournament, set
          the include-in-stats flag, and edit the match label. "Save"
          stamps the chosen meta onto the match record (Tier 2's
          auto-save useEffect persists it). "Don't save" deletes the
          match from `scored.matches.v1` entirely. */}
      <PostMatchSaveSheet
        visible={postMatchSaveOpen}
        meta={match.meta}
        homeLabel={homeMeta.label}
        awayLabel={awayMeta.label}
        onSave={applyPostMatchSave}
        onDontSave={discardMatchAndExit}
        colors={colors}
        styles={styles}
      />
    </View>
  );
}

// ─── StatBar ──────────────────────────────────────────────────────────────
// Floating bar that appears when a player cell is tapped on the court
// diagram. Shows stat action buttons (Kill, Block, Ace, Assist, Dig, Pass,
// Error). Point-scoring stats (Kill/Block/Ace) also fire a PointEvent.

function StatBar({
  team,
  shirt,
  playerName: pName,
  teamLabel,
  teamColor,
  onStat,
  onPassWithQuality,
  onSub,
  benchShirts,
  onDismiss,
  onEditLineup,
  colors,
  styles,
}: {
  team: Side;
  shirt: number;
  playerName: string;
  teamLabel: string;
  teamColor: string;
  onStat: (category: StatCategory) => void;
  onPassWithQuality: (quality: 0 | 1 | 2 | 3) => void;
  onSub: (benchShirt: number) => void;
  benchShirts: number[];
  onDismiss: () => void;
  onEditLineup: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [showPassGrades, setShowPassGrades] = useState(false);
  const [showSubBench, setShowSubBench] = useState(false);
  // Reset both sub-modes whenever the selected player changes so the
  // bar comes back as the regular stat picker on the next selection.
  useEffect(() => {
    setShowPassGrades(false);
    setShowSubBench(false);
  }, [team, shirt]);

  if (showSubBench) {
    return (
      <View style={[styles.statBarContainer, { borderColor: teamColor }]}>
        <View style={styles.statBarHeader}>
          <Text style={styles.statBarPlayerText}>
            <Text style={{ color: teamColor, fontWeight: '800' }}>#{shirt}</Text>
            {' '}{pName} · Sub for…
          </Text>
          <TouchableOpacity onPress={() => setShowSubBench(false)} activeOpacity={0.6}>
            <Text style={styles.statBarDismiss}>‹ Back</Text>
          </TouchableOpacity>
        </View>
        {benchShirts.length === 0 ? (
          <Text style={[styles.fieldHint, { paddingHorizontal: spacing.sm, paddingBottom: spacing.sm }]}>
            No bench players available.
          </Text>
        ) : (
          <View style={styles.statBarButtons}>
            {benchShirts.map((bShirt) => (
              <TouchableOpacity
                key={bShirt}
                style={[styles.statBtn, { backgroundColor: teamColor + '22', borderColor: teamColor, borderWidth: 1.5 }]}
                onPress={() => onSub(bShirt)}
                activeOpacity={0.7}
              >
                <Text style={[styles.statBtnEmoji, { color: teamColor, fontWeight: '800' }]}>#{bShirt}</Text>
                <Text style={styles.statBtnLabel}>Sub in</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  }

  if (showPassGrades) {
    return (
      <View style={[styles.statBarContainer, { borderColor: teamColor }]}>
        <View style={styles.statBarHeader}>
          <Text style={styles.statBarPlayerText}>
            <Text style={{ color: teamColor, fontWeight: '800' }}>#{shirt}</Text>
            {' '}{pName} · Pass Quality
          </Text>
          <TouchableOpacity onPress={() => setShowPassGrades(false)} activeOpacity={0.6}>
            <Text style={styles.statBarDismiss}>‹ Back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.statBarButtons}>
          <TouchableOpacity style={[styles.statBtn, { backgroundColor: '#dc2626' }]} onPress={() => onPassWithQuality(0)} activeOpacity={0.7}>
            <Text style={styles.statBtnEmoji}>0</Text>
            <Text style={styles.statBtnLabel}>Bad</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.statBtn, { backgroundColor: '#f59e0b' }]} onPress={() => onPassWithQuality(1)} activeOpacity={0.7}>
            <Text style={styles.statBtnEmoji}>1</Text>
            <Text style={styles.statBtnLabel}>OK</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.statBtn, { backgroundColor: '#3b82f6' }]} onPress={() => onPassWithQuality(2)} activeOpacity={0.7}>
            <Text style={styles.statBtnEmoji}>2</Text>
            <Text style={styles.statBtnLabel}>Good</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.statBtn, { backgroundColor: '#16a34a' }]} onPress={() => onPassWithQuality(3)} activeOpacity={0.7}>
            <Text style={styles.statBtnEmoji}>3</Text>
            <Text style={styles.statBtnLabel}>Perfect</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.statBarContainer, { borderColor: teamColor }]}>
      <View style={styles.statBarHeader}>
        <Text style={styles.statBarPlayerText}>
          <Text style={{ color: teamColor, fontWeight: '800' }}>#{shirt}</Text>
          {' '}{pName} · {teamLabel}
        </Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity onPress={onEditLineup} activeOpacity={0.6}>
            <Text style={styles.statBarEditLineup}>Edit ✎</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDismiss} activeOpacity={0.6}>
            <Text style={styles.statBarDismiss}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.statBarButtons}>
        {/* Point-scoring stats — highlighted with team color */}
        <TouchableOpacity style={[styles.statBtn, styles.statBtnPoint, { backgroundColor: teamColor }]} onPress={() => onStat('kill')} activeOpacity={0.7}>
          <Text style={styles.statBtnEmoji}>⚡</Text>
          <Text style={[styles.statBtnLabel, { color: '#fff' }]}>Kill</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.statBtn, styles.statBtnPoint, { backgroundColor: teamColor }]} onPress={() => onStat('block')} activeOpacity={0.7}>
          <Text style={styles.statBtnEmoji}>🛡</Text>
          <Text style={[styles.statBtnLabel, { color: '#fff' }]}>Block</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.statBtn, styles.statBtnPoint, { backgroundColor: teamColor }]} onPress={() => onStat('ace')} activeOpacity={0.7}>
          <Text style={styles.statBtnEmoji}>🎯</Text>
          <Text style={[styles.statBtnLabel, { color: '#fff' }]}>Ace</Text>
        </TouchableOpacity>
        {/* Non-scoring stats */}
        <TouchableOpacity style={styles.statBtn} onPress={() => onStat('assist')} activeOpacity={0.7}>
          <Text style={styles.statBtnEmoji}>🤝</Text>
          <Text style={styles.statBtnLabel}>Assist</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.statBtn} onPress={() => onStat('dig')} activeOpacity={0.7}>
          <Text style={styles.statBtnEmoji}>🏊</Text>
          <Text style={styles.statBtnLabel}>Dig</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.statBtn} onPress={() => setShowPassGrades(true)} activeOpacity={0.7}>
          <Text style={styles.statBtnEmoji}>🏐</Text>
          <Text style={styles.statBtnLabel}>Pass</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.statBtn, { backgroundColor: colors.error + '22' }]} onPress={() => onStat('error')} activeOpacity={0.7}>
          <Text style={styles.statBtnEmoji}>✕</Text>
          <Text style={styles.statBtnLabel}>Error</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.statBtn, { backgroundColor: colors.accent + '22', borderColor: colors.accent, borderWidth: 1 }]}
          onPress={() => setShowSubBench(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.statBtnEmoji}>⇄</Text>
          <Text style={styles.statBtnLabel}>Sub →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── ScorePanel ────────────────────────────────────────────────────────────

function ScorePanel(props: {
  label: string;
  color: string;
  score: number;
  isServing: boolean;
  serverShirt: number | null;
  setsWon: number;
  onTap: () => void;
  isWinner: boolean;
  disabled: boolean;
  isLandscape: boolean;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { label, color, score, isServing, serverShirt, setsWon, onTap, isWinner, disabled, styles } = props;
  const [slot, setSlot] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - slot.w) > 1 || Math.abs(height - slot.h) > 1) setSlot({ w: width, h: height });
  };
  const fontSizePx = useMemo(() => {
    if (slot.h < 24 || slot.w < 24) return 80;
    return Math.max(60, Math.floor(Math.min(slot.h * 0.9, slot.w * 0.7)));
  }, [slot]);
  return (
    <TouchableOpacity
      style={[styles.panel, isWinner && styles.panelWinner, { borderTopColor: color }]}
      onPress={onTap}
      disabled={disabled}
      activeOpacity={disabled ? 1 : 0.85}
    >
      <Text style={styles.teamName} numberOfLines={2}>{label}</Text>
      <Text style={styles.setsWon}>Sets: {setsWon}</Text>
      <View style={styles.serverPillSlot}>
        {isServing ? (
          <View style={[styles.serverPill, { backgroundColor: color }]}>
            <Text style={styles.serverPillText}>🏐 {serverShirt != null ? `#${serverShirt}` : 'serving'}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.pointsWrap} onLayout={onLayout}>
        <Text style={[styles.points, { color, fontSize: fontSizePx }]} numberOfLines={1}>{score}</Text>
      </View>
      {!disabled ? <Text style={styles.tapHint}>Tap to score</Text> : null}
      {isWinner ? <Text style={styles.winnerBadge}>WINNER</Text> : null}
    </TouchableOpacity>
  );
}

// ─── CourtRotationView — single court with net, both teams ───────────────
//
// Rotated 90° clockwise from the audience-end POV — i.e. the scorer is
// sitting on the SIDE of the court, looking across at it. The net runs
// vertically through the middle of the screen and the two halves are
// to its left and right. Jersey text stays horizontal (the layout is
// rotated, not the cells themselves).
//
// Layout left-to-right across the screen:
//
//   [home back col] [home front col] || NET || [away front col] [away back col]
//
// Within each column, rows go top → bottom matching the rotation:
//
//   Home back:   V  (top)  / VI (mid) / I  (bot)
//   Home front:  IV (top)  / III (mid)/ II (bot)
//   Away front:  II (top)  / III (mid)/ IV (bot)
//   Away back:   I  (top)  / VI (mid) / V  (bot)
//
// (Mirror of the away side because away's I-VI is numbered from their
//  own perspective facing the net, which reverses left-right relative
//  to the scorer.)

function CourtRotationView({
  homeLabel, awayLabel, homeColor, awayColor,
  homeRot, awayRot,
  server, homeServerShirt, awayServerShirt,
  selectedCell,
  onCellPress,
  colors, styles,
}: {
  homeLabel: string;
  awayLabel: string;
  homeColor: string;
  awayColor: string;
  homeRot: RotationState;
  awayRot: RotationState;
  server: Side | null;
  homeServerShirt: number | null;
  awayServerShirt: number | null;
  /** Currently selected cell for stat tagging (highlighted). */
  selectedCell?: { team: Side; posIdx: number };
  /** When provided, each position cell is a tappable button that
   *  receives the team and lineup-tuple index that was tapped. */
  onCellPress?: (team: Side, posIdx: number) => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  // Each cell carries the lineup-tuple index (0..5) so taps can be routed
  // back to the parent's onCellPress handler keyed on team + posIdx.
  const homeBackCol: Array<{ pos: string; shirt: number; idx: number }> = [
    { pos: 'V', shirt: homeRot.positions[4], idx: 4 },
    { pos: 'VI', shirt: homeRot.positions[5], idx: 5 },
    { pos: 'I', shirt: homeRot.positions[0], idx: 0 },
  ];
  const homeFrontCol: Array<{ pos: string; shirt: number; idx: number }> = [
    { pos: 'IV', shirt: homeRot.positions[3], idx: 3 },
    { pos: 'III', shirt: homeRot.positions[2], idx: 2 },
    { pos: 'II', shirt: homeRot.positions[1], idx: 1 },
  ];
  const awayFrontCol: Array<{ pos: string; shirt: number; idx: number }> = [
    { pos: 'II', shirt: awayRot.positions[1], idx: 1 },
    { pos: 'III', shirt: awayRot.positions[2], idx: 2 },
    { pos: 'IV', shirt: awayRot.positions[3], idx: 3 },
  ];
  const awayBackCol: Array<{ pos: string; shirt: number; idx: number }> = [
    { pos: 'I', shirt: awayRot.positions[0], idx: 0 },
    { pos: 'VI', shirt: awayRot.positions[5], idx: 5 },
    { pos: 'V', shirt: awayRot.positions[4], idx: 4 },
  ];

  function renderColumn(
    cells: Array<{ pos: string; shirt: number; idx: number }>,
    rot: RotationState,
    team: Side,
    teamColor: string,
    isServingTeam: boolean,
    serverShirt: number | null,
    isFrontRow: boolean
  ) {
    return (
      <View style={styles.courtCol}>
        {cells.map((c, i) => {
          // The engine's `libero-on` handler overwrites the replaced
          // player's shirt in `positions[idx]` with the libero's shirt.
          // So the cell currently displays the libero IF
          // `c.shirt === rot.liberoOnFloor`, NOT if c.shirt equals the
          // replaced shirt (which is no longer in the tuple). The old
          // check missed the highlight whenever the libero was on.
          const isLib = rot.liberoOnFloor != null && c.shirt === rot.liberoOnFloor;
          const display = c.shirt;
          const isServerCell = isServingTeam && serverShirt === display;
          const isStatSelected = selectedCell != null && selectedCell.team === team && selectedCell.posIdx === c.idx;
          const cellStyle = [
            styles.courtCell,
            isFrontRow && styles.courtCellFront,
            // Libero highlight is intentionally LAST so it wins over the
            // front-row tint — though we never expect the libero to be
            // in a front-row cell (the auto-pop modal forces them off
            // before the next rally).
            isServerCell && { borderColor: teamColor, borderWidth: 2 },
            isLib && { backgroundColor: colors.accent + '66', borderColor: colors.accent, borderWidth: 2 },
            // Stat selection highlight — bright yellow ring so the user
            // sees which player they're about to tag.
            isStatSelected && { backgroundColor: '#fef08a', borderColor: '#ca8a04', borderWidth: 2.5 },
          ];
          const inner = (
            <>
              <Text style={styles.courtCellPos}>{c.pos}</Text>
              <Text style={styles.courtCellNum}>#{display}</Text>
              <View style={styles.courtCellMarkers}>
                {isLib ? <Text style={styles.courtCellLib}>L</Text> : null}
                {isServerCell ? <Text style={styles.courtCellServ}>🏐</Text> : null}
              </View>
            </>
          );
          if (onCellPress) {
            return (
              <TouchableOpacity key={i} style={cellStyle} onPress={() => onCellPress(team, c.idx)} activeOpacity={0.7}>
                {inner}
              </TouchableOpacity>
            );
          }
          return (
            <View key={i} style={cellStyle}>
              {inner}
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <View style={styles.courtContainer}>
      {/* Header strip — home label on the left, away label on the right
          to match each team's side of the rotated court. */}
      <View style={styles.courtHeaderRow}>
        <View style={styles.courtTeamHeader}>
          <View style={[styles.courtColorDot, { backgroundColor: homeColor }]} />
          <Text style={styles.courtTeamHeaderText} numberOfLines={1}>{homeLabel}</Text>
        </View>
        <View style={styles.courtTeamHeaderRight}>
          <Text style={styles.courtTeamHeaderText} numberOfLines={1}>{awayLabel}</Text>
          <View style={[styles.courtColorDot, { backgroundColor: awayColor }]} />
        </View>
      </View>

      {/* Court canvas: 5 columns side-by-side. Net is the middle one. */}
      <View style={styles.courtCanvas}>
        {renderColumn(homeBackCol, homeRot, 'home', homeColor, server === 'home', homeServerShirt, false)}
        {renderColumn(homeFrontCol, homeRot, 'home', homeColor, server === 'home', homeServerShirt, true)}
        <View style={styles.netVertical}>
          <Text style={styles.netVerticalText}>N{'\n'}E{'\n'}T</Text>
        </View>
        {renderColumn(awayFrontCol, awayRot, 'away', awayColor, server === 'away', awayServerShirt, true)}
        {renderColumn(awayBackCol, awayRot, 'away', awayColor, server === 'away', awayServerShirt, false)}
      </View>
    </View>
  );
}

// ─── ShelfBtn ──────────────────────────────────────────────────────────────

function ShelfBtn({
  label,
  onPress,
  disabled,
  colors,
  styles,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity
      style={[styles.shelfBtn, disabled && { opacity: 0.4 }]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <Text style={styles.shelfBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function ActionTile({ label, emoji, onPress, disabled, styles }: { label: string; emoji: string; onPress: () => void; disabled?: boolean; styles: ReturnType<typeof makeStyles> }) {
  return (
    <TouchableOpacity
      style={[styles.actionTile, disabled && { opacity: 0.4 }]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <Text style={styles.actionEmoji}>{emoji}</Text>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Action modals ─────────────────────────────────────────────────────────

function TeamPicker({ value, onChange, homeLabel, awayLabel, styles }: { value: Side; onChange: (s: Side) => void; homeLabel: string; awayLabel: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.pillRow}>
      <TouchableOpacity style={[styles.pill, value === 'home' && styles.pillActive]} onPress={() => onChange('home')} activeOpacity={0.7}>
        <Text style={[styles.pillText, value === 'home' && styles.pillTextActive]} numberOfLines={1}>{homeLabel}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.pill, value === 'away' && styles.pillActive]} onPress={() => onChange('away')} activeOpacity={0.7}>
        <Text style={[styles.pillText, value === 'away' && styles.pillTextActive]} numberOfLines={1}>{awayLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── LineupEditModal ──────────────────────────────────────────────────────
//
// Lets the user fix a starting rotation (set start, score 0–0) or change
// the starting six between sets. Tap-to-select + tap-second-cell-to-swap
// for quick reordering, OR tap a cell then tap a roster chip to bring a
// bench player in. Saving fires a fresh lineup event for the target set
// — between-sets edits don't add to the in-set sub cap because sub
// counters are derived per-set from `sub` events.

/** Lightweight intent state for "the libero is on the floor in this team's
 *  rotation, replacing this back-row regular". The lineup tuple itself
 *  always holds the original 6 starters — the libero substitution is a
 *  separate event in the engine, so we model it the same way here. */
interface LiberoOnIntent { libero: number; replaces: number; }

function LineupEditModal({
  visible, homeLabel, awayLabel, homeColor, awayColor,
  homeRot, awayRot, homeRoster, awayRoster,
  targetSetIndex, isStartOfSet,
  initialSelected,
  initialFirstServer,
  effectiveFirstServer,
  onClose, onSubmit, onFirstServerChange,
  colors, styles,
}: {
  visible: boolean;
  homeLabel: string;
  awayLabel: string;
  homeColor: string;
  awayColor: string;
  homeRot: RotationState;
  awayRot: RotationState;
  homeRoster: RosterPlayer[];
  awayRoster: RosterPlayer[];
  targetSetIndex: number;
  isStartOfSet: boolean;
  /** Pre-select a cell so the user can immediately tap a swap target. */
  initialSelected?: { team: Side; posIdx: number };
  /** Current explicit override (or null = alternation rule). */
  initialFirstServer: Side | null;
  /** What the engine currently thinks the first server is. */
  effectiveFirstServer: Side | null;
  onClose: () => void;
  /** Called on Save. Includes the libero-on intent for each side so the
   *  parent can fire libero-on / libero-off events as appropriate. */
  onSubmit: (
    homeLineup: Lineup,
    awayLineup: Lineup,
    homeLiberos: number[],
    awayLiberos: number[],
    homeLiberoOn: LiberoOnIntent | null,
    awayLiberoOn: LiberoOnIntent | null
  ) => void;
  onFirstServerChange: (firstServer: Side | null) => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const FRONT_IDXS = useMemo(() => new Set([1, 2, 3]), []);
  const initialLiberoOn = (rot: RotationState): LiberoOnIntent | null =>
    rot.liberoOnFloor != null && rot.liberoReplacesShirt != null
      ? { libero: rot.liberoOnFloor, replaces: rot.liberoReplacesShirt }
      : null;
  /**
   * The engine stores a substituted libero by overwriting the replaced
   * player's shirt in `rot.positions`. We want the modal's tuple to hold
   * the ORIGINAL six players and overlay the libero separately, so the
   * "tap a back-row cell + tap a libero chip" interaction feels natural
   * and the libero never appears as both a regular and an overlay. So
   * when initialising, we un-substitute the libero from the tuple by
   * putting the replaced shirt back at the libero's idx. Without this,
   * the tuple has the libero at one idx and the overlay can't find a
   * cell whose `replaces` matches — so the libero appears in two
   * apparent places (the tuple position via raw `lu[i]` and a phantom
   * overlay slot).
   */
  function unsubLiberoForEditor(rot: RotationState): number[] {
    const positions = [...rot.positions];
    if (rot.liberoOnFloor != null && rot.liberoReplacesShirt != null) {
      const liberoIdx = positions.indexOf(rot.liberoOnFloor);
      if (liberoIdx >= 0) positions[liberoIdx] = rot.liberoReplacesShirt;
    }
    return positions;
  }
  const [homeLineup, setHomeLineup] = useState<number[]>(unsubLiberoForEditor(homeRot));
  const [awayLineup, setAwayLineup] = useState<number[]>(unsubLiberoForEditor(awayRot));
  const [homeLib, setHomeLib] = useState<number[]>([...homeRot.liberos]);
  const [awayLib, setAwayLib] = useState<number[]>([...awayRot.liberos]);
  const [homeLiberoOn, setHomeLiberoOn] = useState<LiberoOnIntent | null>(initialLiberoOn(homeRot));
  const [awayLiberoOn, setAwayLiberoOn] = useState<LiberoOnIntent | null>(initialLiberoOn(awayRot));
  const [selected, setSelected] = useState<{ team: Side; posIdx: number } | null>(initialSelected ?? null);
  const [firstServer, setFirstServer] = useState<Side | null>(initialFirstServer);

  function lineupFor(team: Side) { return team === 'home' ? homeLineup : awayLineup; }
  function setLineupFor(team: Side, next: number[]) {
    if (team === 'home') setHomeLineup(next); else setAwayLineup(next);
  }
  function libFor(team: Side) { return team === 'home' ? homeLib : awayLib; }
  function setLibFor(team: Side, next: number[]) {
    if (team === 'home') setHomeLib(next); else setAwayLib(next);
  }
  function liberoOnFor(team: Side) { return team === 'home' ? homeLiberoOn : awayLiberoOn; }
  function setLiberoOnFor(team: Side, val: LiberoOnIntent | null) {
    if (team === 'home') setHomeLiberoOn(val); else setAwayLiberoOn(val);
  }
  function rosterFor(team: Side) { return team === 'home' ? homeRoster : awayRoster; }

  /** True when the cell at (team, posIdx) is currently displaying a libero
   *  (i.e., the regular at that position has been replaced by the libero). */
  function cellHasLibero(team: Side, posIdx: number): boolean {
    const liberoOn = liberoOnFor(team);
    if (!liberoOn) return false;
    return lineupFor(team)[posIdx] === liberoOn.replaces;
  }

  function tapCell(team: Side, posIdx: number) {
    // If the cell currently displays a libero, tapping it removes the libero
    // (the regular comes back on). This is the equivalent of a libero-off.
    if (cellHasLibero(team, posIdx)) {
      setLiberoOnFor(team, null);
      setSelected(null);
      return;
    }

    if (!selected) {
      setSelected({ team, posIdx });
      return;
    }
    if (selected.team === team && selected.posIdx === posIdx) {
      setSelected(null);
      return;
    }
    if (selected.team !== team) {
      setSelected({ team, posIdx });
      return;
    }
    // Within-team swap. Mid-set this is illegal (FIVB §15.6 only permits
    // bench substitutions during a set), so we refuse upfront with a
    // clear message rather than letting the save-time diff fire the
    // generic "position swap not allowed" alert.
    if (!isStartOfSet) {
      Alert.alert(
        'On-floor swap not allowed mid-set',
        'Players already on the floor can\'t exchange positions during a set. To bring a different player in, tap a bench shirt below to substitute.'
      );
      setSelected(null);
      return;
    }
    const lu = [...lineupFor(team)];
    const tmp = lu[selected.posIdx];
    lu[selected.posIdx] = lu[posIdx];
    lu[posIdx] = tmp;
    setLineupFor(team, lu);
    setSelected(null);
  }

  function tapRosterChip(team: Side, shirt: number) {
    if (!selected || selected.team !== team) return;
    const roster = rosterFor(team);
    const isLiberoShirt = roster.find((p) => p.shirt === shirt)?.isLibero === true;
    if (isLiberoShirt) {
      Alert.alert('Use the libero chips below', 'Designated liberos go on the floor via the L-marked libero chips, not the regular roster chips.');
      return;
    }
    const lu = [...lineupFor(team)];
    const existingIdx = lu.indexOf(shirt);
    if (existingIdx >= 0) {
      const tmp = lu[selected.posIdx];
      lu[selected.posIdx] = shirt;
      lu[existingIdx] = tmp;
    } else {
      lu[selected.posIdx] = shirt;
    }
    setLineupFor(team, lu);
    setSelected(null);
  }

  /** Tap on a libero chip. With NO selected cell: toggles whether the libero
   *  is designated for this set (max 2). With a back-row cell selected: puts
   *  the libero ON the floor in that position, replacing the original
   *  player. Front-row selections are refused. */
  function tapLiberoChip(team: Side, shirt: number) {
    const lib = libFor(team);
    if (!selected || selected.team !== team) {
      // Toggle designation only.
      if (lib.includes(shirt)) {
        // Removing a designated libero — also pull them off the floor if on.
        const liberoOn = liberoOnFor(team);
        if (liberoOn && liberoOn.libero === shirt) setLiberoOnFor(team, null);
        setLibFor(team, lib.filter((s) => s !== shirt));
      } else if (lib.length < 2) {
        setLibFor(team, [...lib, shirt]);
      }
      return;
    }
    // Has selection: place libero on this position (back row only).
    if (FRONT_IDXS.has(selected.posIdx)) {
      Alert.alert('Liberos must be in the back row', 'Select a back-row position (I, V, or VI) before tapping a libero chip.');
      return;
    }
    // Auto-designate the libero if not already.
    if (!lib.includes(shirt)) {
      const next = lib.length < 2 ? [...lib, shirt] : [shirt];
      setLibFor(team, next);
    }
    const lu = lineupFor(team);
    const replacedShirt = lu[selected.posIdx];
    setLiberoOnFor(team, { libero: shirt, replaces: replacedShirt });
    setSelected(null);
  }

  function renderTeam(team: Side) {
    const lu = lineupFor(team);
    const roster = rosterFor(team);
    const lib = team === 'home' ? homeLib : awayLib;
    const color = team === 'home' ? homeColor : awayColor;
    const label = team === 'home' ? homeLabel : awayLabel;
    // Visual mirrors the rotated scorer-side court: each team is a pair
    // of vertical columns (back outside, front inside near the net).
    // Home: back col on the left, front col against the net (right).
    // Away: front col against the net (left), back col on the outside (right).
    const isHome = team === 'home';
    const back: Array<{ pos: string; idx: number }> = isHome
      ? [{ pos: 'V', idx: 4 }, { pos: 'VI', idx: 5 }, { pos: 'I', idx: 0 }]
      : [{ pos: 'I', idx: 0 }, { pos: 'VI', idx: 5 }, { pos: 'V', idx: 4 }];
    const front: Array<{ pos: string; idx: number }> = isHome
      ? [{ pos: 'IV', idx: 3 }, { pos: 'III', idx: 2 }, { pos: 'II', idx: 1 }]
      : [{ pos: 'II', idx: 1 }, { pos: 'III', idx: 2 }, { pos: 'IV', idx: 3 }];
    const cols = isHome ? [back, front] : [front, back];
    return (
      <View style={styles.lineupTeamBlock}>
        <View style={styles.courtTeamHeader}>
          <View style={[styles.courtColorDot, { backgroundColor: color }]} />
          <Text style={styles.courtTeamHeaderText} numberOfLines={1}>{label}{isHome ? '  (left half)' : '  (right half)'}</Text>
        </View>
        <View style={styles.courtCanvas}>
          {/* For away, render the NET first (it's on the user's left because
              the away half mirrors the main court layout). */}
          {!isHome ? (
            <View style={styles.netVertical}>
              <Text style={styles.netVerticalText}>N{'\n'}E{'\n'}T</Text>
            </View>
          ) : null}
          {cols.map((col, ci) => {
            const isFront = (isHome && ci === 1) || (!isHome && ci === 0);
            const liberoOn = liberoOnFor(team);
            return (
              <View key={ci} style={styles.courtCol}>
                {col.map((c) => {
                  const isSel = selected?.team === team && selected.posIdx === c.idx;
                  // The cell normally shows the original player at this
                  // position. If a libero has substituted in for that
                  // player, show the libero's shirt with libero highlight
                  // instead — same convention as the main scoring view.
                  const baseShirt = lu[c.idx];
                  const isLiberoCell = liberoOn != null && liberoOn.replaces === baseShirt && !isFront;
                  const displayShirt = isLiberoCell ? liberoOn!.libero : baseShirt;
                  return (
                    <TouchableOpacity
                      key={c.idx}
                      style={[
                        styles.courtCell,
                        isFront && styles.courtCellFront,
                        isLiberoCell && { backgroundColor: colors.accent + '66', borderColor: colors.accent, borderWidth: 2 },
                        isSel && { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primaryLight },
                      ]}
                      onPress={() => tapCell(team, c.idx)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.courtCellPos}>{c.pos}</Text>
                      <Text style={styles.courtCellNum}>#{displayShirt}</Text>
                      {isLiberoCell ? <Text style={styles.courtCellLib}>L</Text> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          })}
          {/* For home, render the NET last so it sits to the right of the
              front column — mirroring the main court layout where home's
              net is on the right side. */}
          {isHome ? (
            <View style={styles.netVertical}>
              <Text style={styles.netVerticalText}>N{'\n'}E{'\n'}T</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.fieldHint, { marginTop: spacing.xs }]}>
          {selected?.team === team
            ? `Tap another cell to swap${isStartOfSet ? '' : ' (start of set only)'}, a roster chip below to assign, or a libero chip to bring the libero on for this player.`
            : 'Tap a position to select. Tap a libero-occupied cell to take the libero off.'}
        </Text>
        <View style={styles.shirtChipRow}>
          {roster.filter((p) => p.active && !p.isLibero).map((p) => {
            const onFloor = lu.includes(p.shirt);
            return (
              <TouchableOpacity
                key={p.shirt}
                style={[styles.shirtChip, onFloor && styles.shirtChipActive]}
                onPress={() => tapRosterChip(team, p.shirt)}
                activeOpacity={0.7}
              >
                <Text style={[styles.shirtChipText, onFloor && styles.shirtChipTextActive]}>#{p.shirt}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={[styles.fieldHint, { marginTop: spacing.xs }]}>
          Liberos (max 2 designated). Tap to add/remove from the designated list. With a back-row cell selected, tap a libero chip to put them on the floor for that player.
        </Text>
        <View style={styles.shirtChipRow}>
          {roster.filter((p) => p.active && p.isLibero).map((p) => {
            const isLib = lib.includes(p.shirt);
            const onFloor = liberoOnFor(team)?.libero === p.shirt;
            return (
              <TouchableOpacity
                key={p.shirt}
                style={[styles.liberoChip, isLib && styles.liberoChipActive, onFloor && { borderWidth: 2, borderColor: colors.success }]}
                onPress={() => tapLiberoChip(team, p.shirt)}
                activeOpacity={0.7}
              >
                <Text style={[styles.liberoChipText, isLib && styles.liberoChipTextActive]}>
                  L #{p.shirt}{onFloor ? ' · on' : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
          {roster.filter((p) => p.active && p.isLibero).length === 0 ? (
            <Text style={styles.fieldHint}>No liberos in roster.</Text>
          ) : null}
        </View>
      </View>
    );
  }

  // Validate: each team must have 6 unique positive shirts.
  const homeOk = homeLineup.length === 6 && new Set(homeLineup).size === 6 && homeLineup.every((n) => isFinite(n) && n > 0);
  const awayOk = awayLineup.length === 6 && new Set(awayLineup).size === 6 && awayLineup.every((n) => isFinite(n) && n > 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdropWide}>
        <View style={styles.courtModalCardWide}>
          <Text style={styles.modalTitle}>
            {isStartOfSet ? `Edit starting lineup · Set ${targetSetIndex + 1}` : `Edit lineup · Set ${targetSetIndex + 1}`}
          </Text>
          <Text style={styles.fieldHint}>
            Tap a position to select, then tap another position to swap, or tap a roster chip to bring a bench player in. Liberos are highlighted; tap one with a back-row position selected to swap them onto the floor. Between-set lineup changes don't count as substitutions.
          </Text>

          {/* First-server picker (mostly relevant at start of set) */}
          {isStartOfSet ? (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={styles.fieldHint}>First serve this set:</Text>
              <View style={styles.pillRow}>
                <TouchableOpacity
                  style={[styles.pill, firstServer === 'home' && styles.pillActive, firstServer == null && effectiveFirstServer === 'home' && { borderColor: colors.primary }]}
                  onPress={() => { setFirstServer('home'); onFirstServerChange('home'); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.pillText, firstServer === 'home' && styles.pillTextActive]}>{homeLabel}{firstServer == null && effectiveFirstServer === 'home' ? ' (auto)' : ''}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.pill, firstServer === 'away' && styles.pillActive, firstServer == null && effectiveFirstServer === 'away' && { borderColor: colors.primary }]}
                  onPress={() => { setFirstServer('away'); onFirstServerChange('away'); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.pillText, firstServer === 'away' && styles.pillTextActive]}>{awayLabel}{firstServer == null && effectiveFirstServer === 'away' ? ' (auto)' : ''}</Text>
                </TouchableOpacity>
                {firstServer != null ? (
                  <TouchableOpacity style={styles.pill} onPress={() => { setFirstServer(null); onFirstServerChange(null); }} activeOpacity={0.7}>
                    <Text style={styles.pillText}>Clear (use alternation)</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ) : null}

          <ScrollView style={{ maxHeight: 460, marginTop: spacing.sm }}>
            {renderTeam('home')}
            <View style={{ height: spacing.sm }} />
            {renderTeam('away')}
          </ScrollView>
          {!homeOk || !awayOk ? (
            <View style={styles.warnBlock}>
              <Text style={styles.warnText}>⚠ Each team needs 6 unique positive shirt numbers in the rotation.</Text>
            </View>
          ) : null}
          <View style={styles.modalButtonsRow}>
            <TouchableOpacity onPress={onClose} style={[styles.modalBtn, styles.modalBtnCancel]}>
              <Text style={styles.modalBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => homeOk && awayOk && onSubmit(homeLineup as Lineup, awayLineup as Lineup, homeLib, awayLib, homeLiberoOn, awayLiberoOn)}
              style={[styles.modalBtn, styles.modalBtnPrimary, (!homeOk || !awayOk) && { opacity: 0.4 }]}
              disabled={!homeOk || !awayOk}
            >
              <Text style={styles.modalBtnTextPrimary}>Save lineup</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── MatchInfoModal ──────────────────────────────────────────────────────
//
// Edit team labels, event/division/match labels, court name, and officials
// (referee, scorer, asst scorer). All fields are optional and write back
// to `match.meta` in place. Doesn't mutate the rosters or events; cosmetic
// metadata only.

function MatchInfoModal({
  visible, meta, onClose, onSubmit, colors, styles,
}: {
  visible: boolean;
  meta: import('../types/match').MatchMeta;
  onClose: () => void;
  onSubmit: (next: import('../types/match').MatchMeta) => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [eventName, setEventName] = useState(meta.eventName);
  const [division, setDivision] = useState(meta.division);
  const [matchLabel, setMatchLabel] = useState(meta.matchLabel);
  const [courtName, setCourtName] = useState(meta.courtName);
  const [homeLabel, setHomeLabel] = useState(meta.home.label);
  const [awayLabel, setAwayLabel] = useState(meta.away.label);
  const [refFirst, setRefFirst] = useState(meta.officials.first ?? '');
  const [refSecond, setRefSecond] = useState(meta.officials.second ?? '');
  const [scorer, setScorer] = useState(meta.officials.scorerName ?? '');
  const [asstScorer, setAsstScorer] = useState(meta.officials.assistantScorerName ?? '');
  const [homeCoach, setHomeCoach] = useState(meta.home.coachName ?? '');
  const [homeAsstCoach, setHomeAsstCoach] = useState(meta.home.assistantCoachName ?? '');
  const [awayCoach, setAwayCoach] = useState(meta.away.coachName ?? '');
  const [awayAsstCoach, setAwayAsstCoach] = useState(meta.away.assistantCoachName ?? '');

  function save() {
    onSubmit({
      ...meta,
      eventName: eventName.trim() || meta.eventName,
      division: division.trim(),
      matchLabel: matchLabel.trim(),
      courtName: courtName.trim(),
      home: {
        ...meta.home,
        label: homeLabel.trim() || meta.home.label,
        coachName: homeCoach.trim() || undefined,
        assistantCoachName: homeAsstCoach.trim() || undefined,
      },
      away: {
        ...meta.away,
        label: awayLabel.trim() || meta.away.label,
        coachName: awayCoach.trim() || undefined,
        assistantCoachName: awayAsstCoach.trim() || undefined,
      },
      officials: {
        ...meta.officials,
        first: refFirst.trim() || undefined,
        second: refSecond.trim() || undefined,
        scorerName: scorer.trim() || undefined,
        assistantScorerName: asstScorer.trim() || undefined,
      },
    });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdropWide}>
        <View style={styles.courtModalCardWide}>
          <Text style={styles.modalTitle}>Match info</Text>
          <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldHint}>Event:</Text>
            <TextInput style={styles.input} value={eventName} onChangeText={setEventName} placeholderTextColor={colors.textLight} />
            <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>Division:</Text>
            <TextInput style={styles.input} value={division} onChangeText={setDivision} placeholderTextColor={colors.textLight} />
            <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>Match label:</Text>
            <TextInput style={styles.input} value={matchLabel} onChangeText={setMatchLabel} placeholder="Pool A · Match 3" placeholderTextColor={colors.textLight} />
            <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>Court:</Text>
            <TextInput style={styles.input} value={courtName} onChangeText={setCourtName} placeholderTextColor={colors.textLight} />

            <Text style={[styles.fieldHint, { marginTop: spacing.md }]}>Home team:</Text>
            <TextInput style={styles.input} value={homeLabel} onChangeText={setHomeLabel} placeholderTextColor={colors.textLight} />
            <Text style={[styles.fieldHint, { marginTop: spacing.xs }]}>Home coach:</Text>
            <TextInput style={styles.input} value={homeCoach} onChangeText={setHomeCoach} placeholder="Coach name" placeholderTextColor={colors.textLight} />
            <Text style={[styles.fieldHint, { marginTop: spacing.xs }]}>Home assistant coach:</Text>
            <TextInput style={styles.input} value={homeAsstCoach} onChangeText={setHomeAsstCoach} placeholder="Assistant coach name" placeholderTextColor={colors.textLight} />

            <Text style={[styles.fieldHint, { marginTop: spacing.md }]}>Away team:</Text>
            <TextInput style={styles.input} value={awayLabel} onChangeText={setAwayLabel} placeholderTextColor={colors.textLight} />
            <Text style={[styles.fieldHint, { marginTop: spacing.xs }]}>Away coach:</Text>
            <TextInput style={styles.input} value={awayCoach} onChangeText={setAwayCoach} placeholder="Coach name" placeholderTextColor={colors.textLight} />
            <Text style={[styles.fieldHint, { marginTop: spacing.xs }]}>Away assistant coach:</Text>
            <TextInput style={styles.input} value={awayAsstCoach} onChangeText={setAwayAsstCoach} placeholder="Assistant coach name" placeholderTextColor={colors.textLight} />

            <Text style={[styles.fieldHint, { marginTop: spacing.md }]}>1st referee:</Text>
            <TextInput style={styles.input} value={refFirst} onChangeText={setRefFirst} placeholder="Referee name" placeholderTextColor={colors.textLight} />
            <Text style={[styles.fieldHint, { marginTop: spacing.xs }]}>2nd referee:</Text>
            <TextInput style={styles.input} value={refSecond} onChangeText={setRefSecond} placeholder="Referee name" placeholderTextColor={colors.textLight} />
            <Text style={[styles.fieldHint, { marginTop: spacing.xs }]}>Scorer:</Text>
            <TextInput style={styles.input} value={scorer} onChangeText={setScorer} placeholder="Scorer name" placeholderTextColor={colors.textLight} />
            <Text style={[styles.fieldHint, { marginTop: spacing.xs }]}>Assistant scorer:</Text>
            <TextInput style={styles.input} value={asstScorer} onChangeText={setAsstScorer} placeholder="Assistant scorer name" placeholderTextColor={colors.textLight} />
          </ScrollView>
          <View style={styles.modalButtonsRow}>
            <TouchableOpacity onPress={onClose} style={[styles.modalBtn, styles.modalBtnCancel]}>
              <Text style={styles.modalBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={save} style={[styles.modalBtn, styles.modalBtnPrimary]}>
              <Text style={styles.modalBtnTextPrimary}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── EditLastPointModal ──────────────────────────────────────────────────
//
// Lets the user fix a misclicked point: change which team scored, attribute
// the point to a player from the on-floor lineup, and tag a reason.

function EditLastPointModal({
  visible, match, state, homeLabel, awayLabel, onClose, onSubmit, colors, styles,
}: {
  visible: boolean;
  match: Match;
  state: ReturnType<typeof deriveMatchState>;
  homeLabel: string;
  awayLabel: string;
  onClose: () => void;
  onSubmit: (team: Side, reason: PointEvent['reason'], shirt: number | undefined) => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const lastPoint = [...match.events].reverse().find((e): e is PointEvent => e.type === 'point');
  const [team, setTeam] = useState<Side>(lastPoint?.scoringTeam ?? 'home');
  const [reason, setReason] = useState<PointEvent['reason']>(lastPoint?.reason ?? null);
  const [shirt, setShirt] = useState<number | undefined>(lastPoint?.shirt);

  useEffect(() => {
    if (!lastPoint) return;
    setTeam(lastPoint.scoringTeam);
    setReason(lastPoint.reason ?? null);
    setShirt(lastPoint.shirt);
  }, [lastPoint?.id]);

  if (!lastPoint) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit last point</Text>
            <Text style={styles.modalBody}>No points to edit yet.</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  // Player picker — shows the floor of the chosen team. Use the rotation
  // state at the time of the point (approximation: current rotation).
  const onFloor = state.currentSet?.rotation[team].positions ?? [];

  const reasons: Array<PointEvent['reason']> = [null, 'kill', 'ace', 'block', 'opp-error', 'unforced'];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Edit last point</Text>
          <Text style={styles.fieldHint}>Set {lastPoint.setIndex + 1} · originally credited to {lastPoint.scoringTeam === 'home' ? homeLabel : awayLabel}</Text>
          <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>Scoring team:</Text>
          <View style={styles.pillRow}>
            <TouchableOpacity style={[styles.pill, team === 'home' && styles.pillActive]} onPress={() => { setTeam('home'); setShirt(undefined); }} activeOpacity={0.7}>
              <Text style={[styles.pillText, team === 'home' && styles.pillTextActive]}>{homeLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.pill, team === 'away' && styles.pillActive]} onPress={() => { setTeam('away'); setShirt(undefined); }} activeOpacity={0.7}>
              <Text style={[styles.pillText, team === 'away' && styles.pillTextActive]}>{awayLabel}</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>Player (optional):</Text>
          <View style={styles.shirtChipRow}>
            <TouchableOpacity style={[styles.shirtChip, shirt == null && styles.shirtChipActive]} onPress={() => setShirt(undefined)} activeOpacity={0.7}>
              <Text style={[styles.shirtChipText, shirt == null && styles.shirtChipTextActive]}>—</Text>
            </TouchableOpacity>
            {onFloor.map((s, i) => (
              <TouchableOpacity key={i} style={[styles.shirtChip, shirt === s && styles.shirtChipActive]} onPress={() => setShirt(s)} activeOpacity={0.7}>
                <Text style={[styles.shirtChipText, shirt === s && styles.shirtChipTextActive]}>#{s}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>Reason (optional):</Text>
          <View style={styles.pillRow}>
            {reasons.map((r) => (
              <TouchableOpacity key={String(r)} style={[styles.pill, reason === r && styles.pillActive]} onPress={() => setReason(r)} activeOpacity={0.7}>
                <Text style={[styles.pillText, reason === r && styles.pillTextActive]}>{r ?? 'none'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.modalButtonsRow}>
            <TouchableOpacity onPress={onClose} style={[styles.modalBtn, styles.modalBtnCancel]}>
              <Text style={styles.modalBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onSubmit(team, reason, shirt)} style={[styles.modalBtn, styles.modalBtnPrimary]}>
              <Text style={styles.modalBtnTextPrimary}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SubModal({
  visible, team, setActionTeam, rot, roster, score, homeLabel, awayLabel, subRule, onClose, onSubmit, colors, styles,
}: {
  visible: boolean;
  team: Side;
  setActionTeam: (s: Side) => void;
  rot: RotationState;
  roster: RosterPlayer[];
  score: { home: number; away: number };
  homeLabel: string;
  awayLabel: string;
  subRule: 'fivb' | 'vc';
  onClose: () => void;
  onSubmit: (out: number, inn: number) => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [outShirt, setOutShirt] = useState<number | null>(null);
  const [inShirt, setInShirt] = useState<number | null>(null);
  // Reset when team changes
  useEffect(() => { setOutShirt(null); setInShirt(null); }, [team]);

  const onFloor = rot.positions; // 6 shirts currently on the floor
  const benchEligible = roster
    .filter((p) => p.active && !p.isLibero && !onFloor.includes(p.shirt))
    .map((p) => p.shirt);
  const subsLabel = subRule === 'vc' ? `${rot.subsUsed}/12` : `${rot.subPairs.length}/6 pairs`;

  // If the user picks an "out" shirt that has previously been subbed
  // (i.e., is part of an existing sub pair), we want to *suggest* their
  // partner as the "in" shirt — that's the only legal re-entry per FIVB.
  const suggestedIn = useMemo(() => {
    if (outShirt == null) return null;
    const p = rot.subPairs.find((pp) => pp.starter === outShirt || pp.replacement === outShirt);
    if (!p) return null;
    return p.starter === outShirt ? p.replacement : p.starter;
  }, [outShirt, rot.subPairs]);
  // If outShirt is a known starter coming off a second time, OR a
  // replacement going back off, the corresponding partner should be
  // the only legal "in" pick. Visualize that.
  const lockedInPartner = suggestedIn != null && benchEligible.includes(suggestedIn) ? suggestedIn : null;

  // Best-effort warning when picks would violate the engine's re-entry
  // rules. Mirrors `canApplySub` logic so the user sees the guidance
  // before tapping Confirm.
  const warnings: string[] = [];
  if (outShirt != null && inShirt != null) {
    if (subRule === 'vc' && rot.subsUsed >= 12) warnings.push(`12-sub V-C cap reached.`);
    if (subRule === 'fivb') {
      const inExistingPair = rot.subPairs.some(
        (p) => (p.starter === outShirt && p.replacement === inShirt) || (p.starter === inShirt && p.replacement === outShirt)
      );
      if (!inExistingPair && rot.subPairs.length >= 6) warnings.push(`6-pair FIVB cap reached.`);
    }
    const asRepl = rot.subPairs.find((p) => p.replacement === outShirt);
    if (asRepl && asRepl.starter !== inShirt) warnings.push(`#${outShirt} can only re-exit for their original starter (#${asRepl.starter}).`);
    const otherStarter = rot.subPairs.find((p) => p.starter === inShirt);
    if (otherStarter && otherStarter.replacement !== outShirt) warnings.push(`Starter #${inShirt} can only re-enter for their replacement (#${otherStarter.replacement}).`);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Substitution</Text>
          <TeamPicker value={team} onChange={setActionTeam} homeLabel={homeLabel} awayLabel={awayLabel} styles={styles} />
          <Text style={styles.fieldHint}>
            Score at sub: {homeLabel} {score.home} – {score.away} {awayLabel}
            {'\n'}Subs used: {subsLabel}{rot.lockedOut.length ? ` · locked out: ${rot.lockedOut.map((s) => '#' + s).join(', ')}` : ''}
          </Text>

          {rot.subPairs.length > 0 ? (
            <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>
              Existing pairs: {rot.subPairs.map((p) => `#${p.starter}↔#${p.replacement}`).join('  ·  ')}
            </Text>
          ) : null}

          <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>Off the floor (out):</Text>
          <View style={styles.shirtChipRow}>
            {onFloor.map((s, i) => (
              <TouchableOpacity key={i} style={[styles.shirtChip, outShirt === s && styles.shirtChipActive]} onPress={() => setOutShirt(s)} activeOpacity={0.7}>
                <Text style={[styles.shirtChipText, outShirt === s && styles.shirtChipTextActive]}>#{s}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>
            Onto the floor (in){lockedInPartner != null ? ` · #${lockedInPartner} is the legal partner from earlier this set` : ''}:
          </Text>
          {benchEligible.length === 0 ? (
            <Text style={styles.fieldHint}>No bench players available.</Text>
          ) : (
            <View style={styles.shirtChipRow}>
              {benchEligible.map((s, i) => (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.shirtChip,
                    inShirt === s && styles.shirtChipActive,
                    lockedInPartner === s && { borderColor: colors.success, borderWidth: 2 },
                  ]}
                  onPress={() => setInShirt(s)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.shirtChipText, inShirt === s && styles.shirtChipTextActive]}>#{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {warnings.length > 0 ? (
            <View style={styles.warnBlock}>
              {warnings.map((w, i) => (
                <Text key={i} style={styles.warnText}>⚠ {w}</Text>
              ))}
            </View>
          ) : null}

          <View style={styles.modalButtonsRow}>
            <TouchableOpacity onPress={onClose} style={[styles.modalBtn, styles.modalBtnCancel]}>
              <Text style={styles.modalBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => outShirt != null && inShirt != null && onSubmit(outShirt, inShirt)}
              style={[styles.modalBtn, styles.modalBtnPrimary, (outShirt == null || inShirt == null) && { opacity: 0.4 }]}
              disabled={outShirt == null || inShirt == null}
            >
              <Text style={styles.modalBtnTextPrimary}>{warnings.length > 0 ? 'Confirm anyway' : 'Confirm'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function LiberoOnModal({
  visible, team, setActionTeam, rot, homeLabel, awayLabel, onClose, onSubmit, colors, styles,
}: {
  visible: boolean;
  team: Side;
  setActionTeam: (s: Side) => void;
  rot: RotationState;
  homeLabel: string;
  awayLabel: string;
  onClose: () => void;
  onSubmit: (libero: number, replaces: number) => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [libero, setLibero] = useState<number | null>(rot.liberos[0] ?? null);
  const [replaces, setReplaces] = useState<number | null>(null);
  useEffect(() => { setLibero(rot.liberos[0] ?? null); setReplaces(null); }, [team, rot]);

  // Back-row positions in the lineup tuple are indexes 0 (I), 4 (V), 5 (VI).
  const backRowShirts = [rot.positions[0], rot.positions[4], rot.positions[5]];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Libero on</Text>
          <TeamPicker value={team} onChange={setActionTeam} homeLabel={homeLabel} awayLabel={awayLabel} styles={styles} />
          <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>Libero:</Text>
          <View style={styles.shirtChipRow}>
            {rot.liberos.length === 0 ? <Text style={styles.fieldHint}>No liberos configured.</Text> : null}
            {rot.liberos.map((s, i) => (
              <TouchableOpacity key={i} style={[styles.shirtChip, libero === s && styles.shirtChipActive]} onPress={() => setLibero(s)} activeOpacity={0.7}>
                <Text style={[styles.shirtChipText, libero === s && styles.shirtChipTextActive]}>#{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>Replaces (back row only):</Text>
          <View style={styles.shirtChipRow}>
            {backRowShirts.map((s, i) => (
              <TouchableOpacity key={i} style={[styles.shirtChip, replaces === s && styles.shirtChipActive]} onPress={() => setReplaces(s)} activeOpacity={0.7}>
                <Text style={[styles.shirtChipText, replaces === s && styles.shirtChipTextActive]}>#{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.modalButtonsRow}>
            <TouchableOpacity onPress={onClose} style={[styles.modalBtn, styles.modalBtnCancel]}>
              <Text style={styles.modalBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => libero != null && replaces != null && onSubmit(libero, replaces)}
              style={[styles.modalBtn, styles.modalBtnPrimary, (libero == null || replaces == null) && { opacity: 0.4 }]}
              disabled={libero == null || replaces == null}
            >
              <Text style={styles.modalBtnTextPrimary}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function LiberoOffModal({
  visible, team, setActionTeam, rot, roster, homeLabel, awayLabel, onClose, onSubmit, colors, styles,
}: {
  visible: boolean;
  team: Side;
  setActionTeam: (s: Side) => void;
  rot: RotationState;
  roster: RosterPlayer[];
  homeLabel: string;
  awayLabel: string;
  onClose: () => void;
  onSubmit: (libero: number, replacedBy: number) => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const lib = rot.liberoOnFloor;
  // The libero must come off for the back-row regular they originally
  // replaced. Pre-select that, but let the user override (e.g. when the
  // libero is being subbed for a defensive specialist by mistake-correction).
  const defaultReturn = rot.liberoReplacesShirt;
  const [replaceWith, setReplaceWith] = useState<number | null>(defaultReturn);
  useEffect(() => {
    setReplaceWith(rot.liberoReplacesShirt);
  }, [rot.liberoReplacesShirt, team]);

  // Eligible alternatives: any active non-libero bench player, plus the
  // original-pair player. The original is the strongly-recommended pick.
  const benchAlts = roster
    .filter((p) => p.active && !p.isLibero && !rot.positions.includes(p.shirt))
    .map((p) => p.shirt);
  const candidates: number[] = defaultReturn != null
    ? [defaultReturn, ...benchAlts.filter((s) => s !== defaultReturn)]
    : benchAlts;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Libero off</Text>
          <TeamPicker value={team} onChange={setActionTeam} homeLabel={homeLabel} awayLabel={awayLabel} styles={styles} />
          {lib == null ? (
            <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>No libero on the floor for this team.</Text>
          ) : (
            <>
              <Text style={[styles.modalBody, { marginTop: spacing.sm }]}>
                Libero #{lib} comes off the floor.
              </Text>
              <Text style={styles.fieldHint}>Returning regular (default = the player the libero originally replaced):</Text>
              <View style={styles.shirtChipRow}>
                {candidates.length === 0 ? (
                  <Text style={styles.fieldHint}>No bench regulars available.</Text>
                ) : null}
                {candidates.map((s, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[
                      styles.shirtChip,
                      replaceWith === s && styles.shirtChipActive,
                      defaultReturn === s && replaceWith !== s && { borderColor: colors.success, borderWidth: 2 },
                    ]}
                    onPress={() => setReplaceWith(s)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.shirtChipText, replaceWith === s && styles.shirtChipTextActive]}>#{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {defaultReturn != null && replaceWith !== defaultReturn ? (
                <View style={styles.warnBlock}>
                  <Text style={styles.warnText}>⚠ Libero is normally replaced by the same player they substituted in for (#{defaultReturn}).</Text>
                </View>
              ) : null}
            </>
          )}
          <View style={styles.modalButtonsRow}>
            <TouchableOpacity onPress={onClose} style={[styles.modalBtn, styles.modalBtnCancel]}>
              <Text style={styles.modalBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => lib != null && replaceWith != null && onSubmit(lib, replaceWith)}
              style={[styles.modalBtn, styles.modalBtnPrimary, (lib == null || replaceWith == null) && { opacity: 0.4 }]}
              disabled={lib == null || replaceWith == null}
            >
              <Text style={styles.modalBtnTextPrimary}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function LiberoOfficiallyReplacedModal({
  visible, team, setActionTeam, rot, roster, homeLabel, awayLabel, onClose, onSubmit, colors, styles,
}: {
  visible: boolean;
  team: Side;
  setActionTeam: (s: Side) => void;
  rot: RotationState;
  roster: RosterPlayer[];
  homeLabel: string;
  awayLabel: string;
  onClose: () => void;
  onSubmit: (libero: number, replacedBy: number, reason?: string) => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [lib, setLib] = useState<number | null>(rot.liberos[0] ?? null);
  const [replacement, setReplacement] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  useEffect(() => {
    setLib(rot.liberos[0] ?? null);
    setReplacement(null);
    setReason('');
  }, [team, rot.liberos[0]]);

  const eligibleReplacements = roster
    .filter((p) => p.active && !p.isLibero && !rot.positions.includes(p.shirt))
    .map((p) => p.shirt);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Libero officially replaced</Text>
          <Text style={styles.fieldHint}>Use when injury / sanction forces a regular to take the libero's place. The libero is locked out for the rest of the set.</Text>
          <TeamPicker value={team} onChange={setActionTeam} homeLabel={homeLabel} awayLabel={awayLabel} styles={styles} />
          <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>Libero leaving:</Text>
          <View style={styles.shirtChipRow}>
            {rot.liberos.map((s, i) => (
              <TouchableOpacity key={i} style={[styles.shirtChip, lib === s && styles.shirtChipActive]} onPress={() => setLib(s)} activeOpacity={0.7}>
                <Text style={[styles.shirtChipText, lib === s && styles.shirtChipTextActive]}>#{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>Replaced by (regular):</Text>
          {eligibleReplacements.length === 0 ? (
            <Text style={styles.fieldHint}>No bench regulars available.</Text>
          ) : (
            <View style={styles.shirtChipRow}>
              {eligibleReplacements.map((s, i) => (
                <TouchableOpacity key={i} style={[styles.shirtChip, replacement === s && styles.shirtChipActive]} onPress={() => setReplacement(s)} activeOpacity={0.7}>
                  <Text style={[styles.shirtChipText, replacement === s && styles.shirtChipTextActive]}>#{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>Reason (optional):</Text>
          <TextInput
            style={styles.input}
            value={reason}
            onChangeText={setReason}
            placeholder="Injury / disqualification / …"
            placeholderTextColor={colors.textLight}
          />
          <View style={styles.modalButtonsRow}>
            <TouchableOpacity onPress={onClose} style={[styles.modalBtn, styles.modalBtnCancel]}>
              <Text style={styles.modalBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => lib != null && replacement != null && onSubmit(lib, replacement, reason)}
              style={[styles.modalBtn, styles.modalBtnPrimary, (lib == null || replacement == null) && { opacity: 0.4 }]}
              disabled={lib == null || replacement == null}
            >
              <Text style={styles.modalBtnTextPrimary}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function TimeoutModal({
  visible, team, setActionTeam, timeoutsUsed, score, homeLabel, awayLabel, onClose, onSubmit, colors, styles,
}: {
  visible: boolean;
  team: Side;
  setActionTeam: (s: Side) => void;
  timeoutsUsed: { home: number; away: number };
  score: { home: number; away: number };
  homeLabel: string;
  awayLabel: string;
  onClose: () => void;
  onSubmit: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const used = timeoutsUsed[team];
  const atCap = used >= 2;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Timeout</Text>
          <Text style={styles.fieldHint}>Which team called the timeout?</Text>
          <TeamPicker value={team} onChange={setActionTeam} homeLabel={homeLabel} awayLabel={awayLabel} styles={styles} />
          <Text style={[styles.modalBody, { marginTop: spacing.sm }]}>
            Score at this timeout: {homeLabel} {score.home} – {score.away} {awayLabel}
            {'\n'}Timeouts used by {team === 'home' ? homeLabel : awayLabel}: <Text style={{ fontWeight: '900', color: atCap ? colors.error : colors.text }}>{used}/2</Text>
            {atCap ? '\n\n⚠ This team has already used both timeouts this set; the request must be denied.' : ''}
          </Text>
          <View style={styles.modalButtonsRow}>
            <TouchableOpacity onPress={onClose} style={[styles.modalBtn, styles.modalBtnCancel]}>
              <Text style={styles.modalBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onSubmit}
              style={[styles.modalBtn, styles.modalBtnPrimary, atCap && { opacity: 0.4 }]}
              disabled={atCap}
            >
              <Text style={styles.modalBtnTextPrimary}>Record timeout</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SanctionModal({
  visible, team, setActionTeam, homeLabel, awayLabel, onClose, onSubmit, colors, styles,
}: {
  visible: boolean;
  team: Side;
  setActionTeam: (s: Side) => void;
  homeLabel: string;
  awayLabel: string;
  onClose: () => void;
  onSubmit: (level: SanctionEvent['level'], target: SanctionEvent['target'], shirt: number | undefined, reason: string) => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [level, setLevel] = useState<SanctionEvent['level']>('warning');
  const [target, setTarget] = useState<SanctionEvent['target']>('player');
  const [shirt, setShirt] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Sanction</Text>
          <TeamPicker value={team} onChange={setActionTeam} homeLabel={homeLabel} awayLabel={awayLabel} styles={styles} />

          <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>Level:</Text>
          <View style={styles.pillRow}>
            {(['warning', 'penalty', 'expulsion', 'disqualification'] as const).map((l) => (
              <TouchableOpacity key={l} style={[styles.pill, level === l && styles.pillActive]} onPress={() => setLevel(l)} activeOpacity={0.7}>
                <Text style={[styles.pillText, level === l && styles.pillTextActive]}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>Target:</Text>
          <View style={styles.pillRow}>
            {(['player', 'coach', 'assistant-coach', 'staff'] as const).map((t) => (
              <TouchableOpacity key={t} style={[styles.pill, target === t && styles.pillActive]} onPress={() => setTarget(t)} activeOpacity={0.7}>
                <Text style={[styles.pillText, target === t && styles.pillTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {target === 'player' ? (
            <>
              <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>Shirt #:</Text>
              <TextInput
                style={styles.input}
                value={shirt}
                onChangeText={setShirt}
                placeholder="#"
                placeholderTextColor={colors.textLight}
                keyboardType="number-pad"
                maxLength={3}
              />
            </>
          ) : null}

          <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>Reason (optional):</Text>
          <TextInput
            style={styles.input}
            value={reason}
            onChangeText={setReason}
            placeholder="Unsporting conduct / delay / …"
            placeholderTextColor={colors.textLight}
          />

          <View style={styles.modalButtonsRow}>
            <TouchableOpacity onPress={onClose} style={[styles.modalBtn, styles.modalBtnCancel]}>
              <Text style={styles.modalBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                const n = parseInt(shirt, 10);
                onSubmit(level, target, target === 'player' && isFinite(n) ? n : undefined, reason);
              }}
              style={[styles.modalBtn, styles.modalBtnPrimary]}
            >
              <Text style={styles.modalBtnTextPrimary}>Record</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function PointsByServerModal({
  visible, match, homeLabel, awayLabel, homeColor, awayColor, onClose, colors, styles,
}: {
  visible: boolean;
  match: Match;
  homeLabel: string;
  awayLabel: string;
  homeColor: string;
  awayColor: string;
  onClose: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  // Build serving runs by replaying through deriveMatchState set-by-set.
  // Each run: { team, serverShirt, points: [scoringTeam,...] }.
  const runsBySet = useMemo(() => buildServingRuns(match), [match]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCardLg}>
          <Text style={styles.modalTitle}>Points by server</Text>
          <ScrollView style={{ maxHeight: 460 }}>
            {runsBySet.length === 0 ? (
              <Text style={styles.fieldHint}>No points yet.</Text>
            ) : null}
            {runsBySet.map((set, sIdx) => (
              <View key={sIdx} style={{ marginBottom: spacing.md }}>
                <Text style={styles.historyType}>SET {set.setIndex + 1}</Text>
                {set.runs.length === 0 ? (
                  <Text style={styles.fieldHint}>No serves recorded.</Text>
                ) : null}
                {set.runs.map((r, i) => (
                  <View key={i} style={styles.serveRow}>
                    <View style={[styles.serveBadge, { backgroundColor: r.team === 'home' ? homeColor : awayColor }]}>
                      <Text style={styles.serveBadgeText}>{r.team === 'home' ? homeLabel.slice(0, 3).toUpperCase() : awayLabel.slice(0, 3).toUpperCase()} #{r.serverShirt ?? '?'}</Text>
                    </View>
                    <Text style={styles.serveRunText} numberOfLines={1}>
                      {r.points.length === 0 ? '— side-out, 0 pts' : r.points.map((t) => (t === r.team ? '●' : '○')).join(' ')} {r.points.length > 0 ? `(${r.points.filter((t) => t === r.team).length})` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
          <Text style={styles.fieldHint}>● = point won on this serve · ○ = side-out</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── PostMatchSaveSheet ───────────────────────────────────────────────────
//
// Placeholder/minimal modal — fancier UX comes in Session γ. Lets the
// user pick `matchKind`, optionally link a tournament + opposing team,
// edit the match label, and toggle `includeInStats` before persisting
// the match metadata. The brief calls this "functional but minimal"
// for Session α.
//
// All async lookups (tournament list, opposing-team list) are kicked
// off lazily when the segmented control switches to AES / Timu so we
// don't pay the AsyncStorage cost just to dismiss the sheet.

function PostMatchSaveSheet({
  visible,
  meta,
  homeLabel,
  awayLabel,
  onSave,
  onDontSave,
  colors,
  styles,
}: {
  visible: boolean;
  meta: import('../types/match').MatchMeta;
  homeLabel: string;
  awayLabel: string;
  onSave: (args: {
    matchKind: MatchKind;
    tournamentPick: TournamentPickerEntry | null;
    opponentName: string | null;
    matchLabel: string;
    includeInStats: boolean;
  }) => void;
  onDontSave: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  // Initial kind: prefer whatever Tier 2 set (tournament-context entry
  // would have already pre-filled this); else infer from existing
  // links; else 'standalone'.
  const initialKind: MatchKind = useMemo(() => {
    if (meta.matchKind && meta.matchKind !== 'imported') return meta.matchKind;
    if (meta.linkedAesEvent) return 'aes';
    if (meta.linkedTimuTournament) return 'timu';
    return 'standalone';
  }, [meta]);
  const [kind, setKind] = useState<MatchKind>(initialKind);
  const [pick, setPick] = useState<TournamentPickerEntry | null>(null);
  const [opponentName, setOpponentName] = useState<string | null>(null);
  const [matchLabel, setMatchLabel] = useState(meta.matchLabel);
  const [include, setInclude] = useState<boolean>(
    meta.includeInStats ?? defaultIncludeInStats(initialKind)
  );

  const [tournaments, setTournaments] = useState<TournamentPickerEntry[]>([]);
  const [tournamentsLoaded, setTournamentsLoaded] = useState(false);
  const [opponentList, setOpponentList] = useState<string[]>([]);

  // Reset local state every time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setKind(initialKind);
    setPick(null);
    setOpponentName(null);
    setMatchLabel(meta.matchLabel);
    setInclude(meta.includeInStats ?? defaultIncludeInStats(initialKind));
    setTournaments([]);
    setTournamentsLoaded(false);
    setOpponentList([]);
  }, [visible, initialKind, meta.matchLabel, meta.includeInStats]);

  // Load tournament list on first switch to AES/Timu.
  useEffect(() => {
    if (!visible) return;
    if (kind !== 'aes' && kind !== 'timu') return;
    if (tournamentsLoaded) return;
    let cancelled = false;
    getRecentTournamentsForLinking()
      .then((list) => {
        if (cancelled) return;
        setTournaments(list);
        setTournamentsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setTournaments([]);
        setTournamentsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, kind, tournamentsLoaded]);

  // When a tournament is picked, fetch its team list for the opposition picker.
  useEffect(() => {
    if (!pick) {
      setOpponentList([]);
      return;
    }
    let cancelled = false;
    const ref =
      pick.source === 'aes' && pick.aes
        ? ({ source: 'aes' as const, aes: pick.aes })
        : pick.source === 'timu' && pick.timu
        ? ({ source: 'timu' as const, timu: pick.timu })
        : null;
    if (!ref) return;
    getOpposingTeamsForTournament(ref)
      .then((names) => {
        if (cancelled) return;
        setOpponentList(names);
      })
      .catch(() => {
        if (cancelled) return;
        setOpponentList([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pick]);

  // When the kind changes, recompute the include-in-stats default if
  // the user hasn't manually flipped it (we only auto-update if the
  // current value still equals the prior kind's default — heuristic
  // good enough for v1).
  function pickKind(next: MatchKind) {
    setKind(next);
    setInclude(defaultIncludeInStats(next));
    if (next === 'standalone') {
      setPick(null);
      setOpponentName(null);
    }
  }

  const filteredTournaments = useMemo(
    () => tournaments.filter((t) => t.source === kind),
    [tournaments, kind]
  );

  function commit() {
    onSave({
      matchKind: kind,
      tournamentPick: pick,
      opponentName,
      matchLabel,
      includeInStats: include,
    });
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        /* dismissing requires an explicit Save / Don't save tap */
      }}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCardLg}>
          <Text style={styles.modalTitle}>Save match to analytics</Text>
          <ScrollView style={{ maxHeight: 480 }}>
            <Text style={[styles.fieldHint, { marginTop: spacing.sm }]}>
              Match kind
            </Text>
            <View style={styles.pillRow}>
              {(['aes', 'timu', 'standalone'] as MatchKind[]).map((k) => (
                <TouchableOpacity
                  key={k}
                  style={[styles.pill, kind === k && styles.pillActive]}
                  onPress={() => pickKind(k)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.pillText,
                      kind === k && styles.pillTextActive,
                    ]}
                  >
                    {k === 'aes'
                      ? 'AES'
                      : k === 'timu'
                      ? 'Timu'
                      : 'Standalone'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {kind === 'aes' || kind === 'timu' ? (
              <View style={{ marginTop: spacing.md }}>
                <Text style={styles.fieldHint}>
                  Tournament ({kind === 'aes' ? 'AES' : 'Timu'} indexed)
                </Text>
                {!tournamentsLoaded ? (
                  <Text style={styles.fieldHint}>Loading…</Text>
                ) : filteredTournaments.length === 0 ? (
                  <Text style={styles.fieldHint}>
                    No indexed {kind === 'aes' ? 'AES' : 'Timu'} tournaments
                    yet. You can link this match later from Season History.
                  </Text>
                ) : (
                  <ScrollView
                    style={{ maxHeight: 160 }}
                    nestedScrollEnabled
                  >
                    {filteredTournaments.map((t) => {
                      const key =
                        t.source === 'aes'
                          ? `aes:${t.aes?.eventId}:${t.aes?.divisionId ?? ''}`
                          : `timu:${t.timu?.tid}`;
                      const isPicked =
                        pick != null &&
                        pick.source === t.source &&
                        ((t.source === 'aes' &&
                          pick.aes?.eventId === t.aes?.eventId &&
                          pick.aes?.divisionId === t.aes?.divisionId) ||
                          (t.source === 'timu' &&
                            pick.timu?.tid === t.timu?.tid));
                      return (
                        <TouchableOpacity
                          key={key}
                          style={[
                            styles.pill,
                            { marginBottom: spacing.xs },
                            isPicked && styles.pillActive,
                          ]}
                          onPress={() => {
                            setPick(isPicked ? null : t);
                            setOpponentName(null);
                          }}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.pillText,
                              isPicked && styles.pillTextActive,
                            ]}
                            numberOfLines={1}
                          >
                            {t.tournamentName}
                            {t.subtitle ? ` · ${t.subtitle}` : ''}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            ) : null}

            {pick && opponentList.length > 0 ? (
              <View style={{ marginTop: spacing.md }}>
                <Text style={styles.fieldHint}>Opposition</Text>
                <ScrollView style={{ maxHeight: 140 }} nestedScrollEnabled>
                  {opponentList.map((name) => {
                    const isPicked = opponentName === name;
                    return (
                      <TouchableOpacity
                        key={name}
                        style={[
                          styles.pill,
                          { marginBottom: spacing.xs },
                          isPicked && styles.pillActive,
                        ]}
                        onPress={() =>
                          setOpponentName(isPicked ? null : name)
                        }
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.pillText,
                            isPicked && styles.pillTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          {name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            <Text style={[styles.fieldHint, { marginTop: spacing.md }]}>
              Match label
            </Text>
            <TextInput
              style={styles.input}
              value={matchLabel}
              onChangeText={setMatchLabel}
              placeholder={`${homeLabel} vs ${awayLabel}`}
              placeholderTextColor={colors.textLight}
            />

            <TouchableOpacity
              onPress={() => setInclude(!include)}
              style={[
                styles.pill,
                { marginTop: spacing.md, alignSelf: 'flex-start' },
                include && styles.pillActive,
              ]}
              activeOpacity={0.7}
            >
              <Text
                style={[styles.pillText, include && styles.pillTextActive]}
              >
                {include ? '✓ ' : ''}Include in analytics
              </Text>
            </TouchableOpacity>
            <Text style={[styles.fieldHint, { marginTop: spacing.xs }]}>
              Counts toward season totals for per-player roll-ups. Default:
              on for AES / Timu, off for standalone.
            </Text>
          </ScrollView>

          <View style={styles.modalButtonsRow}>
            <TouchableOpacity
              onPress={onDontSave}
              style={[styles.modalBtn, styles.modalBtnCancel]}
            >
              <Text style={styles.modalBtnTextCancel}>Don't save</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={commit}
              style={[styles.modalBtn, styles.modalBtnPrimary]}
            >
              <Text style={styles.modalBtnTextPrimary}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function summarizeEvent(e: MatchEvent): string {
  switch (e.type) {
    case 'lineup':
      return `${e.team} set ${e.setIndex + 1}: ${e.positions.map((s) => '#' + s).join(' / ')}${e.liberos.length ? ` (L: ${e.liberos.map((s) => '#' + s).join(',')})` : ''}`;
    case 'point':
      return `${e.scoringTeam} +1 (set ${e.setIndex + 1})${e.reason ? ` · ${e.reason}` : ''}${e.shirt ? ` #${e.shirt}` : ''}`;
    case 'stat':
      return `${e.team} #${e.shirt} ${e.category}${e.quality != null ? ` (${e.quality})` : ''}`;
    case 'sub':
      return `${e.team} #${e.out} → #${e.in}`;
    case 'libero-on':
      return `${e.team} libero #${e.libero} replaces #${e.replaces}`;
    case 'libero-off':
      return `${e.team} libero #${e.libero} → #${e.replacedBy}`;
    case 'libero-officially-replaced':
      return `${e.team} libero #${e.libero} officially replaced by #${e.replacedBy}${e.reason ? ` (${e.reason})` : ''}`;
    case 'timeout':
      return `${e.team} ${e.technical ? 'technical timeout' : 'timeout'}`;
    case 'sanction':
      return `${e.team} ${e.delayBased ? 'delay ' : ''}${e.level}${e.shirt ? ` to #${e.shirt}` : ''}${e.reason ? `: ${e.reason}` : ''}`;
    case 'improper-request':
      return `${e.team} improper request${e.reason ? `: ${e.reason}` : ''}`;
    case 'medical-assistance':
      return `${e.team} #${e.shirt} ${e.kind}${e.reason ? ` (${e.reason})` : ''}`;
    case 'signoff':
      return `${e.party} signed off`;
    case 'set-end':
      return `Set ${e.setIndex + 1} ended ${e.homeFinal}–${e.awayFinal}`;
    case 'match-end':
      return `Match ended ${e.setsHome}–${e.setsAway}`;
    case 'match-abandoned':
      return `Match abandoned: ${e.reason}${e.awarded ? ` (winner: ${e.awarded.winner})` : ''}`;
  }
}

function formatSubCount(rot: RotationState, rule: 'fivb' | 'vc'): string {
  return rule === 'vc' ? `${rot.subsUsed}/12` : `${rot.subPairs.length}/6p`;
}

function formatHM(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m${s.toString().padStart(2, '0')}`;
}

/**
 * Set start = first event timestamp matching this set index. Returns 0
 * if the set hasn't begun (lineups not yet fired).
 */
function deriveSetStartMs(match: Match, setIndex: number): number {
  for (const e of match.events) {
    if (e.setIndex === setIndex) return e.ts;
  }
  return 0;
}

/**
 * Set duration = last event ts in this set − first event ts. Tolerant
 * to the set being live (returns time-since-start).
 */
function deriveSetDurationMs(match: Match, setIndex: number): number {
  let first = 0;
  let last = 0;
  for (const e of match.events) {
    if (e.setIndex !== setIndex) continue;
    if (!first) first = e.ts;
    last = e.ts;
  }
  if (!first) return 0;
  // If the set hasn't ended yet, use "now" so the live duration display
  // is reasonable. Caller passing this into a set-end event captures
  // the moment that the user confirmed.
  const end = last || Date.now();
  return Math.max(0, end - first);
}

function deriveMatchDurationMs(match: Match): number {
  if (match.events.length === 0) return 0;
  const first = match.events[0].ts;
  const last = match.events[match.events.length - 1].ts;
  return Math.max(0, last - first);
}

interface ServingRun {
  team: Side;
  serverShirt: number | null;
  /** Points scored during this serving run, in order. */
  points: Side[];
}

interface SetServingRuns {
  setIndex: number;
  runs: ServingRun[];
}

/**
 * Walk through the match event log and group point events by the team
 * that was serving when each rally started. Each "run" begins with a
 * side-out (or first serve of the set) and ends at the next side-out.
 *
 * We re-derive after each event so we can read the server's shirt #
 * (which depends on rotation + libero-may-serve state). This is O(N²)
 * in event count but N is small enough that it doesn't matter in
 * practice.
 */
function buildServingRuns(match: Match): SetServingRuns[] {
  const result: SetServingRuns[] = [];
  // Walk events, ignoring everything before the first lineup of each set.
  // Build incrementally by appending events one-at-a-time and inspecting
  // the derived state after each.
  let cursor: Match = { ...match, events: [] };
  let currentSetIndex = -1;
  let currentRun: ServingRun | null = null;
  let setBucket: SetServingRuns | null = null;
  let prevServer: Side | null = null;
  let prevServerShirt: number | null = null;

  for (const ev of match.events) {
    cursor = appendEvent(cursor, ev);
    const s = deriveMatchState(cursor);

    if (s.currentSetIndex !== currentSetIndex) {
      // New set started.
      if (setBucket) result.push(setBucket);
      setBucket = { setIndex: s.currentSetIndex, runs: [] };
      currentRun = null;
      currentSetIndex = s.currentSetIndex;
      prevServer = null;
      prevServerShirt = null;
    }

    if (ev.type === 'lineup' || ev.type === 'sub' || ev.type === 'libero-on' || ev.type === 'libero-off' || ev.type === 'libero-officially-replaced') {
      // Update server tracking but no run change.
      if (s.currentSet) {
        prevServer = s.currentSet.server;
        prevServerShirt = s.currentSet.serverShirt;
      }
      // Open the initial run for the set if needed.
      if (!currentRun && setBucket && s.currentSet?.server) {
        currentRun = {
          team: s.currentSet.server,
          serverShirt: s.currentSet.serverShirt,
          points: [],
        };
        setBucket.runs.push(currentRun);
      }
      continue;
    }

    if (ev.type === 'point') {
      // The serving team BEFORE this point is on prevServer (set when
      // we processed the last event). If currentRun is null (very first
      // point), open it now using the pre-state would be more accurate;
      // fall back to the post-state's server.
      if (!currentRun && setBucket) {
        // Best-effort: the server flips on side-out. The team that DID
        // NOT score this rally was likely serving; if scoringTeam ==
        // post-state server, that means they kept serving (point on
        // own serve), else they side-out'd.
        const guessTeam: Side = ev.scoringTeam === s.currentSet?.server ? ev.scoringTeam : (ev.scoringTeam === 'home' ? 'away' : 'home');
        currentRun = { team: guessTeam, serverShirt: prevServerShirt, points: [] };
        setBucket.runs.push(currentRun);
      }
      if (currentRun) {
        currentRun.points.push(ev.scoringTeam);
        // If the side-out happened (scoring team != serving team in the
        // run), close this run and start a new one keyed to the new
        // server. The post-event state has the new server set up.
        if (ev.scoringTeam !== currentRun.team && setBucket && s.currentSet?.server) {
          currentRun = {
            team: s.currentSet.server,
            serverShirt: s.currentSet.serverShirt,
            points: [],
          };
          setBucket.runs.push(currentRun);
        }
      }
      if (s.currentSet) {
        prevServer = s.currentSet.server;
        prevServerShirt = s.currentSet.serverShirt;
      }
      continue;
    }

    if (ev.type === 'set-end') {
      if (setBucket) result.push(setBucket);
      setBucket = null;
      currentRun = null;
    }
  }
  if (setBucket) result.push(setBucket);
  return result;
}

interface EventLogRow {
  event: MatchEvent;
  /** Score AFTER this event landed. For set-end / match-end this is the
   *  final of the just-ended set / current sets-won tally. */
  score: { home: number; away: number };
}

/**
 * Walk the event log and tag each entry with the running score as of
 * that moment. Used in the History modal so the scorer can see at-a-
 * glance "the sub came on at 14–9, timeout was at 21–18".
 *
 * O(N²) since we re-derive after each event but N is small.
 */
function buildEventLogRows(match: Match): EventLogRow[] {
  const rows: EventLogRow[] = [];
  let cursor: Match = { ...match, events: [] };
  for (const ev of match.events) {
    cursor = appendEvent(cursor, ev);
    const s = deriveMatchState(cursor);
    let score = { home: 0, away: 0 };
    if (s.currentSet) {
      score = s.currentSet.score;
    } else if (ev.type === 'set-end') {
      score = { home: ev.homeFinal, away: ev.awayFinal };
    } else if (ev.type === 'match-end') {
      score = { home: ev.setsHome, away: ev.setsAway };
    } else {
      // Between sets — pull the previous set's final.
      const prev = s.setHistory[s.setHistory.length - 1];
      if (prev) score = { home: prev.homeFinal, away: prev.awayFinal };
    }
    rows.push({ event: ev, score });
  }
  return rows;
}

// ─── Styles ────────────────────────────────────────────────────────────────

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
    topBarLandscape: {
      paddingTop: spacing.sm,
      paddingBottom: 4,
    },
    backBtn: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
    title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
    subtitle: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
    abandonBtn: { color: colors.error, fontSize: fontSize.sm, fontWeight: '700' },

    statusStrip: {
      paddingHorizontal: spacing.lg,
      paddingVertical: 4,
      backgroundColor: colors.primaryLight,
    },
    statusText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },

    boardRow: { flex: 1, flexDirection: 'row' },
    separator: { width: 1, backgroundColor: colors.border },
    panel: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: 4,
      backgroundColor: colors.surface,
      borderTopWidth: 6,
    },
    panelWinner: { backgroundColor: colors.primaryLight },
    teamName: {
      fontSize: fontSize.lg,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'center',
      paddingHorizontal: spacing.sm,
    },
    setsWon: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '700', marginTop: 2 },
    serverPillSlot: { minHeight: 36, marginTop: 4 },
    serverPill: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: borderRadius.full,
    },
    serverPillText: { color: '#ffffff', fontSize: fontSize.md, fontWeight: '900', letterSpacing: 0.5 },
    pointsWrap: {
      flex: 1,
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
    },
    points: {
      fontWeight: '900',
      textAlign: 'center',
      includeFontPadding: false,
    },
    tapHint: { color: colors.textLight, fontSize: fontSize.xs, marginTop: 4, fontStyle: 'italic' },
    winnerBadge: { color: colors.success, fontSize: fontSize.lg, fontWeight: '900', marginTop: 4, letterSpacing: 1 },

    pastSetsLine: {
      paddingHorizontal: spacing.lg,
      paddingVertical: 4,
      color: colors.textLight,
      fontSize: fontSize.xs,
      fontWeight: '600',
    },

    miniCourtWrap: {
      flexDirection: 'column',
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      backgroundColor: colors.background,
    },
    courtContainer: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      padding: spacing.xs,
      borderWidth: 1,
      borderColor: colors.border,
    },
    courtHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xs,
      paddingVertical: 2,
    },
    courtTeamHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    courtTeamHeaderRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    courtColorDot: { width: 10, height: 10, borderRadius: 5 },
    courtTeamHeaderText: { fontSize: fontSize.xs, fontWeight: '800', color: colors.text, letterSpacing: 0.5 },

    /* Horizontal court canvas — five columns side-by-side. Each team gets
       a back column (outside) + front column (inside, against the net),
       and the net itself is the centre column. */
    courtCanvas: {
      flex: 1,
      flexDirection: 'row',
      gap: 4,
      marginTop: 4,
    },
    courtCol: {
      flex: 1,
      flexDirection: 'column',
      gap: 4,
    },
    courtCell: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.sm,
      paddingVertical: 4,
      paddingHorizontal: 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      minHeight: 44,
    },
    courtCellFront: {
      // Slight tint to convey "this column is at the net"
      backgroundColor: colors.primaryLight,
    },
    courtCellPos: { fontSize: 10, fontWeight: '700', color: colors.textLight, letterSpacing: 0.5 },
    courtCellNum: { fontSize: fontSize.md, fontWeight: '900', color: colors.text, marginTop: 1 },
    courtCellMarkers: { flexDirection: 'row', gap: 4 },
    courtCellLib: { fontSize: 9, fontWeight: '700', color: colors.accent },
    courtCellServ: { fontSize: 10 },

    /* The net is a thin vertical band between the two teams' front rows.
       Width is intentionally small (12 px) so the player cells get most
       of the horizontal space. */
    netVertical: {
      width: 16,
      backgroundColor: colors.divider,
      borderRadius: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    netVerticalText: {
      fontSize: 8,
      fontWeight: '900',
      color: colors.textLight,
      letterSpacing: 1,
      textAlign: 'center',
    },

    betweenSetsBanner: {
      margin: spacing.lg,
      padding: spacing.lg,
      borderRadius: borderRadius.lg,
      backgroundColor: colors.primaryLight,
      borderLeftWidth: 4,
      borderLeftColor: colors.primary,
    },
    betweenSetsTitle: {
      fontSize: fontSize.lg,
      fontWeight: '900',
      color: colors.primary,
      letterSpacing: 0.5,
      marginBottom: spacing.xs,
    },
    betweenSetsBody: {
      fontSize: fontSize.sm,
      color: colors.text,
      lineHeight: 20,
      marginBottom: spacing.md,
    },
    betweenSetsBtn: {
      backgroundColor: colors.primary,
      paddingVertical: spacing.md,
      borderRadius: borderRadius.md,
      alignItems: 'center',
    },
    betweenSetsBtnText: {
      color: colors.textOnPrimary,
      fontWeight: '800',
      fontSize: fontSize.md,
    },
    betweenSetsBtnSecondary: {
      paddingVertical: spacing.md,
      borderRadius: borderRadius.md,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.surface,
    },
    betweenSetsBtnSecondaryText: {
      color: colors.primary,
      fontWeight: '800',
      fontSize: fontSize.md,
    },

    startSetEditBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      backgroundColor: colors.primaryLight,
    },
    startSetEditText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary, letterSpacing: 0.5 },
    startSetEditBtn: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: borderRadius.sm,
      backgroundColor: colors.primary,
    },
    startSetEditBtnText: { color: colors.textOnPrimary, fontSize: fontSize.xs, fontWeight: '800' },

    lastPointBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
    },
    lastPointDot: { width: 10, height: 10, borderRadius: 5 },
    lastPointText: { flex: 1, color: colors.text, fontSize: fontSize.xs, fontWeight: '700' },
    lastPointEdit: { color: colors.primary, fontSize: fontSize.xs, fontWeight: '800' },

    lineupTeamBlock: {
      backgroundColor: colors.background,
      padding: spacing.sm,
      borderRadius: borderRadius.sm,
    },

    shelf: {
      flexDirection: 'row',
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.sm,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
    },
    shelfBtn: {
      flex: 1,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    shelfBtnText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },

    bottomBar: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
      alignItems: 'center',
    },
    bottomText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },

    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
    modalBackdropWide: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: spacing.sm },
    modalCard: { backgroundColor: colors.surface, borderRadius: borderRadius.lg, padding: spacing.lg, width: '100%', maxWidth: 400 },
    modalCardLg: { backgroundColor: colors.surface, borderRadius: borderRadius.lg, padding: spacing.lg, width: '100%', maxWidth: 480 },
    courtModalCard: { backgroundColor: colors.surface, borderRadius: borderRadius.lg, padding: spacing.lg, width: '100%', maxWidth: 520, alignSelf: 'center' },
    courtModalCardWide: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.lg,
      padding: spacing.md,
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
    },
    modalTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700', marginBottom: spacing.sm },
    modalBody: { color: colors.text, fontSize: fontSize.md, marginBottom: spacing.md, lineHeight: 22 },
    modalButtonsRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.md, gap: spacing.sm },
    modalBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: borderRadius.md, minWidth: 90, alignItems: 'center' },
    modalBtnCancel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    modalBtnPrimary: { backgroundColor: colors.primary },
    modalBtnTextCancel: { color: colors.text, fontWeight: '700' },
    modalBtnTextPrimary: { color: colors.textOnPrimary, fontWeight: '700' },

    closeBtn: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      marginTop: spacing.md,
    },
    closeBtnText: { color: colors.text, fontWeight: '700' },

    historyRow: {
      paddingVertical: 6,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    historyRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    historyType: { fontSize: fontSize.xs, fontWeight: '800', color: colors.primary, letterSpacing: 0.5 },
    historyScore: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textLight },
    historyDetail: { fontSize: fontSize.sm, color: colors.text, marginTop: 1 },

    warnBlock: {
      marginTop: spacing.sm,
      padding: spacing.sm,
      borderRadius: borderRadius.sm,
      backgroundColor: colors.error + '22',
      borderLeftWidth: 3,
      borderLeftColor: colors.error,
    },
    warnText: { color: colors.error, fontSize: fontSize.xs, fontWeight: '700', lineHeight: 18 },

    fieldHint: { fontSize: fontSize.xs, color: colors.textLight, fontStyle: 'italic' },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.sm,
      paddingVertical: 8,
      paddingHorizontal: spacing.sm,
      fontSize: fontSize.md,
      color: colors.text,
      backgroundColor: colors.background,
      marginTop: 4,
    },

    actionSheet: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.lg,
      padding: spacing.lg,
      width: '100%',
      maxWidth: 480,
    },
    actionGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    actionTile: {
      width: '30%',
      paddingVertical: spacing.md,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      alignItems: 'center',
    },
    actionEmoji: { fontSize: 22 },
    actionLabel: { color: colors.text, fontSize: fontSize.xs, fontWeight: '700', marginTop: 4, textAlign: 'center' },

    pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    pill: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: borderRadius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    pillText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
    pillTextActive: { color: colors.textOnPrimary },

    shirtChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 },
    shirtChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: borderRadius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      minWidth: 48,
      alignItems: 'center',
    },
    shirtChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    shirtChipText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '800' },
    shirtChipTextActive: { color: colors.textOnPrimary },

    /* Libero chips use the accent color so they're visually distinct from
       regular roster chips. When `liberoChipActive` is true (i.e. they're
       a designated libero for the current set) the chip is filled. */
    liberoChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: borderRadius.sm,
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.accent + '22',
      minWidth: 60,
      alignItems: 'center',
    },
    liberoChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    liberoChipText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '900' },
    liberoChipTextActive: { color: '#ffffff' },

    serveRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: 4,
    },
    serveBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: borderRadius.sm,
      minWidth: 86,
      alignItems: 'center',
    },
    serveBadgeText: { color: '#ffffff', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
    serveRunText: { color: colors.text, fontSize: fontSize.sm, flex: 1 },

    // ── Stat bar ──────────────────────────────────────────────────────
    statBarContainer: {
      backgroundColor: colors.surface,
      borderWidth: 2,
      borderRadius: borderRadius.lg,
      marginHorizontal: spacing.sm,
      marginVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.12,
      shadowRadius: 6,
      elevation: 4,
    },
    statBarHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.xs,
      paddingHorizontal: 2,
    },
    statBarPlayerText: {
      fontSize: fontSize.md,
      fontWeight: '700',
      color: colors.text,
      flex: 1,
    },
    statBarDismiss: {
      fontSize: fontSize.lg,
      color: colors.textLight,
      fontWeight: '700',
      paddingHorizontal: spacing.xs,
    },
    statBarEditLineup: {
      fontSize: fontSize.sm,
      color: colors.primary,
      fontWeight: '600',
    },
    statBarButtons: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    statBtn: {
      backgroundColor: colors.background,
      borderRadius: borderRadius.md,
      paddingVertical: 6,
      paddingHorizontal: 8,
      alignItems: 'center',
      minWidth: 44,
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
    },
    statBtnPoint: {
      borderWidth: 0,
    },
    statBtnEmoji: {
      fontSize: 16,
      marginBottom: 1,
    },
    statBtnLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },
  });
}
