// ── BottomTabBar ──────────────────────────────────────────────────────────
//
// Two-tab bottom bar: Home / Browse. Renders at the bottom of the viewport
// with `useSafeAreaInsets().bottom` clearance so it sits above Android
// gesture nav.
//
// Behaviour: a tab tap is a destination switch — the caller clears
// screenHistory and sets `screen` to one of the two home destinations.
// Tabs are highlighted only when the current screen IS that destination;
// when the user is "deep" inside a flow (TeamDashboard, Standings, etc.)
// no tab is highlighted but both remain reachable.
//
// The earlier Tools tab was removed: it was empty for default users and
// duplicated MyHome's Connections section. Score-a-Match, MRS, and CAC
// Locker live in the hamburger now; "Score a match" can also surface as
// a Right Now CTA on MyHome when the user is in scorer mode.
//
// Theme via useTheme() so light/dark both look right.
// ────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, fontSize, useTheme } from '../utils/theme';

export type TabKey = 'home' | 'browse';

export const BOTTOM_TAB_BAR_HEIGHT = 56;

interface Props {
  activeTab: TabKey | null;
  onSelect: (tab: TabKey) => void;
}

export function BottomTabBar({ activeTab, onSelect }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.divider,
          paddingBottom: insets.bottom,
          height: BOTTOM_TAB_BAR_HEIGHT + insets.bottom,
        },
      ]}
    >
      <Tab
        label="Home"
        icon={'\u{1F3E0}'}
        active={activeTab === 'home'}
        onPress={() => onSelect('home')}
      />
      <Tab
        label="Browse"
        icon={'\u{1F4C5}'}
        active={activeTab === 'browse'}
        onPress={() => onSelect('browse')}
      />
    </View>
  );
}

function Tab({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const tint = active ? theme.colors.primary : theme.colors.textSecondary;
  return (
    <TouchableOpacity
      style={styles.tab}
      onPress={onPress}
      activeOpacity={0.7}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    >
      <Text style={[styles.tabIcon, { color: tint }]}>{icon}</Text>
      <Text
        style={[
          styles.tabLabel,
          { color: tint, fontWeight: active ? '700' : '500' },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 6,
    zIndex: 90,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  tabIcon: { fontSize: 20 },
  tabLabel: {
    fontSize: fontSize.xs,
    marginTop: 2,
    letterSpacing: 0.3,
  },
});
