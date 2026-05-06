// ── Tier 2 match engine ────────────────────────────────────────────────────
//
// PURE TypeScript. No React, no AsyncStorage, no platform deps. Tests
// can import this directly under vitest with no shims. The persistence
// wrapper that talks to AsyncStorage lives in scoredMatchStore.ts.
//
// Public API:
//   • deriveMatchState(match): MatchState
//   • appendEvent(match, event): Match
//   • applyEvent(match, event): Match           // alias of appendEvent
//   • removeEventById(match, id): Match         // for undo / scrub-edit
//   • replaceEvent(match, id, next): Match       // edit-in-place
//   • canApply<EventType>(state, event): { ok, warnings }
//   • createMatch(meta, rosters): Match          // factory
//   • makeEventId(): string                      // local id helper
//
// Citations & rule sources:
//   FIVB Official Rules of the Game 2021–2024 (rotation, libero §19, subs §15)
//   Volleyball Canada Domestic Competition Regulations (libero-may-serve,
//     two-libero allowance, sub limits up to 12 per set)
//   OVA Officials' Resources (sanction levels, paper-scoresheet field labels)
//
// Areas where I couldn't unambiguously verify the FIVB / V-C rule and
// have surfaced a TODO are tagged "RULE-CHECK:" inline below — search
// for that string when chasing rule details.
// ────────────────────────────────────────────────────────────────────────────

import type {
  Match,
  MatchEvent,
  MatchMeta,
  MatchState,
  RosterPlayer,
  RotationState,
  SetSummary,
  Side,
  Lineup,
  Position,
  LineupEvent,
  PointEvent,
  SubEvent,
  LiberoOnEvent,
  LiberoOffEvent,
  LiberoOfficiallyReplacedEvent,
  TimeoutEvent,
  SanctionEvent,
  SetEndEvent,
  ValidationResult,
} from '../types/match';

// ─── Public factory ────────────────────────────────────────────────────────

export function createMatch(
  meta: MatchMeta,
  rosters: { home: RosterPlayer[]; away: RosterPlayer[] }
): Match {
  const now = Date.now();
  return {
    id: makeMatchId(),
    meta,
    events: [],
    rosters,
    status: 'in-progress',
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
  };
}

// ─── Local id helpers ──────────────────────────────────────────────────────
//
// Vitest runs in node where `crypto.randomUUID` exists; React Native 0.81
// also has `globalThis.crypto.randomUUID` available via Hermes. We probe
// both at runtime and fall back to a small Math.random()-based v4-ish
// helper so the engine has a portable, dependency-free id source.

function rand4(): string {
  return Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0');
}

function fallbackUuid(): string {
  // Not RFC4122-correct but unique enough for local match ids.
  return `${rand4()}${rand4()}-${rand4()}-${rand4()}-${rand4()}-${rand4()}${rand4()}${rand4()}`;
}

export function makeMatchId(): string {
  const c: any = (globalThis as any).crypto;
  return c?.randomUUID ? `m_${c.randomUUID()}` : `m_${fallbackUuid()}`;
}

export function makeEventId(): string {
  const c: any = (globalThis as any).crypto;
  return c?.randomUUID ? `e_${c.randomUUID()}` : `e_${fallbackUuid()}`;
}

// ─── Append / edit / remove ────────────────────────────────────────────────

export function appendEvent(match: Match, event: MatchEvent): Match {
  return {
    ...match,
    events: [...match.events, event],
    updatedAt: Date.now(),
  };
}

/** Alias kept because the original spec called for both names. */
export const applyEvent = appendEvent;

export function removeEventById(match: Match, eventId: string): Match {
  const next = match.events.filter((e) => e.id !== eventId);
  if (next.length === match.events.length) return match;
  return { ...match, events: next, updatedAt: Date.now() };
}

export function replaceEvent(
  match: Match,
  eventId: string,
  replacement: MatchEvent
): Match {
  const idx = match.events.findIndex((e) => e.id === eventId);
  if (idx < 0) return match;
  const next = match.events.slice();
  next[idx] = replacement;
  return { ...match, events: next, updatedAt: Date.now() };
}

