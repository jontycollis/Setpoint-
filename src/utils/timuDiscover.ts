// ── Timu Discovery ─────────────────────────────────────────────────────────
//
// Timu has no team-search or team-history endpoint. To find every tournament
// a team has played in, we crawl a contiguous range of tournament ids (tid),
// fetching each event's pools page and regex-extracting just the team names.
// Matches against the user's team aliases yield candidate tournaments that
// can be fed to `bulkIndex` for a full snapshot.
//
// Performance characteristics (pools.php is the smallest of the four pages
// — typically ~50 KB):
//   • ~3 concurrent requests, ~200–500 ms each → ~1–2 min per 600 tids
//   • Skip cache persisted under `timu.scanned.v1` — already-scanned tids
//     are skipped on subsequent runs (default 7-day TTL)
//   • Cache also remembers matched team names so the user can re-open
//     the discovery list without rescanning
// ────────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import { matchesAnyAlias } from './seasonTeamIdentity';

// v2 of the cache stores ALL extracted team names per tid (not just the
// matched ones for one alias set). This makes the cache alias-agnostic:
// re-running discovery with a different team's aliases re-evaluates the
// stored team list locally instead of skipping the tid. Old v1 entries
// were poisoning the cache because `matched: false` was sticky regardless
// of which aliases produced that result.
const STORAGE_KEY = 'timu.scanned.v2';
const STORAGE_KEY_V1 = 'timu.scanned.v1';
const TIMU_BASE = 'https://www.timu.ca/scoreboards';
const SCAN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Cache ────────────────────────────────────────────────────────────────

interface ScanCacheEntry {
  tid: number;
  scannedAt: number;
  /** Whether the pools page parsed at all. Used to decide whether to retry. */
  ok: boolean;
  name?: string;
  subtitle?: string;
  dateText?: string;
  dateMs?: number;
  /** Every team name extracted from pools.php — used to re-evaluate match
   *  decisions when aliases change between discovery runs. */
  teams?: string[];
}

type ScanCache = Record<string, ScanCacheEntry>;

async function loadCache(): Promise<ScanCache> {
  try {
    // Drop legacy v1 cache the first time we see it — its `matched: false`
    // entries were poisoning re-discovery for new alias sets.
    AsyncStorage.removeItem(STORAGE_KEY_V1).catch(() => {});
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function saveCache(cache: ScanCache): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

/** Erase the discovery scan cache. Forces fresh scanning on next run. */
export async function clearDiscoveryCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ── Lightweight pools-page scanning ──────────────────────────────────────

async function fetchPoolsHtml(tid: number): Promise<string | null> {
  try {
    const res = await fetch(
      `${TIMU_BASE}/pools.php?tid=${tid}&_t=${Date.now()}`,
      {
        headers: {
          'Accept': 'text/html',
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store' as RequestCache,
      }
    );
    if (!res.ok) return null;
    const text = await res.text();
    // Same single→double quote normalization as timuClient's fetchHtml —
    // ensures the pool team-name regex hits regardless of which quote
    // style Timu used for `class=...` on a given page.
    return text.replace(
      /(\s[\w-]+)\s*=\s*'([^']*)'/g,
      (_full, attr, value) => `${attr}="${value}"`
    );
  } catch {
    return null;
  }
}

/**
 * Strip script/style/comments and text-bearing attributes — same approach
 * as `parseTournamentInfo` in `timuClient.ts`. Inlined here so this module
 * can stay lean and not pull in the full client.
 */
function stripNoise(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(
      /\s(href|onclick|onmouseover|onfocus|onblur|title|alt|data-[\w-]+)\s*=\s*(?:"[^"]*"|'[^']*')/gi,
      ' $1=""'
    );
}

function extractTeamNames(html: string): string[] {
  const names: string[] = [];
  const re = /<div[^>]*class="poolT"[^>]*>([\s\S]*?)<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const name = m[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    if (name) names.push(name);
  }
  return names;
}

const MONTHS_RE =
  /(January|February|March|April|May|June|July|August|September|October|November|December)/i;

const DATE_RE = new RegExp(
  MONTHS_RE.source +
    '\\s+\\d+[a-z]{0,2}(?:\\s*-\\s*(?:[A-Za-z]+\\s+)?\\d+[a-z]{0,2})?,\\s*\\d{4}',
  'i'
);

function extractDivContentAt(html: string, tagStart: number): string | null {
  const tagEnd = html.indexOf('>', tagStart);
  if (tagEnd < 0) return null;
  const start = tagEnd + 1;
  let depth = 1;
  let i = start;
  while (i < html.length && depth > 0) {
    const no = html.indexOf('<div', i);
    const nc = html.indexOf('</div', i);
    if (nc === -1) break;
    if (no !== -1 && no < nc) {
      depth++;
      i = no + 4;
    } else {
      depth--;
      i = nc + 5;
    }
  }
  if (depth !== 0) return null;
  const end = html.lastIndexOf('</div', i);
  return end < start ? '' : html.slice(start, end);
}

function parseDateText(s: string): number | undefined {
  if (!s) return undefined;
  const cleaned = s.replace(/(\d+)(?:st|nd|rd|th)/gi, '$1');
  const m = cleaned.match(
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d+)(?:\s*-\s*\d+)?,\s*(\d{4})/i
  );
  if (!m) return undefined;
  const d = new Date(`${m[1]} ${m[2]}, ${m[3]} 12:00:00`);
  const ms = d.getTime();
  return isNaN(ms) ? undefined : ms;
}

