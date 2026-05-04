// ── Timu API Client ─────────────────────────────────────────────────────────
//
// Timu (timu.ca) has no JSON API. This client fetches server-rendered PHP
// pages and parses their HTML. Selectors are based on the class/id naming
// convention Timu uses consistently across tournaments:
//
//   • Tournament container: <div class="container" id="poolA|poolB|..."
//   • Pool header row:      <div class="poolM"> with <div class="poolTa">
//   • Pool team row:        <div class="poolM"> with <div class="poolT">
//                           then N <div class="poola|poola "> cells
//   • Playoff match block:  <div class="team-top"> / <div class="team-bot">
//                           with <div class="team-space"> for scores
//
// This file uses regex rather than a DOM parser to avoid adding a
// native-incompatible dependency to the React Native bundle. The trade-off
// is brittleness: if Timu changes their HTML structure we must update these
// regexes. Guarded with try/catch + partial-result returns so a parse error
// in one section doesn't wipe out the rest.
// ────────────────────────────────────────────────────────────────────────────

import type {
  TimuTournamentInfo,
  TimuPool,
  TimuPoolTeam,
  TimuPoolHeadToHead,
  TimuPoolsPage,
  TimuScheduleMatch,
  TimuSchedulePage,
  TimuPlayoffMatch,
  TimuFinalRanking,
  TimuPlayoffsPage,
  TimuMatchResult,
  TimuResultsPage,
} from '../types/timu';

const BASE_URL = 'https://www.timu.ca/scoreboards';

// ── OVA reference documents ────────────────────────────────────────────────
//
// Hard-coded PDF URLs that Timu links to from their hamburger menu. The
// YCM (Youth Competitions Manual) link changes each year; we track the
// current one and specific page anchors used for Tie-Breaker, Purple Card,
// and Protest policies. If Timu updates these, re-check the script tags
// on schedule.php for the new URL.
export const TIMU_DOC_URLS = {
  youthManual: 'https://cdn4.sportngin.com/attachments/document/6beb-3517468/YCM_2025-2026_V1.39.pdf',
  whatsNew: 'https://cdn1.sportngin.com/attachments/document/5861-1591850/What_s_New_2025-2026_V1.pdf',
  tieBreaker: 'https://cdn4.sportngin.com/attachments/document/6beb-3517468/YCM_2025-2026_V1.39.pdf#page=44',
  purpleCard: 'https://cdn4.sportngin.com/attachments/document/6beb-3517468/YCM_2025-2026_V1.39.pdf#page=59',
  protest: 'https://cdn4.sportngin.com/attachments/document/6beb-3517468/YCM_2025-2026_V1.39.pdf#page=58',
  concussion: 'https://cdn1.sportngin.com/attachments/document/e9f4-1571314/OVA_Concussion_Policy_and_Protocol_Approved_January_2022.pdf',
  howToScore: 'https://volleyball.ca/uploads/Development/Referee/Rules/Volleyball_Canada_Score_Sheet_Presentation_v3.5.pdf',
  mrsRoster: 'https://cdn1.sportngin.com/attachments/document/60ef-3478541/Roster_Verification_Process.pdf',
  eci: 'https://cdn1.sportngin.com/attachments/document/7c17-2484284/ECI_Manual_2025_Oct_2025.pdf',
  scoresheet4v4: 'https://www.timu.ca/scoreboards/docs/4v4_Scoresheet.pdf',
  scoresheet6v6: 'https://www.timu.ca/scoreboards/docs/6v6_Scoresheet.pdf',
  scoresheet2of3: 'https://www.timu.ca/scoreboards/docs/Best_of_3_Scoresheet.pdf',
} as const;

/** Ontario Volleyball Association contact points referenced by the Timu menu. */
export const OVA_CONTACTS = {
  hotline: 'https://ontariovolleyball.org/contact/',
  timu: 'https://www.timu.ca/',
} as const;

// ── fetch helpers ─────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string> {
  // Cache-bust so the scoreboard is always live.
  const bust = `_t=${Date.now()}`;
  const bustedUrl = url.includes('?') ? `${url}&${bust}` : `${url}?${bust}`;
  const res = await fetch(bustedUrl, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
    },
    cache: 'no-store' as RequestCache,
  });
  if (!res.ok) {
    throw new Error(`Timu HTTP ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return normalizeAttributeQuotes(text);
}

/**
 * Timu's pages mix single-quoted and double-quoted attribute values:
 * pools.php uses `class="poolT"` (double-quoted) while results.php uses
 * `class='home-box'` (single-quoted). The browser normalizes these when
 * you read via DOM APIs, but the raw HTTP response keeps the original
 * quotes — and React Native's `fetch` returns the raw response only.
 *
 * Our parser regexes were built around double-quoted attributes, so we
 * normalize single-quoted values to double-quoted up front. This is a
 * lossy transform if attribute values contain literal `"` characters,
 * but Timu pages don't have any.
 */
function normalizeAttributeQuotes(html: string): string {
  return html.replace(
    /(\s[\w-]+)\s*=\s*'([^']*)'/g,
    (_full, attr, value) => `${attr}="${value}"`
  );
}

