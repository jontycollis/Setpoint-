// ── matchEngine unit tests ─────────────────────────────────────────────────
//
// Pure-function tests for the Tier 2 scoring engine. Exercises rotation,
// libero state machine, point/set/match scoring, and the edit/delete
// re-derive semantics. No AsyncStorage; no React Native imports.
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import type {
  Match,
  MatchEvent,
  MatchMeta,
  PointEvent,
  LineupEvent,
  SubEvent,
  LiberoOnEvent,
  LiberoOffEvent,
  LiberoOfficiallyReplacedEvent,
  TimeoutEvent,
  SetEndEvent,
  SignoffEvent,
  RosterPlayer,
  Side,
} from '../../types/match';
import {
  rotate,
  appendEvent,
  removeEventById,
  deriveMatchState,
  createMatch,
  canApplyPoint,
  canApplySub,
  canApplyLiberoOn,
  canApplyLiberoOff,
  canApplyLiberoOfficiallyReplaced,
  canApplyTimeout,
  canApplyLineup,
  canApplySetEnd,
} from '../matchEngine';

// ─── Test fixtures ─────────────────────────────────────────────────────────

const baseMeta: MatchMeta = {
  tenantId: 'ova',
  eventName: 'Test Event',
  division: 'U18 Girls',
  matchLabel: 'Pool A · Match 1',
  courtName: 'Court 1',
  dateMs: 1700000000000,
  sport: 'indoor',
  bestOf: 3,
  setTargets: { regular: 25, decider: 15, winBy: 2 },
  home: { label: 'Home', liberoMayServe: false },
  away: { label: 'Away', liberoMayServe: false },
  officials: {},
  coinToss: { serve: 'home', side: 'home-left' },
};

function roster(prefix: 'H' | 'A'): RosterPlayer[] {
  // 6 starters + 2 bench + 1 libero = 9 players. Shirts H1..H9 / A1..A9
  // expressed as numeric (e.g., H1 → 11, H9 → 19 / A1 → 21, A9 → 29).
  const offset = prefix === 'H' ? 10 : 20;
  const out: RosterPlayer[] = [];
  for (let i = 1; i <= 8; i++) {
    out.push({
      shirt: offset + i,
      name: `${prefix}${i}`,
      isLibero: false,
      active: true,
    });
  }
  // Liberos at +9 / +0 (e.g. 19, 20 for home — using +9 only first)
  out.push({
    shirt: offset + 9,
    name: `${prefix}L1`,
    isLibero: true,
    active: true,
  });
  out.push({
    shirt: offset + 99,
    name: `${prefix}L2`,
    isLibero: true,
    active: true,
  });
  return out;
}

const homeRoster = roster('H');
const awayRoster = roster('A');

function newMatch(metaOverrides: Partial<MatchMeta> = {}): Match {
  return createMatch(
    { ...baseMeta, ...metaOverrides },
    { home: homeRoster, away: awayRoster }
  );
}

let eventCounter = 0;
function ev<T extends MatchEvent>(template: Omit<T, 'id' | 'ts'>): T {
  eventCounter++;
  return {
    ...template,
    id: `e_${eventCounter}`,
    ts: 1700000000000 + eventCounter * 1000,
  } as T;
}

function applyAll(match: Match, events: MatchEvent[]): Match {
  return events.reduce((m, e) => appendEvent(m, e), match);
}

function homeLineup(setIndex = 0): LineupEvent {
  return ev<LineupEvent>({
    type: 'lineup',
    setIndex,
    team: 'home',
    positions: [11, 12, 13, 14, 15, 16],
    liberos: [19],
  });
}
function awayLineup(setIndex = 0): LineupEvent {
  return ev<LineupEvent>({
    type: 'lineup',
    setIndex,
    team: 'away',
    positions: [21, 22, 23, 24, 25, 26],
    liberos: [29],
  });
}

function point(team: Side, setIndex = 0): PointEvent {
  return ev<PointEvent>({ type: 'point', setIndex, scoringTeam: team });
}

// ─── rotate() primitive ────────────────────────────────────────────────────

