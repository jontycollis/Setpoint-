import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import JontywareSplash from './src/components/JontywareSplash';

// Hold the native splash until our JS-side <JontywareSplash> overlay mounts
// and calls SplashScreen.hideAsync() from its own effect. preventAutoHideAsync
// returns a promise that rejects if the splash has already auto-hidden — the
// catch keeps Fast Refresh / re-runs from crashing the bundle.
SplashScreen.preventAutoHideAsync().catch(() => {});
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
  useColorScheme,
  useWindowDimensions,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TournamentSelectScreen } from './src/screens/TournamentSelectScreen';
import { MyHomeScreen } from './src/screens/MyHomeScreen';
import { LauncherHomeScreen } from './src/screens/LauncherHomeScreen';
import { ScoreboardSectionScreen } from './src/screens/ScoreboardSectionScreen';
import { MyTeamSectionScreen } from './src/screens/MyTeamSectionScreen';
import { SingleTeamSectionScreen } from './src/screens/SingleTeamSectionScreen';
import { BrowseSectionScreen } from './src/screens/BrowseSectionScreen';
import { VenueMapSelectorScreen } from './src/screens/VenueMapSelectorScreen';
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
import { RosterSectionScreen } from './src/screens/RosterSectionScreen';
import { TournamentsSectionScreen } from './src/screens/TournamentsSectionScreen';
import { MatchScoringScreen } from './src/screens/MatchScoringScreen';
import type { Match as ScoredMatch } from './src/types/match';
import {
  saveMatch as saveScoredMatch,
  backfillHomeTeamProfileIds,
} from './src/utils/scoredMatchStore';
import { TimuTournamentScreen } from './src/screens/TimuTournamentScreen';
import { TimuTeamDashboardScreen } from './src/screens/TimuTeamDashboardScreen';
import { TimuOpponentScoutScreen } from './src/screens/TimuOpponentScoutScreen';
import { AddTournamentsScreen } from './src/screens/AddTournamentsScreen';
import { SeasonHistoryScreen } from './src/screens/SeasonHistoryScreen';
import { OvaRankingsScreen } from './src/screens/OvaRankingsScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import { StorageSnapshotScreen } from './src/screens/StorageSnapshotScreen';
import { HistoricalImportScreen } from './src/screens/HistoricalImportScreen';
import { SidelineImportScreen } from './src/screens/SidelineImportScreen';
import { AboutScreen } from './src/screens/AboutScreen';
import { HelpScreen } from './src/screens/HelpScreen';
import type { HelpSectionId } from './src/help/content';
import {
  OnboardingScreen,
  ONBOARDING_STORAGE_KEY,
} from './src/screens/OnboardingScreen';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initSentry, reportError } from './src/utils/sentryInit';
import { OfflineBanner } from './src/components/OfflineBanner';

// Initialize Sentry as early as possible so anything that throws
// during the first render reaches the reporter. A no-op until the
// DSN is filled in (see src/utils/sentryInit.ts).
initSentry();
import { PlayerDetailScreen } from './src/screens/PlayerDetailScreen';
import { TournamentDetailScreen } from './src/screens/TournamentDetailScreen';
import { GlobalSearchScreen } from './src/screens/GlobalSearchScreen';
import type { GlobalSearchResult } from './src/screens/GlobalSearchScreen';
import { HamburgerMenu } from './src/components/HamburgerMenu';
import { HelpButton } from './src/components/HelpButton';
import { HELP_SECTION_IDS } from './src/help/content';
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
  saveMyTeam,
  loadThemeMode,
  saveThemeMode,
  loadSavedTimuTournaments,
  saveSavedTimuTournaments,
} from './src/utils/storage';
import {
  loadOrMigrateUserProfile,
  saveUserProfile,
  findTeamProfileByAlias,
  makeTeamProfileId,
  dedupeAliases,
} from './src/utils/userProfile';
import {
  takePreMigrationSnapshot,
  pruneSnapshots,
} from './src/utils/storageSnapshot';
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
  findEventByKey,
} from './src/config/tournaments';
import type {
  Country,
  Tournament,
  TournamentYear,
} from './src/config/tournaments';
import type { SavedTimuTournament, TimuTournamentInfo } from './src/types/timu';
import type { UnifiedTournamentEntry } from './src/utils/unifiedSeasonHistory';
// Sentry's `wrap()` helper is imported from the package directly; the
// actual `Sentry.init({...})` call lives in `src/utils/sentryInit.ts`
// so all the privacy-conscious config (sendDefaultPii: false, IP-strip
// in beforeSend, release tagging) stays in one place. The wizard's
// default `sendDefaultPii: true` would have violated the privacy
// policy's "we drop IPs" promise, so we intentionally route through
// our wrapper instead of letting the wizard wire init in here.
import * as Sentry from '@sentry/react-native';

type Screen =
  | 'HomeLauncher'
  | 'ScoreboardSection'
  | 'MyTeamSection'
  | 'SingleTeamSection'
  | 'RosterSection'
  | 'TournamentsSection'
  | 'BrowseSection'
  | 'VenueMapSelector'
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
  | 'GlobalSearch'
  | 'StorageSnapshot'
  | 'HistoricalImport'
  | 'SidelineImport'
  | 'Help'
  | 'About';

// AES navigation scope: an event can stand alone (DivisionSelect view), an
// event+division is the standard tournament context, and event+division+team
// is the team-detail context. Stored as one shape to keep transitions atomic.
type AesScope = {
  event: AESEvent;
  division: AESDivision | null;
  team: AESTeamAssignment | null;
};

// ── Bottom tab routing ─────────────────────────────────────────────────────
//
// Two "home destinations" map onto the bottom tab bar. A tab tap is a
// destination switch — caller clears screenHistory and sets `screen` to the
// destination. When the user is "deep" inside a flow (TeamDashboard etc.)
// no tab is highlighted but both tabs remain reachable.
//
// The earlier Tools tab was removed: it was empty for default users and
// duplicated MyHome's Connections section. Its contents (Score a Match,
// MRS, CAC Locker) live in the hamburger now.
function tabForScreen(screen: Screen): TabKey | null {
  // Both the new launcher and the My Team section count as the "home"
  // destination. The Browse section landing maps onto the browse tab so
  // the user gets visual confirmation when they enter via tile or tab.
  if (screen === 'HomeLauncher') return 'home';
  if (screen === 'MyTeamSection') return 'home';
  if (screen === 'SingleTeamSection') return 'home';
  if (screen === 'RosterSection') return 'home';
  if (screen === 'TournamentsSection') return 'home';
  if (screen === 'BrowseSection') return 'browse';
  // Legacy fallbacks — still in the union but not normally entered.
  if (screen === 'MyHome') return 'home';
  if (screen === 'TournamentSelect') return 'browse';
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
  // Launcher + section landings — no team scope, the screens are
  // navigational chrome rather than team-scoped content.
  'HomeLauncher',
  'ScoreboardSection',
  'MyTeamSection',
  'SingleTeamSection',
  'RosterSection',
  'TournamentsSection',
  'BrowseSection',
  'VenueMapSelector',
  // No-team-scope screens
  'MyHome',
  'AddTeamChooser',
  'MrsConnection',
  'CacConnection',
  'TournamentSelect',
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
  'About',
  'Help',
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
    case 'HomeLauncher':
    case 'ScoreboardSection':
    case 'MyTeamSection':
    case 'SingleTeamSection':
    case 'RosterSection':
    case 'TournamentsSection':
    case 'BrowseSection':
    case 'VenueMapSelector':
    case 'MyHome':
    case 'AddTeamChooser':
    case 'MrsConnection':
    case 'CacConnection':
    case 'TournamentSelect':
    case 'EventEntry':
    case 'OvaRankings':
    case 'GlobalSearch':
    case 'StorageSnapshot':
    case 'HistoricalImport':
    case 'SidelineImport':
    case 'Help':
    case 'About':
      return 'home';
    default:
      return 'team';
  }
}

