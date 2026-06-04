// ── MatchSetupScreen ───────────────────────────────────────────────────────
//
// Tier 2 Session B entry point. Captures the minimum metadata + rosters
// + starting lineups needed to begin scoring. No tournament-import
// in this session (paste-based AES/Timu pre-fill comes Session D);
// everything is typed in directly. Roster persistence to TeamProfile
// also lives in Session D — for now the roster is captured per-match
// (stored on `Match.rosters`).
//
// Layout: a single scroll, sectioned. Match Info → Coin Toss → Home
// Team → Away Team → Start Match. Validation runs on Start Match;
// any blocking issues open an Alert with the list of problems.
// ────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  useTheme,
  spacing,
  fontSize,
  borderRadius,
} from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type {
  Match,
  MatchMeta,
  RosterPlayer,
  Side,
  Lineup,
  Position,
} from '../types/match';
import type { TeamProfile } from '../types/profile';
import {
  createMatch,
  appendEvent,
  makeEventId,
} from '../utils/matchEngine';
import { getCurrentTenantId } from '../utils/tenant';

interface DraftRosterPlayer {
  shirt: string;
  name: string;
  isLibero: boolean;
}

interface DraftTeam {
  label: string;
  colorHex: string;
  liberoMayServe: boolean;
  roster: DraftRosterPlayer[];
  /** Six shirt strings in positions I..VI. Empty string = unfilled. */
  positions: string[];
  /** 1 or 2 libero shirts. */
  liberos: string[];
  /** Optional: "I want libero to serve from this position" — string for input. */
  serveLiberoFromPosition: string;
}

const COLOR_PALETTE = [
  '#1a73e8',
  '#ff6b35',
  '#ea4335',
  '#34a853',
  '#9c27b0',
  '#00acc1',
  '#e91e63',
  '#fbbc04',
  '#3f51b5',
  '#1a1a1a',
];

function emptyDraftTeam(label: string, color: string): DraftTeam {
  return {
    label,
    colorHex: color,
    liberoMayServe: false,
    roster: [],
    positions: ['', '', '', '', '', ''],
    liberos: [''],
    serveLiberoFromPosition: '',
  };
}

interface Props {
  onCancel: () => void;
  /** Called with the freshly-saved match (status: 'in-progress') when
   *  the user taps "Start Match" and validation passes. The caller is
   *  expected to navigate to MatchScoring with this match. */
  onStart: (match: Match) => void;
  /**
   * The user's active TeamProfile, when one exists. Used to pre-fill the
   * Home team's label and surface a roster picker so the scorer doesn't
   * have to retype every shirt # they've already entered for their own
   * team. Away team is always manual entry in v1 (no opponent rosters).
   * The picker is a hint, not a constraint — users can still type any
   * shirt # not in the roster, and ad-hoc shirts are NOT written back to
   * the persistent TeamProfile (this match only).
   */
  homeTeamProfile?: TeamProfile | null;
  /** Tap the inline "Add players to your team" link → open roster editor. */
  onOpenRosterEditor?: (team: TeamProfile) => void;
}

