// ── Sideline HD localStorage parser ────────────────────────────────────────
//
// Sideline HD's web pages cache ALL match data in localStorage on the user's
// browser when they're logged in and visit a team's slug-based URL. The
// self-serve importer drives a WebView to the user's team page, waits for
// the page to populate localStorage, then snapshots the entries below:
//
//   __pvcFinalMatches      JSON array of match summary objects (one per
//                          completed match in the season)
//   __pvcPBP_<matchId>     pipe-delimited rally string per match — each
//                          rally is one line/record with columns
//                          `homeScore|-|awayScore|action|player|...`
//   __pvcMatchIds          JSON array of match ids the page knows about
//   __pvcBox               box scores (optional)
//   __review_<slug>        pasted review notes (optional)
//
// This parser converts that snapshot into the app's `Match[]` shape (same
// type the bundled PVC Titanium import produces). It's tolerant — Sideline
// HD's exact JSON shape isn't documented, so missing fields become defaults
// rather than parse errors and a malformed rally string falls through to a
// summary-only synthesis (score-only match record, mirroring the bundled
// behaviour for matches without PBP data).
//
// The earlier API-shape parser (Bearer JWT against Firebase auth) didn't
// work in a cookie-only WebView context. This file replaces it.
//
// Distinguishing source field
// ---------------------------
// Imports stamp `meta.source = 'sideline-hd-live'` and `meta.matchKind =
// 'imported'`. Stable id uses the `import-sideline-live-<matchId>` prefix
// so dedupe across re-imports is exact.
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
import { inferMatchCategoryFromEventName } from './matchMetaPure';

/** Snapshot pulled out of the WebView's localStorage. Values are the raw
 *  strings the page stored — JSON-encoded for `__pvcFinalMatches` /
 *  `__pvcMatchIds`, pipe-delimited for `__pvcPBP_*`. */
export interface SidelineHdLocalStorageSnapshot {
  /** Slug of the team page the snapshot came from. Stored on
   *  `meta.eventName` fallback when the per-match record doesn't carry
   *  its own event/league name. */
  teamSlug?: string;
  /** Raw key → value map, exactly as `localStorage.getItem(k)` returned
   *  it. Only `__pvc*` and `__review_*` keys are kept. */
  entries: Record<string, string>;
}

/** Deterministic stable id used for dedupe — keyed off the source match id. */
export function makeSidelineLiveMatchId(matchId: string): string {
  return `import-sideline-live-${matchId}`;
}

/** Predicate for dedupe — used by the screen to surface "already imported". */
export function sidelineLiveMatchIsImported(
  existingIds: Set<string>,
  sidelineMatchId: string
): boolean {
  return existingIds.has(makeSidelineLiveMatchId(sidelineMatchId));
}

export interface SidelineSnapshotParseResult {
  /** Parsed matches in source-order (newest first if the page sorted them). */
  matches: Match[];
  /** Aggregated warnings — per-match issues surface here with the match
   *  id prefix. The importer copies a small slice into the UI summary. */
  warnings: string[];
}