describe('rotate()', () => {
  it('shifts each player one slot toward position I, with I wrapping to VI', () => {
    expect(rotate([1, 2, 3, 4, 5, 6])).toEqual([2, 3, 4, 5, 6, 1]);
  });

  it('returns to the starting lineup after exactly six rotations', () => {
    let p: [number, number, number, number, number, number] = [1, 2, 3, 4, 5, 6];
    for (let i = 0; i < 6; i++) p = rotate(p);
    expect(p).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

// ─── Server resolution and rotation flow ──────────────────────────────────

describe('rotation flow during scoring', () => {
  it('coin-toss winner serves first; receiving team scoring side-outs and rotates', () => {
    const m = applyAll(newMatch(), [
      homeLineup(),
      awayLineup(),
      point('away'), // away wins on home's serve → away rotates AND serves
    ]);
    const s = deriveMatchState(m);
    expect(s.currentSet?.server).toBe('away');
    expect(s.currentSet?.rotation.away.positions).toEqual([22, 23, 24, 25, 26, 21]);
    // home positions unchanged
    expect(s.currentSet?.rotation.home.positions).toEqual([11, 12, 13, 14, 15, 16]);
  });

  it('serving team scoring keeps serving and does not rotate', () => {
    const m = applyAll(newMatch(), [homeLineup(), awayLineup(), point('home')]);
    const s = deriveMatchState(m);
    expect(s.currentSet?.server).toBe('home');
    expect(s.currentSet?.rotation.home.positions).toEqual([11, 12, 13, 14, 15, 16]);
  });

  it('repeated side-outs cycle through all six rotations', () => {
    const events: MatchEvent[] = [homeLineup(), awayLineup()];
    // alternate side-outs
    for (let i = 0; i < 6; i++) {
      events.push(point('away'));
      events.push(point('home'));
    }
    const m = applyAll(newMatch(), events);
    const s = deriveMatchState(m);
    // 6 home points (every other rally), but rotation only fires on
    // side-out from receiving team. Away rotated 6 times, home rotated 6 times.
    expect(s.currentSet?.rotation.home.positions).toEqual([11, 12, 13, 14, 15, 16]);
    expect(s.currentSet?.rotation.away.positions).toEqual([21, 22, 23, 24, 25, 26]);
  });

  it('serverShirt reflects whoever is in position I', () => {
    const m = applyAll(newMatch(), [
      homeLineup(),
      awayLineup(),
      point('away'),
    ]);
    const s = deriveMatchState(m);
    expect(s.currentSet?.serverShirt).toBe(22); // away's pos II rotated to I
  });
});

// ─── Set / match scoring ──────────────────────────────────────────────────

describe('set + match scoring', () => {
  it('best-of-3 with 2 wins ends the match', () => {
    const events: MatchEvent[] = [];
    // Set 1: home wins 25-19.
    events.push(homeLineup(0), awayLineup(0));
    for (let i = 0; i < 25; i++) events.push(point('home', 0));
    for (let i = 0; i < 19; i++) events.push(point('away', 0));
    events.push(
      ev<SetEndEvent>({
        type: 'set-end',
        setIndex: 0,
        homeFinal: 25,
        awayFinal: 19,
        durationMs: 1500_000,
      })
    );
    // Set 2: home wins 25-22.
    events.push(homeLineup(1), awayLineup(1));
    for (let i = 0; i < 25; i++) events.push(point('home', 1));
    for (let i = 0; i < 22; i++) events.push(point('away', 1));
    events.push(
      ev<SetEndEvent>({
        type: 'set-end',
        setIndex: 1,
        homeFinal: 25,
        awayFinal: 22,
        durationMs: 1700_000,
      })
    );

    const m = applyAll(newMatch(), events);
    const s = deriveMatchState(m);
    expect(s.matchComplete).toBe(true);
    expect(s.winner).toBe('home');
    expect(s.setsWon).toEqual({ home: 2, away: 0 });
    expect(s.setHistory).toHaveLength(2);
  });

  it('best-of-3 tied 1-1 sets the deciding set target to 15', () => {
    const events: MatchEvent[] = [];
    events.push(homeLineup(0), awayLineup(0));
    events.push(
      ev<SetEndEvent>({
        type: 'set-end',
        setIndex: 0,
        homeFinal: 25,
        awayFinal: 19,
        durationMs: 1_000_000,
      })
    );
    events.push(homeLineup(1), awayLineup(1));
    events.push(
      ev<SetEndEvent>({
        type: 'set-end',
        setIndex: 1,
        homeFinal: 23,
        awayFinal: 25,
        durationMs: 1_000_000,
      })
    );
    events.push(homeLineup(2), awayLineup(2));
    events.push(point('home', 2));

    const m = applyAll(newMatch(), events);
    const s = deriveMatchState(m);
    expect(s.currentSet?.target).toBe(15);
    expect(s.currentSet?.isDecider).toBe(true);
  });

  it('first-server alternates by set, anchored to coin toss', () => {
    // home wins coin toss → set 1 home serves; set 2 away; set 3 home.
    const events: MatchEvent[] = [];
    events.push(homeLineup(0), awayLineup(0));
    events.push(
      ev<SetEndEvent>({
        type: 'set-end',
        setIndex: 0,
        homeFinal: 25,
        awayFinal: 23,
        durationMs: 1_000_000,
      })
    );
    events.push(homeLineup(1), awayLineup(1));
    let m = applyAll(newMatch(), events);
    let s = deriveMatchState(m);
    expect(s.currentSet?.server).toBe('away');

    events.push(
      ev<SetEndEvent>({
        type: 'set-end',
        setIndex: 1,
        homeFinal: 23,
        awayFinal: 25,
        durationMs: 1_000_000,
      })
    );
    events.push(homeLineup(2), awayLineup(2));
    m = applyAll(newMatch(), events);
    s = deriveMatchState(m);
    expect(s.currentSet?.server).toBe('home');
  });
});

// ─── canApplySetEnd warnings ──────────────────────────────────────────────

describe('canApplySetEnd', () => {
  it('flags a set ending below the target as a warning', () => {
    const m = applyAll(newMatch(), [homeLineup(), awayLineup()]);
    const s = deriveMatchState(m);
    const r = canApplySetEnd(
      s,
      ev<SetEndEvent>({
        type: 'set-end',
        setIndex: 0,
        homeFinal: 24,
        awayFinal: 23,
        durationMs: 0,
      })
    );
    expect(r.ok).toBe(true); // warn-and-allow, not block
    expect(r.warnings.some((w) => /target/.test(w))).toBe(true);
  });

  it('flags a set ending without a 2-point lead', () => {
    const m = applyAll(newMatch(), [homeLineup(), awayLineup()]);
    const s = deriveMatchState(m);
    const r = canApplySetEnd(
      s,
      ev<SetEndEvent>({
        type: 'set-end',
        setIndex: 0,
        homeFinal: 25,
        awayFinal: 24,
        durationMs: 0,
      })
    );
    expect(r.warnings.some((w) => /won by/i.test(w))).toBe(true);
  });

  it('accepts a normal 25-23 set with no warnings', () => {
    const m = applyAll(newMatch(), [homeLineup(), awayLineup()]);
    const s = deriveMatchState(m);
    const r = canApplySetEnd(
      s,
      ev<SetEndEvent>({
        type: 'set-end',
        setIndex: 0,
        homeFinal: 25,
        awayFinal: 23,
        durationMs: 0,
      })
    );
    expect(r.warnings).toEqual([]);
  });
});

// ─── Libero state machine ─────────────────────────────────────────────────

describe('libero rules', () => {
  it('libero-on takes the back-row regular off; libero-off restores them', () => {
    const liberoOn = ev<LiberoOnEvent>({
      type: 'libero-on',
      setIndex: 0,
      team: 'home',
      libero: 19,
      replaces: 16, // VI
    });
    const liberoOff = ev<LiberoOffEvent>({
      type: 'libero-off',
      setIndex: 0,
      team: 'home',
      libero: 19,
      replacedBy: 16,
    });
    const m = applyAll(newMatch(), [
      homeLineup(),
      awayLineup(),
      liberoOn,
      point('home'),
      point('home'),
      liberoOff,
    ]);
    const s = deriveMatchState(m);
    expect(s.currentSet?.rotation.home.liberoOnFloor).toBeNull();
    expect(s.currentSet?.rotation.home.positions).toEqual([11, 12, 13, 14, 15, 16]);
  });

  it('warns if libero replaces a front-row player', () => {
    const liberoOn = ev<LiberoOnEvent>({
      type: 'libero-on',
      setIndex: 0,
      team: 'home',
      libero: 19,
      replaces: 13, // III is front-row
    });
    const m = applyAll(newMatch(), [homeLineup(), awayLineup()]);
    const s = deriveMatchState(m);
    const r = canApplyLiberoOn(s, liberoOn, {
      home: homeRoster,
      away: awayRoster,
    });
    expect(r.warnings.some((w) => /front-row|back-row/i.test(w))).toBe(true);
  });

  it('warns when a second libero is brought on while one is already on', () => {
    const lineup = ev<LineupEvent>({
      type: 'lineup',
      setIndex: 0,
      team: 'home',
      positions: [11, 12, 13, 14, 15, 16],
      liberos: [19, 109],
    });
    const liberoOn1 = ev<LiberoOnEvent>({
      type: 'libero-on',
      setIndex: 0,
      team: 'home',
      libero: 19,
      replaces: 16,
    });
    const liberoOn2 = ev<LiberoOnEvent>({
      type: 'libero-on',
      setIndex: 0,
      team: 'home',
      libero: 109,
      replaces: 15,
    });
    const m = applyAll(newMatch(), [lineup, awayLineup(), liberoOn1]);
    const s = deriveMatchState(m);
    const r = canApplyLiberoOn(s, liberoOn2, {
      home: homeRoster,
      away: awayRoster,
    });
    expect(r.warnings.some((w) => /already on the floor/i.test(w))).toBe(true);
  });

  it('enforces one-rally-rest on libero re-entry', () => {
    const liberoOn = ev<LiberoOnEvent>({
      type: 'libero-on',
      setIndex: 0,
      team: 'home',
      libero: 19,
      replaces: 16,
    });
    const liberoOff = ev<LiberoOffEvent>({
      type: 'libero-off',
      setIndex: 0,
      team: 'home',
      libero: 19,
      replacedBy: 16,
    });
    const liberoOnAgain = ev<LiberoOnEvent>({
      type: 'libero-on',
      setIndex: 0,
      team: 'home',
      libero: 19,
      replaces: 16,
    });
    // libero off, NO rally between, libero attempting back on
    const m = applyAll(newMatch(), [homeLineup(), awayLineup(), liberoOn, liberoOff]);
    const s = deriveMatchState(m);
    const r = canApplyLiberoOn(s, liberoOnAgain, {
      home: homeRoster,
      away: awayRoster,
    });
    expect(r.warnings.some((w) => /rest at least one rally/i.test(w))).toBe(true);
  });

  it('allows libero re-entry once a rally has elapsed', () => {
    const liberoOn = ev<LiberoOnEvent>({
      type: 'libero-on',
      setIndex: 0,
      team: 'home',
      libero: 19,
      replaces: 16,
    });
    const liberoOff = ev<LiberoOffEvent>({
      type: 'libero-off',
      setIndex: 0,
      team: 'home',
      libero: 19,
      replacedBy: 16,
    });
    const liberoOnAgain = ev<LiberoOnEvent>({
      type: 'libero-on',
      setIndex: 0,
      team: 'home',
      libero: 19,
      replaces: 16,
    });
    const m = applyAll(newMatch(), [
      homeLineup(),
      awayLineup(),
      liberoOn,
      liberoOff,
      point('home'),
    ]);
    const s = deriveMatchState(m);
    const r = canApplyLiberoOn(s, liberoOnAgain, {
      home: homeRoster,
      away: awayRoster,
    });
    expect(r.warnings.find((w) => /rest at least one rally/i.test(w))).toBeUndefined();
  });

  it('rotation drags the libero into the front row — engine should pop them off automatically', () => {
    // Reproduces the user-reported issue: lineup is [11,12,13,14,15,16];
    // libero #19 comes on for #15 (position V, back row). Then home
    // side-outs and rotates: the libero — still tracked in `positions`
    // — shifts to position IV (front row). The engine doesn't currently
    // self-correct, so the assertion documents the bug we're fixing in
    // the engine layer next.
    const events: MatchEvent[] = [
      homeLineup(),
      awayLineup(),
      ev<LiberoOnEvent>({
        type: 'libero-on',
        setIndex: 0,
        team: 'home',
        libero: 19,
        replaces: 15, // position V (idx 4, back row)
      }),
      // Home was serving (coin toss). Away wins → away rotates and serves.
      point('away'),
      // Home wins on away's serve → home side-outs and rotates.
      point('home'),
    ];
    const m = applyAll(newMatch(), events);
    const s = deriveMatchState(m);
    const home = s.currentSet!.rotation.home;
    // After home rotation: [12,13,14,15,16,11] when no libero is on.
    // With libero #19 in for #15 originally, positions before rotation
    // were [11,12,13,14,19,16]; after rotation [12,13,14,19,16,11].
    // Engine layer should detect libero #19 at idx 3 (front row IV)
    // and force them off, restoring #15 in their place. Expected
    // post-correction: [12,13,14,15,16,11] (no libero on the floor;
    // #15 is in idx 3, playing front row).
    expect(home.liberoOnFloor).toBeNull();
    expect(home.positions).toEqual([12, 13, 14, 15, 16, 11]);
  });

  it('libero swaps never count against the substitution cap (FIVB §19.3 / V-C 12-sub rule)', () => {
    // Repeated libero on/off across rotations should leave subsUsed at 0
    // and subPairs empty — libero replacements aren't substitutions.
    const events: MatchEvent[] = [homeLineup(), awayLineup()];
    // Bring libero on, off, on, off — three full cycles.
    events.push(
      ev<LiberoOnEvent>({ type: 'libero-on', setIndex: 0, team: 'home', libero: 19, replaces: 16 }),
      point('home'),
      ev<LiberoOffEvent>({ type: 'libero-off', setIndex: 0, team: 'home', libero: 19, replacedBy: 16 }),
      point('home'),
      ev<LiberoOnEvent>({ type: 'libero-on', setIndex: 0, team: 'home', libero: 19, replaces: 16 }),
      point('home'),
      ev<LiberoOffEvent>({ type: 'libero-off', setIndex: 0, team: 'home', libero: 19, replacedBy: 16 }),
    );
    const m = applyAll(newMatch(), events);
    const s = deriveMatchState(m);
    expect(s.currentSet?.rotation.home.subsUsed).toBe(0);
    expect(s.currentSet?.rotation.home.subPairs).toEqual([]);
  });

  it('libero may swap with any back-row regular, not only the originally-replaced one', () => {
    // FIVB §19.3 lets the libero replace any back-row player. The engine
    // shouldn't flag a second libero-on for a different back-row player
    // as a violation of subPairs / sub limits, even if the libero just
    // came off for someone else.
    const events: MatchEvent[] = [
      homeLineup(),
      awayLineup(),
      ev<LiberoOnEvent>({ type: 'libero-on', setIndex: 0, team: 'home', libero: 19, replaces: 15 }),
      point('home'),
      ev<LiberoOffEvent>({ type: 'libero-off', setIndex: 0, team: 'home', libero: 19, replacedBy: 15 }),
      point('home'),
      // Different back-row player (#16, position VI) this time.
      ev<LiberoOnEvent>({ type: 'libero-on', setIndex: 0, team: 'home', libero: 19, replaces: 16 }),
    ];
    const m = applyAll(newMatch(), events);
    const s = deriveMatchState(m);
    expect(s.currentSet?.rotation.home.liberoOnFloor).toBe(19);
    expect(s.currentSet?.rotation.home.liberoReplacesShirt).toBe(16);
    expect(s.currentSet?.rotation.home.subsUsed).toBe(0);
    expect(s.currentSet?.rotation.home.subPairs).toEqual([]);
  });

  it('warns when designated libero shirt is not flagged isLibero in roster', () => {
    const lineup = ev<LineupEvent>({
      type: 'lineup',
      setIndex: 0,
      team: 'home',
      positions: [11, 12, 13, 14, 15, 16],
      liberos: [17], // 17 is a regular, not flagged libero
    });
    const r = canApplyLineup(deriveMatchState(newMatch()), lineup, {
      home: homeRoster,
      away: awayRoster,
    });
    expect(r.warnings.some((w) => /not flagged as a libero/i.test(w))).toBe(true);
  });

  it('libero serves from configured slot when serveLiberoFromPosition is set', () => {
    // RULE-CHECK: this asserts the implementation choice in
    // resolveServerShirt — libero serves only when their replaced
    // shirt is in position I AND serveLiberoFromPosition is set.
    const lineup = ev<LineupEvent>({
      type: 'lineup',
      setIndex: 0,
      team: 'home',
      positions: [11, 12, 13, 14, 15, 16],
      liberos: [19],
      serveLiberoFromPosition: 1, // libero serves from pos I
    });
    const liberoOn = ev<LiberoOnEvent>({
      type: 'libero-on',
      setIndex: 0,
      team: 'home',
      libero: 19,
      replaces: 11, // libero replaces the player in pos I
    });
    const m = applyAll(newMatch(), [lineup, awayLineup(), liberoOn]);
    const s = deriveMatchState(m);
    expect(s.currentSet?.server).toBe('home');
    expect(s.currentSet?.serverShirt).toBe(19); // libero serves
  });
});

// ─── Subs ──────────────────────────────────────────────────────────────────

describe('substitutions', () => {
  it('updates positions when a regular sub is applied', () => {
    const sub = ev<SubEvent>({
      type: 'sub',
      setIndex: 0,
      team: 'home',
      out: 13,
      in: 17,
    });
    const m = applyAll(newMatch(), [homeLineup(), awayLineup(), sub]);
    const s = deriveMatchState(m);
    expect(s.currentSet?.rotation.home.positions).toEqual([11, 12, 17, 14, 15, 16]);
    expect(s.currentSet?.rotation.home.subsUsed).toBe(1);
  });

  it('warns when subbing in a player not on the active roster', () => {
    const sub = ev<SubEvent>({
      type: 'sub',
      setIndex: 0,
      team: 'home',
      out: 13,
      in: 999, // not in roster
    });
    const m = applyAll(newMatch(), [homeLineup(), awayLineup()]);
    const s = deriveMatchState(m);
    const r = canApplySub(s, sub, { home: homeRoster, away: awayRoster });
    expect(r.warnings.some((w) => /active roster/i.test(w))).toBe(true);
  });

  it('warns when re-entering as a player other than the one who replaced you', () => {
    // Starter 13 → replacement 17.
    const sub1 = ev<SubEvent>({
      type: 'sub',
      setIndex: 0,
      team: 'home',
      out: 13,
      in: 17,
    });
    // Now 17 is on the floor. Try to swap 17 out for 18 (not the
    // original starter) — should warn.
    const sub2 = ev<SubEvent>({
      type: 'sub',
      setIndex: 0,
      team: 'home',
      out: 17,
      in: 18,
    });
    const m = applyAll(newMatch(), [homeLineup(), awayLineup(), sub1]);
    const s = deriveMatchState(m);
    const r = canApplySub(s, sub2, { home: homeRoster, away: awayRoster });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('allows the starter back in for their replacement (paired re-entry)', () => {
    const sub1 = ev<SubEvent>({
      type: 'sub',
      setIndex: 0,
      team: 'home',
      out: 13,
      in: 17,
    });
    const sub2 = ev<SubEvent>({
      type: 'sub',
      setIndex: 0,
      team: 'home',
      out: 17,
      in: 13, // starter coming back for their replacement
    });
    const m = applyAll(newMatch(), [homeLineup(), awayLineup(), sub1]);
    const s = deriveMatchState(m);
    const r = canApplySub(s, sub2, { home: homeRoster, away: awayRoster });
    // Sub pair found and re-entry is legal — no warnings.
    expect(r.warnings).toEqual([]);
  });
});

// ─── Timeouts ──────────────────────────────────────────────────────────────

describe('timeouts', () => {
  it('warns when a third timeout is requested', () => {
    const t1 = ev<TimeoutEvent>({ type: 'timeout', setIndex: 0, team: 'home' });
    const t2 = ev<TimeoutEvent>({ type: 'timeout', setIndex: 0, team: 'home' });
    const t3 = ev<TimeoutEvent>({ type: 'timeout', setIndex: 0, team: 'home' });
    const m = applyAll(newMatch(), [homeLineup(), awayLineup(), t1, t2]);
    const s = deriveMatchState(m);
    const r = canApplyTimeout(s, t3);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('counts timeouts independently per team', () => {
    const m = applyAll(newMatch(), [
      homeLineup(),
      awayLineup(),
      ev<TimeoutEvent>({ type: 'timeout', setIndex: 0, team: 'home' }),
      ev<TimeoutEvent>({ type: 'timeout', setIndex: 0, team: 'away' }),
    ]);
    const s = deriveMatchState(m);
    expect(s.currentSet?.timeoutsUsed).toEqual({ home: 1, away: 1 });
  });
});

// ─── Edit / delete semantics ──────────────────────────────────────────────

describe('edit / delete event-log replays', () => {
  it('removeEventById drops the event and re-derives', () => {
    const p1 = point('home');
    const p2 = point('home');
    const p3 = point('home');
    const m = applyAll(newMatch(), [homeLineup(), awayLineup(), p1, p2, p3]);
    let s = deriveMatchState(m);
    expect(s.currentSet?.score.home).toBe(3);
    const m2 = removeEventById(m, p2.id);
    s = deriveMatchState(m2);
    expect(s.currentSet?.score.home).toBe(2);
  });

  it('deleting a sub mid-set re-derives the lineup correctly', () => {
    const sub1 = ev<SubEvent>({
      type: 'sub',
      setIndex: 0,
      team: 'home',
      out: 13,
      in: 17,
    });
    const m = applyAll(newMatch(), [
      homeLineup(),
      awayLineup(),
      sub1,
      point('home'),
      point('home'),
    ]);
    let s = deriveMatchState(m);
    expect(s.currentSet?.rotation.home.positions).toEqual([11, 12, 17, 14, 15, 16]);

    const m2 = removeEventById(m, sub1.id);
    s = deriveMatchState(m2);
    expect(s.currentSet?.rotation.home.positions).toEqual([11, 12, 13, 14, 15, 16]);
    expect(s.currentSet?.rotation.home.subsUsed).toBe(0);
    // points still applied
    expect(s.currentSet?.score.home).toBe(2);
  });

  it('deleting a set-end un-finalises that set', () => {
    const setEnd = ev<SetEndEvent>({
      type: 'set-end',
      setIndex: 0,
      homeFinal: 25,
      awayFinal: 19,
      durationMs: 1_500_000,
    });
    const m = applyAll(newMatch(), [
      homeLineup(),
      awayLineup(),
      // 25 home points + 19 away points to reach 25-19
      ...Array.from({ length: 25 }, () => point('home')),
      ...Array.from({ length: 19 }, () => point('away')),
      setEnd,
    ]);
    let s = deriveMatchState(m);
    expect(s.setHistory).toHaveLength(1);
    expect(s.setsWon).toEqual({ home: 1, away: 0 });
    expect(s.currentSet).toBeNull();

    const m2 = removeEventById(m, setEnd.id);
    s = deriveMatchState(m2);
    expect(s.setHistory).toHaveLength(0);
    expect(s.setsWon).toEqual({ home: 0, away: 0 });
    expect(s.currentSet).not.toBeNull();
    expect(s.currentSet?.score).toEqual({ home: 25, away: 19 });
  });
});

// ─── Match abandoned ──────────────────────────────────────────────────────

describe('match abandonment', () => {
  it('match-abandoned flips status and records the reason', () => {
    const abandoned = ev<MatchEvent>({
      type: 'match-abandoned',
      setIndex: 0,
      reason: 'Building evacuation',
    } as any);
    const m = applyAll(newMatch(), [homeLineup(), awayLineup(), point('home'), abandoned]);
    const s = deriveMatchState(m);
    expect(s.abandoned).toBe(true);
    expect(s.abandonedReason).toBe('Building evacuation');
    expect(s.matchComplete).toBe(true);
    expect(s.winner).toBeNull();
  });

  it('match-abandoned with awarded winner reflects that as the winner', () => {
    const abandoned = ev<MatchEvent>({
      type: 'match-abandoned',
      setIndex: 0,
      reason: 'Forfeit',
      awarded: { winner: 'home' },
    } as any);
    const m = applyAll(newMatch(), [homeLineup(), awayLineup(), abandoned]);
    const s = deriveMatchState(m);
    expect(s.abandoned).toBe(true);
    expect(s.winner).toBe('home');
  });
});

// ─── canApplyPoint sanity ─────────────────────────────────────────────────

describe('canApplyPoint', () => {
  it('OK during normal play', () => {
    const m = applyAll(newMatch(), [homeLineup(), awayLineup()]);
    const s = deriveMatchState(m);
    const r = canApplyPoint(s, point('home'));
    expect(r.warnings).toEqual([]);
  });
});

// ─── canApplyLiberoOff ────────────────────────────────────────────────────

describe('canApplyLiberoOff', () => {
  it('warns when no libero is currently on', () => {
    const m = applyAll(newMatch(), [homeLineup(), awayLineup()]);
    const s = deriveMatchState(m);
    const r = canApplyLiberoOff(
      s,
      ev<LiberoOffEvent>({
        type: 'libero-off',
        setIndex: 0,
        team: 'home',
        libero: 19,
        replacedBy: 16,
      })
    );
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

// ─── libero officially replaced (set-scope lockout) ───────────────────────

describe('libero-officially-replaced', () => {
  it('locks the libero out for the rest of the set', () => {
    const officialReplace = ev<LiberoOfficiallyReplacedEvent>({
      type: 'libero-officially-replaced',
      setIndex: 0,
      team: 'home',
      libero: 19,
      replacedBy: 17,
      reason: 'injury',
    });
    const m = applyAll(newMatch(), [
      homeLineup(),
      awayLineup(),
      ev<LiberoOnEvent>({
        type: 'libero-on',
        setIndex: 0,
        team: 'home',
        libero: 19,
        replaces: 16,
      }),
      officialReplace,
    ]);
    const s = deriveMatchState(m);
    expect(s.currentSet?.rotation.home.lockedOut).toContain(19);
    expect(s.currentSet?.rotation.home.liberoOnFloor).toBeNull();
    // The regular #17 is now on the floor in the libero's prior slot.
    expect(s.currentSet?.rotation.home.positions.includes(17)).toBe(true);
  });

  it('subsequent libero-on for the locked-out libero warns', () => {
    const m = applyAll(newMatch(), [
      homeLineup(),
      awayLineup(),
      ev<LiberoOnEvent>({
        type: 'libero-on',
        setIndex: 0,
        team: 'home',
        libero: 19,
        replaces: 16,
      }),
      ev<LiberoOfficiallyReplacedEvent>({
        type: 'libero-officially-replaced',
        setIndex: 0,
        team: 'home',
        libero: 19,
        replacedBy: 17,
      }),
    ]);
    const s = deriveMatchState(m);
    const tryReturn = ev<LiberoOnEvent>({
      type: 'libero-on',
      setIndex: 0,
      team: 'home',
      libero: 19,
      replaces: 15,
    });
    const r = canApplyLiberoOn(s, tryReturn, {
      home: homeRoster,
      away: awayRoster,
    });
    expect(r.warnings.some((w) => /officially replaced/i.test(w))).toBe(true);
  });

  it('canApplyLiberoOfficiallyReplaced warns when replacement is another libero', () => {
    // home roster's second libero shirt is 109 (offset 10 + 99)
    const m = applyAll(newMatch(), [
      ev<LineupEvent>({
        type: 'lineup',
        setIndex: 0,
        team: 'home',
        positions: [11, 12, 13, 14, 15, 16],
        liberos: [19, 109],
      }),
      awayLineup(),
    ]);
    const s = deriveMatchState(m);
    const e = ev<LiberoOfficiallyReplacedEvent>({
      type: 'libero-officially-replaced',
      setIndex: 0,
      team: 'home',
      libero: 19,
      replacedBy: 109, // another designated libero — unusual
    });
    const r = canApplyLiberoOfficiallyReplaced(s, e, {
      home: homeRoster,
      away: awayRoster,
    });
    expect(r.warnings.some((w) => /should normally be a regular/i.test(w))).toBe(
      true
    );
  });
});

// ─── FIVB sub rule ────────────────────────────────────────────────────────

describe('substitution caps (V-C vs FIVB)', () => {
  it('V-C: warns at the 13th sub event in a set', () => {
    // Set the team up with all 6 starters; cycle through 12 paired
    // subs — the 13th individual event triggers the warning.
    const events: MatchEvent[] = [homeLineup(), awayLineup()];
    // Cycle 13 subs across 13 distinct shirts (out=13 swapped 6 times,
    // re-using #17 vs starter #13 etc.). For simplicity here, fire
    // 12 valid sub events that each create a NEW pair, then a 13th.
    const starters = [11, 12, 13, 14, 15, 16];
    const bench = [17, 18];
    // 12 individual sub events: alternate two starters with two bench
    // shirts swapping back and forth six times.
    for (let i = 0; i < 12; i++) {
      const out = i % 2 === 0 ? 11 : 17;
      const inn = i % 2 === 0 ? 17 : 11;
      events.push(
        ev<SubEvent>({
          type: 'sub',
          setIndex: 0,
          team: 'home',
          out,
          in: inn,
        })
      );
    }
    const m = applyAll(newMatch(), events);
    const s = deriveMatchState(m);
    const thirteenth = ev<SubEvent>({
      type: 'sub',
      setIndex: 0,
      team: 'home',
      out: 11,
      in: 17,
    });
    const r = canApplySub(
      s,
      thirteenth,
      { home: homeRoster, away: awayRoster },
      'vc'
    );
    expect(r.warnings.some((w) => /V-C cap/i.test(w))).toBe(true);
  });

  it('FIVB: 6 in/out cycles within a single pair stay under cap', () => {
    // FIVB counts pairs, not individual events. Cycle 11 ↔ 17 four
    // times — that's 4 events but only 1 pair.
    const events: MatchEvent[] = [homeLineup(), awayLineup()];
    for (let i = 0; i < 4; i++) {
      const out = i % 2 === 0 ? 11 : 17;
      const inn = i % 2 === 0 ? 17 : 11;
      events.push(
        ev<SubEvent>({ type: 'sub', setIndex: 0, team: 'home', out, in: inn })
      );
    }
    const m = applyAll(newMatch(), events);
    const s = deriveMatchState(m);
    const next = ev<SubEvent>({
      type: 'sub',
      setIndex: 0,
      team: 'home',
      out: 11,
      in: 17,
    });
    const r = canApplySub(
      s,
      next,
      { home: homeRoster, away: awayRoster },
      'fivb'
    );
    // Only 1 pair (11↔17) so far; this swap stays within it.
    expect(r.warnings.some((w) => /FIVB cap/i.test(w))).toBe(false);
  });

  it('FIVB: opening a 7th pair triggers the warning', () => {
    const events: MatchEvent[] = [homeLineup(), awayLineup()];
    // Add 6 unique pairs by subbing each starter for a distinct bench
    // shirt. Roster has shirts 11..18 for regulars; we have 6 starters
    // (11..16) and 2 bench regulars (17, 18). That's only 2 unique
    // pairs available from active regulars. To exercise the 6-pair
    // cap properly we'd need a deeper bench in the fixture; sufficient
    // for this test is to assert the behaviour on a single pair, then
    // synthesise the cap by subPairs surface.
    // Instead, build subPairs of length 6 manually by firing 6 subs,
    // each from a fresh starter to a new shirt that's also active.
    // We'll temporarily extend the roster for this test.
    const extendedHome = [
      ...homeRoster,
      ...[101, 102, 103, 104, 105, 106].map((shirt) => ({
        shirt,
        name: `H+${shirt}`,
        isLibero: false,
        active: true,
      })),
    ];
    const subEvents = [11, 12, 13, 14, 15, 16].map((s, i) =>
      ev<SubEvent>({
        type: 'sub',
        setIndex: 0,
        team: 'home',
        out: s,
        in: 101 + i,
      })
    );
    const m = applyAll(
      createMatch(baseMeta, { home: extendedHome, away: awayRoster }),
      [homeLineup(), awayLineup(), ...subEvents]
    );
    const s = deriveMatchState(m);
    // The seventh pair would require a starter not yet involved. Our
    // starters are exhausted — so any new sub between fresh shirts
    // creates a new pair.
    const seventh = ev<SubEvent>({
      type: 'sub',
      setIndex: 0,
      team: 'home',
      out: 101, // came in earlier as a replacement
      in: 18,    // a bench shirt not yet involved → new pair
    });
    const r = canApplySub(
      s,
      seventh,
      { home: extendedHome, away: awayRoster },
      'fivb'
    );
    expect(r.warnings.some((w) => /FIVB cap/i.test(w))).toBe(true);
  });
});

// ─── Signoff events ───────────────────────────────────────────────────────

describe('signoff events', () => {
  it('aggregates each party into MatchState.signoff', () => {
    const m = applyAll(newMatch(), [
      homeLineup(),
      awayLineup(),
      ev<SignoffEvent>({
        type: 'signoff',
        setIndex: 0,
        party: 'home-captain',
      }),
      ev<SignoffEvent>({
        type: 'signoff',
        setIndex: 0,
        party: 'scorer',
      }),
    ]);
    const s = deriveMatchState(m);
    expect(s.signoff.homeCaptainAtMs).toBeGreaterThan(0);
    expect(s.signoff.scorerAtMs).toBeGreaterThan(0);
    expect(s.signoff.awayCaptainAtMs).toBeUndefined();
  });

  it('first signoff per party wins; later events for same party are ignored', () => {
    const first = ev<SignoffEvent>({
      type: 'signoff',
      setIndex: 0,
      party: 'home-captain',
    });
    const second = ev<SignoffEvent>({
      type: 'signoff',
      setIndex: 0,
      party: 'home-captain',
    });
    const m = applyAll(newMatch(), [homeLineup(), awayLineup(), first, second]);
    const s = deriveMatchState(m);
    expect(s.signoff.homeCaptainAtMs).toBe(first.ts);
  });
});

// ─── Beach format scenarios ────────────────────────────────────────────────
//
// Beach volleyball uses the SAME scoring engine as indoor — same point /
// set / match state machine, same rally-scoring rules — but with format
// differences: sets to 21 (decider to 15), 2 players per side, no libero,
// no rotation positions (the engine still tracks positions but the UI
// hides them). These tests lock the format-defaults path: a beach match
// configured with setTargets={21,15,2} must reach matchOver at the right
// totals without the engine fighting the lower targets.

describe('beach format', () => {
  const beachMeta: Partial<MatchMeta> = {
    sport: 'beach',
    setTargets: { regular: 21, decider: 15, winBy: 2 },
    bestOf: 3,
  };

  // Beach lineup is a synthesised [a,b,a,b,a,b] — two real players, but
  // the engine still wants 6-position arrays for compatibility.
  function beachHomeLineup(setIndex = 0): LineupEvent {
    return ev<LineupEvent>({
      type: 'lineup',
      setIndex,
      team: 'home',
      positions: [11, 12, 11, 12, 11, 12],
      liberos: [],
    });
  }
  function beachAwayLineup(setIndex = 0): LineupEvent {
    return ev<LineupEvent>({
      type: 'lineup',
      setIndex,
      team: 'away',
      positions: [21, 22, 21, 22, 21, 22],
      liberos: [],
    });
  }

  function pointsTo(team: Side, count: number, setIndex = 0): PointEvent[] {
    return Array.from({ length: count }, () => point(team, setIndex));
  }

  function setEnd(setIndex: number, homeFinal: number, awayFinal: number): SetEndEvent {
    return ev<SetEndEvent>({
      type: 'set-end',
      setIndex,
      homeFinal,
      awayFinal,
      durationMs: 1500_000,
    });
  }

  it('two-set sweep ends the match (best-of-3, sets to 21)', () => {
    const m = applyAll(newMatch(beachMeta), [
      beachHomeLineup(0),
      beachAwayLineup(0),
      ...pointsTo('home', 21, 0),
      setEnd(0, 21, 0),
      beachHomeLineup(1),
      beachAwayLineup(1),
      ...pointsTo('home', 21, 1),
      setEnd(1, 21, 0),
    ]);
    const s = deriveMatchState(m);
    expect(s.matchComplete).toBe(true);
    expect(s.winner).toBe('home');
    expect(s.setsWon).toEqual({ home: 2, away: 0 });
    expect(s.setHistory).toHaveLength(2);
    expect(s.setHistory[0]!.homeFinal).toBe(21);
    expect(s.setHistory[1]!.homeFinal).toBe(21);
  });

  it('three-set match: decider plays to 15, not 25 or 21', () => {
    const m = applyAll(newMatch(beachMeta), [
      beachHomeLineup(0),
      beachAwayLineup(0),
      ...pointsTo('home', 21, 0),
      setEnd(0, 21, 19),
      beachHomeLineup(1),
      beachAwayLineup(1),
      ...pointsTo('away', 21, 1),
      setEnd(1, 18, 21),
      beachHomeLineup(2),
      beachAwayLineup(2),
      ...pointsTo('home', 15, 2),
      setEnd(2, 15, 10),
    ]);
    const s = deriveMatchState(m);
    expect(s.matchComplete).toBe(true);
    expect(s.winner).toBe('home');
    expect(s.setHistory).toHaveLength(3);
    expect(s.setHistory[2]!.homeFinal).toBe(15);
    expect(s.setHistory[2]!.awayFinal).toBe(10);
  });

  it('canApplySetEnd flags no warnings for 21-0 (valid set end on beach)', () => {
    const m = applyAll(newMatch(beachMeta), [
      beachHomeLineup(),
      beachAwayLineup(),
      ...pointsTo('home', 21),
    ]);
    const state = deriveMatchState(m);
    const result = canApplySetEnd(state, setEnd(0, 21, 0));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('canApplySetEnd warns when set ended at 20-20 (target not reached AND winBy not satisfied)', () => {
    const m = applyAll(newMatch(beachMeta), [
      beachHomeLineup(),
      beachAwayLineup(),
      ...pointsTo('home', 20),
      ...pointsTo('away', 20),
    ]);
    const state = deriveMatchState(m);
    const result = canApplySetEnd(state, setEnd(0, 20, 20));
    // Engine never hard-rejects (lets the user override) but emits
    // warnings for both target-not-reached and winBy-not-satisfied.
    // The "target was 21" wording in the warning confirms the engine
    // used the beach target, not the default 25.
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join(' ')).toMatch(/target was 21/);
    expect(result.warnings.join(' ')).toMatch(/at least 2/);
  });
});
