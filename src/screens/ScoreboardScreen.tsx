// ── ScoreboardScreen ───────────────────────────────────────────────────────
//
// Tier-1 hold-up scoreboard. Independent of the AES/Timu data model — this
// is just a phone-as-flipboard for a match.
//
// Features:
//   • Two huge tap-to-score panels with 0-padded set counters and
//     adjustsFontSizeToFit-scaled point displays. Landscape gives even
//     bigger numbers since panels widen.
//   • Sport mode: Indoor (default 25/15 targets) or Beach (21/15).
//   • 1–7 sets — odd race-to-half-plus-one with deciding set, even play
//     all and a tie is a valid result.
//   • Per-team colour pick (palette, no free RGB) — lets you mirror the
//     team jerseys.
//   • Server indicator — manual tap to set, auto-flips to the team that
//     just won a point (rally scoring). Persists through undo.
//   • Timeouts — tap the timeout button to flash a fullscreen TIMEOUT
//     overlay; auto-dismisses after 30 s.
//   • Win by 2 enforced on every set.
// ────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  Modal,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useTheme,
  spacing,
  fontSize,
  borderRadius,
} from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import { WinProbabilityBar } from '../components/WinProbabilityBar';

const STORAGE_KEY = 'scoreboard.v3';

type Sport = 'indoor' | 'beach';

interface SavedConfig {
  homeName?: string;
  awayName?: string;
  homeColor?: string;
  awayColor?: string;
  sport?: Sport;
  numSets?: number;
  regularSetTarget?: number;
  decidingSetTarget?: number;
}

interface SetResult {
  home: number;
  away: number;
}

interface UndoSnapshot {
  homePts: number;
  awayPts: number;
  setHistory: SetResult[];
  server: 'home' | 'away' | null;
  homeTimeouts: number;
  awayTimeouts: number;
}

interface Props {
  onBack: () => void;
}

const COLOR_PALETTE = [
  '#1a73e8', // blue (default home)
  '#ff6b35', // orange (default away)
  '#ea4335', // red
  '#34a853', // green
  '#9c27b0', // purple
  '#00acc1', // teal
  '#e91e63', // pink
  '#fbbc04', // gold
  '#3f51b5', // indigo
  '#1a1a1a', // black
];

const SPORT_DEFAULTS: Record<Sport, { regular: number; deciding: number }> = {
  indoor: { regular: 25, deciding: 15 },
  beach: { regular: 21, deciding: 15 },
};

const DEFAULT_HOME_COLOR = COLOR_PALETTE[0];
const DEFAULT_AWAY_COLOR = COLOR_PALETTE[1];

