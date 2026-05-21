import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import { getBestVenueMapUrl } from '../api/venueMapDiscovery';
import { isPdfUrl } from '../utils/webViewUrls';

/**
 * Bundled venue map assets — keyed by the identifier after "bundled:" prefix.
 * Add new bundled maps here as they become available.
 */
const BUNDLED_VENUE_MAPS: Record<string, any> = {
  'nationals-2026-venue-map': require('../../assets/nationals-2026-venue-map.png'),
};

/**
 * In-memory cache of downloaded venue map PDFs, keyed by URL → base64
 * string. The PDFs live on volleyball.ca, which does NOT serve
 * Access-Control-Allow-Origin, so a browser-hosted PDF.js viewer
 * (mozilla.github.io) can't fetch them cross-origin and renders empty.
 * RN's native fetch has no CORS, so we download the bytes in JS, embed
 * them as base64 in the WebView's HTML, and render with PDF.js → canvas
 * locally inside the WebView. Caching avoids re-downloading on back/forth.
 */
const PDF_BASE64_CACHE = new Map<string, string>();

/**
 * Checks if a venueMapUrl is a bundled asset reference.
 */
function isBundledUrl(url: string): boolean {
  return url.startsWith('bundled:');
}

/**
 * Gets the require() asset for a bundled: URL, or null if unknown.
 */
function getBundledAsset(url: string): any | null {
  if (!isBundledUrl(url)) return null;
  const assetKey = url.slice('bundled:'.length);
  return BUNDLED_VENUE_MAPS[assetKey] ?? null;
}

/**
 * Resolves a venueMapUrl to a remote URI (for WebView use).
 * - "bundled:xyz" → resolves to a URI via Image.resolveAssetSource
 * - Regular URL → returned as-is
 */
function resolveToRemoteUrl(venueMapUrl: string): string | null {
  if (isBundledUrl(venueMapUrl)) {
    const asset = getBundledAsset(venueMapUrl);
    if (asset) {
      const resolved = Image.resolveAssetSource(asset);
      return resolved.uri;
    }
    console.warn(`Unknown bundled venue map: ${venueMapUrl}`);
    return null;
  }
  return venueMapUrl;
}

interface Props {
  onBack: () => void;
  venueMapUrl?: string;
  /** URL to a competition info page (volleyball.ca) to discover maps from */
  infoPageUrl?: string;
  highlightCourt?: string;
  matchInfo?: {
    opponentName: string;
    time: string;
  };
}

// Shared "Find: <court>" fixed banner. Same markup for the image and
// PDF HTML builders so the highlight UX is identical regardless of map
// format.
function buildCourtBannerHtml(highlightCourt?: string): string {
  if (!highlightCourt) return '';
  return `
    <div id="court-banner" style="
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: linear-gradient(135deg, #1a73e8, #1557b0);
      color: white;
      text-align: center;
      padding: 12px 16px;
      font-family: -apple-system, sans-serif;
      font-size: 16px;
      font-weight: 700;
      z-index: 1000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    ">
      <span style="
        display: inline-block;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #34a853;
        animation: pulse 1.5s infinite;
      "></span>
      Find: ${highlightCourt}
    </div>
    <style>
      @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(1.3); }
      }
    </style>
  `;
}

// Image branch — wrap a remote <img> in a centered flex layout. Used
// for PNG/JPG venue maps (e.g. provincials). PDFs go through the
// canvas-based renderer below.
function buildMapHtml(url: string, highlightCourt?: string) {
  const courtBanner = buildCourtBannerHtml(highlightCourt);
  const bodyPadding = highlightCourt ? 'padding-top: 56px;' : '';
  return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=10, user-scalable=yes">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      background: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
      -webkit-overflow-scrolling: touch;
      ${bodyPadding}
    }
    img {
      max-width: 100%;
      height: auto;
      display: block;
    }
  </style>
</head>
<body>
  ${courtBanner}
  <img src="${url}" alt="Venue Map" />