interface ParseOptions {
  /** TeamProfile id from the local user profile. Stamped on
   *  `meta.home.teamProfileId` so the imported matches link cleanly into
   *  Tier-2 analytics. */
  teamProfileId: string;
  /** Local team's display label. Used as `meta.home.label` and as the
   *  "ourLabel" side of `matchLabel`. */
  teamLabel: string;
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
    if (typeof v === 'string' && v) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function pickDateMs(
  obj: Record<string, unknown>,
  keys: readonly string[]
): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      return v < 1e12 ? v * 1000 : v;
    }
    if (typeof v === 'string' && v) {
      const parsed = Date.parse(v);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

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

// ── __pvcFinalMatches summary extraction ─────────────────────────────────

interface MatchSummary {
  id: string;
  dateMs: number | null;
  opponent: string;
  homeScore?: number;
  awayScore?: number;
  /** Per-set scores, if exposed. Used to seed setIndex when PBP records
   *  don't carry an explicit set marker. */
  setScores?: Array<{ home: number; away: number }>;
  /** Whether the user's team was the home side in this match. Drives the
   *  scoringTeam mapping when we walk PBP. */
  weWereHome: boolean;
  eventName?: string;
  videoUrl?: string;
  /** Original raw record — kept so the rally walker can pull additional
   *  fields we don't model yet. */
  raw: Record<string, unknown>;
}

function extractSetScores(raw: Record<string, unknown>): MatchSummary['setScores'] {
  const candidates: unknown[] = [];
  for (const k of ['sets', 'setScores', 'setResults', 'setHistory']) {
    const v = raw[k];
    if (Array.isArray(v)) candidates.push(...v);
  }
  if (candidates.length === 0) return undefined;
  const out: NonNullable<MatchSummary['setScores']> = [];
  for (const entry of candidates) {
    if (!isObject(entry)) continue;
    const home = pickNumber(entry, ['home', 'homeScore', 'h']);
    const away = pickNumber(entry, ['away', 'awayScore', 'a']);
    if (home == null || away == null) continue;
    out.push({ home, away });
  }
  return out.length > 0 ? out : undefined;
}

function inferWeWereHome(
  raw: Record<string, unknown>,
  teamLabel: string
): boolean {
  // Explicit flags first.
  for (const k of ['isHome', 'home', 'weWereHome', 'amHome']) {
    const v = raw[k];
    if (typeof v === 'boolean') return v;
  }
  // Compare team labels — case-insensitive substring on either side.
  const homeName =
    pickString(raw, ['homeTeam', 'homeName', 'homeLabel', 'home_team', 'homeTeamName']) ??
    '';
  const awayName =
    pickString(raw, ['awayTeam', 'awayName', 'awayLabel', 'away_team', 'awayTeamName']) ??
    '';
  const lowerTeam = teamLabel.toLowerCase();
  if (homeName && homeName.toLowerCase().includes(lowerTeam)) return true;
  if (awayName && awayName.toLowerCase().includes(lowerTeam)) return false;
  if (homeName.toLowerCase() === lowerTeam) return true;
  // Default — treat as home when ambiguous. The bundled PVC matches
  // follow this convention (the user's team is always on the home side
  // for analytics purposes).
  return true;
}

function summaryFromEntry(
  entry: Record<string, unknown>,
  teamLabel: string,
  fallbackEventName: string | undefined
): MatchSummary | null {
  const id = pickString(entry, [
    'id',
    'matchId',
    'gameId',
    'game_id',
    'match_id',
    'uuid',
    '_id',
  ]);
  if (!id) return null;

  const dateMs = pickDateMs(entry, [
    'date',
    'dateMs',
    'gameDate',
    'matchDate',
    'startsAt',
    'startTime',
    'scheduledAt',
    'playedAt',
    'createdAt',
  ]);

  const weWereHome = inferWeWereHome(entry, teamLabel);
  const ourTeamName = teamLabel;
  const homeName =
    pickString(entry, ['homeTeam', 'homeName', 'homeLabel', 'home_team', 'homeTeamName']);
  const awayName =
    pickString(entry, ['awayTeam', 'awayName', 'awayLabel', 'away_team', 'awayTeamName']);
  const opponent = weWereHome
    ? awayName ?? pickString(entry, ['opponent', 'opponentName']) ?? 'Opponent'
    : homeName ?? pickString(entry, ['opponent', 'opponentName']) ?? 'Opponent';

  // Raw scores from the page are written from the home/away perspective.
  // We rebind to our team's side: when we played away, the home/away
  // scores swap so the importer's downstream "home == us" invariant
  // holds.
  const rawHome = pickNumber(entry, ['homeScore', 'home_score', 'scoreHome', 'home_points']);
  const rawAway = pickNumber(entry, ['awayScore', 'away_score', 'scoreAway', 'away_points']);
  const homeScore = weWereHome ? rawHome : rawAway;
  const awayScore = weWereHome ? rawAway : rawHome;

  const setScoresRaw = extractSetScores(entry);
  const setScores = setScoresRaw?.map((s) =>
    weWereHome ? s : { home: s.away, away: s.home }
  );

  const eventName =
    pickString(entry, [
      'eventName',
      'leagueName',
      'tournamentName',
      'competition',
      'league',
      'event',
    ]) ?? fallbackEventName;

  const videoUrl = pickString(entry, [
    'videoUrl',
    'video_url',
    'recordingUrl',
    'gameUrl',
    'matchUrl',
  ]);

  return {
    id,
    dateMs,
    opponent,
    homeScore,
    awayScore,
    setScores,
    weWereHome,
    eventName,
    videoUrl,
    raw: entry,
  };
}

function extractFinalMatchesArray(rawFinalMatches: string | undefined): unknown[] {
  if (!rawFinalMatches) return [];
  try {
    const parsed: unknown = JSON.parse(rawFinalMatches);
    if (Array.isArray(parsed)) return parsed;
    if (isObject(parsed)) {
      for (const k of ['matches', 'data', 'items', 'results', 'games']) {
        const inner = parsed[k];
        if (Array.isArray(inner)) return inner;
      }
    }
  } catch {
    // not JSON — fall through to empty
  }
  return [];
}

// ── __pvcPBP_<id> rally walker ───────────────────────────────────────────

interface ParsedRally {
  setIndex: number;
  scoringTeam: Side;
  reason: PointEvent['reason'];
  shirt: number | undefined;
  /** Raw fragments — kept so the stat enrichment can re-inspect the
   *  per-rally action label. */
  fragments: string[];
}

/**
 * Walk a PBP blob and emit one ParsedRally per rally. The blob format
 * isn't formally documented; Sideline HD pages observed in the wild use:
 *   • lines split on `\n` (or `\r\n`); blank lines skipped
 *   • fields per line split on `|`
 *   • first two numeric fields are typically `homeScore` and `awayScore`
 *     after the rally — we use the delta vs. the previous line to decide
 *     which team scored
 *   • subsequent fields carry the action label and the player number/name
 *
 * On any line we can't parse cleanly we skip and accumulate a warning;
 * the caller falls through to summary-synthesised points for that match.
 */
function parsePbpString(
  pbp: string,
  weWereHome: boolean,
  warnings: string[]
): ParsedRally[] {
  const rallies: ParsedRally[] = [];
  if (!pbp) return rallies;
  const lines = pbp.split(/\r?\n/);
  let prevHome = 0;
  let prevAway = 0;
  let setIndex = 0;
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) continue;
    const cols = line.split('|').map((c) => c.trim());
    if (cols.length < 2) continue;

    // Pull the first two numeric columns as the post-rally score.
    const numericCols: number[] = [];
    let firstNonNumericIdx = 0;
    for (let i = 0; i < cols.length; i++) {
      const n = Number(cols[i]);
      if (Number.isFinite(n) && cols[i] !== '') {
        numericCols.push(n);
        if (numericCols.length === 2) {
          firstNonNumericIdx = i + 1;
          break;
        }
      } else if (cols[i] === '-' || cols[i] === '') {
        // Separator dash — keep scanning.
        continue;
      } else {
        break;
      }
    }
    if (numericCols.length < 2) continue;
    const [postHome, postAway] = numericCols as [number, number];

    // Detect set transitions — a reset to 0/0 (or both lower) starts a
    // new set. Sideline HD doesn't always include an explicit set marker
    // so this score-watershed heuristic is the most reliable signal.
    if (postHome === 0 && postAway === 0 && (prevHome > 0 || prevAway > 0)) {
      setIndex++;
    } else if (postHome < prevHome || postAway < prevAway) {
      setIndex++;
    }

    const homeDelta = postHome - prevHome;
    const awayDelta = postAway - prevAway;
    prevHome = postHome;
    prevAway = postAway;

    let homeScored: boolean;
    if (homeDelta === 1 && awayDelta <= 0) homeScored = true;
    else if (awayDelta === 1 && homeDelta <= 0) homeScored = false;
    else if (homeDelta > 0 && awayDelta <= 0) homeScored = true;
    else if (awayDelta > 0 && homeDelta <= 0) homeScored = false;
    else continue; // ambiguous — skip

    // Sideline HD records "home" relative to the venue. Re-bind to "us":
    // when our team was home, homeScored == ourPoint.
    const scoringTeam: Side = homeScored === weWereHome ? 'home' : 'away';

    // Look for an action label + player number in the remaining columns.
    const remainder = cols.slice(firstNonNumericIdx);
    let actionLabel: string | undefined;
    let shirt: number | undefined;
    for (const frag of remainder) {
      if (!frag) continue;
      if (shirt == null) {
        const n = Number(frag);
        if (Number.isFinite(n) && n > 0 && n < 100 && /^\d+$/.test(frag)) {
          shirt = n;
          continue;
        }
      }
      if (actionLabel == null && /[a-zA-Z]/.test(frag)) {
        actionLabel = frag;
      }
    }

    rallies.push({
      setIndex,
      scoringTeam,
      reason: normalisePointReason(actionLabel),
      shirt,
      fragments: cols,
    });
  }
  if (lines.length > 0 && rallies.length === 0) {
    warnings.push('PBP blob present but no rallies could be parsed.');
  }
  return rallies;
}

