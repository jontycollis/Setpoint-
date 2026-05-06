import React, { useMemo } from 'react';
import { TouchableOpacity, Text, StyleSheet, Linking, Alert } from 'react-native';
import { useTheme, spacing, fontSize, borderRadius } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';

interface Props {
  videoLink: string;
  compact?: boolean;
}

// Only open URLs from trusted streaming domains
const ALLOWED_DOMAINS = [
  'pixellot.tv',
  'youtube.com',
  'youtu.be',
  'twitch.tv',
  'vimeo.com',
  'facebook.com',
  'fb.watch',
  'livestream.com',
  'advancedeventsystems.com',
];

function isTrustedStreamUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_DOMAINS.some(
      (domain) => host === domain || host.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

/**
 * A "Watch Live" button that opens the court's video stream link.
 * Only renders if videoLink is a non-empty, trusted URL.
 */
export function WatchLiveButton({ videoLink, compact = false }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!videoLink || videoLink.trim().length === 0) return null;
  if (!isTrustedStreamUrl(videoLink)) return null;

  const url = videoLink.startsWith('http') ? videoLink : `https://${videoLink}`;

  async function handlePress() {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Cannot open link', url);
      }
    } catch {
      Alert.alert('Error', 'Failed to open live stream link.');
    }
  }

  if (compact) {
    return (
      <TouchableOpacity onPress={handlePress} activeOpacity={0.7} style={styles.compactButton}>
        <Text style={styles.compactIcon}>{'\u{1F4F9}'}</Text>
        <Text style={styles.compactText}>Live</Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.7} style={styles.button}>
      <Text style={styles.icon}>{'\u{1F4F9}'}</Text>
      <Text style={styles.text}>Watch Live</Text>
    </TouchableOpacity>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e53935',
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  icon: {
    fontSize: 16,
    marginRight: spacing.xs,
  },
  text: {
    color: '#ffffff',
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  compactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e53935',
    borderRadius: borderRadius.sm,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
  },
  compactIcon: {
    fontSize: 12,
    marginRight: 3,
  },
  compactText: {
    color: '#ffffff',
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
});
}
