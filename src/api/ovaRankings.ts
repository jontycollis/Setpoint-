// ── OVA Team Rankings ──────────────────────────────────────────────────────
//
// The Ontario Volleyball Association posts season rankings on their public
// site:
//   https://www.ontariovolleyball.org/girls-team-rankings
//   https://www.ontariovolleyball.org/boys-team-rankings
//
// Each page renders ~7 ranking tables (one per division: 4v4, 6v6, TLS,
// 15U, 16U, 17U, 18U) plus a few unrelated search widgets we filter out.
//
// We scrape the HTML, pair each H3 heading with the table that follows it
// in document order, and produce a structured `OvaRankingsSnapshot`. The
// snapshot is cached locally with a 6-hour TTL — rankings update at most
// every couple of weeks (after each cup tournament), so a 6h refresh keeps
// the data fresh without hammering the OVA site.
// ────────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';

const URLS = {
  girls: 'https://www.ontariovolleyball.org/girls-team-rankings',
  boys: 'https://www.ontariovolleyball.org/boys-team-rankings',
} as const;

const CACHE_KEY = 'ova.rankings.v1';
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ── Types ─────────────────────────────────────────────────────────────────

export type OvaGender = 'girls' | 'boys';

export interface OvaTeamRanking {
  /** 1-based rank from the table (some divisions may have ties). */
  rank: number;
  teamName: string;
  /** All other column values, keyed by header. */
  stats: Record<string, string>;
}

export interface OvaDivisionRanking {
  /** Heading text from the OVA page, verbatim. */
  rawHeading: string;
  /** Division label parsed out of the heading (e.g. "18U Girls", "TLS Girls"). */
  divisionLabel: string;
  /** Computed division key used for lookups: "18U", "17U", "TLS", "6v6", "4v4". */
  divisionKey: string;
  gender: OvaGender;
  /** Update tag from the heading, e.g. "Post Bugarski Cup 2025-26". */
  updateTag?: string;
  /** Column headers in display order (excluding "Rank" and "Team Name"). */
  statColumns: string[];
  teams: OvaTeamRanking[];
}

export interface OvaRankingsSnapshot {
  fetchedAt: number;
  girls: OvaDivisionRanking[];
  boys: OvaDivisionRanking[];
}

// ── Storage ──────────────────────────────────────────────────────────────

export async function loadCachedRankings(): Promise<OvaRankingsSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.girls)) {
      return parsed as OvaRankingsSnapshot;
    }
    return null;
  } catch {
    return null;
  }
}

async function saveCachedRankings(snap: OvaRankingsSnapshot): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(snap));
  } catch {
    /* ignore */
  }
}

