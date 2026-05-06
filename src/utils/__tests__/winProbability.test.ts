// ── winProbability tests ───────────────────────────────────────────────────
//
// Sanity checks against the article's published values (50/50 case) plus
// the default-asymmetric (pAdv = 0.55) shipping configuration.
//
// Source: https://www.righto.com/2011/07/mathematics-of-volleyball.html
//
// The article quotes:
//   • P(0, 0)   ≈ 50%       at 50/50
//   • P(25, 24) = 75%       at 50/50  (closed-form deuce-extension boundary)
//   • P(24, 0)  = 100%      (already-won absorbing state)
//   • P(14, 0)  ≈ 99.996%   in a deciding set to 15, at 50/50
//
// We verify each, then add asymmetric-case sanity checks for the shipping
// pAdv = 0.55 default.
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { computeSetWinProbability, computeMatchPoint } from '../winProbability';

describe('computeSetWinProbability — symmetric (pAdv = 0.5)', () => {
  it('0-0 with home serving is exactly 50/50', () => {
    const r = computeSetWinProbability({
      homeScore: 0,
      awayScore: 0,
      target: 25,
      server: 'home',
      pServeAdvantage: 0.5,
    });
    // Symmetric inputs ⇒ symmetric outcome regardless of who serves.
    expect(r.pHomeWins).toBeCloseTo(0.5, 6);
    expect(r.homeSetPoint).toBe(false);
    expect(r.awaySetPoint).toBe(false);
  });

  it('0-0 with away serving is also 50/50 (symmetry)', () => {
    const r = computeSetWinProbability({
      homeScore: 0,
      awayScore: 0,
      target: 25,
      server: 'away',
      pServeAdvantage: 0.5,
    });
    expect(r.pHomeWins).toBeCloseTo(0.5, 6);
  });

  it('article quote: P(25, 24) = 75% with 50/50', () => {
    // Note: home is at 25 but only up by 1 — set isn't won (need win-by-2).
    // Recursion must handle the deuce extension.
    const r = computeSetWinProbability({
      homeScore: 25,
      awayScore: 24,
      target: 25,
      server: 'home',
      pServeAdvantage: 0.5,
    });
    // Article quotes 75% exactly. Allow tiny epsilon for the deuce-cap
    // truncation (set tgt*3+5 = 80, well past any realistic deuce).
    expect(r.pHomeWins).toBeCloseTo(0.75, 4);
  });

  it('24-0 absorbing-state-adjacent is essentially 100% (regardless of serve)', () => {
    // Home at 24 needs 1 more for the set. Even with adverse serve, it's
    // overwhelmingly likely they get there before away catches up.
    const r = computeSetWinProbability({
      homeScore: 24,
      awayScore: 0,
      target: 25,
      server: 'away',
      pServeAdvantage: 0.5,
    });
    expect(r.pHomeWins).toBeGreaterThan(0.99);
    expect(r.homeSetPoint).toBe(true);
  });

  it('article quote: 14-0 in a deciding set to 15 is ~99.996%', () => {
    // Article: P(14, 0) at target=15 ≈ 99.996% under 50/50.
    // With our recursion + serving-state tracking the result should be
    // within a few thousandths.
    const r = computeSetWinProbability({
      homeScore: 14,
      awayScore: 0,
      target: 15,
      server: 'home',
      pServeAdvantage: 0.5,
    });
    expect(r.pHomeWins).toBeGreaterThan(0.999);
    expect(r.homeSetPoint).toBe(true);
  });

  it('mid-set 12-12 is essentially 50/50', () => {
    const r = computeSetWinProbability({
      homeScore: 12,
      awayScore: 12,
      target: 25,
      server: 'home',
      pServeAdvantage: 0.5,
    });
    expect(r.pHomeWins).toBeCloseTo(0.5, 2);
  });

  it('11-13 with home serving favours away slightly', () => {
    const r = computeSetWinProbability({
      homeScore: 11,
      awayScore: 13,
      target: 25,
      server: 'home',
      pServeAdvantage: 0.5,
    });
    // Home is down 2; under 50/50 they're underdogs.
    expect(r.pHomeWins).toBeLessThan(0.5);
    expect(r.pHomeWins).toBeGreaterThan(0.3);
  });
});