/**
 * Accepts either a full Timu URL or a bare numeric tid string and returns
 * the tournament id. Returns null if no tid could be extracted.
 *
 *   "4130"                                            → 4130
 *   "https://www.timu.ca/scoreboards/pools.php?tid=4130" → 4130
 *   "timu.ca/scoreboards/schedule.php?tid=4130&foo=1"    → 4130
 */
export function extractTidFromInput(input: string): number | null {
  if (!input) return null;
  const trimmed = input.trim();
  // bare number
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  // url with ?tid=NNN
  const m = trimmed.match(/[?&]tid=(\d+)/i);
  if (m) return Number(m[1]);
  return null;
}

// ── tiny html helpers ─────────────────────────────────────────────────────

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&rsquo;': '\u2019',
  '&lsquo;': '\u2018',
  '&rdquo;': '\u201D',
  '&ldquo;': '\u201C',
  '&ndash;': '\u2013',
  '&mdash;': '\u2014',
};

function htmlDecode(s: string): string {
  if (!s) return '';
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&\w+;/g, (m) => (m in ENTITY_MAP ? ENTITY_MAP[m] : m));
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

function cleanText(s: string): string {
  return htmlDecode(stripTags(s)).replace(/\s+/g, ' ').trim();
}

function cleanMultiline(s: string): string {
  // Preserve line breaks from <br> so multi-set score cells survive.
  const withBreaks = s.replace(/<br\s*\/?>/gi, '\n');
  return htmlDecode(stripTags(withBreaks))
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

// ── tournament info header ────────────────────────────────────────────────

/**
 * The top of every Timu page renders the tournament name, subtitle, and
 * date. The schedule page also includes venue + host info.
 *
 * Strategy: scripts, styles, and HTML comments are stripped first (Timu's
 * pages are full of inline JS that previously leaked into the title
 * extraction). Then we find the date pattern, walk back to the nearest
 * enclosing `<div>`, and pull the `<br>`-separated lines from inside —
 * name / subtitle / date show up there consistently across pools, schedule,
 * results, and playoffs pages.
 */
function parseTournamentInfo(tid: number, rawHtml: string): TimuTournamentInfo {
  const info: TimuTournamentInfo = { tid, name: '' };

  const html = stripNoise(rawHtml);

  // ── Date ────────────────────────────────────────────────────────────────
  // Pattern handles "March 28, 2026", "March 28th, 2026", "March 28th - 29th, 2026",
  // and "March 28th - April 1st, 2026".
  const dateRe =
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+[a-z]{0,2}(?:\s*-\s*(?:[A-Za-z]+\s+)?\d+[a-z]{0,2})?,\s*\d{4}/i;
  const dateMatch = html.match(dateRe);
  if (dateMatch) info.dateText = dateMatch[0].trim();

  // ── Name + subtitle ────────────────────────────────────────────────────
  // Find the <div> that contains the date — the tournament name and
  // subtitle are <br>-separated lines inside the same div.
  if (dateMatch && dateMatch.index != null) {
    const tagStart = html.lastIndexOf('<div', dateMatch.index);
    if (tagStart >= 0) {
      const innerContent = extractDivContentAt(html, tagStart);
      if (innerContent != null) {
        const lines = innerContent
          .split(/<br\s*\/?>/i)
          .map((chunk) => cleanText(chunk))
          .filter(Boolean)
          // Drop the date line and anything short/not title-looking.
          .filter((line) => !dateRe.test(line))
          .filter((line) => !looksLikeJunk(line));

        if (lines.length >= 1) info.name = lines[0];
        if (lines.length >= 2) info.subtitle = lines[1];
      }
    }
  }

  // ── Start time ─────────────────────────────────────────────────────────
  const startMatch = html.match(/Start time:\s*([0-9:apm ]+)/i);
  if (startMatch) info.startTime = startMatch[1].trim();

  // ── Venue, host, contacts ──────────────────────────────────────────────
  const venueMatch = html.match(/Location\s*\d*:\s*([^<(]+?)\(([^)]+)\)/);
  if (venueMatch) {
    info.venueName = cleanText(venueMatch[1]);
    info.venueAddress = cleanText(venueMatch[2]);
  }
  const hostMatch = html.match(/Host:\s*([^<]+?)(?:\s*Host Contact|<)/i);
  if (hostMatch) info.hostClub = cleanText(hostMatch[1]);
  const hostContact = html.match(/Host Contact:\s*([^\s<]+@[^\s<]+)/i);
  if (hostContact) info.hostContact = hostContact[1];
  const venueContact = html.match(/Venue Contact:\s*([^\s<]+@[^\s<]+)/i);
  if (venueContact) info.venueContact = venueContact[1];

  // ── Tournament notes ──────────────────────────────────────────────────
  const notes = html.match(/id="tourn_notes"[^>]*>([\s\S]*?)<\/div>/i);
  if (notes) {
    const noteText = cleanMultiline(notes[1]);
    // Only keep notes that look like actual text, not residual JS/CSS.
    if (noteText && !looksLikeJunk(noteText.split('\n')[0])) {
      info.notes = noteText.slice(0, 4000);
    }
  }

  return info;
}

/**
 * Remove `<script>`, `<style>`, HTML comments, and attribute values that
 * can carry text (href, onclick, title, alt, etc.) from raw HTML.
 *
 * Timu's pages pack tournament metadata (name, date, venue) into
 * `href="mailto:...?subject=..."` attributes, which was poisoning our
 * "first date in the HTML" heuristic — the first match would land inside
 * a mailto's subject string instead of the tournament header.
 */
function stripNoise(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Strip text-carrying attribute values but keep the attribute name so
    // selector-based matches like `id="tourn_notes"` still work. We only
    // target attributes that commonly embed descriptive strings.
    .replace(/\s(href|onclick|onmouseover|onfocus|onblur|title|alt|data-[\w-]+)\s*=\s*(?:"[^"]*"|'[^']*')/gi, ' $1=""');
}

/**
 * Heuristic for rejecting lines that are clearly not tournament-header
 * content. Catches leftover JavaScript, CSS, or nav/chrome labels that
 * sneak in even after stripping tags.
 */
function looksLikeJunk(line: string): boolean {
  if (!line) return true;
  if (line.length < 3 || line.length > 120) return true;
  // Lines with obvious code-like characters.
  if (/[{};=]/.test(line)) return true;
  // Lines that are 100% punctuation/whitespace.
  if (!/[A-Za-z0-9]/.test(line)) return true;
  // Known nav/chrome words.
  if (/^(pool play|schedule|results|playoffs|maps|venue|tournaments|share|documents|contact|how to(?:'s)?|login|submit|rate venue|active tourneys|venue info)$/i.test(line)) {
    return true;
  }
  return false;
}

// ── pools page ────────────────────────────────────────────────────────────

/**
 * Walk every "pool container" on the pools page. A container looks like:
 *
 *   <div class="container" id="poolA">
 *     <div class="poolM"><div class="poolTa">Pool A (2/2)</div>
 *       <div class="pool">1</div>... header row
 *     </div>
 *     <div class="poolM" id="1000">
 *       <div class="poolT">Unity Chaos</div>
 *       <div class="poola ">13-25<br>25-21</div>  ← H2H vs team in col 1
 *       ...6 opponent cells...
 *       <div class="poola">7-3</div>              ← Sets
 *       <div class="poola">3-1</div>              ← Match (W-L)
 *       <div class="poola">2</div>                ← Rank (may include "d1")
 *     </div>
 *     ...one poolM per team...
 *   </div>
 */
function parsePools(html: string): TimuPool[] {
  const pools: TimuPool[] = [];

  // Iterate container divs with id="poolX" where X is a letter.
  const containerRe =
    /<div[^>]*class="container"[^>]*id="pool([A-Z])"[^>]*>([\s\S]*?)(?=<div[^>]*class="container"[^>]*id="pool[A-Z]"|<div[^>]*id="sched"|<footer|<\/body>)/gi;

  let globalCursor = 0; // tracks the running globalNumber across pools
  let containerMatch: RegExpExecArray | null;
  while ((containerMatch = containerRe.exec(html))) {
    const poolId = containerMatch[1];
    const inner = containerMatch[2];

    // Extract every <div class="poolM"...>...</div> INSIDE this container.
    // Since poolM divs contain other divs, we need balanced parsing.
    const rows = extractFlatDivsByClass(inner, 'poolM');
    if (rows.length === 0) continue;

    // First row is the header with <div class="poolTa"> containing the pool
    // name and <div class="pool"> cells for column headers.
    const headerRow = rows[0];
    const poolTa = headerRow.match(/class="poolTa"[^>]*>([\s\S]*?)<\/div>/i);
    const poolHeaderText = poolTa ? cleanText(poolTa[1]) : `Pool ${poolId}`;
    // Header text looks like "Pool A (2/2)" — pull the matches-complete tag.
    const progressMatch = poolHeaderText.match(/\(([^)]+)\)/);
    const matchesComplete = progressMatch ? progressMatch[1] : undefined;
    const name = poolHeaderText.replace(/\s*\([^)]+\)\s*$/, '').trim() || `Pool ${poolId}`;

    const teams: TimuPoolTeam[] = [];
    const headToHead: TimuPoolHeadToHead[] = [];

    // Subsequent rows = team rows. Each has a <div class="poolT"> with the
    // team name and N <div class="poola..."> cells.
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const poolTmatch = row.match(/class="poolT"[^>]*>([\s\S]*?)<\/div>/i);
      if (!poolTmatch) continue;
      const teamName = cleanText(poolTmatch[1]);
      if (!teamName) continue;

      // All <div class="poola..."> cells in order.
      const cells = extractFlatDivsByClass(row, 'poola');
      // Expected layout: N opponent cells + Sets + Match + Rank
      // For an N-team pool the team's own column is empty and skipped.
      // Trailing 3 cells are always: Sets (X-Y), Match (W-L), Rank (n or "n\nd1").

      if (cells.length < 3) {
        // Degenerate row; still record the team.
        globalCursor++;
        teams.push({
          teamName,
          globalNumber: globalCursor,
          setsFor: 0,
          setsAgainst: 0,
          matchesFor: 0,
          matchesAgainst: 0,
          rank: null,
          day1Tag: false,
        });
        continue;
      }

      const rankCellRaw = cleanMultiline(cells[cells.length - 1]);
      const matchCellRaw = cleanText(cells[cells.length - 2]);
      const setsCellRaw = cleanText(cells[cells.length - 3]);
      const opponentCells = cells.slice(0, cells.length - 3);

      const [setsFor, setsAgainst] = parseDashPair(setsCellRaw);
      const [matchesFor, matchesAgainst] = parseDashPair(matchCellRaw);
      const rankLines = rankCellRaw.split('\n');
      const rank = rankLines[0] ? Number(rankLines[0]) || null : null;
      const day1Tag = rankLines.some((l) => /d1/i.test(l));

      globalCursor++;
      const globalNumber = globalCursor;

      teams.push({
        teamName,
        globalNumber,
        setsFor: isFinite(setsFor) ? setsFor : 0,
        setsAgainst: isFinite(setsAgainst) ? setsAgainst : 0,
        matchesFor: isFinite(matchesFor) ? matchesFor : 0,
        matchesAgainst: isFinite(matchesAgainst) ? matchesAgainst : 0,
        rank,
        day1Tag,
      });

      // Head-to-head cells. opponentCells[k] is our row's matchup against
      // the team in column (k+1) of this pool. globalNumber for that
      // opponent = (poolFirstGlobal + k) where poolFirstGlobal tracks the
      // first team's globalNumber in this pool.
      const poolFirstGlobal = globalCursor - (teams.length - 1);
      opponentCells.forEach((cell, k) => {
        const vsGlobal = poolFirstGlobal + k;
        if (vsGlobal === globalNumber) return; // own column = empty
        const cellText = cleanMultiline(cell);
        if (!cellText) return;
        const sets = cellText
          .split('\n')
          .map(parseDashPair)
          .filter(([a, b]) => isFinite(a) && isFinite(b))
          .map(([us, them]) => ({ us, them }));
        if (sets.length) {
          headToHead.push({
            forGlobalNumber: globalNumber,
            vsGlobalNumber: vsGlobal,
            sets,
          });
        }
      });
    }

    pools.push({
      poolId,
      name,
      matchesComplete,
      teams,
      headToHead,
    });
  }

  return pools;
}

/**
 * Given HTML, returns the inner contents of each <div class="CLASS ..."> at
 * the TOP level (not nested inside another div with the same class). Timu
 * doesn't nest poolM rows so this works, but we still walk character-by-
 * character to correctly skip over child div pairs.
 */
function extractFlatDivsByClass(html: string, cls: string): string[] {
  const results: string[] = [];
  const openRe = new RegExp(
    `<div[^>]*class="${cls}(?:\\s[^"]*)?"[^>]*>`,
    'gi'
  );
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(html))) {
    const start = m.index + m[0].length;
    // Walk forward tracking depth to find the matching </div>.
    let depth = 1;
    let i = start;
    const len = html.length;
    while (i < len && depth > 0) {
      const nextOpen = html.indexOf('<div', i);
      const nextClose = html.indexOf('</div', i);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        i = nextOpen + 4;
      } else {
        depth--;
        i = nextClose + 5;
      }
    }
    if (depth === 0) {
      const end = html.lastIndexOf('</div', i);
      // Keep empty-content divs too — in pool tables, Timu renders the
      // team's own column as an empty <div class="poola"></div>, and
      // dropping it here would shift opponent-position indexing by 1 in
      // the head-to-head logic.
      if (end >= start) results.push(html.slice(start, end));
    }
    // Reset regex lastIndex past this open tag so we don't match nested divs
    // in case the outer class appears nested (it doesn't in Timu but safer).
    openRe.lastIndex = m.index + m[0].length;
  }
  return results;
}