// ── Search visibility ──────────────────────────────────────────────────────
//
// The magnifying-glass icon used to live on MyHome only. Promoted to a
// permanent slot on every screen *except* the focused full-screen flows
// where it would compete for space with the score panels:
//   • MatchSetup / MatchScoring — top-of-screen tools shelves
//   • Scoreboard — Tier 1 hold-up; the team identity is the headline
//   • GlobalSearch — already IS the search screen
const SEARCH_SUPPRESSED_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
  'MatchSetup',
  'MatchScoring',
  'Scoreboard',
  'GlobalSearch',
  // Connection screens have their own slim hero with back / title /
  // status; the search overlay would visually collide with the back
  // button there. The hamburger overlay still appears on the right —
  // we right-pad the connection hero to clear it.
  'MrsConnection',
  'CacConnection',
  // About — slim disclaimer screen; search has no purpose here.
  'About',
  // Help — has its own in-screen search bar.
  'Help',
]);

// ── Pre-migration snapshot guard ──────────────────────────────────────────
// Module-scoped so a hot-reload or a re-render can't cause a second
// snapshot during a single launch. A single snapshot per cold-start is
// the contract the rollback affordance relies on.
let preMigrationSnapshotRan = false;
async function runPreMigrationSnapshotOnce(): Promise<void> {
  if (preMigrationSnapshotRan) return;
  preMigrationSnapshotRan = true;
  try {
    const info = await takePreMigrationSnapshot();
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(
        `[storageSnapshot] took pre-migration snapshot ${info.snapshotKey} — ${info.keys.length} keys, ${info.totalBytes} bytes`
      );
    }
    const deleted = await pruneSnapshots(2);
    if (__DEV__ && deleted > 0) {
      // eslint-disable-next-line no-console
      console.log(`[storageSnapshot] pruned ${deleted} old snapshot(s)`);
    }
  } catch (err) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[storageSnapshot] failed:', err);
    }
  }
}