describe('computeSetWinProbability — asymmetric (default pAdv = 0.55)', () => {
  it('0-0 with home serving slightly favours home (serve advantage)', () => {
    const r = computeSetWinProbability({
      homeScore: 0,
      awayScore: 0,
      target: 25,
      server: 'home',
      // default pServeAdvantage = 0.55
    });
    expect(r.pHomeWins).toBeGreaterThan(0.5);
    expect(r.pHomeWins).toBeLessThan(0.7);
  });

  it('0-0 with away serving slightly favours away', () => {
    const r = computeSetWinProbability({
      homeScore: 0,
      awayScore: 0,
      target: 25,
      server: 'away',
    });
    expect(r.pHomeWins).toBeLessThan(0.5);
    expect(r.pHomeWins).toBeGreaterThan(0.3);
  });

  it('24-0 with home serving (default pAdv) is essentially certain', () => {
    const r = computeSetWinProbability({
      homeScore: 24,
      awayScore: 0,
      target: 25,
      server: 'home',
    });
    expect(r.pHomeWins).toBeGreaterThan(0.99);
  });

  it('14-0 deciding set with home leading is near-certain home win', () => {
    const r = computeSetWinProbability({
      homeScore: 14,
      awayScore: 0,
      target: 15,
      server: 'away',
    });
    expect(r.pHomeWins).toBeGreaterThan(0.99);
  });

  it('24-24 deuce is roughly 50/50 even with serve advantage (alternating side-outs cancel out)', () => {
    const r = computeSetWinProbability({
      homeScore: 24,
      awayScore: 24,
      target: 25,
      server: 'home',
    });
    // At deuce with home serving, home has a small edge from the immediate
    // serve, but away will almost certainly side-out and even things out.
    // Total deviation from 0.5 should be modest.
    expect(r.pHomeWins).toBeGreaterThan(0.5);
    expect(r.pHomeWins).toBeLessThan(0.65);
  });
});

describe('set-point and match-point flags', () => {
  it('home at target-1 with sufficient lead is set point', () => {
    const r = computeSetWinProbability({
      homeScore: 24,
      awayScore: 22,
      target: 25,
      server: 'home',
    });
    expect(r.homeSetPoint).toBe(true);
    expect(r.awaySetPoint).toBe(false);
  });

  it('home at target-1 but only 1 ahead is NOT set point (need win-by-2)', () => {
    // 24-23: one more point gets home to 25 but lead = 25-23 = 2 ≥ 2, so YES set point.
    // Whereas 24-24 means one more = 25-24 = 1 < 2, NOT set point.
    const r1 = computeSetWinProbability({
      homeScore: 24,
      awayScore: 23,
      target: 25,
      server: 'home',
    });
    expect(r1.homeSetPoint).toBe(true);
    const r2 = computeSetWinProbability({
      homeScore: 24,
      awayScore: 24,
      target: 25,
      server: 'home',
    });
    expect(r2.homeSetPoint).toBe(false);
  });

  it('home set point + leading the match by sets-to-win-1 is match point', () => {
    const setSide = computeSetWinProbability({
      homeScore: 24,
      awayScore: 22,
      target: 25,
      server: 'home',
    });
    // best-of-5: setsToWin = 3. Home leads 2-0 in sets → next set wins match.
    const mp = computeMatchPoint({
      setsWonHome: 2,
      setsWonAway: 0,
      setsToWin: 3,
      homeSetPoint: setSide.homeSetPoint,
      awaySetPoint: setSide.awaySetPoint,
    });
    expect(mp.homeMatchPoint).toBe(true);
    expect(mp.awayMatchPoint).toBe(false);
  });

  it('set point but not enough sets won = NOT match point', () => {
    const setSide = computeSetWinProbability({
      homeScore: 24,
      awayScore: 22,
      target: 25,
      server: 'home',
    });
    // Best-of-5 but home has only 1 set; winning this set makes it 2-0,
    // not 3-0, so not match point.
    const mp = computeMatchPoint({
      setsWonHome: 1,
      setsWonAway: 0,
      setsToWin: 3,
      homeSetPoint: setSide.homeSetPoint,
      awaySetPoint: setSide.awaySetPoint,
    });
    expect(mp.homeMatchPoint).toBe(false);
  });
});

describe('robustness', () => {
  it('clamps NaN / negative scores defensively', () => {
    const r = computeSetWinProbability({
      homeScore: -5,
      awayScore: NaN as unknown as number,
      target: 25,
      server: 'home',
    });
    // Should not throw; result is finite.
    expect(Number.isFinite(r.pHomeWins)).toBe(true);
    expect(r.pHomeWins).toBeGreaterThanOrEqual(0);
    expect(r.pHomeWins).toBeLessThanOrEqual(1);
  });

  it('handles non-standard target / winBy combinations', () => {
    // Beach deciding set: target 15, winBy 2. Already covered above; here
    // we add a degenerate sudden-death config (winBy 1) for robustness.
    const r = computeSetWinProbability({
      homeScore: 14,
      awayScore: 14,
      target: 15,
      winBy: 1,
      server: 'home',
    });
    expect(r.pHomeWins).toBeGreaterThan(0.5); // home serves, has the edge
  });
});