// ─── Rotation primitive ────────────────────────────────────────────────────
//
// Volleyball clockwise rotation when the team gains the serve. Player in
// position II moves to I (becomes the new server); the former server in
// I moves to VI; everyone else moves one slot in the same direction.
//
//   Before: [I, II, III, IV, V, VI]
//   After:  [II, III, IV, V, VI, I]
//
// So in array terms the player at index 0 wraps to index 5 and everyone
// else shifts down one index.

export function rotate(positions: Lineup): Lineup {
  const [a, b, c, d, e, f] = positions;
  return [b, c, d, e, f, a];
}

// ─── Server resolution ────────────────────────────────────────────────────
//
// Standard case: server = positions[0] (position I).
// Libero-may-serve case (V-C youth divisions): if the team has
// liberoMayServe enabled AND the lineup declared a serve slot, the
// libero serves only when the rotation has put their replaced regular
// into position I. Practically: if the libero is currently on AND the
// shirt in position I matches the libero's replaces-shirt, the libero
// serves; else the regular in position I serves.
//
// RULE-CHECK: V-C interprets this as "libero serves from one rotation
// only, declared at lineup time". The implementation here uses
// `serveLiberoFromPosition` as a reference slot — when the lineup said
// the libero serves at position I, that means whenever the original
// rotation puts the libero's replaced shirt at position I, libero
// serves. If your division actually scopes it differently (some rules
// permit the libero to serve in the position they're CURRENTLY filling,
// not the original slot), this needs revisiting. See V-C DCR §11.4.

function resolveServerShirt(rot: RotationState): number {
  const regularInPosI = rot.positions[0];
  if (
    rot.liberoOnFloor != null &&
    rot.liberoReplacesShirt === regularInPosI &&
    rot.serveLiberoFromPosition != null
  ) {
    return rot.liberoOnFloor;
  }
  return regularInPosI;
}

// ─── First-server-of-set determination ─────────────────────────────────────
//
// Set 1: from the coin toss. Sets 2..N: alternate. Deciding set: V-C
// allows another coin toss; we don't have a UI affordance for that yet,
// so we keep alternating. RULE-CHECK: if a tournament re-tosses for the
// deciding set, the user can fire an explicit "set first server" event
// (not yet modelled — punt to phase 5 if scorers complain).

function firstServerForSet(setIndex: number, coinTossServe: Side | null): Side {
  const start: Side = coinTossServe ?? 'home';
  return setIndex % 2 === 0 ? start : (start === 'home' ? 'away' : 'home');
}

/**
 * Per FIVB §19.3.2: a libero may NEVER play in a front-row position. When
 * a rotation sweeps the libero into II / III / IV, the engine itself
 * has to take them off the floor — relying on a UI-level useEffect to
 * detect this is fragile (a fast scorer could log multiple rallies
 * before React commits, and a stale render could leave the libero
 * playing front court). This helper runs after every rotation: if the
 * libero is now in a front-row position (lineup tuple indices 1, 2, 3),
 * swap them back out for the original `liberoReplacesShirt` regular and
 * stamp `liberoCameOffAtRally` so the one-rally-rest validator behaves.
 *
 * Returns the updated rotation; pass-through when no change is needed.
 */
function autoSwapLiberoOffIfFront(rot: RotationState, currentRallyCount: number): RotationState {
  if (rot.liberoOnFloor == null || rot.liberoReplacesShirt == null) return rot;
  const liberoIdx = rot.positions.indexOf(rot.liberoOnFloor);
  if (liberoIdx < 0) return rot;
  // Front-row positions are II, III, IV → tuple indices 1, 2, 3.
  if (liberoIdx !== 1 && liberoIdx !== 2 && liberoIdx !== 3) return rot;
  const next = rot.positions.slice() as Lineup;
  next[liberoIdx] = rot.liberoReplacesShirt;
  return {
    ...rot,
    positions: next,
    liberoOnFloor: null,
    liberoReplacesShirt: null,
    liberoCameOffAtRally: currentRallyCount,
  };
}

