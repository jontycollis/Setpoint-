// ── Tier 2 official-scorer types ───────────────────────────────────────────
//
// Event-sourced match shape. Storage = MatchMeta + append-only event log;
// state (current score, rotation, who's on the floor, sets won) is a pure
// function of the log. Editing/undoing is "delete or modify event(s) and
// re-derive state from the resulting log".
//
// Citations & rule sources (consult these when behaviour seems off):
//   • FIVB Official Rules of the Game 2021–2024 (rotation, libero rules)
//   • Volleyball Canada Domestic Competition Regulations (libero-may-serve,
//     two-libero allowance, sub limits, sanction levels)
//   • OVA Youth Scoresheet template (Best of 3) — Ontario youth indoor.
//     Mirrored at smashraiders.ca/wp-content/uploads/2024/02/OVA-Scoresheet.pdf
//   • FIVB International Scoresheet (Best of 5) + 2-page instructions —
//     bucs.org.uk/static/.../FIVB-Volleyball-Scoresheet-A3.pdf
//   • FIVB R-6 International Libero Control Sheet (separate libero tracking
//     form maintained by the assistant scorer; attached to the main sheet
//     at match end) — fivb.com/.../FIVB_R-6_LiberoPlayerControl-2011.pdf
//   • FIVB Beach BVB/11 International Scoresheet (RPS-2 of 3) —
//     fivb.com/.../BVB11_2024_Scoresheet.pdf
//
// The data model below is intentionally a superset of all four templates'
// fields so a paper-fidelity renderer (Session D) can fill any of them
// from the same Match record. Anything not on the paper but useful for
// the digital UI (e.g. team colorHex, position codes) is annotated.
// ────────────────────────────────────────────────────────────────────────────

/** Two sides only — no neutral, no third party. */
export type Side = 'home' | 'away';

/**
 * Court positions. I = right back / first server, II = right front,
 * III = middle front, IV = left front, V = left back, VI = middle back.
 * Stored 1..6 (matching paper-scoresheet conventions) so it's obvious
 * to a human reader what number means what slot.
 */
export type Position = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Hex-tuple of shirt numbers in court positions I..VI. Index 0 is
 * position I (the server when this team is serving). Rotation moves
 * each value to index-1, with index 0 wrapping to index 5.
 */
export type Lineup = [number, number, number, number, number, number];

// ── Roster ─────────────────────────────────────────────────────────────────

export interface RosterPlayer {
  shirt: number;
  name: string;
  isLibero: boolean;
  isCaptain?: boolean;
  /**
   * Optional positional code. Stored for stat tracking / display only —
   * the rotation engine doesn't read it. Setter (S), Outside Hitter
   * (OH), Middle Blocker (MB), Opposite (OPP), Libero (L), Defensive
   * Specialist (DS).
   */
  position?: 'S' | 'OH' | 'MB' | 'OPP' | 'L' | 'DS';
  /**
   * Soft-delete flag. Inactive players stay on the team profile so old
   * matches that referenced them keep rendering, but they're hidden
   * from default lineup pickers.
   */
  active: boolean;
  /**
   * How this player landed on the roster. 'manual' for hand-entered, and
   * reserved 'mrs-api' so a future OVA MRS roster importer can flag the
   * provenance distinctly. Optional — undefined is treated as 'manual'.
   * TODO: when MRS integration ships, the importer populates roster +
   * rosterUpdatedAt on TeamProfile and tags incoming entries 'mrs-api'.
   */
  source?: 'manual' | 'mrs-api';
}

// ── Header ─────────────────────────────────────────────────────────────────

