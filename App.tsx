import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  StatusBar as RNStatusBar,
  Alert,
  BackHandler,
  ActivityIndicator,
  Modal,
  TouchableOpacity,
  AppState,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TournamentSelectScreen } from './src/screens/TournamentSelectScreen';
import { MyHomeScreen } from './src/screens/MyHomeScreen';
import { AddTeamChooserScreen } from './src/screens/AddTeamChooserScreen';
import {
  ConnectionScreen,
  MRS_CONFIG,
  CAC_LOCKER_CONFIG,
} from './src/screens/ConnectionScreen';
import { EventEntryScreen } from './src/screens/EventEntryScreen';
import { DivisionSelectScreen } from './src/screens/DivisionSelectScreen';
import { TeamSelectScreen } from './src/screens/TeamSelectScreen';
import { TeamSearchScreen } from './src/screens/TeamSearchScreen';
import { TeamDashboardScreen } from './src/screens/TeamDashboardScreen';
import { StandingsScreen } from './src/screens/StandingsScreen';
import { CourtScheduleScreen } from './src/screens/CourtScheduleScreen';
import { OpponentScoutScreen } from './src/screens/OpponentScoutScreen';
import { VenueMapScreen } from './src/screens/VenueMapScreen';
import { BracketScreen } from './src/screens/BracketScreen';
import { MyTeamsScreen } from './src/screens/MyTeamsScreen';
import { LiveScoreboardScreen } from './src/screens/LiveScoreboardScreen';
import { ClubViewScreen } from './src/screens/ClubViewScreen';
import { CrossTournamentScreen } from './src/screens/CrossTournamentScreen';
import { TeamNotesScreen } from './src/screens/TeamNotesScreen';
import { ScoreboardScreen } from './src/screens/ScoreboardScreen';
import { MatchListScreen } from './src/screens/MatchListScreen';
import { MatchSetupScreen } from './src/screens/MatchSetupScreen';
import { TeamRosterScreen } from './src/screens/TeamRosterScreen';
import { MatchScoringScreen } from './src/screens/MatchScoringScreen';
import type { Match as ScoredMatch } from './src/types/match';
import { saveMatch as saveScoredMatch } from './src/utils/scoredMatchStore';
import { TimuTournamentScreen } from './src/screens/TimuTournamentScreen';
import { TimuTeamDashboardScreen } from './src/screens/TimuTeamDashboardScreen';
import { TimuOpponentScoutScreen } from './src/screens/TimuOpponentScoutScreen';
import { AddTournamentsScreen } from './src/screens/AddTournamentsScreen';
import { SeasonHistoryScreen } from './src/screens/SeasonHistoryScreen';
import { OvaRankingsScreen } from './src/screens/OvaRankingsScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import { PlayerDetailScreen } from './src/screens/PlayerDetailScreen';
import { TournamentDetailScreen } from './src/screens/TournamentDetailScreen';
import { ToolsScreen } from './src/screens/ToolsScreen';
import { GlobalSearchScreen } from './src/screens/GlobalSearchScreen';
import type { GlobalSearchResult } from './src/screens/GlobalSearchScreen';
import { HamburgerMenu } from './src/components/HamburgerMenu';
import type { MenuDestination } from './src/components/HamburgerMenu';
import { TopBar } from './src/components/TopBar';
import { BottomTabBar, BOTTOM_TAB_BAR_HEIGHT } from './src/components/BottomTabBar';
import type { TabKey } from './src/components/BottomTabBar';
import {
  pushRecentlyViewedAndNotify,
  type RecentItem,
} from './src/utils/recentlyViewed';
import { getEvent, getTeamAssignments, fetchCanadianEvents, groupIntoTournaments, mergeDiscoveredEvents } from './src/api/aesClient';
import {
  loadSavedEvents,
  saveSavedEvents,
  loadFavoriteTeams,
  saveFavoriteTeams,
  loadMyTeam,
  saveMyTeam,
  loadThemeMode,
  saveThemeMode,
  loadSavedTimuTournaments,
  saveSavedTimuTournaments,
} from './src/utils/storage';
import {
  loadOrMigrateUserProfile,
  saveUserProfile,
} from './src/utils/userProfile';
import {
  loadSeasonIndex,
  findStaleTids,
  bulkIndex,
  refreshAll as refreshAllTimu,
} from './src/utils/timuSeasonIndex';
import {
  autoDiscoverTeam,
  type AutoDiscoverProgress,
} from './src/utils/teamAutoDiscover';
import {
  upsertTeamProfileForFavorite,
  addWatchingTeamProfile,
  setActiveTeamId,
  removeTeamProfile,
} from './src/utils/activeTeamProfile';
import type { UserProfile, TeamProfile } from './src/types/profile';
import {
  ThemeContext,
  lightColors,
  darkColors,
} from './src/utils/theme';
import type { ThemeMode } from './src/utils/theme';
import type {
  AESEvent,
  AESDivision,
  AESTeamAssignment,
  FavoriteTeam,
  SavedEvent,
} from './src/types/aes';
import {
  TOURNAMENT_REGISTRY,
} from './src/config/tournaments';
import type {
  Country,
  Tournament,
  TournamentYear,
} from './src/config/tournaments';
import type { SavedTimuTournament, TimuTournamentInfo } from './src/types/timu';

type Screen =
  | 'MyHome'
  | 'AddTeamChooser'
  | 'MrsConnection'
  | 'CacConnection'
  | 'TournamentSelect'
  | 'EventEntry'
  | 'DivisionSelect'
  | 'TeamSelect'
  | 'TeamSearch'
  | 'TeamDashboard'
  | 'MyTeams'
  | 'Standings'
  | 'CourtSchedule'
  | 'OpponentScout'
  | 'VenueMap'
  | 'Brackets'
  | 'LiveScoreboard'
  | 'ClubView'
  | 'TournamentHistory'
  | 'TeamNotes'
  | 'TimuTournament'
  | 'TimuTeamDashboard'
  | 'TimuOpponentScout'
  | 'AddTournaments'
  | 'SeasonHistory'
  | 'OvaRankings'
  | 'Scoreboard'
  | 'MatchList'
  | 'MatchSetup'
  | 'MatchScoring'
  | 'TeamRoster'
  | 'Stats'
  | 'PlayerDetail'
  | 'TournamentDetail'
  | 'Tools'
  | 'GlobalSearch';

// ── Bottom tab routing ─────────────────────────────────────────────────────
//
// Three "home destinations" map onto the bottom tab bar. A tab tap is a
// destination switch — caller clears screenHistory and sets `screen` to the
// destination. When the user is "deep" inside a flow (TeamDashboard etc.)
// no tab is highlighted but all three remain reachable.
function tabForScreen(screen: Screen): TabKey | null {
  if (screen === 'MyHome') return 'home';
  if (screen === 'TournamentSelect') return 'browse';
  if (screen === 'Tools') return 'tools';
  return null;
}

// Screens that DON'T show the active-team pill in the TopBar. The pill
// exists to remind the user which team they're scoped to on screens that
// don't already make that obvious (Tools, hamburger-driven menus, etc.).
// We suppress it on:
//   • screens whose own header already shows the team name (collision)
//   • team-detail dashboards (redundant — the team identity IS the page)
//   • the Tier 1 scoreboard + Tier 2 scoring screens (the team identity
//     is plastered all over the score panels themselves AND the pill was
//     covering banners on the hold-up scoreboard)
//   • home / browse / connection / tools / global search (no team scope)
const PILL_SUPPRESSED_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
  // No-team-scope screens
  'MyHome',
  'AddTeamChooser',
  'MrsConnection',
  'CacConnection',
  'TournamentSelect',
  'Tools',
  'GlobalSearch',
  // Team-detail screens (team name in their own header)
  'TeamDashboard',
  'TimuTeamDashboard',
  'SeasonHistory',
  'TeamNotes',
  // Tournament screens that show team-name subtitles or where the pill
  // would compete for the same horizontal space as the screen's title
  'Standings',
  'Brackets',
  'ClubView',
  'OpponentScout',
  'TimuOpponentScout',
  'LiveScoreboard',
  // Tier 1 + Tier 2 scoring — team identity already on-screen and the
  // pill was covering banners on the hold-up scoreboard.
  'Scoreboard',
  'MatchSetup',
  'MatchScoring',
  // Roster editor — the team being edited is in its own header.
  'TeamRoster',
  // Analytics — team identity is in the screen title
  'Stats',
  'PlayerDetail',
  'TournamentDetail',
]);

// Screens where the bottom tab bar is hidden (focused full-screen flows).
// User decision: keep the tab bar on the scoring screens too — only
// GlobalSearch is fullscreen. Iterate later if the tab bar competes with
// the action shelves on the scoring screens.
const TAB_BAR_HIDDEN_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
  'GlobalSearch',
]);

/**
 * Phase 4: which hamburger context to render. Home covers MyHome /
 * AddTeamChooser / TournamentSelect / EventEntry / OvaRankings / the
 * connection screens — anything not pinned to a specific team. Team
 * covers everything else (TeamDashboard / TimuTeamDashboard / Standings /
 * Brackets / Tournaments / etc.).
 */
function menuContextForScreen(screen: Screen): 'home' | 'team' {
  switch (screen) {
    case 'MyHome':
    case 'AddTeamChooser':
    case 'MrsConnection':
    case 'CacConnection':
    case 'TournamentSelect':
    case 'EventEntry':
    case 'OvaRankings':
    case 'Tools':
    case 'GlobalSearch':
      return 'home';
    default:
      return 'team';
  }
}

