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

/**
 * Bundled venue map assets — keyed by the identifier after "bundled:" prefix.
 * Add new bundled maps here as they become available.
 */
const BUNDLED_VENUE_MAPS: Record<string, any> = {
  'nationals-2026-venue-map': require('../../assets/nationals-2026-venue-map.png'),
};

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

// Detect PDF URLs so we route them through Google Docs Viewer instead
// of a bare <img> tag. The Android system WebView won't render PDFs
// inline (it'd download them); Google Docs Viewer normalizes the
// behavior across iOS and Android and preserves pinch-to-zoom.
function isPdfUrl(url: string): boolean {
  return /\.pdf(\?|#|$)/i.test(url);
}

function buildMapHtml(url: string, highlightCourt?: string) {
  const courtBanner = highlightCourt
    ? `
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
      body { padding-top: 48px !important; }
    </style>
    `
    : '';

  // PDF branch — embed via Google Docs Viewer. The iframe takes 100%
  // of the WebView, the viewer itself provides pinch-zoom + pan
  // controls. Image branch keeps the existing <img> path so PNG
  // provincials maps continue to render the same as before.
  const content = isPdfUrl(url)
    ? `<iframe
         src="https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true"
         style="width: 100%; height: 100%; border: 0;"
         frameborder="0"
       ></iframe>`
    : `<img src="${url}" alt="Venue Map" />`;

  // PDF iframes need the html/body to fill the viewport; the <img>
  // path centers in a flex parent (legacy behavior).
  const layoutMode = isPdfUrl(url) ? 'pdf' : 'image';

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
      ${layoutMode === 'image' ? `
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: auto;
        -webkit-overflow-scrolling: touch;
      ` : `
        overflow: hidden;
      `}
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
  ${content}
</body>
</html>
`;
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
        const mapUrl = await getBestVenueMapUrl(infoPageUrl);
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
  }, [infoPageUrl]);

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
        {/* Loading state — shown while WebView loads or while discovering */}
        {(loading && hasAnyMap) || stillSearching ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>
              {stillSearching ? 'Searching for venue map...' : 'Loading venue map...'}
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>
              Unable to load the venue map. Please check your internet
              connection.
            </Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => {
                setError(false);
                setLoading(true);
              }}
            >
              <Text style={styles.retryText}>Tap to retry</Text>
            </TouchableOpacity>
            {infoPageUrl && (
              <TouchableOpacity
                style={styles.openWebButton}
                onPress={() => Linking.openURL(infoPageUrl)}
              >
                <Text style={styles.openWebText}>
                  View on competition website
                </Text>
              </TouchableOpacity>
            )}
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
        ) : remoteMapUrl ? (
          /* Remote URL — render in WebView with zoom */
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
        {infoPageUrl ? (
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
