/**
 * venueMapDiscovery.ts
 *
 * Dynamically discovers venue map images/PDFs from Volleyball Canada
 * competition pages. The app fetches the HTML, scans for image and PDF
 * URLs that look like venue/court maps, and caches the results.
 *
 * This means venue maps are always up-to-date — if VC publishes a new
 * map or updates an existing one, the app picks it up automatically.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveredVenueMap {
  /** Direct URL to the venue map image or PDF */
  url: string;
  /** 'image' or 'pdf' */
  type: 'image' | 'pdf';
  /** Best-guess label extracted from filename or alt text */
  label: string;
}

export interface VenueMapDiscoveryResult {
  /** The source URL that was scraped */
  sourceUrl: string;
  /** Discovered map assets */
  maps: DiscoveredVenueMap[];
  /** When this was last fetched (ISO timestamp) */
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_KEY_PREFIX = 'venue_map_cache_';
/** Cache venue map discoveries for 6 hours */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** In-memory cache to avoid repeated AsyncStorage reads within a session */
const memoryCache = new Map<string, VenueMapDiscoveryResult>();

async function getCached(
  sourceUrl: string
): Promise<VenueMapDiscoveryResult | null> {
  // Check memory first
  const memResult = memoryCache.get(sourceUrl);
  if (memResult) {
    const age = Date.now() - new Date(memResult.fetchedAt).getTime();
    if (age < CACHE_TTL_MS) return memResult;
  }

  // Check AsyncStorage
  try {
    const key = CACHE_KEY_PREFIX + encodeURIComponent(sourceUrl);
    const stored = await AsyncStorage.getItem(key);
    if (stored) {
      const parsed: VenueMapDiscoveryResult = JSON.parse(stored);
      const age = Date.now() - new Date(parsed.fetchedAt).getTime();
      if (age < CACHE_TTL_MS) {
        memoryCache.set(sourceUrl, parsed);
        return parsed;
      }
    }
  } catch {
    // Cache miss — not critical
  }
  return null;
}

async function setCache(result: VenueMapDiscoveryResult): Promise<void> {
  memoryCache.set(result.sourceUrl, result);
  try {
    const key = CACHE_KEY_PREFIX + encodeURIComponent(result.sourceUrl);
    await AsyncStorage.setItem(key, JSON.stringify(result));
  } catch {
    // Non-critical
  }
}

// ---------------------------------------------------------------------------
// URL patterns that indicate a venue/court map
// ---------------------------------------------------------------------------

/** Patterns in URLs/filenames that suggest a venue map */
const MAP_URL_PATTERNS = [
  /venue.?map/i,
  /court.?map/i,
  /court.?layout/i,
  /floor.?plan/i,
  /facility.?map/i,
  /hall.?map/i,
  /site.?map/i,
  /map.*court/i,
  /court.*assign/i,
  /venue.*layout/i,
  /arena.*map/i,
  // OVA / sportngin patterns (e.g. "2026_OC_s_Map_Enercare.png")
  /OC.?s?.?Map/i,
  /enercare.*map/i,
  /map.*enercare/i,
];

/** Patterns in alt text / surrounding text */
const MAP_TEXT_PATTERNS = [
  /venue\s*map/i,
  /court\s*map/i,
  /court\s*layout/i,
  /floor\s*plan/i,
  /facility\s*map/i,
  /court\s*assign/i,
  /enercare/i,
  /venue\s*info/i,
];

/**
 * Pages whose URL path contains "venue" are likely venue info pages.
 * On these pages, we're more aggressive: any large image or PDF
 * is probably a venue map, even without "map" in the filename.
 */
function isVenuePage(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return (
      path.includes('venue') ||
      path.includes('facility') ||
      path.includes('arena') ||
      path.includes('ocs-venue') ||
      path.includes('court-map')
    );
  } catch {
    return false;
  }
}

/** Image extensions we care about */
const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i;
/** PDF extension */
const PDF_EXTENSION = /\.pdf(\?|$)/i;

// ---------------------------------------------------------------------------
// HTML Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract all <img> tags with their src and alt attributes
 */
function extractImages(html: string): Array<{ src: string; alt: string }> {
  const results: Array<{ src: string; alt: string }> = [];
  const imgRegex = /<img\s+[^>]*?src\s*=\s*["']([^"']+)["'][^>]*?>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    const altMatch = match[0].match(/alt\s*=\s*["']([^"']*?)["']/i);
    results.push({ src, alt: altMatch?.[1] || '' });
  }
  return results;
}

/**
 * Extract all <a> tags with href pointing to images or PDFs
 */
