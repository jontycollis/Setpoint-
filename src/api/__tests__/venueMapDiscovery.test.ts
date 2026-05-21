// ── venueMapDiscovery picker tests ─────────────────────────────────────────
//
// Pins the picking rules in `pickBestMap`: a configured URL ALWAYS wins.
// Discovery is only a fallback for venues without a registry-configured map.
//
// History: the Calgary-Nationals 2026 incident had VC's competition page
// linking the wrong tournament's PDF (Tournament1, a 404) — the previous
// "PDF-to-PDF override allowed" rule let that win over the configured
// Tournament2-4 PDF. Removed that rule entirely; configured is intentional,
// discovered is best-effort.
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { pickBestMap, type DiscoveredVenueMap } from '../venueMapDiscovery';

const CONFIG_PDF =
  'https://volleyball.ca/uploads/Competitions/Nationals/2026/Indoor/Nationals-Map-Calgary-Tournament2-4.pdf';

const CONFIG_IMAGE = 'https://example.com/configured-venue-map.png';

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
    expect(pickBestMap([DISCOVERED_IMAGE], CONFIG_PDF)).toBe(CONFIG_PDF);
  });

  it('returns the configured PDF even when discovery finds a PDF', () => {
    // The Calgary regression: VC's page linked the wrong tournament's PDF.
    // Configured is intentional — discovery does not override.
    expect(pickBestMap([DISCOVERED_PDF], CONFIG_PDF)).toBe(CONFIG_PDF);
  });

  it('returns the configured PDF when discovery finds both an image and a PDF', () => {
    expect(
      pickBestMap([DISCOVERED_IMAGE, DISCOVERED_PDF], CONFIG_PDF)
    ).toBe(CONFIG_PDF);
  });

  it('returns the configured image when discovery finds a PDF', () => {
    // Configured-anything wins, not just configured PDFs.
    expect(pickBestMap([DISCOVERED_PDF], CONFIG_IMAGE)).toBe(CONFIG_IMAGE);
  });

  it('returns the configured image when discovery finds an image', () => {
    expect(pickBestMap([DISCOVERED_IMAGE], CONFIG_IMAGE)).toBe(CONFIG_IMAGE);
  });

  it('preserves the existing image-first behaviour when no URL is configured', () => {
    // Ad-hoc tournaments (no registry entry) fall back to discovery,
    // which sorts images first.
    expect(pickBestMap([DISCOVERED_IMAGE, DISCOVERED_PDF])).toBe(
      DISCOVERED_IMAGE.url
    );
  });

  it('returns the discovered PDF when no URL is configured and only PDFs were found', () => {
    expect(pickBestMap([DISCOVERED_PDF])).toBe(DISCOVERED_PDF.url);
  });

  it('returns null when discovery is empty and no URL is configured', () => {
    expect(pickBestMap([])).toBeNull();
  });

  it('returns the configured PDF when discovery finds nothing', () => {
    expect(pickBestMap([], CONFIG_PDF)).toBe(CONFIG_PDF);
  });
});