export interface TeamHeader {
  label: string;
  /** ISO 3-letter country code as printed on FIVB / FIVB-Beach sheets
   *  (e.g. "USA", "JPN", "CAN"). Optional; OVA youth doesn't print it. */
  countryCode?: string;
  /** Link back to the user's TeamProfile if this match represents that team. */
  teamProfileId?: string;
  coachName?: string;
  /** Assistant Coach 1. On the OVA youth sheet this is just "AC"; on the
   *  FIVB international sheet it's the first of two assistant coaches. */
  assistantCoachName?: string;
  /** FIVB-only: the second assistant coach (AC2). Renderer hides the row
   *  when blank, matching OVA's single-AC layout. */
  assistantCoach2Name?: string;
  /** "T" — Team Therapist. Both OVA Youth and FIVB sheets have a row for
   *  this in the OFFICIALS / TEAM LEADERS block. */
  teamTherapistName?: string;
  /** "M" / "Med." — Medical Doctor. Same renderer treatment as therapist. */
  medicalDoctorName?: string;
  captainShirt?: number;
  /** Jersey colour for on-screen team panels — matches Tier 1 scoreboard. */
  colorHex?: string;
  /**
   * Some V-C youth divisions allow the libero to serve in one rotation
   * slot per set. Per-team because the rule may differ home vs away
   * (rare, but fine to model that way).
   */
  liberoMayServe?: boolean;
}

export interface Officials {
  /** 1st referee. */
  first?: string;
  /** Country code printed in the APPROVAL block, FIVB sheets only. */
  firstCountry?: string;
  /** 2nd referee. */
  second?: string;
  secondCountry?: string;
  /** Up to 4 line-judge names, no signature column. */
  lineJudges?: string[];
  /** "Scorer" — the official whose tap-by-tap log produces this Match. */
  scorerName?: string;
  scorerCountry?: string;
  /** "Assistant Scorer" — maintains the R-6 libero control sheet at FIVB
   *  level. At OVA / V-C level the assistant scorer also signs the main
   *  scoresheet but doesn't keep a separate libero log. */
  assistantScorerName?: string;
  assistantScorerCountry?: string;
}

export interface CoinToss {
  /** Which team chose to serve first in set 1. */
  serve: Side;
  /** Which side of the court each team starts on, named from the
   *  spectator's POV (looking at the net from the official scorer's
   *  side). Set 2+ swap unless overridden. */
  side: 'home-left' | 'home-right';
  /** Which team WON the toss (vs. who chose to serve — the winner can
   *  pick "side" instead of "serve"). FIVB Beach sheets render this
   *  separately. Defaults to the same side as `serve` if not set. */
  winner?: Side;
}

/**
 * Where the match is being played. The OVA / FIVB / Beach paper sheets
 * all want city + hall/gym/beach + country as separate header fields;
 * `MatchMeta.courtName` (existing) is the in-venue court designation
 * ("Court 4"), distinct from the venue itself.
 */
export interface MatchVenue {
  /** Host city, e.g. "Mississauga". OVA / FIVB / Beach all print this. */
  city?: string;
  /** Stadium / gymnasium name (FIVB "Hall", OVA "Gym"). */
  hallName?: string;
  /** Beach venue name — FIVB Beach prints both Site (event location) and
   *  Beach (specific stretch of sand). Indoor renderers leave blank. */
  beachName?: string;
  /** ISO 3-letter country code of the host (printed top-right of every
   *  paper sheet, e.g. "CAN"). */
  countryCode?: string;
}

/**
 * Tournament-context metadata that paper sheets render in the header
 * but that the engine doesn't otherwise need. Letting the user fill
 * these in lets the paper-fidelity renderer reproduce the original
 * scoresheet exactly without forcing them on casual / pickup matches.
 */
export interface TournamentContext {
  /** Free-text pool / phase label as printed on paper, e.g. "Pool A",
   *  "Eliminatory", "QF", "Round of 16". Combines with `phase` below. */
  poolPhase?: string;
  /** Phase tier — paper sheets distinguish these for distribution and
   *  archival reasons. FIVB instructions explicitly enumerate
   *  Eliminatory / Play-Off / Final; FIVB Beach adds Main Draw / Qual /
   *  P.P. / W.B. / Class. / S-F / Finals. */
  phase?:
    | 'eliminatory'
    | 'pool'
    | 'qualification'
    | 'play-off'
    | 'seeding'
    | 'final'
    | 'main-draw'
    | 'classification'
    | 'semi-final'
    | 'finals';
  /** Numeric / alphanumeric match ID printed in the header's "Match N°"
   *  box. Distinct from `MatchMeta.matchLabel` (which is human-readable). */
  matchNumber?: string;
  /** Programme start time vs the actual first-event timestamp. Paper
   *  sheets print this in the header before the match begins. */
  scheduledStartMs?: number;
}

