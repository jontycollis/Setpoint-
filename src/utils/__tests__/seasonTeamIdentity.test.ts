// ── seasonTeamIdentity unit tests ──────────────────────────────────────────
//
// Pure-function tests for `normalizeName` and `matchesAnyAlias`. The focus
// here is the ranking-style parenthetical strip ("(ON53)", "(Ontario 53)",
// "[BC12]", "(53)", ...) used by OVA / Canadian-nationals tournament
// listings. Without that strip, the same team appears under different
// keys in AES/Timu vs. an OVA tournament and cross-source alias matching
// breaks (the bug that motivated this test file: PVC 3D Sparks picked up
// from a Nationals listing as "PVC 3D Sparks (ON53)" failing to match
// "PVC 3D Sparks" everywhere else).
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { normalizeName, matchesAnyAlias } from '../seasonTeamIdentity';

describe('normalizeName — ranking-style parenthetical strip', () => {
  it('strips "(ON53)" — Canadian province code + rank', () => {
    expect(normalizeName('PVC 3D Sparks (ON53)')).toBe(
      normalizeName('PVC 3D Sparks')
    );
  });

  it('strips "(ON-53)" — dash variant', () => {
    expect(normalizeName('PVC 3D Sparks (ON-53)')).toBe(
      normalizeName('PVC 3D Sparks')
    );
  });

  it('strips "[ON53]" — square bracket variant', () => {
    expect(normalizeName('PVC 3D Sparks [ON53]')).toBe(
      normalizeName('PVC 3D Sparks')
    );
  });

  it('strips "(Ontario 53)" — full province name + rank', () => {
    expect(normalizeName('PVC 3D Sparks (Ontario 53)')).toBe(
      normalizeName('PVC 3D Sparks')
    );
  });

  it('strips bare "(53)" — number alone', () => {
    expect(normalizeName('Team (53)')).toBe(normalizeName('Team'));
  });

  it('strips US state-style "(NY42)"', () => {
    expect(normalizeName('Some Club (NY42)')).toBe(normalizeName('Some Club'));
  });

  it('strips lowercase "(on53)" — case-insensitive', () => {
    expect(normalizeName('PVC 3D Sparks (on53)')).toBe(
      normalizeName('PVC 3D Sparks')
    );
  });

  it('strips ranking + age-group together: "PVC 3D Sparks U17 (ON53)"', () => {
    expect(normalizeName('PVC 3D Sparks U17 (ON53)')).toBe(
      normalizeName('PVC 3D Sparks')
    );
  });
});

describe('normalizeName — does NOT strip non-ranking parentheticals', () => {
  it('leaves "(Coach Smith)" alone — no digit', () => {
    // Hand-rolled "no leak" check: the parens should still be present in
    // the output, proving the new regex did not gobble them.
    const out = normalizeName('Defensa (Coach Smith)');
    expect(out).toContain('(');
    expect(out).toContain('coach');
  });

  it('leaves "(Brampton)" alone — pure text, no digit', () => {
    const out = normalizeName('PVC 3D Sparks (Brampton)');
    expect(out).toContain('brampton');
  });

  it('does not strip "(U18)" — that is age-group info, not a ranking', () => {
    // The existing age-group strip removes the "u18" token but leaves
    // the parens behind. Our new regex must not gobble the whole
    // parenthetical (which would erase the parens too). The key check:
    // the result must NOT equal the no-parens, no-age form, because
    // that would prove we *did* strip the whole parenthetical.
    const withParens = normalizeName('Pakmen (U18)');
    const plainPakmen = normalizeName('Pakmen');
    expect(withParens).not.toBe(plainPakmen);
    expect(withParens).toContain('(');
  });
});

describe('matchesAnyAlias — cross-source ranking-suffix scenario', () => {
  it('Nationals listing with (ON53) matches AES/Timu listing without it', () => {
    // The motivating bug: user added "PVC 3D Sparks (ON53)" as an alias
    // from a Canadian-nationals listing, then the same team appeared in
    // AES/Timu as plain "PVC 3D Sparks" and matchesAnyAlias returned
    // false. After the ranking strip, both normalise to the same key.
    expect(
      matchesAnyAlias('PVC 3D Sparks', ['PVC 3D Sparks (ON53)'])
    ).toBe(true);
    expect(
      matchesAnyAlias('PVC 3D Sparks (ON53)', ['PVC 3D Sparks'])
    ).toBe(true);
  });

  it('still respects different teams: "Durham Attack" vs "Durham Attack Blast"', () => {
    // Defensive: a ranking suffix on one side shouldn't suddenly start
    // matching a genuinely different team on the other.
    expect(
      matchesAnyAlias('Durham Attack Blast', ['Durham Attack (ON12)'])
    ).toBe(false);
  });
});
