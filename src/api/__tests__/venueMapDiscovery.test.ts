// ── venueMapDiscovery picker tests ─────────────────────────────────────────
//
// Pins the picking rules in `pickBestMap`. The Calgary-Nationals incident
// (2026 Indoor) was that VC's competition page had a stale image matching
// MAP_URL_PATTERNS; the old image-first sort promoted it over the configured
// registry PDF, and the WebView rendered a broken image placeholder. These
// tests lock in: configured PDF beats discovered image; PDF-to-PDF override
// is fine; no-configured behaviour is unchanged.
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { pickBestMap, type DiscoveredVenueMap } from '../venueMapDiscovery';

const CONFIG_PDF =
  'https://volleyball.ca/uploads/Competitions/Nationals/2026/Indoor/Nationals-Map-Calgary-Tournament2-4.pdf';

const DISCOVERED_IMAGE: DiscoveredVenueMap = {
  url: 'https://volleyball.ca/some/discovered/venue-map.png',
  type: 'image',
  label: 'Discovered Venue Map',
};

const DISCOVERED_PDF: DiscoveredVenueMap = {
  url: 'https://volleyball.ca/some/discovered/venue-map.pdf',
  type: 'pdf',
  label: 'Discovered Venue Map PDF',
};

describe('pickBestMap', () => {
  it('returns the configured PDF when discovery only finds an image', () => {
    // The Calgary regression: stale image must NOT win over the configured
    // tournament map PDF.
    expect(pickBestMap([DISCOVERED_IMAGE], CONFIG_PDF)).toBe(CONFIG_PDF);
  });

  it('lets a discovered PDF override the configured PDF', () => {
    // PDF-to-PDF swap is fine — discovery may surface a newer revision
    // (e.g. court re-assignments mid-tournament).
    expect(pickBestMap([DISCOVERED_PDF], CONFIG_PDF)).toBe(DISCOVERED_PDF.url);
  });

  it('prefers a discovered PDF even when an image was also discovered, if configured is a PDF', () => {
    // discoverVenueMaps sorts images first, so the input here mimics what
    // the caller actually gets. The picker must still pick the PDF when
    // defending a configured PDF.
    expect(
      pickBestMap([DISCOVERED_IMAGE, DISCOVERED_PDF], CONFIG_PDF)
    ).toBe(DISCOVERED_PDF.url);
  });

  it('preserves the existing image-first behaviour when no URL is configured', () => {
    // Ad-hoc tournaments (no registry entry) should still get the
    // historical "images preferred" sort from discoverVenueMaps.
    expect(pickBestMap([DISCOVERED_IMAGE, DISCOVERED_PDF])).toBe(
      DISCOVERED_IMAGE.url
    );
  });

  it('returns null when discovery is empty and no URL is configured', () => {
    expect(pickBestMap([])).toBeNull();
  });

  it('returns the configured PDF when discovery finds nothing', () => {
    expect(pickBestMap([], CONFIG_PDF)).toBe(CONFIG_PDF);
  });

  it('does not defend a configured non-PDF (image) URL', () => {
    // The defense is intentionally PDF-specific — configured images are
    // typically bundled provincials maps that don't have a discovery
    // pipeline pointing at them. Preserve the old behaviour for safety.
    const configuredImage = 'https://example.com/configured.png';
    expect(pickBestMap([DISCOVERED_IMAGE], configuredImage)).toBe(
      DISCOVERED_IMAGE.url
    );
  });
});