/**
 * Demographic flags printed in the header. Paper sheets put a tick-box
 * for each; we model as enums for cleaner querying.
 */
export type MatchGender = 'men' | 'women' | 'mixed';

/**
 * Age category as printed on the OVA / FIVB header. FIVB sheets use a
 * coarser bucket (Senior / Junior / Youth); OVA Youth breaks Youth out
 * by year-group. Strings rather than years so we don't have to bump
 * the enum every season.
 */
export type MatchAgeCategory =
  | 'masters'   // OVA "Masters/35+"
  | 'senior'    // FIVB Senior, OVA Senior
  | 'u21'       // OVA U21
  | 'u18'       // OVA U18
  | 'u17'       // OVA U17, often FIVB Junior
  | 'u16-14'    // OVA U16/U14 grouped
  | 'junior'    // FIVB Junior bucket (when not broken down further)
  | 'youth';    // FIVB Youth bucket

/**
 * Semantic classification of a match for analytics splits — what kind
 * of competition it counts as. Distinct from `MatchSource` (how the
 * data got here). See `src/utils/matchMeta.ts` for the helpers that
 * default + flip these.
 *
 *   • `'aes'`        — match played as part of an AES-tracked event
 *                       (typically links to an `AesTournamentSnapshot`)
 *   • `'timu'`       — match played in a Timu tournament
 *   • `'standalone'` — scrimmage, practice, friendly, ad-hoc match
 *   • `'imported'`   — fallback for workbook rows whose category cell
 *                       didn't map to a known kind. Rare in practice.
 */
export type MatchKind = 'aes' | 'timu' | 'standalone' | 'imported';

/**
 * How the match data entered storage. Distinct from `MatchKind`:
 * a `matchKind: 'aes'` match could have been `'tier2-live'` (scored
 * at the gym) or `'sideline-hd-import'` (post-tournament workbook
 * import).
 *
 *   • `'tier2-live'`         — produced by the live-scoring engine
 *   • `'sideline-hd-import'` — parsed out of a Sideline HD workbook
 *   • `'manual-entry'`       — typed in after the fact (reserved; not
 *                               written by anything in v1)
 */
export type MatchSource = 'tier2-live' | 'sideline-hd-import' | 'manual-entry';

/**
 * Cross-reference back to an indexed AES tournament snapshot. Mirrors
 * `UnifiedTournamentEntry` keys exactly so an analytics view can hop
 * from a Tier 2 match into the AES tournament dashboard.
 */
export interface AesEventLink {
  /** AES event key, e.g. "PVA-2024-PROVINCIALS". */
  eventId: string;
  /** Optional division id within the event. */
  divisionId?: string;
  /** Optional best-effort match label / id (AES per-match ids
   *  aren't always exposed). */
  matchId?: string;
  /** Cached human-readable tournament name for offline display. */
  tournamentName?: string;
}

/**
 * Cross-reference back to a Timu tournament snapshot.
 */
export interface TimuTournamentLink {
  /** Timu tournament id (numeric, but stored as string here for
   *  storage uniformity with AES). */
  tid: string;
  /** Optional best-effort match label / id within the tournament. */
  matchId?: string;
  /** Cached human-readable tournament name for offline display. */
  tournamentName?: string;
}