// ─── deriveMatchState — the heart of the engine ───────────────────────────

const FRONT_ROW: Position[] = [2, 3, 4]; // II, III, IV
const BACK_ROW: Position[] = [1, 5, 6];  // I, V, VI

function emptyRotation(): RotationState {
  return {
    positions: [0, 0, 0, 0, 0, 0],
    liberos: [],
    liberoOnFloor: null,
    liberoReplacesShirt: null,
    liberoCameOffAtRally: null,
    serveLiberoFromPosition: null,
    subPairs: [],
    subsUsed: 0,
    lockedOut: [],
  };
}

export function deriveMatchState(match: Match): MatchState {
  const setsToWin = setsToWinForBestOf(match.meta.bestOf);
  const target = match.meta.setTargets;

  const setHistory: SetSummary[] = [];
  const sanctions: SanctionEvent[] = [];
  let setsHome = 0;
  let setsAway = 0;
  let abandoned = false;
  let abandonedReason: string | undefined;
  let abandonedAwarded: Side | null = null;
  // Aggregate signoff state — derived from `signoff` events.
  const signoff: MatchState['signoff'] = {};

  // Per-set replay buffer — reset each time we see a new set's lineup.
  let currentSetIndex = 0;
  let scoreHome = 0;
  let scoreAway = 0;
  let rallyCount = 0;
  let server: Side | null = null;
  let homeRot: RotationState = emptyRotation();
  let awayRot: RotationState = emptyRotation();
  let homeTimeouts = 0;
  let awayTimeouts = 0;
  let setStartTs: number | null = null;
  let setEnded = false;
  let lineupSeen: { home: boolean; away: boolean } = { home: false, away: false };
  let setEndDuration = 0;

  function resetForSet(idx: number) {
    currentSetIndex = idx;
    scoreHome = 0;
    scoreAway = 0;
    rallyCount = 0;
    server = null;
    homeRot = emptyRotation();
    awayRot = emptyRotation();
    homeTimeouts = 0;
    awayTimeouts = 0;
    setStartTs = null;
    setEnded = false;
    lineupSeen = { home: false, away: false };
    setEndDuration = 0;
  }

  for (const ev of match.events) {
    // The set this event belongs to — if it advances past the current
    // working set, we treat that as an implicit set roll-over (which
    // shouldn't happen in normal play, but we tolerate it on replay
    // when an earlier set-end event was deleted via the scrubber).
    if (ev.setIndex !== currentSetIndex && !setEnded) {
      // event jumped to a later set — close the current set silently
      // (no SetSummary; data is incomplete).
      resetForSet(ev.setIndex);
    } else if (setEnded && ev.setIndex !== currentSetIndex) {
      resetForSet(ev.setIndex);
    }

    switch (ev.type) {
      case 'lineup': {
        const rot: RotationState = {
          positions: ev.positions.slice() as Lineup,
          liberos: ev.liberos.slice(),
          liberoOnFloor: null,
          liberoReplacesShirt: null,
          liberoCameOffAtRally: null,
          serveLiberoFromPosition: ev.serveLiberoFromPosition ?? null,
          subPairs: [],
          subsUsed: 0,
          lockedOut: [],
        };
        if (ev.team === 'home') homeRot = rot;
        else awayRot = rot;
        lineupSeen = { ...lineupSeen, [ev.team]: true };

        if (lineupSeen.home && lineupSeen.away && server == null) {
          // Prefer an explicit per-set override on either team's lineup
          // event. Falls back to alternation from the coin toss.
          const homeOverride = match.events.find(
            (e): e is LineupEvent =>
              e.type === 'lineup' && e.team === 'home' && e.setIndex === currentSetIndex && e.firstServer != null
          )?.firstServer;
          const awayOverride = match.events.find(
            (e): e is LineupEvent =>
              e.type === 'lineup' && e.team === 'away' && e.setIndex === currentSetIndex && e.firstServer != null
          )?.firstServer;
          server =
            homeOverride ??
            awayOverride ??
            firstServerForSet(currentSetIndex, match.meta.coinToss?.serve ?? null);
        }
        if (setStartTs == null) setStartTs = ev.ts;
        break;
      }

      case 'point': {
        rallyCount++;
        if (ev.scoringTeam === 'home') scoreHome++;
        else scoreAway++;

        // Rotation: scoring team rotates only if they were NOT serving.
        if (server == null) {
          // First rally of the set with no lineup-derived server. Treat
          // the scoring team as the new server (degenerate path; the
          // lineup event should have set this).
          server = ev.scoringTeam;
        } else if (ev.scoringTeam !== server) {
          // Side-out → new serving team rotates.
          if (ev.scoringTeam === 'home') {
            homeRot = { ...homeRot, positions: rotate(homeRot.positions) };
            homeRot = autoSwapLiberoOffIfFront(homeRot, rallyCount);
          } else {
            awayRot = { ...awayRot, positions: rotate(awayRot.positions) };
            awayRot = autoSwapLiberoOffIfFront(awayRot, rallyCount);
          }
          server = ev.scoringTeam;
        }
        break;
      }

      case 'sub': {
        const rot = ev.team === 'home' ? homeRot : awayRot;
        const idx = rot.positions.indexOf(ev.out);
        if (idx >= 0) {
          const next = rot.positions.slice() as Lineup;
          next[idx] = ev.in;
          // Track sub pairs — for re-entry validation in the validator.
          // If the outgoing player was a starter (no prior pair), this
          // creates a starter→replacement pair. If the outgoing player
          // was the replacement of an earlier pair, that pair is
          // re-completed (the starter has come back).
          let newPairs = rot.subPairs.slice();
          const matchAsStarter = newPairs.find((p) => p.starter === ev.out);
          const matchAsRepl = newPairs.find((p) => p.replacement === ev.out);
          if (matchAsStarter && matchAsStarter.replacement === ev.in) {
            // re-entry of the starter — pair is "closed" for this set
            // (FIVB allows only one in/out cycle per starter per set).
            // No additional bookkeeping needed beyond keeping the pair.
          } else if (matchAsRepl && matchAsRepl.starter === ev.in) {
            // starter coming back on for their replacement — same case.
          } else {
            // New pair — outgoing is the starter, incoming is the replacement.
            newPairs.push({ starter: ev.out, replacement: ev.in });
          }
          const updated: RotationState = {
            ...rot,
            positions: next,
            subPairs: newPairs,
            subsUsed: rot.subsUsed + 1,
          };
          if (ev.team === 'home') homeRot = updated;
          else awayRot = updated;
        }
        break;
      }

      case 'libero-on': {
        const rot = ev.team === 'home' ? homeRot : awayRot;
        const idx = rot.positions.indexOf(ev.replaces);
        if (idx >= 0) {
          const next = rot.positions.slice() as Lineup;
          next[idx] = ev.libero;
          const updated: RotationState = {
            ...rot,
            positions: next,
            liberoOnFloor: ev.libero,
            liberoReplacesShirt: ev.replaces,
          };
          if (ev.team === 'home') homeRot = updated;
          else awayRot = updated;
        }
        break;
      }

      case 'libero-off': {
        const rot = ev.team === 'home' ? homeRot : awayRot;
        const idx = rot.positions.indexOf(ev.libero);
        if (idx >= 0) {
          const next = rot.positions.slice() as Lineup;
          next[idx] = ev.replacedBy;
          const updated: RotationState = {
            ...rot,
            positions: next,
            liberoOnFloor: null,
            liberoReplacesShirt: null,
            liberoCameOffAtRally: rallyCount,
          };
          if (ev.team === 'home') homeRot = updated;
          else awayRot = updated;
        }
        break;
      }

      case 'libero-officially-replaced': {
        // Permanent (set-scope) replacement of a libero by a regular —
        // distinct from a routine `libero-off` because the replaced
        // libero is locked out of re-entry for the rest of the set
        // (FIVB §19.4.2). We update positions either by replacing the
        // libero on the floor OR (if the libero wasn't on) by simply
        // adding to the lockedOut list.
        const rot = ev.team === 'home' ? homeRot : awayRot;
        const idx = rot.positions.indexOf(ev.libero);
        const next = rot.positions.slice() as Lineup;
        if (idx >= 0) next[idx] = ev.replacedBy;
        const updated: RotationState = {
          ...rot,
          positions: next,
          liberoOnFloor: rot.liberoOnFloor === ev.libero ? null : rot.liberoOnFloor,
          liberoReplacesShirt:
            rot.liberoOnFloor === ev.libero ? null : rot.liberoReplacesShirt,
          liberoCameOffAtRally:
            rot.liberoOnFloor === ev.libero ? rallyCount : rot.liberoCameOffAtRally,
          lockedOut: rot.lockedOut.includes(ev.libero)
            ? rot.lockedOut
            : [...rot.lockedOut, ev.libero],
        };
        if (ev.team === 'home') homeRot = updated;
        else awayRot = updated;
        break;
      }

      case 'timeout': {
        if (ev.team === 'home') homeTimeouts++;
        else awayTimeouts++;
        break;
      }

      case 'sanction': {
        sanctions.push(ev);
        break;
      }

      case 'signoff': {
        // First signoff per party wins; later events for the same
        // party are ignored (avoids accidental double-tap noise).
        if (ev.party === 'home-captain' && signoff.homeCaptainAtMs == null) {
          signoff.homeCaptainAtMs = ev.ts;
        } else if (ev.party === 'away-captain' && signoff.awayCaptainAtMs == null) {
          signoff.awayCaptainAtMs = ev.ts;
        } else if (ev.party === 'scorer' && signoff.scorerAtMs == null) {
          signoff.scorerAtMs = ev.ts;
        }
        break;
      }

      case 'set-end': {
        const winner: Side = ev.homeFinal > ev.awayFinal ? 'home' : 'away';
        if (winner === 'home') setsHome++;
        else setsAway++;
        setHistory.push({
          setIndex: ev.setIndex,
          homeFinal: ev.homeFinal,
          awayFinal: ev.awayFinal,
          winner,
          durationMs: ev.durationMs,
        });
        setEnded = true;
        setEndDuration = ev.durationMs;
        break;
      }

      case 'match-end': {
        setEnded = true;
        break;
      }

      case 'match-abandoned': {
        abandoned = true;
        abandonedReason = ev.reason;
        abandonedAwarded = ev.awarded?.winner ?? null;
        break;
      }
    }
  }

  // Final state assembly.
  const matchEndedByEvent = match.events.some(
    (e) => e.type === 'match-end' || e.type === 'match-abandoned'
  );
  const matchComplete =
    matchEndedByEvent ||
    setsHome >= setsToWin ||
    setsAway >= setsToWin;

  let winner: Side | 'tie' | null = null;
  if (abandoned) {
    winner = abandonedAwarded ?? null;
  } else if (matchComplete) {
    winner =
      setsHome > setsAway ? 'home' : setsAway > setsHome ? 'away' : 'tie';
  }

  const isDecider = isDecidingSet(setsHome, setsAway, match.meta.bestOf);
  const currentSetTarget = isDecider ? target.decider : target.regular;
  const serverShirt = server
    ? resolveServerShirt(server === 'home' ? homeRot : awayRot)
    : null;

  return {
    currentSetIndex,
    setsWon: { home: setsHome, away: setsAway },
    matchComplete,
    abandoned,
    abandonedReason,
    winner,
    currentSet: setEnded || abandoned
      ? null
      : {
          score: { home: scoreHome, away: scoreAway },
          rallyCount,
          server,
          serverShirt,
          rotation: { home: homeRot, away: awayRot },
          timeoutsUsed: { home: homeTimeouts, away: awayTimeouts },
          target: currentSetTarget,
          isDecider,
        },
    setHistory,
    sanctions,
    signoff,
  };
}

