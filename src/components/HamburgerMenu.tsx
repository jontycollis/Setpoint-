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
import { colors, spacing, fontSize, borderRadius, useTheme } from '../utils/theme';
import type { FavoriteTeam } from '../types/aes';

export type MenuDestination =
  | 'Home'
  | 'MyTeams'
  | 'TeamDashboard'
  | 'TeamSearch'
  | 'Standings'
  | 'Brackets'
  | 'CourtSchedule'
  | 'LiveScoreboard'
  | 'ClubView'
  | 'TournamentHistory'
  | 'TeamNotes'
  | 'VenueMap';

interface Props {
  onNavigate: (destination: MenuDestination) => void;
  onNavigateToFavorite: (fav: FavoriteTeam) => void;
  onRemoveFavorite: (fav: FavoriteTeam) => void;
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
  // My Team (persistent)
  myTeam: FavoriteTeam | null;
  // Favorites
  favoriteTeams: FavoriteTeam[];
  currentTeamId?: number;
  currentEventKey?: string;
}

export function HamburgerMenu({
  onNavigate,
  onNavigateToFavorite,
  onRemoveFavorite,
  hasEvent,
  hasDivision,
  hasTeam,
  currentScreen,
  light = false,
  eventName,
  divisionName,
  divisionColor,
  teamName,
  myTeam,
  favoriteTeams,
  currentTeamId,
  currentEventKey,
}: Props) {
  const [visible, setVisible] = useState(false);
  const theme = useTheme();

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

  return (
    <View>
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

      {/* Menu Modal — rendered inside this View but Modal is portaled to root by RN */}
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

                {/* Team Tracker — unified dashboard for all tracked teams */}
                <MenuRow
                  icon={'\u{1F465}'}
                  label="Team Tracker"
                  subtitle={(() => {
                    // Dedupe: myTeam may also be in favorites
                    const myTeamInFavs = myTeam && favoriteTeams.some(
                      (f) => f.teamId === myTeam.teamId && f.eventKey === myTeam.eventKey
                    );
                    const count = favoriteTeams.length + (myTeam && !myTeamInFavs ? 1 : 0);
                    return count > 0
                      ? `${count} team${count !== 1 ? 's' : ''}`
                      : undefined;
                  })()}
                  available={!!myTeam || favoriteTeams.length > 0}
                  isCurrent={isCurrentScreen('MyTeams')}
                  onPress={() => handleSelect('MyTeams')}
                  lockedHint="Star or set a team first"
                />

                {/* My Team — uses persistent myTeam, navigates like a favorite */}
                <MenuRow
                  icon={'\u{1F3D0}'}
                  label="My Team"
                  subtitle={myTeam ? (myTeam.teamText || myTeam.teamName) : undefined}
                  available={!!myTeam}
                  isCurrent={
                    !!myTeam &&
                    currentTeamId === myTeam.teamId &&
                    currentEventKey === myTeam.eventKey &&
                    isCurrentScreen('TeamDashboard')
                  }
                  onPress={() => {
                    if (myTeam) {
                      // If already viewing this team, just close menu
                      if (
                        currentTeamId === myTeam.teamId &&
                        currentEventKey === myTeam.eventKey &&
                        isCurrentScreen('TeamDashboard')
                      ) {
                        setVisible(false);
                        return;
                      }
                      handleFavoriteSelect(myTeam);
                    }
                  }}
                  lockedHint="Set a team as My Team"
                />

                {/* Search Teams — available when inside a tournament */}
                <MenuRow
                  icon={'\u{1F50D}'}
                  label="Search Teams"
                  subtitle={hasDivision ? `In ${divisionName}` : hasEvent ? 'Across the event' : undefined}
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

                {/* Live Scoreboard */}
                <MenuRow
                  icon={'\u{1F4E1}'}
                  label="Live Scoreboard"
                  subtitle={divisionName || undefined}
                  available={hasDivision}
                  isCurrent={isCurrentScreen('LiveScoreboard')}
                  onPress={() => handleSelect('LiveScoreboard')}
                  lockedHint="Select division first"
                />

                {/* Club View */}
                <MenuRow
                  icon={'\u{1F3E2}'}
                  label="Club View"
                  available={hasEvent}
                  isCurrent={isCurrentScreen('ClubView')}
                  onPress={() => handleSelect('ClubView')}
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

                {/* Tournament History */}
                <MenuRow
                  icon={'\u{1F4CA}'}
                  label="Season History"
                  available={true}
                  isCurrent={isCurrentScreen('TournamentHistory')}
                  onPress={() => handleSelect('TournamentHistory')}
                />

                {/* Team Notes */}
                <MenuRow
                  icon={'\u{1F4DD}'}
                  label="Team Notes"
                  available={hasTeam}
                  isCurrent={isCurrentScreen('TeamNotes')}
                  onPress={() => handleSelect('TeamNotes')}
                  lockedHint="Select a team first"
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

              {/* Settings */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>SETTINGS</Text>
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => theme.toggle()}
                  activeOpacity={0.7}
                >
                  <Text style={styles.menuIcon}>
                    {theme.mode === 'dark' ? '\u{2600}' : '\u{1F319}'}
                  </Text>
                  <View style={styles.menuLabelCol}>
                    <Text style={styles.menuLabel}>
                      {theme.mode === 'dark' ? 'Light Mode' : 'Dark Mode'}
                    </Text>
                  </View>
                </TouchableOpacity>
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
                    return (
                      <View
                        key={`${fav.eventKey}-${fav.teamId}`}
                        style={[
                          styles.favoriteItem,
                          isCurrent && styles.favoriteItemCurrent,
                        ]}
                      >
                        <TouchableOpacity
                          style={styles.favoriteMainArea}
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
                              {fav.teamText || fav.teamName}
                            </Text>
                            <Text style={styles.favoriteMeta} numberOfLines={1}>
                              {fav.divisionName} — {fav.eventName}
                            </Text>
                          </View>
                          {isCurrent && <View style={styles.currentDot} />}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.removeFavButton}
                          onPress={() => {
                            onRemoveFavorite(fav);
                            // Don't close the menu — let user remove multiple
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={styles.removeFavText}>{'\u2715'}</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              )}

              <View style={{ height: spacing.xl }} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
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
  favoriteInfo: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  favoriteName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
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
  favoriteMainArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  removeFavButton: {
    padding: spacing.xs,
    marginLeft: spacing.sm,
  },
  removeFavText: {
    fontSize: 14,
    color: colors.textLight,
    fontWeight: '600',
  },
});