function parseDashPair(s: string): [number, number] {
  const m = s.match(/(-?\d+)\s*-\s*(-?\d+)/);
  if (!m) return [NaN, NaN];
  return [Number(m[1]), Number(m[2])];
}

// ── schedule page ─────────────────────────────────────────────────────────

/**
 * The schedule page renders a grid per day plus a playoff block. We parse
 * the page by pulling out the "Day N - DAYNAME, DATE" headers and the
 * match rows that follow. Each row has a time, then cells for each court.
 *
 * Match cells contain text like "1 vs 9" (pool play) or "A1 vs B4" or
 * "W1 vs W3" (playoff positions). We keep the ref strings as-is; the
 * caller resolves them via the pool/playoff data if needed.
 */
function parseSchedule(rawHtml: string): { matches: TimuScheduleMatch[]; courts: string[] } {
  const matches: TimuScheduleMatch[] = [];
  const courts = new Set<string>();

  // The schedule page includes a "Match Reschedule" form at the bottom
  // whose <select> dropdowns re-emit every match twice. That text would
  // fool our time/vs parsing and blow up the match count, so we slice
  // the HTML to just the schedule region first.
  const rescheduleAt = rawHtml.search(
    /Match Reschedule|<form[^>]*(?:name|id)="reschedule"|<select\b/i
  );
  const venueInfoAt = rawHtml.search(/Venue Info for/i);
  const cutoffs = [rescheduleAt, venueInfoAt].filter((n) => n > 0);
  const cutoff = cutoffs.length ? Math.min(...cutoffs) : rawHtml.length;
  const html = rawHtml.slice(0, cutoff);

  // First, collect all time/court/matchup triples. Timu emits each row as:
  //   <div class="time">9:00am</div>
  //   <div class="matchup">1 vs 9</div>
  //   <div class="matchup">8 vs 12</div>
  //   <div class="matchup">4 vs 5</div>
  // with courts deduced from column position. We split on time strings and
  // take exactly N matches per row where N = number of courts.

  const dayRe = /Day\s+(\d+)\s*-\s*([^<\n(]+)(?:\s*\([^)]*\))?/gi;
  const dayHeaders: Array<{ day: number; label: string; at: number }> = [];
  let dm: RegExpExecArray | null;
  while ((dm = dayRe.exec(html))) {
    dayHeaders.push({
      day: Number(dm[1]),
      label: cleanText(dm[2]),
      at: dm.index,
    });
  }

  // Find the playoff section start. Must match the actual heading
  // ("All Playoff Matches are Best 2/3"), NOT the "Playoffs" item in the
  // top nav menu which appears before the schedule grid.
  const playoffMarker = html.search(/All Playoff Matches/i);

  // Discover courts from the whole HTML. The "Court N" headers appear
  // once at the top of Day 1 and once at the top of the playoff section.
  // Timu's HTML often uses &nbsp; between "Court" and the number, so we
  // allow whitespace OR literal "&nbsp;" between them.
  // Between "Court" and the number, Timu emits closing/opening div tags
  // and entity-encoded whitespace: `<div>Court</div><div>1</div>`. Allow
  // tags, whitespace, or common whitespace entities in the gap.
  const COURT_SEP = '(?:\\s|&nbsp;|&#160;|\u00A0|<[^>]*>)+';
  const courtRe = new RegExp(`Court${COURT_SEP}(\\d+)`, 'gi');
  const globalCourts: string[] = [];
  let cm: RegExpExecArray | null;
  while ((cm = courtRe.exec(html))) {
    if (!globalCourts.includes(cm[1])) globalCourts.push(cm[1]);
    courts.add(cm[1]);
    if (globalCourts.length >= 12) break; // safety
  }

  // Split the HTML into day chunks and a playoff chunk so we can tag matches
  // with their day/playoff-ness. Then extract every "TIME — COURT — MATCHUP"
  // tuple within each chunk.
  const chunks: Array<{ start: number; end: number; day: number; dayLabel: string; isPlayoff: boolean }> = [];
  for (let i = 0; i < dayHeaders.length; i++) {
    const cur = dayHeaders[i];
    const nextStart =
      i + 1 < dayHeaders.length
        ? dayHeaders[i + 1].at
        : playoffMarker > cur.at
          ? playoffMarker
          : html.length;
    chunks.push({
      start: cur.at,
      end: nextStart,
      day: cur.day,
      dayLabel: cur.label,
      isPlayoff: false,
    });
  }
  if (playoffMarker >= 0) {
    chunks.push({
      start: playoffMarker,
      end: html.length,
      day: (dayHeaders[dayHeaders.length - 1]?.day || 0) + 1,
      dayLabel: 'Playoffs',
      isPlayoff: true,
    });
  }

  for (const chunk of chunks) {
    const slice = html.slice(chunk.start, chunk.end);

    // Per-chunk courts fall back to the global court list if this chunk
    // has no local "Court N" headings (Day 2 reuses the same layout as
    // Day 1 without repeating the court header row).
    const chunkCourts: string[] = [];
    const chunkCourtRe = new RegExp(`Court${COURT_SEP}(\\d+)`, 'gi');
    let ccm: RegExpExecArray | null;
    while ((ccm = chunkCourtRe.exec(slice))) {
      if (!chunkCourts.includes(ccm[1])) chunkCourts.push(ccm[1]);
      if (chunkCourts.length >= 12) break;
    }
    const effectiveCourts = chunkCourts.length ? chunkCourts : globalCourts;
    const courtsPerRow = effectiveCourts.length || 1;
    effectiveCourts.forEach((c) => courts.add(c));

    const timeRe = /\b(\d{1,2}:\d{2}\s*[ap]m)\b/gi;
    const times: Array<{ at: number; text: string }> = [];
    let tm: RegExpExecArray | null;
    while ((tm = timeRe.exec(slice))) times.push({ at: tm.index, text: tm[1].replace(/\s+/g, '').toLowerCase() });

    for (let i = 0; i < times.length; i++) {
      const cur = times[i];
      const next = times[i + 1];
      const rowSlice = slice.slice(cur.at + cur.text.length, next ? next.at : undefined);
      const cellRe =
        /(?:\((\d+)\)\s*)?([A-Za-z0-9]+)\s+vs\s+([A-Za-z0-9]+)(?:\s*\(([^)]*)\))?/g;
      const cells: Array<RegExpExecArray> = [];
      let mm: RegExpExecArray | null;
      while ((mm = cellRe.exec(rowSlice))) {
        cells.push(mm);
        if (cells.length >= courtsPerRow) break;
      }
      cells.forEach((c, idx) => {
        const court = effectiveCourts[idx] ?? String(idx + 1);
        const home = c[2];
        const away = c[3];
        const extraLabel = c[4];
        if (!home || !away || home === 'vs' || away === 'vs') return;
        matches.push({
          day: chunk.day,
          dayLabel: chunk.dayLabel,
          time: cur.text,
          court,
          home: { ref: home },
          away: { ref: away },
          extraLabel: extraLabel ? cleanText(extraLabel) : undefined,
          isPlayoff: chunk.isPlayoff,
          playoffMatchNumber: c[1] ? Number(c[1]) : undefined,
        });
      });
    }
  }

  const courtsSorted = Array.from(courts).sort((a, b) => Number(a) - Number(b));
  return { matches, courts: courtsSorted };
}