</body>
</html>
`;
}

// PDF branch — render PDF bytes (already downloaded in RN and passed in
// as base64) to one canvas per page using PDF.js loaded from cdnjs.
// This avoids any cross-origin fetch from inside the WebView, which is
// what made the previous "iframe to mozilla.github.io/pdf.js" approach
// fail: volleyball.ca's /uploads/ directory doesn't send
// Access-Control-Allow-Origin, so PDF.js running on a different origin
// couldn't fetch the PDF. Embedding the bytes inline sidesteps CORS.
// `baseUrl` on the WebView source is set to cdnjs so PDF.js's worker
// (loaded from the same origin as pdf.min.js) doesn't trip up.
function buildPdfCanvasHtml(pdfBase64: string, highlightCourt?: string) {
  const courtBanner = buildCourtBannerHtml(highlightCourt);
  const bodyPadding = highlightCourt ? 'padding-top: 56px;' : '';
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=10, user-scalable=yes">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; background: #f4f4f4; ${bodyPadding} }
    #container { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px; }
    canvas { box-shadow: 0 2px 8px rgba(0,0,0,.15); max-width: 100%; background: white; }
    #status { padding: 24px; color: #666; font-family: -apple-system, sans-serif; font-size: 14px; text-align: center; }
    #status.error { color: #c00; }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js"></script>
</head>
<body>
  ${courtBanner}
  <div id="container">
    <div id="status">Rendering PDF…</div>
  </div>
  <script>
    (function () {
      var statusEl = document.getElementById('status');
      var container = document.getElementById('container');
      var setError = function (msg) {
        statusEl.className = 'error';
        statusEl.textContent = msg;
      };
      if (typeof pdfjsLib === 'undefined') {
        setError('PDF viewer failed to load. Try the "Open in browser" link below.');
        return;
      }
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js';
        var b64 = "${pdfBase64}";
        var bin = atob(b64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        var dpr = window.devicePixelRatio || 1;
        pdfjsLib.getDocument({ data: bytes }).promise.then(function (pdf) {
          if (statusEl && statusEl.parentNode) statusEl.parentNode.removeChild(statusEl);
          var chain = Promise.resolve();
          for (var p = 1; p <= pdf.numPages; p++) {
            (function (pageNum) {
              chain = chain.then(function () {
                return pdf.getPage(pageNum).then(function (page) {
                  var viewport = page.getViewport({ scale: 1.5 * dpr });
                  var canvas = document.createElement('canvas');
                  canvas.width = viewport.width;
                  canvas.height = viewport.height;
                  canvas.style.width = (viewport.width / dpr) + 'px';
                  canvas.style.height = (viewport.height / dpr) + 'px';
                  container.appendChild(canvas);
                  return page.render({
                    canvasContext: canvas.getContext('2d'),
                    viewport: viewport,
                  }).promise;
                });
              });
            })(p);
          }
          return chain;
        }).catch(function (err) {
          setError('Could not render PDF: ' + (err && err.message ? err.message : err));
        });
      } catch (err) {
        setError('Could not render PDF: ' + (err && err.message ? err.message : err));
      }
    })();
  </script>
</body>
</html>`;
}