function setsToWinForBestOf(bestOf: MatchMeta['bestOf']): number {
  // Odd N = race to ceil(N/2). Even N = play all (handled by caller via
  // matchComplete logic; setsToWin returns N/2+1 so the "either side
  // hits this" condition never triggers for even formats — match-end
  // for even formats is fired explicitly by the user).
  // RULE-CHECK: even-format matches usually don't appear in V-C youth
  // play, but the data model supports them. If a club wants strictly
  // best-of-2, they call match-end manually after the second set.
  if (bestOf % 2 === 1) return Math.ceil(bestOf / 2);
  return bestOf / 2 + 1; // unreachable threshold for even N
}

function isDecidingSet(
  setsHome: number,
  setsAway: number,
  bestOf: MatchMeta['bestOf']
): boolean {
  if (bestOf % 2 === 0) return false;
  const need = Math.ceil(bestOf / 2);
  return setsHome === need - 1 && setsAway === need - 1;
}

// ─── Validators ────────────────────────────────────────────────────────────
//
// Bias is warn-and-allow-override. Each validator returns warnings that
// the UI surfaces in a non-blocking modal; the engine doesn't refuse to
// append the event. Hard schema problems (missing fields, invalid types)
// are still TypeScript errors at the caller — those don't reach here.

function ok(): ValidationResult {
  return { ok: true, warnings: [] };
}
function warn(...warnings: string[]): ValidationResult {
  return { ok: true, warnings };
}