function ralliesToEvents(
  matchId: string,
  rallies: ParsedRally[]
): MatchEvent[] {
  const events: MatchEvent[] = [];
  const perSetIndex = new Map<number, number>();
  const baseTs = Date.now();
  for (const r of rallies) {
    const idx = perSetIndex.get(r.setIndex) ?? 0;
    perSetIndex.set(r.setIndex, idx + 1);
    const ts = baseTs + r.setIndex * 100000 + idx * 4;
    const point: PointEvent = {
      id: `sl-${matchId}-s${r.setIndex}-r${idx}-pt`,
      ts,
      setIndex: r.setIndex,
      type: 'point',
      scoringTeam: r.scoringTeam,
      reason: r.reason,
      ...(r.shirt != null ? { shirt: r.shirt } : {}),
    };
    events.push(point);

    // Stat enrichment — when we have both a recognisable action label
    // and a shirt #, emit the follow-on stat event so analytics get the
    // per-player credit.
    const actionLabel = r.fragments.find((f) => /[a-zA-Z]/.test(f));
    const statCategory = normaliseStatCategory(actionLabel);
    if (statCategory && r.shirt != null) {
      const stat: StatEvent = {
        id: `sl-${matchId}-s${r.setIndex}-r${idx}-st`,
        ts: ts + 1,
        setIndex: r.setIndex,
        type: 'stat',
        team: r.scoringTeam,
        shirt: r.shirt,
        category: statCategory,
        courtSnapshot: emptyCourtSnapshot(r.scoringTeam),
      };
      events.push(stat);
    }
  }
  return events;
}

