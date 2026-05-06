// ── Win-probability recursion ──────────────────────────────────────────────
//
// Pure utility for computing the probability that the home team wins the
// CURRENT set, given the score, target, who's serving, and a per-rally
// "serving team advantage" parameter.
//
// Source: Ken Shirriff, "The mathematics of volleyball" (2011).
//   https://www.righto.com/2011/07/mathematics-of-volleyball.html
//
// The article derives the recurrence
//   P(m, n) = ½ · [P(m+1, n) + P(m, n+1)]
// for the symmetric (50/50) case, with absorbing states at score = target
// and a 2-point margin. We extend it slightly so the per-rally probability
// can vary based on who's serving (FIVB rally-scoring captures a real
// serving-team edge of ~5–10% in elite play, larger at junior level).
//
//   Asymmetric form, with `pAdv = P(server wins rally)`:
//
//     P(h, a, server='home') = pAdv     · P(h+1, a, 'home')        ← home keeps the serve
//                            + (1-pAdv) · P(h,   a+1, 'away')      ← side-out: away serves
//     P(h, a, server='away') = (1-pAdv) · P(h+1, a, 'home')        ← side-out: home serves
//                            + pAdv     · P(h,   a+1, 'away')      ← away keeps the serve
//
// Base cases:
//   - h ≥ target ∧ h − a ≥ winBy  →  1  (home wins the set)
//   - a ≥ target ∧ a − h ≥ winBy  →  0  (away wins the set)
//
// Memoised on `(h, a, server)`. Recursion depth is bounded by the set
// target plus a deuce safety margin; even a 30-30 deuce extension is
// well under 100 deep. We hard-cap at h + a > target * 3 to bound
// pathological inputs and fall back to the leading score.
//
// Calibration (per the prompt):
//   v1 ships pAdv = 0.55 — the article's "small but real" serving-team
//   edge — kept static. A future setting could swap to (b) dynamic
//   calibration from rallies-won-while-serving in the current set, but
//   that bounces around early in the set and reads as noise on the bar.
//   Keeping (a) means the indicator is interpretable: "with a typical
//   serve advantage, here's the chance the home team takes this set."
// ────────────────────────────────────────────────────────────────────────────

export type Side = 'home' | 'away';

export interface WinProbabilityInput {
  homeScore: number;
  awayScore: number;
  /** First-to-N for this set. 25 for indoor regular sets, 15 for the
   *  deciding set (and for indoor U-divisions sometimes); 21 for beach
   *  regular, 15 for beach deciding. */
  target: number;
  /** Required margin to close the set (almost always 2). */
  winBy?: number;
  /** Who is serving the next rally. Affects the rally-by-rally probability
   *  via `pServeAdvantage`. */
  server: Side;
  /** P(serving team wins a rally). Defaults to 0.55 — the article's
   *  middle-of-the-road serving-team edge. Pass 0.5 for evenly-matched
   *  / no-edge play (matches the article's headline derivation). */
  pServeAdvantage?: number;
}

export interface WinProbabilityResult {
  /** Probability ∈ [0, 1] that the home team wins this set. */
  pHomeWins: number;
  /** True when one more point would win the set for home (i.e. home is
   *  at "set point"). */
  homeSetPoint: boolean;
  /** Symmetric flag for away. */
  awaySetPoint: boolean;
}

const DEFAULT_P_SERVE_ADVANTAGE = 0.55;
const DEFAULT_WIN_BY = 2;

/**
 * Compute P(home wins the current set | h, a, server).
 *
 * Returns the set-point flags too — both because the renderer wants to
 * display them and because match-point detection upstream uses them
 * (match point = set point + would-win-the-match).
 */