function extractLinks(html: string): Array<{ href: string; text: string }> {
  const results: Array<{ href: string; text: string }> = [];
  const linkRegex = /<a\s+[^>]*?href\s*=\s*["']([^"']+)["'][^>]*?>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    // Strip HTML tags from link text
    const text = match[2].replace(/<[^>]+>/g, '').trim();
    if (IMAGE_EXTENSIONS.test(href) || PDF_EXTENSION.test(href)) {
      results.push({ href, text });
    }
  }
  return results;
}

/**
 * Resolve a potentially relative URL against a base URL
 */
function resolveUrl(base: string, relative: string): string {
  if (relative.startsWith('http://') || relative.startsWith('https://')) {
    return relative;
  }
  if (relative.startsWith('//')) {
    return 'https:' + relative;
  }
  try {
    const baseUrl = new URL(base);
    if (relative.startsWith('/')) {
      return baseUrl.origin + relative;
    }
    // Relative path
    const basePath = baseUrl.pathname.replace(/\/[^/]*$/, '/');
    return baseUrl.origin + basePath + relative;
  } catch {
    return relative;
  }
}

/**
 * Extract a human-readable label from a URL or filename
 */
function labelFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split('/').pop() || '';
    // Remove extension, replace underscores/hyphens with spaces
    return filename
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || 'Venue Map';
  } catch {
    return 'Venue Map';
  }
}

// ---------------------------------------------------------------------------
// Main discovery function
// ---------------------------------------------------------------------------

/**
 * Discover venue map URLs from a volleyball.ca (or similar) competition page.
 *
 * Strategy:
 * 1. Fetch the page HTML
 * 2. Find images whose src or alt text matches venue map patterns
 * 3. Find links to image/PDF files whose URL or text matches venue map patterns
 * 4. Score and deduplicate results
 * 5. Cache and return
 *
 * @param pageUrl - The volleyball.ca competition page URL (e.g. calgary-2026)
 * @param forceRefresh - Skip cache and re-fetch
 */