export async function clearCachedRankings(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

// ── Fetch + parse ────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string> {
  const bust = `_t=${Date.now()}`;
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${sep}${bust}`, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'Cache-Control': 'no-cache',
    },
    cache: 'no-store' as RequestCache,
  });
  if (!res.ok) throw new Error(`OVA ${res.status} ${res.statusText}`);
  return res.text();
}

/** Strip noise (scripts/styles/comments) from raw HTML. */
function stripNoise(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&rsquo;/g, '’');
}

function cleanText(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Walk the stripped HTML and produce an ordered list of {kind, html|text}
 * tokens for headings and tables. Used to pair headings with the table
 * that follows them.
 */
interface DocToken {
  kind: 'heading' | 'table';
  text?: string; // for headings
  inner?: string; // for tables (raw inner HTML)
}

function tokenizeDoc(html: string): DocToken[] {
  const out: DocToken[] = [];
  // Single regex that matches either a heading element or a table block.
  // We use a lazy `.*?` for table contents and re-find headings inside.
  const re =
    /<(h[1-4])\b[^>]*>([\s\S]*?)<\/\1>|<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1]) {
      out.push({ kind: 'heading', text: cleanText(m[2]) });
    } else if (m[3] != null) {
      out.push({ kind: 'table', inner: m[3] });
    }
  }
  return out;
}

/** Parse a table's inner HTML into rows-of-cells. */
function parseTable(inner: string): string[][] {
  const rows: string[][] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(inner))) {
    const cellRe = /<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi;
    const cells: string[] = [];
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1]))) {
      cells.push(cleanText(cm[2]));
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/**
 * Pull division key + label out of an OVA heading.
 * "18U Girls - Post Bugarski Cup Rankings 2025-26" → key=18U, label="18U Girls", tag="Post Bugarski Cup Rankings 2025-26"
 * "6v6 Girls - Post-Bugarski Cup Rankings 2025-26" → key=6v6
 * "TLS Girls - Post-Bugarski Cup Rankings 2025-26" → key=TLS
 */
function parseHeading(
  raw: string,
  gender: OvaGender
): { divisionLabel: string; divisionKey: string; updateTag?: string } | null {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  // Match leading "<key> Girls/Boys" then optional " - <tag>"
  const m = trimmed.match(
    /^(\d{1,2}U|TLS|6v6|4v4)\s+(Girls|Boys)\b\s*(?:-\s*(.+))?$/i
  );
  if (!m) return null;
  const key = m[1].toUpperCase();
  const label = `${key} ${gender === 'girls' ? 'Girls' : 'Boys'}`;
  const tag = m[3]?.trim();
  return { divisionLabel: label, divisionKey: key, updateTag: tag };
}

function parseDivisionRanking(
  rawHeading: string,
  table: string[][],
  gender: OvaGender
): OvaDivisionRanking | null {
  const head = parseHeading(rawHeading, gender);
  if (!head) return null;
  if (table.length < 2) return null;

  // First row is the column header.
  const headers = table[0].map((s) => s.trim());
  // Find "Rank" and "Team Name" columns; default to first two if missing.
  const rankIdx = headers.findIndex((h) => /^rank$/i.test(h));
  const nameIdx = headers.findIndex((h) => /team name/i.test(h));
  const rIdx = rankIdx >= 0 ? rankIdx : 0;
  const nIdx = nameIdx >= 0 ? nameIdx : 1;

  const statCols = headers.filter((_, i) => i !== rIdx && i !== nIdx);

  const teams: OvaTeamRanking[] = [];
  for (let i = 1; i < table.length; i++) {
    const row = table[i];
    if (row.length < 2) continue;
    const rankRaw = row[rIdx] || '';
    const teamName = row[nIdx] || '';
    if (!teamName) continue;
    const rank = parseInt(rankRaw, 10);
    const stats: Record<string, string> = {};
    headers.forEach((h, j) => {
      if (j !== rIdx && j !== nIdx) {
        stats[h] = row[j] || '';
      }
    });
    teams.push({
      rank: Number.isFinite(rank) ? rank : i,
      teamName,
      stats,
    });
  }

  return {
    rawHeading,
    divisionLabel: head.divisionLabel,
    divisionKey: head.divisionKey,
    gender,
    updateTag: head.updateTag,
    statColumns: statCols,
    teams,
  };
}

function parseOvaPage(html: string, gender: OvaGender): OvaDivisionRanking[] {
  const cleaned = stripNoise(html);
  const tokens = tokenizeDoc(cleaned);
  const out: OvaDivisionRanking[] = [];
  let lastHeading = '';
  for (const t of tokens) {
    if (t.kind === 'heading') {
      lastHeading = t.text || '';
    } else if (t.kind === 'table' && t.inner) {
      // Quick reject of unrelated tables (like the "Content Search" widget).
      if (!lastHeading) continue;
      if (!/(Girls|Boys)/i.test(lastHeading)) continue;
      const rows = parseTable(t.inner);
      const div = parseDivisionRanking(lastHeading, rows, gender);
      if (div && div.teams.length > 0) out.push(div);
    }
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────

export interface FetchOptions {
  /** Skip cache and force a fresh fetch. */
  force?: boolean;
  /** Override the default 6-hour cache TTL. */
  ttlMs?: number;
}

/**
 * Get rankings for both genders. Uses cache when fresh; otherwise fetches
 * both pages in parallel, parses, persists, and returns. Network errors
 * fall back to whatever cache exists, even if stale.
 */
export async function getRankings(
  options?: FetchOptions
): Promise<OvaRankingsSnapshot> {
  const ttl = options?.ttlMs ?? DEFAULT_TTL_MS;
  if (!options?.force) {
    const cached = await loadCachedRankings();
    if (cached && Date.now() - cached.fetchedAt < ttl) {
      return cached;
    }
  }
  try {
    const [girlsHtml, boysHtml] = await Promise.all([
      fetchHtml(URLS.girls),
      fetchHtml(URLS.boys),
    ]);
    const girls = parseOvaPage(girlsHtml, 'girls');
    const boys = parseOvaPage(boysHtml, 'boys');
    const snap: OvaRankingsSnapshot = {
      fetchedAt: Date.now(),
      girls,
      boys,
    };
    await saveCachedRankings(snap);
    return snap;
  } catch (err) {
    // Network failure: serve stale cache if we have one.
    const cached = await loadCachedRankings();
    if (cached) return cached;
    throw err;
  }
}

// ── Lookup helpers ───────────────────────────────────────────────────────

const norm = (s: string) =>
  (s || '').toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Find a team in the ranking snapshot. Aliases use case/whitespace-insensitive
 * matching; pass multiple aliases (e.g. team text, team name, club + squad)
 * to widen the match. If `divisionKey` or `gender` are specified, only that
 * division/gender is searched.
 */
export interface RankingLookup {
  ranking: OvaTeamRanking;
  division: OvaDivisionRanking;
}

export function findTeamRanking(
  snap: OvaRankingsSnapshot,
  aliases: string[],
  filters?: { divisionKey?: string; gender?: OvaGender }
): RankingLookup | null {
  const wanted = aliases.map(norm).filter(Boolean);
  if (!wanted.length) return null;

  const divisions = [
    ...(filters?.gender === 'boys' ? [] : snap.girls),
    ...(filters?.gender === 'girls' ? [] : snap.boys),
  ];
  for (const div of divisions) {
    if (filters?.divisionKey && div.divisionKey !== filters.divisionKey) continue;
    for (const t of div.teams) {
      const n = norm(t.teamName);
      if (wanted.some((w) => n === w || n.includes(w) || w.includes(n))) {
        return { ranking: t, division: div };
      }
    }
  }
  return null;
}

/**
 * Find every match across both genders / all divisions. Useful when the
 * caller doesn't know which division a team is in, or when a club has
 * teams in multiple divisions sharing similar names.
 */
export function findAllMatches(
  snap: OvaRankingsSnapshot,
  aliases: string[]
): RankingLookup[] {
  const wanted = aliases.map(norm).filter(Boolean);
  if (!wanted.length) return [];
  const out: RankingLookup[] = [];
  const all = [...snap.girls, ...snap.boys];
  for (const div of all) {
    for (const t of div.teams) {
      const n = norm(t.teamName);
      if (wanted.some((w) => n === w)) {
        out.push({ ranking: t, division: div });
      }
    }
  }
  return out;
}