/**
 * The match reschedule dropdown on schedule.php exposes a mapping from
 * position refs (e.g. "1", "A1", "W2") to actual team names:
 *   "1 vs 9 on Crt: 1 - (Unity Chaos vs Durham Attack Explosion)"
 * We parse these lines to resolve refs → names for the schedule rows.
 */
function parseRescheduleNameMap(html: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re =
    /([A-Za-z0-9]+)\s+vs\s+([A-Za-z0-9]+)\s+on\s+Crt:\s*\d+\s*-\s*\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const a = m[1];
    const b = m[2];
    const inside = m[3];
    const parts = inside.split(/\s+vs\s+/i);
    if (parts.length !== 2) continue;
    const nameA = cleanText(parts[0]);
    const nameB = cleanText(parts[1]);
    if (nameA && nameA !== 'Open') map[a] = nameA;
    if (nameB && nameB !== 'Open') map[b] = nameB;
  }
  return map;
}

// ── playoffs page ─────────────────────────────────────────────────────────

function parsePlayoffs(html: string): { matches: TimuPlayoffMatch[]; finalRankings: TimuFinalRanking[] } {
  const matches: TimuPlayoffMatch[] = [];
  const rankings: TimuFinalRanking[] = [];

  // Each bracket match block looks roughly like:
  //   <div class="team-top">Team A</div>
  //   <div class="team-space-border">25-11, 23-25, 15-17</div>
  //   <div class="team-bot">Team B</div>
  //
  // Sometimes a label like "(Gold)" is embedded; we capture what we can.
  const blockRe =
    /<div[^>]*class="team-top"[^>]*>([\s\S]*?)<\/div>[\s\S]*?<div[^>]*class="team-space(?:-border)?"[^>]*>([\s\S]*?)<\/div>[\s\S]*?<div[^>]*class="team-bot"[^>]*>([\s\S]*?)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html))) {
    const team1 = cleanText(m[1]);
    const scoreText = cleanText(m[2]);
    const team2 = cleanText(m[3]);
    if (!team1 || !team2) continue;

    const sets: Array<{ a: number; b: number }> = [];
    scoreText
      .split(/[,;]\s*/)
      .forEach((chunk) => {
        const [a, b] = parseDashPair(chunk);
        if (isFinite(a) && isFinite(b)) sets.push({ a, b });
      });
    let winnerSide: 1 | 2 | undefined;
    if (sets.length) {
      const wa = sets.filter((s) => s.a > s.b).length;
      const wb = sets.filter((s) => s.b > s.a).length;
      if (wa > wb) winnerSide = 1;
      else if (wb > wa) winnerSide = 2;
    }

    // Extract any label near this match (e.g., "Bronze", "5th/7th"). We look
    // backwards from the match in the surrounding text.
    const contextStart = Math.max(0, m.index - 200);
    const context = cleanText(html.slice(contextStart, m.index));
    const labelMatch = context.match(/\(([^()]{1,20})\)\s*$/);
    const label = labelMatch ? labelMatch[1] : undefined;

    matches.push({
      round: '',
      label,
      team1Name: team1,
      team2Name: team2,
      sets,
      winnerSide,
    });
  }

  // Final rankings — "1st - Team Name", "2nd - Team Name", ...
  // Timu inserts an <img> club logo between the rank dash and the team
  // name, e.g. <div>1st - <img src="..." />Unity Chaos</div>. We match
  // the rank prefix, then grab everything up to the closing </div> and
  // strip any tags to get the team name.
  const rankRe = /(\d+)(st|nd|rd|th)\s*[-\u2013]\s*([\s\S]*?)<\/div>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rankRe.exec(html))) {
    const rank = Number(rm[1]);
    const teamName = cleanText(rm[3]);
    if (!rank || !teamName) continue;
    // Only consider ranks up to 32 — avoid matching random numbers elsewhere.
    if (rank > 32) continue;
    // Dedupe: Timu sometimes lists the same ranking twice in the HTML.
    if (rankings.some((r) => r.rank === rank && r.teamName === teamName)) continue;
    rankings.push({ rank, rankLabel: `${rm[1]}${rm[2]}`, teamName });
  }

  return { matches, finalRankings: rankings };
}