function synthesiseFromSummary(matchId: string, summary: MatchSummary): MatchEvent[] {
  const events: MatchEvent[] = [];
  const baseTs = summary.dateMs ?? Date.now();

  // Prefer per-set scores when present so the synthesised events end up
  // in the correct sets — without this every synthesised point lands in
  // set 0 and the bestOf logic shows "1 set played, 25–N" for a
  // three-setter.
  if (summary.setScores && summary.setScores.length > 0) {
    for (let s = 0; s < summary.setScores.length; s++) {
      const { home, away } = summary.setScores[s]!;
      for (let i = 0; i < home; i++) {
        events.push({
          id: `sl-${matchId}-s${s}-rH${i}-pt`,
          ts: baseTs + s * 100000 + i,
          setIndex: s,
          type: 'point',
          scoringTeam: 'home',
          reason: null,
        });
      }
      for (let i = 0; i < away; i++) {
        events.push({
          id: `sl-${matchId}-s${s}-rA${i}-pt`,
          ts: baseTs + s * 100000 + home + i,
          setIndex: s,
          type: 'point',
          scoringTeam: 'away',
          reason: null,
        });
      }
    }
    return events;
  }

  const home = summary.homeScore ?? 0;
  const away = summary.awayScore ?? 0;
  if (home === 0 && away === 0) return [];
  for (let i = 0; i < home; i++) {
    events.push({
      id: `sl-${matchId}-s0-rH${i}-pt`,
      ts: baseTs + i,
      setIndex: 0,
      type: 'point',
      scoringTeam: 'home',
      reason: null,
    });
  }
  for (let i = 0; i < away; i++) {
    events.push({
      id: `sl-${matchId}-s0-rA${i}-pt`,
      ts: baseTs + home + i,
      setIndex: 0,
      type: 'point',
      scoringTeam: 'away',
      reason: null,
    });
  }
  return events;
}

// ── Best-effort roster + box-score extraction ────────────────────────────