export default function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  const themeColors = themeMode === 'dark' ? darkColors : lightColors;
  const themeContextValue = useMemo(() => ({
    mode: themeMode,
    colors: themeColors,
    toggle: () => {
      setThemeMode((prev) => {
        const next = prev === 'light' ? 'dark' : 'light';
        saveThemeMode(next);
        return next;
      });
    },
  }), [themeMode, themeColors]);

  const [screen, setScreen] = useState<Screen>('TournamentSelect');
  const [screenHistory, setScreenHistory] = useState<Screen[]>([]);

  const [currentEvent, setCurrentEvent] = useState<AESEvent | null>(null);
  const [currentDivision, setCurrentDivision] = useState<AESDivision | null>(
    null
  );
  const [currentTeam, setCurrentTeam] = useState<AESTeamAssignment | null>(
    null
  );
  // Tournament selection context
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [selectedTournamentYear, setSelectedTournamentYear] = useState<TournamentYear | null>(null);

  const [savedEvents, setSavedEvents] = useState<SavedEvent[]>([]);
  const [favoriteTeams, setFavoriteTeams] = useState<FavoriteTeam[]>([]);
  const [myTeam, setMyTeam] = useState<FavoriteTeam | null>(null);
  // Phase 2/3: profile-and-teams layer. Legacy `myTeam` is still the
  // primary read path for existing screens; we keep `userProfile` in
  // lockstep on every set so both stay correct during the transition.
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [scoutParams, setScoutParams] = useState<{
    opponentTeamId: number;
    opponentName: string;
  } | null>(null);
  const [bracketPlayId, setBracketPlayId] = useState<number | undefined>(undefined);
  const [venueMapUrl, setVenueMapUrl] = useState<string | undefined>(undefined);
  const [venueInfoPageUrl, setVenueInfoPageUrl] = useState<string | undefined>(undefined);
  const [highlightCourt, setHighlightCourt] = useState<string | undefined>(undefined);
  const [courtMatchInfo, setCourtMatchInfo] = useState<{ opponentName: string; time: string } | undefined>(undefined);
  const [hydrated, setHydrated] = useState(false);
  // Aliases of the team currently displayed by SeasonHistoryScreen. Sourced
  // from the active TeamProfile so the screen filters tournaments to ONLY
  // that team's appearances — fixes the cross-pollution bug where Team A's
  // history showed Team B's tournaments via the global alias list.
  const [currentHistoryAliases, setCurrentHistoryAliases] = useState<string[] | null>(null);
  // Tier 2 — active match being scored (transient; the canonical store
  // is AsyncStorage via scoredMatchStore). Set when MatchSetup hands
  // off a freshly-built Match, or when MatchList resumes one.
  const [activeScoredMatch, setActiveScoredMatch] = useState<ScoredMatch | null>(null);
  // Stats screen navigation — carries the team profile ID and name.
  const [statsTeamProfileId, setStatsTeamProfileId] = useState<string>('');
  const [statsTeamName, setStatsTeamName] = useState<string>('');
  // PlayerDetail and TournamentDetail share the same teamProfileId/teamName
  // as the Stats dashboard they were opened from. Each carries its own
  // selection (shirt # or tournament + matchIds list).
  const [playerDetailShirt, setPlayerDetailShirt] = useState<number>(0);
  const [playerDetailName, setPlayerDetailName] = useState<string>('');
  const [tournamentDetailName, setTournamentDetailName] = useState<string>('');
  const [tournamentDetailMatchIds, setTournamentDetailMatchIds] = useState<string[]>([]);
  // TeamRoster screen — which TeamProfile.id is being edited.
  const [rosterEditTeamId, setRosterEditTeamId] = useState<string | null>(null);
  // When a team dashboard's "+ Add a tournament" button routes the user
  // to AddTournamentsScreen, this carries the dashboard's source so the
  // matching paste-card scrolls into view + flashes a highlight on
  // first render. Cleared on screen exit.
  const [addTournamentsFocusSource, setAddTournamentsFocusSource] = useState<
    'aes' | 'timu' | null
  >(null);
  // Timu season-index sync state surfaced into MyHome. `syncing` flips on
  // for both the silent boot refresh and the manual "Sync now" button.
  // Progress is ({done, total}) — null when no sync has run yet this session.
  const [timuSyncing, setTimuSyncing] = useState(false);
  const [timuSyncProgress, setTimuSyncProgress] = useState<{ done: number; total: number } | null>(null);
  // Auto-discovery state — flips on when a newly-added team triggers a
  // background scan of AES + Timu for tournaments matching its aliases.
  const [discoveringTeamLabel, setDiscoveringTeamLabel] = useState<string | null>(null);
  const [discoveryProgress, setDiscoveryProgress] = useState<AutoDiscoverProgress | null>(null);
  // Lingering result banner — kept on screen for a few seconds after a
  // discovery completes so the user notices the new tournaments are
  // ready. `teamId` lets the banner deep-link to that team's history.
  const [discoveryResult, setDiscoveryResult] = useState<{
    teamId: string;
    teamLabel: string;
    aliases: string[];
    aesIndexed: number;
    timuIndexed: number;
  } | null>(null);
  // Custom confirmation modal for "kick off auto-discover for this team?".
  // We previously used Alert.alert, but on some devices the native dialog
  // renders without visible buttons or gets dismissed by the slightest
  // edge-tap. A controlled Modal is unambiguous: there is always a
  // "Search Tournaments" button on screen.
  const [confirmDiscovery, setConfirmDiscovery] = useState<{
    team: TeamProfile;
    resolve: (v: boolean) => void;
  } | null>(null);
  const [navigatingToFav, setNavigatingToFav] = useState(false);
  // Boot-time tournament registry enriched with AES discovery data.
  // Passed to TournamentSelectScreen so it doesn't repeat the fetch.
  const [discoveredRegistry, setDiscoveredRegistry] = useState<Country[] | null>(null);
  // Timestamp of last successful tournament discovery — used to throttle
  // re-runs when returning from background.
  const [lastRegistryRefreshAt, setLastRegistryRefreshAt] = useState(0);

  // Timu state — independent of AES event/division/team context.
  const [savedTimuTournaments, setSavedTimuTournaments] = useState<SavedTimuTournament[]>([]);
  const [currentTimuTid, setCurrentTimuTid] = useState<number | null>(null);
  const [currentTimuTeamName, setCurrentTimuTeamName] = useState<string | null>(null);
  const [currentTimuScoutOpponent, setCurrentTimuScoutOpponent] = useState<string | null>(null);
  const [currentHistoryTeamName, setCurrentHistoryTeamName] = useState<string | null>(null);
  const [ovaInitialDivision, setOvaInitialDivision] = useState<{ key?: string; gender?: 'girls' | 'boys' } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [events, favs, saved, savedTheme, timu, profile] = await Promise.all([
          loadSavedEvents(),
          loadFavoriteTeams(),
          loadMyTeam(),
          loadThemeMode(),
          loadSavedTimuTournaments(),
          loadOrMigrateUserProfile(),
        ]);
        setSavedEvents(events);
        setFavoriteTeams(favs);
        setMyTeam(saved);
        setThemeMode(savedTheme);
        setSavedTimuTournaments(timu);
        setUserProfile(profile);

        // Phase 4 boot decision: always land on MyHome.
        //   - Returning user with teams → MyHome shows their teams list.
        //   - Fresh user with no teams → MyHome shows the empty state with
        //     '+ Add team' as the only CTA.
        // The previous auto-jump-to-team-dashboard fallbacks have been
        // removed — boot is now one decision, simpler and more predictable.
        setScreenHistory([]);
        setScreen('MyHome');
      } catch {
        //
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveSavedEvents(savedEvents);
  }, [savedEvents, hydrated]);

  // Configure local notifications so the discovery-complete event fires
  // an OS-level banner even when the app is backgrounded. Best-effort —
  // permissions failures or unsupported runtimes (e.g. iOS Expo Go on
  // SDK 54) are swallowed; the in-app banner still fires either way.
  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      } as Notifications.NotificationBehavior),
    });
    Notifications.requestPermissionsAsync().catch(() => {});
  }, []);

  // Once after hydration: silently refresh any Timu snapshots that look
  // stale (results pending, no playoff data yet, missing core metadata).
  // Best-effort — failures don't surface to the UI, the user can always
  // hit the explicit "Sync now" button on MyHome to retry.
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    (async () => {
      try {
        const idx = await loadSeasonIndex();
        const stale = findStaleTids(idx);
        if (cancelled || stale.length === 0) return;
        setTimuSyncing(true);
        setTimuSyncProgress({ done: 0, total: stale.length });
        await bulkIndex(stale, (done, total) => {
          if (!cancelled) setTimuSyncProgress({ done, total });
        });
      } catch {
        // ignore
      } finally {
        if (!cancelled) setTimuSyncing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hydrated]);

  // ── Boot-time tournament registry refresh ──────────────────────────────
  // Fetch AES events once after hydration and merge them into the static
  // registry. This means the TournamentSelectScreen has fresh data the
  // instant the user opens it, and newly-published events (like Nationals
  // cities) appear without a manual refresh.
  const refreshTournamentRegistry = useCallback(async () => {
    try {
      const caEvents = await fetchCanadianEvents();
      const grouped = groupIntoTournaments(caEvents);
      const merged = mergeDiscoveredEvents(TOURNAMENT_REGISTRY, grouped);
      setDiscoveredRegistry(merged);
      setLastRegistryRefreshAt(Date.now());
    } catch (err) {
      console.warn('Boot-time tournament discovery failed:', err);
      // Non-fatal — the static registry still works
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    refreshTournamentRegistry();
  }, [hydrated, refreshTournamentRegistry]);

  // Re-run discovery when the app returns from background, throttled to
  // at most once every 15 minutes. This catches schedule updates (e.g.
  // teams published, new events added) without hammering the API.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        const THROTTLE_MS = 15 * 60 * 1000; // 15 minutes
        if (Date.now() - lastRegistryRefreshAt > THROTTLE_MS) {
          refreshTournamentRegistry();
        }
      }
    });
    return () => sub.remove();
  }, [lastRegistryRefreshAt, refreshTournamentRegistry]);

  /**
   * Kick off a background AES + Timu scan for any tournaments where this
   * team appears, indexing the matches into the season indices. Throttled
   * per alias-set inside `autoDiscoverTeam`, so calling repeatedly for
   * the same team within 6 hours is a no-op.
   *
   * Best-effort: failures are swallowed; the user can re-trigger from
   * the manual sync action on MyHome.
   */
  const handleAutoDiscoverTeam = useCallback(
    async (team: TeamProfile, opts?: { force?: boolean }) => {
      if (discoveringTeamLabel) return; // already running for some team
      const aliases = team.aliases.length ? team.aliases : [team.label];
      if (!aliases.length) return;

      // Data warning — the Timu side alone fetches ~50 MB across the
      // current season's tid range. Make the user opt in so they don't
      // burn through cellular by accident. The confirmation lives in
      // a controlled <Modal> at the App-level so the buttons are always
      // visible (Alert.alert proved unreliable on some devices).
      const confirmed = await new Promise<boolean>((resolve) => {
        setConfirmDiscovery({ team, resolve });
      });
      setConfirmDiscovery(null);
      if (!confirmed) return;

      setDiscoveringTeamLabel(team.label);
      setDiscoveryProgress({ phase: 'starting', done: 0, total: 0, matched: 0 });
      // Clear any old result banner so it doesn't linger over the in-flight
      // run from a previous team.
      setDiscoveryResult(null);
      try {
        const out = await autoDiscoverTeam(
          aliases,
          (p) => setDiscoveryProgress(p),
          { force: opts?.force }
        );
        if (!out.skipped) {
          // Stamp the team profile with the completion time so the
          // "Last synced X ago" badge on Season History and MyHome
          // is accurate for this specific team.
          const now = Date.now();
          setUserProfile((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              teams: prev.teams.map((t) =>
                t.id === team.id
                  ? { ...t, lastDiscoveryAt: now, updatedAt: now }
                  : t
              ),
              updatedAt: now,
            };
          });
          setDiscoveryResult({
            teamId: team.id,
            teamLabel: team.label,
            aliases,
            aesIndexed: out.aesIndexed,
            timuIndexed: out.timuIndexed,
          });
          // Local notification — surfaces the completion even if the
          // user has navigated away from the app. Best-effort: any
          // failure (permission, runtime) is swallowed.
          const total = out.aesIndexed + out.timuIndexed;
          if (total > 0) {
            Notifications.scheduleNotificationAsync({
              content: {
                title: 'Tournament search complete',
                body: `Found ${total} tournament${total === 1 ? '' : 's'} for ${team.label}.`,
              },
              trigger: null,
            }).catch(() => {});
          }
        }
      } catch {
        /* best-effort; swallow */
      } finally {
        setDiscoveringTeamLabel(null);
        setDiscoveryProgress(null);
      }
    },
    [discoveringTeamLabel]
  );

  // Auto-dismiss the discovery result banner after a generous window so
  // the user has time to notice it but the home screen doesn't stay
  // cluttered indefinitely.
  useEffect(() => {
    if (!discoveryResult) return;
    const t = setTimeout(() => setDiscoveryResult(null), 30 * 1000);
    return () => clearTimeout(t);
  }, [discoveryResult]);

  // Manual re-run from Season History's "Find more tournaments" button.
  // Forces past the 6h throttle so users can re-scan after a tournament
  // weekend. We re-resolve the team profile from the current screen's
  // aliases so the right TeamProfile.id ends up on the result banner.
  const handleFindMoreForCurrentTeam = useCallback(() => {
    if (!userProfile) return;
    const aliasSet = currentHistoryAliases || [currentHistoryTeamName].filter(Boolean) as string[];
    if (!aliasSet.length) return;
    const lower = aliasSet.map((a) => a.toLowerCase().trim());
    const match = userProfile.teams.find((t) =>
      t.aliases.some((a) => lower.includes(a.toLowerCase().trim()))
    );
    if (!match) {
      Alert.alert(
        'No team profile found',
        'Add this team via "+ Season" or the star icon first, then re-run.'
      );
      return;
    }
    handleAutoDiscoverTeam(match, { force: true });
  }, [userProfile, currentHistoryAliases, currentHistoryTeamName, handleAutoDiscoverTeam]);

  // Open the per-team roster editor for a given TeamProfile.
  const handleOpenRosterEditor = useCallback((team: TeamProfile) => {
    setRosterEditTeamId(team.id);
    setScreenHistory((prev) => [...prev, screen]);
    setScreen('TeamRoster');
  }, [screen]);

  // Persist the next roster on the active TeamProfile.
  const handleSaveRoster = useCallback(
    (teamId: string, next: { roster: TeamProfile['roster']; rosterUpdatedAt: number }) => {
      setUserProfile((prev) => {
        if (!prev) return prev;
        const teams = prev.teams.map((t) =>
          t.id === teamId
            ? {
                ...t,
                roster: next.roster,
                rosterUpdatedAt: next.rosterUpdatedAt,
                updatedAt: Date.now(),
              }
            : t
        );
        return { ...prev, teams, updatedAt: Date.now() };
      });
    },
    []
  );

  // Remove a TeamProfile entirely from MyTeams + watching list, plus any
  // matching FavoriteTeam entries. Confirms via Alert.
  const handleRemoveTeam = useCallback(
    (team: TeamProfile) => {
      Alert.alert(
        `Remove ${team.label}?`,
        'This unfollows the team and removes it from your home and the hamburger menu. Indexed tournament snapshots stay on the device — you can re-add the team later to see them again.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              setUserProfile((prev) => {
                if (!prev) return prev;
                return removeTeamProfile(prev, team.id);
              });
              // Drop matching favorite entries (AES match by primaryRef,
              // Timu match by team-name alias).
              setFavoriteTeams((prev) => {
                return prev.filter((f) => {
                  if (
                    team.primaryRef &&
                    team.primaryRef.source === f.source &&
                    team.primaryRef.eventKey === f.eventKey &&
                    team.primaryRef.teamId === f.teamId
                  ) {
                    return false;
                  }
                  // Also drop by team-name alias match (catches Timu favs
                  // and any AES fav whose primaryRef wasn't an exact match).
                  const favName = (f.teamText || f.teamName || '').toLowerCase().trim();
                  if (
                    favName &&
                    team.aliases.some(
                      (a) => a.toLowerCase().trim() === favName
                    )
                  ) {
                    return false;
                  }
                  return true;
                });
              });
              // If this team was the singular MyTeam, clear it.
              setMyTeam((prev) => {
                if (!prev) return prev;
                if (
                  team.primaryRef &&
                  team.primaryRef.source === prev.source &&
                  team.primaryRef.eventKey === prev.eventKey &&
                  team.primaryRef.teamId === prev.teamId
                ) {
                  return null;
                }
                const myName = (prev.teamText || prev.teamName || '').toLowerCase().trim();
                if (
                  myName &&
                  team.aliases.some((a) => a.toLowerCase().trim() === myName)
                ) {
                  return null;
                }
                return prev;
              });
            },
          },
        ]
      );
    },
    []
  );

  // Long-press on a TeamProfile card → surface an action sheet with the
  // available per-team actions. Replaces the prior "long-press = remove"
  // shortcut now that there's more than one thing to do per team.
  const handleLongPressTeam = useCallback(
    (team: TeamProfile) => {
      Alert.alert(
        team.label,
        undefined,
        [
          {
            text: 'Manage roster',
            onPress: () => handleOpenRosterEditor(team),
          },
          {
            text: 'Remove team',
            style: 'destructive',
            onPress: () => handleRemoveTeam(team),
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    },
    [handleOpenRosterEditor, handleRemoveTeam]
  );

  /**
   * Centralised "open this team's Season History" action used by every
   * follow-list entry point (hamburger favorites, hamburger team-switcher,
   * MyTeams screen, MyHome team cards). Pulls the team's per-team aliases
   * from the UserProfile so the history view filters tournaments to ONLY
   * that team — fixes the cross-pollution where the global alias list
   * mixed every followed team's aliases together.
   */
  const openTeamSeasonHistory = useCallback(
    (opts: { team?: TeamProfile; fav?: FavoriteTeam; fallbackName?: string }) => {
      let primary = '';
      let aliases: string[] | null = null;

      if (opts.team) {
        primary = opts.team.aliases[0] || opts.team.label;
        aliases = opts.team.aliases.length > 0 ? opts.team.aliases : [primary];
      } else if (opts.fav) {
        primary = opts.fav.teamText || opts.fav.teamName || '';
        // Try to find the matching TeamProfile so we can use its full alias
        // set (handles spelling drift like "Defensa U18 Rob" vs "Defensa Rob").
        const lower = primary.toLowerCase().trim();
        const match = userProfile?.teams.find((t) =>
          t.aliases.some((a) => a.toLowerCase().trim() === lower)
        );
        aliases = match?.aliases ?? null;
      } else if (opts.fallbackName) {
        primary = opts.fallbackName;
      }

      if (!primary) return;
      setCurrentHistoryTeamName(primary);
      setCurrentHistoryAliases(aliases);
      setScreenHistory((prev) => [...prev, screen]);
      setScreen('SeasonHistory');
    },
    [userProfile, screen]
  );

  // Manual "Sync now" — re-fetches every snapshot in the season index so
  // results, brackets, and final rankings are pulled fresh in one shot.
  // Used by the Sync button on MyHome.
  const handleSyncSeason = useCallback(async () => {
    if (timuSyncing) return;
    try {
      setTimuSyncing(true);
      const idx = await loadSeasonIndex();
      const tids = Object.keys(idx).map((k) => Number(k)).filter(Number.isFinite);
      if (tids.length === 0) {
        setTimuSyncProgress({ done: 0, total: 0 });
        return;
      }
      setTimuSyncProgress({ done: 0, total: tids.length });
      await refreshAllTimu((done, total) => {
        setTimuSyncProgress({ done, total });
      });
    } catch (err: any) {
      Alert.alert('Sync failed', err?.message || 'Could not refresh Timu snapshots.');
    } finally {
      setTimuSyncing(false);
    }
  }, [timuSyncing]);

  useEffect(() => {
    if (!hydrated) return;
    saveFavoriteTeams(favoriteTeams);
  }, [favoriteTeams, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveMyTeam(myTeam);
  }, [myTeam, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveSavedTimuTournaments(savedTimuTournaments);
  }, [savedTimuTournaments, hydrated]);

  useEffect(() => {
    if (!hydrated || !userProfile) return;
    saveUserProfile(userProfile);
  }, [userProfile, hydrated]);

  // ── Profile/MyTeam sync ─────────────────────────────────────────────────
  //
  // setMyTeamAndProfile wraps the legacy `setMyTeam` so every call site
  // that pins a team also creates/updates the matching TeamProfile and
  // sets it as active. Existing screens still call this with their
  // FavoriteTeam shape; the user-profile layer just rides along.
  const setMyTeamAndProfile = useCallback((fav: FavoriteTeam | null) => {
    setMyTeam(fav);
    setUserProfile((prev) => {
      if (!prev) return prev;
      if (fav == null) {
        return setActiveTeamId(prev, null);
      }
      const { profile: next, teamId } = upsertTeamProfileForFavorite(prev, fav);
      // Auto-discover for newly-pinned my-teams too. The discover util
      // throttles per alias-set, so this is harmless even if the team
      // was already a watching profile that's now being promoted.
      if (teamId) {
        const upserted = next.teams.find((t) => t.id === teamId);
        if (upserted) {
          handleAutoDiscoverTeam(upserted).catch(() => {
            /* swallow */
          });
        }
      }
      return next;
    });
  }, [handleAutoDiscoverTeam]);

  // Switching the active team via the new MyHome / HamburgerMenu UI:
  // updates profile, then mirrors into legacy `myTeam` so existing
  // screens (TeamDashboard, etc.) stay correct without code changes.
  const handleSwitchActiveTeam = useCallback(
    (teamId: string) => {
      setUserProfile((prev) => {
        if (!prev) return prev;
        const next = setActiveTeamId(prev, teamId);
        const team = next.teams.find((t) => t.id === teamId);
        if (team?.primaryRef) {
          // Primary ref exists — sync legacy myTeam.
          setMyTeam(team.primaryRef);
        }
        return next;
      });
    },
    []
  );

  // ── Timu callbacks ──────────────────────────────────────────────────────

  const onTimuLoaded = useCallback((tid: number) => {
    setCurrentTimuTid(tid);
    setCurrentEvent(null);
    setCurrentDivision(null);
    setCurrentTeam(null);
    setScreenHistory((prev) => [...prev, 'TournamentSelect']);
    setScreen('TimuTournament');
    pushRecentlyViewedAndNotify({
      kind: 'tournament-timu',
      tid,
      label: `Tournament ${tid}`,
      touchedAt: Date.now(),
    });
  }, []);

  const onTimuInfoLoaded = useCallback((info: TimuTournamentInfo) => {
    setSavedTimuTournaments((prev) => {
      const next = prev.filter((t) => t.tid !== info.tid);
      next.unshift({
        source: 'timu',
        tid: info.tid,
        name: info.name || `Tournament ${info.tid}`,
        subtitle: info.subtitle,
        dateText: info.dateText,
        venueName: info.venueName,
      });
      return next.slice(0, 10);
    });
    // Refresh the matching recently-viewed entry with the real tournament
    // name (the initial push from onTimuLoaded only had the bare tid).
    pushRecentlyViewedAndNotify({
      kind: 'tournament-timu',
      tid: info.tid,
      label: info.name || `Tournament ${info.tid}`,
      subtitle: info.venueName || info.dateText,
      touchedAt: Date.now(),
    });
  }, []);

  const handleTimuTeamPress = useCallback(
    (teamName: string) => {
      if (!currentTimuTid) return;
      setCurrentTimuTeamName(teamName);
      setScreenHistory((prev) => [...prev, screen]);
      setScreen('TimuTeamDashboard');
      const tournament = savedTimuTournaments.find(
        (t) => t.tid === currentTimuTid
      );
      pushRecentlyViewedAndNotify({
        kind: 'team-timu',
        tid: currentTimuTid,
        teamName,
        label: teamName,
        subtitle: tournament?.name,
        touchedAt: Date.now(),
      });
    },
    [currentTimuTid, screen, savedTimuTournaments]
  );

  const isTimuFavorite = useCallback(
    (teamName: string) =>
      favoriteTeams.some(
        (f) =>
          f.source === 'timu' &&
          f.teamName.toLowerCase().trim() === teamName.toLowerCase().trim()
      ),
    [favoriteTeams]
  );

  const toggleTimuFavorite = useCallback(
    (teamName: string, tournamentName: string) => {
      if (!currentTimuTid) return;
      const key = teamName.toLowerCase().trim();
      let willAdd = false;
      let newFav: FavoriteTeam | null = null;
      setFavoriteTeams((prev) => {
        const exists = prev.some(
          (f) => f.source === 'timu' && f.teamName.toLowerCase().trim() === key
        );
        willAdd = !exists;
        if (exists) {
          return prev.filter(
            (f) => !(f.source === 'timu' && f.teamName.toLowerCase().trim() === key)
          );
        }
        newFav = {
          source: 'timu',
          eventKey: `timu:${currentTimuTid}`,
          eventName: tournamentName,
          teamId: 0,
          teamName,
          teamText: teamName,
          teamCode: '',
          clubName: '',
          divisionId: 0,
          divisionName: '',
          divisionColorHex: '#ff6b35',
          lastTid: currentTimuTid,
        };
        return [...prev, newFav];
      });
      if (willAdd && newFav) {
        setUserProfile((prev) => {
          if (!prev) return prev;
          const { profile: next, teamId } = addWatchingTeamProfile(prev, newFav!);
          if (teamId) {
            const added = next.teams.find((t) => t.id === teamId);
            if (added) {
              handleAutoDiscoverTeam(added).catch(() => {
                /* swallow */
              });
            }
          }
          return next;
        });
      }
    },
    [currentTimuTid, handleAutoDiscoverTeam]
  );

  const setTimuAsMyTeam = useCallback(
    (teamName: string, tournamentName: string) => {
      if (!currentTimuTid) return;
      setMyTeamAndProfile({
        source: 'timu',
        eventKey: `timu:${currentTimuTid}`,
        eventName: tournamentName,
        teamId: 0,
        teamName,
        teamText: teamName,
        teamCode: '',
        clubName: '',
        divisionId: 0,
        divisionName: '',
        divisionColorHex: '#ff6b35',
        lastTid: currentTimuTid,
      });
    },
    [currentTimuTid, setMyTeamAndProfile]
  );

  const handleSetMyTeam = useCallback(() => {
    if (!currentEvent || !currentDivision || !currentTeam) return;
    setMyTeamAndProfile({
      eventKey: currentEvent.Key,
      eventName: currentEvent.Name,
      teamId: currentTeam.TeamId,
      teamName: currentTeam.TeamName,
      teamText: currentTeam.TeamText,
      teamCode: currentTeam.TeamCode,
      clubName: currentTeam.TeamClub.Name,
      divisionId: currentDivision.DivisionId,
      divisionName: currentDivision.Name,
      divisionColorHex: currentDivision.ColorHex,
    });
  }, [currentEvent, currentDivision, currentTeam, setMyTeamAndProfile]);

  const handleClearMyTeam = useCallback(() => {
    setMyTeamAndProfile(null);
  }, [setMyTeamAndProfile]);

  const handleRemoveFavorite = useCallback(
    (fav: FavoriteTeam) => {
      setFavoriteTeams((prev) =>
        prev.filter(
          (f) => !(f.teamId === fav.teamId && f.eventKey === fav.eventKey)
        )
      );
    },
    []
  );

  const navigate = useCallback(
    (to: Screen) => {
      setScreenHistory((prev) => [...prev, screen]);
      setScreen(to);
    },
    [screen]
  );

  const goBack = useCallback(() => {
    setScreenHistory((prev) => {
      if (prev.length === 0) return prev;
      const newHistory = [...prev];
      const previous = newHistory.pop()!;
      setScreen(previous);
      return newHistory;
    });
  }, []);

  // Clear context whenever we navigate back to higher-level screens
  useEffect(() => {
    if (screen === 'TournamentSelect') {
      setCurrentEvent(null);
      setCurrentDivision(null);
      setCurrentTeam(null);
      setSelectedCountry(null);
      setSelectedTournament(null);
      setSelectedTournamentYear(null);
    }
    if (screen === 'EventEntry') {
      setCurrentEvent(null);
      setCurrentDivision(null);
      setCurrentTeam(null);
    }
    if (screen === 'DivisionSelect') {
      setCurrentDivision(null);
      setCurrentTeam(null);
    }
  }, [screen]);

  // Android hardware back button support
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onHardwareBack = () => {
      if (screen === 'TournamentSelect') {
        // On the home screen, let the default behaviour (exit app) happen
        return false;
      }
      goBack();
      return true; // We handled it
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
    return () => sub.remove();
  }, [screen, goBack]);

  const onTournamentSelected = useCallback(
    (country: Country, tournament: Tournament, tournamentYear: TournamentYear) => {
      setSelectedCountry(country);
      setSelectedTournament(tournament);
      setSelectedTournamentYear(tournamentYear);
      navigate('EventEntry');
    },
    [navigate]
  );

  const onEventLoaded = useCallback(
    (event: AESEvent) => {
      setCurrentEvent(event);
      setCurrentDivision(null);
      setCurrentTeam(null);
      setSavedEvents((prev) => {
        if (prev.some((e) => e.key === event.Key)) return prev;
        return [
          ...prev,
          {
            key: event.Key,
            name: event.Name,
            startDate: event.StartDate,
            endDate: event.EndDate,
            location: event.Location,
          },
        ];
      });
      navigate('DivisionSelect');
      pushRecentlyViewedAndNotify({
        kind: 'tournament-aes',
        eventKey: event.Key,
        label: event.Name,
        subtitle: event.Location,
        touchedAt: Date.now(),
      });
    },
    [navigate]
  );

  const onDivisionSelected = useCallback(
    (division: AESDivision) => {
      setCurrentDivision(division);
      setCurrentTeam(null);
      navigate('TeamSelect');
    },
    [navigate]
  );

  const onTeamSelected = useCallback(
    (team: AESTeamAssignment) => {
      setCurrentTeam(team);
      navigate('TeamDashboard');
      if (currentEvent && currentDivision) {
        pushRecentlyViewedAndNotify({
          kind: 'team-aes',
          eventKey: currentEvent.Key,
          divisionId: currentDivision.DivisionId,
          teamId: team.TeamId,
          label: team.TeamText || team.TeamName,
          subtitle: `${currentDivision.Name} — ${currentEvent.Name}`,
          divisionColorHex: currentDivision.ColorHex,
          touchedAt: Date.now(),
        });
      }
    },
    [navigate, currentEvent, currentDivision]
  );

  const onScoutOpponent = useCallback(
    (opponentTeamId: number, opponentName: string) => {
      setScoutParams({ opponentTeamId, opponentName });
      navigate('OpponentScout');
    },
    [navigate]
  );

  const navigateToTeam = useCallback(
    async (teamId: number, teamName: string) => {
      if (!currentEvent || !currentDivision) return;
      // Already viewing this team
      if (currentTeam?.TeamId === teamId && screen === 'TeamDashboard') return;

      try {
        const teams = await getTeamAssignments(
          currentEvent.Key,
          currentDivision.DivisionId,
          null,
          [teamId]
        );
        const teamAssignment = teams.find((t) => t.TeamId === teamId);
        if (!teamAssignment) {
          Alert.alert('Error', `Could not load ${teamName}`);
          return;
        }
        setCurrentTeam(teamAssignment);
        navigate('TeamDashboard');
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to load team');
      }
    },
    [currentEvent, currentDivision, currentTeam, screen, navigate]
  );

  // Navigate to a team from court schedule — needs division ID + team text
  const navigateToTeamByText = useCallback(
    async (divisionId: number, teamText: string) => {
      if (!currentEvent) return;
      try {
        // Find the division object from the event
        const division = currentEvent.Divisions?.find(
          (d) => d.DivisionId === divisionId
        );
        if (!division) {
          Alert.alert('Error', 'Could not find division');
          return;
        }
        // Fetch all teams in this division and find by text match
        const allTeams = await getTeamAssignments(
          currentEvent.Key,
          divisionId,
          null
        );
        const search = teamText.toLowerCase().trim();
        // Normalize: collapse whitespace, strip common separators for fuzzy matching
        const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
        const searchNorm = normalize(teamText);
        // Try exact match on TeamText first, then TeamName, TeamCode, then partial matches
        const teamAssignment =
          allTeams.find((t) => normalize(t.TeamText || '') === searchNorm) ||
          allTeams.find((t) => normalize(t.TeamName || '') === searchNorm) ||
          allTeams.find((t) => normalize(t.TeamCode || '') === searchNorm) ||
          allTeams.find((t) => normalize(t.SearchableTeamName || '') === searchNorm) ||
          allTeams.find((t) => normalize(t.TeamText || '').includes(searchNorm)) ||
          allTeams.find((t) => searchNorm.includes(normalize(t.TeamText || '')) && (t.TeamText || '').length > 3) ||
          allTeams.find((t) => normalize(t.TeamName || '').includes(searchNorm)) ||
          allTeams.find((t) => searchNorm.includes(normalize(t.TeamName || '')) && (t.TeamName || '').length > 3);
        if (!teamAssignment) {
          Alert.alert('Error', `Could not find team: ${teamText}`);
          return;
        }
        setCurrentDivision(division);
        setCurrentTeam(teamAssignment);
        navigate('TeamDashboard');
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to load team');
      }
    },
    [currentEvent, navigate]
  );

  const handleNavigateToFavorite = useCallback(
    async (fav: FavoriteTeam) => {
      // Timu favorites: route to TimuTeamDashboard using lastTid.
      if (fav.source === 'timu') {
        const tid = fav.lastTid;
        if (!tid) {
          Alert.alert(
            'Missing tournament',
            `We don't have a tournament id for ${fav.teamName}. Re-open the team from a Timu tournament to refresh the link.`
          );
          return;
        }
        setCurrentTimuTid(tid);
        setCurrentTimuTeamName(fav.teamName);
        setCurrentEvent(null);
        setCurrentDivision(null);
        setCurrentTeam(null);
        setScreenHistory((prev) => [...prev, screen]);
        setScreen('TimuTeamDashboard');
        pushRecentlyViewedAndNotify({
          kind: 'team-timu',
          tid,
          teamName: fav.teamName,
          label: fav.teamName,
          subtitle: fav.eventName,
          touchedAt: Date.now(),
        });
        return;
      }

      // Guard: make sure the favorite has the fields we need
      if (!fav || !fav.eventKey || !fav.divisionId || !fav.teamId) {
        Alert.alert('Error', 'This favorite is missing data. Try removing and re-adding it.');
        return;
      }

      // Skip if already viewing this exact team
      if (
        currentTeam?.TeamId === fav.teamId &&
        currentEvent?.Key === fav.eventKey &&
        screen === 'TeamDashboard'
      ) {
        return;
      }

      setNavigatingToFav(true);
      try {
        // Gather ALL data before updating any state to avoid intermediate
        // renders with mismatched division/team while API calls are in flight.
        let event = currentEvent;
        if (!event || event.Key !== fav.eventKey) {
          event = await getEvent(fav.eventKey);
        }

        const division = event.Divisions.find(
          (d) => d.DivisionId === fav.divisionId
        );
        if (!division) {
          Alert.alert('Error', 'Division not found in this event.');
          return;
        }

        const teams = await getTeamAssignments(
          fav.eventKey,
          fav.divisionId,
          null,
          [fav.teamId]
        );
        const teamAssignment = teams.find((t) => t.TeamId === fav.teamId);
        if (!teamAssignment) {
          Alert.alert('Error', 'Team not found in this division.');
          return;
        }

        // Now apply all state updates together in a single batch so the
        // TeamDashboard never sees a half-updated event/division/team combo.
        setCurrentEvent(event);
        setCurrentDivision(division);
        setCurrentTeam(teamAssignment);
        setScreenHistory((prev) => [...prev, screen]);
        setScreen('TeamDashboard');

        // Save event to recent list if new
        setSavedEvents((prev) => {
          if (prev.some((e) => e.key === event!.Key)) return prev;
          return [
            ...prev,
            {
              key: event!.Key,
              name: event!.Name,
              startDate: event!.StartDate,
              endDate: event!.EndDate,
              location: event!.Location,
            },
          ];
        });
        pushRecentlyViewedAndNotify({
          kind: 'team-aes',
          eventKey: fav.eventKey,
          divisionId: fav.divisionId,
          teamId: fav.teamId,
          label: fav.teamText || fav.teamName,
          subtitle: `${fav.divisionName} — ${fav.eventName}`,
          divisionColorHex: fav.divisionColorHex,
          touchedAt: Date.now(),
        });
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to load team data');
      } finally {
        setNavigatingToFav(false);
      }
    },
    [currentEvent, currentTeam, screen]
  );

  const handleMenuNavigate = useCallback(
    (dest: MenuDestination) => {
      switch (dest) {
        case 'Home':
          // "Home" is now the legacy "Browse tournaments" entry — always
          // routes to TournamentSelect. The new landing screen for users
          // with teams is reachable via the dedicated MyHome destination.
          setScreen('TournamentSelect');
          setScreenHistory([]);
          setCurrentEvent(null);
          setCurrentDivision(null);
          setCurrentTeam(null);
          setSelectedCountry(null);
          setSelectedTournament(null);
          setSelectedTournamentYear(null);
          break;
        case 'MyHome':
          setScreen('MyHome');
          setScreenHistory([]);
          setCurrentEvent(null);
          setCurrentDivision(null);
          setCurrentTeam(null);
          break;
        case 'AddTeamChooser':
          setScreenHistory((prev) => [...prev, screen]);
          setScreen('AddTeamChooser');
          break;
        case 'MrsConnection':
          setScreenHistory((prev) => [...prev, screen]);
          setScreen('MrsConnection');
          break;
        case 'CacConnection':
          setScreenHistory((prev) => [...prev, screen]);
          setScreen('CacConnection');
          break;
        case 'MyTeams':
          setScreenHistory((prev) => [...prev, screen]);
          setScreen('MyTeams');
          break;
        case 'TeamDashboard':
          if (currentTeam) {
            setScreenHistory((prev) => [...prev, screen]);
            setScreen('TeamDashboard');
          }
          break;
        case 'TeamSearch':
          if (currentEvent) {
            setScreenHistory((prev) => [...prev, screen]);
            setScreen('TeamSearch');
          }
          break;
        case 'Standings':
          if (currentDivision) {
            setScreenHistory((prev) => [...prev, screen]);
            setScreen('Standings');
          }
          break;
        case 'Brackets':
          if (currentDivision) {
            setScreenHistory((prev) => [...prev, screen]);
            setScreen('Brackets');
          }
          break;
        case 'CourtSchedule':
          if (currentEvent) {
            setScreenHistory((prev) => [...prev, screen]);
            setScreen('CourtSchedule');
          }
          break;
        case 'VenueMap':
          // Auto-populate court highlighting from current team's next match
          if (currentTeam?.NextMatch?.Court?.Name) {
            setHighlightCourt(currentTeam.NextMatch.Court.Name);
            setCourtMatchInfo({
              opponentName: currentTeam.OpponentTeamText || currentTeam.OpponentTeamName || 'TBD',
              time: currentTeam.NextMatch.ScheduledStartDateTime
                ? new Date(currentTeam.NextMatch.ScheduledStartDateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '',
            });
          } else {
            setHighlightCourt(undefined);
            setCourtMatchInfo(undefined);
          }
          // Set venue info page URL from current tournament context
          if (selectedTournamentYear) {
            // Find the current event's infoPageUrl, falling back to year-level
            const currentEventKey = currentEvent?.Key;
            const matchingEvent = currentEventKey
              ? selectedTournamentYear.events.find((e) => e.key === currentEventKey)
              : undefined;
            setVenueInfoPageUrl(
              matchingEvent?.infoPageUrl || selectedTournamentYear.infoPageUrl
            );
            setVenueMapUrl(
              matchingEvent?.venueMapUrl || selectedTournamentYear.venueMapUrl
            );
          }
          setScreenHistory((prev) => [...prev, screen]);
          setScreen('VenueMap');
          break;
        case 'LiveScoreboard':
          if (currentDivision) {
            setScreenHistory((prev) => [...prev, screen]);
            setScreen('LiveScoreboard');
          }
          break;
        case 'ClubView':
          if (currentEvent) {
            setScreenHistory((prev) => [...prev, screen]);
            setScreen('ClubView');
          }
          break;
        case 'TournamentHistory':
          setScreenHistory((prev) => [...prev, screen]);
          setScreen('TournamentHistory');
          break;
        case 'TeamNotes':
          if (currentTeam) {
            setScreenHistory((prev) => [...prev, screen]);
            setScreen('TeamNotes');
          }
          break;
        case 'Scoreboard':
          setScreenHistory((prev) => [...prev, screen]);
          setScreen('Scoreboard');
          break;
        case 'MatchList':
          setScreenHistory((prev) => [...prev, screen]);
          setScreen('MatchList');
          break;
        case 'TimuTournament':
          if (currentTimuTid) {
            setScreenHistory((prev) => [...prev, screen]);
            setScreen('TimuTournament');
          }
          break;
        case 'TimuTeamDashboard':
          if (currentTimuTid && currentTimuTeamName) {
            setScreenHistory((prev) => [...prev, screen]);
            setScreen('TimuTeamDashboard');
          }
          break;
        case 'AddTournaments':
          setScreenHistory((prev) => [...prev, screen]);
          setScreen('AddTournaments');
          break;
        case 'SeasonHistory':
          if (myTeam) {
            setCurrentHistoryTeamName(
              myTeam.teamText || myTeam.teamName || ''
            );
            setScreenHistory((prev) => [...prev, screen]);
            setScreen('SeasonHistory');
          }
          break;
        case 'OvaRankings':
          setOvaInitialDivision(null);
          setScreenHistory((prev) => [...prev, screen]);
          setScreen('OvaRankings');
          break;
        case 'TeamAnalytics': {
          // Routes to the active team's Stats dashboard. The hamburger
          // gates this entry on `activeTeamId`, but defensively re-check
          // here so a stale render doesn't navigate into a blank screen.
          const activeTeam = userProfile?.activeTeamId
            ? userProfile.teams.find((t) => t.id === userProfile.activeTeamId) ?? null
            : null;
          if (activeTeam) {
            setStatsTeamProfileId(activeTeam.id);
            setStatsTeamName(activeTeam.label);
            setScreenHistory((prev) => [...prev, screen]);
            setScreen('Stats');
          }
          break;
        }
      }
    },
    [screen, currentEvent, currentDivision, currentTeam, currentTimuTid, currentTimuTeamName, myTeam, userProfile]
  );

  // ── Bottom tab handler ─────────────────────────────────────────────────
  // A tab tap is a destination switch: clear screenHistory + context, set
  // the screen to the matching home destination.
  const handleTabSelect = useCallback((tab: TabKey) => {
    setScreenHistory([]);
    setCurrentEvent(null);
    setCurrentDivision(null);
    setCurrentTeam(null);
    setSelectedCountry(null);
    setSelectedTournament(null);
    setSelectedTournamentYear(null);
    if (tab === 'home') setScreen('MyHome');
    else if (tab === 'browse') setScreen('TournamentSelect');
    else if (tab === 'tools') setScreen('Tools');
  }, []);

  // ── Recently-viewed open ──────────────────────────────────────────────
  // Routes by kind. AES team routes through handleNavigateToFavorite (which
  // re-fetches the event/division). Timu paths set state and jump directly.
  const handleOpenRecent = useCallback(
    async (item: RecentItem) => {
      if (item.kind === 'team-aes') {
        handleNavigateToFavorite({
          source: 'aes',
          eventKey: item.eventKey,
          eventName: '',
          teamId: item.teamId,
          teamName: item.label,
          teamText: item.label,
          teamCode: '',
          clubName: '',
          divisionId: item.divisionId,
          divisionName: '',
          divisionColorHex: item.divisionColorHex || '',
        });
      } else if (item.kind === 'team-timu') {
        setCurrentTimuTid(item.tid);
        setCurrentTimuTeamName(item.teamName);
        setCurrentEvent(null);
        setCurrentDivision(null);
        setCurrentTeam(null);
        setScreenHistory((prev) => [...prev, screen]);
        setScreen('TimuTeamDashboard');
      } else if (item.kind === 'tournament-aes') {
        try {
          const event = await getEvent(item.eventKey);
          setCurrentEvent(event);
          setCurrentDivision(null);
          setCurrentTeam(null);
          setScreenHistory((prev) => [...prev, screen]);
          setScreen('DivisionSelect');
        } catch (err: any) {
          Alert.alert('Error', err?.message || 'Failed to load event');
        }
      } else if (item.kind === 'tournament-timu') {
        setCurrentTimuTid(item.tid);
        setCurrentTimuTeamName(null);
        setScreenHistory((prev) => [...prev, screen]);
        setScreen('TimuTournament');
      }
    },
    [screen, handleNavigateToFavorite]
  );

  // ── Global search result open ─────────────────────────────────────────
  const handleGlobalSearchSelect = useCallback(
    (result: GlobalSearchResult) => {
      if (result.kind === 'aes-team') {
        handleNavigateToFavorite({
          source: 'aes',
          eventKey: result.eventKey,
          eventName: result.eventName,
          teamId: result.teamId,
          teamName: result.teamName,
          teamText: result.teamText || result.teamName,
          teamCode: '',
          clubName: result.clubName || '',
          divisionId: result.divisionId,
          divisionName: result.divisionName,
          divisionColorHex: result.divisionColorHex || '',
        });
      } else if (result.kind === 'timu-team') {
        setCurrentTimuTid(result.tid);
        setCurrentTimuTeamName(result.teamName);
        setCurrentEvent(null);
        setCurrentDivision(null);
        setCurrentTeam(null);
        setScreenHistory([]);
        setScreen('TimuTeamDashboard');
        pushRecentlyViewedAndNotify({
          kind: 'team-timu',
          tid: result.tid,
          teamName: result.teamName,
          label: result.teamName,
          subtitle: result.tournamentName,
          touchedAt: Date.now(),
        });
      } else if (result.kind === 'profile-team') {
        handleSwitchActiveTeam(result.team.id);
        if (result.team.primaryRef) {
          handleNavigateToFavorite(result.team.primaryRef);
        } else {
          setScreenHistory([]);
          setScreen('MyHome');
        }
      }
    },
    [handleNavigateToFavorite, handleSwitchActiveTeam]
  );

  const darkHeaderScreens: Screen[] = [
    'TeamSearch',
    'TeamDashboard',
    'MyTeams',
    'OpponentScout',
    'LiveScoreboard',
    'ClubView',
    'TournamentHistory',
    'TeamNotes',
    'TimuTournament',
    'TimuTeamDashboard',
    'TimuOpponentScout',
    'AddTournaments',
    'SeasonHistory',
    'OvaRankings',
    'GlobalSearch',
  ];

  const toggleFavorite = useCallback(
    (team: FavoriteTeam) => {
      let willAdd = false;
      setFavoriteTeams((prev) => {
        const exists = prev.some(
          (f) => f.teamId === team.teamId && f.eventKey === team.eventKey
        );
        willAdd = !exists;
        if (exists) {
          return prev.filter(
            (f) =>
              !(f.teamId === team.teamId && f.eventKey === team.eventKey)
          );
        }
        return [...prev, team];
      });
      // Phase 4: when adding a favorite, also append the team to the
      // user's profile as a 'watching' TeamProfile so it shows up on
      // MyHome's Watching section without waiting for next launch.
      // Removing a favorite does NOT auto-remove the watching profile —
      // the user can explicitly remove it via the team-management UI.
      if (willAdd) {
        setUserProfile((prev) => {
          if (!prev) return prev;
          const { profile: next, teamId } = addWatchingTeamProfile(prev, team);
          // Kick off auto-discovery for the freshly-added team so its
          // SeasonHistory populates without the user having to visit
          // every event manually. Best-effort, runs in background.
          if (teamId) {
            const added = next.teams.find((t) => t.id === teamId);
            if (added) {
              handleAutoDiscoverTeam(added).catch(() => {
                /* swallow — already best-effort */
              });
            }
          }
          return next;
        });
      }
    },
    [handleAutoDiscoverTeam]
  );

  const isFavorite = useCallback(
    (teamId: number, eventKey: string) =>
      favoriteTeams.some(
        (f) => f.teamId === teamId && f.eventKey === eventKey
      ),
    [favoriteTeams]
  );

  function renderScreen() {
    switch (screen) {
      case 'MyHome':
        if (!userProfile) {
          // Profile still loading on first paint — fall through to the
          // browse path so the user isn't stuck on a blank screen.
          return (
            <TournamentSelectScreen
              onTournamentSelected={onTournamentSelected}
              initialRegistry={discoveredRegistry}
            />
          );
        }
        return (
          <MyHomeScreen
            profile={userProfile}
            onOpenTeam={(team) => {
              handleSwitchActiveTeam(team.id);
              openTeamSeasonHistory({ team });
            }}
            syncing={timuSyncing}
            syncProgress={timuSyncProgress}
            onSyncSeason={handleSyncSeason}
            discoveringTeamLabel={discoveringTeamLabel}
            discoveryProgress={discoveryProgress}
            discoveryResult={discoveryResult}
            onDismissDiscoveryResult={() => setDiscoveryResult(null)}
            onViewDiscoveryResult={() => {
              if (!discoveryResult) return;
              const r = discoveryResult;
              setDiscoveryResult(null);
              const team = userProfile?.teams.find((t) => t.id === r.teamId);
              if (team) {
                openTeamSeasonHistory({ team });
              } else {
                openTeamSeasonHistory({ fallbackName: r.teamLabel });
              }
            }}
            onLongPressTeam={handleLongPressTeam}
            onAddTeam={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('AddTeamChooser');
            }}
            onOpenMrsConnection={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('MrsConnection');
            }}
            onOpenCacConnection={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('CacConnection');
            }}
            onOpenRecent={handleOpenRecent}
            onOpenAnalytics={(team) => {
              setStatsTeamProfileId(team.id);
              setStatsTeamName(team.label);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('Stats');
            }}
          />
        );
      case 'AddTeamChooser':
        return (
          <AddTeamChooserScreen
            onBack={goBack}
            onChooseAes={() => {
              // AES path → existing TournamentSelect → EventEntry → ...
              // After the user picks a team, "Set As My Team" upserts
              // their TeamProfile through Phase 2's wrapper.
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('TournamentSelect');
            }}
            onChooseTimu={() => {
              // Timu path → AddTournaments where they paste a URL/tid.
              // From the indexed tournament they tap into the team and
              // hit "Set As My Team" the same way.
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('AddTournaments');
            }}
          />
        );
      case 'MrsConnection':
        return (
          <ConnectionScreen
            config={MRS_CONFIG}
            connected={!!userProfile?.mrsLinked}
            onBack={goBack}
            onConnect={() => {
              // First post-login navigation event — flip the flag.
              setUserProfile((prev) =>
                prev ? { ...prev, mrsLinked: true, updatedAt: Date.now() } : prev
              );
            }}
            onDisconnect={() => {
              setUserProfile((prev) =>
                prev
                  ? {
                      ...prev,
                      mrsLinked: false,
                      mrsMemberId: undefined,
                      updatedAt: Date.now(),
                    }
                  : prev
              );
            }}
          />
        );
      case 'CacConnection':
        return (
          <ConnectionScreen
            config={CAC_LOCKER_CONFIG}
            connected={!!userProfile?.cacLinked}
            onBack={goBack}
            onConnect={() => {
              setUserProfile((prev) =>
                prev ? { ...prev, cacLinked: true, updatedAt: Date.now() } : prev
              );
            }}
            onDisconnect={() => {
              setUserProfile((prev) =>
                prev
                  ? {
                      ...prev,
                      cacLinked: false,
                      coach: undefined,
                      updatedAt: Date.now(),
                    }
                  : prev
              );
            }}
          />
        );
      case 'TournamentSelect':
        return (
          <TournamentSelectScreen
            onTournamentSelected={onTournamentSelected}
          />
        );
      case 'EventEntry':
        return (
          <EventEntryScreen
            onEventLoaded={onEventLoaded}
            onViewVenueMap={(mapUrl?: string, infoPageUrl?: string) => {
              setVenueMapUrl(mapUrl);
              setVenueInfoPageUrl(infoPageUrl);
              navigate('VenueMap');
            }}
            onBack={goBack}
            savedEvents={savedEvents}
            country={selectedCountry!}
            tournament={selectedTournament!}
            tournamentYear={selectedTournamentYear!}
          />
        );
      case 'DivisionSelect':
        return (
          <DivisionSelectScreen
            event={currentEvent!}
            onDivisionSelected={onDivisionSelected}
            onBack={goBack}
            onSearchTeams={() => navigate('TeamSearch')}
          />
        );
      case 'TeamSelect':
        return (
          <TeamSelectScreen
            event={currentEvent!}
            division={currentDivision!}
            onTeamSelected={onTeamSelected}
            onBack={goBack}
            isFavorite={(teamId) => isFavorite(teamId, currentEvent!.Key)}
          />
        );
      case 'TeamSearch':
        return (
          <TeamSearchScreen
            event={currentEvent!}
            onTeamSelected={(division, team) => {
              setCurrentDivision(division);
              setCurrentTeam(team);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('TeamDashboard');
            }}
            onBack={goBack}
          />
        );
      case 'TeamDashboard':
        return (
          <TeamDashboardScreen
            key={`td-${currentEvent?.Key}-${currentDivision?.DivisionId}-${currentTeam?.TeamId}`}
            event={currentEvent!}
            division={currentDivision!}
            team={currentTeam!}
            onBack={goBack}
            onViewStandings={() => navigate('Standings')}
            onViewCourtSchedule={() => navigate('CourtSchedule')}
            onViewBrackets={(playId?: number) => {
              setBracketPlayId(playId);
              navigate('Brackets');
            }}
            onScoutOpponent={onScoutOpponent}
            isFavorite={isFavorite(currentTeam!.TeamId, currentEvent!.Key)}
            onToggleFavorite={() =>
              toggleFavorite({
                eventKey: currentEvent!.Key,
                eventName: currentEvent!.Name,
                teamId: currentTeam!.TeamId,
                teamName: currentTeam!.TeamName,
                teamText: currentTeam!.TeamText,
                teamCode: currentTeam!.TeamCode,
                clubName: currentTeam!.TeamClub.Name,
                divisionId: currentDivision!.DivisionId,
                divisionName: currentDivision!.Name,
                divisionColorHex: currentDivision!.ColorHex,
              })
            }
            isMyTeam={
              !!myTeam &&
              myTeam.teamId === currentTeam!.TeamId &&
              myTeam.eventKey === currentEvent!.Key
            }
            onSetAsMyTeam={handleSetMyTeam}
            onClearMyTeam={handleClearMyTeam}
            onViewSeasonHistory={(_name) => {
              // Use openTeamSeasonHistory so we get this team's aliases.
              if (myTeam) {
                openTeamSeasonHistory({ fav: myTeam });
              } else if (currentTeam) {
                const fallback = currentTeam.TeamText || currentTeam.TeamName || 'My Team';
                openTeamSeasonHistory({ fallbackName: fallback });
              }
            }}
          />
        );
      case 'MyTeams':
        return (
          <MyTeamsScreen
            myTeam={myTeam}
            favoriteTeams={favoriteTeams}
            onNavigateToTeam={(fav: FavoriteTeam) => openTeamSeasonHistory({ fav })}
            onBack={goBack}
          />
        );
      case 'Standings':
        return (
          <StandingsScreen
            event={currentEvent!}
            division={currentDivision!}
            myTeamId={currentTeam?.TeamId}
            onBack={goBack}
          />
        );
      case 'CourtSchedule':
        return (
          <CourtScheduleScreen
            event={currentEvent!}
            myTeamId={currentTeam?.TeamId}
            myTeamText={currentTeam?.TeamText}
            myDivisionId={currentDivision?.DivisionId}
            onBack={goBack}
            onTeamPress={navigateToTeamByText}
          />
        );
      case 'OpponentScout':
        return (
          <OpponentScoutScreen
            event={currentEvent!}
            division={currentDivision!}
            opponentTeamId={scoutParams!.opponentTeamId}
            opponentName={scoutParams!.opponentName}
            onBack={goBack}
          />
        );
      case 'Brackets':
        return (
          <BracketScreen
            event={currentEvent!}
            division={currentDivision!}
            myTeamId={currentTeam?.TeamId}
            onBack={goBack}
            initialPlayId={bracketPlayId}
            onTeamPress={navigateToTeam}
          />
        );
      case 'LiveScoreboard':
        return (
          <LiveScoreboardScreen
            event={currentEvent!}
            division={currentDivision!}
            myTeamId={currentTeam?.TeamId}
            myTeamText={currentTeam?.TeamText}
            onBack={goBack}
            onTeamPress={navigateToTeamByText}
          />
        );
      case 'ClubView':
        return (
          <ClubViewScreen
            event={currentEvent!}
            clubName={currentTeam?.TeamClub?.Name}
            onBack={goBack}
            onTeamPress={navigateToTeamByText}
          />
        );
      case 'TournamentHistory': {
        // Derive aliases from the active team context. Match the team
        // currently being viewed (AES `currentTeam` if set, otherwise the
        // Timu team-name in scope) to the user's saved TeamProfile so
        // the strict alias matcher in `buildMySeasonHistory` finds every
        // indexed snapshot — both AES and Timu — that belongs to this
        // team. Falls back to the bare team-name list when no profile
        // matches (still works for any team that's been indexed under
        // the same spelling).
        const teamName =
          currentTeam?.TeamName ?? currentTimuTeamName ?? null;
        const teamText = currentTeam?.TeamText ?? null;
        const profileMatch = teamName
          ? userProfile?.teams.find((t) => {
              const lower = teamName.toLowerCase().trim();
              return (
                t.label.toLowerCase().trim() === lower ||
                t.aliases.some(
                  (a) => a.toLowerCase().trim() === lower
                )
              );
            })
          : null;
        const aliases =
          profileMatch?.aliases?.length
            ? profileMatch.aliases
            : ([teamName, teamText].filter(Boolean) as string[]);
        return (
          <CrossTournamentScreen
            aliases={aliases}
            headerLabel={teamName ?? undefined}
            onBack={goBack}
          />
        );
      }
      case 'Scoreboard':
        return <ScoreboardScreen onBack={goBack} />;
      case 'MatchList':
        return (
          <MatchListScreen
            onBack={goBack}
            onNewMatch={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('MatchSetup');
            }}
            onOpenMatch={(m) => {
              setActiveScoredMatch(m);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('MatchScoring');
            }}
            onOpenStats={(profileId, name) => {
              setStatsTeamProfileId(profileId);
              setStatsTeamName(name);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('Stats');
            }}
          />
        );
      case 'MatchSetup': {
        // Home team pre-fill: the user's currently-active TeamProfile
        // (if they have one). Roster picker hints + inline "Add players"
        // link both key off this. Away stays manual entry in v1.
        const activeTeam = userProfile?.activeTeamId
          ? userProfile.teams.find((t) => t.id === userProfile.activeTeamId) ?? null
          : null;
        return (
          <MatchSetupScreen
            onCancel={goBack}
            onStart={async (m) => {
              // Persist immediately so a refresh / crash mid-setup
              // doesn't lose what the scorer just typed.
              await saveScoredMatch(m).catch(() => {});
              setActiveScoredMatch(m);
              setScreenHistory((prev) => [...prev, 'MatchList']);
              setScreen('MatchScoring');
            }}
            homeTeamProfile={activeTeam}
            onOpenRosterEditor={handleOpenRosterEditor}
          />
        );
      }
      case 'TeamRoster': {
        const team = rosterEditTeamId
          ? userProfile?.teams.find((t) => t.id === rosterEditTeamId) ?? null
          : null;
        if (!team) {
          // Defensive: profile may have been reset out from under us.
          // Bounce back rather than render an empty editor.
          goBack();
          return null;
        }
        return (
          <TeamRosterScreen
            team={team}
            onCancel={() => {
              setRosterEditTeamId(null);
              goBack();
            }}
            onSave={(next) => {
              handleSaveRoster(team.id, next);
              setRosterEditTeamId(null);
              goBack();
            }}
          />
        );
      }
      case 'MatchScoring':
        if (!activeScoredMatch) return null;
        return (
          <MatchScoringScreen
            initialMatch={activeScoredMatch}
            onBack={() => {
              setActiveScoredMatch(null);
              setScreenHistory([]);
              setScreen('MatchList');
            }}
          />
        );
      case 'Stats':
        return (
          <StatsScreen
            teamProfileId={statsTeamProfileId}
            teamName={statsTeamName}
            onBack={goBack}
            onOpenPlayer={(shirt, name) => {
              setPlayerDetailShirt(shirt);
              setPlayerDetailName(name);
              setScreenHistory((prev) => [...prev, 'Stats']);
              setScreen('PlayerDetail');
            }}
            onOpenTournament={(name, matchIds) => {
              setTournamentDetailName(name);
              setTournamentDetailMatchIds(matchIds);
              setScreenHistory((prev) => [...prev, 'Stats']);
              setScreen('TournamentDetail');
            }}
          />
        );
      case 'PlayerDetail':
        return (
          <PlayerDetailScreen
            teamProfileId={statsTeamProfileId}
            teamName={statsTeamName}
            shirt={playerDetailShirt}
            initialName={playerDetailName}
            onBack={goBack}
          />
        );
      case 'TournamentDetail':
        return (
          <TournamentDetailScreen
            teamProfileId={statsTeamProfileId}
            teamName={statsTeamName}
            tournamentName={tournamentDetailName}
            matchIds={tournamentDetailMatchIds}
            onBack={goBack}
            onOpenPlayer={(shirt, name) => {
              setPlayerDetailShirt(shirt);
              setPlayerDetailName(name);
              setScreenHistory((prev) => [...prev, 'TournamentDetail']);
              setScreen('PlayerDetail');
            }}
          />
        );
      case 'TeamNotes':
        return currentTeam && currentEvent ? (
          <TeamNotesScreen
            eventKey={currentEvent.Key}
            teamId={currentTeam.TeamId}
            teamName={currentTeam.TeamName}
            onBack={goBack}
          />
        ) : null;
      case 'VenueMap':
        return (
          <VenueMapScreen
            onBack={goBack}
            venueMapUrl={venueMapUrl}
            infoPageUrl={venueInfoPageUrl}
            highlightCourt={highlightCourt}
            matchInfo={courtMatchInfo}
          />
        );
      case 'TimuTournament':
        if (!currentTimuTid) return null;
        return (
          <TimuTournamentScreen
            tid={currentTimuTid}
            onBack={goBack}
            onInfoLoaded={onTimuInfoLoaded}
            onTeamPress={handleTimuTeamPress}
            isFavorite={isTimuFavorite}
          />
        );
      case 'TimuTeamDashboard':
        if (!currentTimuTid || !currentTimuTeamName) return null;
        return (
          <TimuTeamDashboardScreen
            tid={currentTimuTid}
            teamName={currentTimuTeamName}
            onBack={goBack}
            onViewAllPools={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('TimuTournament');
            }}
            onViewSchedule={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('TimuTournament');
            }}
            onViewRankings={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('TimuTournament');
            }}
            onNavigateToTeam={(name) => setCurrentTimuTeamName(name)}
            onScoutOpponent={(name) => {
              setCurrentTimuScoutOpponent(name);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('TimuOpponentScout');
            }}
            onViewSeasonHistory={(_name) => {
              if (myTeam) {
                openTeamSeasonHistory({ fav: myTeam });
              } else if (currentTimuTeamName) {
                openTeamSeasonHistory({ fallbackName: currentTimuTeamName });
              }
            }}
            onManageSeason={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('AddTournaments');
            }}
            isFavorite={isTimuFavorite(currentTimuTeamName)}
            onToggleFavorite={() =>
              toggleTimuFavorite(
                currentTimuTeamName,
                savedTimuTournaments.find((t: SavedTimuTournament) => t.tid === currentTimuTid)?.name || ''
              )
            }
            isMyTeam={
              !!myTeam &&
              myTeam.source === 'timu' &&
              myTeam.teamName.toLowerCase().trim() ===
                currentTimuTeamName.toLowerCase().trim()
            }
            onSetAsMyTeam={() =>
              setTimuAsMyTeam(
                currentTimuTeamName,
                savedTimuTournaments.find((t: SavedTimuTournament) => t.tid === currentTimuTid)?.name || ''
              )
            }
            onClearMyTeam={() => setMyTeamAndProfile(null)}
            onInfoLoaded={onTimuInfoLoaded}
          />
        );
      case 'TimuOpponentScout':
        if (!currentTimuTid || !currentTimuScoutOpponent) return null;
        return (
          <TimuOpponentScoutScreen
            tid={currentTimuTid}
            opponentName={currentTimuScoutOpponent}
            myTeamName={currentTimuTeamName || undefined}
            onBack={goBack}
            onNavigateToTeam={(name) => {
              setCurrentTimuTeamName(name);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('TimuTeamDashboard');
            }}
            onNavigateToTournament={(tid) => {
              setCurrentTimuTid(tid);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('TimuTournament');
            }}
            onManageSeason={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('AddTournaments');
            }}
          />
        );
      case 'AddTournaments':
        return (
          <AddTournamentsScreen
            onBack={() => {
              // Clear focus on exit so a re-entry from the hamburger
              // doesn't carry the previous dashboard's source forward.
              setAddTournamentsFocusSource(null);
              goBack();
            }}
            onOpenTid={(tid) => {
              setCurrentTimuTid(tid);
              setCurrentTimuTeamName(null);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('TimuTournament');
            }}
            focusSource={addTournamentsFocusSource ?? undefined}
          />
        );
      case 'OvaRankings':
        return (
          <OvaRankingsScreen
            onBack={goBack}
            initialDivisionKey={ovaInitialDivision?.key}
            initialGender={ovaInitialDivision?.gender}
          />
        );
      case 'SeasonHistory':
        if (!currentHistoryTeamName) return null;
        return (
          <SeasonHistoryScreen
            primaryName={currentHistoryTeamName}
            aliases={currentHistoryAliases}
            onBack={goBack}
            onOpenTimuTournament={(tid, myTeamAsSeen) => {
              setCurrentTimuTid(tid);
              // Use the team's name AS IT APPEARED in this specific
              // tournament (e.g. "Defensa U17 Rob") so the dashboard
              // selects the right pool row. Fall back to the screen's
              // primary alias if the entry didn't carry a captured name.
              setCurrentTimuTeamName(myTeamAsSeen || currentHistoryTeamName);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('TimuTeamDashboard');
            }}
            onOpenAesTournament={(eventKey, divisionId, _myTeamAsSeen) => {
              (async () => {
                try {
                  const event = await getEvent(eventKey);
                  const division = event.Divisions.find((d) => d.DivisionId === divisionId);
                  if (!division) return;
                  let teamId = 0;
                  const matchedFav = favoriteTeams.find(
                    (f) =>
                      f.source !== 'timu' &&
                      f.eventKey === eventKey &&
                      f.divisionId === divisionId
                  );
                  if (matchedFav) teamId = matchedFav.teamId;
                  else if (myTeam && myTeam.source !== 'timu' && myTeam.eventKey === eventKey) {
                    teamId = myTeam.teamId;
                  }
                  if (!teamId) {
                    setCurrentEvent(event);
                    setCurrentDivision(division);
                    setScreenHistory((prev) => [...prev, screen]);
                    setScreen('TeamSelect');
                    return;
                  }
                  const teams = await getTeamAssignments(eventKey, divisionId, null, [teamId]);
                  const teamAssignment = teams.find((t) => t.TeamId === teamId);
                  if (!teamAssignment) {
                    setCurrentEvent(event);
                    setCurrentDivision(division);
                    setScreenHistory((prev) => [...prev, screen]);
                    setScreen('TeamSelect');
                    return;
                  }
                  setCurrentEvent(event);
                  setCurrentDivision(division);
                  setCurrentTeam(teamAssignment);
                  setScreenHistory((prev) => [...prev, screen]);
                  setScreen('TeamDashboard');
                } catch (err: any) {
                  Alert.alert('Error', err?.message || 'Failed to open AES event');
                }
              })();
            }}
            onScoutOpponent={(name) => {
              if (!currentTimuTid) return;
              setCurrentTimuScoutOpponent(name);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('TimuOpponentScout');
            }}
            onManageSeason={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('AddTournaments');
            }}
            onFindMoreTournaments={handleFindMoreForCurrentTeam}
            lastDiscoveryAt={(() => {
              if (!userProfile || !currentHistoryAliases) return undefined;
              const lower = currentHistoryAliases.map((a) => a.toLowerCase().trim());
              const match = userProfile.teams.find((t) =>
                t.aliases.some((a) => lower.includes(a.toLowerCase().trim()))
              );
              return match?.lastDiscoveryAt;
            })()}
            discoveringTeamLabel={discoveringTeamLabel}
            discoveryProgress={discoveryProgress}
            discoveryResult={discoveryResult}
            onDismissDiscoveryResult={() => setDiscoveryResult(null)}
            onViewDiscoveryResult={() => {
              if (!discoveryResult) return;
              const r = discoveryResult;
              setDiscoveryResult(null);
              const team = userProfile?.teams.find((t) => t.id === r.teamId);
              if (team) {
                openTeamSeasonHistory({ team });
              } else {
                openTeamSeasonHistory({ fallbackName: r.teamLabel });
              }
            }}
          />
        );
      case 'Tools':
        return (
          <ToolsScreen
            profile={userProfile}
            onOpenMrsConnection={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('MrsConnection');
            }}
            onOpenCacConnection={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('CacConnection');
            }}
            onOpenScoreAMatch={() => {
              // Score-a-Match screen ships with the parallel Tier 2 work.
              // The row is gated on userProfile.scorerMode so this handler
              // only runs once that toggle is on. Until the screen lands,
              // surface a placeholder so the tap isn't silent.
              Alert.alert(
                'Score a Match',
                'The scoring console ships with the Tier 2 update.'
              );
            }}
          />
        );
      case 'GlobalSearch':
        return (
          <GlobalSearchScreen
            profile={userProfile}
            onBack={goBack}
            onSelect={handleGlobalSearchSelect}
          />
        );
      default:
        return null;
    }
  }

  const handleOpenGlobalSearch = useCallback(() => {
    setScreenHistory((prev) => [...prev, screen]);
    setScreen('GlobalSearch');
  }, [screen]);

  return (
    <ThemeContext.Provider value={themeContextValue}>
    <SafeAreaProvider>
      <AppContent
        renderScreen={renderScreen}
        handleMenuNavigate={handleMenuNavigate}
        handleNavigateToFavorite={handleNavigateToFavorite}
        handleOpenFavoriteSeasonHistory={(fav: FavoriteTeam) =>
          openTeamSeasonHistory({ fav })
        }
        handleRemoveFavorite={handleRemoveFavorite}
        currentEvent={currentEvent}
        currentDivision={currentDivision}
        currentTeam={currentTeam}
        currentTimuTid={currentTimuTid}
        currentTimuTeamName={currentTimuTeamName}
        savedTimuTournaments={savedTimuTournaments}
        screen={screen}
        darkHeaderScreens={darkHeaderScreens}
        myTeam={myTeam}
        favoriteTeams={favoriteTeams}
        navigatingToFav={navigatingToFav}
        userProfile={userProfile}
        onTabSelect={handleTabSelect}
        onOpenGlobalSearch={handleOpenGlobalSearch}
        onSwitchTeam={(teamId: string) => {
          handleSwitchActiveTeam(teamId);
          // Land on the team's Season History (matches MyHome's behaviour
          // and the new "team home" model). If the team has nothing linked
          // yet, drop the user back to MyHome so they can add a tournament.
          const team = userProfile?.teams.find((t) => t.id === teamId);
          if (team) {
            openTeamSeasonHistory({ team });
          } else {
            setScreenHistory([]);
            setScreen('MyHome');
          }
        }}
        onToggleScorerMode={(next: boolean) => {
          setUserProfile((prev) =>
            prev ? { ...prev, scorerMode: next, updatedAt: Date.now() } : prev
          );
        }}
        onOpenRosterEditor={handleOpenRosterEditor}
        onTeamMenu={handleLongPressTeam}
      />
      <DiscoveryConfirmModal pending={confirmDiscovery} />
    </SafeAreaProvider>
    </ThemeContext.Provider>
  );
}