export function computeSetWinProbability(input: WinProbabilityInput): WinProbabilityResult {
  const {
    homeScore,
    awayScore,
    target,
    winBy = DEFAULT_WIN_BY,
    server,
    pServeAdvantage = DEFAULT_P_SERVE_ADVANTAGE,
  } = input;

  // Defensive clamps — production use should already pass clean values
  // but guard against NaN / negative scores creeping in from React state.
  // NaN sneaks past Math.max because every NaN comparison returns false,
  // so `Math.max(0, Math.floor(NaN)) === NaN`. Filter explicitly.
  const safe = (n: number, fallback: number) =>
    Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
  const h0 = safe(homeScore, 0);
  const a0 = safe(awayScore, 0);
  const tgt = Math.max(1, Number.isFinite(target) ? Math.floor(target) : 25);
  const wb = Math.max(1, Number.isFinite(winBy) ? Math.floor(winBy) : 2);
  const pAdv = Math.min(
    0.99,
    Math.max(0.01, Number.isFinite(pServeAdvantage) ? pServeAdvantage : DEFAULT_P_SERVE_ADVANTAGE)
  );

  // Hard cap to bound recursion in pathological inputs (e.g. malformed
  // deuce escapes). target * 3 + 5 is well clear of any plausible real
  // game; a 75-75 indoor set has never happened.
  const depthCap = tgt * 3 + 5;

  const cache = new Map<number, number>();
  // Encode the (h, a, server) tuple as a single integer key for
  // microscopically-faster lookups. Server lives in the high bit.
  function key(h: number, a: number, srv: Side): number {
    return ((srv === 'home' ? 1 : 0) << 16) | ((h & 0xff) << 8) | (a & 0xff);
  }

  function recurse(h: number, a: number, srv: Side): number {
    // Absorbing states.
    if (h >= tgt && h - a >= wb) return 1;
    if (a >= tgt && a - h >= wb) return 0;

    // Recursion-depth safety net. If we somehow blow past the cap with
    // neither team having clinched, bias toward whoever's leading.
    if (h + a > depthCap) {
      if (h > a) return 1;
      if (a > h) return 0;
      return 0.5;
    }

    const k = key(h, a, srv);
    const cached = cache.get(k);
    if (cached !== undefined) return cached;

    const pHomeWinsRally = srv === 'home' ? pAdv : 1 - pAdv;

    // After this rally:
    //   home wins → score becomes (h+1, a), home now serves.
    //   away wins → score becomes (h, a+1), away now serves.
    const ifHomeWinsRally = recurse(h + 1, a, 'home');
    const ifAwayWinsRally = recurse(h, a + 1, 'away');

    const result = pHomeWinsRally * ifHomeWinsRally + (1 - pHomeWinsRally) * ifAwayWinsRally;
    cache.set(k, result);
    return result;
  }

  const pHomeWins = recurse(h0, a0, server);

  // Set-point detection: one more rally-win for the side would close the set.
  const homeSetPoint = h0 + 1 >= tgt && h0 + 1 - a0 >= wb;
  const awaySetPoint = a0 + 1 >= tgt && a0 + 1 - h0 >= wb;

  return { pHomeWins, homeSetPoint, awaySetPoint };
}

// ── Match-level helpers ────────────────────────────────────────────────────

export interface MatchPointInput {
  setsWonHome: number;
  setsWonAway: number;
  /** Sets needed to win the MATCH (e.g. 2 for best-of-3, 3 for best-of-5). */
  setsToWin: number;
  /** Set-point flags from `computeSetWinProbability`. */
  homeSetPoint: boolean;
  awaySetPoint: boolean;
}

export interface MatchPointResult {
  homeMatchPoint: boolean;
  awayMatchPoint: boolean;
}

/**
 * Match point = "next rally win takes the SET, AND that set takes the MATCH".
 * Reuses the set-point flags so the renderer doesn't need to re-derive them.
 */
export function computeMatchPoint(input: MatchPointInput): MatchPointResult {
  const { setsWonHome, setsWonAway, setsToWin, homeSetPoint, awaySetPoint } = input;
  return {
    homeMatchPoint: homeSetPoint && setsWonHome + 1 >= setsToWin,
    awayMatchPoint: awaySetPoint && setsWonAway + 1 >= setsToWin,
  };
}