export function ScoreboardScreen({ onBack }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [homeName, setHomeName] = useState('Home');
  const [awayName, setAwayName] = useState('Away');
  const [homeColor, setHomeColor] = useState<string>(DEFAULT_HOME_COLOR);
  const [awayColor, setAwayColor] = useState<string>(DEFAULT_AWAY_COLOR);
  const [sport, setSport] = useState<Sport>('indoor');
  const [numSets, setNumSets] = useState<number>(3);
  const [regularSetTarget, setRegularSetTarget] = useState<number>(25);
  const [decidingSetTarget, setDecidingSetTarget] = useState<number>(15);

  const [setHistory, setSetHistory] = useState<SetResult[]>([]);
  const [homePts, setHomePts] = useState(0);
  const [awayPts, setAwayPts] = useState(0);
  const [server, setServer] = useState<'home' | 'away' | null>(null);
  const [homeTimeouts, setHomeTimeouts] = useState(0);
  const [awayTimeouts, setAwayTimeouts] = useState(0);
  const [timeoutFor, setTimeoutFor] = useState<'home' | 'away' | null>(null);
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);
  const [editTarget, setEditTarget] = useState<'home' | 'away' | null>(null);
  const [editText, setEditText] = useState('');
  const [colorTarget, setColorTarget] = useState<'home' | 'away' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Load saved config on mount.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((s) => {
        if (!s) return;
        try {
          const cfg: SavedConfig = JSON.parse(s);
          if (cfg.homeName) setHomeName(cfg.homeName);
          if (cfg.awayName) setAwayName(cfg.awayName);
          if (cfg.homeColor) setHomeColor(cfg.homeColor);
          if (cfg.awayColor) setAwayColor(cfg.awayColor);
          if (cfg.sport === 'indoor' || cfg.sport === 'beach') {
            setSport(cfg.sport);
          }
          if (
            typeof cfg.numSets === 'number' &&
            cfg.numSets >= 1 &&
            cfg.numSets <= 7
          ) {
            setNumSets(Math.round(cfg.numSets));
          }
          if (
            typeof cfg.regularSetTarget === 'number' &&
            cfg.regularSetTarget > 0
          ) {
            setRegularSetTarget(Math.round(cfg.regularSetTarget));
          }
          if (
            typeof cfg.decidingSetTarget === 'number' &&
            cfg.decidingSetTarget > 0
          ) {
            setDecidingSetTarget(Math.round(cfg.decidingSetTarget));
          }
        } catch {}
      })
      .finally(() => setHydrated(true));
  }, []);

  // Persist whenever any persisted field changes.
  useEffect(() => {
    if (!hydrated) return;
    const cfg: SavedConfig = {
      homeName,
      awayName,
      homeColor,
      awayColor,
      sport,
      numSets,
      regularSetTarget,
      decidingSetTarget,
    };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)).catch(() => {});
  }, [
    homeName,
    awayName,
    homeColor,
    awayColor,
    sport,
    numSets,
    regularSetTarget,
    decidingSetTarget,
    hydrated,
  ]);

  // Auto-clear timeout overlay after 30 seconds.
  useEffect(() => {
    if (!timeoutFor) return;
    const t = setTimeout(() => setTimeoutFor(null), 30 * 1000);
    return () => clearTimeout(t);
  }, [timeoutFor]);

  // ── Derived state ──────────────────────────────────────────────────────
  const homeSetsWon = setHistory.filter((s) => s.home > s.away).length;
  const awaySetsWon = setHistory.filter((s) => s.away > s.home).length;
  const isOddSets = numSets % 2 === 1;
  const setsToWin = isOddSets ? Math.ceil(numSets / 2) : numSets;
  const setsPlayed = setHistory.length;
  const matchComplete = isOddSets
    ? homeSetsWon >= setsToWin || awaySetsWon >= setsToWin
    : setsPlayed >= numSets;
  const isDecidingSet =
    isOddSets &&
    homeSetsWon === Math.ceil(numSets / 2) - 1 &&
    awaySetsWon === Math.ceil(numSets / 2) - 1;
  const cap = isDecidingSet ? decidingSetTarget : regularSetTarget;
  const currentSetNumber = setHistory.length + 1;

  let winner: 'home' | 'away' | 'tie' | null = null;
  if (matchComplete) {
    if (homeSetsWon > awaySetsWon) winner = 'home';
    else if (awaySetsWon > homeSetsWon) winner = 'away';
    else winner = 'tie';
  }

  // The score's font size is now derived per-panel from a measured
  // onLayout inside <TeamPanel>. We used to compute it here from
  // useWindowDimensions and pass it down, but `adjustsFontSizeToFit`
  // + numberOfLines={1} + lineHeight > fontSize on Android is a known
  // failure mode that shrinks all-digit text to ~0pt — that was the
  // "score doesn't show in landscape" bug. Direct measurement +
  // explicit fontSize is deterministic and avoids the auto-fit
  // pathology.

  // ── Actions ────────────────────────────────────────────────────────────
  const addPoint = useCallback(
    (team: 'home' | 'away') => {
      if (matchComplete) return;
      const snapshot: UndoSnapshot = {
        homePts,
        awayPts,
        setHistory: [...setHistory],
        server,
        homeTimeouts,
        awayTimeouts,
      };
      setUndoStack((u) => [...u.slice(-99), snapshot]);
      const newHome = team === 'home' ? homePts + 1 : homePts;
      const newAway = team === 'away' ? awayPts + 1 : awayPts;
      const winsSet =
        (newHome >= cap && newHome - newAway >= 2) ||
        (newAway >= cap && newAway - newHome >= 2);
      if (winsSet) {
        setSetHistory((h) => [...h, { home: newHome, away: newAway }]);
        setHomePts(0);
        setAwayPts(0);
        // Reset timeouts at end of set per OVA rules.
        setHomeTimeouts(0);
        setAwayTimeouts(0);
      } else {
        setHomePts(newHome);
        setAwayPts(newAway);
      }
      // Rally scoring: server is whoever just won the point.
      setServer(team);
    },
    [
      matchComplete,
      homePts,
      awayPts,
      setHistory,
      cap,
      server,
      homeTimeouts,
      awayTimeouts,
    ]
  );

  const undo = useCallback(() => {
    setUndoStack((u) => {
      if (u.length === 0) return u;
      const last = u[u.length - 1];
      setHomePts(last.homePts);
      setAwayPts(last.awayPts);
      setSetHistory(last.setHistory);
      setServer(last.server);
      setHomeTimeouts(last.homeTimeouts);
      setAwayTimeouts(last.awayTimeouts);
      return u.slice(0, -1);
    });
  }, []);

  const reset = useCallback(() => {
    Alert.alert(
      'Start a new match?',
      'This clears the current scores, set history, server and timeouts. Team names, colours and settings stay the same.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'New match',
          style: 'destructive',
          onPress: () => {
            setSetHistory([]);
            setHomePts(0);
            setAwayPts(0);
            setServer(null);
            setHomeTimeouts(0);
            setAwayTimeouts(0);
            setUndoStack([]);
            setTimeoutFor(null);
          },
        },
      ]
    );
  }, []);

  const startEdit = useCallback(
    (team: 'home' | 'away') => {
      setEditTarget(team);
      setEditText(team === 'home' ? homeName : awayName);
    },
    [homeName, awayName]
  );

  const saveEdit = useCallback(() => {
    if (!editTarget) return;
    const trimmed = editText.trim();
    const fallback = editTarget === 'home' ? 'Home' : 'Away';
    if (editTarget === 'home') setHomeName(trimmed || fallback);
    else setAwayName(trimmed || fallback);
    setEditTarget(null);
  }, [editTarget, editText]);

  const swapSides = useCallback(() => {
    setHomeName(awayName);
    setAwayName(homeName);
    setHomeColor(awayColor);
    setAwayColor(homeColor);
    setHomePts(awayPts);
    setAwayPts(homePts);
    setSetHistory((h) => h.map((s) => ({ home: s.away, away: s.home })));
    setServer((s) => (s === 'home' ? 'away' : s === 'away' ? 'home' : null));
    setHomeTimeouts(awayTimeouts);
    setAwayTimeouts(homeTimeouts);
    setUndoStack([]);
  }, [
    homeName,
    awayName,
    homeColor,
    awayColor,
    homePts,
    awayPts,
    homeTimeouts,
    awayTimeouts,
  ]);

  const callTimeout = useCallback((team: 'home' | 'away') => {
    if (team === 'home') setHomeTimeouts((t) => t + 1);
    else setAwayTimeouts((t) => t + 1);
    setTimeoutFor(team);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <View
        style={[
          styles.topBar,
          isLandscape && styles.topBarLandscape,
        ]}
      >
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backBtn}>{'< Back'}</Text>
        </TouchableOpacity>
        {!isLandscape && <Text style={styles.title} accessibilityRole="header">SCOREBOARD</Text>}
        {/* Reset has moved into Settings to avoid both colliding with the
            global hamburger overlay AND being a one-tap destructive
            action. The gear is the entry point now; settings modal
            exposes "Reset Match" at the bottom. */}
        <TouchableOpacity
          onPress={() => setSettingsOpen(true)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Scoreboard settings"
        >
          <Text style={styles.gearBtn}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* In portrait, show the format + swap/undo strip. In landscape we
          collapse this to keep every spare pixel for the score number;
          the Settings gear still exposes everything. Swap and Undo move
          to a tiny floating row anchored bottom-left so the user can
          still reach them without sacrificing the score real estate. */}
      {!isLandscape && (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryFormat} numberOfLines={1}>
            {sport === 'beach' ? '🏖 Beach · ' : '🏐 Indoor · '}
            {numSets === 1 ? '1 set' : `Best of ${numSets}`} · {regularSetTarget}
            {isOddSets ? ` (${decidingSetTarget} deciding)` : ''}
          </Text>
          <View style={styles.summaryActions}>
            <TouchableOpacity
              onPress={swapSides}
              style={styles.smallBtn}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.smallBtnText}>⇄ Swap</Text>
            </TouchableOpacity>
            {undoStack.length > 0 && !matchComplete && (
              <TouchableOpacity
                onPress={undo}
                style={styles.smallBtn}
                activeOpacity={0.7}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Text style={styles.smallBtnText}>↶ Undo</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {!isLandscape && setHistory.length > 0 && (
        <Text style={styles.pastSetsLine} numberOfLines={1}>
          {setHistory
            .map((s, i) => `S${i + 1} ${s.home}–${s.away}`)
            .join('  ·  ')}
        </Text>
      )}

      <View style={styles.boardRow}>
        <TeamPanel
          name={homeName}
          setsWon={homeSetsWon}
          points={homePts}
          color={homeColor}
          isServing={server === 'home'}
          timeouts={homeTimeouts}
          isWinner={winner === 'home'}
          disabled={matchComplete}
          isLandscape={isLandscape}
          onTap={() => addPoint('home')}
          onEditName={() => startEdit('home')}
          onPickColor={() => setColorTarget('home')}
          onToggleServer={() => setServer('home')}
          onTimeout={() => callTimeout('home')}
        />
        <View style={styles.separator} />
        <TeamPanel
          name={awayName}
          setsWon={awaySetsWon}
          points={awayPts}
          color={awayColor}
          isServing={server === 'away'}
          timeouts={awayTimeouts}
          isWinner={winner === 'away'}
          disabled={matchComplete}
          isLandscape={isLandscape}
          onTap={() => addPoint('away')}
          onEditName={() => startEdit('away')}
          onPickColor={() => setColorTarget('away')}
          onToggleServer={() => setServer('away')}
          onTimeout={() => callTimeout('away')}
        />
      </View>

      {/* Win-probability indicator — sits between the score panels and the
          bottom bar. Renders only once a server has been chosen (the
          asymmetric serve-advantage model needs that input) and only
          while the match is live (frozen at 100/0 between sets). */}
      {server != null ? (
        <WinProbabilityBar
          homeScore={homePts}
          awayScore={awayPts}
          target={cap}
          server={server}
          setsWonHome={homeSetsWon}
          setsWonAway={awaySetsWon}
          setsToWin={setsToWin}
          homeColor={homeColor}
          awayColor={awayColor}
          setEnded={matchComplete}
          setWinner={winner === 'home' || winner === 'away' ? winner : null}
          compact
        />
      ) : null}

      {/* Floating Swap / Undo for landscape — fixed bottom-left so they
          don't compete with the score numbers. Hidden in portrait
          because the summary row already exposes them. */}
      {isLandscape && (
        <View style={styles.landscapeFloatingActions} pointerEvents="box-none">
          <TouchableOpacity
            onPress={swapSides}
            style={styles.smallBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Text style={styles.smallBtnText}>⇄</Text>
          </TouchableOpacity>
          {undoStack.length > 0 && !matchComplete && (
            <TouchableOpacity
              onPress={undo}
              style={styles.smallBtn}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.smallBtnText}>↶</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <View style={[styles.bottomBar, isLandscape && styles.bottomBarLandscape]}>
        <Text
          style={[styles.bottomText, isLandscape && styles.bottomTextLandscape]}
          numberOfLines={1}
        >
          {matchComplete
            ? winner === 'tie'
              ? `Match · Tied ${homeSetsWon}–${awaySetsWon}`
              : `Match · ${winner === 'home' ? homeName : awayName} wins ${homeSetsWon}–${awaySetsWon}`
            : `Set ${currentSetNumber}${isDecidingSet ? ' (deciding)' : ''} · first to ${cap}`}
        </Text>
      </View>

      {/* Timeout overlay — covers the screen for 30 s with the team
          name and a giant TIMEOUT word. Tap dismisses early. */}
      {timeoutFor && (
        <TouchableOpacity
          style={[
            styles.timeoutOverlay,
            { backgroundColor: timeoutFor === 'home' ? homeColor : awayColor },
          ]}
          activeOpacity={0.95}
          onPress={() => setTimeoutFor(null)}
        >
          <Text style={styles.timeoutOverlayLabel}>TIMEOUT</Text>
          <Text style={styles.timeoutOverlayTeam} numberOfLines={2}>
            {timeoutFor === 'home' ? homeName : awayName}
          </Text>
          <Text style={styles.timeoutOverlayHint}>tap to dismiss</Text>
        </TouchableOpacity>
      )}

      {/* Edit name + colour modal — combined in one workflow so users
          who want to "set up the home team" can pick name and jersey
          colour in a single dialog. */}
      <Modal
        visible={!!editTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setEditTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {editTarget === 'home' ? 'Home team' : 'Away team'}
            </Text>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.modalInput}
              value={editText}
              onChangeText={setEditText}
              autoFocus
              selectTextOnFocus
              maxLength={40}
              returnKeyType="done"
              onSubmitEditing={saveEdit}
            />
            <Text style={styles.fieldLabel}>Colour</Text>
            <View style={styles.colorGrid}>
              {COLOR_PALETTE.map((c) => {
                const current =
                  editTarget === 'home' ? homeColor : awayColor;
                const selected = current === c;
                return (
                  <TouchableOpacity
                    key={c}
                    style={[
                      styles.colorTile,
                      { backgroundColor: c },
                      selected && styles.colorTileSelected,
                    ]}
                    onPress={() => {
                      if (editTarget === 'home') setHomeColor(c);
                      else if (editTarget === 'away') setAwayColor(c);
                    }}
                    activeOpacity={0.7}
                  >
                    {selected ? (
                      <Text style={styles.colorTileCheck}>✓</Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                onPress={() => setEditTarget(null)}
                style={[styles.modalBtn, styles.modalBtnCancel]}
                activeOpacity={0.7}
              >
                <Text style={styles.modalBtnTextCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={saveEdit}
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                activeOpacity={0.7}
              >
                <Text style={styles.modalBtnTextPrimary}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Color picker modal */}
      <ColorPickerModal
        visible={!!colorTarget}
        team={colorTarget}
        onClose={() => setColorTarget(null)}
        onPick={(c) => {
          if (colorTarget === 'home') setHomeColor(c);
          else if (colorTarget === 'away') setAwayColor(c);
          setColorTarget(null);
        }}
      />

      {/* Settings modal — sets-count is changeable mid-match. The
          derived `matchComplete` and `winner` recompute from the new
          numSets against the existing setHistory, so completed sets
          are preserved and a new winner is calculated under the new
          format. */}
      <SettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        sport={sport}
        numSets={numSets}
        regularSetTarget={regularSetTarget}
        decidingSetTarget={decidingSetTarget}
        completedSetsCount={setHistory.length}
        hasInProgressScore={homePts > 0 || awayPts > 0}
        onCommit={(next) => {
          setSport(next.sport);
          setNumSets(next.numSets);
          setRegularSetTarget(next.regularSetTarget);
          setDecidingSetTarget(next.decidingSetTarget);
        }}
        onResetMatch={() => {
          setSettingsOpen(false);
          reset();
        }}
      />
    </View>
  );
}

function TeamPanel({
  name,
  setsWon,
  points,
  color,
  isServing,
  timeouts,
  isWinner,
  disabled,
  isLandscape,
  onTap,
  onEditName,
  onPickColor,
  onToggleServer,
  onTimeout,
}: {
  name: string;
  setsWon: number;
  points: number;
  color: string;
  isServing: boolean;
  timeouts: number;
  isWinner: boolean;
  disabled: boolean;
  isLandscape: boolean;
  onTap: () => void;
  onEditName: () => void;
  onPickColor: () => void;
  onToggleServer: () => void;
  onTimeout: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Measure the actual rendered points slot so we can write an exact
  // fontSize that fills it. This replaces the old auto-fit + computed-
  // estimate combo that was shrinking digits to ~1pt on Android.
  const [slot, setSlot] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const handleSlotLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      // Tolerance prevents an onLayout → setState → re-render → onLayout
      // loop when the only change is sub-pixel rounding.
      if (
        Math.abs(width - slot.w) > 1 ||
        Math.abs(height - slot.h) > 1
      ) {
        if (__DEV__) {
          // Surface measured slot dimensions in Metro so we can verify
          // the score is being given a real chunk of screen real estate.
          // Strip this log once the layout is stable in production.
          // eslint-disable-next-line no-console
          console.log(
            `[Scoreboard] ${name} pointsWrap layout`,
            { width: Math.round(width), height: Math.round(height) }
          );
        }
        setSlot({ w: width, h: height });
      }
    },
    [slot.w, slot.h, name]
  );
  // 0.92 of measured height is aggressive (we want the digit to fill
  // the cell) — slight breathing room only. Width factor is generous
  // for 2 digits, tightens automatically if score reaches 3 digits
  // because the Text would overflow horizontally so we cap by width.
  // The capital-height of a digit at fontSize F is ~0.7F, so
  // numberOfLines={1} at this fontSize reliably fits the height.
  const pointsFontSize = useMemo(() => {
    if (slot.h < 24 || slot.w < 24) return 80; // pre-layout fallback
    const fromH = slot.h * 0.92;
    // 2-digit allowance: each digit ≈ 0.55 × fontSize wide, so two
    // digits fit when fontSize ≤ width / (0.55 × 2) = width × 0.91.
    // We use 0.7 as a safer bound that still leaves room for "100".
    const fromW = slot.w * 0.7;
    const f = Math.max(60, Math.floor(Math.min(fromH, fromW)));
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(
        `[Scoreboard] ${name} pointsFontSize=${f} (fromH=${Math.floor(fromH)}, fromW=${Math.floor(fromW)})`
      );
    }
    return f;
  }, [slot, name]);
  // Landscape layout — chrome is moved to corners so the score number
  // dominates the screen for "hold up across the gym" use.
  if (isLandscape) {
    return (
      <TouchableOpacity
        style={[
          styles.panel,
          styles.panelLandscape,
          isWinner && styles.panelWinner,
          { borderTopColor: color },
        ]}
        onPress={onTap}
        disabled={disabled}
        activeOpacity={disabled ? 1 : 0.85}
        accessibilityRole="button"
        accessibilityLabel={`${name}: ${points} points, ${setsWon} sets. Tap to add a point.`}
        accessibilityHint="Double tap to add a point for this team"
      >
        {/* Top strip: name + colour swatch + sets-won chip */}
        <View style={styles.landscapeTopStrip}>
          <TouchableOpacity
            onPress={onPickColor}
            style={[styles.colorSwatchLg, { backgroundColor: color }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Change ${name} colour`}
          />
          <TouchableOpacity
            onPress={onEditName}
            style={styles.landscapeNamePressable}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityRole="button"
            accessibilityLabel={`Edit team name (currently ${name})`}
          >
            <Text
              style={styles.landscapeTeamName}
              numberOfLines={1}
            >
              {name}
            </Text>
          </TouchableOpacity>
          <View style={styles.landscapeSetsChip}>
            <Text style={styles.landscapeSetsChipText}>Sets {setsWon}</Text>
          </View>
        </View>

        {/* Massive score number — fills the rest of the panel.
            Direct fontSize from the measured slot; no adjustsFontSizeToFit
            (Android shrinks all-digit content to ~0pt under it). */}
        <View style={styles.pointsWrap} onLayout={handleSlotLayout}>
          <Text
            style={[styles.points, { color, fontSize: pointsFontSize }]}
            numberOfLines={1}
          >
            {points}
          </Text>
        </View>

        {/* Bottom corner: server pill (left) + timeout (right) */}
        <View style={styles.landscapeBottomStrip}>
          <TouchableOpacity
            onPress={onToggleServer}
            style={[
              styles.landscapeServerPill,
              isServing && { backgroundColor: color },
            ]}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Text
              style={[
                styles.serverPillText,
                isServing && styles.serverPillTextActive,
              ]}
              numberOfLines={1}
            >
              🏐 {isServing ? 'Serving' : 'Serve'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onTimeout}
            style={styles.landscapeTimeoutBtn}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            disabled={disabled}
          >
            <Text style={styles.landscapeTimeoutText} numberOfLines={1}>
              ⏱ {timeouts}
            </Text>
          </TouchableOpacity>
        </View>

        {isWinner && (
          <Text style={styles.landscapeWinnerBadge}>WINNER</Text>
        )}
      </TouchableOpacity>
    );
  }

  // Portrait layout — original chrome stack.
  return (
    <TouchableOpacity
      style={[styles.panel, isWinner && styles.panelWinner, { borderTopColor: color }]}
      onPress={onTap}
      disabled={disabled}
      activeOpacity={disabled ? 1 : 0.85}
      accessibilityRole="button"
      accessibilityLabel={`${name}: ${points} points, ${setsWon} sets. Tap to add a point.`}
      accessibilityHint="Double tap to add a point for this team"
    >
      <View style={styles.panelHeaderRow}>
        <TouchableOpacity
          onPress={onPickColor}
          style={[styles.colorSwatchLg, { backgroundColor: color }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Change ${name} colour`}
        >
          <Text style={styles.colorSwatchHint}>tap</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onEditName}
          style={styles.namePressable}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Edit team name (currently ${name})`}
        >
          <Text style={styles.teamName} numberOfLines={2}>
            {name}
          </Text>
          <Text style={styles.editHint}>tap name to edit · tap colour to recolour</Text>
        </TouchableOpacity>
      </View>

      {/* Server indicator — tap to set, otherwise auto-flips on point */}
      <TouchableOpacity
        onPress={onToggleServer}
        style={[styles.serverPill, isServing && { backgroundColor: color }]}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityRole="button"
        accessibilityLabel={isServing ? `${name} is serving` : `Set ${name} as the serving team`}
        accessibilityState={{ selected: isServing }}
      >
        <Text
          style={[
            styles.serverPillText,
            isServing && styles.serverPillTextActive,
          ]}
        >
          🏐 {isServing ? 'Serving' : 'Tap to serve'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.setsWon}>Sets: {setsWon}</Text>

      <View style={styles.pointsWrap} onLayout={handleSlotLayout}>
        <Text
          style={[styles.points, { color, fontSize: pointsFontSize }]}
          numberOfLines={1}
        >
          {points}
        </Text>
      </View>

      {!disabled && <Text style={styles.tapHint}>Tap anywhere to score</Text>}
      {isWinner && <Text style={styles.winnerBadge}>WINNER</Text>}

      {/* Timeout button + counter */}
      <TouchableOpacity
        onPress={onTimeout}
        style={styles.timeoutBtn}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Call timeout for ${name} (${timeouts} so far)`}
      >
        <Text style={styles.timeoutBtnText}>⏱ Timeout · {timeouts}</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ── Color picker ──────────────────────────────────────────────────────────

function ColorPickerModal({
  visible,
  team,
  onClose,
  onPick,
}: {
  visible: boolean;
  team: 'home' | 'away' | null;
  onClose: () => void;
  onPick: (color: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>
            {team === 'home' ? 'Home colour' : 'Away colour'}
          </Text>
          <View style={styles.colorGrid}>
            {COLOR_PALETTE.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.colorTile, { backgroundColor: c }]}
                onPress={() => onPick(c)}
                activeOpacity={0.7}
              />
            ))}
          </View>
          <View style={styles.modalButtonsRow}>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.modalBtn, styles.modalBtnCancel]}
              activeOpacity={0.7}
            >
              <Text style={styles.modalBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Settings modal ────────────────────────────────────────────────────────

function SettingsModal({
  visible,
  onClose,
  sport,
  numSets,
  regularSetTarget,
  decidingSetTarget,
  completedSetsCount,
  hasInProgressScore,
  onCommit,
  onResetMatch,
}: {
  visible: boolean;
  onClose: () => void;
  sport: Sport;
  numSets: number;
  regularSetTarget: number;
  decidingSetTarget: number;
  completedSetsCount: number;
  hasInProgressScore: boolean;
  onCommit: (next: {
    sport: Sport;
    numSets: number;
    regularSetTarget: number;
    decidingSetTarget: number;
  }) => void;
  onResetMatch: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [draftSport, setDraftSport] = useState<Sport>(sport);
  const [draftSets, setDraftSets] = useState(numSets);
  const [draftRegular, setDraftRegular] = useState(String(regularSetTarget));
  const [draftDeciding, setDraftDeciding] = useState(String(decidingSetTarget));

  useEffect(() => {
    if (visible) {
      setDraftSport(sport);
      setDraftSets(numSets);
      setDraftRegular(String(regularSetTarget));
      setDraftDeciding(String(decidingSetTarget));
    }
  }, [visible, sport, numSets, regularSetTarget, decidingSetTarget]);

  const isOdd = draftSets % 2 === 1;

  // Switching sport pre-fills the targets to that sport's defaults so the
  // user doesn't have to remember 25/15 vs 21/15.
  const handleSportChange = (s: Sport) => {
    setDraftSport(s);
    setDraftRegular(String(SPORT_DEFAULTS[s].regular));
    setDraftDeciding(String(SPORT_DEFAULTS[s].deciding));
  };

  const handleSave = () => {
    const reg = parseInt(draftRegular, 10);
    const dec = parseInt(draftDeciding, 10);
    onCommit({
      sport: draftSport,
      numSets: draftSets,
      regularSetTarget: isFinite(reg) && reg > 0 ? reg : regularSetTarget,
      decidingSetTarget: isFinite(dec) && dec > 0 ? dec : decidingSetTarget,
    });
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { maxWidth: 480 }]}>
          <Text style={styles.modalTitle}>Match Settings</Text>

          <Text style={styles.fieldLabel}>Sport</Text>
          <View style={styles.sportRow}>
            {(['indoor', 'beach'] as Sport[]).map((s) => {
              const active = draftSport === s;
              return (
                <TouchableOpacity
                  key={s}
                  style={[
                    styles.sportPill,
                    active && styles.sportPillActive,
                  ]}
                  onPress={() => handleSportChange(s)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.sportPillText,
                      active && styles.sportPillTextActive,
                    ]}
                  >
                    {s === 'indoor' ? '🏐 Indoor' : '🏖 Beach'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.fieldLabel}>Number of sets</Text>
          <View style={styles.setsPickerRow}>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => {
              const selected = draftSets === n;
              return (
                <TouchableOpacity
                  key={n}
                  style={[
                    styles.setsPickerPill,
                    selected && styles.setsPickerPillActive,
                  ]}
                  onPress={() => setDraftSets(n)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.setsPickerPillText,
                      selected && styles.setsPickerPillTextActive,
                    ]}
                  >
                    {n}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {(completedSetsCount > 0 || hasInProgressScore) &&
            draftSets !== numSets && (
              <Text style={styles.fieldHint}>
                This match already has {completedSetsCount} completed
                {completedSetsCount === 1 ? ' set' : ' sets'}
                {hasInProgressScore ? ' plus a set in progress' : ''}.
                They'll stay in the history; the winner is recalculated
                under the new format.
              </Text>
            )}
          <Text style={styles.fieldHint}>
            {isOdd
              ? `Race to ${Math.ceil(draftSets / 2)} — ${draftSets === 1 ? 'one set match' : `last set is the deciding set if tied at ${Math.ceil(draftSets / 2) - 1}-${Math.ceil(draftSets / 2) - 1}`}`
              : `Play all ${draftSets} sets — ${draftSets / 2}-${draftSets / 2} is a tie`}
          </Text>

          <Text style={styles.fieldLabel}>Regular set target</Text>
          <TextInput
            style={styles.numericInput}
            value={draftRegular}
            onChangeText={setDraftRegular}
            keyboardType="number-pad"
            maxLength={3}
            selectTextOnFocus
          />

          {isOdd && (
            <>
              <Text style={styles.fieldLabel}>Deciding set target</Text>
              <TextInput
                style={styles.numericInput}
                value={draftDeciding}
                onChangeText={setDraftDeciding}
                keyboardType="number-pad"
                maxLength={3}
                selectTextOnFocus
              />
              <Text style={styles.fieldHint}>
                Used only when the match goes the distance.
              </Text>
            </>
          )}

          {/* Destructive action — separated by a divider so it doesn't
              read as a "primary" choice. Reset moved here from the top
              bar so it can't be hit by accident and so the top bar
              doesn't collide with the global hamburger overlay. */}
          <View style={styles.settingsDivider} />
          <TouchableOpacity
            onPress={onResetMatch}
            style={styles.resetMatchBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.resetMatchBtnText}>Reset Match</Text>
          </TouchableOpacity>

          <View style={styles.modalButtonsRow}>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.modalBtn, styles.modalBtnCancel]}
              activeOpacity={0.7}
            >
              <Text style={styles.modalBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              style={[styles.modalBtn, styles.modalBtnPrimary]}
              activeOpacity={0.7}
            >
              <Text style={styles.modalBtnTextPrimary}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Theme-aware stylesheet factory. Each function-component above calls
// `useMemo(() => makeStyles(colors), [colors])` so the stylesheet is
// recreated only when the theme palette changes (light → dark toggle),
// which is the whole point of the dark-mode refactor — `colors.X` lookups
// happen at this factory's call time, not at module load.
function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.lg,
    // Right padding clears the absolute-positioned hamburger overlay
    // (right: 8, ~40pt wide) so the gear icon is always tappable.
    paddingRight: 64,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  topBarLandscape: {
    paddingTop: spacing.sm,
    paddingBottom: 4,
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backBtn: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '800',
    letterSpacing: 1,
  },
  gearBtn: { color: colors.text, fontSize: 22 },
  resetBtn: {
    color: colors.error,
    fontSize: fontSize.md,
    fontWeight: '600',
  },

  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: 4,
  },
  summaryFormat: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '600',
    flex: 1,
  },
  summaryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  smallBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  smallBtnText: {
    color: colors.primary,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },

  pastSetsLine: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 4,
    color: colors.textLight,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },

  boardRow: { flex: 1, flexDirection: 'row' },
  separator: { width: 1, backgroundColor: colors.border },
  panel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 6,
  },
  panelWinner: { backgroundColor: colors.primaryLight },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  colorSwatch: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.15)',
  },
  // Larger, more discoverable swatch with a "tap" hint underneath.
  colorSwatchLg: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorSwatchHint: {
    color: '#ffffff',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.3,
    opacity: 0.85,
  },
  namePressable: { alignItems: 'center', flexShrink: 1 },
  teamName: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
  },
  editHint: { color: colors.textLight, fontSize: 11, marginTop: 2 },

  serverPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 4,
    marginBottom: 4,
  },
  serverPillText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  serverPillTextActive: { color: '#ffffff' },

  setsWon: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: '700',
    marginTop: 2,
    marginBottom: 4,
  },
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
  tapHint: {
    color: colors.textLight,
    fontSize: fontSize.xs,
    marginTop: 4,
    fontStyle: 'italic',
  },
  winnerBadge: {
    color: colors.success,
    fontSize: fontSize.lg,
    fontWeight: '900',
    marginTop: 4,
    letterSpacing: 1,
  },

  timeoutBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 6,
  },
  timeoutBtnText: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },

  bottomBar: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    alignItems: 'center',
  },
  bottomBarLandscape: {
    paddingVertical: 4,
  },
  bottomText: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  bottomTextLandscape: {
    fontSize: fontSize.xs,
  },

  // ── Landscape-specific layout ──────────────────────────────────────
  panelLandscape: {
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderTopWidth: 4,
  },
  landscapeTopStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingTop: 2,
    gap: 6,
  },
  landscapeNamePressable: { flex: 1, alignItems: 'flex-start' },
  landscapeTeamName: {
    fontSize: fontSize.md,
    fontWeight: '800',
    color: colors.text,
  },
  landscapeSetsChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.primaryLight,
  },
  landscapeSetsChipText: {
    color: colors.primary,
    fontSize: fontSize.xs,
    fontWeight: '800',
  },
  landscapeBottomStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 2,
    gap: 6,
  },
  landscapeServerPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  landscapeTimeoutBtn: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  landscapeTimeoutText: {
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  landscapeWinnerBadge: {
    position: 'absolute',
    top: 2,
    right: 4,
    color: colors.success,
    fontSize: fontSize.sm,
    fontWeight: '900',
    letterSpacing: 1,
  },
  landscapeFloatingActions: {
    // Anchored bottom-left so they're reachable in landscape without
    // covering the score numbers. `bottom: 50` clears the slim landscape
    // bottomBar (~22px) plus the compact WinProbabilityBar (~20px) that
    // sits just above it — at `bottom: 30` the buttons sat on top of
    // the win-probability indicator.
    position: 'absolute',
    left: 8,
    bottom: 50,
    flexDirection: 'row',
    gap: 6,
    zIndex: 50,
  },

  // Timeout overlay (full-screen)
  timeoutOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
  },
  timeoutOverlayLabel: {
    color: '#ffffff',
    fontSize: 80,
    fontWeight: '900',
    letterSpacing: 3,
  },
  timeoutOverlayTeam: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '800',
    marginTop: spacing.md,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  timeoutOverlayHint: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginTop: spacing.xxxl,
    fontStyle: 'italic',
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: fontSize.lg,
    color: colors.text,
    backgroundColor: colors.background,
  },
  modalButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  modalBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    minWidth: 90,
    alignItems: 'center',
  },
  modalBtnCancel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalBtnPrimary: { backgroundColor: colors.primary },
  modalBtnTextCancel: { color: colors.text, fontWeight: '700' },
  modalBtnTextPrimary: { color: colors.textOnPrimary, fontWeight: '700' },

  fieldLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginTop: spacing.md,
    marginBottom: 4,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  fieldHint: {
    color: colors.textLight,
    fontSize: fontSize.xs,
    marginTop: 4,
    lineHeight: 16,
  },
  sportRow: { flexDirection: 'row', gap: spacing.sm },
  sportPill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sportPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  sportPillText: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  sportPillTextActive: { color: colors.textOnPrimary },

  setsPickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  setsPickerPill: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setsPickerPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  setsPickerPillDisabled: { opacity: 0.4 },
  setsPickerPillText: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '800',
  },
  setsPickerPillTextActive: { color: colors.textOnPrimary },
  numericInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    fontSize: fontSize.lg,
    color: colors.text,
    backgroundColor: colors.background,
    width: 100,
    textAlign: 'center',
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  colorTile: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.md,
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorTileSelected: {
    borderWidth: 4,
    borderColor: colors.text,
  },
  colorTileCheck: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowRadius: 2,
  },

  settingsDivider: {
    height: 1,
    backgroundColor: colors.divider,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  resetMatchBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.error,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  resetMatchBtnText: {
    color: colors.error,
    fontWeight: '800',
    fontSize: fontSize.md,
  },
  });
}