export function canApplyPoint(state: MatchState, _event: PointEvent): ValidationResult {
  if (state.matchComplete && !state.abandoned) {
    return warn('Match is already complete; the rally will reopen the current set.');
  }
  if (state.abandoned) {
    return warn('Match was abandoned; the point will reopen scoring.');
  }
  if (!state.currentSet) {
    return warn('No active set — the point will start a new set without a lineup.');
  }
  return ok();
}

export function canApplySub(
  state: MatchState,
  event: SubEvent,
  rosters: { home: RosterPlayer[]; away: RosterPlayer[] },
  subRule: 'fivb' | 'vc' = 'vc'
): ValidationResult {
  if (!state.currentSet) {
    return warn('Subs require an active set.');
  }
  const rot = state.currentSet.rotation[event.team];
  const roster = rosters[event.team];

  const warnings: string[] = [];

  if (!rot.positions.includes(event.out)) {
    warnings.push(
      `#${event.out} is not currently on the floor and cannot be subbed off.`
    );
  }
  if (rot.positions.includes(event.in)) {
    warnings.push(`#${event.in} is already on the floor.`);
  }
  if (!roster.find((p) => p.shirt === event.in && p.active)) {
    warnings.push(`#${event.in} is not in the team's active roster.`);
  }

  // Substitution-cap rule branches on subRule.
  //   V-C: 12 individual sub events per team per set.
  //   FIVB: 6 unique sub PAIRS per team per set. A sub that swaps
  //         within an existing pair (starter ↔ replacement) doesn't
  //         add a new pair; everything else does.
  if (subRule === 'vc') {
    if (rot.subsUsed >= 12) {
      warnings.push(
        `${event.team} has used 12 substitutions already this set (V-C cap).`
      );
    }
  } else {
    const inExistingPair = rot.subPairs.some(
      (p) =>
        (p.starter === event.out && p.replacement === event.in) ||
        (p.starter === event.in && p.replacement === event.out)
    );
    if (!inExistingPair && rot.subPairs.length >= 6) {
      warnings.push(
        `${event.team} has used 6 substitution pairs already this set (FIVB cap).`
      );
    }
  }

  // Re-entry: if a starter has come off, they may only return for the
  // player who replaced them. Likewise the replacement may only re-enter
  // for that same starter. (FIVB §15.6.)
  const asStarter = rot.subPairs.find((p) => p.starter === event.out);
  const asRepl = rot.subPairs.find((p) => p.replacement === event.out);
  const otherStarter = rot.subPairs.find((p) => p.starter === event.in);
  const otherRepl = rot.subPairs.find((p) => p.replacement === event.in);
  if (asRepl && asRepl.starter !== event.in) {
    warnings.push(
      `Replacement #${event.out} can only re-exit for their original starter (#${asRepl.starter}).`
    );
  }
  if (otherStarter && otherStarter.replacement !== event.out) {
    warnings.push(
      `Starter #${event.in} can only re-enter for their replacement (#${otherStarter.replacement}).`
    );
  }
  if (otherRepl && otherRepl.starter !== event.out) {
    warnings.push(
      `Replacement #${event.in} can only re-enter for the player they replaced (#${otherRepl.starter}).`
    );
  }
  if (asStarter && asStarter.replacement !== event.in) {
    // Starter going off again — but our data already shows them on the
    // floor. This is a legal repeat sub IF the replacement is the
    // original. Otherwise it's irregular.
    warnings.push(
      `Starter #${event.out} can only be replaced again by #${asStarter.replacement}.`
    );
  }

  return warnings.length ? warn(...warnings) : ok();
}