// ── results page ──────────────────────────────────────────────────────────

/**
 * Parse results.php — each completed match is rendered as:
 *
 *   <b>Volleyball - 18UG</b>
 *   <div>Sat Mar 28, 9:00 AM</div>
 *   <div>Pool A (1 vs 9)\n2 Straight    Court: 1</div>
 *   <div class="volleyball">headers…</div>
 *   <div class="home-box">
 *     <div class="away">Unity Chaos</div>
 *     <div class="set-block">2</div>  ← sets won
 *     <div class="set-block">25</div> ← set 1 score
 *     <div class="set-block">25</div> ← set 2 score
 *     <div class="set-block"></div> set 3/4/5 empty
 *     …
 *   </div>
 *   <div class="away-box">… same layout …</div>
 */
function parseResults(html: string): TimuMatchResult[] {
  const matches: TimuMatchResult[] = [];

  // Walk home-box / away-box pairs. For each pair, look at the surrounding
  // content (back to the previous "Volleyball - …" header) for date / label
  // / court / format. Older Timu tournaments use a different per-match
  // header format (e.g. "Sat Dec 7 '24" with no inline time) so we extract
  // each piece via independent patterns rather than anchoring on one
  // monolithic regex.
  const homeRe = /<div[^>]*class="home-box(?:\s[^"]*)?"[^>]*>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = homeRe.exec(html))) {
    const homeStart = hm.index;

    // Extract the home box content via depth walking.
    const homeInner = extractDivContentAt(html, homeStart);
    if (!homeInner) continue;

    // The away-box follows soon after.
    const awayOpenRe = /<div[^>]*class="away-box(?:\s[^"]*)?"[^>]*>/gi;
    awayOpenRe.lastIndex = homeStart + homeInner.length;
    const am = awayOpenRe.exec(html);
    if (!am) continue;
    const awayInner = extractDivContentAt(html, am.index);
    if (!awayInner) continue;

    // Context before the home-box starts at the nearest preceding
    // "Volleyball -" header (each match begins with <b>Volleyball - NNNN</b>).
    // Falls back to a 1500-char window if the marker isn't found.
    const markerAt = lastIndexOfBefore(html, /<b[^>]*>\s*Volleyball/gi, homeStart);
    const ctxStart = markerAt >= 0 ? markerAt : Math.max(0, homeStart - 1500);
    const context = html.slice(ctxStart, homeStart);

    // ── Date + time ──────────────────────────────────────────────────
    // Try the modern format first: "Sat Mar 28, 9:00 AM"
    let dateText = '';
    let time = '';
    const modernDt = [...context.matchAll(
      /([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d+),\s*(\d{1,2}:\d{2}\s*[AP]M)/g
    )].pop();
    if (modernDt) {
      dateText = modernDt[1];
      time = modernDt[2];
    } else {
      // Older format: "Sat Dec 7 '24" (apostrophe-year, no inline time).
      const olderDt = [...context.matchAll(
        /([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d+)\s*(?:'\d{2,4})?/g
      )].pop();
      if (olderDt) dateText = olderDt[1];
    }

    // ── Court ────────────────────────────────────────────────────────
    const courtAnchor = [...context.matchAll(/Court:\s*(\d+)/g)].pop();
    const court = courtAnchor ? courtAnchor[1] : '';

    // ── Match label + format ─────────────────────────────────────────
    // Extract these directly via known patterns rather than anchoring on
    // the date regex (which fails for older formats).
    let matchLabel = '';
    let format = '';
    const ctxText = cleanText(context);
    // Format token (Best 2 of 3, 2 Straight, etc.).
    const formatMatch = ctxText.match(/\b(Best\s*\d+\s*of\s*\d+|\d+\s*Straight)\b/i);
    if (formatMatch) format = formatMatch[0];
    // Label patterns — pool labels OR known playoff round names.
    const labelPatterns = [
      // "Pool A (1 vs 9)" / "Pool A (X vs Y)"
      /Pool\s+[A-Z](?:\s*\(\s*\d+\s*vs\s*\d+\s*\))?/i,
      // "1/4 Final (A1 vs B4)" / "1/2 Final" / "Quarter-Final"
      /(?:Quarter[\s-]?|Semi[\s-]?|Final)?\s*\d?\/\d+\s*Final(?:\s*[A-Z])?(?:\s*\([^)]*\))?/i,
      /(?:Quarter|Semi|Grand)[\s-]?Final(?:\s*[A-Z])?(?:\s*\([^)]*\))?/i,
      // "Gold (W7 vs W8)" / "Bronze (L7 vs L8)" / "Silver"
      /(?:Gold|Silver|Bronze)(?:\s*\([^)]*\))?/i,
      // "5th/7th (L1 vs L3)" / "9th/10th" / "11th/12th"
      /\d+(?:st|nd|rd|th)\s*\/\s*\d+(?:st|nd|rd|th)(?:\s*\([^)]*\))?/i,
      // "Loser - 11th (A5 vs B6)" / "Winner - 5th"
      /(?:Loser|Winner)\s*-\s*\d+(?:st|nd|rd|th)?(?:\s*\([^)]*\))?/i,
      // Generic "Consolation (X)" or numbered placement
      /(?:Consolation|Placement)\s*[A-Z\d]?(?:\s*\([^)]*\))?/i,
    ];
    for (const re of labelPatterns) {
      const m = ctxText.match(re);
      if (m) {
        matchLabel = m[0].trim();
        break;
      }
    }

    const home = parseTeamBox(homeInner);
    const away = parseTeamBox(awayInner);
    if (!home.name || !away.name) continue;

    const isPool = /^Pool\s/i.test(matchLabel);
    const isPlayoff = !isPool && matchLabel.length > 0;

    matches.push({
      dateText,
      time,
      matchLabel,
      format,
      court,
      home,
      away,
      isPool,
      isPlayoff,
    });

    // Advance the homeRe lastIndex past this match to avoid overlap.
    homeRe.lastIndex = am.index + awayInner.length;
  }

  return matches;
}

