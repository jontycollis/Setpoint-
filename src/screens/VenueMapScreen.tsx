import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
import type { WebViewMessageEvent } from 'react-native-webview';
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

// Convert an ArrayBuffer of binary bytes to a base64 string.
// We chunk through the Uint8Array (32k at a time) to avoid
// `String.fromCharCode(...bytes)` stack-overflowing on multi-megabyte
// PDFs. Uses `global.btoa` (polyfilled by RN core-js); throws if missing.
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    chunks.push(String.fromCharCode.apply(null, Array.from(slice)));
  }
  const binary = chunks.join('');
  const g: any = globalThis as any;
  if (typeof g.btoa === 'function') return g.btoa(binary);
  throw new Error('E_NO_BTOA');
}

// Browser-like headers sent on both fetch and XHR paths. volleyball.ca's
// CDN/origin has been observed rejecting the default RN fetch UA
// (`okhttp/...`) with 404s, while serving the same URL 200 to a normal
// browser. Spoofing a Chrome-on-Android UA + Accept/Referer makes the
// device request indistinguishable from a browser at the HTTP layer.
const VENUE_MAP_REQUEST_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  Accept: 'application/pdf,application/octet-stream,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://volleyball.ca/',
};

// XHR fallback for `fetch().arrayBuffer()` — historically more reliable
// for binary downloads on older Android RN builds. Returns the bytes
// as an ArrayBuffer or rejects with a short code.
function xhrArrayBuffer(url: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    xhr.timeout = 30000;
    // RN's XHR allows setting User-Agent (browsers don't); spoofing a
    // browser UA dodges origin-side filters that 404 on `okhttp/...`.
    for (const [name, value] of Object.entries(VENUE_MAP_REQUEST_HEADERS)) {
      try {
        xhr.setRequestHeader(name, value);
      } catch {
        // setRequestHeader can throw if the platform forbids a header;
        // swallow rather than fail the whole download.
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as ArrayBuffer);
      } else {
        reject(new Error(`E_XHR_HTTP_${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('E_XHR_NETWORK'));
    xhr.ontimeout = () => reject(new Error('E_XHR_TIMEOUT'));
    xhr.send();
  });
}

// Download a PDF as base64. Tries `fetch().arrayBuffer()` first (modern,
// fast), then falls back to XHR if fetch errors out OR returns 0 bytes
// (Android RN has historically had both failure modes). Returns the
// base64 body (no data: prefix) ready to inline into the WebView HTML.
async function downloadPdfAsBase64(url: string): Promise<string> {
  let arrayBuffer: ArrayBuffer | null = null;
  let primaryErr: unknown = null;

  try {
    const response = await fetch(url, { headers: VENUE_MAP_REQUEST_HEADERS });
    if (!response.ok) throw new Error(`E_FETCH_HTTP_${response.status}`);
    arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      primaryErr = new Error('E_FETCH_EMPTY');
      arrayBuffer = null;
    }
  } catch (err) {
    primaryErr = err;
  }

  if (!arrayBuffer) {
    if (__DEV__) {
      console.log(
        '[venue-map] fetch path failed, trying XHR:',
        primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
      );
    }
    arrayBuffer = await xhrArrayBuffer(url);
    if (arrayBuffer.byteLength === 0) throw new Error('E_XHR_EMPTY');
  }

  if (__DEV__) {
    console.log('[venue-map] arrayBuffer length:', arrayBuffer.byteLength);
  }

  const base64 = arrayBufferToBase64(arrayBuffer);
  if (__DEV__) {
    console.log('[venue-map] base64 length:', base64.length);
  }
  return base64;
}

// Truncate a URL for the error UI: keep the first 40 chars and last 40
// chars with an ellipsis in between, so users can read off enough of
// both ends to identify which URL is failing.
function truncateUrlForDisplay(url: string): string {
  if (url.length <= 83) return url;
  return `${url.slice(0, 40)}…${url.slice(-40)}`;
}

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

// PDF branch — small HTML scaffold (~3KB) that loads PDF.js from cdnjs
// and waits for RN to deliver the PDF bytes via `injectJavaScript` ->
// `window.__loadPdf(base64)`.
//
// Why not embed the base64 in the HTML directly: Android WebView's
// `source={{ html }}` chokes on very large HTML payloads (a 2.6 MB PDF
// is ~3.5 MB of base64); the page either fails to load, gets truncated,
// or fires `onError`. Decoupling the scaffold from the data keeps the
// HTML tiny and reliable.
//
// The scaffold posts JSON messages back to RN via
// `window.ReactNativeWebView.postMessage(...)` at each pipeline step,
// so RN's `onMessage` handler can drive a state machine and surface
// granular error codes ("PDFJS_LOAD_FAIL", "RENDER_THROW", etc.) when
// anything goes wrong.
//
// `baseUrl` on the WebView source is set to cdnjs so PDF.js's worker
// (loaded from the same origin as pdf.min.js) is same-origin to the
// document.
function buildPdfScaffoldHtml(highlightCourt?: string) {
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
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js"></script>
</head>
<body>
  ${courtBanner}
  <div id="container">
    <div id="status">Loading PDF…</div>
  </div>
  <script>
    (function () {
      var post = function (payload) {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
      };
      window.__loadPdf = function (b64) {
        try {
          if (typeof pdfjsLib === 'undefined') {
            post({ kind: 'error', code: 'PDFJS_LOAD_FAIL', detail: 'pdfjsLib undefined at load time' });
            return;
          }
          pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js';
          var bin = atob(b64);
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          var dpr = window.devicePixelRatio || 1;
          var container = document.getElementById('container');
          var statusEl = document.getElementById('status');
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
          }).then(function () {
            post({ kind: 'rendered' });
          }).catch(function (err) {
            post({ kind: 'error', code: 'RENDER_THROW', detail: String((err && err.message) || err) });
          });
        } catch (err) {
          post({ kind: 'error', code: 'RENDER_THROW', detail: String((err && err.message) || err) });
        }
      };
      // Parser-blocking <script src> above has already finished (success
      // or onerror) by the time this inline script runs. If pdfjsLib is
      // defined, the library is good to go — tell RN to inject the bytes.
      if (typeof pdfjsLib !== 'undefined') {
        post({ kind: 'library-loaded' });
      } else {
        post({ kind: 'error', code: 'PDFJS_LOAD_FAIL', detail: 'pdfjsLib undefined after script tag (cdnjs unreachable or blocked)' });
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
        if (__DEV__) console.log('[venue-map] fetch start:', remoteMapUrl);
        const base64 = await downloadPdfAsBase64(remoteMapUrl);
        if (!base64) throw new Error('E_EMPTY_BASE64');
        if (cancelled) return;
        PDF_BASE64_CACHE.set(remoteMapUrl, base64);
        setPdfBase64(base64);
      } catch (err) {
        if (cancelled) return;
        if (__DEV__) {
          const e = err as { name?: string; message?: string; stack?: string };
          console.log(
            '[venue-map] error:',
            e?.name,
            e?.message,
            e?.stack,
          );
        }
        console.warn('[VenueMapScreen] PDF fetch failed:', err);
        // Surface a short code (E_FETCH_HTTP_404, E_XHR_TIMEOUT, etc.)
        // in the user-visible error UI so we can diagnose without logs.
        const msg = err instanceof Error ? err.message : String(err);
        setPdfFetchError(msg || 'E_UNKNOWN');
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
  const pdfFetchFailed = remoteIsPdf && !!pdfFetchError && !pdfBase64;

  // --- WebView PDF render state machine -----------------------------
  // The scaffold HTML posts messages back at each pipeline step:
  //   init          → WebView mounted, scaffold not yet loaded
  //   library-loaded → PDF.js loaded inside the WebView; ready for bytes
  //   rendered      → all pages painted
  //   error         → with a granular code (PDFJS_LOAD_FAIL,
  //                   RENDER_THROW, INJECT_THROW, WEBVIEW_HTTP_*,
  //                   WEBVIEW_NETWORK) and a human-readable detail.
  // Splitting library-loaded from rendered lets us know exactly which
  // step broke instead of the previous catch-all "PDF viewer failed".
  type PdfWebViewState =
    | { kind: 'init' }
    | { kind: 'library-loaded' }
    | { kind: 'rendered' }
    | { kind: 'error'; code: string; detail: string };
  const [pdfWebViewState, setPdfWebViewState] = useState<PdfWebViewState>({
    kind: 'init',
  });
  const webViewRef = useRef<WebView>(null);

  // Reset the WebView state machine whenever the URL changes, so a
  // fresh WebView (`key={remoteMapUrl}`) starts from `init` and the
  // injection effect waits for the new scaffold's `library-loaded`.
  useEffect(() => {
    setPdfWebViewState({ kind: 'init' });
  }, [remoteMapUrl]);

  // Inject the PDF bytes once both sides are ready: the base64 has been
  // downloaded in RN AND the WebView scaffold has loaded PDF.js. If
  // either prerequisite isn't met yet, we wait — the effect will re-run
  // when state changes. The injected snippet calls `window.__loadPdf`
  // and posts an INJECT_THROW error if anything goes wrong on the JS
  // bridge itself (the scaffold posts RENDER_THROW for PDF.js errors).
  useEffect(() => {
    if (!pdfBase64) return;
    if (pdfWebViewState.kind !== 'library-loaded') return;
    const js = `
      (function () {
        try {
          if (typeof window.__loadPdf !== 'function') {
            window.ReactNativeWebView.postMessage(JSON.stringify({ kind: 'error', code: 'INJECT_THROW', detail: 'window.__loadPdf missing' }));
            return;
          }
          window.__loadPdf(${JSON.stringify(pdfBase64)});
        } catch (e) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ kind: 'error', code: 'INJECT_THROW', detail: String((e && e.message) || e) }));
        }
      })();
      true;
    `;
    webViewRef.current?.injectJavaScript(js);
  }, [pdfBase64, pdfWebViewState]);

  // Parse JSON messages from the scaffold and drive the state machine.
  // Anything that isn't valid JSON or doesn't match a known `kind` is
  // ignored — the WebView may also receive messages from other sources
  // we don't control (extensions, dev-tools probes, etc.).
  const onPdfWebViewMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        kind?: string;
        code?: string;
        detail?: string;
      };
      if (data.kind === 'library-loaded') {
        setPdfWebViewState({ kind: 'library-loaded' });
      } else if (data.kind === 'rendered') {
        setPdfWebViewState({ kind: 'rendered' });
      } else if (data.kind === 'error') {
        setPdfWebViewState({
          kind: 'error',
          code: data.code ?? 'UNKNOWN',
          detail: data.detail ?? '',
        });
      }
    } catch {
      // Non-JSON message — ignore.
    }
  }, []);

  const pdfWebViewError =
    pdfWebViewState.kind === 'error' ? pdfWebViewState : null;
  const pdfWebViewRendered = pdfWebViewState.kind === 'rendered';
  const pdfWebViewRendering =
    remoteIsPdf && pdfReady && !pdfWebViewRendered && !pdfWebViewError;
  const pdfFailed = pdfFetchFailed || !!pdfWebViewError;

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
      pdfWebViewState,
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
    pdfWebViewState,
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
        {/* Loading state — shown while WebView loads, while discovering,
            while downloading a PDF (PDFs are fetched in RN to avoid CORS,
            then handed to PDF.js as base64), or while the WebView's
            PDF.js renders the canvases. */}
        {(loading && hasAnyMap && !pdfFailed && !remoteIsPdf) ||
        stillSearching ||
        pdfDownloading ||
        pdfWebViewRendering ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>
              {stillSearching
                ? 'Searching for venue map...'
                : pdfDownloading
                ? 'Downloading PDF...'
                : pdfWebViewRendering &&
                  pdfWebViewState.kind === 'library-loaded'
                ? 'Rendering PDF...'
                : pdfWebViewRendering
                ? 'Loading PDF viewer...'
                : 'Loading venue map...'}
            </Text>
          </View>
        ) : null}

        {error || pdfFailed ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>
              {pdfWebViewError
                ? `PDF viewer error (${pdfWebViewError.code}): ${pdfWebViewError.detail}\nURL: ${remoteMapUrl ? truncateUrlForDisplay(remoteMapUrl) : '(unknown)'}\nTap below to open it in your browser.`
                : pdfFetchFailed
                ? `Couldn't load the venue map PDF (error: ${pdfFetchError ?? 'E_UNKNOWN'}).\nURL: ${remoteMapUrl ? truncateUrlForDisplay(remoteMapUrl) : '(unknown)'}\nTap below to open it in your browser.`
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
          /* PDF — load a tiny scaffold HTML, then deliver the PDF bytes
             via `injectJavaScript` (postMessage flow). Embedding ~3.5 MB
             of base64 directly in `source.html` is unreliable on Android
             WebView, so we keep the HTML small and ship the data over
             the JS bridge. The scaffold posts back state-machine events
             so we can surface granular error codes. baseUrl is cdnjs so
             the PDF.js worker is same-origin to the document. */
          <WebView
            key={remoteMapUrl}
            ref={webViewRef}
            source={{
              html: buildPdfScaffoldHtml(highlightCourt),
              baseUrl: 'https://cdnjs.cloudflare.com/',
            }}
            style={styles.webview}
            scalesPageToFit={true}
            bounces={false}
            scrollEnabled={true}
            javaScriptEnabled={true}
            onMessage={onPdfWebViewMessage}
            onError={(e) =>
              setPdfWebViewState({
                kind: 'error',
                code: 'WEBVIEW_NETWORK',
                detail:
                  e?.nativeEvent?.description ??
                  'WebView failed to load scaffold',
              })
            }
            onHttpError={(e) =>
              setPdfWebViewState({
                kind: 'error',
                code: `WEBVIEW_HTTP_${e?.nativeEvent?.statusCode ?? 'UNKNOWN'}`,
                detail: e?.nativeEvent?.description ?? '',
              })
            }
            originWhitelist={['*']}
            allowsInlineMediaPlayback={true}
            setBuiltInZoomControls={true}
            setDisplayZoomControls={false}
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
