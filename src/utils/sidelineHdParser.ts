// ── Sideline HD live rally parser ─────────────────────────────────────────
//
// Converts a `SidelineHdRallyPayload` (raw JSON returned from Sideline HD's
// authenticated API) into the app's `Match` shape. We don't know the exact
// rally schema — Sideline HD is closed-source — so the parser is intentionally
// best-effort and tolerant: missing fields surface as defaults rather than
// errors, and a malformed rally is skipped with a warning instead of
// aborting the whole match.
//
// Pairs with `historicalImporter.ts` (which converts a bundled workbook
// JSON to the same `Match[]` shape) — this is the *live* equivalent.
//
// Distinguishing source field
// ---------------------------
// Live API imports stamp `meta.source = 'sideline-hd-live'`. Static
// workbook imports keep `'sideline-hd-import'`. Both are visible in the
// app as historical matches, but the source flag lets analytics and any
// future "re-sync" feature target one batch without the other.
// ──────────────────────────────────────────────────────────────────────────

import type {
  Match,
  MatchEvent,
  MatchMeta,
  PointEvent,
  RosterPlayer,
  Side,
  StatCategory,
  StatEvent,
  CourtSnapshot,
  Lineup,
} from '../types/match';
import type {
  SidelineHdMatchSummary,
  SidelineHdRallyPayload,
  SidelineHdTeam,
} from '../api/sidelineHd';
import { inferMatchCategoryFromEventName } from './matchMetaPure';

/** Deterministic stable id used for dedupe. */
export function makeSidelineLiveMatchId(matchId: string): string {
  return `import-sideline-live-${matchId}`;
}

export interface SidelineParseResult {
  match: Match | null;
  warnings: string[];
}