export function canApplyLiberoOn(
  state: MatchState,
  event: LiberoOnEvent,
  rosters: { home: RosterPlayer[]; away: RosterPlayer[] }
): ValidationResult {
  if (!state.currentSet) return warn('Libero replacement requires an active set.');
  const rot = state.currentSet.rotation[event.team];
  const warnings: string[] = [];

  if (!rot.liberos.includes(event.libero)) {
    warnings.push(
      `#${event.libero} is not designated as a libero for this set.`
    );
  }
  if (rot.liberoOnFloor != null) {
    warnings.push(
      `Libero #${rot.liberoOnFloor} is already on the floor; only one libero can be active at a time.`
    );
  }
  // Replaces must be in a back-row position.
  const idx = rot.positions.indexOf(event.replaces);
  if (idx < 0) {
    warnings.push(`#${event.replaces} is not currently on the floor.`);
  } else {
    const pos = (idx + 1) as Position; // 1..6
    if (!BACK_ROW.includes(pos)) {
      warnings.push(
        `#${event.replaces} is in front-row position ${pos}; libero may only replace back-row players (I, V, VI).`
      );
    }
  }
  // One-rally-rest rule: libero re-entering must wait at least one
  // completed rally since they last came off (FIVB §19.3.2.3). The
  // rally where they came off counts as rally N; they may return at
  // rally N+2 or later.
  if (
    rot.liberoCameOffAtRally != null &&
    state.currentSet.rallyCount - rot.liberoCameOffAtRally < 1
  ) {
    warnings.push(
      'Libero must rest at least one rally before re-entering the court.'
    );
  }
  // Roster check.
  const roster = rosters[event.team];
  const r = roster.find((p) => p.shirt === event.libero);
  if (!r) {
    warnings.push(`Libero #${event.libero} is not in the team's roster.`);
  } else if (!r.isLibero) {
    warnings.push(`#${event.libero} is not flagged as a libero in the roster.`);
  }
  if (rot.lockedOut.includes(event.libero)) {
    warnings.push(
      `Libero #${event.libero} was officially replaced earlier this set and cannot return.`
    );
  }

  return warnings.length ? warn(...warnings) : ok();
}

