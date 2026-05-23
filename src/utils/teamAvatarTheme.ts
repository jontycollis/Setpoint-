// ── Team avatar theme helpers ─────────────────────────────────────────────
//
// Pure helpers for the auto-generated team avatars rendered by
// `TeamAvatar`. Extracted out of the component so they're testable under
// vitest's node environment (vitest deliberately skips react-native
// component files — see the vitest.config note).
// ──────────────────────────────────────────────────────────────────────────

/**
 * Return 1-2 uppercase initials for a team display name.
 *   "PVC 3D Royals"   → "PR"
 *   "Airdrie Hawks"   → "AH"
 *   "Defensa"         → "DE"
 *   "U18"             → "U1"
 *   ""                → "?"
 *
 * Picks the first non-empty alphanumeric token's first letter, then the
 * last non-empty token's first letter. If there is only one token,
 * returns its first two characters. Falls back to "?" for empty input.
 */
export function getInitialsForTeamName(name: string | undefined | null): string {
  if (!name) return '?';
  const tokens = name
    .split(/[\s\-_·]+/)
    .map((t) => t.trim())
    .filter((t) => /[A-Za-z0-9]/.test(t));
  if (tokens.length === 0) return '?';
  if (tokens.length === 1) {
    return tokens[0].slice(0, 2).toUpperCase();
  }
  const first = firstAlphaNum(tokens[0]);
  const last = firstAlphaNum(tokens[tokens.length - 1]);
  const combined = `${first}${last}`;
  return combined.length > 0 ? combined.toUpperCase() : '?';
}

function firstAlphaNum(token: string): string {
  for (const ch of token) {
    if (/[A-Za-z0-9]/.test(ch)) return ch;
  }
  return '';
}

/**
 * Deterministic HSL color for a given seed. The same seed always
 * produces the same color; different seeds spread across the hue wheel
 * so adjacent tiles read as visually distinct.
 *
 * Saturation 55–75% and lightness 40–50% keeps every swatch dark enough
 * that the white initials painted on top pass WCAG contrast.
 */
export function getColorForTeamSeed(seed: string): string {
  const hash = hashString(seed);
  const hue = hash % 360;
  const sat = 55 + (hash % 21);
  // Unsigned shift — a signed `>> 4` on a high-bit-set hash would yield
  // a negative number, and `% 11` on a negative dividend would push
  // lightness below the legibility band.
  const light = 40 + ((hash >>> 4) % 11);
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

/**
 * 32-bit FNV-1a hash. Cheap, well-distributed for short strings — used
 * only for color picking, so collisions are visually harmless.
 */
function hashString(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