/**
 * Find the last match of a regex that occurs BEFORE a given index. We do
 * this by scanning all matches and picking the last one whose index is
 * less than `before`. Assumes the regex has the `g` flag.
 */
function lastIndexOfBefore(html: string, re: RegExp, before: number): number {
  let last = -1;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m.index >= before) break;
    last = m.index;
  }
  return last;
}

/**
 * Given an index into HTML where a `<div ...>` opening tag starts, return
 * the inner contents (skipping the tag itself). Uses balanced div walking.
 */
function extractDivContentAt(html: string, tagStart: number): string | null {
  const tagEnd = html.indexOf('>', tagStart);
  if (tagEnd < 0) return null;
  const start = tagEnd + 1;
  let depth = 1;
  let i = start;
  const len = html.length;
  while (i < len && depth > 0) {
    const no = html.indexOf('<div', i);
    const nc = html.indexOf('</div', i);
    if (nc === -1) break;
    if (no !== -1 && no < nc) { depth++; i = no + 4; }
    else { depth--; i = nc + 5; }
  }
  if (depth !== 0) return null;
  const end = html.lastIndexOf('</div', i);
  if (end < start) return '';
  return html.slice(start, end);
}

/**
 * Parse a .home-box or .away-box inner HTML into team name + sets won +
 * per-set scores. The actual Timu structure (observed live) is:
 *   <div class="away">Team Name</div>
 *   <div class="set-block">setsWon</div>
 *   <div class="set-block">setsLost</div>     ← layout block, NOT a set score
 *   <div class="set-block">s1</div>
 *   <div class="set-block">s2</div>
 *   <div class="set-block">s3</div>
 *   <div class="set-block">s4</div>
 *   <div class="set-block">s5</div>
 * Empty unplayed sets render as "" so we filter NaN at the end. Some older /
 * compact Timu pages omit the second header block; we detect that by checking
 * blocks[1] — a sets-total can never exceed 5 in volleyball, while a real set
 * score is typically >=10. So if blocks[1] is empty or <=5, treat it as a
 * layout block and start scores at index 2; otherwise start at 1.
 */