export interface MatchMeta {
  eventName: string;
  division: string;
  matchLabel: string;
  /** In-venue court designation, e.g. "Court 4". Distinct from
   *  `venue.hallName` which is the gymnasium / stadium. */
  courtName: string;
  dateMs: number;
  sport: 'indoor' | 'beach';
  /**
   * Where the match is being played — the city / hall / country block
   * printed in every paper sheet's header. Optional so casual matches
   * can skip it.
   */
  venue?: MatchVenue;
  /**
   * Tournament context (pool, phase tier, match number, scheduled start).
   * Optional — populated when scoring a match drawn from an AES / Timu
   * tournament; left blank for ad-hoc matches.
   */
  tournamentContext?: TournamentContext;
  /** Header demographic — Men / Women / Mixed. */
  gender?: MatchGender;
  /** Header age category — drives the Senior / Masters / U21 / U18 etc.
   *  tickbox on the paper sheet. */
  ageCategory?: MatchAgeCategory;
  bestOf: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  setTargets: {
    regular: number;
    decider: number;
    /** Almost always 2; included in the data model so we don't bake
     *  the constant into rules code (some social leagues use 1). */
    winBy: number;
  };
  /**
   * Substitution-rule flavour. V-C (default) counts 12 individual sub
   *  events per team per set. FIVB counts 6 *paired* substitutions per
   *  team per set — a starter coming back for their replacement is the
   *  *same* substitution, so swapping starter↔replacement doesn't add
   *  to the count. The validator branches on this when issuing the
   *  "you've used all your subs" warning.
   */
  subRule?: 'fivb' | 'vc';
  home: TeamHeader;
  away: TeamHeader;
  officials: Officials;
  notes?: string;
  coinToss?: CoinToss;
  /**
   * Semantic classification — AES / Timu / standalone / imported.
   * Drives analytics splits and determines the default for
   * `includeInStats`. Older stored matches without this field are
   * normalised to `'standalone'` on read; new writes always include it.
   */
  matchKind?: MatchKind;
  /**
   * AES tournament link. Populated when the user picks an AES
   * tournament in the post-match save sheet (or when the Tier 2 entry
   * point pre-fills it from a tournament-context navigation). Absent
   * for standalone matches and for AES-kind matches the user hasn't
   * linked yet.
   */
  linkedAesEvent?: AesEventLink;
  /**
   * Timu tournament link. Populated when the user picks a Timu
   * tournament in the post-match save sheet.
   */
  linkedTimuTournament?: TimuTournamentLink;
  /**
   * Per-match opt-in for season analytics rollups. The flag is read
   * at aggregation time only — the match itself stays in storage
   * either way. Default rules (see `defaultIncludeInStats`):
   *   • `'aes'` / `'timu'` / `'imported'` → `true`
   *   • `'standalone'`                    → `false`
   * The user can flip this on any match later from anywhere it's
   * visible (Season History row, per-player roll-up row, etc.).
   */
  includeInStats?: boolean;
  /**
   * How the match entered storage. Distinct from `matchKind`. New
   * Tier 2 matches always write `'tier2-live'`; the importer writes
   * `'sideline-hd-import'`. Older stored matches without this field
   * are normalised to `'tier2-live'` on read.
   */
  source?: MatchSource;
  /**
   * Link back to the match's recording / play-by-play on its source
   * platform (e.g. Sideline HD's match page). Optional — populated by
   * the Sideline HD importer; left blank for live-scored matches.
   */
  videoUrl?: string;
}

// ── Event log (append-only) ────────────────────────────────────────────────

export type EventType =
  | 'lineup'
  | 'point'
  | 'stat'
  | 'sub'
  | 'libero-on'
  | 'libero-off'
  | 'libero-officially-replaced'
  | 'timeout'
  | 'sanction'
  | 'improper-request'
  | 'medical-assistance'
  | 'signoff'
  | 'set-end'
  | 'match-end'
  | 'match-abandoned';

export interface BaseEvent {
  /** UUID-style id. Locally generated; not required to be globally unique. */
  id: string;
  /** Epoch ms. Used for rendering; replay order respects array index first. */
  ts: number;
  /** 0-based set index this event belongs to. `match-end` and
   *  `match-abandoned` use the index of the last set played. */
  setIndex: number;
  type: EventType;
}

export interface LineupEvent extends BaseEvent {
  type: 'lineup';
  team: Side;
  positions: Lineup;
  /** 1 or 2 libero shirt numbers. V-C allows two; only one on the
   *  floor at any time. */
  liberos: number[];
  /** When `home/away.liberoMayServe` is true, the libero serves only
   *  when the rotation positions THEM (their replaced player) into
   *  this slot. Optional even when liberoMayServe is true — if unset,
   *  the libero never serves and the regular always does. */
  serveLiberoFromPosition?: Position;
  /**
   * Per-set first-server override. Normally the engine alternates the
   * first-server side based on `meta.coinToss.serve` and the set index,
   * but for tournament restart / paused-match scenarios the user may
   * need to override — e.g. set 2 starts with the same team that
   * served set 1, or a deciding set's first-server is determined by a
   * second coin toss. When set on either team's lineup event for a
   * given set, the engine prefers it over alternation.
   */
  firstServer?: Side;
}