export function VenueMapScreen({
  onBack,
  venueMapUrl,
  infoPageUrl,
  highlightCourt,
  matchInfo,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [discoveredMapUrl, setDiscoveredMapUrl] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);

  // --- Dynamic venue map discovery ---
  // If an infoPageUrl is provided, try to discover a venue map from it.
  // This runs in the background; the static/bundled map shows immediately
  // and gets replaced if a better one is found dynamically.
  useEffect(() => {
    if (!infoPageUrl) return;
    let cancelled = false;
    setDiscovering(true);

    (async () => {
      try {
        // Pass the registry-configured URL so the picker can defend a
        // configured PDF against stale/broken discovered images (see
        // pickBestMap in venueMapDiscovery.ts for the rules).
        const mapUrl = await getBestVenueMapUrl(infoPageUrl, {
          configuredUrl: venueMapUrl ?? null,
        });
        if (!cancelled && mapUrl) {
          setDiscoveredMapUrl(mapUrl);
        }
      } catch (err) {
        console.warn('Venue map discovery failed:', err);
      } finally {
        if (!cancelled) setDiscovering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [infoPageUrl, venueMapUrl]);

  // Priority: discovered map > configured static URL > nothing
  // For bundled assets, we render with <Image> directly rather than WebView
  const hasBundledMap = !!venueMapUrl && isBundledUrl(venueMapUrl);
  const bundledAsset = hasBundledMap ? getBundledAsset(venueMapUrl!) : null;
  const resolvedRemoteUrl = venueMapUrl && !hasBundledMap
    ? resolveToRemoteUrl(venueMapUrl)
    : null;

  // Final URL to show in WebView (remote URLs only — bundled uses <Image>)
  const remoteMapUrl = discoveredMapUrl || resolvedRemoteUrl || null;

  // Do we have ANY map to show?
  const hasAnyMap = !!remoteMapUrl || !!bundledAsset;
  // Are we still checking for one dynamically?
  const stillSearching = discovering && !hasAnyMap;
  // Is the resolved remote URL a PDF? Drives the PDF-download flow and
  // the "Open PDF in browser" fallback button — rendering can still
  // fail silently (PDF.js bug, OOM, etc.), so users need a guaranteed
  // escape hatch.
  const remoteIsPdf = !!remoteMapUrl && isPdfUrl(remoteMapUrl);

  // --- PDF download + base64 conversion ---
  // PDF.js inside the WebView can't cross-origin-fetch volleyball.ca
  // PDFs (no CORS header), so we download the bytes here in JS — RN's
  // native fetch has no CORS — and embed the base64 into the WebView
  // HTML so PDF.js reads it directly with no network call.
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pdfFetchError, setPdfFetchError] = useState<string | null>(null);
  const [pdfFetching, setPdfFetching] = useState(false);

  useEffect(() => {
    setPdfBase64(null);
    setPdfFetchError(null);
    setPdfFetching(false);
    if (!remoteMapUrl || !isPdfUrl(remoteMapUrl)) return;

    // Reset the WebView's loading state so the spinner shows during
    // both the RN-side download and the WebView's own onLoad cycle.
    setLoading(true);
    setError(false);

    const cached = PDF_BASE64_CACHE.get(remoteMapUrl);
    if (cached) {
      setPdfBase64(cached);
      return;
    }

    let cancelled = false;
    setPdfFetching(true);
    (async () => {
      try {
        const response = await fetch(remoteMapUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () =>
            reject(reader.error ?? new Error('FileReader failed'));
          reader.readAsDataURL(blob);
        });
        const commaIdx = dataUrl.indexOf(',');
        const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
        if (!base64) throw new Error('Empty PDF body');
        if (cancelled) return;
        PDF_BASE64_CACHE.set(remoteMapUrl, base64);
        setPdfBase64(base64);
      } catch (err) {
        if (cancelled) return;
        console.warn('[VenueMapScreen] PDF fetch failed:', err);
        setPdfFetchError(
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        if (!cancelled) setPdfFetching(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [remoteMapUrl]);

  const pdfReady = remoteIsPdf && !!pdfBase64;
  const pdfDownloading = remoteIsPdf && pdfFetching && !pdfBase64;
  const pdfFailed = remoteIsPdf && !!pdfFetchError && !pdfBase64;

  // ---- Diagnostic log (dev only) ----------------------------------
  // Surfaces which URL ended up driving the WebView and which rendering
  // branch was picked, so future "broken venue map" reports can be
  // diagnosed from a single log line instead of guessing.
  useEffect(() => {
    if (!__DEV__) return;
    const branch = !hasAnyMap
      ? 'no-map'
      : bundledAsset
      ? 'bundled-image'
      : remoteMapUrl && isPdfUrl(remoteMapUrl)
      ? 'webview-pdf'
      : remoteMapUrl
      ? 'webview-image'
      : 'unknown';
    const fileType = remoteMapUrl
      ? isPdfUrl(remoteMapUrl)
        ? 'pdf'
        : 'image'
      : hasBundledMap
      ? 'bundled'
      : 'none';
    console.log('[VenueMapScreen]', {
      configuredVenueMapUrl: venueMapUrl ?? null,
      infoPageUrl: infoPageUrl ?? null,
      discoveredMapUrl,
      resolvedRemoteUrl,
      finalRemoteUrl: remoteMapUrl,
      fileType,
      branch,
      pdfDownloading,
      pdfReady,
      pdfFailed,
      pdfFetchError,
    });
  }, [
    venueMapUrl,
    infoPageUrl,
    discoveredMapUrl,
    resolvedRemoteUrl,
    remoteMapUrl,
    hasAnyMap,
    bundledAsset,
    hasBundledMap,
    pdfDownloading,
    pdfReady,
    pdfFailed,
    pdfFetchError,
  ]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
        >
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Venue Map</Text>
        <View style={styles.headerRow}>
          {hasAnyMap && <Text style={styles.subtitle}>Pinch to zoom</Text>}
          {discovering && (
            <Text style={styles.discoveringText}>Checking for updates...</Text>
          )}
        </View>
      </View>

      {/* Court info banner */}
      {highlightCourt && (
        <View style={styles.courtBanner}>
          <View style={styles.courtPulse} />
          <View style={styles.courtBannerInfo}>
            <Text style={styles.courtBannerTitle}>
              Your next match: {highlightCourt}
            </Text>
            {matchInfo && (
              <Text style={styles.courtBannerDetail}>
                vs {matchInfo.opponentName} at {matchInfo.time}
              </Text>
            )}
          </View>
        </View>
      )}

      <View style={styles.webviewContainer}>
        {/* Loading state — shown while WebView loads, while discovering, or
            while downloading a PDF (PDFs are fetched in RN to avoid CORS,
            then handed to PDF.js as base64). */}
        {(loading && hasAnyMap && !pdfFailed) || stillSearching || pdfDownloading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>
              {stillSearching
                ? 'Searching for venue map...'
                : 'Loading venue map...'}
            </Text>
          </View>
        ) : null}

        {error || pdfFailed ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>
              {pdfFailed
                ? "Couldn't load the venue map PDF. Tap below to open it in your browser."
                : 'Unable to load the venue map. Please check your internet connection.'}
            </Text>
            {!pdfFailed && (
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => {
                  setError(false);
                  setLoading(true);
                }}
              >
                <Text style={styles.retryText}>Tap to retry</Text>
              </TouchableOpacity>
            )}
            {remoteIsPdf && remoteMapUrl ? (
              <TouchableOpacity
                style={styles.openWebButton}
                onPress={() => Linking.openURL(remoteMapUrl)}
              >
                <Text style={styles.openWebText}>Open PDF in browser</Text>
              </TouchableOpacity>
            ) : infoPageUrl ? (
              <TouchableOpacity
                style={styles.openWebButton}
                onPress={() => Linking.openURL(infoPageUrl)}
              >
                <Text style={styles.openWebText}>
                  View on competition website
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : !hasAnyMap && !stillSearching ? (
          /* No map available */
          <View style={styles.errorContainer}>
            <Text style={styles.noMapIcon}>{'\u{1F5FA}'}</Text>
            <Text style={styles.noMapTitle}>No Venue Map Available</Text>
            <Text style={styles.errorText}>
              A venue map hasn't been published for this event yet. Check back
              closer to the tournament start date.
            </Text>
            {infoPageUrl && (
              <TouchableOpacity
                style={styles.openWebButton}
                onPress={() => Linking.openURL(infoPageUrl)}
              >
                <Text style={styles.openWebText}>
                  Check competition website
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : remoteIsPdf && pdfReady && pdfBase64 ? (
          /* PDF — render in WebView using inlined base64 + PDF.js → canvas.
             baseUrl is set to cdnjs so the PDF.js worker (same origin as
             pdf.min.js) loads without cross-origin worker gymnastics. */
          <WebView
            key={remoteMapUrl}
            source={{
              html: buildPdfCanvasHtml(pdfBase64, highlightCourt),
              baseUrl: 'https://cdnjs.cloudflare.com/',
            }}
            style={styles.webview}
            scalesPageToFit={true}
            bounces={false}
            scrollEnabled={true}
            javaScriptEnabled={true}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
            originWhitelist={['*']}
            allowsInlineMediaPlayback={true}
            builtInZoomControls={true}
            displayZoomControls={false}
          />
        ) : remoteIsPdf ? (
          /* PDF download in progress (or queued) — spinner from loadingOverlay
             above covers this; render nothing here. */
          null
        ) : remoteMapUrl ? (
          /* Remote image URL — render in WebView with zoom */
          <WebView
            key={remoteMapUrl}
            source={{ html: buildMapHtml(remoteMapUrl, highlightCourt) }}
            style={styles.webview}
            scalesPageToFit={true}
            bounces={false}
            scrollEnabled={true}
            javaScriptEnabled={true}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
            originWhitelist={['*']}
            allowsInlineMediaPlayback={true}
            builtInZoomControls={true}
            displayZoomControls={false}
          />
        ) : bundledAsset ? (
          /* Bundled asset — render with native <Image> for reliable display */
          <ScrollView
            style={styles.bundledScrollView}
            contentContainerStyle={styles.bundledScrollContent}
            maximumZoomScale={5}
            minimumZoomScale={1}
            bouncesZoom={true}
            showsVerticalScrollIndicator={false}
          >
            {highlightCourt && (
              <View style={styles.courtHighlightBar}>
                <Text style={styles.courtHighlightText}>
                  Find: {highlightCourt}
                </Text>
              </View>
            )}
            <Image
              source={bundledAsset}
              style={styles.bundledImage}
              resizeMode="contain"
              onLoadEnd={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setError(true);
              }}
            />
          </ScrollView>
        ) : null}
      </View>

      <View style={styles.footer}>
        {remoteIsPdf && remoteMapUrl ? (
          // PDF fallback: PDF.js inside the WebView can fail silently
          // (CORS, iframe blocking, viewer offline). Surface a direct
          // link so the user always has a way to see the map.
          <TouchableOpacity
            onPress={() => Linking.openURL(remoteMapUrl)}
            activeOpacity={0.7}
          >
            <Text style={styles.footerLink}>
              Trouble viewing? Open PDF in browser
            </Text>
          </TouchableOpacity>
        ) : infoPageUrl ? (
          <TouchableOpacity
            onPress={() => Linking.openURL(infoPageUrl)}
            activeOpacity={0.7}
          >
            <Text style={styles.footerLink}>
              {highlightCourt
                ? `Look for ${highlightCourt} on the map`
                : 'View full venue info on competition website'}
            </Text>
          </TouchableOpacity>
        ) : hasAnyMap ? (
          <Text style={styles.footerText}>
            {highlightCourt
              ? `Look for ${highlightCourt} on the map`
              : 'Pinch to zoom'}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  backText: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  discoveringText: {
    fontSize: fontSize.xs,
    color: colors.primary,
    fontStyle: 'italic',
  },
  // Court highlight banner
  courtBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  courtPulse: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.success,
    marginRight: spacing.md,
  },
  courtBannerInfo: {
    flex: 1,
  },
  courtBannerTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: '#ffffff',
  },
  courtBannerDetail: {
    fontSize: fontSize.sm,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 1,
  },
  webviewContainer: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    zIndex: 10,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxxl,
  },
  errorText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  retryButton: {
    padding: spacing.md,
  },
  retryText: {
    fontSize: fontSize.md,
    color: colors.primary,
    fontWeight: '600',
  },
  openWebButton: {
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  openWebText: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  footer: {
    padding: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  footerText: {
    fontSize: fontSize.sm,
    color: colors.textLight,
  },
  footerLink: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: '600',
  },
  // No map available state
  noMapIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  noMapTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  // Bundled image styles
  bundledScrollView: {
    flex: 1,
    backgroundColor: colors.background,
  },
  bundledScrollContent: {
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    padding: spacing.sm,
  },
  bundledImage: {
    width: '100%',
    height: undefined,
    aspectRatio: 1.5,   // Approximate — Image will constrain via resizeMode
  },
  courtHighlightBar: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.sm,
    alignSelf: 'center',
  },
  courtHighlightText: {
    color: '#ffffff',
    fontSize: fontSize.md,
    fontWeight: '700',
  },
});
}