export async function discoverVenueMaps(
  pageUrl: string,
  forceRefresh = false
): Promise<VenueMapDiscoveryResult> {
  // Check cache first
  if (!forceRefresh) {
    const cached = await getCached(pageUrl);
    if (cached) return cached;
  }

  const maps: DiscoveredVenueMap[] = [];

  try {
    const response = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'SetPoint-App/1.0',
        Accept: 'text/html',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // --- Scan images ---
    const images = extractImages(html);
    for (const img of images) {
      const fullUrl = resolveUrl(pageUrl, img.src);
      const isMapByUrl = MAP_URL_PATTERNS.some((p) => p.test(fullUrl));
      const isMapByAlt = MAP_TEXT_PATTERNS.some((p) => p.test(img.alt));

      if (isMapByUrl || isMapByAlt) {
        maps.push({
          url: fullUrl,
          type: 'image',
          label: img.alt || labelFromUrl(fullUrl),
        });
      }
    }

    // --- Scan links to images/PDFs ---
    const links = extractLinks(html);
    for (const link of links) {
      const fullUrl = resolveUrl(pageUrl, link.href);
      const isMapByUrl = MAP_URL_PATTERNS.some((p) => p.test(fullUrl));
      const isMapByText = MAP_TEXT_PATTERNS.some((p) => p.test(link.text));

      if (isMapByUrl || isMapByText) {
        const isPdf = PDF_EXTENSION.test(fullUrl);
        maps.push({
          url: fullUrl,
          type: isPdf ? 'pdf' : 'image',
          label: link.text || labelFromUrl(fullUrl),
        });
      }
    }

    // --- Also scan for any large images that might be maps ---
    // (images with "map" in the path even if not caught above)
    for (const img of images) {
      const fullUrl = resolveUrl(pageUrl, img.src);
      if (/map/i.test(fullUrl) && !maps.some((m) => m.url === fullUrl)) {
        maps.push({
          url: fullUrl,
          type: 'image',
          label: img.alt || labelFromUrl(fullUrl),
        });
      }
    }

    // --- Scan for PDFs with "map" in URL that are linked anywhere ---
    const allHrefs = html.match(/href\s*=\s*["']([^"']*\.pdf[^"']*)["']/gi) || [];
    for (const hrefMatch of allHrefs) {
      const urlMatch = hrefMatch.match(/["']([^"']+)["']/);
      if (!urlMatch) continue;
      const fullUrl = resolveUrl(pageUrl, urlMatch[1]);
      if (/map/i.test(fullUrl) && !maps.some((m) => m.url === fullUrl)) {
        maps.push({
          url: fullUrl,
          type: 'pdf',
          label: labelFromUrl(fullUrl),
        });
      }
    }

    // --- Venue-specific page: be more aggressive ---
    // If the page URL itself is a venue page (e.g. /ocs-venue), treat
    // any linked image or PDF as a likely venue map, even without "map"
    // in the filename. This catches pages like ontariovolleyball.org/ocs-venue
    // where the entire page is about the venue.
    if (isVenuePage(pageUrl) && maps.length === 0) {
      // Grab all images on the page (excluding tiny icons/logos)
      for (const img of images) {
        const fullUrl = resolveUrl(pageUrl, img.src);
        // Skip tiny images (icons, logos) — they usually have small dimensions
        // or come from common icon/logo paths
        if (/icon|logo|favicon|avatar|badge|sprite/i.test(fullUrl)) continue;
        if (!maps.some((m) => m.url === fullUrl)) {
          maps.push({
            url: fullUrl,
            type: 'image',
            label: img.alt || labelFromUrl(fullUrl),
          });
        }
      }
      // Also grab all linked PDFs on venue pages
      for (const link of links) {
        const fullUrl = resolveUrl(pageUrl, link.href);
        if (PDF_EXTENSION.test(fullUrl) && !maps.some((m) => m.url === fullUrl)) {
          maps.push({
            url: fullUrl,
            type: 'pdf',
            label: link.text || labelFromUrl(fullUrl),
          });
        }
      }
    }
  } catch (err) {
    console.warn(`Venue map discovery failed for ${pageUrl}:`, err);
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const uniqueMaps = maps.filter((m) => {
    if (seen.has(m.url)) return false;
    seen.add(m.url);
    return true;
  });

  // Prefer images over PDFs (sort images first)
  uniqueMaps.sort((a, b) => {
    if (a.type === 'image' && b.type === 'pdf') return -1;
    if (a.type === 'pdf' && b.type === 'image') return 1;
    return 0;
  });

  const result: VenueMapDiscoveryResult = {
    sourceUrl: pageUrl,
    maps: uniqueMaps,
    fetchedAt: new Date().toISOString(),
  };

  await setCache(result);
  return result;
}

/**
 * Pure picker — given discovered maps and the registry's configured URL
 * (if any), decide which URL to show.
 *
 * Rules:
 *   1. No discovered candidates → fall back to `configuredUrl` (may be null).
 *   2. `configuredUrl` is a PDF → defend it. Only override with a discovered
 *      PDF (PDF-to-PDF swap is fine); a discovered image must NOT win,
 *      because configured registry PDFs are intentional and discovered
 *      images are often stale, 404, or hotlink-blocked. This is the
 *      Calgary-Nationals root-cause fix: VC's competition page had a stale
 *      image matching MAP_URL_PATTERNS, and the existing image-first sort
 *      was promoting it over the configured tournament map PDF.
 *   3. Otherwise (no configured, or configured is an image / bundled asset)
 *      → preserve the existing discovery sort (images first, then PDFs).
 *
 * Extracted as a pure function so it can be unit-tested without mocking
 * fetch or AsyncStorage.
 */
export function pickBestMap(
  maps: DiscoveredVenueMap[],
  configuredUrl: string | null = null
): string | null {
  if (maps.length === 0) return configuredUrl;

  if (configuredUrl && PDF_EXTENSION.test(configuredUrl)) {
    const discoveredPdf = maps.find((m) => m.type === 'pdf');
    return discoveredPdf ? discoveredPdf.url : configuredUrl;
  }

  return maps[0].url;
}

/**
 * Convenience: get the best venue map URL for a given page.
 *
 * Pass `configuredUrl` to defend a registry-configured PDF against stale
 * images discovered on the source page — see `pickBestMap` for the rules.
 */
export async function getBestVenueMapUrl(
  pageUrl: string,
  options: { configuredUrl?: string | null; forceRefresh?: boolean } = {}
): Promise<string | null> {
  const { configuredUrl = null, forceRefresh = false } = options;
  const result = await discoverVenueMaps(pageUrl, forceRefresh);
  return pickBestMap(result.maps, configuredUrl);
}

/**
 * Clear all cached venue map discoveries
 */
export async function clearVenueMapCache(): Promise<void> {
  memoryCache.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => k.startsWith(CACHE_KEY_PREFIX));
    if (cacheKeys.length > 0) {
      await AsyncStorage.multiRemove(cacheKeys);
    }
  } catch {
    // Non-critical
  }
}