/**
 * Snapshot of who's on the floor at the moment a stat or point is logged.
 * Stored on stat events (and optionally on enriched point events) so
 * post-match aggregation can reconstruct full context — who set the ball,
 * who was in what rotation slot, whether the libero was playing, who was
 * serving, etc. Keeping this denormalised in each event avoids replaying
 * the entire event log just to figure out the lineup at rally N.
 */
export interface CourtSnapshot {
  /** Shirt numbers in positions I..VI for each team at the moment of
   *  the stat. Mirrors RotationState.positions. */
  homePositions: Lineup;
  awayPositions: Lineup;
  /** Libero shirt currently on the floor for each team (null if none). */
  homeLiberosOnFloor: number | null;
  awayLiberosOnFloor: number | null;
  /** Which team is serving and the server's shirt number. */
  server: Side;
  serverShirt: number;
}

export interface PointEvent extends BaseEvent {
  type: 'point';
  scoringTeam: Side;
  reason?: 'kill' | 'ace' | 'opp-error' | 'block' | 'unforced' | null;
  /** Optional shirt # of the player credited with the point (kill, ace,
   *  block). Stored for stats only — doesn't affect rotation/scoring. */
  shirt?: number;
  /** Shirt # of the player credited with the assist (set) on this point.
   *  Only meaningful for kills; the setter gets an assist when a hitter
   *  gets a kill. */
  assistShirt?: number;
  /** Court snapshot at the moment of the point — who was on the floor,
   *  libero status, server. Populated when the user tags stats during
   *  live scoring; omitted for quick-tap scoring without stat enrichment. */
  courtSnapshot?: CourtSnapshot;
}

// ── Stat events (non-point actions) ───────────────────────────────────────

/**
 * Categories of individual player actions that can be logged during a
 * rally. Point-scoring actions (kill, block, ace) are ALSO recorded as
 * the `reason` on a `PointEvent`; a `StatEvent` with these categories
 * duplicates the information but adds richer context (court snapshot,
 * assist chain). Non-scoring actions (dig, pass, set, error) can ONLY
 * be captured via StatEvent since they don't result in a point.
 *
 * Sideline HD-inspired model:
 *   • kill   — attack that directly wins the rally
 *   • block  — block touch that wins the rally (solo or assist)
 *   • ace    — serve that wins the rally without the opponent touching
 *   • assist — the set/pass that enabled a kill (usually the setter)
 *   • dig    — defensive contact that keeps the ball alive (usually
 *              the first touch on an opponent's attack)
 *   • pass   — serve-receive contact (the first touch after the serve)
 *   • error  — unforced error (service error, attack out, net touch, etc.)
 */
export type StatCategory =
  | 'kill'
  | 'block'
  | 'ace'
  | 'assist'
  | 'dig'
  | 'pass'
  | 'error';

/**
 * Quality grade for pass (serve-receive) and dig. The 0–3 scale is the
 * standard used in Sideline HD and most volleyball stat software:
 *   3 = perfect pass (setter has all options)
 *   2 = good pass (setter has most options)
 *   1 = ok pass (setter has limited options)
 *   0 = bad pass / shanked / aced
 */
export type PassQuality = 0 | 1 | 2 | 3;

export interface StatEvent extends BaseEvent {
  type: 'stat';
  /** Which team the player belongs to. */
  team: Side;
  /** Shirt # of the player being credited with this stat. */
  shirt: number;
  /** What the player did. */
  category: StatCategory;
  /** For pass/dig: quality grade 0–3. Optional for other categories. */
  quality?: PassQuality;
  /** Court snapshot at the moment of the stat — positions, liberos,
   *  server. Always populated so post-match aggregation has full context. */
  courtSnapshot: CourtSnapshot;
}