// ── Discovery confirmation modal ──────────────────────────────────────────
//
// In-app modal replacing Alert.alert for the "kick off auto-discovery?"
// prompt. Renders the data warning prominently and exposes two clearly
// labelled buttons. The dim backdrop is non-dismissible — the user must
// pick a button — so we never end up in a "what happened to the dialog"
// state.
function DiscoveryConfirmModal({
  pending,
}: {
  pending: { team: TeamProfile; resolve: (v: boolean) => void } | null;
}) {
  if (!pending) return null;
  return (
    <Modal visible transparent animationType="fade">
      <View style={modalStyles.backdrop}>
        <View style={modalStyles.card}>
          <Text style={modalStyles.title}>
            Find tournaments for {pending.team.label}?
          </Text>
          <Text style={modalStyles.body}>
            The app will scan AES and every recent Timu season for every tournament where this team has played.
          </Text>
          <View style={modalStyles.warnBox}>
            <Text style={modalStyles.warnText}>
              ⚠️ The first scan can download up to ~150 MB and take 5–10 minutes (covering several years of Timu data).{'\n'}{'\n'}
              We strongly recommend connecting to Wi-Fi — running this on cellular may use a noticeable amount of data.{'\n'}{'\n'}
              Subsequent scans within a week are much faster because results are cached.
            </Text>
          </View>
          <View style={modalStyles.buttonsRow}>
            <TouchableOpacity
              style={[modalStyles.btn, modalStyles.btnCancel]}
              onPress={() => pending.resolve(false)}
              activeOpacity={0.7}
            >
              <Text style={modalStyles.btnCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[modalStyles.btn, modalStyles.btnConfirm]}
              onPress={() => pending.resolve(true)}
              activeOpacity={0.7}
            >
              <Text style={modalStyles.btnConfirmText}>Search Tournaments</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: '#333',
    marginBottom: 12,
  },
  warnBox: {
    backgroundColor: '#fff3ee',
    borderLeftWidth: 4,
    borderLeftColor: '#ff6b35',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  warnText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#1a1a1a',
  },
  buttonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    minWidth: 100,
    alignItems: 'center',
  },
  btnCancel: {
    backgroundColor: '#f0f0f0',
  },
  btnConfirm: {
    backgroundColor: '#1a73e8',
  },
  btnCancelText: {
    color: '#1a1a1a',
    fontWeight: '700',
    fontSize: 15,
  },
  btnConfirmText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
});

