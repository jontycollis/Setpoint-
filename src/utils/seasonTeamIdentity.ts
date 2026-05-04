// ── Season Team Identity ───────────────────────────────────────────────────
//
// The unified cross-source season view needs to know "which team in this
// tournament is me?". AES team IDs change per event; Timu has no team IDs
// at all. The only durable identifier is the team's name — and even that
// varies across systems (e.g. "Defensa U18 Rob" on AES vs "Defensa Rob"
// on Timu).
//
// We persist a set of aliases for the user's team. Whenever they confirm
// or pick their team when adding a tournament, that team's name gets
// added to the alias set. Queries then match any snapshot team whose
// normalized name equals any alias.
// ────────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'season.myTeamAliases.v1';

export async function loadMyTeamAliases(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveMyTeamAliases(aliases: string[]): Promise<void> {
  try {
    // Dedup (case-insensitive) and cap at 20 to keep storage tiny.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const a of aliases) {
      const k = normalizeName(a);
      if (!k) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(a.trim());
      if (out.length >= 20) break;
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch {
    /* ignore */
  }
}

/**
 * Add `name` to the persisted alias list. No-op if the name is empty or
 * already present. Returns the updated list.
 */
export async function addMyTeamAlias(name: string): Promise<string[]> {
  const cur = await loadMyTeamAliases();
  const key = normalizeName(name);
  if (!key) return cur;
  const already = cur.some((a) => normalizeName(a) === key);
  if (already) return cur;
  const next = [...cur, name.trim()];
  await saveMyTeamAliases(next);
  return next;
}

export async function removeMyTeamAlias(name: string): Promise<string[]> {
  const cur = await loadMyTeamAliases();
  const key = normalizeName(name);
  const next = cur.filter((a) => normalizeName(a) !== key);
  if (next.length !== cur.length) {
    await saveMyTeamAliases(next);
  }
  return next;
}

// ── Fuzzy match helpers ───────────────────────────────────────────────────

/**
 * Normalize a team name for comparison: lowercase, trim, collapse
 * whitespace, strip common age-group markers ("18U", "U18", "18 Under")
 * so "Defensa U18 Rob" and "Defensa Rob" land on the same key.
 */
export function normalizeName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    // Strip age-group prefixes/suffixes anywhere in the name.
    .replace(/\b(\d{1,2}u|u\d{1,2}|\d{1,2}\s*under)\b/gi, ' ')
    // Girls/boys markers sometimes cluttered into the team text.
    .replace(/\b(girls?|boys?)\b/gi, ' ')
    // Collapse whitespace.
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score similarity between two team names — 0 to 1 (1 = identical).
 * Uses a simple token-overlap metric after normalization. Good enough for
 * "Defensa U18 Rob" ↔ "Defensa Rob" (overlap = 1.0) without pulling in a
 * proper Levenshtein library.
 */
export function similarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(' ').filter(Boolean));
  const tb = new Set(nb.split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  // Jaccard with a slight boost when one is a strict superset of the other.
  const jaccard = overlap / (ta.size + tb.size - overlap);
  const containment = overlap / Math.min(ta.size, tb.size);
  return Math.max(jaccard, containment * 0.9);
}

/**
 * Rank a team list by similarity to `query` — returns top N suggestions
 * (descending similarity) above a threshold. Used when prompting the user
 * to confirm which team is theirs in a new tournament.
 */
export function suggestTeams<T extends { name: string }>(
  query: string,
  candidates: T[],
  topN: number = 5,
  threshold: number = 0.2
): Array<T & { _score: number }> {
  return candidates
    .map((c) => ({ ...c, _score: similarity(query, c.name) }))
    .filter((c) => c._score >= threshold)
    .sort((a, b) => b._score - a._score)
    .slice(0, topN);
}

/**
 * Return true if `name` matches any of the provided aliases after
 * normalization. Also treats strong similarity (>= 0.9) as a match so
 * slight variations (spacing, age-group markers) don't require an alias.
 */
export function matchesAnyAlias(name: string, aliases: string[]): boolean {
  if (!name) return false;
  const n = normalizeName(name);
  if (!n) return false;
  for (const a of aliases) {
    const k = normalizeName(a);
    if (!k) continue;
    if (n === k) return true;
    if (similarity(name, a) >= 0.9) return true;
  }
  return false;
}