export interface SubEvent extends BaseEvent {
  type: 'sub';
  team: Side;
  /** Shirt # going off the court. */
  out: number;
  /** Shirt # coming on the court. */
  in: number;
  /**
   * FIVB §15.7 / V-C: when a player is injured and their team has used
   * all its normal substitutions, an "exceptional substitution" is
   * permitted — any player not on the floor at the time may come in,
   * and this sub does NOT count against the per-set sub cap. The paper
   * scoresheet records exceptional subs in the REMARKS section with
   * the set, team, name and number of the injured player and the
   * incoming player. The renderer reads this flag to know whether to
   * render the sub in the normal substitute column or in REMARKS.
   */
  exceptional?: boolean;
  /** Free-text reason printed alongside an exceptional sub on paper. */
  exceptionalReason?: string;
}

export interface LiberoOnEvent extends BaseEvent {
  type: 'libero-on';
  team: Side;
  /** Libero shirt # taking the floor. */
  libero: number;
  /** Back-row regular's shirt # going off. */
  replaces: number;
}

export interface LiberoOffEvent extends BaseEvent {
  type: 'libero-off';
  team: Side;
  libero: number;
  /** Back-row regular's shirt # coming back on. */
  replacedBy: number;
}

/**
 * Distinct from `libero-off`. Fired when a regular player permanently
 * replaces a libero mid-set due to injury, sickness, or sanction. Per
 * FIVB §19.4.2 the libero in question is locked out for the rest of
 * the set; a different libero (if any) takes over libero duties.
 */
export interface LiberoOfficiallyReplacedEvent extends BaseEvent {
  type: 'libero-officially-replaced';
  team: Side;
  libero: number;
  /** Regular shirt # who steps in as the libero replacement. The
   *  replaced libero is locked out from re-entry for the rest of the
   *  set; any other designated libero on the team can still play. */
  replacedBy: number;
  reason?: string;
}

export interface TimeoutEvent extends BaseEvent {
  type: 'timeout';
  team: Side;
  /**
   * Distinguishes a Technical Time-Out (TTO) from a regular requested
   * time-out. Beach (BVB/11) awards an automatic TTO at sum-of-points-21
   * in sets 1 and 2; FIVB indoor (top-flight competitions) used to award
   * TTOs at 8 and 16. Doesn't count against the team's 2-per-set request
   * limit and is rendered in the dedicated TTO column on the Beach
   * scoresheet. Defaults to a regular request (`undefined` / `false`).
   */
  technical?: boolean;
}

export interface SanctionEvent extends BaseEvent {
  type: 'sanction';
  team: Side;
  /**
   * Who's being sanctioned. Paper scoresheets render the target as an
   * abbreviation in the team-leaders block (C / AC / AC1 / AC2 / T / M)
   * or as the player's shirt # in the player block. We model each
   * possibility distinctly so the renderer can pick the right
   * abbreviation without guessing.
   */
  target:
    | 'player'
    | 'coach'                  // C
    | 'assistant-coach'        // AC (OVA Youth single-AC sheet)
    | 'assistant-coach-1'      // AC1 (FIVB)
    | 'assistant-coach-2'      // AC2 (FIVB)
    | 'team-therapist'         // T
    | 'medical-doctor'         // M
    | 'team'                   // collective sanction (rare)
    | 'staff';                 // catch-all for legacy entries
  shirt?: number;
  /**
   * Sanction level. Maps to the W / P / E / D columns on the paper
   * sheet. "formal-warning" is the Beach-only column ("Formal Warn.")
   * which precedes Misconduct sanctions and is recorded per-player on
   * the same row as their service order; on indoor sheets we won't
   * render it as a separate column but the data is preserved.
   */
  level:
    | 'formal-warning'         // Beach formal "Warn." (yellow flag)
    | 'warning'                // W (yellow card)
    | 'penalty'                // P (red card)
    | 'expulsion'              // E (red+yellow held separately)
    | 'disqualification';      // D (red+yellow held jointly)
  /**
   * Distinguishes a Delay sanction (a "D" prefix on the W / P column on
   * paper) from a normal misconduct sanction. Delay penalties give the
   * opponent a point and the next service — the renderer should circle
   * the resulting point in the opponent's POINTS column. The engine
   * still receives a separate `point` event for the awarded point;
   * this flag is purely for paper-rendering fidelity.
   */
  delayBased?: boolean;
  reason?: string;
}

