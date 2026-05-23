// ── teamAvatarTheme unit tests ───────────────────────────────────────────
//
// Covers the deterministic hash → color and the initials extraction used
// by the auto-generated team-tile avatars. Both helpers are pure, so the
// component itself (TeamAvatar.tsx) isn't required by these tests —
// vitest's node environment can't load react-native anyway.
// ──────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  getColorForTeamSeed,
  getInitialsForTeamName,
} from '../teamAvatarTheme';

describe('getInitialsForTeamName', () => {
  it('picks first + last token initials for multi-word names', () => {
    expect(getInitialsForTeamName('PVC 3D Royals')).toBe('PR');
    expect(getInitialsForTeamName('Airdrie Hawks')).toBe('AH');
    expect(getInitialsForTeamName('Defensa U18 2025-26')).toBe('D2');
  });

  it('returns the first two characters for a single token', () => {
    expect(getInitialsForTeamName('Defensa')).toBe('DE');
    expect(getInitialsForTeamName('U18')).toBe('U1');
  });

  it('uppercases lowercased input', () => {
    expect(getInitialsForTeamName('pakmen titans')).toBe('PT');
  });

  it('handles dashes, underscores, and middots as separators', () => {
    expect(getInitialsForTeamName('Pakmen-Titans')).toBe('PT');
    expect(getInitialsForTeamName('pakmen_titans')).toBe('PT');
    // Middot is the in-app subtitle joiner — splitting on it keeps the
    // helper consistent if a caller ever passes the joined subtitle.
    expect(getInitialsForTeamName('Pakmen · Titans')).toBe('PT');
  });

  it('falls back to "?" for empty / whitespace / null input', () => {
    expect(getInitialsForTeamName('')).toBe('?');
    expect(getInitialsForTeamName('   ')).toBe('?');
    expect(getInitialsForTeamName(null)).toBe('?');
    expect(getInitialsForTeamName(undefined)).toBe('?');
  });

  it('skips tokens that contain no alphanumerics', () => {
    expect(getInitialsForTeamName('Pakmen :: Titans')).toBe('PT');
  });
});

describe('getColorForTeamSeed', () => {
  it('returns a valid HSL string', () => {
    expect(getColorForTeamSeed('tp_abc123')).toMatch(
      /^hsl\(\d+, \d+%, \d+%\)$/
    );
  });

  it('is deterministic — same seed always returns the same color', () => {
    expect(getColorForTeamSeed('tp_abc123')).toBe(
      getColorForTeamSeed('tp_abc123')
    );
    expect(getColorForTeamSeed('Pakmen Titans')).toBe(
      getColorForTeamSeed('Pakmen Titans')
    );
  });

  it('produces different colors for different seeds', () => {
    const a = getColorForTeamSeed('tp_abc123');
    const b = getColorForTeamSeed('tp_xyz789');
    const c = getColorForTeamSeed('tp_aes_2025');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it('keeps lightness in the band that contrasts with white text', () => {
    // Lightness band is 40–50% so the white initials read on top. If the
    // helper ever drifts above ~60% the contrast guarantee is lost — this
    // test catches that drift.
    for (const seed of [
      'a',
      'A team with a long name',
      'tp_0000',
      'tp_ffff',
      'PVC 3D Royals',
    ]) {
      const color = getColorForTeamSeed(seed);
      const match = color.match(/^hsl\(\d+, \d+%, (\d+)%\)$/);
      expect(match).not.toBeNull();
      const light = Number(match![1]);
      expect(light).toBeGreaterThanOrEqual(40);
      expect(light).toBeLessThanOrEqual(50);
    }
  });
});