export function MatchSetupScreen({
  onCancel,
  onStart,
  homeTeamProfile = null,
  onOpenRosterEditor,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // ── Match Info ──────────────────────────────────────────────────────────
  const [eventName, setEventName] = useState('');
  const [division, setDivision] = useState('');
  const [matchLabel, setMatchLabel] = useState('');
  const [courtName, setCourtName] = useState('');
  const [bestOf, setBestOf] = useState<3 | 5>(3);
  const [sport, setSport] = useState<'indoor' | 'beach'>('indoor');
  // Regular-set target. Indoor volleyball plays to 25, beach to 21.
  // Track whether the user has manually edited the field so we can keep
  // auto-syncing the default on sport toggles ONLY when they haven't
  // expressed a custom intent — otherwise switching sports would silently
  // discard a value the user actually wanted (e.g. tournament-specific
  // formats like 30-point sets).
  const [regularTarget, setRegularTarget] = useState('25');
  const [regularTargetEdited, setRegularTargetEdited] = useState(false);
  const [deciderTarget, setDeciderTarget] = useState('15');
  const [subRule, setSubRule] = useState<'vc' | 'fivb'>('vc');

  // ── Coin toss ───────────────────────────────────────────────────────────
  const [tossServe, setTossServe] = useState<Side>('home');
  const [tossSide, setTossSide] = useState<'home-left' | 'home-right'>('home-left');

  // ── Teams ───────────────────────────────────────────────────────────────
  const [home, setHome] = useState<DraftTeam>(() => {
    const base = emptyDraftTeam('Home', COLOR_PALETTE[0]);
    if (homeTeamProfile?.label) base.label = homeTeamProfile.label;
    return base;
  });
  const [away, setAway] = useState<DraftTeam>(
    emptyDraftTeam('Away', COLOR_PALETTE[1])
  );

  // Active players from the user's TeamProfile, if any. Used to surface
  // a roster picker on the Home team's player section so common shirts
  // can be added with one tap rather than retyped every match.
  const homeRosterHints = useMemo<RosterPlayer[]>(() => {
    if (!homeTeamProfile?.roster) return [];
    return homeTeamProfile.roster.filter((p) => p.active);
  }, [homeTeamProfile]);

  const [colorTarget, setColorTarget] = useState<Side | null>(null);

  // ── Mutators ────────────────────────────────────────────────────────────
  function patchTeam(side: Side, patch: Partial<DraftTeam>) {
    if (side === 'home') setHome((t) => ({ ...t, ...patch }));
    else setAway((t) => ({ ...t, ...patch }));
  }

  function addRosterPlayer(side: Side) {
    const t = side === 'home' ? home : away;
    patchTeam(side, {
      roster: [...t.roster, { shirt: '', name: '', isLibero: false }],
    });
  }
  /**
   * Add a roster row pre-filled from a TeamProfile hint. No-op if the
   * shirt is already in the home draft (we don't want one tap to silently
   * duplicate). The hint is a snapshot — this match's roster is decoupled
   * from the persistent TeamProfile, so subsequent edits in either place
   * don't echo back.
   */
  function addRosterPlayerFromHint(hint: RosterPlayer) {
    setHome((t) => {
      const shirtStr = String(hint.shirt);
      const exists = t.roster.some((p) => p.shirt.trim() === shirtStr);
      if (exists) return t;
      return {
        ...t,
        roster: [
          ...t.roster,
          {
            shirt: shirtStr,
            name: hint.name,
            isLibero: hint.isLibero,
          },
        ],
      };
    });
  }
  function removeRosterPlayer(side: Side, index: number) {
    const t = side === 'home' ? home : away;
    const next = t.roster.slice();
    next.splice(index, 1);
    patchTeam(side, { roster: next });
  }
  function updateRosterPlayer(
    side: Side,
    index: number,
    patch: Partial<DraftRosterPlayer>
  ) {
    const t = side === 'home' ? home : away;
    const next = t.roster.slice();
    next[index] = { ...next[index], ...patch };
    patchTeam(side, { roster: next });
  }

  function setPositionShirt(side: Side, posIndex: number, shirt: string) {
    const t = side === 'home' ? home : away;
    const next = t.positions.slice();
    next[posIndex] = shirt;
    patchTeam(side, { positions: next });
  }

  function setLiberoShirt(side: Side, libIndex: number, shirt: string) {
    const t = side === 'home' ? home : away;
    const next = t.liberos.slice();
    next[libIndex] = shirt;
    patchTeam(side, { liberos: next });
  }
  function addLiberoSlot(side: Side) {
    const t = side === 'home' ? home : away;
    if (t.liberos.length >= 2) return;
    patchTeam(side, { liberos: [...t.liberos, ''] });
  }
  function removeLiberoSlot(side: Side, libIndex: number) {
    const t = side === 'home' ? home : away;
    if (t.liberos.length <= 1) return;
    const next = t.liberos.slice();
    next.splice(libIndex, 1);
    patchTeam(side, { liberos: next });
  }

  // ── Validate + start ────────────────────────────────────────────────────
  function buildAndStart() {
    const errors: string[] = [];
    if (!eventName.trim()) errors.push('Event name is required.');
    if (!division.trim()) errors.push('Division is required.');
    const reg = parseInt(regularTarget, 10);
    const dec = parseInt(deciderTarget, 10);
    if (!isFinite(reg) || reg < 5) errors.push('Regular set target must be a number ≥ 5.');
    if (!isFinite(dec) || dec < 5) errors.push('Decider target must be a number ≥ 5.');

    function validateTeam(t: DraftTeam, side: Side) {
      if (!t.label.trim()) errors.push(`${side === 'home' ? 'Home' : 'Away'} team name is required.`);
      // The "+ Add player" rows are OPTIONAL bench-extension entries — the
      // starters become roster members automatically. We collect the
      // explicit-roster shirts here only to flag duplicates and to honour
      // the libero flag if the user set it for a particular shirt.
      const rosterShirts = new Set<number>();
      for (const p of t.roster) {
        if (!p.shirt.trim()) continue; // empty draft row — skip
        const n = parseInt(p.shirt, 10);
        if (!isFinite(n)) {
          errors.push(`${side}: every "+ Add player" row needs a numeric shirt #.`);
          continue;
        }
        if (rosterShirts.has(n)) {
          errors.push(`${side}: roster has duplicate shirt # ${n}.`);
        }
        rosterShirts.add(n);
      }

      if (sport === 'beach') {
        // Beach: need at least 2 unique shirts (from the roster rows since
        // there are no positions in beach).
        if (rosterShirts.size < 2) {
          errors.push(`${side}: beach needs at least 2 players.`);
        }
        return;
      }

      // Indoor: just need 6 unique shirt #s in the positions. The roster
      // is built from the positions + liberos automatically — no need to
      // add players separately first.
      const posShirts: number[] = [];
      for (let i = 0; i < 6; i++) {
        const n = parseInt(t.positions[i], 10);
        if (!isFinite(n)) {
          errors.push(`${side}: position ${i + 1} needs a shirt #.`);
          continue;
        }
        posShirts.push(n);
      }
      if (posShirts.length === 6 && new Set(posShirts).size !== posShirts.length) {
        errors.push(`${side}: starting lineup has duplicate shirt #s.`);
      }
      // Liberos
      const liberoShirts: number[] = [];
      for (const lib of t.liberos) {
        if (!lib.trim()) continue;
        const n = parseInt(lib, 10);
        if (!isFinite(n)) {
          errors.push(`${side}: libero shirt must be numeric.`);
          continue;
        }
        liberoShirts.push(n);
        if (posShirts.includes(n)) {
          errors.push(`${side}: libero #${n} is also in the starting lineup; pick 6 different shirts for the lineup.`);
        }
      }
      if (t.serveLiberoFromPosition.trim()) {
        const p = parseInt(t.serveLiberoFromPosition, 10);
        if (!isFinite(p) || p < 1 || p > 6) {
          errors.push(`${side}: libero serve position must be 1..6.`);
        }
      }
    }
    validateTeam(home, 'home');
    validateTeam(away, 'away');

    if (errors.length) {
      Alert.alert('Fix these before starting', errors.join('\n'));
      return;
    }

    // Build the persisted match. Auto-extend with starters + liberos so
    // the engine can resolve every shirt # the user set in positions /
    // libero fields, even if they didn't bother to use "+ Add player"
    // for every starter. Explicit roster rows take precedence (they may
    // carry a real name and an explicit libero flag).
    function toRoster(t: DraftTeam): RosterPlayer[] {
      const out: RosterPlayer[] = [];
      const seen = new Set<number>();
      // Pass 1: explicit "+ Add player" rows.
      for (const p of t.roster) {
        if (!p.shirt.trim()) continue;
        const n = parseInt(p.shirt, 10);
        if (!isFinite(n) || seen.has(n)) continue;
        seen.add(n);
        out.push({
          shirt: n,
          name: p.name.trim() || `#${n}`,
          isLibero: p.isLibero,
          active: true,
        });
      }
      // Pass 2: starting positions (indoor only — beach has no positions).
      for (const posStr of t.positions) {
        if (!posStr || !posStr.trim()) continue;
        const n = parseInt(posStr, 10);
        if (!isFinite(n) || seen.has(n)) continue;
        seen.add(n);
        out.push({
          shirt: n,
          name: `#${n}`,
          isLibero: false,
          active: true,
        });
      }
      // Pass 3: liberos. If a libero shirt was already added by an
      // explicit roster row, leave that entry alone — it has the user's
      // chosen name. Otherwise create a fresh libero entry.
      for (const lib of t.liberos) {
        if (!lib.trim()) continue;
        const n = parseInt(lib, 10);
        if (!isFinite(n)) continue;
        if (seen.has(n)) {
          // Promote to libero if it isn't already.
          const existing = out.find((p) => p.shirt === n);
          if (existing && !existing.isLibero) existing.isLibero = true;
          continue;
        }
        seen.add(n);
        out.push({
          shirt: n,
          name: `#${n}`,
          isLibero: true,
          active: true,
        });
      }
      return out;
    }
    function toLineup(t: DraftTeam): Lineup {
      if (sport === 'beach') {
        // Beach: no rotation positions in the UI. Synthesize a 6-slot
        // lineup by repeating the two roster shirts so the engine has
        // something to render. The first player is the first server
        // (position I), the second player is in position IV (front).
        const rosterShirts = t.roster
          .filter((p) => p.shirt.trim() !== '')
          .map((p) => parseInt(p.shirt, 10))
          .filter((n) => isFinite(n));
        const a = rosterShirts[0] ?? 0;
        const b = rosterShirts[1] ?? 0;
        return [a, b, a, b, a, b] as Lineup;
      }
      return t.positions.map((s) => parseInt(s, 10)) as Lineup;
    }

    const meta: MatchMeta = {
      tenantId: getCurrentTenantId(),
      eventName: eventName.trim(),
      division: division.trim(),
      matchLabel: matchLabel.trim(),
      courtName: courtName.trim(),
      dateMs: Date.now(),
      sport,
      bestOf,
      setTargets: { regular: reg, decider: dec, winBy: 2 },
      subRule,
      home: {
        label: home.label.trim(),
        colorHex: home.colorHex,
        liberoMayServe: home.liberoMayServe,
        // Foreign key into TeamProfile. Without this, the analytics
        // dashboard (which filters by `meta.home.teamProfileId`) can't
        // find the match even though the user picked their team in setup.
        teamProfileId: homeTeamProfile?.id,
      },
      away: {
        label: away.label.trim(),
        colorHex: away.colorHex,
        liberoMayServe: away.liberoMayServe,
      },
      officials: {},
      coinToss: { serve: tossServe, side: tossSide },
      // Default classification — `'standalone'` until the post-match
      // save sheet asks the user. `source: 'tier2-live'` because this
      // screen is the live-scoring entry point. `includeInStats`
      // defaults `false` to match the standalone default; the save
      // sheet will flip it on if the user picks AES / Timu.
      matchKind: 'standalone',
      source: 'tier2-live',
      includeInStats: false,
    };
    const rosters = { home: toRoster(home), away: toRoster(away) };
    let m = createMatch(meta, rosters);

    // Append two lineup events (one per team) so set 1 starts properly.
    const homeServeFromPos = home.serveLiberoFromPosition.trim()
      ? (parseInt(home.serveLiberoFromPosition, 10) as Position)
      : undefined;
    const awayServeFromPos = away.serveLiberoFromPosition.trim()
      ? (parseInt(away.serveLiberoFromPosition, 10) as Position)
      : undefined;
    const ts = Date.now();
    m = appendEvent(m, {
      id: makeEventId(),
      ts,
      setIndex: 0,
      type: 'lineup',
      team: 'home',
      positions: toLineup(home),
      liberos: home.liberos
        .map((s) => parseInt(s, 10))
        .filter((n) => isFinite(n)),
      serveLiberoFromPosition: homeServeFromPos,
    });
    m = appendEvent(m, {
      id: makeEventId(),
      ts: ts + 1,
      setIndex: 0,
      type: 'lineup',
      team: 'away',
      positions: toLineup(away),
      liberos: away.liberos
        .map((s) => parseInt(s, 10))
        .filter((n) => isFinite(n)),
      serveLiberoFromPosition: awayServeFromPos,
    });
    onStart(m);
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const isBeach = sport === 'beach';

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onCancel} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backBtn}>{'< Cancel'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>NEW MATCH</Text>
        <View style={{ width: 80 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Match Info */}
        <Section title="Match info">
          <Field label="Event">
            <TextInput style={styles.input} value={eventName} onChangeText={setEventName} placeholder="Ontario Championships" placeholderTextColor={colors.textLight} />
          </Field>
          <Field label="Division">
            <TextInput style={styles.input} value={division} onChangeText={setDivision} placeholder="U18 Girls" placeholderTextColor={colors.textLight} />
          </Field>
          <Field label="Match label">
            <TextInput style={styles.input} value={matchLabel} onChangeText={setMatchLabel} placeholder="Pool A · Match 3" placeholderTextColor={colors.textLight} />
          </Field>
          <Field label="Court">
            <TextInput style={styles.input} value={courtName} onChangeText={setCourtName} placeholder="Court 4" placeholderTextColor={colors.textLight} />
          </Field>

          <Field label="Sport">
            <View style={styles.pillRow}>
              {(['indoor', 'beach'] as const).map((s) => (
                <Pill
                  key={s}
                  label={s === 'indoor' ? '🏐 Indoor' : '🏖 Beach'}
                  active={sport === s}
                  onPress={() => {
                    setSport(s);
                    // Snap the regular-set target to the format default
                    // ONLY if the user hasn't manually edited the field.
                    // Indoor = 25, Beach = 21. Decider stays 15 in both.
                    if (!regularTargetEdited) {
                      setRegularTarget(s === 'beach' ? '21' : '25');
                    }
                  }}
                />
              ))}
            </View>
          </Field>

          <Field label="Best of">
            <View style={styles.pillRow}>
              {[3, 5].map((n) => (
                <Pill key={n} label={String(n)} active={bestOf === n} onPress={() => setBestOf(n as 3 | 5)} />
              ))}
            </View>
          </Field>

          <View style={styles.row2}>
            <Field label="Regular target" flex>
              <TextInput
                style={styles.input}
                value={regularTarget}
                onChangeText={(v) => {
                  setRegularTarget(v);
                  setRegularTargetEdited(true);
                }}
                keyboardType="number-pad"
                maxLength={3}
              />
            </Field>
            <Field label="Decider target" flex>
              <TextInput style={styles.input} value={deciderTarget} onChangeText={setDeciderTarget} keyboardType="number-pad" maxLength={3} />
            </Field>
          </View>

          <Field label="Sub-rule">
            <View style={styles.pillRow}>
              <Pill label="V-C (12 events)" active={subRule === 'vc'} onPress={() => setSubRule('vc')} />
              <Pill label="FIVB (6 pairs)" active={subRule === 'fivb'} onPress={() => setSubRule('fivb')} />
            </View>
          </Field>
        </Section>

        {/* Coin toss */}
        <Section title="Coin toss">
          <Field label="First serve">
            <View style={styles.pillRow}>
              <Pill label="Home" active={tossServe === 'home'} onPress={() => setTossServe('home')} />
              <Pill label="Away" active={tossServe === 'away'} onPress={() => setTossServe('away')} />
            </View>
          </Field>
          <Field label="Side">
            <View style={styles.pillRow}>
              <Pill label="Home on left" active={tossSide === 'home-left'} onPress={() => setTossSide('home-left')} />
              <Pill label="Home on right" active={tossSide === 'home-right'} onPress={() => setTossSide('home-right')} />
            </View>
          </Field>
        </Section>

        {/* Teams */}
        <TeamSection
          side="home"
          team={home}
          isBeach={isBeach}
          onLabelChange={(v) => patchTeam('home', { label: v })}
          onColorPick={() => setColorTarget('home')}
          onLiberoMayServeChange={(v) => patchTeam('home', { liberoMayServe: v })}
          onAddPlayer={() => addRosterPlayer('home')}
          onRemovePlayer={(i) => removeRosterPlayer('home', i)}
          onUpdatePlayer={(i, patch) => updateRosterPlayer('home', i, patch)}
          onPositionChange={(i, v) => setPositionShirt('home', i, v)}
          onLiberoChange={(i, v) => setLiberoShirt('home', i, v)}
          onAddLibero={() => addLiberoSlot('home')}
          onRemoveLibero={(i) => removeLiberoSlot('home', i)}
          onServePosChange={(v) => patchTeam('home', { serveLiberoFromPosition: v })}
          rosterHints={homeRosterHints}
          onAddRosterPlayerFromHint={addRosterPlayerFromHint}
          rosterHintEmptyLink={
            homeTeamProfile && homeRosterHints.length === 0 && onOpenRosterEditor
              ? {
                  label: 'Add players to your team →',
                  onPress: () => onOpenRosterEditor(homeTeamProfile),
                }
              : null
          }
          styles={styles}
          colors={colors}
        />

        <TeamSection
          side="away"
          team={away}
          isBeach={isBeach}
          onLabelChange={(v) => patchTeam('away', { label: v })}
          onColorPick={() => setColorTarget('away')}
          onLiberoMayServeChange={(v) => patchTeam('away', { liberoMayServe: v })}
          onAddPlayer={() => addRosterPlayer('away')}
          onRemovePlayer={(i) => removeRosterPlayer('away', i)}
          onUpdatePlayer={(i, patch) => updateRosterPlayer('away', i, patch)}
          onPositionChange={(i, v) => setPositionShirt('away', i, v)}
          onLiberoChange={(i, v) => setLiberoShirt('away', i, v)}
          onAddLibero={() => addLiberoSlot('away')}
          onRemoveLibero={(i) => removeLiberoSlot('away', i)}
          onServePosChange={(v) => patchTeam('away', { serveLiberoFromPosition: v })}
          styles={styles}
          colors={colors}
        />

        <TouchableOpacity style={styles.startBtn} onPress={buildAndStart} activeOpacity={0.7}>
          <Text style={styles.startBtnText}>Start Match</Text>
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Color picker */}
      <Modal
        visible={!!colorTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setColorTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{colorTarget === 'home' ? 'Home colour' : 'Away colour'}</Text>
            <View style={styles.colorGrid}>
              {COLOR_PALETTE.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.colorTile, { backgroundColor: c }]}
                  onPress={() => {
                    if (colorTarget === 'home') setHome((t) => ({ ...t, colorHex: c }));
                    else if (colorTarget === 'away') setAway((t) => ({ ...t, colorHex: c }));
                    setColorTarget(null);
                  }}
                  activeOpacity={0.7}
                />
              ))}
            </View>
            <TouchableOpacity onPress={() => setColorTarget(null)} style={styles.modalBtnCancel}>
              <Text style={styles.modalBtnCancelText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function Field({ label, children, flex }: { label: string; children: React.ReactNode; flex?: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.field, flex && { flex: 1 }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity
      style={[styles.pill, active && styles.pillActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function TeamSection(props: {
  side: Side;
  team: DraftTeam;
  isBeach: boolean;
  onLabelChange: (v: string) => void;
  onColorPick: () => void;
  onLiberoMayServeChange: (v: boolean) => void;
  onAddPlayer: () => void;
  onRemovePlayer: (i: number) => void;
  onUpdatePlayer: (i: number, patch: Partial<DraftRosterPlayer>) => void;
  onPositionChange: (i: number, v: string) => void;
  onLiberoChange: (i: number, v: string) => void;
  onAddLibero: () => void;
  onRemoveLibero: (i: number) => void;
  onServePosChange: (v: string) => void;
  /** Shirt-numbers from the user's TeamProfile.roster (active only).
   *  Renders as a chip strip above the bench-rows so the scorer can
   *  one-tap add their own players instead of retyping shirts. */
  rosterHints?: RosterPlayer[];
  onAddRosterPlayerFromHint?: (hint: RosterPlayer) => void;
  /** Link rendered when the user has a TeamProfile but no roster yet. */
  rosterHintEmptyLink?: { label: string; onPress: () => void } | null;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  const {
    side,
    team,
    isBeach,
    onLabelChange,
    onColorPick,
    onLiberoMayServeChange,
    onAddPlayer,
    onRemovePlayer,
    onUpdatePlayer,
    onPositionChange,
    onLiberoChange,
    onAddLibero,
    onRemoveLibero,
    onServePosChange,
    rosterHints,
    onAddRosterPlayerFromHint,
    rosterHintEmptyLink,
    styles,
    colors,
  } = props;
  // Shirt #s already added to the draft — these hint chips render dim so
  // the scorer doesn't tap-add a duplicate.
  const draftShirts = new Set(
    team.roster.map((p) => p.shirt.trim()).filter((s) => s.length > 0)
  );
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{side === 'home' ? 'HOME TEAM' : 'AWAY TEAM'}</Text>

      <View style={styles.teamHeaderRow}>
        <TouchableOpacity onPress={onColorPick} style={[styles.colorSwatch, { backgroundColor: team.colorHex }]} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={team.label}
          onChangeText={onLabelChange}
          placeholder={side === 'home' ? 'Home team name' : 'Away team name'}
          placeholderTextColor={colors.textLight}
        />
      </View>

      {isBeach ? (
        <Text style={styles.fieldHint}>
          Beach format: 2 players per team. No rotation positions or liberos.
          The first player in the roster serves first; serves alternate on
          side-out. Names are optional — shirt # is enough.
        </Text>
      ) : null}

      <Field label={isBeach ? 'Players (2 per team)' : 'Bench (optional)'}>
        {/* Persistent hint. For indoor, the starters are inferred from
            the lineup positions below — you only need this section if
            you want to add bench players for substitutions. Names will
            sync from MRS in a future phase; for now shirt #s alone are
            enough to start scoring. */}
        <Text style={styles.fieldHint}>
          {isBeach
            ? 'Shirt # required, name optional. The first player added serves first.'
            : 'Optional. The 6 starters auto-build the roster from the lineup below — only use this section if you want to register bench players for subs. Names always optional and will sync from MRS later.'}
        </Text>
        {rosterHints && rosterHints.length > 0 && onAddRosterPlayerFromHint ? (
          <View style={{ marginTop: spacing.xs, marginBottom: spacing.xs }}>
            <Text style={[styles.fieldLabel, { marginBottom: 4 }]}>
              FROM YOUR TEAM ROSTER
            </Text>
            <View style={styles.pillRow}>
              {rosterHints.map((hint) => {
                const already = draftShirts.has(String(hint.shirt));
                return (
                  <TouchableOpacity
                    key={hint.shirt}
                    onPress={() => onAddRosterPlayerFromHint(hint)}
                    activeOpacity={0.7}
                    disabled={already}
                    style={[styles.pill, already && { opacity: 0.4 }]}
                  >
                    <Text style={styles.pillText}>
                      #{hint.shirt}
                      {hint.name ? ` ${hint.name}` : ''}
                      {hint.isLibero ? ' (L)' : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={[styles.fieldHint, { marginTop: 4 }]}>
              Tap to add. Edits here only affect this match — to update
              your team's persistent roster, open Manage roster from the
              home screen.
            </Text>
          </View>
        ) : rosterHintEmptyLink ? (
          <TouchableOpacity
            onPress={rosterHintEmptyLink.onPress}
            activeOpacity={0.7}
            style={{ marginTop: spacing.xs, marginBottom: spacing.xs }}
          >
            <Text style={{ color: colors.primary, fontWeight: '700', fontSize: fontSize.sm }}>
              {rosterHintEmptyLink.label}
            </Text>
          </TouchableOpacity>
        ) : null}
        {team.roster.length === 0 ? (
          <Text style={styles.fieldHint}>
            {isBeach
              ? 'Tap "+ Add player" to begin.'
              : 'No bench players added yet. Skip this and just fill in the lineup below — that\'s enough to start.'}
          </Text>
        ) : null}
        {team.roster.map((p, i) => (
          <View key={i} style={styles.rosterRow}>
            <TextInput
              style={[styles.input, { width: 60 }]}
              value={p.shirt}
              onChangeText={(v) => onUpdatePlayer(i, { shirt: v })}
              placeholder="#"
              placeholderTextColor={colors.textLight}
              keyboardType="number-pad"
              maxLength={3}
            />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={p.name}
              onChangeText={(v) => onUpdatePlayer(i, { name: v })}
              placeholder="Name (optional, syncs from MRS later)"
              placeholderTextColor={colors.textLight}
            />
            {!isBeach ? (
              <TouchableOpacity
                style={[styles.smallToggle, p.isLibero && styles.smallToggleActive]}
                onPress={() => onUpdatePlayer(i, { isLibero: !p.isLibero })}
                activeOpacity={0.7}
              >
                <Text style={[styles.smallToggleText, p.isLibero && styles.smallToggleTextActive]}>L</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={() => onRemovePlayer(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.removeX}>{'✕'}</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity style={styles.addPlayerBtn} onPress={onAddPlayer} activeOpacity={0.7}>
          <Text style={styles.addPlayerBtnText}>+ Add player</Text>
        </TouchableOpacity>
      </Field>

      {/* Indoor-only: rotation positions + liberos + may-serve. Beach
          skips all of this since the format has no rotation or liberos. */}
      {!isBeach ? (
        <>
          <Field label="Starting lineup (positions I..VI)">
            <View style={styles.lineupGrid}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <View key={i} style={styles.lineupCell}>
                  <Text style={styles.lineupCellLabel}>{['I', 'II', 'III', 'IV', 'V', 'VI'][i]}</Text>
                  <TextInput
                    style={[styles.input, { width: 56 }]}
                    value={team.positions[i]}
                    onChangeText={(v) => onPositionChange(i, v)}
                    keyboardType="number-pad"
                    maxLength={3}
                    placeholder="#"
                    placeholderTextColor={colors.textLight}
                  />
                </View>
              ))}
            </View>
            <Text style={styles.fieldHint}>I = right back / first server. Numbering matches paper-scoresheet conventions.</Text>
          </Field>

          <Field label="Liberos">
            {team.liberos.map((s, i) => (
              <View key={i} style={styles.liberoRow}>
                <TextInput
                  style={[styles.input, { width: 80 }]}
                  value={s}
                  onChangeText={(v) => onLiberoChange(i, v)}
                  keyboardType="number-pad"
                  maxLength={3}
                  placeholder="#"
                  placeholderTextColor={colors.textLight}
                />
                {team.liberos.length > 1 ? (
                  <TouchableOpacity onPress={() => onRemoveLibero(i)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Text style={styles.removeX}>{'✕'}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
            {team.liberos.length < 2 ? (
              <TouchableOpacity style={styles.addPlayerBtn} onPress={onAddLibero} activeOpacity={0.7}>
                <Text style={styles.addPlayerBtnText}>+ Second libero</Text>
              </TouchableOpacity>
            ) : null}
          </Field>

          <Field label="Libero may serve">
            <View style={styles.pillRow}>
              <Pill label="No" active={!team.liberoMayServe} onPress={() => onLiberoMayServeChange(false)} />
              <Pill label="Yes" active={team.liberoMayServe} onPress={() => onLiberoMayServeChange(true)} />
            </View>
            {team.liberoMayServe ? (
              <View style={[styles.field, { marginTop: spacing.xs }]}>
                <Text style={styles.fieldLabel}>Libero serves from position (1..6)</Text>
                <TextInput
                  style={[styles.input, { width: 80 }]}
                  value={team.serveLiberoFromPosition}
                  onChangeText={onServePosChange}
                  keyboardType="number-pad"
                  maxLength={1}
                  placeholder="1"
                  placeholderTextColor={colors.textLight}
                />
              </View>
            ) : null}
          </Field>
        </>
      ) : null}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    backBtn: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
    title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800', letterSpacing: 1 },

    body: { padding: spacing.lg, paddingBottom: spacing.xxxl },

    section: {
      marginBottom: spacing.lg,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
    },
    sectionLabel: {
      fontSize: 11,
      fontWeight: '800',
      color: colors.primary,
      letterSpacing: 1.2,
      marginBottom: spacing.sm,
    },

    field: { marginBottom: spacing.sm },
    fieldLabel: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.textSecondary,
      marginBottom: 4,
    },
    fieldHint: {
      fontSize: fontSize.xs,
      color: colors.textLight,
      fontStyle: 'italic',
      marginTop: 4,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.sm,
      paddingVertical: 8,
      paddingHorizontal: spacing.sm,
      fontSize: fontSize.md,
      color: colors.text,
      backgroundColor: colors.background,
    },
    row2: { flexDirection: 'row', gap: spacing.sm },

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

    teamHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    colorSwatch: {
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 2,
      borderColor: 'rgba(0,0,0,0.18)',
    },

    rosterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 6,
    },
    smallToggle: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: borderRadius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    smallToggleActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    smallToggleText: { fontSize: fontSize.sm, fontWeight: '800', color: colors.text },
    smallToggleTextActive: { color: '#ffffff' },
    removeX: { color: colors.textLight, fontSize: fontSize.lg, fontWeight: '700', paddingHorizontal: spacing.xs },
    addPlayerBtn: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.sm,
      borderWidth: 1,
      borderColor: colors.primary,
      alignSelf: 'flex-start',
      marginTop: 4,
    },
    addPlayerBtnText: { color: colors.primary, fontSize: fontSize.sm, fontWeight: '700' },

    lineupGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    lineupCell: { alignItems: 'center', gap: 2 },
    lineupCellLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textLight,
      letterSpacing: 1,
    },
    liberoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },

    startBtn: {
      backgroundColor: colors.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.lg,
    },
    startBtnText: { color: colors.textOnPrimary, fontWeight: '800', fontSize: fontSize.lg },

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
    colorGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    colorTile: {
      width: 56,
      height: 56,
      borderRadius: borderRadius.md,
      borderWidth: 2,
      borderColor: 'rgba(0,0,0,0.1)',
    },
    modalBtnCancel: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    modalBtnCancelText: { color: colors.text, fontWeight: '700' },
  });
}
