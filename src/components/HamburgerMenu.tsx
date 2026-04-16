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
import { colors, spacing, fontSize, borderRadius } from '../utils/theme';
import type { FavoriteTeam } from '../types/aes';

export type MenuDestination =
  | 'Home'
  | 'TeamDashboard'
  | 'TeamSearch'
  | 'Standings'
  | 'Brackets'
  | 'CourtSchedule'
  | 'VenueMap';

interface Props {
  onNavigate: (destination: MenuDestination) => void;
  onNavigateToFavorite: (fav: FavoriteTeam) => void;
  onSetDefaultTeam: () => void;
  onClearDefaultTeam: () => void;
  hasEvent: boolean;
  hasDivision: boolean;
  hasTeam: boolean;
  currentScreen?: string;
  light?: boolean;
  // Context info
  eventName?: string;
  divisionName?: string;
  divisionColor?: string;
  teamName?: string;
  // Favorites
  defaultTeam: FavoriteTeam | null;
  favoriteTeams: FavoriteTeam[];
  currentTeamId?: number;
  currentEventKey?: string;
}

export function HamburgerMenu({
  onNavigate,
  onNavigateToFavorite,
  onSetDefaultTeam,
  onClearDefaultTeam,
  hasEvent,
  hasDivision,
  hasTeam,
  currentScreen,
  light = false,
  eventName,
  divisionName,
  divisionColor,
  teamName,
  defaultTeam,
  favoriteTeams,
  currentTeamId,
  currentEventKey,
}: Props) {
  const [visible, setVisible] = useState(false);

  function handleSelect(dest: MenuDestination) {
    setVisible(false);
    onNavigate(dest);
  }

  function handleFavoriteSelect(fav: FavoriteTeam) {
    setVisible(false);
    onNavigateToFavorite(fav);
  }

  function isCurrentScreen(key: string): boolean {
    if (!currentScreen) return false;
    if (key === 'Home' && currentScreen === 'EventEntry') return true;
    return key === currentScreen;
  }

  const isDefaultTeamCurrent =
    defaultTeam &&
    currentTeamId === defaultTeam.teamId &&
    currentEventKey === defaultTeam.eventKey;

  // Whether we can show the "Set as Default" button
  const canSetDefault =
    hasTeam &&
    currentTeamId != null &&
    (!defaultTeam ||
      defaultTeam.teamId !== currentTeamId ||
      defaultTeam.eventKey !== currentEventKey);

  return (
    <>
      {/* Hamburger Button */}
      <TouchableOpacity
        style={styles.hamburgerButton}
        onPress={() => setVisible(true)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <View style={styles.hamburgerLines}>
          <View
            style={[styles.hamburgerLine, light && styles.hamburgerLineLight]}
          />
          <View
            style={[styles.hamburgerLine, light && styles.hamburgerLineLight]}
          />
          <View
            style={[styles.hamburgerLine, light && styles.hamburgerLineLight]}
          />
        </View>
      </TouchableOpacity>

      {/* Menu Modal */}
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setVisible(false)}>
          <Pressable
            style={styles.menuPanel}
            onPress={(e) => e.stopPropagation()}
          >
            <ScrollView bounces={false}>
              {/* Menu Header */}
              <View style={styles.menuHeader}>
                <Text style={styles.menuTitle}>Menu</Text>
                <TouchableOpacity
                  onPress={() => setVisible(false)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.closeButton}>X</Text>
                </TouchableOpacity>
              </View>

              {/* Current Context Banner */}
              {hasEvent && (
                <View style={styles.contextBanner}>
                  {eventName && (
                    <Text style={styles.contextEvent} numberOfLines={1}>
                      {eventName}
                    </Text>
                  )}
                  {divisionName && (
                    <View style={styles.contextDivRow}>
                      <View
                        style={[
                          styles.contextDivDot,
                          { backgroundColor: divisionColor || colors.primary },
                        ]}
                      />
                      <Text style={styles.contextDivision} numberOfLines={1}>
                        {divisionName}
                      </Text>
                    </View>
                  )}
                  {teamName && (
                    <Text style={styles.contextTeam} numberOfLines={1}>
                      {teamName}
                    </Text>
                  )}
                </View>
              )}

              {/* Default Team Quick Access */}
              {defaultTeam && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>DEFAULT TEAM</Text>
                  <TouchableOpacity
                    style={[
                      styles.favoriteItem,
                      styles.defaultTeamItem,
                      isDefaultTeamCurrent && styles.favoriteItemCurrent,
                    ]}
                    onPress={() => handleFavoriteSelect(defaultTeam)}
                    disabled={!!isDefaultTeamCurrent}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.defaultStar}>{'\u2605'}</Text>
                    <View style={styles.favoriteInfo}>
                      <Text
                        style={[
                          styles.favoriteName,
                          styles.defaultTeamName,
                          isDefaultTeamCurrent && styles.favoriteNameCurrent,
                        ]}
                        numberOfLines={1}
                      >
                        {defaultTeam.teamText || defaultTeam.teamName}
                      </Text>
                      <Text style={styles.favoriteMeta} numberOfLines={1}>
                        {defaultTeam.divisionName} — {defaultTeam.eventName}
                      </Text>
                    </View>
                    {isDefaultTeamCurrent && (
                      <View style={styles.currentDot} />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.clearDefaultButton}
                    onPress={() => {
                      onClearDefaultTeam();
                    }}
                  >
                    <Text style={styles.clearDefaultText}>
                      Clear default
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Navigation Items */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>NAVIGATE</Text>

                {/* Home */}
                <MenuRow
                  icon={'\u{1F3E0}'}
                  label="Home"
                  available={true}
                  isCurrent={isCurrentScreen('Home')}
                  onPress={() => handleSelect('Home')}
                />

                {/* My Team */}
                <MenuRow
                  icon={'\u{1F3D0}'}
                  label={teamName ? `My Team` : 'My Team'}
                  subtitle={teamName || undefined}
                  available={hasTeam}
                  isCurrent={isCurrentScreen('TeamDashboard')}
                  onPress={() => handleSelect('TeamDashboard')}
                  lockedHint="Select team first"
                />

                {/* Search Teams */}
                <MenuRow
                  icon={'\u{1F50D}'}
                  label="Search Teams"
                  subtitle="Across all divisions"
                  available={hasEvent}
                  isCurrent={isCurrentScreen('TeamSearch')}
                  onPress={() => handleSelect('TeamSearch')}
                  lockedHint="Select event first"
                />

                {/* Court Schedule */}
                <MenuRow
                  icon={'\u{1F4CB}'}
                  label="Court Schedule"
                  available={hasEvent}
                  isCurrent={isCurrentScreen('CourtSchedule')}
                  onPress={() => handleSelect('CourtSchedule')}
                  lockedHint="Select event first"
                />

                {/* Standings */}
                <MenuRow
                  icon={'\u{1F3C6}'}
                  label="Standings"
                  subtitle={divisionName || undefined}
                  available={hasDivision}
                  isCurrent={isCurrentScreen('Standings')}
                  onPress={() => handleSelect('Standings')}
                  lockedHint="Select division first"
                />

                {/* Playoff Brackets */}
                <MenuRow
                  icon={'\u{1F3C5}'}
                  label="Playoff Brackets"
                  subtitle={divisionName || undefined}
                  available={hasDivision}
                  isCurrent={isCurrentScreen('Brackets')}
                  onPress={() => handleSelect('Brackets')}
                  lockedHint="Select division first"
                />

                {/* Venue Map */}
                <MenuRow
                  icon={'\u{1F5FA}'}
                  label="Venue Map"
                  available={true}
                  isCurrent={isCurrentScreen('VenueMap')}
                  onPress={() => handleSelect('VenueMap')}
                />
              </View>

              {/* Favorite Teams */}
              {favoriteTeams.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>FAVORITE TEAMS</Text>
                  {favoriteTeams.map((fav) => {
                    const isCurrent =
                      currentTeamId === fav.teamId &&
                      currentEventKey === fav.eventKey &&
                      currentScreen === 'TeamDashboard';
                    const isDefault =
                      defaultTeam?.teamId === fav.teamId &&
                      defaultTeam?.eventKey === fav.eventKey;
                    return (
                      <TouchableOpacity
                        key={`${fav.eventKey}-${fav.teamId}`}
                        style={[
                          styles.favoriteItem,
                          isCurrent && styles.favoriteItemCurrent,
                        ]}
                        onPress={() => handleFavoriteSelect(fav)}
                        disabled={isCurrent}
                        activeOpacity={0.7}
                      >
                        <View
                          style={[
                            styles.favDivDot,
                            {
                              backgroundColor:
                                fav.divisionColorHex || colors.primary,
                            },
                          ]}
                        />
                        <View style={styles.favoriteInfo}>
                          <Text
                            style={[
                              styles.favoriteName,
                              isCurrent && styles.favoriteNameCurrent,
                            ]}
                            numberOfLines={1}
                          >
                            {isDefault ? '\u2605 ' : ''}
                            {fav.teamText || fav.teamName}
                          </Text>
                          <Text style={styles.favoriteMeta} numberOfLines={1}>
                            {fav.divisionName}
                          </Text>
                        </View>
                        {isCurrent && <View style={styles.currentDot} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Set as Default / Add Favorite actions */}
              {hasTeam && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>ACTIONS</Text>
                  {canSetDefault && (
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => {
                        onSetDefaultTeam();
                        setVisible(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.actionIcon}>{'\u2605'}</Text>
                      <Text style={styles.actionText}>
                        Set {teamName || 'current team'} as default
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              <View style={{ height: spacing.xl }} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// Sub-component for menu navigation rows
function MenuRow({
  icon,
  label,
  subtitle,
  available,
  isCurrent,
  onPress,
  lockedHint,
}: {
  icon: string;
  label: string;
  subtitle?: string;
  available: boolean;
  isCurrent: boolean;
  onPress: () => void;
  lockedHint?: string;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.menuItem,
        !available && styles.menuItemDisabled,
        isCurrent && styles.menuItemCurrent,
      ]}
      onPress={() => available && onPress()}
      disabled={!available || isCurrent}
      activeOpacity={0.7}
    >
      <Text style={styles.menuIcon}>{icon}</Text>
      <View style={styles.menuLabelCol}>
        <Text
          style={[
            styles.menuLabel,
            !available && styles.menuLabelDisabled,
            isCurrent && styles.menuLabelCurrent,
          ]}
        >
          {label}
        </Text>
        {subtitle && available && (
          <Text style={styles.menuSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {isCurrent && <View style={styles.currentDot} />}
      {!available && lockedHint && (
        <Text style={styles.lockedText}>{lockedHint}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  hamburgerButton: {
    padding: spacing.sm,
  },
  hamburgerLines: {
    width: 24,
    height: 18,
    justifyContent: 'space-between',
  },
  hamburgerLine: {
    width: 24,
    height: 3,
    backgroundColor: colors.text,
    borderRadius: 2,
  },
  hamburgerLineLight: {
    backgroundColor: '#ffffff',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-start',
  },
  menuPanel: {
    backgroundColor: colors.surface,
    marginTop: 0,
    marginRight: 60,
    borderBottomRightRadius: borderRadius.lg,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 10,
    maxHeight: '90%',
  },
  menuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    paddingTop: spacing.xxl,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  menuTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
  },
  closeButton: {
    fontSize: fontSize.xl,
    color: colors.textLight,
    fontWeight: '600',
    padding: spacing.xs,
  },
  // Context banner
  contextBanner: {
    backgroundColor: '#f0f4ff',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  contextEvent: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 2,
  },
  contextDivRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  contextDivDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  contextDivision: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  contextTeam: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  // Sections
  section: {
    paddingTop: spacing.md,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textLight,
    letterSpacing: 1,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },
  // Menu items
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  menuItemDisabled: {
    opacity: 0.4,
  },
  menuItemCurrent: {
    backgroundColor: colors.primaryLight,
  },
  menuIcon: {
    fontSize: 20,
    width: 32,
    textAlign: 'center',
  },
  menuLabelCol: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  menuLabel: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  menuSubtitle: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 1,
  },
  menuLabelDisabled: {
    color: colors.textLight,
  },
  menuLabelCurrent: {
    color: colors.primary,
  },
  currentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  lockedText: {
    fontSize: fontSize.xs,
    color: colors.textLight,
    fontStyle: 'italic',
  },
  // Favorites
  favoriteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  favoriteItemCurrent: {
    backgroundColor: colors.primaryLight,
  },
  defaultTeamItem: {
    backgroundColor: '#fffbf0',
    borderBottomColor: '#f0e6cc',
  },
  defaultStar: {
    fontSize: 20,
    color: '#f5a623',
    width: 32,
    textAlign: 'center',
  },
  favoriteInfo: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  favoriteName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  defaultTeamName: {
    fontWeight: '700',
  },
  favoriteNameCurrent: {
    color: colors.primary,
  },
  favoriteMeta: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 1,
  },
  favDivDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: 4,
  },
  clearDefaultButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    alignItems: 'flex-end',
  },
  clearDefaultText: {
    fontSize: fontSize.xs,
    color: colors.textLight,
    textDecorationLine: 'underline',
  },
  // Actions
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  actionIcon: {
    fontSize: 18,
    width: 32,
    textAlign: 'center',
    color: '#f5a623',
  },
  actionText: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.accent,
    marginLeft: spacing.sm,
  },
});