function parseTeamBox(inner: string): { name: string; setsWon: number; scores: number[] } {
  const nameMatch = inner.match(/<div[^>]*class="away(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/div>/i);
  const name = nameMatch ? cleanText(nameMatch[1]) : '';

  const setBlockRe = /<div[^>]*class="set-block(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/div>/gi;
  const blocks: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = setBlockRe.exec(inner))) blocks.push(cleanText(sm[1]));

  const setsWon = blocks.length ? Number(blocks[0]) || 0 : 0;

  // Where do real set scores begin? Modern Timu has a setsLost / layout block
  // at index 1, so scores start at 2. Older formats omit it.
  let scoreStart = 1;
  if (blocks.length > 1) {
    const second = blocks[1];
    const secondNum = second === '' ? NaN : Number(second);
    if (!isFinite(secondNum) || secondNum <= 5) {
      scoreStart = 2;
    }
  }

  const scores = blocks
    .slice(scoreStart)
    .map((b) => (b === '' ? NaN : Number(b)))
    .filter((n) => isFinite(n)); // drop empty trailing set slots

  return { name, setsWon, scores };
}

// ── public api ────────────────────────────────────────────────────────────

export async function getPools(tid: number): Promise<TimuPoolsPage> {
  const html = await fetchHtml(`${BASE_URL}/pools.php?tid=${tid}`);
  const info = parseTournamentInfo(tid, html);
  const pools = parsePools(html);
  return { info, pools };
}