/**
 * Improper request — recorded on the paper sheet as a tick-mark in the
 * "IMPROPER REQUEST: TEAM A : TEAM B" counter (and on Beach as a
 * per-set circle). Per FIVB rules, a team's first improper request in
 * a match draws no consequence but is logged; a SECOND improper request
 * by the same team in the same match is sanctioned as a delay warning.
 * Modelling as its own event keeps the audit log clean and lets the
 * renderer reproduce the per-team counter exactly.
 */
export interface ImproperRequestEvent extends BaseEvent {
  type: 'improper-request';
  team: Side;
  /** What was requested improperly (e.g. "extra time-out", "double sub").
   *  Free-text; printed in the REMARKS section if present. */
  reason?: string;
}

/**
 * Beach-only: medical-assistance tracking. The BVB/11 scoresheet has a
 * dedicated "Medical Assistance chart" with columns for MTO (medical
 * time-out, blood / no-blood) and RIT (recovery in time, weather /
 * toilet). Indoor sheets don't have an equivalent block; on the
 * indoor renderer this event simply doesn't render. Two MTO/RIT slots
 * per team per match are printed on paper.
 */
export interface MedicalAssistanceEvent extends BaseEvent {
  type: 'medical-assistance';
  team: Side;
  shirt: number;
  kind:
    | 'mto-blood'        // MTO with bleeding (longer break permitted)
    | 'mto-no-blood'     // MTO without bleeding
    | 'rit-weather'      // recovery-in-time for weather (sand on eye, etc.)
    | 'rit-toilet';      // recovery-in-time for bathroom
  reason?: string;
}

/**
 * Tap-to-confirm sign-off recorded as event so the match's audit log
 * stays a complete chronological record. One event per signing party.
 * The `party` enum covers every signature block on the four reference
 * scoresheets:
 *   • OVA Youth: 2 captains (post-match) + 2 coaches + 1st referee +
 *     2nd referee + scorer + assistant scorer.
 *   • FIVB International: same as OVA but no coach signatures (only
 *     captains + referees + scorers).
 *   • FIVB Beach: 2 captains PRE-match + 2 captains POST-match +
 *     1st/2nd referee + scorer + assistant scorer + line judges (named
 *     only, not signed).
 *   • R-6 Libero Control: assistant scorer signs the bottom of the
 *     separate libero sheet at match end.
 *
 * The `home-captain` / `away-captain` / `scorer` values from the
 * pre-paper-renderer model map to post-match signoffs; they're
 * retained for backwards compat with existing saved matches.
 */
export interface SignoffEvent extends BaseEvent {
  type: 'signoff';
  party:
    // Captain post-match (default — OVA / FIVB indoor / Beach)
    | 'home-captain'
    | 'away-captain'
    // Captain pre-match (Beach BVB/11 prints separate pre/post slots)
    | 'home-captain-pre'
    | 'away-captain-pre'
    // Coach signatures (OVA Youth requires both teams' coaches to sign)
    | 'home-coach'
    | 'away-coach'
    // Refereeing crew (paper APPROVAL block has signature columns for both)
    | 'first-referee'
    | 'second-referee'
    // Scoring crew
    | 'scorer'
    | 'assistant-scorer';
}

export interface SetEndEvent extends BaseEvent {
  type: 'set-end';
  homeFinal: number;
  awayFinal: number;
  durationMs: number;
}

export interface MatchEndEvent extends BaseEvent {
  type: 'match-end';
  setsHome: number;
  setsAway: number;
  durationMs: number;
}

export interface MatchAbandonedEvent extends BaseEvent {
  type: 'match-abandoned';
  reason: string;
  /** If a winner is awarded by forfeit, which side. Optional — some
   *  abandonments leave no result. */
  awarded?: { winner: Side };
}

export type MatchEvent =
  | LineupEvent
  | PointEvent
  | StatEvent
  | SubEvent
  | LiberoOnEvent
  | LiberoOffEvent
  | LiberoOfficiallyReplacedEvent
  | TimeoutEvent
  | SanctionEvent
  | ImproperRequestEvent
  | MedicalAssistanceEvent
  | SignoffEvent
  | SetEndEvent
  | MatchEndEvent
  | MatchAbandonedEvent;

