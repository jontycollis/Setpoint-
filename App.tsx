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
} from 'react-native';
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
import { TimuTournamentScreen } from './src/screens/TimuTournamentScreen';
import { TimuTeamDashboardScreen } from './src/screens/TimuTeamDashboardScreen';
import { TimuOpponentScoutScreen } from './src/screens/TimuOpponentScoutScreen';
import { TimuManageSeasonScreen } from './src/screens/TimuManageSeasonScreen';
import { SeasonHistoryScreen } from './src/screens/SeasonHistoryScreen';
import { OvaRankingsScreen } from './src/screens/OvaRankingsScreen';
import { HamburgerMenu } from './src/components/HamburgerMenu';
import type { MenuDestination } from './src/components/HamburgerMenu';
import { getEvent, getTeamAssignments } from './src/api/aesClient';
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
  upsertTeamProfileForFavorite,
  addWatchingTeamProfile,
  setActiveTeamId,
} from './src/utils/activeTeamProfile';
import type { UserProfile } from './src/types/profile';
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
  | 'TimuManageSeason'
  | 'SeasonHistory'
  | 'OvaRankings';

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
  const [navigatingToFav, setNavigatingToFav] = useState(false);

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
      return upsertTeamProfileForFavorite(prev, fav).profile;
    });
  }, []);

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
  }, []);

  const handleTimuTeamPress = useCallback(
    (teamName: string) => {
      if (!currentTimuTid) return;
      setCurrentTimuTeamName(teamName);
      setScreenHistory((prev) => [...prev, screen]);
      setScreen('TimuTeamDashboard');
    },
    [currentTimuTid, screen]
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
          const { profile: next } = addWatchingTeamProfile(prev, newFav!);
          return next;
        });
      }
    },
    [currentTimuTid]
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
    },
    [navigate]
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
        case 'TimuManageSeason':
          setScreenHistory((prev) => [...prev, screen]);
          setScreen('TimuManageSeason');
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
      }
    },
    [screen, currentEvent, currentDivision, currentTeam, currentTimuTid, currentTimuTeamName, myTeam, userProfile]
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
    'TimuManageSeason',
    'SeasonHistory',
    'OvaRankings',
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
          const { profile: next } = addWatchingTeamProfile(prev, team);
          return next;
        });
      }
    },
    []
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
            />
          );
        }
        return (
          <MyHomeScreen
            profile={userProfile}
            onOpenTeam={(team) => {
              // Make the tapped team the active team, then navigate to
              // its dashboard if a primaryRef exists. If not, stay on
              // MyHome — the team card will show the "no tournament
              // linked yet" warning.
              handleSwitchActiveTeam(team.id);
              if (team.primaryRef) {
                handleNavigateToFavorite(team.primaryRef);
              }
            }}
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
            onBrowseTournaments={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('TournamentSelect');
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
              // Timu path → TimuManageSeason where they paste a URL/tid.
              // From the indexed tournament they tap into the team and
              // hit "Set As My Team" the same way.
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('TimuManageSeason');
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
              const primary =
                myTeam?.teamText ||
                myTeam?.teamName ||
                currentTeam?.TeamText ||
                currentTeam?.TeamName ||
                'My Team';
              setCurrentHistoryTeamName(primary);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('SeasonHistory');
            }}
          />
        );
      case 'MyTeams':
        return (
          <MyTeamsScreen
            myTeam={myTeam}
            favoriteTeams={favoriteTeams}
            onNavigateToTeam={handleNavigateToFavorite}
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
      case 'TournamentHistory':
        return (
          <CrossTournamentScreen
            clubName={currentTeam?.TeamClub?.Name}
            teamFilter={currentTeam?.TeamText}
            onBack={goBack}
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
              const primary =
                myTeam?.teamText ||
                myTeam?.teamName ||
                currentTimuTeamName ||
                'My Team';
              setCurrentHistoryTeamName(primary);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('SeasonHistory');
            }}
            onManageSeason={() => {
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('TimuManageSeason');
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
              setScreen('TimuManageSeason');
            }}
          />
        );
      case 'TimuManageSeason':
        return (
          <TimuManageSeasonScreen
            onBack={goBack}
            onOpenTid={(tid) => {
              setCurrentTimuTid(tid);
              setCurrentTimuTeamName(null);
              setScreenHistory((prev) => [...prev, screen]);
              setScreen('TimuTournament');
            }}
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
              setScreen('TimuManageSeason');
            }}
          />
        );
      default:
        return null;
    }
  }

  return (
    <ThemeContext.Provider value={themeContextValue}>
    <SafeAreaProvider>
      <AppContent
        renderScreen={renderScreen}
        handleMenuNavigate={handleMenuNavigate}
        handleNavigateToFavorite={handleNavigateToFavorite}
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
        onSwitchTeam={(teamId: string) => {
          handleSwitchActiveTeam(teamId);
          // Mirror the MyHome behaviour: opening the team's dashboard if
          // it has a primaryRef. Caller in HamburgerMenu closes the modal
          // before invoking this.
          const team = userProfile?.teams.find((t) => t.id === teamId);
          if (team?.primaryRef) {
            handleNavigateToFavorite(team.primaryRef);
          } else {
            // No tournament linked yet — drop them on MyHome so they can
            // see the active team and add a tournament.
            setScreenHistory([]);
            setScreen('MyHome');
          }
        }}
      />
    </SafeAreaProvider>
    </ThemeContext.Provider>
  );
}

function AppContent({
  renderScreen,
  handleMenuNavigate,
  handleNavigateToFavorite,
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
}: any) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style={darkHeaderScreens.includes(screen) ? "light" : "dark"} />
      {renderScreen()}
      {navigatingToFav && (
        <View style={styles.favLoadingOverlay}>
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={styles.favLoadingText}>Loading team...</Text>
        </View>
      )}
      <View style={[styles.menuOverlay, { top: insets.top + 8 }]} pointerEvents="box-none">
        <HamburgerMenu
          onNavigate={handleMenuNavigate}
          onNavigateToFavorite={handleNavigateToFavorite}
          onRemoveFavorite={handleRemoveFavorite}
          hasEvent={!!currentEvent || !!currentTimuTid}
          hasDivision={!!currentDivision}
          hasTeam={!!currentTeam || !!currentTimuTeamName}
          onTimu={!!currentTimuTid}
          currentScreen={screen === 'TournamentSelect' || screen === 'EventEntry' ? 'Home' : screen}
          light={darkHeaderScreens.includes(screen)}
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
          menuContext={menuContextForScreen(screen)}
        />
      </View>
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
});
