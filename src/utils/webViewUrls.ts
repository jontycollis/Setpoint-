// ── WebView URL utilities ─────────────────────────────────────────────────
//
// Pure string helpers for the WebView-hosting screens (ConnectionScreen,
// VenueMapScreen). Kept in their own module so the unit tests can
// import them — Vitest runs in a Node environment and can't parse the
// React-Native imports the screen files pull in.
//
// All functions are pure and side-effect-free. They take strings,
// return strings or booleans, and never touch the DOM, AsyncStorage,
// or any RN API.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compress a URL into something readable in the slim ConnectionScreen
 * toolbar:
 *   - drop the protocol (http/https — assumed always present, just noise)
 *   - drop the querystring and fragment (also noise on a phone display)
 *   - cap at 38 chars; longer URLs get an ellipsis in the middle so the
 *     host and the path tail both stay visible
 *
 * @example
 *   prettifyUrl('https://example.com/a/b')           // → 'example.com/a/b'
 *   prettifyUrl('https://example.com/path?q=1')      // → 'example.com/path'
 *   prettifyUrl('https://very-long-host.example.com/some/long/path/here')
 *     // → 'very-long-host.exa…some/long/path/here'  (length-capped)
 */
export function prettifyUrl(url: string): string {
  if (!url) return '';
  let s = url.replace(/^https?:\/\//i, '');
  s = s.replace(/#.*$/, '').replace(/\?.*$/, '');
  if (s.length > 38) s = s.slice(0, 18) + '…' + s.slice(-18);
  return s;
}

/**
 * Loose URL comparator. Returns true if two URLs point to the "same
 * page" by app-pragmatic rules:
 *   - case-insensitive
 *   - trailing slash ignored
 *   - querystring and fragment ignored
 *
 * Used by ConnectionScreen's auto-redirect logic to avoid bouncing the
 * user when the captured URL matches the current URL.
 *
 * @example
 *   sameUrl('https://x.com/y', 'https://x.com/y/')        // → true
 *   sameUrl('https://x.com/y', 'https://X.COM/y#section') // → true
 *   sameUrl('https://x.com/y', 'https://x.com/z')         // → false
 */
export function sameUrl(a: string, b: string): boolean {
  const norm = (s: string) =>
    (s || '').replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/**
 * True when the URL points at a PDF that we should route through
 * Google Docs Viewer instead of rendering with a bare `<img>` tag.
 *
 * Matches `.pdf` followed by a URL delimiter — query (`?`), fragment
 * (`#`), separator (`&`), path slash (`/`), or end-of-string. The
 * lookahead is what stops the regex from false-positiving on paths
 * that just happen to contain the literal "pdf" (e.g. `/somepdfish/`).
 *
 * @example
 *   isPdfUrl('https://x/file.pdf')                       // → true
 *   isPdfUrl('https://x/file.pdf?v=1')                   // → true
 *   isPdfUrl('https://x/file.pdf#anchor')                // → true
 *   isPdfUrl('https://x/serve?file=foo.pdf')             // → true
 *   isPdfUrl('https://x/serve?file=foo.pdf&v=1')         // → true
 *   isPdfUrl('https://x/somepdfish/page')                // → false
 *   isPdfUrl('https://x/image.png')                      // → false
 */
export function isPdfUrl(url: string): boolean {
  return /\.pdf(?=[?#&/]|$)/i.test(url);
}
