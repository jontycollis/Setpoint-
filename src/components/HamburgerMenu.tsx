import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native';
import { spacing, fontSize, borderRadius, useTheme } from '../utils/theme';
import type { ThemeColors } from '../utils/theme';
import type { FavoriteTeam } from '../types/aes';
import type { UserProfile, TeamProfile } from '../types/profile';
import { sortedTeamsForDisplay } from '../utils/activeTeamProfile';

export type MenuDestination =
  | 'Home'
  | 'MyHome'
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
  | 'VenueMap'
  | 'TimuTournament'
  | 'TimuTeamDashboard'
  | 'AddTournaments'
  | 'SeasonHistory'
  | 'OvaRankings'
  | 'AddTeamChooser'
  | 'MrsConnection'
  | 'CacConnection'
  | 'Scoreboard'
  | 'MatchList';

/**
 * The hamburger renders different items depending on whether the user is
 * on Home (MyHome / browse / OVA Rankings / connection screens) or
 * inside a team context (any team-bound screen). The split keeps each
 * mode focused on what's actually relevant.
 */
export type MenuContext = 'home' | 'team';

interface Props {
  onNavigate: (destination: MenuDestination) => void;
  onNavigateToFavorite: (fav: FavoriteTeam) => void;
  onRemoveFavorite: (fav: FavoriteTeam) => void;
  hasEvent: boolean;
  hasDivision: boolean;
  hasTeam: boolean;
  /**
   * True when the current screen is a Timu tournament/team view. The menu
   * hides AES-only nav (Standings, Brackets, etc.) and shows a "Tournament
   * Overview" shortcut to the Timu Pools/Schedule/Rankings screen.
   */
  onTimu?: boolean;
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
  // ── Phase 2/3: profile + team-switcher ───────────────────────────────
  /**
   * UserProfile drives the new "My Teams" section + team switcher.
   * Optional: when undefined, the menu renders without these new
   * sections (used during the initial render before the profile loads).
   */
  userProfile?: UserProfile | null;
  /**
   * Tap-to-switch on a team row in the new "My Teams" section. Caller is
   * responsible for setting the active team and (optionally) navigating
   * to its dashboard.
   */
  onSwitchTeam?: (teamId: string) => void;
  /** Tier 2: toggles the official-scorer flow on/off. When undefined,
   *  the toggle row hides entirely. */
  onToggleScorerMode?: (next: boolean) => void;
  // ── Phase 4: context-aware menu ───────────────────────────────────────
  /**
   * Which mode to render the menu in. Caller computes from screen +
   * active team. Defaults to 'home' if unspecified.
   */
  menuContext?: MenuContext;
}

