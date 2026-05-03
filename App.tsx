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
} from './src/utils/storage';
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

type Screen =
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
  | 'TeamNotes';

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

  useEffect(() => {
    (async () => {
      try {
        const [events, favs, saved, savedTheme] = await Promise.all([
          loadSavedEvents(),
          loadFavoriteTeams(),
          loadMyTeam(),
          loadThemeMode(),
        ]);
        setSavedEvents(events);
        setFavoriteTeams(favs);
        setMyTeam(saved);
        setThemeMode(savedTheme);

        // Auto-navigate to My Team on launch
        if (saved) {
          try {
            const event = await getEvent(saved.eventKey);
            const division = event.Divisions.find(
              (d) => d.DivisionId === saved.divisionId
            );
            if (division) {
              const teams = await getTeamAssignments(
                saved.eventKey,
                saved.divisionId,
                null,
                [saved.teamId]
              );
              const teamAssignment = teams.find((t) => t.TeamId === saved.teamId);
              if (teamAssignment) {
                setCurrentEvent(event);
                setCurrentDivision(division);
                setCurrentTeam(teamAssignment);
                setScreenHistory(['TournamentSelect']);
                setScreen('TeamDashboard');
                // Save event to recent list
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
              }
            }
          } catch {
            // If auto-nav fails (e.g. no network), just land on home screen
          }
        }
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

  const handleSetMyTeam = useCallback(() => {
    if (!currentEvent || !currentDivision || !currentTeam) return;
    setMyTeam({
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
  }, [currentEvent, currentDivision, currentTeam]);

  const handleClearMyTeam = useCallback(() => {
    setMyTeam(null);
  }, []);

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
          setScreen('TournamentSelect');
          setScreenHistory([]);
          setCurrentEvent(null);
          setCurrentDivision(null);
          setCurrentTeam(null);
          setSelectedCountry(null);
          setSelectedTournament(null);
          setSelectedTournamentYear(null);
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
      }
    },
    [screen, currentEvent, currentDivision, currentTeam]
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
  ];

  const toggleFavorite = useCallback(
    (team: FavoriteTeam) => {
      setFavoriteTeams((prev) => {
        const exists = prev.some(
          (f) => f.teamId === team.teamId && f.eventKey === team.eventKey
        );
        if (exists) {
          return prev.filter(
            (f) =>
              !(f.teamId === team.teamId && f.eventKey === team.eventKey)
          );
        }
        return [...prev, team];
      });
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
        screen={screen}
        darkHeaderScreens={darkHeaderScreens}
        myTeam={myTeam}
        favoriteTeams={favoriteTeams}
        navigatingToFav={navigatingToFav}
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
  screen,
  darkHeaderScreens,
  myTeam,
  favoriteTeams,
  navigatingToFav,
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
          hasEvent={!!currentEvent}
          hasDivision={!!currentDivision}
          hasTeam={!!currentTeam}
          currentScreen={screen === 'TournamentSelect' || screen === 'EventEntry' ? 'Home' : screen}
          light={darkHeaderScreens.includes(screen)}
          eventName={currentEvent?.Name}
          divisionName={currentDivision?.Name}
          divisionColor={currentDivision?.ColorHex}
          teamName={currentTeam?.TeamText || currentTeam?.TeamName}
          myTeam={myTeam}
          favoriteTeams={favoriteTeams}
          currentTeamId={currentTeam?.TeamId}
          currentEventKey={currentEvent?.Key}
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
