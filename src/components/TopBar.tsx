// ── TopBar (active-team pill + search icon) ──────────────────────────────
//
// Floats above all screens, aligned to the LEFT of the safe-area top
// (mirror of HamburgerMenu, which floats on the right). Two pieces:
//
//   - Active-team pill: visible whenever the user has an activeTeamId and
//     the current screen is a "team context" screen. Tapping opens a
//     lightweight team-switcher modal — same UX as the hamburger's "SWITCH
//     TEAM" section but reachable in one tap.
//
//   - Search icon: visible only on MyHome. Tapping opens GlobalSearch.
//
// The component reads from `useTheme()` so light/dark both look right and
// flips its glyphs to white over dark headers (`light` prop, same pattern
// as HamburgerMenu).
// ────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native';
import {
  spacing,
  fontSize,
  borderRadius,
  useTheme,
} from '../utils/theme';
import type { UserProfile, TeamProfile } from '../types/profile';
import {
  getActiveTeam,
  sortedTeamsForDisplay,
} from '../utils/activeTeamProfile';

interface Props {
  userProfile: UserProfile | null;
  /** Tap a team in the switcher → caller swaps active team (and may navigate). */
  onSwitchTeam: (teamId: string) => void;
  /** Search icon tap. Caller routes to GlobalSearch. */
  onOpenSearch: () => void;
  /** True if the active-team pill should be visible on the current screen. */
  showActiveTeamPill: boolean;
  /** True if the search icon should be visible (MyHome only). */
  showSearch: boolean;
  /** True over screens with dark headers — swap to white glyphs. */
  light?: boolean;
}

export function TopBar({
  userProfile,
  onSwitchTeam,
  onOpenSearch,
  showActiveTeamPill,
  showSearch,
  light = false,
}: Props) {
  const theme = useTheme();
  const [switcherVisible, setSwitcherVisible] = useState(false);

  const active = userProfile ? getActiveTeam(userProfile) : null;
  const showPill = showActiveTeamPill && !!active;

  // Nothing to render — keep the overlay container empty so it stays
  // pointer-transparent.
  if (!showPill && !showSearch) return null;

  const pillBg = light ? 'rgba(255,255,255,0.18)' : theme.colors.primaryLight;
  const pillBorder = light ? 'rgba(255,255,255,0.32)' : theme.colors.primary;
  const pillText = light ? '#ffffff' : theme.colors.primary;
  const iconColor = light ? '#ffffff' : theme.colors.text;

  return (
    <View style={styles.row} pointerEvents="box-none">
      {showPill && active && (
        <TouchableOpacity
          onPress={() => setSwitcherVisible(true)}
          activeOpacity={0.7}
          style={[
            styles.pill,
            { backgroundColor: pillBg, borderColor: pillBorder },
          ]}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={[styles.pillIcon, { color: pillText }]}>{'\u{1F3D0}'}</Text>
          <Text
            style={[styles.pillLabel, { color: pillText }]}
            numberOfLines={1}
          >
            {active.label}
          </Text>
          <Text style={[styles.pillChevron, { color: pillText }]}>{'▾'}</Text>
        </TouchableOpacity>
      )}

      {showSearch && (
        <TouchableOpacity
          onPress={onOpenSearch}
          activeOpacity={0.7}
          style={styles.searchBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={[styles.searchIcon, { color: iconColor }]}>{'\u{1F50D}'}</Text>
        </TouchableOpacity>
      )}

      {/* ── Team-switcher modal (mirrors HamburgerMenu's switcher list) ── */}
      <Modal
        visible={switcherVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSwitcherVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setSwitcherVisible(false)}
        >
          <Pressable
            style={[styles.switcherPanel, { backgroundColor: theme.colors.surface }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View
              style={[
                styles.switcherHeader,
                { borderBottomColor: theme.colors.divider },
              ]}
            >
              <Text style={[styles.switcherTitle, { color: theme.colors.text }]}>
                Switch team
              </Text>
              <TouchableOpacity
                onPress={() => setSwitcherVisible(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.switcherClose, { color: theme.colors.textLight }]}>
                  X
                </Text>
              </TouchableOpacity>
            </View>
            <ScrollView bounces={false}>
              {userProfile?.teams.length ? (
                sortedTeamsForDisplay(userProfile).map((team) => (
                  <TeamRow
                    key={team.id}
                    team={team}
                    isActive={team.id === userProfile.activeTeamId}
                    onPress={() => {
                      setSwitcherVisible(false);
                      onSwitchTeam(team.id);
                    }}
                  />
                ))
              ) : (
                <Text
                  style={[
                    styles.switcherEmpty,
                    { color: theme.colors.textSecondary },
                  ]}
                >
                  No teams yet — add one from My Home.
                </Text>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function TeamRow({
  team,
  isActive,
  onPress,
}: {
  team: TeamProfile;
  isActive: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const sourceLabel =
    team.source === 'mrs-linked'
      ? 'OVA'
      : team.source === 'mixed'
      ? 'AES+TIMU'
      : team.source.toUpperCase();
  const sourceColor =
    team.source === 'timu' || team.source === 'mixed'
      ? theme.colors.accent
      : theme.colors.primary;
  return (
    <TouchableOpacity
      style={[
        styles.teamRow,
        { borderBottomColor: theme.colors.divider },
        isActive && { backgroundColor: theme.colors.primaryLight },
      ]}
      onPress={onPress}
      disabled={isActive}
      activeOpacity={0.7}
    >
      <View style={[styles.teamBadge, { backgroundColor: sourceColor }]}>
        <Text style={styles.teamBadgeText}>{sourceLabel}</Text>
      </View>
      <View style={styles.teamLabelCol}>
        <Text
          style={[
            styles.teamLabel,
            {
              color: isActive ? theme.colors.primary : theme.colors.text,
            },
          ]}
          numberOfLines={1}
        >
          {team.label}
        </Text>
        <Text
          style={[styles.teamMeta, { color: theme.colors.textSecondary }]}
          numberOfLines={1}
        >
          {team.kind === 'watching' ? 'Watching' : 'Me'}
          {team.seasonLabel ? ` · ${team.seasonLabel}` : ''}
          {team.club ? ` · ${team.club}` : ''}
        </Text>
      </View>
      {isActive && (
        <View
          style={[styles.activeDot, { backgroundColor: theme.colors.primary }]}
        />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    maxWidth: 220,
  },
  pillIcon: { fontSize: 14, marginRight: 4 },
  pillLabel: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    flexShrink: 1,
  },
  pillChevron: { fontSize: 10, marginLeft: 4 },
  searchBtn: {
    padding: spacing.xs,
  },
  searchIcon: {
    fontSize: 18,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-start',
  },
  switcherPanel: {
    marginTop: 60,
    marginHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    maxHeight: '70%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 10,
  },
  switcherHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
  },
  switcherTitle: { fontSize: fontSize.xl, fontWeight: '700' },
  switcherClose: { fontSize: fontSize.xl, fontWeight: '600' },
  switcherEmpty: {
    padding: spacing.lg,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
  },
  teamBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    minWidth: 36,
    alignItems: 'center',
  },
  teamBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  teamLabelCol: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  teamLabel: { fontSize: fontSize.md, fontWeight: '600' },
  teamMeta: { fontSize: fontSize.xs, marginTop: 1 },
  activeDot: { width: 8, height: 8, borderRadius: 4 },
});