export function HamburgerMenu({
  onNavigate,
  onNavigateToFavorite,
  onRemoveFavorite,
  hasEvent,
  hasDivision,
  hasTeam,
  onTimu = false,
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
  userProfile,
  onSwitchTeam,
  onToggleScorerMode,
  menuContext = 'home',
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

              {/* ── MY TEAMS — always visible when the user has a profile.
                  Combines the old standalone Home button, the legacy
                  separate "FAVORITE TEAMS" section, and the cross-context
                  team switcher into a single grouping of "everything that
                  belongs to me". */}
              {userProfile && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>MY TEAMS</Text>

                  {/* My Home — first entry in MY so it's always reachable
                      from any screen, even team-context screens. */}
                  <MenuRow
                    icon={'\u{1F3E0}'}
                    label="My Home"
                    available={true}
                    isCurrent={isCurrentScreen('MyHome')}
                    onPress={() => handleSelect('MyHome')}
                  />

                  {/* Tracked teams — tap any to switch active team and
                      open its Season History. */}
                  {sortedTeamsForDisplay(userProfile).map((team) => (
                    <TeamSwitcherRow
                      key={team.id}
                      team={team}
                      isActive={team.id === userProfile.activeTeamId}
                      onPress={() => {
                        if (!onSwitchTeam) return;
                        setVisible(false);
                        onSwitchTeam(team.id);
                      }}
                    />
                  ))}

                  {/* + Add team CTA — always at the bottom of the list. */}
                  <MenuRow
                    icon={'➕'}
                    label="Add team"
                    subtitle="AES or Timu"
                    available={true}
                    isCurrent={isCurrentScreen('AddTeamChooser')}
                    onPress={() => handleSelect('AddTeamChooser')}
                  />
                </View>
              )}

              {/* ── TOURNAMENT — only visible when actually inside an
                    active tournament context (AES event or Timu tid).
                    The previous split between "TEAM" and "TOURNAMENT"
                    sections was confusing; everything tournament-scoped
                    now lives here. */}
              {(hasEvent || onTimu) && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>TOURNAMENT</Text>

                  {/* Dashboard — works for both AES and Timu via My Team */}
                  <MenuRow
                    icon={'\u{1F3D0}'}
                    label="Dashboard"
                    subtitle={myTeam ? myTeam.teamText || myTeam.teamName : undefined}
                    available={!!myTeam}
                    isCurrent={
                      isCurrentScreen('TeamDashboard') ||
                      isCurrentScreen('TimuTeamDashboard')
                    }
                    onPress={() => {
                      if (myTeam) {
                        if (
                          (currentTeamId === myTeam.teamId &&
                            currentEventKey === myTeam.eventKey &&
                            isCurrentScreen('TeamDashboard')) ||
                          (myTeam.source === 'timu' &&
                            isCurrentScreen('TimuTeamDashboard'))
                        ) {
                          setVisible(false);
                          return;
                        }
                        handleFavoriteSelect(myTeam);
                      }
                    }}
                  />

                  {/* Season History */}
                  {myTeam && (
                    <MenuRow
                      icon={'\u{1F3C5}'}
                      label="Season History"
                      subtitle="All tournaments, both systems"
                      available={true}
                      isCurrent={isCurrentScreen('SeasonHistory')}
                      onPress={() => handleSelect('SeasonHistory')}
                    />
                  )}

                  {/* Tournaments (Manage Season) */}
                  <MenuRow
                    icon={'\u{1F5C2}'}
                    label="Add Tournaments"
                    subtitle="Add AES or Timu, refresh, browse"
                    available={true}
                    isCurrent={isCurrentScreen('AddTournaments')}
                    onPress={() => handleSelect('AddTournaments')}
                  />

                  {onTimu && (
                    <MenuRow
                      icon={'\u{1F4CA}'}
                      label="Tournament Overview"
                      subtitle="Pools, Schedule, Rankings"
                      available={true}
                      isCurrent={isCurrentScreen('TimuTournament')}
                      onPress={() => handleSelect('TimuTournament')}
                    />
                  )}
                  <MenuRow
                    icon={'\u{1F50D}'}
                    label="Search Teams"
                    subtitle={
                      hasDivision
                        ? `In ${divisionName}`
                        : hasEvent
                        ? 'Across the event'
                        : undefined
                    }
                    available={hasEvent}
                    isCurrent={isCurrentScreen('TeamSearch')}
                    onPress={() => handleSelect('TeamSearch')}
                    lockedHint="Select event first"
                  />
                  <MenuRow
                    icon={'\u{1F4CB}'}
                    label="Court Schedule"
                    available={hasEvent}
                    isCurrent={isCurrentScreen('CourtSchedule')}
                    onPress={() => handleSelect('CourtSchedule')}
                    lockedHint="Select event first"
                  />
                  <MenuRow
                    icon={'\u{1F4E1}'}
                    label="Live Scoreboard"
                    subtitle={divisionName || undefined}
                    available={hasDivision}
                    isCurrent={isCurrentScreen('LiveScoreboard')}
                    onPress={() => handleSelect('LiveScoreboard')}
                    lockedHint="Select division first"
                  />
                  <MenuRow
                    icon={'\u{1F3E2}'}
                    label="Club View"
                    available={hasEvent}
                    isCurrent={isCurrentScreen('ClubView')}
                    onPress={() => handleSelect('ClubView')}
                    lockedHint="Select event first"
                  />
                  <MenuRow
                    icon={'\u{1F3C6}'}
                    label="Standings"
                    subtitle={divisionName || undefined}
                    available={hasDivision}
                    isCurrent={isCurrentScreen('Standings')}
                    onPress={() => handleSelect('Standings')}
                    lockedHint="Select division first"
                  />
                  <MenuRow
                    icon={'\u{1F3C5}'}
                    label="Playoff Brackets"
                    subtitle={divisionName || undefined}
                    available={hasDivision}
                    isCurrent={isCurrentScreen('Brackets')}
                    onPress={() => handleSelect('Brackets')}
                    lockedHint="Select division first"
                  />
                  <MenuRow
                    icon={'\u{1F4CA}'}
                    label="Cross-tournament History"
                    available={true}
                    isCurrent={isCurrentScreen('TournamentHistory')}
                    onPress={() => handleSelect('TournamentHistory')}
                  />
                  <MenuRow
                    icon={'\u{1F4DD}'}
                    label="Team Notes"
                    available={hasTeam}
                    isCurrent={isCurrentScreen('TeamNotes')}
                    onPress={() => handleSelect('TeamNotes')}
                    lockedHint="Select a team first"
                  />
                  <MenuRow
                    icon={'\u{1F5FA}'}
                    label="Venue Map"
                    available={true}
                    isCurrent={isCurrentScreen('VenueMap')}
                    onPress={() => handleSelect('VenueMap')}
                  />
                  {/* Scoreboard now lives in the cross-context TOOLS
                      section below so it's also reachable from home. */}
                </View>
              )}

              {/* ── TOOLS — visible from every screen, every context.
                  Generic utilities + portal links the user might want
                  no matter where they currently are. */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>TOOLS</Text>
                <MenuRow
                  icon={'\u{1F4CA}'}
                  label="Simple Scoreboard"
                  subtitle="Hold-up flipboard — tap to score"
                  available={true}
                  isCurrent={isCurrentScreen('Scoreboard')}
                  onPress={() => handleSelect('Scoreboard')}
                />
                {/* Advanced scoring (full scoresheet engine) — gated by
                    the toggle in SETTINGS below. Hidden until enabled. */}
                {userProfile?.scorerMode ? (
                  <MenuRow
                    icon={'\u{1F4DD}'}
                    label="Advanced Scoring"
                    subtitle="Full scoresheet — rotations, subs, sanctions"
                    available={true}
                    isCurrent={isCurrentScreen('MatchList')}
                    onPress={() => handleSelect('MatchList')}
                  />
                ) : null}
                <MenuRow
                  icon={'\u{1F4C8}'}
                  label="OVA Rankings"
                  subtitle="Girls + Boys, all divisions"
                  available={true}
                  isCurrent={isCurrentScreen('OvaRankings')}
                  onPress={() => handleSelect('OvaRankings')}
                />
                <MenuRow
                  icon={'\u{1F4C5}'}
                  label="Browse tournaments"
                  subtitle="Look around without adding a team"
                  available={true}
                  isCurrent={isCurrentScreen('Home')}
                  onPress={() => handleSelect('Home')}
                />
                <MenuRow
                  icon={'\u{1F517}'}
                  label="OVA MRS"
                  subtitle={
                    userProfile?.mrsLinked
                      ? 'Connected'
                      : 'Connect to view affiliations'
                  }
                  available={true}
                  isCurrent={isCurrentScreen('MrsConnection')}
                  onPress={() => handleSelect('MrsConnection')}
                />
                <MenuRow
                  icon={'\u{1F3CB}'}
                  label="CAC Locker"
                  subtitle={
                    userProfile?.cacLinked
                      ? 'Connected'
                      : 'Connect to view NCCP'
                  }
                  available={true}
                  isCurrent={isCurrentScreen('CacConnection')}
                  onPress={() => handleSelect('CacConnection')}
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
                {/* Tier 2 scorer-mode toggle — gates the "Score a Match"
                    Tools entry above. When off (default), Tier 2 is
                    invisible. When on, the entry appears immediately
                    on next render. */}
                {onToggleScorerMode ? (
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={() => onToggleScorerMode(!userProfile?.scorerMode)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.menuIcon}>{'\u{1F4DD}'}</Text>
                    <View style={styles.menuLabelCol}>
                      <Text style={styles.menuLabel}>
                        Advanced Scoring
                      </Text>
                      <Text
                        style={{
                          fontSize: 11,
                          color: userProfile?.scorerMode
                            ? theme.colors.success
                            : theme.colors.textSecondary,
                          marginTop: 1,
                          fontWeight: '700',
                        }}
                      >
                        {userProfile?.scorerMode
                          ? 'ON · Full scoresheet enabled'
                          : 'OFF · Tap to enable in Tools'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ) : null}
              </View>


              {/* The standalone "FAVORITE TEAMS" section was removed in
                  the menu restructure — its contents are redundant
                  with MY TEAMS up top, which already lists every
                  TeamProfile (favourites become watching profiles via
                  addWatchingTeamProfile). Per-team removal lives on
                  MyHome team cards via long-press. */}
              {false && favoriteTeams.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>FAVORITE TEAMS</Text>
                  {favoriteTeams.map((fav) => {
                    const isTimu = fav.source === 'timu';
                    // AES favorites match by teamId+eventKey; Timu favorites
                    // match by source+teamName since IDs aren't stable.
                    const isCurrent = isTimu
                      ? currentScreen === 'TimuTeamDashboard' && !!fav.teamName
                      : currentTeamId === fav.teamId &&
                        currentEventKey === fav.eventKey &&
                        currentScreen === 'TeamDashboard';
                    const key = isTimu
                      ? `timu:${fav.teamName}`
                      : `${fav.eventKey}-${fav.teamId}`;
                    return (
                      <View
                        key={key}
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
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <Text
                                style={[
                                  styles.favoriteName,
                                  isCurrent && styles.favoriteNameCurrent,
                                ]}
                                numberOfLines={1}
                              >
                                {fav.teamText || fav.teamName}
                              </Text>
                              {isTimu && (
                                <View style={styles.timuBadge}>
                                  <Text style={styles.timuBadgeText}>Timu</Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.favoriteMeta} numberOfLines={1}>
                              {isTimu
                                ? fav.eventName || 'Timu tournament'
                                : `${fav.divisionName} — ${fav.eventName}`}
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

// Sub-component for the new "MY TEAMS" team-switcher rows. Active team
// is highlighted; tap any other team to switch.
function TeamSwitcherRow({
  team,
  isActive,
  onPress,
}: {
  team: TeamProfile;
  isActive: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const sourceLabel =
    team.source === 'mrs-linked'
      ? 'OVA'
      : team.source === 'mixed'
      ? 'AES+TIMU'
      : team.source.toUpperCase();
  const sourceColor =
    team.source === 'timu' || team.source === 'mixed'
      ? colors.accent
      : colors.primary;
  return (
    <TouchableOpacity
      style={[
        styles.menuItem,
        isActive && styles.menuItemCurrent,
      ]}
      onPress={onPress}
      disabled={isActive}
      activeOpacity={0.7}
    >
      <View style={[styles.teamSwitcherBadge, { backgroundColor: sourceColor }]}>
        <Text style={styles.teamSwitcherBadgeText}>{sourceLabel}</Text>
      </View>
      <View style={styles.menuLabelCol}>
        <Text
          style={[
            styles.menuLabel,
            isActive && styles.menuLabelCurrent,
          ]}
          numberOfLines={1}
        >
          {team.label}
        </Text>
        <Text style={styles.menuSubtitle} numberOfLines={1}>
          {team.kind === 'watching' ? 'Watching' : 'Me'}
          {team.seasonLabel ? ` · ${team.seasonLabel}` : ''}
          {team.club ? ` · ${team.club}` : ''}
        </Text>
      </View>
      {isActive && <View style={styles.currentDot} />}
    </TouchableOpacity>
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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  timuBadge: {
    marginLeft: spacing.sm,
    backgroundColor: colors.accent,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  timuBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
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
  // ── Team switcher (Phase 2/3) ─────────────────────────────────────────
  teamSwitcherBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    minWidth: 36,
    alignItems: 'center',
  },
  teamSwitcherBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
}