function AppInner() {
  // Theme mode: follows the OS color scheme by default, but the user's
  // saved preference (if any) wins. The `useColorScheme()` hook re-runs
  // on OS theme change, so users who haven't picked a preference see
  // the app re-theme live when they flip iOS / Android into dark mode.
  const systemScheme = useColorScheme();
  const [userOverride, setUserOverride] = useState<ThemeMode | null>(null);
  const themeMode: ThemeMode =
    userOverride ?? (systemScheme === 'dark' ? 'dark' : 'light');
  const themeColors = themeMode === 'dark' ? darkColors : lightColors;
  const themeContextValue = useMemo(() => ({
    mode: themeMode,
    colors: themeColors,
    toggle: () => {
      const next: ThemeMode = themeMode === 'light' ? 'dark' : 'light';
      setUserOverride(next);
      saveThemeMode(next);
    },
  }), [themeMode, themeColors]);

  const [screen, setScreen] = useState<Screen>('HomeLauncher');
  const [screenHistory, setScreenHistory] = useState<Screen[]>([]);
  // Help deep-link target — set by per-screen ? buttons before navigating
  // to the Help screen. Cleared when the user opens Help via the menu.
  const [helpSectionId, setHelpSectionId] = useState<HelpSectionId | string | undefined>(undefined);

  // ── AES navigation scope ────────────────────────────────────────────────
  // Three nested selections (event → division → team) move together: an
  // AES screen is meaningless without an event, division-only without
  // team is valid (DivisionSelect → TeamSelect transition), and a team
  // implies both. They were previously three useState values updated in
  // lockstep at every transition; bundling them removes the "set two,
  // forget the third" risk and makes intermediate-render guards trivial.
  const [aesScope, setAesScope] = useState<AesScope | null>(null);
  const currentEvent = aesScope?.event ?? null;
  const currentDivision = aesScope?.division ?? null;
  const currentTeam = aesScope?.team ?? null;
  // Tournament selection context
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [selectedTournamentYear, setSelectedTournamentYear] = useState<TournamentYear | null>(null);

  const [savedEvents, setSavedEvents] = useState<SavedEvent[]>([]);
  const [favoriteTeams, setFavoriteTeams] = useState<FavoriteTeam[]>([]);
  // Profile-and-teams layer. `myTeam` (below) is derived from this.
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  // Derived "my team" — single source of truth is the active TeamProfile's
  // primaryRef. The legacy `aes.myTeam` AsyncStorage key is still mirrored
  // by the persistence effect below so other readers (AddTournamentsScreen
  // seeds aliases from it) keep working unchanged.
  const myTeam = useMemo<FavoriteTeam | null>(() => {
    if (!userProfile?.activeTeamId) return null;
    const active = userProfile.teams.find(
      (t) => t.id === userProfile.activeTeamId
    );
    return active?.primaryRef ?? null;
  }, [userProfile]);
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
  // Onboarding gate: `null` while we're still reading AsyncStorage,
  // `true` if the user has already completed the welcome flow, `false`
  // if it needs to show. Splitting "unknown" from "needs-flow" prevents
  // a one-frame flash of the welcome screen for returning users.
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
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
  // TeamRoster screen — which TeamProfile.id is being viewed/edited.
  const [rosterEditTeamId, setRosterEditTeamId] = useState<string | null>(null);
  // When true the TeamRoster screen renders in readOnly mode (entered from
  // "Roster > View"). Cleared on navigation away.
  const [rosterReadOnly, setRosterReadOnly] = useState(false);
  // SingleTeamSection — which TeamProfile.id the per-team launcher is scoped
  // to. Set when the user taps a tile in the My Team(s) team-picker grid.
  const [singleTeamSectionTeamId, setSingleTeamSectionTeamId] = useState<
    string | null
  >(null);
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
  // Long-press team-actions modal target. When set, the action-sheet
  // modal renders for that team; closing it (Cancel, backdrop tap, or
  // any button) clears the target. We use a custom modal rather than
  // Alert.alert because Android's Alert caps at 3 buttons + drops the
  // 4th silently (we'd lose Cancel) and tap-outside dismissal isn't
  // reliable across every Android OEM.
  const [teamActionTarget, setTeamActionTarget] = useState<TeamProfile | null>(null);
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
  // Mirror — the TeamProfile.id behind the hero, when the entry-point had
  // one. SeasonHistoryScreen reads it to render the team avatar (and pick
  // up any user-uploaded override). Null for AES-fav-only entry points.
  const [currentHistoryTeamProfileId, setCurrentHistoryTeamProfileId] = useState<
    string | null
  >(null);
  const [ovaInitialDivision, setOvaInitialDivision] = useState<{ key?: string; gender?: 'girls' | 'boys' } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Pre-migration snapshot — defensive backup BEFORE any code that
        // may re-shape persisted state. Wrapped in try/catch internally
        // so a failure can never block boot. Awaited here because a
        // migration could otherwise race the snapshot read.
        await runPreMigrationSnapshotOnce();
        const [events, favs, savedTheme, timu, profile] = await Promise.all([
          loadSavedEvents(),
          loadFavoriteTeams(),
          loadThemeMode(),
          loadSavedTimuTournaments(),
          loadOrMigrateUserProfile(),
        ]);
        setSavedEvents(events);
        setFavoriteTeams(favs);
        // savedTheme is null when the user has never toggled — leave
        // userOverride null in that case so useColorScheme() drives
        // the theme from the OS setting.
        if (savedTheme) setUserOverride(savedTheme);
        setSavedTimuTournaments(timu);
        setUserProfile(profile);

        // One-shot backfill for matches saved before MatchSetupScreen
        // learned to populate `meta.home.teamProfileId`. Without this,
        // pre-fix matches stay invisible to the analytics dashboard
        // even though their home label matches a TeamProfile.
        backfillHomeTeamProfileIds(profile.teams)
          .then((res) => {
            if (__DEV__) {
              // eslint-disable-next-line no-console
              console.log(
                `[scoredMatchStore] teamProfileId backfill: ${res.backfilled} backfilled, ${res.skipped} skipped`
              );
            }
          })
          .catch(() => {});

        // Launcher-redesign boot: always land on the new tile-grid Home.
        // The launcher routes the user into a section (Scoreboard / My
        // Team / Browse) or a direct WebView (MRS / CAC / Venue maps /
        // OVA Rankings / Help) — boot stays a single decision.
        setScreenHistory([]);
        setScreen('HomeLauncher');
      } catch {
        //
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // Onboarding gate. Runs once on mount in parallel with the main
  // hydration effect above. We don't block hydration on this — the
  // OnboardingScreen is an overlay; once it's dismissed we just flip
  // the flag and let the already-loaded normal UI render through.
  useEffect(() => {
    (async () => {
      try {
        const done = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
        setOnboardingDone(done === '1');
      } catch {
        // If AsyncStorage fails, default to "already done" — better
        // to skip onboarding for returning users than to show it on
        // every launch because of a transient read error.
        setOnboardingDone(true);
      }
    })();
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    setOnboardingDone(true);
    AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, '1').catch(() => {
      // Persistence failure is non-fatal — the worst case is the
      // welcome screen shows again on next launch.
    });
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

  // ── R1: Follow a team picked from OVA Rankings ──────────────────────────
  // Tapping a row on the rankings screen calls back here. If the team
  // alias-matches an existing TeamProfile we offer a re-run instead of
  // a duplicate; otherwise we create a fresh `kind: 'me'` profile and
  // kick off the same auto-discovery flow used by AddTeamChooser.
  const handleFollowOvaRankedTeam = useCallback(
    (params: {
      teamName: string;
      divisionLabel: string;
      alreadyFollowed: boolean;
    }) => {
      if (!userProfile) return;
      const existing = findTeamProfileByAlias(userProfile, params.teamName);
      if (existing) {
        Alert.alert(
          'Already followed',
          `You already follow ${existing.label}. Re-run the AES + Timu tournament search?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Re-run search',
              onPress: () => handleAutoDiscoverTeam(existing, { force: true }),
            },
          ]
        );
        return;
      }
      Alert.alert(
        `Follow ${params.teamName}?`,
        `We'll add this team and search AES and Timu by name to find their tournaments. This usually takes a couple of minutes and downloads a few MB.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Follow',
            onPress: () => {
              const now = Date.now();
              const id = makeTeamProfileId(now);
              const aliases = dedupeAliases([params.teamName]);
              const created: TeamProfile = {
                id,
                label: params.teamName,
                source: 'aes',
                sport: 'indoor',
                kind: 'me',
                aliases,
                seasonLabel: params.divisionLabel || undefined,
                createdAt: now,
                updatedAt: now,
              };
              const nextProfile: UserProfile = {
                ...userProfile,
                teams: [...userProfile.teams, created],
                activeTeamId: id,
                updatedAt: now,
              };
              setUserProfile(nextProfile);
              saveUserProfile(nextProfile).catch(() => {});
              // Kick off discovery immediately. The user can navigate away
              // and a notification fires on completion.
              handleAutoDiscoverTeam(created);
            },
          },
        ]
      );
    },
    [userProfile, handleAutoDiscoverTeam]
  );

  // Manual re-run from Season History's "Find more tournaments" button.
  // Forces past the 6h throttle so users can re-scan after a tournament
  // weekend. We re-resolve the team profile from the current screen's
  // aliases so the right TeamProfile.id ends up on the result banner.
  const handleFindMoreForCurrentTeam = useCallback(() => {
    if (!userProfile) return;
    const aliasSet = currentHistoryAliases || [currentHistoryTeamName].filter(Boolean) as string[];
    if (!aliasSet.length) return;
    let match: TeamProfile | null = null;
    for (const a of aliasSet) {
      match = findTeamProfileByAlias(userProfile, a);
      if (match) break;
    }
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
              // The derived `myTeam` updates automatically: removeTeamProfile
              // reassigns `activeTeamId` (to the next remaining team or null
              // when the removed team was active), so no separate clear is
              // needed here.
            },
          },
        ]
      );
    },
    []
  );

  // Flip a TeamProfile between `'me'` (rolls up into Career, tied to an
  // athlete) and `'watching'` (favorite-style follow only). When promoting
  // to `'me'` we attach the active athlete so Career stats wire up; when
  // demoting we drop `athleteId` to match the existing watching shape.
  // Activates the team if it's becoming the user's own — otherwise a
  // freshly-promoted team would sit invisible behind the active selection.
  const handleToggleTeamKind = useCallback((team: TeamProfile) => {
    setUserProfile((prev) => {
      if (!prev) return prev;
      const nextKind: 'me' | 'watching' = team.kind === 'me' ? 'watching' : 'me';
      const now = Date.now();
      const nextTeams = prev.teams.map((t) => {
        if (t.id !== team.id) return t;
        if (nextKind === 'me') {
          return {
            ...t,
            kind: 'me' as const,
            athleteId: prev.activeAthleteId ?? t.athleteId,
            updatedAt: now,
          };
        }
        // Demoting to watching — drop the athlete tag so it stops counting
        // in Career rollups. `athleteId` is optional on TeamProfile, so
        // omitting the key is the clean way to remove it.
        const { athleteId: _drop, ...rest } = t;
        return {
          ...rest,
          kind: 'watching' as const,
          updatedAt: now,
        };
      });
      const next: UserProfile = {
        ...prev,
        teams: nextTeams,
        // If we just promoted to 'me' and nothing was active, make this
        // team active so it surfaces in MyHome and the hamburger.
        activeTeamId:
          nextKind === 'me' && !prev.activeTeamId ? team.id : prev.activeTeamId,
        updatedAt: now,
      };
      saveUserProfile(next).catch(() => {});
      return next;
    });
  }, []);

  // Long-press on a TeamProfile card → surface an action sheet with the
  // available per-team actions. Replaces the prior "long-press = remove"
  // shortcut now that there's more than one thing to do per team.
  const handleLongPressTeam = useCallback(
    (team: TeamProfile) => {
      // Open the controlled actions modal. The modal renders all options
      // + a clear Cancel + a dismissable backdrop, sidestepping
      // Alert.alert's Android 3-button cap.
      setTeamActionTarget(team);
    },
    []
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
      let teamProfileId: string | null = null;

      if (opts.team) {
        primary = opts.team.aliases[0] || opts.team.label;
        aliases = opts.team.aliases.length > 0 ? opts.team.aliases : [primary];
        teamProfileId = opts.team.id;
      } else if (opts.fav) {
        primary = opts.fav.teamText || opts.fav.teamName || '';
        // Try to find the matching TeamProfile so we can use its full alias
        // set (handles spelling drift like "Defensa U18 Rob" vs "Defensa Rob").
        const match = findTeamProfileByAlias(userProfile, primary);
        aliases = match?.aliases ?? null;
        teamProfileId = match?.id ?? null;
      } else if (opts.fallbackName) {
        primary = opts.fallbackName;
        const match = findTeamProfileByAlias(userProfile, primary);
        teamProfileId = match?.id ?? null;
      }

      if (!primary) return;
      setCurrentHistoryTeamName(primary);
      setCurrentHistoryAliases(aliases);
      setCurrentHistoryTeamProfileId(teamProfileId);
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
  // Pin a FavoriteTeam as the user's active team. The derived `myTeam`
  // memo above tracks `userProfile.activeTeamId` so this writer only
  // needs to touch `userProfile` — no separate myTeam state to keep in
  // lockstep.
  const setMyTeamAndProfile = useCallback((fav: FavoriteTeam | null) => {
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

  // Switching the active team via the new MyHome / HamburgerMenu UI.
  // The derived `myTeam` updates automatically off `activeTeamId`.
  const handleSwitchActiveTeam = useCallback(
    (teamId: string) => {
      setUserProfile((prev) => (prev ? setActiveTeamId(prev, teamId) : prev));
    },
    []
  );

  // ── Timu callbacks ──────────────────────────────────────────────────────

  const onTimuLoaded = useCallback((tid: number) => {
    setCurrentTimuTid(tid);
    setAesScope(null);
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
      clubName: currentTeam.TeamClub?.Name ?? '',
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

  // Open the Help screen, scrolling to a specific section. Used by per-screen
  // HelpButton ? icons. Pushes the current screen so goBack returns there.
  const openHelp = useCallback(
    (sectionId?: string) => {
      setScreenHistory((prev) => [...prev, screen]);
      setHelpSectionId(sectionId);
      setScreen('Help');
    },
    [screen]
  );

  // Clear context whenever we navigate back to higher-level screens
  useEffect(() => {
    if (
      screen === 'HomeLauncher' ||
      screen === 'BrowseSection' ||
      screen === 'TournamentSelect'
    ) {
      setAesScope(null);
      setSelectedCountry(null);
      setSelectedTournament(null);
      setSelectedTournamentYear(null);
    }
    if (screen === 'EventEntry') {
      setAesScope(null);
    }
    if (screen === 'DivisionSelect') {
      setAesScope((prev) => (prev ? { ...prev, division: null, team: null } : prev));
    }
  }, [screen]);

  // Android hardware back button support
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onHardwareBack = () => {
      if (screen === 'HomeLauncher') {
        // True root — let the OS handle (exit app on Android).
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
      setAesScope({ event, division: null, team: null });
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
      setAesScope((prev) => (prev ? { ...prev, division, team: null } : prev));
      navigate('TeamSelect');
    },
    [navigate]
  );

  const onTeamSelected = useCallback(
    (team: AESTeamAssignment) => {
      setAesScope((prev) => (prev ? { ...prev, team } : prev));
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
        setAesScope((prev) => (prev ? { ...prev, team: teamAssignment } : prev));
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
        setAesScope((prev) =>
          prev ? { ...prev, division, team: teamAssignment } : prev
        );
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
        setAesScope(null);
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
        setAesScope({ event, division, team: teamAssignment });
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

  // ── Open an upcoming-tournament card from a TeamDashboard ─────────────
  // The `UpcomingTournamentsSection` (rendered on AES + Timu team
  // dashboards) calls this when a card is tapped. We re-use the same
  // routing as favorites for AES so the user lands on TeamDashboard with
  // event + division + their own team selected, and the same direct
  // state push for Timu so they land on TimuTeamDashboard.
  const handleOpenUnifiedEntry = useCallback(
    (entry: UnifiedTournamentEntry) => {
      if (entry.source === 'aes') {
        if (!entry.eventKey || !entry.divisionId || !entry.myTeamId) {
          Alert.alert(
            "Can't open this tournament yet",
            'This event is in our index but the team-id link is missing. Re-open it from the tournament list once to refresh the link.'
          );
          return;
        }
        const teamName = entry.myTeamAsSeen || '';
        handleNavigateToFavorite({
          source: 'aes',
          eventKey: entry.eventKey,
          eventName: entry.tournamentName,
          teamId: entry.myTeamId,
          teamName,
          teamText: teamName,
          teamCode: '',
          clubName: '',
          divisionId: entry.divisionId,
          divisionName: entry.subtitle || '',
          divisionColorHex: entry.divisionColorHex || '',
        });
        return;
      }
      if (entry.source === 'timu') {
        if (!entry.tid || !entry.myTeamAsSeen) {
          Alert.alert(
            "Can't open this tournament yet",
            "We don't have the Timu tournament id for this entry. Re-open the team from the Timu tournament once to refresh the link."
          );
          return;
        }
        setCurrentTimuTid(entry.tid);
        setCurrentTimuTeamName(entry.myTeamAsSeen);
        setAesScope(null);
        setScreenHistory((prev) => [...prev, screen]);
        setScreen('TimuTeamDashboard');
        pushRecentlyViewedAndNotify({
          kind: 'team-timu',
          tid: entry.tid,
          teamName: entry.myTeamAsSeen,
          label: entry.myTeamAsSeen,
          subtitle: entry.tournamentName,
          touchedAt: Date.now(),
        });
        return;
      }
      // Scored / imported match (no AES or Timu link). Route to the
      // TournamentDetail screen with that one match so the user can see
      // its sets and per-set scores — same UX as opening a tournament
      // from Stats. SidelineHD-imported matches all land here.
      if (entry.source === 'scored' && entry.matchId) {
        const teamProfileId =
          currentHistoryTeamProfileId ??
          userProfile?.activeTeamId ??
          userProfile?.teams.find((t) => t.kind === 'me')?.id ??
          null;
        const teamLabel =
          (teamProfileId
            ? userProfile?.teams.find((t) => t.id === teamProfileId)?.label
            : null) ??
          currentHistoryTeamName ??
          '';
        if (!teamProfileId) {
          Alert.alert(
            "Can't open this match",
            "We couldn't figure out which of your teams this match belongs to. Open My Teams once to make a selection."
          );
          return;
        }
        setStatsTeamProfileId(teamProfileId);
        setStatsTeamName(teamLabel);
        setTournamentDetailName(entry.tournamentName);
        setTournamentDetailMatchIds([entry.matchId]);
        setScreenHistory((prev) => [...prev, screen]);
        setScreen('TournamentDetail');
        return;
      }
      Alert.alert(
        "Can't open this tournament",
        "This entry came from a locally-scored match and doesn't link back to a tournament dashboard."
      );
    },
    [
      handleNavigateToFavorite,
      screen,
      currentHistoryTeamProfileId,
      currentHistoryTeamName,
      userProfile,
    ]
  );

  const handleMenuNavigate = useCallback(
    (dest: MenuDestination) => {
      switch (dest) {
        case 'Home':
          // Launcher-redesign: "Home" goes to the new tile-grid launcher.
          // The old "Browse tournaments" home is now the Browse section,
          // reachable from the launcher or via the bottom Browse tab.
          setScreen('HomeLauncher');
          setScreenHistory([]);
          setAesScope(null);
          setSelectedCountry(null);
          setSelectedTournament(null);
          setSelectedTournamentYear(null);
          break;
        case 'MyHome':
          // Legacy "MyHome" destination — route to the My Team section
          // landing since that's where the old MyHome content lives now.
          setScreen('MyTeamSection');
          setScreenHistory([]);
          setAesScope(null);
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
          // Resolve venue map / info page from the registry. We search the
          // full registry (preferring the AES-merged copy) by the current
          // AES event key, because `selectedTournamentYear` is only set
          // when the user walked through the TournamentSelect picker —
          // entering via MyTeams → TeamDashboard leaves it null, which
          // previously meant `venueMapUrl` never got set even though the
          // event's map was configured in TOURNAMENT_REGISTRY.
          {
            const currentEventKey = currentEvent?.Key;
            const registryForLookup = discoveredRegistry ?? TOURNAMENT_REGISTRY;
            const match = currentEventKey
              ? findEventByKey(registryForLookup, currentEventKey)
              : undefined;
            // Prefer the selected-year context (when present) for fallback,
            // otherwise use the year we found via the key search.
            const fallbackYear = selectedTournamentYear ?? match?.year;
            setVenueInfoPageUrl(
              match?.event.infoPageUrl || fallbackYear?.infoPageUrl
            );
            setVenueMapUrl(
              match?.event.venueMapUrl || fallbackYear?.venueMapUrl
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
        case 'StorageSnapshot':
          setScreenHistory((prev) => [...prev, screen]);
          setScreen('StorageSnapshot');
          break;
        case 'HistoricalImport':
          setScreenHistory((prev) => [...prev, screen]);
          setScreen('HistoricalImport');
          break;
        case 'SidelineImport':
          setScreenHistory((prev) => [...prev, screen]);
          setScreen('SidelineImport');
          break;
        case 'Help':
          setScreenHistory((prev) => [...prev, screen]);
          setHelpSectionId(undefined);
          setScreen('Help');
          break;
        case 'About':
          setScreenHistory((prev) => [...prev, screen]);
          setScreen('About');
          break;
      }
    },
    [screen, currentEvent, currentDivision, currentTeam, currentTimuTid, currentTimuTeamName, myTeam, userProfile]
  );

  // ── Bottom tab handler ─────────────────────────────────────────────────
  // A tab tap is a destination switch: clear screenHistory + context, set
  // the screen to the matching home destination.
  const handleTabSelect = useCallback((tab: TabKey) => {
    setScreenHistory([]);
    setAesScope(null);
    setSelectedCountry(null);
    setSelectedTournament(null);
    setSelectedTournamentYear(null);
    // Home tab → new launcher; Browse tab → Browse section landing.
    if (tab === 'home') setScreen('HomeLauncher');
    else if (tab === 'browse') setScreen('BrowseSection');
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
        setAesScope(null);
        setScreenHistory((prev) => [...prev, screen]);
        setScreen('TimuTeamDashboard');
      } else if (item.kind === 'tournament-aes') {
        try {
          const event = await getEvent(item.eventKey);
          setAesScope({ event, division: null, team: null });
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
        setAesScope(null);
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
          setScreen('MyTeamSection');
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
      case 'HomeLauncher':
        return (
          <LauncherHomeScreen
            profile={userProfile}
            onOpenScoreboardSection={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('ScoreboardSection');
            }}
            onOpenMyTeamSection={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('MyTeamSection');
            }}
            onOpenMyTeamOnboarding={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('AddTeamChooser');
            }}
            onOpenBrowseSection={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('BrowseSection');
            }}
            onOpenVenueMaps={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('VenueMapSelector');
            }}
            onOpenMrs={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('MrsConnection');
            }}
            onOpenCacLocker={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('CacConnection');
            }}
            onOpenOvaRankings={() => {
              setOvaInitialDivision(null);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('OvaRankings');
            }}
            onOpenHelp={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setHelpSectionId(undefined);
              setScreen('Help');
            }}
          />
        );
      case 'ScoreboardSection':
        return (
          <ScoreboardSectionScreen
            onBack={goBack}
            onOpenSimple={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('Scoreboard');
            }}
            onOpenAdvanced={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('MatchList');
            }}
            onResumeMatch={(m) => {
              setActiveScoredMatch(m);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('MatchScoring');
            }}
          />
        );
      case 'MyTeamSection':
        if (!userProfile) {
          // Profile not loaded yet — fall through to the browse path so
          // the user isn't stuck on a blank screen.
          return (
            <TournamentSelectScreen
              onTournamentSelected={onTournamentSelected}
              initialRegistry={discoveredRegistry}
              profile={userProfile}
              onSearchSelect={handleGlobalSearchSelect}
              onOpenAddTimu={() => {
                setAddTournamentsFocusSource('timu');
                setScreenHistory((prev) => [...prev, screen]);
                setScreen('AddTournaments');
              }}
            />
          );
        }
        return (
          <MyTeamSectionScreen
            profile={userProfile}
            onBack={goBack}
            onOpenTeamSection={(team) => {
              handleSwitchActiveTeam(team.id);
              setSingleTeamSectionTeamId(team.id);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('SingleTeamSection');
            }}
            onOpenTeam={(team) => {
              handleSwitchActiveTeam(team.id);
              setSingleTeamSectionTeamId(team.id);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('SingleTeamSection');
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
            onFindInOvaRankings={() => {
              setOvaInitialDivision(null);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('OvaRankings');
            }}
            onBrowseTournaments={() => {
              setScreenHistory([]);
              setScreen('BrowseSection');
            }}
            onScoreAMatch={
              userProfile?.scorerMode
                ? () => {
                    setScreenHistory((prev) => [...prev, screen]);
                    setScreen('MatchList');
                  }
                : undefined
            }
            onResumeMatch={(m) => {
              setActiveScoredMatch(m);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('MatchScoring');
            }}
            onOpenRecent={handleOpenRecent}
            onOpenAnalyticsForTeam={(team) => {
              setStatsTeamProfileId(team.id);
              setStatsTeamName(team.label);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('Stats');
            }}
          />
        );
      case 'SingleTeamSection': {
        const team = singleTeamSectionTeamId
          ? userProfile?.teams.find((t) => t.id === singleTeamSectionTeamId) ?? null
          : null;
        if (!team) {
          // Team id was dangling (deleted out from under us, etc.) — bounce
          // back to the picker so the user isn't stranded on a blank screen.
          return (
            <MyTeamSectionScreen
              profile={userProfile!}
              onBack={goBack}
              onOpenTeamSection={(t) => {
                handleSwitchActiveTeam(t.id);
                setSingleTeamSectionTeamId(t.id);
                setScreenHistory((prev) => [...prev, screen]);
                setScreen('SingleTeamSection');
              }}
              onOpenTeam={(t) => {
                handleSwitchActiveTeam(t.id);
                setSingleTeamSectionTeamId(t.id);
                setScreenHistory((prev) => [...prev, screen]);
                setScreen('SingleTeamSection');
              }}
              onAddTeam={() => {
                setScreenHistory((prev) => [...prev, screen]);
                setScreen('AddTeamChooser');
              }}
            />
          );
        }
        return (
          <SingleTeamSectionScreen
            team={team}
            onBack={goBack}
            onOpenAnalytics={() => {
              setStatsTeamProfileId(team.id);
              setStatsTeamName(team.label);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('Stats');
            }}
            onOpenSeasonHistory={() => {
              openTeamSeasonHistory({ team });
            }}
            onOpenTournaments={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('TournamentsSection');
            }}
            onOpenRoster={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('RosterSection');
            }}
            onOpenSidelineImport={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('SidelineImport');
            }}
          />
        );
      }
      case 'BrowseSection':
        return (
          <BrowseSectionScreen
            onBack={goBack}
            onOpenAesEvents={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('TournamentSelect');
            }}
            onOpenTimuEvents={() => {
              setAddTournamentsFocusSource('timu');
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('AddTournaments');
            }}
            onOpenOvaRankings={() => {
              setOvaInitialDivision(null);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('OvaRankings');
            }}
            onOpenSearch={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('GlobalSearch');
            }}
          />
        );
      case 'VenueMapSelector':
        return (
          <VenueMapSelectorScreen
            registry={discoveredRegistry}
            onBack={goBack}
            onOpenMap={(sel) => {
              setVenueMapUrl(sel.venueMapUrl);
              setVenueInfoPageUrl(sel.infoPageUrl);
              setHighlightCourt(undefined);
              setCourtMatchInfo(undefined);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('VenueMap');
            }}
          />
        );
      case 'MyHome':
        if (!userProfile) {
          // Profile still loading on first paint — fall through to the
          // browse path so the user isn't stuck on a blank screen.
          return (
            <TournamentSelectScreen
              onTournamentSelected={onTournamentSelected}
              initialRegistry={discoveredRegistry}
              profile={userProfile}
              onSearchSelect={handleGlobalSearchSelect}
              onOpenAddTimu={() => {
                setAddTournamentsFocusSource('timu');
                setScreenHistory((prev) => [...prev, screen]);
                setScreen('AddTournaments');
              }}
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
            onFindInOvaRankings={() => {
              // R3: primary discovery path for zero-team users — opens
              // OVA Rankings directly. Tap a ranked team → confirm →
              // app creates TeamProfile + runs auto-discovery.
              setOvaInitialDivision(null);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('OvaRankings');
            }}
            onBrowseTournaments={() => {
              setScreenHistory([]);
              setScreen('TournamentSelect');
            }}
            onScoreAMatch={
              userProfile?.scorerMode
                ? () => {
                    setScreenHistory((prev) => [...prev, screen]);
                    setScreen('MatchList');
                  }
                : undefined
            }
            onResumeMatch={(m) => {
              setActiveScoredMatch(m);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('MatchScoring');
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
            onChooseOvaRankings={() => {
              // Featured path — OVA rankings drive most users' team
              // discovery. Picking a row creates a TeamProfile and
              // kicks off auto-discovery via handleFollowOvaRankedTeam.
              setOvaInitialDivision(null);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('OvaRankings');
            }}
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
            initialRegistry={discoveredRegistry}
            profile={userProfile}
            onSearchSelect={handleGlobalSearchSelect}
            onOpenAddTimu={() => {
              setAddTournamentsFocusSource('timu');
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('AddTournaments');
            }}
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
              setAesScope((prev) =>
                prev ? { ...prev, division, team } : prev
              );
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
                clubName: currentTeam!.TeamClub?.Name ?? '',
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
            meTeamCount={
              userProfile?.teams.filter((t) => t.kind === 'me').length ?? 0
            }
            onManageRoster={(() => {
              // Surface the per-team roster editor when this team has a
              // matching me-kind TeamProfile. Resolves the profile via
              // alias overlap on TeamText/TeamName so a freshly-followed
              // team is reachable on the same render.
              if (!userProfile || !currentTeam) return undefined;
              const candidate = currentTeam.TeamText || currentTeam.TeamName || '';
              const profileMatch = findTeamProfileByAlias(userProfile, candidate);
              if (!profileMatch || profileMatch.kind !== 'me') return undefined;
              return () => handleOpenRosterEditor(profileMatch);
            })()}
            onOpenUpcomingTournament={handleOpenUnifiedEntry}
            onViewVenueMap={() => handleMenuNavigate('VenueMap')}
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
        const profileMatch = findTeamProfileByAlias(userProfile, teamName);
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
              // MatchListScreen falls back to `match.id` when neither
              // home nor away has a teamProfileId set — that fallback
              // would pass a match id to StatsScreen, which then
              // filters out every match and shows the empty state.
              // Prefer the user's active team profile whenever we have
              // one; only honour MatchListScreen's pick if no active
              // team is set (rare since the button needs matches to
              // exist, which usually means a team profile exists).
              const activeTeam = userProfile?.activeTeamId
                ? userProfile.teams.find(
                    (t) => t.id === userProfile.activeTeamId
                  ) ?? null
                : null;
              if (activeTeam) {
                setStatsTeamProfileId(activeTeam.id);
                setStatsTeamName(activeTeam.label);
              } else {
                setStatsTeamProfileId(profileId);
                setStatsTeamName(name);
              }
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
      case 'RosterSection': {
        const team = singleTeamSectionTeamId
          ? userProfile?.teams.find((t) => t.id === singleTeamSectionTeamId) ?? null
          : null;
        if (!team) {
          goBack();
          return null;
        }
        return (
          <RosterSectionScreen
            team={team}
            onBack={goBack}
            onOpenView={() => {
              setRosterEditTeamId(team.id);
              setRosterReadOnly(true);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('TeamRoster');
            }}
            onOpenManage={() => {
              if (team.kind !== 'me') return;
              setRosterReadOnly(false);
              handleOpenRosterEditor(team);
            }}
          />
        );
      }
      case 'TournamentsSection': {
        const team = singleTeamSectionTeamId
          ? userProfile?.teams.find((t) => t.id === singleTeamSectionTeamId) ?? null
          : null;
        if (!team) {
          goBack();
          return null;
        }
        return (
          <TournamentsSectionScreen
            team={team}
            onBack={goBack}
            onOpenCurrentTournament={(entry) => {
              // Same routing as a tap on a Season-History tournament card —
              // resolves AES → TeamDashboard / Timu → TimuTeamDashboard.
              handleOpenUnifiedEntry(entry);
            }}
            onOpenAddTournaments={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('AddTournaments');
            }}
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
            readOnly={rosterReadOnly}
            onCancel={() => {
              setRosterEditTeamId(null);
              setRosterReadOnly(false);
              goBack();
            }}
            onSave={(next) => {
              handleSaveRoster(team.id, next);
              setRosterEditTeamId(null);
              setRosterReadOnly(false);
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
      case 'Stats': {
        // Aliases for the active stats team. Used as a fallback inside
        // StatsScreen for legacy matches whose `meta.home.teamProfileId`
        // didn't get populated (older matches + label spellings that
        // slipped past the boot-time backfill's alias matcher).
        const statsTeam = userProfile?.teams.find(
          (t) => t.id === statsTeamProfileId
        );
        const statsAliases = statsTeam
          ? statsTeam.aliases && statsTeam.aliases.length > 0
            ? statsTeam.aliases
            : [statsTeam.label]
          : undefined;
        return (
          <StatsScreen
            teamProfileId={statsTeamProfileId}
            teamName={statsTeamName}
            teamAliases={statsAliases}
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
      }
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
            meTeamCount={
              userProfile?.teams.filter((t) => t.kind === 'me').length ?? 0
            }
            onManageRoster={(() => {
              if (!userProfile) return undefined;
              const profileMatch = findTeamProfileByAlias(userProfile, currentTimuTeamName);
              if (!profileMatch || profileMatch.kind !== 'me') return undefined;
              return () => handleOpenRosterEditor(profileMatch);
            })()}
            onOpenUpcomingTournament={handleOpenUnifiedEntry}
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
            onFollowTeam={handleFollowOvaRankedTeam}
          />
        );
      case 'StorageSnapshot':
        return <StorageSnapshotScreen onBack={goBack} />;
      case 'HistoricalImport':
        return (
          <HistoricalImportScreen
            userProfile={userProfile}
            onBack={goBack}
          />
        );
      case 'SidelineImport':
        return (
          <SidelineImportScreen
            userProfile={userProfile}
            onBack={goBack}
            onAddTeamAlias={(teamId, alias) => {
              // Append the slug to the named team's alias list (deduped),
              // bump updatedAt, persist. Fire-and-forget on the save so
              // the import flow doesn't block on disk. Persisting an
              // alias for a profile we don't have (`prev == null`) is a
              // no-op — shouldn't happen in practice since the screen
              // only renders meTeams when userProfile is non-null, but
              // guard anyway.
              setUserProfile((prev) => {
                if (!prev) return prev;
                const now = Date.now();
                const next: UserProfile = {
                  ...prev,
                  teams: prev.teams.map((t) =>
                    t.id === teamId
                      ? {
                          ...t,
                          aliases: dedupeAliases([...t.aliases, alias]),
                          updatedAt: now,
                        }
                      : t
                  ),
                  updatedAt: now,
                };
                saveUserProfile(next).catch(() => {});
                return next;
              });
            }}
          />
        );
      case 'About':
        return <AboutScreen onBack={goBack} />;
      case 'Help':
        return (
          <HelpScreen onBack={goBack} initialSectionId={helpSectionId} />
        );
      case 'SeasonHistory':
        if (!currentHistoryTeamName) return null;
        return (
          <SeasonHistoryScreen
            primaryName={currentHistoryTeamName}
            aliases={currentHistoryAliases}
            teamProfileId={currentHistoryTeamProfileId}
            onBack={goBack}
            onOpenUpcomingTournament={handleOpenUnifiedEntry}
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
                    setAesScope({ event, division, team: null });
                    setScreenHistory((prev) => [...prev, screen]);
                    setScreen('TeamSelect');
                    return;
                  }
                  const teams = await getTeamAssignments(eventKey, divisionId, null, [teamId]);
                  const teamAssignment = teams.find((t) => t.TeamId === teamId);
                  if (!teamAssignment) {
                    setAesScope({ event, division, team: null });
                    setScreenHistory((prev) => [...prev, screen]);
                    setScreen('TeamSelect');
                    return;
                  }
                  setAesScope({ event, division, team: teamAssignment });
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
              for (const a of currentHistoryAliases) {
                const match = findTeamProfileByAlias(userProfile, a);
                if (match) return match.lastDiscoveryAt;
              }
              return undefined;
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
      {/* First-launch onboarding gate. While we're still reading
          AsyncStorage (onboardingDone === null), don't render
          anything — the wait is short and avoids a flash of the
          welcome screen for returning users. */}
      {onboardingDone === null ? null : onboardingDone === false ? (
        <OnboardingScreen onComplete={handleOnboardingComplete} />
      ) : (
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
          // Land on the team's Season History. If the team has nothing
          // linked yet, drop the user back to the My Team section so they
          // can add a tournament.
          const team = userProfile?.teams.find((t) => t.id === teamId);
          if (team) {
            openTeamSeasonHistory({ team });
          } else {
            setScreenHistory([]);
            setScreen('MyTeamSection');
          }
        }}
        onToggleScorerMode={(next: boolean) => {
          setUserProfile((prev) =>
            prev ? { ...prev, scorerMode: next, updatedAt: Date.now() } : prev
          );
        }}
        onOpenRosterEditor={handleOpenRosterEditor}
        onTeamMenu={handleLongPressTeam}
        onOpenMyTeamFastPath={() => {
          // Hamburger "My Team" entry — go straight to the active team's
          // Season History. When there's no active team yet, drop the user
          // on the team picker so they can pick one. The launcher tile
          // keeps its picker behaviour regardless.
          const activeId = userProfile?.activeTeamId ?? null;
          const team = activeId
            ? userProfile?.teams.find((t) => t.id === activeId)
            : undefined;
          if (team) {
            openTeamSeasonHistory({ team });
          } else {
            setScreenHistory([]);
            setScreen('MyTeamSection');
          }
        }}
        onOpenHelp={openHelp}
      />
      )}
      <DiscoveryConfirmModal pending={confirmDiscovery} />
      <TeamActionsModal
        team={teamActionTarget}
        onClose={() => setTeamActionTarget(null)}
        onToggleKind={(t) => {
          setTeamActionTarget(null);
          handleToggleTeamKind(t);
        }}
        onManageRoster={(t) => {
          setTeamActionTarget(null);
          handleOpenRosterEditor(t);
        }}
        onRemove={(t) => {
          setTeamActionTarget(null);
          handleRemoveTeam(t);
        }}
      />
      {/* Global offline indicator — slim pill anchored to the bottom.
          Renders null when the device is online so it has zero visual
          cost most of the time. */}
      <OfflineBanner />
    </SafeAreaProvider>
    </ThemeContext.Provider>
  );
}

// Top-level export — wraps the actual app shell in an ErrorBoundary so
// any uncaught render error surfaces a recovery screen instead of
// white-screening JS. When Sentry lands in Phase 4 the `onError`
// callback below will hand the error through to Sentry.captureException.
export default Sentry.wrap(function App() {
  // Overlay state for the jontyware brand-house splash. The component fades
  // itself out after ~2s and calls onFinish, at which point we unmount it so
  // the app underneath becomes interactive.
  const [splashDone, setSplashDone] = useState(false);

  return (
    <>
      <ErrorBoundary
        onError={(err, componentStack) => {
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.warn('[App] caught render error:', err, componentStack);
          }
          reportError(err, componentStack);
        }}
      >
        <AppInner />
      </ErrorBoundary>
      {!splashDone && (
        <JontywareSplash onFinish={() => setSplashDone(true)} />
      )}
    </>
  );
});

// ── Discovery confirmation modal ──────────────────────────────────────────
//
// In-app modal replacing Alert.alert for the "kick off auto-discovery?"
// prompt. Renders the data warning prominently and exposes two clearly
// labelled buttons. The dim backdrop is non-dismissible — the user must
// pick a button — so we never end up in a "what happened to the dialog"
// state.
/**
 * Long-press team-actions sheet. Custom Modal rather than Alert.alert
 * because Android's Alert caps at 3 buttons (silently drops the 4th)
 * and tap-outside dismissal isn't reliable across every OEM. This
 * variant has unlimited rows, explicit Cancel, and a tappable backdrop.
 */
function TeamActionsModal({
  team,
  onClose,
  onToggleKind,
  onManageRoster,
  onRemove,
}: {
  team: TeamProfile | null;
  onClose: () => void;
  onToggleKind: (team: TeamProfile) => void;
  onManageRoster: (team: TeamProfile) => void;
  onRemove: (team: TeamProfile) => void;
}) {
  if (!team) return null;
  const promoteLabel =
    team.kind === 'me' ? 'Stop tracking as my team' : 'Make this my team';
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      {/* Backdrop is a TouchableOpacity so a tap anywhere outside the
       *  card dismisses the modal — matches the Alert-on-iOS gesture. */}
      <TouchableOpacity
        style={modalStyles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={modalStyles.card}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={modalStyles.title}>{team.label}</Text>
          <TouchableOpacity
            style={teamActionsModalStyles.row}
            onPress={() => onToggleKind(team)}
            activeOpacity={0.7}
          >
            <Text style={teamActionsModalStyles.rowText}>{promoteLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={teamActionsModalStyles.row}
            onPress={() => onManageRoster(team)}
            activeOpacity={0.7}
          >
            <Text style={teamActionsModalStyles.rowText}>Manage roster</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={teamActionsModalStyles.row}
            onPress={() => onRemove(team)}
            activeOpacity={0.7}
          >
            <Text style={teamActionsModalStyles.rowTextDestructive}>
              Remove team
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={teamActionsModalStyles.cancelRow}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={teamActionsModalStyles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const teamActionsModalStyles = StyleSheet.create({
  row: {
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#eaeaea',
    alignItems: 'center',
  },
  rowText: {
    fontSize: 16,
    color: '#1a73e8',
    fontWeight: '600',
  },
  rowTextDestructive: {
    fontSize: 16,
    color: '#c0392b',
    fontWeight: '600',
  },
  cancelRow: {
    paddingTop: 16,
    paddingBottom: 4,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
});

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
  onOpenMyTeamFastPath,
  onTabSelect,
  onOpenGlobalSearch,
  onOpenHelp,
}: any) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const lightHeader = darkHeaderScreens.includes(screen);
  // Hide the tab bar on Scoreboard in landscape — the score panels need
  // every vertical pixel, and the user pivots the device specifically to
  // get the bigger numbers. Other screens keep the tab bar regardless.
  const showTabBar =
    !TAB_BAR_HIDDEN_SCREENS.has(screen) &&
    !(screen === 'Scoreboard' && isLandscape);
  const showPill =
    !PILL_SUPPRESSED_SCREENS.has(screen) && !!userProfile?.activeTeamId;
  const showSearch = !SEARCH_SUPPRESSED_SCREENS.has(screen);
  // Per-screen ? button → which help section to open. Screens not in this
  // map don't show the floating help affordance (Help screen itself, focused
  // flows, modals, etc.). Users can always reach Help via the hamburger.
  const helpSectionForScreen: Partial<Record<Screen, string>> = {
    HomeLauncher: HELP_SECTION_IDS.HOME_LAUNCHER,
    MyTeamSection: HELP_SECTION_IDS.MY_TEAMS_SECTION,
    SingleTeamSection: HELP_SECTION_IDS.SINGLE_TEAM_SECTION,
    TournamentsSection: HELP_SECTION_IDS.TOURNAMENTS_SECTION,
    MyHome: HELP_SECTION_IDS.MY_HOME,
    TeamDashboard: HELP_SECTION_IDS.TEAM_DASHBOARD,
    TimuTeamDashboard: HELP_SECTION_IDS.TEAM_DASHBOARD,
    Scoreboard: HELP_SECTION_IDS.SCOREBOARD,
    MatchScoring: HELP_SECTION_IDS.SCORE_MATCH,
    MatchSetup: HELP_SECTION_IDS.SCORE_MATCH,
    Stats: HELP_SECTION_IDS.ANALYTICS,
    PlayerDetail: HELP_SECTION_IDS.ANALYTICS,
    SeasonHistory: HELP_SECTION_IDS.SEASON_HISTORY,
    SidelineImport: HELP_SECTION_IDS.SIDELINE_IMPORT,
    VenueMap: HELP_SECTION_IDS.VENUE_MAP,
    VenueMapSelector: HELP_SECTION_IDS.VENUE_MAP,
    Standings: HELP_SECTION_IDS.STANDINGS_BRACKETS,
    Brackets: HELP_SECTION_IDS.STANDINGS_BRACKETS,
    AddTournaments: HELP_SECTION_IDS.ADD_TOURNAMENTS,
    OvaRankings: HELP_SECTION_IDS.OVA_RANKINGS,
    MrsConnection: HELP_SECTION_IDS.CONNECTION,
    CacConnection: HELP_SECTION_IDS.CONNECTION,
  };
  const helpSection = helpSectionForScreen[screen as Screen];
  const showHelpButton = !!helpSection && !!onOpenHelp;
  // Reserve space at the bottom for the tab bar so screens don't render
  // under it. Tab bar height is fixed; the safe-area bottom is added inside
  // the bar component itself. When the tab bar is hidden, fall back to
  // `insets.bottom` directly so the content still clears Android nav
  // buttons / the iOS home indicator instead of slipping under them.
  const screenPaddingBottom = showTabBar
    ? BOTTOM_TAB_BAR_HEIGHT + insets.bottom
    : insets.bottom;

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
          currentScreen={
            screen === 'HomeLauncher' ||
            screen === 'TournamentSelect' ||
            screen === 'EventEntry'
              ? 'Home'
              : screen
          }
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
          onOpenMyTeamFastPath={onOpenMyTeamFastPath}
          menuContext={menuContextForScreen(screen)}
        />
      </View>
      {showHelpButton && (
        <View
          style={[styles.helpOverlay, { top: insets.top + 8 + 38 }]}
          pointerEvents="box-none"
        >
          <HelpButton
            sectionId={helpSection as string}
            onPress={onOpenHelp}
            light={lightHeader}
          />
        </View>
      )}
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
  helpOverlay: {
    // Sits directly under the hamburger button (which is ~26pt tall with
    // its own padding) so the two affordances stack vertically on the
    // top-right edge without overlapping. Same zIndex as the menu overlay
    // so neither can mask the other.
    position: 'absolute',
    right: 14,
    zIndex: 100,
    alignItems: 'flex-end',
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