export function canApplyLiberoOff(
  state: MatchState,
  event: LiberoOffEvent
): ValidationResult {
  if (!state.currentSet) return warn('Libero replacement requires an active set.');
  const rot = state.currentSet.rotation[event.team];
  const warnings: string[] = [];

  if (rot.liberoOnFloor !== event.libero) {
    warnings.push(
      `Libero #${event.libero} is not currently on the floor.`
    );
  }
  if (rot.liberoReplacesShirt != null && rot.liberoReplacesShirt !== event.replacedBy) {
    warnings.push(
      `Libero originally replaced #${rot.liberoReplacesShirt}; they should return as that player.`
    );
  }
  return warnings.length ? warn(...warnings) : ok();
}

export function canApplyLiberoOfficiallyReplaced(
  state: MatchState,
  event: LiberoOfficiallyReplacedEvent,
  rosters: { home: RosterPlayer[]; away: RosterPlayer[] }
): ValidationResult {
  if (!state.currentSet) {
    return warn('Libero replacement requires an active set.');
  }
  const rot = state.currentSet.rotation[event.team];
  const warnings: string[] = [];
  if (!rot.liberos.includes(event.libero)) {
    warnings.push(
      `#${event.libero} is not designated as a libero for this set.`
    );
  }
  // Replacing-by player should be a real, active roster member, and
  // ideally not a libero (would defeat the point of "officially
  // replaced by a regular").
  const roster = rosters[event.team];
  const replacement = roster.find((p) => p.shirt === event.replacedBy);
  if (!replacement) {
    warnings.push(`#${event.replacedBy} is not in the team's roster.`);
  } else if (!replacement.active) {
    warnings.push(`#${event.replacedBy} is marked inactive in the roster.`);
  } else if (replacement.isLibero) {
    warnings.push(
      `Official libero replacement should normally be a regular, not another libero (#${event.replacedBy}).`
    );
  }
  if (rot.lockedOut.includes(event.libero)) {
    warnings.push(
      `Libero #${event.libero} was already officially replaced this set.`
    );
  }
  return warnings.length ? warn(...warnings) : ok();
}