interface ParseContext {
  /** Sideline HD's id for this match — used for the stable Match.id. */
  matchId: string;
  /** Summary record from the team's match list — provides date, opponent,
   *  event label, scores. */
  summary: SidelineHdMatchSummary;
  /** Which team this is being imported for. Drives home/away assignment
   *  on the resulting Match (their team always sits on `home`). */
  team: SidelineHdTeam;
  /** TeamProfile id from the local user profile — substituted into
   *  `meta.home.teamProfileId`. */
  teamProfileId: string;
  /** Raw rally payload returned by the API. */
  rallies: SidelineHdRallyPayload;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function pickString(
  obj: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

function pickNumber(
  obj: Record<string, unknown>,
  keys: readonly string[]
): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

/**
 * Map a Sideline HD rally action label to one of the app's
 * `StatCategory` values. Unknown labels fall through to `undefined` so
 * the caller skips them rather than logging garbage.
 */
function normaliseStatCategory(input: string | undefined): StatCategory | undefined {
  if (!input) return undefined;
  const lower = input.toLowerCase();
  if (lower.includes('kill')) return 'kill';
  if (lower.includes('block')) return 'block';
  if (lower.includes('ace')) return 'ace';
  if (lower.includes('assist')) return 'assist';
  if (lower.includes('dig')) return 'dig';
  if (lower.includes('pass') || lower.includes('receive')) return 'pass';
  if (lower.includes('error') || lower.includes('fault')) return 'error';
  return undefined;
}

/**
 * Map a Sideline HD point-reason label to the app's `PointEvent.reason`
 * enum. Unknown values surface as `null` (treated as "unattributed"
 * downstream).
 */
function normalisePointReason(input: string | undefined): PointEvent['reason'] {
  if (!input) return null;
  const lower = input.toLowerCase();
  if (lower.includes('kill')) return 'kill';
  if (lower.includes('ace')) return 'ace';
  if (lower.includes('block')) return 'block';
  if (lower.includes('opp') && lower.includes('error')) return 'opp-error';
  if (lower.includes('unforced') || lower.includes('error')) return 'unforced';
  return null;
}

/** Empty 6-position lineup used as a placeholder when we can't infer one. */
const EMPTY_LINEUP: Lineup = [0, 0, 0, 0, 0, 0];

function emptyCourtSnapshot(scoringTeam: Side): CourtSnapshot {
  return {
    homePositions: EMPTY_LINEUP,
    awayPositions: EMPTY_LINEUP,
    homeLiberosOnFloor: null,
    awayLiberosOnFloor: null,
    server: scoringTeam,
    serverShirt: 0,
  };
}

/**
 * Walk the raw rally array and emit `MatchEvent[]`. Each rally entry
 * may contribute one point event and zero-or-more stat events. We
 * intentionally tolerate sparse data — many Sideline HD payloads only
 * include the side that won and the shirt that scored.
 */
function parseEvents(
  rallies: unknown[],
  warnings: string[],
  ctx: ParseContext
): MatchEvent[] {
  const events: MatchEvent[] = [];
  let setIndex = 0;
  let lastSetLabel: string | number | undefined;
  let rallyIndex = 0;

  for (const rallyUnknown of rallies) {
    if (!isObject(rallyUnknown)) continue;
    const rally = rallyUnknown;

    // Some payloads include explicit set numbering; respect it when
    // present, otherwise stay on the current set.
    const setLabel =
      pickString(rally, ['set', 'setNumber', 'setIndex', 'setLabel']) ??
      pickNumber(rally, ['set', 'setNumber', 'setIndex']);
    if (setLabel != null && setLabel !== lastSetLabel) {
      if (lastSetLabel != null) setIndex++;
      lastSetLabel = setLabel;
      rallyIndex = 0;
    }

    const ts =
      pickNumber(rally, ['ts', 'timestamp', 'createdAt', 'time']) ??
      ctx.summary.dateMs ??
      Date.now();
    const baseTs = ts + rallyIndex;

    // Determine which side won the rally.
    const winnerLabel = pickString(rally, [
      'winner',
      'scoringTeam',
      'pointTo',
      'winningTeam',
      'side',
    ]);
    const scoringTeam: Side = ((): Side => {
      if (winnerLabel) {
        const lower = winnerLabel.toLowerCase();
        if (lower === 'home' || lower === 'us' || lower === 'mine') return 'home';
        if (lower === 'away' || lower === 'them' || lower === 'opponent') return 'away';
        // Numeric / id-based winners — compare against the user's team id.
        if (winnerLabel === ctx.team.id) return 'home';
      }
      // Fallback: presence of a home-shirt-only field implies a home point.
      const homeShirt = pickNumber(rally, ['homeShirt', 'homePlayerShirt']);
      const awayShirt = pickNumber(rally, ['awayShirt', 'awayPlayerShirt']);
      if (homeShirt != null && awayShirt == null) return 'home';
      if (awayShirt != null && homeShirt == null) return 'away';
      return 'home';
    })();

    const reasonLabel = pickString(rally, ['reason', 'pointType', 'how', 'outcome', 'result']);
    const reason = normalisePointReason(reasonLabel);

    const shirt =
      pickNumber(rally, [
        'shirt',
        'jersey',
        'playerNumber',
        'scorerShirt',
        scoringTeam === 'home' ? 'homeShirt' : 'awayShirt',
      ]) ?? undefined;

    const pointEvent: PointEvent = {
      id: `sl-${ctx.matchId}-s${setIndex}-r${rallyIndex}-pt`,
      ts: baseTs,
      setIndex,
      type: 'point',
      scoringTeam,
      reason,
      ...(shirt != null ? { shirt } : {}),
    };
    events.push(pointEvent);

    // Stat enrichment — if the rally carries enough detail to attribute
    // a stat (kill, block, ace, etc.) emit a follow-on stat event.
    const statCategory = normaliseStatCategory(reasonLabel);
    if (statCategory && shirt != null) {
      const stat: StatEvent = {
        id: `sl-${ctx.matchId}-s${setIndex}-r${rallyIndex}-st`,
        ts: baseTs + 1,
        setIndex,
        type: 'stat',
        team: scoringTeam,
        shirt,
        category: statCategory,
        courtSnapshot: emptyCourtSnapshot(scoringTeam),
      };
      events.push(stat);
    } else if (statCategory && shirt == null) {
      // Useful information (we know it was a kill) but the rally
      // didn't tell us who — surface as a warning so a follow-up
      // session can sharpen the parser if we observe the real shape.
      warnings.push(
        `Rally ${rallyIndex} in set ${setIndex + 1}: detected ${statCategory} but no shirt — point logged without stat enrichment.`
      );
    }

    rallyIndex++;
  }

  return events;
}

/** Best-effort roster extraction from the raw payload. */
function parseRosters(
  raw: Record<string, unknown>,
  ctx: ParseContext,
  warnings: string[]
): { home: RosterPlayer[]; away: RosterPlayer[] } {
  const homeKey =
    raw.homeRoster ?? raw.homePlayers ?? raw.rosterHome ?? raw.lineupHome ?? null;
  const awayKey =
    raw.awayRoster ?? raw.awayPlayers ?? raw.rosterAway ?? raw.lineupAway ?? null;

  function convert(input: unknown, label: 'home' | 'away'): RosterPlayer[] {
    if (!Array.isArray(input)) return [];
    const players: RosterPlayer[] = [];
    for (const entry of input) {
      if (!isObject(entry)) continue;
      const shirt = pickNumber(entry, ['shirt', 'jersey', 'number', 'playerNumber']);
      const name = pickString(entry, ['name', 'displayName', 'fullName', 'player']);
      if (shirt == null || !name) continue;
      players.push({
        shirt,
        name,
        isLibero: Boolean(entry.isLibero ?? entry.libero ?? false),
        active: true,
        source: 'manual',
      });
    }
    if (players.length === 0 && Array.isArray(input) && input.length > 0) {
      warnings.push(`${label} roster present but no entries had usable shirt + name fields.`);
    }
    return players;
  }

  return {
    home: convert(homeKey, 'home'),
    away: convert(awayKey, 'away'),
  };
}

/**
 * Best-effort fall-through: synthesise a minimal set of events from the
 * summary scores when the rally payload is empty. This keeps the import
 * useful for matches where Sideline HD only stores point totals — the
 * Match will have a final score but no rally-level detail, mirroring the
 * existing bundled-import behaviour (most PVC matches ship with
 * `events: []` and rely on metadata-only display).
 */
function synthesiseFromSummary(ctx: ParseContext): MatchEvent[] {
  const { summary } = ctx;
  const home = summary.homeScore ?? 0;
  const away = summary.awayScore ?? 0;
  if (home === 0 && away === 0) return [];
  const events: MatchEvent[] = [];
  const ts = summary.dateMs ?? Date.now();
  for (let i = 0; i < home; i++) {
    events.push({
      id: `sl-${ctx.matchId}-s0-r${i}-pt`,
      ts: ts + i,
      setIndex: 0,
      type: 'point',
      scoringTeam: 'home',
      reason: null,
    });
  }
  for (let i = 0; i < away; i++) {
    events.push({
      id: `sl-${ctx.matchId}-s0-rA${i}-pt`,
      ts: ts + home + i,
      setIndex: 0,
      type: 'point',
      scoringTeam: 'away',
      reason: null,
    });
  }
  return events;
}

/**
 * Main entrypoint. Convert a `SidelineHdRallyPayload` plus the summary
 * (date / opponent / scores) and the user's team identity into a
 * persistable `Match`.
 *
 * Returns `null` (with a warning) if the payload is unusable —
 * the caller skips it rather than persisting a half-record.
 */
export function parseSidelineLiveMatch(input: {
  summary: SidelineHdMatchSummary;
  rallies: SidelineHdRallyPayload;
  team: SidelineHdTeam;
  teamProfileId: string;
}): SidelineParseResult {
  const warnings: string[] = [];
  const { summary, rallies, team, teamProfileId } = input;

  const ctx: ParseContext = {
    matchId: summary.id,
    summary,
    team,
    teamProfileId,
    rallies,
  };

  let events: MatchEvent[] = [];
  try {
    events = parseEvents(rallies.rallies, warnings, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`Rally walk failed: ${msg}. Falling back to summary-only import.`);
    events = synthesiseFromSummary(ctx);
  }
  if (events.length === 0) {
    events = synthesiseFromSummary(ctx);
  }

  const rosters = parseRosters(rallies.raw, ctx, warnings);

  const dateMs = summary.dateMs ?? Date.now();
  const ourLabel = team.name;
  const opponentLabel = summary.opponent || 'Opponent';
  const eventName = summary.eventName ?? 'Sideline HD import';
  const inferredCategory = inferMatchCategoryFromEventName(eventName) ?? undefined;

  const meta: MatchMeta = {
    eventName,
    division: '',
    matchLabel: `${ourLabel} vs ${opponentLabel}`,
    courtName: '',
    dateMs,
    sport: 'indoor',
    bestOf: 3,
    setTargets: { regular: 25, decider: 15, winBy: 2 },
    home: {
      label: ourLabel,
      teamProfileId,
    },
    away: {
      label: opponentLabel,
    },
    officials: {},
    matchKind: 'imported',
    includeInStats: true,
    source: 'sideline-hd-live',
    matchCategory: inferredCategory,
  };

  // Attach a videoUrl when the raw payload exposes one — keeps the
  // "open original recording" button in the match-detail UI working
  // out of the box.
  const videoUrl =
    pickString(rallies.raw, ['videoUrl', 'video_url', 'recordingUrl']) ??
    undefined;
  if (videoUrl) meta.videoUrl = videoUrl;

  const match: Match = {
    id: makeSidelineLiveMatchId(summary.id),
    meta,
    events,
    rosters,
    status: 'complete',
    createdAt: dateMs,
    updatedAt: dateMs,
    schemaVersion: 1,
  };

  return { match, warnings };
}

/**
 * Predicate for dedupe — checks whether a given Sideline HD match id
 * is already present in a list of existing Match records. Public so
 * the screen can show "N already imported" before the import button
 * fires.
 */
export function sidelineLiveMatchIsImported(
  existingIds: Set<string>,
  sidelineMatchId: string
): boolean {
  return existingIds.has(makeSidelineLiveMatchId(sidelineMatchId));
}