function extractTournamentMeta(html: string): {
  name?: string;
  subtitle?: string;
  dateText?: string;
  dateMs?: number;
} {
  const cleaned = stripNoise(html);
  const dateMatch = cleaned.match(DATE_RE);
  const dateText = dateMatch ? dateMatch[0] : undefined;
  const dateMs = dateText ? parseDateText(dateText) : undefined;

  let name: string | undefined;
  let subtitle: string | undefined;
  if (dateMatch && dateMatch.index != null) {
    const tagStart = cleaned.lastIndexOf('<div', dateMatch.index);
    if (tagStart >= 0) {
      const inner = extractDivContentAt(cleaned, tagStart);
      if (inner) {
        const lines = inner
          .split(/<br\s*\/?>/i)
          .map((s) =>
            s
              .replace(/<[^>]+>/g, '')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/\s+/g, ' ')
              .trim()
          )
          .filter(Boolean)
          .filter((l) => !DATE_RE.test(l))
          .filter((l) => l.length >= 3 && l.length <= 120 && !/[{};=]/.test(l));
        if (lines.length >= 1) name = lines[0];
        if (lines.length >= 2) subtitle = lines[1];
      }
    }
  }
  return { name, subtitle, dateText, dateMs };
}

// ── Public types ─────────────────────────────────────────────────────────

export interface ScanResult {
  tid: number;
  ok: boolean;
  name?: string;
  subtitle?: string;
  dateText?: string;
  dateMs?: number;
  /** Every team name found on the pools page. */
  teams: string[];
  /** Names that matched any alias passed in. */
  matchedTeams: string[];
}

export interface DiscoveredEvent {
  tid: number;
  name: string;
  subtitle?: string;
  dateText?: string;
  dateMs?: number;
  /** Names from the tournament that matched the user's aliases. */
  matchedTeams: string[];
}

export interface ScanProgress {
  /** Number of tids processed (scanned + cache-skipped). */
  done: number;
  total: number;
  /** Tids that produced a match. */
  found: number;
  /** Tids skipped due to cache. */
  skipped: number;
  /** Tid currently being processed (or just finished). */
  current: number;
}

// ── Single-tid scan (also exported for test/debug) ───────────────────────

/**
 * Fetch one tid's pools page and pull out team names + tournament meta.
 * Used internally by `discoverTeamEvents`. Safe to call directly.
 */
export async function scanTid(
  tid: number,
  aliases: string[]
): Promise<ScanResult> {
  const html = await fetchPoolsHtml(tid);
  if (!html) {
    return { tid, ok: false, teams: [], matchedTeams: [] };
  }
  const teams = extractTeamNames(html);
  const matchedTeams = teams.filter((n) => matchesAnyAlias(n, aliases));
  const meta = extractTournamentMeta(html);
  return {
    tid,
    ok: true,
    name: meta.name,
    subtitle: meta.subtitle,
    dateText: meta.dateText,
    dateMs: meta.dateMs,
    teams,
    matchedTeams,
  };
}

// ── Bulk discovery ───────────────────────────────────────────────────────

export interface DiscoverOptions {
  concurrency?: number; // default 3 (clamped 1..5)
  /** Use the persisted scan cache. Default true. */
  useCache?: boolean;
  /** Override the cache TTL when treating cached entries as "fresh". */
  cacheTtlMs?: number;
}

/**
 * Crawl a tid range looking for any tournament containing one of the
 * user's team aliases. Newest-first ordering in results. Persists a
 * scan cache so subsequent runs only hit fresh tids.
 */