export function canApplyTimeout(state: MatchState, event: TimeoutEvent): ValidationResult {
  if (!state.currentSet) return warn('Timeout requires an active set.');
  const used = state.currentSet.timeoutsUsed[event.team];
  if (used >= 2) {
    return warn(`${event.team} has already used 2 timeouts this set.`);
  }
  return ok();
}

export function canApplySanction(_state: MatchState, _event: SanctionEvent): ValidationResult {
  // Sanctions are always allowed; UI surfaces the level for confirmation
  // only. No constraints to check.
  return ok();
}

export function canApplyLineup(
  _state: MatchState,
  event: LineupEvent,
  rosters: { home: RosterPlayer[]; away: RosterPlayer[] }
): ValidationResult {
  const warnings: string[] = [];
  const roster = rosters[event.team];
  const seen = new Set<number>();
  for (const shirt of event.positions) {
    if (seen.has(shirt)) warnings.push(`Lineup has #${shirt} listed twice.`);
    seen.add(shirt);
    const r = roster.find((p) => p.shirt === shirt);
    if (!r) warnings.push(`#${shirt} is not in the team roster.`);
    else if (!r.active) warnings.push(`#${shirt} is marked inactive in the roster.`);
    else if (r.isLibero)
      warnings.push(
        `#${shirt} is a libero and shouldn't appear in the starting six.`
      );
  }
  for (const lib of event.liberos) {
    const r = roster.find((p) => p.shirt === lib);
    if (!r) warnings.push(`Libero #${lib} is not in the team roster.`);
    else if (!r.isLibero) warnings.push(`#${lib} is not flagged as a libero.`);
  }
  if (event.liberos.length > 2) {
    warnings.push('At most two liberos may be designated per set (V-C).');
  }
  return warnings.length ? warn(...warnings) : ok();
}

export function canApplySetEnd(state: MatchState, event: SetEndEvent): ValidationResult {
  const target = state.currentSet?.target ?? 25;
  const winBy = 2; // RULE-CHECK: hardcoded; could read from match.meta.setTargets.winBy
  const { homeFinal, awayFinal } = event;
  const max = Math.max(homeFinal, awayFinal);
  const diff = Math.abs(homeFinal - awayFinal);
  const warnings: string[] = [];
  if (max < target) {
    warnings.push(
      `Set ended at ${homeFinal}-${awayFinal} but target was ${target}; nobody reached it.`
    );
  }
  if (diff < winBy) {
    warnings.push(
      `Set must be won by at least ${winBy}; current difference is ${diff}.`
    );
  }
  return warnings.length ? warn(...warnings) : ok();
}
