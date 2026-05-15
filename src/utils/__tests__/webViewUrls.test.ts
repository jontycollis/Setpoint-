// ── webViewUrls tests ─────────────────────────────────────────────────────
//
// Pure-string helpers shared by ConnectionScreen + VenueMapScreen.
// Worth tests because the regex / slice logic is fiddly and easy to
// silently break — both an over-eager isPdfUrl (false-positives push
// PNGs through Google Docs Viewer) and an under-eager one (PDFs
// download instead of rendering on Android) degrade the UX with no
// runtime error.
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { prettifyUrl, sameUrl, isPdfUrl } from '../webViewUrls';

describe('prettifyUrl', () => {
  it('returns empty string for empty input', () => {
    expect(prettifyUrl('')).toBe('');
  });

  it('strips the http and https protocols', () => {
    expect(prettifyUrl('https://example.com/a')).toBe('example.com/a');
    expect(prettifyUrl('http://example.com/a')).toBe('example.com/a');
    expect(prettifyUrl('HTTPS://example.com/a')).toBe('example.com/a');
  });

  it('drops querystring and fragment', () => {
    expect(prettifyUrl('https://example.com/a?b=c')).toBe('example.com/a');
    expect(prettifyUrl('https://example.com/a#section')).toBe('example.com/a');
    expect(prettifyUrl('https://example.com/a?b=c#d')).toBe('example.com/a');
  });

  it('passes short URLs through unchanged (after protocol/query stripping)', () => {
    const short = 'example.com/short';
    expect(prettifyUrl(`https://${short}`)).toBe(short);
  });

  it('truncates URLs over 38 chars with a middle ellipsis', () => {
    const long =
      'https://very-long-host.example.com/some/deeply/nested/path/to/a/resource';
    const out = prettifyUrl(long);
    // Length cap (18 + 1 + 18 = 37 visible chars).
    expect(out.length).toBeLessThanOrEqual(38);
    // First 18 chars are the host prefix.
    expect(out.startsWith('very-long-host.exa')).toBe(true);
    // Last 18 chars are the path tail.
    expect(out.endsWith('h/to/a/resource')).toBe(true);
    // Middle is an ellipsis.
    expect(out.includes('…')).toBe(true);
  });

  it('preserves a URL exactly at 38 chars (no truncation)', () => {
    const exact = `${'a'.repeat(10)}.com/${'b'.repeat(23)}`; // 38 chars
    expect(prettifyUrl(`https://${exact}`)).toBe(exact);
    expect(exact.length).toBe(38);
  });
});

describe('sameUrl', () => {
  it('treats trailing slashes as equivalent', () => {
    expect(sameUrl('https://x.com/y', 'https://x.com/y/')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(sameUrl('https://X.COM/Y', 'https://x.com/y')).toBe(true);
  });

  it('ignores querystring and fragment', () => {
    expect(sameUrl('https://x.com/y', 'https://x.com/y?z=1')).toBe(true);
    expect(sameUrl('https://x.com/y', 'https://x.com/y#section')).toBe(true);
    expect(sameUrl('https://x.com/y?a=1', 'https://x.com/y?b=2')).toBe(true);
  });

  it('returns false for genuinely different paths', () => {
    expect(sameUrl('https://x.com/y', 'https://x.com/z')).toBe(false);
    expect(sameUrl('https://x.com/y', 'https://other.com/y')).toBe(false);
  });

  it('treats empty/null input as the same as itself', () => {
    expect(sameUrl('', '')).toBe(true);
    // The second arg type is string, but the implementation guards
    // with `(s || '')`, so we expect undefined-coerced-to-string to
    // equal empty.
    expect(sameUrl('', null as unknown as string)).toBe(true);
  });
});

describe('isPdfUrl', () => {
  it('matches a bare .pdf URL', () => {
    expect(isPdfUrl('https://x.com/file.pdf')).toBe(true);
  });

  it('matches .pdf followed by querystring or fragment', () => {
    expect(isPdfUrl('https://x.com/file.pdf?v=1')).toBe(true);
    expect(isPdfUrl('https://x.com/file.pdf#page=2')).toBe(true);
    expect(isPdfUrl('https://x.com/file.pdf?v=1#page=2')).toBe(true);
  });

  it('matches .pdf appearing inside a querystring value', () => {
    // Some servers serve PDFs via a generic route that takes the
    // filename as a query parameter. Without this case we'd send
    // those through the <img> path and fail on Android.
    expect(isPdfUrl('https://x.com/serve?file=foo.pdf')).toBe(true);
    expect(isPdfUrl('https://x.com/serve?file=foo.pdf&v=1')).toBe(true);
    expect(isPdfUrl('https://x.com/serve?file=foo.pdf#anchor')).toBe(true);
  });

  it('is case-insensitive on the extension', () => {
    expect(isPdfUrl('https://x.com/file.PDF')).toBe(true);
    expect(isPdfUrl('https://x.com/file.Pdf')).toBe(true);
  });

  it('does not match URLs that just contain "pdf" as a substring', () => {
    // The lookahead `(?=[?#&/]|$)` is what stops these from matching.
    expect(isPdfUrl('https://x.com/somepdfish/page')).toBe(false);
    expect(isPdfUrl('https://x.com/pdfgenerator')).toBe(false);
    expect(isPdfUrl('https://x.com/path/with-pdf-in-name.html')).toBe(false);
  });

  it('does not match non-PDF extensions', () => {
    expect(isPdfUrl('https://x.com/image.png')).toBe(false);
    expect(isPdfUrl('https://x.com/image.jpg')).toBe(false);
    expect(isPdfUrl('https://x.com/page.html')).toBe(false);
  });

  it('handles the actual Volleyball Canada Nationals URLs we ship', () => {
    expect(
      isPdfUrl(
        'https://volleyball.ca/uploads/Competitions/Nationals/2026/Indoor/Nationals-Map-Mississauga-V3.pdf'
      )
    ).toBe(true);
    expect(
      isPdfUrl(
        'https://volleyball.ca/uploads/Competitions/Nationals/2026/Indoor/Nationals-Map-Calgary-Tournament2-4.pdf'
      )
    ).toBe(true);
    expect(
      isPdfUrl(
        'https://volleyball.ca/uploads/Competitions/Nationals/2026/Indoor/Nationals-Map-Ottawa-3ftx4ft-REVISED.pdf'
      )
    ).toBe(true);
  });

  it('handles edge cases without crashing', () => {
    expect(isPdfUrl('')).toBe(false);
    expect(isPdfUrl('not a url')).toBe(false);
  });
});