export async function discoverTeamEvents(
  aliases: string[],
  tidStart: number,
  tidEnd: number,
  onProgress?: (p: ScanProgress) => void,
  options?: DiscoverOptions
): Promise<DiscoveredEvent[]> {
  if (tidStart > tidEnd) {
    [tidStart, tidEnd] = [tidEnd, tidStart];
  }
  const concurrency = Math.max(1, Math.min(5, options?.concurrency ?? 3));
  const useCache = options?.useCache !== false;
  const ttl = options?.cacheTtlMs ?? SCAN_TTL_MS;
  const cache = useCache ? await loadCache() : {};

  const queue: number[] = [];
  for (let tid = tidEnd; tid >= tidStart; tid--) queue.push(tid);

  const total = queue.length;
  let done = 0;
  let found = 0;
  let skipped = 0;
  const matches = new Map<number, DiscoveredEvent>();

  // Helper: turn a cached entry's stored team list into a DiscoveredEvent
  // by re-evaluating against the CURRENT alias set. This is the core of
  // the v2 cache — the same fetched data answers any team's "do you have
  // me?" question without going back to Timu.
  function tryMatchFromCache(c: ScanCacheEntry): DiscoveredEvent | null {
    if (!c.ok || !c.teams) return null;
    const matchedTeams = c.teams.filter((n) => matchesAnyAlias(n, aliases));
    if (matchedTeams.length === 0) return null;
    return {
      tid: c.tid,
      name: c.name || `Tournament ${c.tid}`,
      subtitle: c.subtitle,
      dateText: c.dateText,
      dateMs: c.dateMs,
      matchedTeams,
    };
  }

  // Pre-load any cached tids that match the current aliases so they
  // appear in results immediately, even before any new scans complete.
  if (useCache) {
    for (const tid of queue) {
      const c = cache[String(tid)];
      if (!c || c.scannedAt < Date.now() - ttl) continue;
      const m = tryMatchFromCache(c);
      if (m) matches.set(tid, m);
    }
  }

  async function worker() {
    while (queue.length) {
      const tid = queue.shift()!;
      const c = cache[String(tid)];
      // Cache hit + fresh + has team list → re-evaluate locally without
      // a network fetch. This is what fixes the cross-team poisoning.
      if (
        useCache &&
        c &&
        c.scannedAt > Date.now() - ttl &&
        c.ok &&
        c.teams !== undefined
      ) {
        const m = tryMatchFromCache(c);
        if (m) {
          matches.set(tid, m);
          found = matches.size; // recompute since pre-load may already have set it
        }
        skipped++;
        done++;
        onProgress?.({ done, total, found: matches.size, skipped, current: tid });
        continue;
      }
      // Cache miss / stale / unparseable → fetch fresh.
      const r = await scanTid(tid, aliases);
      done++;
      cache[String(tid)] = {
        tid,
        scannedAt: Date.now(),
        ok: r.ok,
        name: r.name,
        subtitle: r.subtitle,
        dateText: r.dateText,
        dateMs: r.dateMs,
        teams: r.teams, // store ALL teams, not just matched
      };
      if (r.ok && r.matchedTeams.length > 0) {
        found++;
        matches.set(tid, {
          tid,
          name: r.name || `Tournament ${tid}`,
          subtitle: r.subtitle,
          dateText: r.dateText,
          dateMs: r.dateMs,
          matchedTeams: r.matchedTeams,
        });
      }
      onProgress?.({ done, total, found: matches.size, skipped, current: tid });
    }
  }

  // Start workers (capped to actual queue size)
  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, () => worker())
  );

  // Persist cache once at the end (single AsyncStorage write).
  if (useCache) {
    await saveCache(cache);
  }

  // Newest first. Tids missing a parsed date sink to the bottom.
  return Array.from(matches.values()).sort(
    (a, b) => (b.dateMs ?? 0) - (a.dateMs ?? 0)
  );
}

// ── Helpers for callers ──────────────────────────────────────────────────

/**
 * Suggest a sensible default tid range based on existing snapshots.
 * Looks at the highest tid in `existingTids` (or falls back to
 * `defaultEnd`) and returns a window that covers a full season backward.
 */
export function suggestRange(
  existingTids: number[],
  defaultWindow: number = 600,
  defaultEnd: number = 4200
): { tidStart: number; tidEnd: number } {
  const max = existingTids.length ? Math.max(...existingTids) : defaultEnd;
  const tidEnd = max;
  const tidStart = Math.max(1, max - defaultWindow);
  return { tidStart, tidEnd };
}