function extractRosters(
  snapshot: SidelineHdLocalStorageSnapshot,
  summary: MatchSummary
): { home: RosterPlayer[]; away: RosterPlayer[] } {
  const empty = { home: [] as RosterPlayer[], away: [] as RosterPlayer[] };
  const candidates: Record<string, unknown>[] = [];
  // Per-match roster in the summary itself.
  candidates.push(summary.raw);
  // Box-score blob — same id prefix convention.
  const boxRaw = snapshot.entries[`__pvcBox_${summary.id}`];
  if (boxRaw) {
    try {
      const parsed: unknown = JSON.parse(boxRaw);
      if (isObject(parsed)) candidates.push(parsed);
    } catch {
      // ignore
    }
  }
  // Generic team-wide box.
  const teamBoxRaw = snapshot.entries['__pvcBox'];
  if (teamBoxRaw) {
    try {
      const parsed: unknown = JSON.parse(teamBoxRaw);
      if (isObject(parsed)) candidates.push(parsed);
    } catch {
      // ignore
    }
  }

  function convert(input: unknown): RosterPlayer[] {
    if (!Array.isArray(input)) return [];
    const out: RosterPlayer[] = [];
    for (const entry of input) {
      if (!isObject(entry)) continue;
      const shirt = pickNumber(entry, ['shirt', 'jersey', 'number', 'playerNumber', 'num']);
      const name = pickString(entry, ['name', 'displayName', 'fullName', 'player', 'playerName']);
      if (shirt == null || !name) continue;
      out.push({
        shirt,
        name,
        isLibero: Boolean(entry.isLibero ?? entry.libero ?? false),
        active: true,
        source: 'manual',
      });
    }
    return out;
  }

  for (const cand of candidates) {
    const homeKey =
      cand.homeRoster ?? cand.homePlayers ?? cand.rosterHome ?? cand.lineupHome ?? null;
    const awayKey =
      cand.awayRoster ?? cand.awayPlayers ?? cand.rosterAway ?? cand.lineupAway ?? null;
    const home = convert(homeKey);
    const away = convert(awayKey);
    if (home.length > 0 || away.length > 0) {
      // Re-bind based on whether the user's team was home; the snapshot
      // is venue-relative.
      if (summary.weWereHome) return { home, away };
      return { home: away, away: home };
    }
  }
  return empty;
}

// ── Public entry point ────────────────────────────────────────────────────

/**
 * Parse a localStorage snapshot into the app's `Match[]` shape. Tolerant
 * by design — partial / malformed entries surface as warnings rather
 * than aborting the whole import.
 */
export function parseSidelineHdLocalStorageSnapshot(
  snapshot: SidelineHdLocalStorageSnapshot,
  options: ParseOptions
): SidelineSnapshotParseResult {
  const warnings: string[] = [];
  const finalMatchesRaw = snapshot.entries['__pvcFinalMatches'];
  const entries = extractFinalMatchesArray(finalMatchesRaw);
  if (entries.length === 0) {
    warnings.push(
      'No `__pvcFinalMatches` data found — open the team page on Sideline HD and wait for it to fully load before importing.'
    );
  }

  const matches: Match[] = [];
  const fallbackEventName = snapshot.teamSlug
    ? `Sideline HD (${snapshot.teamSlug})`
    : 'Sideline HD import';

  for (const rawEntry of entries) {
    if (!isObject(rawEntry)) continue;
    const summary = summaryFromEntry(rawEntry, options.teamLabel, fallbackEventName);
    if (!summary) continue;

    const pbpKey = `__pvcPBP_${summary.id}`;
    const pbpString = snapshot.entries[pbpKey];

    const localWarnings: string[] = [];
    let events: MatchEvent[] = [];
    if (pbpString) {
      try {
        const parsedRallies = parsePbpString(
          pbpString,
          summary.weWereHome,
          localWarnings
        );
        events = ralliesToEvents(summary.id, parsedRallies);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        localWarnings.push(`PBP walk failed: ${msg} — falling back to summary-only.`);
        events = [];
      }
    }
    if (events.length === 0) {
      events = synthesiseFromSummary(summary.id, summary);
    }

    const rosters = extractRosters(snapshot, summary);

    const dateMs = summary.dateMs ?? Date.now();
    const ourLabel = options.teamLabel;
    const opponentLabel = summary.opponent || 'Opponent';
    const eventName = summary.eventName ?? fallbackEventName;
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
        teamProfileId: options.teamProfileId,
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
    if (summary.videoUrl) meta.videoUrl = summary.videoUrl;

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

    matches.push(match);
    for (const w of localWarnings) {
      warnings.push(`${summary.id}: ${w}`);
    }
  }

  return { matches, warnings };
}
