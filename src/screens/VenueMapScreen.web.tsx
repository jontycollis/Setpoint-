// ── VenueMapScreen — web stub ──────────────────────────────────────────────
//
// The real VenueMapScreen depends on react-native-pdf, which is a native-only
// module (Fabric component import chain blows up Metro's web bundler with
// "Importing react-native internals is not supported on web").
//
// Web builds aren't a real target for this app — they exist only to debug
// the React state machine in a normal browser. The venue map screen isn't
// part of what we debug, so this stub keeps the bundle compiling without
// dragging the PDF/WebView render paths into the web build.
//
// Metro automatically picks `.web.tsx` over `.tsx` for the web target, so
// importers of `./VenueMapScreen` see this file on web and the original on
// iOS/Android.
// ──────────────────────────────────────────────────────────────────────────

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
  onBack: () => void;
  venueMapUrl?: string;
  infoPageUrl?: string;
  highlightCourt?: string;
  matchInfo?: {
    opponentName: string;
    time: string;
  };
}

export function VenueMapScreen({ onBack }: Props) {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Venue map (web stub)</Text>
      <Text style={styles.body}>
        The venue map renderer uses native PDF/WebView modules that aren&apos;t
        available on web. Run on iOS or Android to see the real map.
      </Text>
      <TouchableOpacity onPress={onBack} style={styles.button}>
        <Text style={styles.buttonLabel}>Back</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  body: {
    fontSize: 14,
    color: '#444',
    textAlign: 'center',
    maxWidth: 320,
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#1a73e8',
    borderRadius: 8,
  },
  buttonLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
