// ── HelpButton ────────────────────────────────────────────────────────────
//
// Tiny "?" pill rendered inside screen headers. Tapping it pushes the
// HelpScreen with the given sectionId pre-expanded. Caller is responsible
// for the actual navigation — this component just emits the intent.
//
// Two visual modes:
//   • Default — dark background pill (over light headers).
//   • light={true} — translucent-on-dark pill (over the coloured hero).
// ────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useTheme, fontSize } from '../utils/theme';
import type { HelpSectionId } from '../help/content';

interface Props {
  /** Section to deep-link to. Use ids from HELP_SECTION_IDS. */
  sectionId: HelpSectionId | string;
  /** Called when the button is tapped; pass through to onNavigate('Help', sectionId). */
  onPress: (sectionId: string) => void;
  /** When true, renders translucent-on-dark for a coloured hero. */
  light?: boolean;
  /** Override the accessibility label. Defaults to "Help for this screen". */
  accessibilityLabel?: string;
}

export function HelpButton({
  sectionId,
  onPress,
  light = false,
  accessibilityLabel = 'Help for this screen',
}: Props) {
  const { colors } = useTheme();
  const bg = light ? 'rgba(255,255,255,0.18)' : colors.primaryLight;
  const border = light ? 'rgba(255,255,255,0.32)' : colors.primary;
  const fg = light ? '#ffffff' : colors.primary;
  return (
    <TouchableOpacity
      onPress={() => onPress(sectionId)}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.btn,
        { backgroundColor: bg, borderColor: border },
      ]}
    >
      <Text style={[styles.qMark, { color: fg }]}>{'?'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qMark: {
    fontSize: fontSize.md,
    fontWeight: '800',
    lineHeight: fontSize.md + 4,
  },
});
