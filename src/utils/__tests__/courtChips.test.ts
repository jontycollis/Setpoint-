// ── buildCourtList tests ──────────────────────────────────────────────────
//
// Pins the natural-sort + dedupe behaviour behind the court-filter chip
// strip on CourtScheduleScreen. The reason this helper exists at all is
// to keep large-event court ordering correct ("Court 10" after "Court 9",
// not after "Court 1"), so the numeric cases are the load-bearing ones.
// ──────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { buildCourtList, type CourtChipMatch } from '../courtChips';

function m(CourtName: string | undefined): CourtChipMatch {
  return { CourtName };
}

describe('buildCourtList', () => {
  it('returns [] for no matches', () => {
    expect(buildCourtList([])).toEqual([]);
  });

  it('dedupes and natural-sorts plain-number court names', () => {
    const out = buildCourtList([
      m('10'),
      m('2'),
      m('1'),
      m('2'),
      m('11'),
    ]);
    expect(out).toEqual(['1', '2', '10', '11']);
  });

  it('natural-sorts "Court N" style names so 10 follows 9', () => {
    const out = buildCourtList([
      m('Court 1'),
      m('Court 10'),
      m('Court 2'),
      m('Court 9'),
    ]);
    expect(out).toEqual(['Court 1', 'Court 2', 'Court 9', 'Court 10']);
  });

  it('sorts purely alphabetic court names lexically', () => {
    const out = buildCourtList([m('Court B'), m('Court A'), m('Court C')]);
    expect(out).toEqual(['Court A', 'Court B', 'Court C']);
  });

  it('handles a 56-court venue without lexical-string drift', () => {
    const names = Array.from({ length: 56 }, (_, i) => `Court ${i + 1}`);
    // Shuffle by reversing — easiest deterministic non-sorted order.
    const reversed = [...names].reverse();
    expect(buildCourtList(reversed.map(m))).toEqual(names);
  });

  it('skips matches with missing or empty court names', () => {
    const out = buildCourtList([
      m(undefined),
      m(''),
      m('   '),
      m('Court 1'),
    ]);
    expect(out).toEqual(['Court 1']);
  });

  it('trims whitespace before deduping', () => {
    const out = buildCourtList([m('Court 1'), m('  Court 1  '), m('Court 2')]);
    expect(out).toEqual(['Court 1', 'Court 2']);
  });
});