export async function getSchedule(tid: number): Promise<TimuSchedulePage> {
  const html = await fetchHtml(`${BASE_URL}/schedule.php?tid=${tid}`);
  const info = parseTournamentInfo(tid, html);
  const { matches, courts } = parseSchedule(html);
  const nameMap = parseRescheduleNameMap(html);
  matches.forEach((m) => {
    if (nameMap[m.home.ref]) m.home.name = nameMap[m.home.ref];
    if (nameMap[m.away.ref]) m.away.name = nameMap[m.away.ref];
  });
  return { info, matches, courts };
}

export async function getResults(tid: number): Promise<TimuResultsPage> {
  const html = await fetchHtml(`${BASE_URL}/results.php?tid=${tid}`);
  const info = parseTournamentInfo(tid, html);
  const matches = parseResults(html);
  return { info, matches };
}

export async function getPlayoffs(tid: number): Promise<TimuPlayoffsPage> {
  const html = await fetchHtml(`${BASE_URL}/playoffs.php?tid=${tid}`);
  const info = parseTournamentInfo(tid, html);
  const { matches, finalRankings } = parsePlayoffs(html);
  return { info, matches, finalRankings };
}

/**
 * Lightweight tournament fetch — uses the schedule page because it's the
 * richest source of metadata (venue + host + date range). Good for showing
 * a "saved tournaments" card without loading full pool data.
 */
export async function getTournamentInfo(tid: number): Promise<TimuTournamentInfo> {
  const html = await fetchHtml(`${BASE_URL}/schedule.php?tid=${tid}`);
  return parseTournamentInfo(tid, html);
}

// ── exports for testing / parsers-only consumers ──────────────────────────

export const __private = {
  parseTournamentInfo,
  parsePools,
  parseSchedule,
  parsePlayoffs,
  parseRescheduleNameMap,
  extractFlatDivsByClass,
  parseDashPair,
};
