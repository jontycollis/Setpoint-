// ── Venue time-zone resolution ─────────────────────────────────────────────
//
// Best-effort province / state → IANA tz mapping for tournament venues. We
// don't have a venue-tz field from upstream APIs (AES gives us
// `address.state`; Timu gives us a free-text address), so this util keeps
// the lookup in one place. Both helpers return `null` when they can't
// confidently resolve — callers should treat null the same as "no tz" and
// fall back to device-local formatting.
//
// Coverage is intentionally pragmatic: every Canadian province + the US
// states we actually see in AES Canadian events listings. New regions can
// be added as we encounter them.
// ────────────────────────────────────────────────────────────────────────────

const PROVINCE_TZ: Record<string, string> = {
  // Canadian provinces / territories
  ON: 'America/Toronto',
  QC: 'America/Toronto',
  MB: 'America/Winnipeg',
  SK: 'America/Regina',
  AB: 'America/Edmonton',
  BC: 'America/Vancouver',
  NB: 'America/Halifax',
  NS: 'America/Halifax',
  PE: 'America/Halifax',
  NL: 'America/St_Johns',
  YT: 'America/Whitehorse',
  // NT / NU each span multiple zones; America/Edmonton matches the
  // populated areas (Yellowknife / Iqaluit-Ranking-Inlet) closely enough
  // for schedule-display purposes.
  NT: 'America/Edmonton',
  NU: 'America/Edmonton',
  // US states common to AES Canadian-context events
  NY: 'America/New_York',
  MI: 'America/Detroit',
  OH: 'America/New_York',
  PA: 'America/New_York',
  FL: 'America/New_York',
  IL: 'America/Chicago',
  MN: 'America/Chicago',
  TX: 'America/Chicago',
  CO: 'America/Denver',
  AZ: 'America/Phoenix',
  CA: 'America/Los_Angeles',
  WA: 'America/Los_Angeles',
};

/**
 * Map a Canadian province (or supported US state) two-letter code to an
 * IANA time zone identifier. Returns `null` when the code is unknown.
 *
 * Accepts any casing — callers don't have to upper-case before calling.
 */
export function tzForCanadianProvince(state: string): string | null {
  if (!state || typeof state !== 'string') return null;
  return PROVINCE_TZ[state.trim().toUpperCase()] ?? null;
}

// Canadian-city keyword fallbacks. Matched against the address line as a
// case-insensitive `\bcity\b` regex below. Ordering doesn't matter — the
// first hit wins.
const CITY_TZ: Array<{ pattern: RegExp; tz: string }> = [
  // Ontario
  { pattern: /\b(toronto|mississauga|ottawa|hamilton|london|kingston|brampton|markham|vaughan|waterloo|kitchener|guelph|barrie|oshawa|burlington|windsor|sudbury|thunder bay|st\.? catharines|niagara|richmond hill|oakville|whitby|ajax|pickering|peterborough|cambridge|milton|newmarket)\b/i, tz: 'America/Toronto' },
  // Quebec
  { pattern: /\b(montreal|montréal|quebec city|québec city|laval|gatineau|sherbrooke|trois-rivieres|trois-rivières)\b/i, tz: 'America/Toronto' },
  // Manitoba
  { pattern: /\b(winnipeg|brandon)\b/i, tz: 'America/Winnipeg' },
  // Saskatchewan
  { pattern: /\b(regina|saskatoon|moose jaw|prince albert)\b/i, tz: 'America/Regina' },
  // Alberta
  { pattern: /\b(calgary|edmonton|red deer|lethbridge|medicine hat|grande prairie)\b/i, tz: 'America/Edmonton' },
  // British Columbia
  { pattern: /\b(vancouver|victoria|burnaby|surrey|richmond|kelowna|abbotsford|coquitlam|kamloops|nanaimo|chilliwack|langley)\b/i, tz: 'America/Vancouver' },
  // Atlantic (NB / NS / PE)
  { pattern: /\b(halifax|moncton|fredericton|saint john|charlottetown|dartmouth|sydney)\b/i, tz: 'America/Halifax' },
  // Newfoundland
  { pattern: /\b(st\.?\s*john'?s|corner brook|gander)\b/i, tz: 'America/St_Johns' },
  // Yukon
  { pattern: /\b(whitehorse)\b/i, tz: 'America/Whitehorse' },
  // NT / NU
  { pattern: /\b(yellowknife|iqaluit)\b/i, tz: 'America/Edmonton' },
];

/**
 * Heuristic fallback: try to recover a tz from a free-text venue address
 * line. Scans for common Canadian city names first, then a trailing
 * two-letter province / state code (e.g. `"123 Main St, Mississauga, ON
 * L4W 1A1"`). Returns null when nothing matches.
 *
 * Pure string scanning — no network calls, no Intl awareness needed.
 */
export function tzForVenueAddress(address: string): string | null {
  if (!address || typeof address !== 'string') return null;

  // 1) City name hit.
  for (const { pattern, tz } of CITY_TZ) {
    if (pattern.test(address)) return tz;
  }

  // 2) Two-letter province / state token. Look for the standard
  //    `, XX <postal>` shape first (most reliable), then a bare token.
  const provComma = address.match(/,\s*([A-Z]{2})(?:\s|,|$|\d)/);
  if (provComma) {
    const tz = PROVINCE_TZ[provComma[1].toUpperCase()];
    if (tz) return tz;
  }
  const provBare = address.match(/\b([A-Z]{2})\b\s*[A-Z]\d[A-Z]/); // CA postal
  if (provBare) {
    const tz = PROVINCE_TZ[provBare[1].toUpperCase()];
    if (tz) return tz;
  }

  return null;
}