// ── Match (storage shape) ──────────────────────────────────────────────────

export type MatchStatus = 'in-progress' | 'complete' | 'abandoned';

export interface Match {
  id: string;
  meta: MatchMeta;
  events: MatchEvent[];
  /** Captured at match start so historical matches keep rendering even
   *  if the source TeamProfile's roster is later edited. Source of truth
   *  for shirt-#-to-name lookups when displaying this match. */
  rosters: { home: RosterPlayer[]; away: RosterPlayer[] };
  status: MatchStatus;
  createdAt: number;
  updatedAt: number;
  /** Bump on schema changes. Storage layer can migrate as needed. */
  schemaVersion: 1;
}

// ── Derived state (pure function of events) ────────────────────────────────

export interface RotationState {
  /** Current shirt numbers in positions I..VI. */
  positions: Lineup;
  /** Configured liberos for the current set (per the lineup event). */
  liberos: number[];
  /** Libero shirt # currently on the floor, or null if none. */
  liberoOnFloor: number | null;
  /** When a libero is on, this is the back-row regular they replaced
   *  (off the floor, waiting). Null otherwise. */
  liberoReplacesShirt: number | null;
  /** Rally count at which the libero last came OFF the floor. Used to
   *  enforce the one-rally-rest rule on re-entry. Null if libero hasn't
   *  come off yet this set. */
  liberoCameOffAtRally: number | null;
  /** When configured, the position from which the libero serves (if
   *  the libero-may-serve rule is enabled for the team). */
  serveLiberoFromPosition: Position | null;
  /**
   * Re-entry tracking. For each player who has subbed off, tracks the
   * shirt # of the player they were replaced by. FIVB rule: a starter
   * who comes off can only re-enter as the player who replaced them
   * (and vice versa). Modelled as pairs of original-and-replacement
   * shirt #s. Validators flag violations as warnings.
   */
  subPairs: Array<{ starter: number; replacement: number }>;
  /** Total sub events used by this team in the current set. V-C cap is 12. */
  subsUsed: number;
  /**
   * Locked-out shirts: regulars that the rules engine considers ineligible
   * for the rest of the set (e.g. libero who was officially replaced by
   * a regular due to injury — original libero is locked out). Soft warning
   * only; not enforced strictly.
   */
  lockedOut: number[];
}

export interface SetSummary {
  setIndex: number;
  homeFinal: number;
  awayFinal: number;
  winner: Side;
  durationMs: number;
}

export interface MatchState {
  /** 0-based current set. After match-end, equals last completed set. */
  currentSetIndex: number;
  setsWon: { home: number; away: number };
  matchComplete: boolean;
  abandoned: boolean;
  abandonedReason?: string;
  winner: Side | 'tie' | null;
  /** Null when the match hasn't started or has ended; populated during play. */
  currentSet: {
    score: { home: number; away: number };
    rallyCount: number;
    server: Side | null;
    /** Shirt # of the current server (libero if rotation puts the
     *  libero into the configured serve slot, else the regular in
     *  position I). Null until first serve. */
    serverShirt: number | null;
    rotation: { home: RotationState; away: RotationState };
    timeoutsUsed: { home: number; away: number };
    target: number;
    isDecider: boolean;
  } | null;
  setHistory: SetSummary[];
  /** All sanctions across the match, in event order. Shown in the match
   *  summary view; not used by the rules engine. */
  sanctions: SanctionEvent[];
  /** Aggregated tap-to-confirm sign-off timestamps (epoch ms) derived
   *  from `signoff` events. Each party signs at most once; the UI uses
   *  presence of these fields to render a checkmark per party. */
  signoff: {
    homeCaptainAtMs?: number;
    awayCaptainAtMs?: number;
    scorerAtMs?: number;
  };
}

// ── Validation result ──────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  /** Human-readable strings the UI surfaces in a non-blocking warning
   *  modal. The engine NEVER hard-blocks an event on a rule warning —
   *  the scorer always has the override (sometimes the rule on the floor
   *  is being enforced differently than the rulebook). */
  warnings: string[];
}