function AppContent({
  renderScreen,
  handleMenuNavigate,
  handleNavigateToFavorite,
  handleOpenFavoriteSeasonHistory,
  handleRemoveFavorite,
  currentEvent,
  currentDivision,
  currentTeam,
  currentTimuTid,
  currentTimuTeamName,
  savedTimuTournaments,
  screen,
  darkHeaderScreens,
  myTeam,
  favoriteTeams,
  navigatingToFav,
  userProfile,
  onSwitchTeam,
  onToggleScorerMode,
  onOpenRosterEditor,
  onTeamMenu,
  onTabSelect,
  onOpenGlobalSearch,
}: any) {
  const insets = useSafeAreaInsets();
  const lightHeader = darkHeaderScreens.includes(screen);
  const showTabBar = !TAB_BAR_HIDDEN_SCREENS.has(screen);
  const showPill =
    !PILL_SUPPRESSED_SCREENS.has(screen) && !!userProfile?.activeTeamId;
  const showSearch = screen === 'MyHome';
  // Reserve space at the bottom for the tab bar so screens don't render
  // under it. Tab bar height is fixed; the safe-area bottom is added inside
  // the bar component itself.
  const screenPaddingBottom = showTabBar
    ? BOTTOM_TAB_BAR_HEIGHT + insets.bottom
    : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style={lightHeader ? 'light' : 'dark'} />
      <View style={{ flex: 1, paddingBottom: screenPaddingBottom }}>
        {renderScreen()}
      </View>
      {navigatingToFav && (
        <View style={styles.favLoadingOverlay}>
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={styles.favLoadingText}>Loading team...</Text>
        </View>
      )}
      {/* Top-left: active-team pill + (on MyHome) search icon. Mirror of
          the right-side hamburger overlay. */}
      <View
        style={[styles.topBarOverlay, { top: insets.top + 8 }]}
        pointerEvents="box-none"
      >
        <TopBar
          userProfile={userProfile}
          onSwitchTeam={onSwitchTeam}
          onOpenSearch={onOpenGlobalSearch}
          showActiveTeamPill={showPill}
          showSearch={showSearch}
          light={lightHeader}
        />
      </View>
      <View style={[styles.menuOverlay, { top: insets.top + 8 }]} pointerEvents="box-none">
        <HamburgerMenu
          onNavigate={handleMenuNavigate}
          onNavigateToFavorite={handleOpenFavoriteSeasonHistory}
          onRemoveFavorite={handleRemoveFavorite}
          hasEvent={!!currentEvent || !!currentTimuTid}
          hasDivision={!!currentDivision}
          hasTeam={!!currentTeam || !!currentTimuTeamName}
          onTimu={!!currentTimuTid}
          currentScreen={screen === 'TournamentSelect' || screen === 'EventEntry' ? 'Home' : screen}
          light={lightHeader}
          eventName={
            currentEvent?.Name ||
            savedTimuTournaments.find((t: SavedTimuTournament) => t.tid === currentTimuTid)?.name ||
            (currentTimuTid ? `Timu tournament ${currentTimuTid}` : undefined)
          }
          divisionName={currentDivision?.Name}
          divisionColor={currentDivision?.ColorHex}
          teamName={
            currentTeam?.TeamText ||
            currentTeam?.TeamName ||
            currentTimuTeamName ||
            undefined
          }
          myTeam={myTeam}
          favoriteTeams={favoriteTeams}
          currentTeamId={currentTeam?.TeamId}
          currentEventKey={
            currentEvent?.Key ||
            (currentTimuTid ? `timu:${currentTimuTid}` : undefined)
          }
          userProfile={userProfile}
          onSwitchTeam={onSwitchTeam}
          onToggleScorerMode={onToggleScorerMode}
          onOpenRosterEditor={onOpenRosterEditor}
          onTeamMenu={onTeamMenu}
          menuContext={menuContextForScreen(screen)}
        />
      </View>
      {showTabBar && (
        <BottomTabBar activeTab={tabForScreen(screen)} onSelect={onTabSelect} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  favLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 50,
  },
  favLoadingText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  menuOverlay: {
    position: 'absolute',
    right: 8,
    zIndex: 100,
    alignItems: 'flex-end',
    // Do not set left/width — keep it tight to the right side
  },
  topBarOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 100,
    // alignItems removed — the TopBar component controls horizontal
    // distribution via its own 3-cell layout (search left / pill centre /
    // hamburger-spacer right) so the pill ends up centred relative to
    // the screen rather than crowding the left edge.
  },
});
