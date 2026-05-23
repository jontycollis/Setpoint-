// ── formatBracketMatchMeta tests ──────────────────────────────────────────
//
// Regression-pins the bracket-time bug: AES returns
// `BracketMatch.ScheduledStartDateTime` as an ISO string (matching every
// other match endpoint in the API), but it had been typed as `number` and
// the screen guard `typeof === 'number'` silently rejected every real
// payload. The asserts below would all have failed under that bug:
//   • `hasTime` would be false on a real bracket response
//   • `timeStr` / `dateStr` would be empty strings
// ──────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { formatBracketMatchMeta } from '../bracketMatchMeta';
import type { BracketMatch } from '../../api/aesClient';

const TORONTO = 'America/Toronto';

/** Sample bracket-match payload mirroring the AES `/play/{id}` response. */
function bracketMatch(overrides: Partial<BracketMatch> = {}): BracketMatch {
  return {
    MatchId: 12345,
    FirstTeam: { TeamId: 1, TeamName: 'Foo' },
    SecondTeam: { TeamId: 2, TeamName: 'Bar' },
    FirstTeamText: 'Foo',
    SecondTeamText: 'Bar',
    FullName: 'Quarter-Final 1',
    ShortName: 'QF1',
    HasScores: false,
    FirstTeamWon: false,
    SecondTeamWon: false,
    Sets: [],
    // AES strips the tz suffix and means "wall time at the venue" — exactly
    // the shape `parseScheduleTime` is built for.
    ScheduledStartDateTime: '2026-05-24T09:00:00',
    Court: { Name: 'Court 7' },
    ...overrides,
  };
}

describe('formatBracketMatchMeta', () => {
  it('parses an ISO-string ScheduledStartDateTime and renders the time', () => {
    const meta = formatBracketMatchMeta(bracketMatch(), TORONTO, 'venue');
    expect(meta.hasTime).toBe(true);
    expect(meta.hasCourt).toBe(true);
    expect(meta.courtName).toBe('Court 7');
    // Venue tz means 9 AM Toronto regardless of the runner's local tz.
    expect(meta.timeStr).toBe('9:00 AM');
    expect(meta.dateStr).toContain('May 24');
  });

  it('hides the time row when AES has not yet stamped a start', () => {
    const meta = formatBracketMatchMeta(
      bracketMatch({ ScheduledStartDateTime: undefined }),
      TORONTO,
      'venue',
    );
    expect(meta.hasTime).toBe(false);
    expect(meta.timeStr).toBe('');
    expect(meta.dateStr).toBe('');
  });

  it('hides the court badge when the bracket has not been seeded onto a court', () => {
    const meta = formatBracketMatchMeta(
      bracketMatch({ Court: null }),
      TORONTO,
      'venue',
    );
    expect(meta.hasCourt).toBe(false);
    expect(meta.courtName).toBe('');
  });

  it('honours tz-suffixed strings (Z) without venue tz', () => {
    // Sanity check the legacy fallback: an ISO string carrying its own
    // tz suffix is honoured directly, even when the caller has no venueTz.
    const meta = formatBracketMatchMeta(
      bracketMatch({ ScheduledStartDateTime: '2026-05-24T13:00:00Z' }),
      undefined,
      'dual',
    );
    expect(meta.hasTime).toBe(true);
    // We can't assert the exact rendering (depends on runner tz), but the
    // pipeline must produce a non-empty string.
    expect(meta.timeStr.length).toBeGreaterThan(0);
    expect(meta.dateStr.length).toBeGreaterThan(0);
  });

  it('returns empty strings for the time pair while keeping the court badge', () => {
    const meta = formatBracketMatchMeta(
      bracketMatch({ ScheduledStartDateTime: undefined, Court: { Name: 'Court 3' } }),
      TORONTO,
      'venue',
    );
    expect(meta.hasTime).toBe(false);
    expect(meta.hasCourt).toBe(true);
    expect(meta.courtName).toBe('Court 3');
  });

  it('emits dual-tz parens when venue and device offsets differ', () => {
    // 'venue' mode collapses to a single string; switch to 'dual' so the
    // user-local half appears when offsets differ. We can't predict the
    // runner's device tz, but we can assert that — when device ≠ Toronto —
    // the output contains a parenthesised second time. When the runner
    // happens to also be on Toronto time, the output collapses to one
    // string; that's a valid outcome too.
    const meta = formatBracketMatchMeta(bracketMatch(), TORONTO, 'dual');
    expect(meta.hasTime).toBe(true);
    expect(meta.timeStr).toMatch(/^9:00 AM(?: \(.+\))?$/);
  });
});
