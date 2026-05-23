// ── TeamAvatar ────────────────────────────────────────────────────────────
// Unique auto-generated avatar for a TeamProfile — hashed background color
// + 1-2 initials drawn from the team's display label. When the user picks
// a custom image for the team, render that image instead (still clipped
// to the same shape so the layout doesn't shift).
//
// The color hash + initials helpers live in `utils/teamAvatarTheme.ts` so
// they're exercisable under vitest's node environment.
// ──────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { ImageStyle, StyleProp, ViewStyle } from 'react-native';
import type { TeamProfile } from '../types/profile';
import {
  getColorForTeamSeed,
  getInitialsForTeamName,
} from '../utils/teamAvatarTheme';

interface Props {
  teamProfile: Pick<TeamProfile, 'id' | 'label'>;
  /** Outer width/height in px. Initials font scales with this. */
  size: number;
  /**
   * When set, render this local image URI instead of the initials block.
   * Use the same circular/rounded clip so the tile layout doesn't jump
   * between the two states.
   */
  customImageUri?: string;
  /**
   * Avatar shape. 'circle' for picker tiles; 'rounded' for inline list
   * rows where a square-ish chip reads better. Default 'circle'.
   */
  shape?: 'circle' | 'rounded';
  /** Optional style overrides for the outer container. */
  style?: StyleProp<ViewStyle>;
}

export function TeamAvatar({
  teamProfile,
  size,
  customImageUri,
  shape = 'circle',
  style,
}: Props) {
  const seed = teamProfile.id || teamProfile.label || 'team';
  const background = useMemo(() => getColorForTeamSeed(seed), [seed]);
  const initials = useMemo(
    () => getInitialsForTeamName(teamProfile.label),
    [teamProfile.label]
  );

  const radius = shape === 'circle' ? size / 2 : Math.max(8, size * 0.18);
  const containerStyle: ViewStyle = {
    width: size,
    height: size,
    borderRadius: radius,
    backgroundColor: background,
  };
  const imageStyle: ImageStyle = {
    width: size,
    height: size,
    borderRadius: radius,
  };

  if (customImageUri) {
    return (
      <View style={[styles.wrapper, containerStyle, style]}>
        <Image
          source={{ uri: customImageUri }}
          style={imageStyle}
          accessibilityIgnoresInvertColors
        />
      </View>
    );
  }

  // Initials font sized off the avatar diameter so a 32 px chip renders
  // legibly without per-call-site tuning.
  const fontSize = Math.max(11, Math.round(size * 0.42));
  return (
    <View
      style={[styles.wrapper, styles.center, containerStyle, style]}
      accessibilityLabel={`${teamProfile.label} avatar`}
    >
      <Text
        style={[styles.initials, { fontSize }]}
        numberOfLines={1}
        allowFontScaling={false}
      >
        {initials}
      </Text>
    </View>
  );
}

// Re-export the pure helpers so existing consumers of `TeamAvatar` can
// still pull initials / colors from a single import.
export { getColorForTeamSeed, getInitialsForTeamName } from '../utils/teamAvatarTheme';

const styles = StyleSheet.create({
  wrapper: {
    overflow: 'hidden',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: '#ffffff',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
