import React, { useState, useCallback, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  View,
  StyleSheet,
  Platform,
  StatusBar as RNStatusBar,
  Alert,
} from 'react-native';
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
import { HamburgerMenu } from './src/components/HamburgerMenu';
import type { MenuDestination } from './src/components/HamburgerMenu';
import { getEvent, getTeamAssignments } from './src/api/aesClient';
import {
  loadSavedEvents,
  saveSavedEvents,
  loadFavoriteTeams,
  saveFavoriteTeams,
  loadDefaultTeam,
  saveDefaultTeam,
} from './src/utils/storage';
import type {
  AESEvent,
  AESDivision,
  AESTeamAssignment,
  FavoriteTeam,
  SavedEvent,
} from './src/types/aes';

type Screen =
  | 'EventEntry'
  | 'DivisionSelect'
  | 'TeamSelect'
  | 'TeamSearch'
  | 'TeamDashboard'
  | 'Standings'
  | 'CourtSchedule'
  | 'OpponentScout'
  | 'VenueMap'
  | 'Brackets';

export default function App() {
  const [screen, setScreen] = useState<Screen>('EventEntry');
  const [screenHistory, setScreenHistory] = useState<Screen[]>([]);

  const [currentEvent, setCurrentEvent] = useState<AESEvent | null>(null);
  const [currentDivision, setCurrentDivision] = useState<AESDivision | null>(
    null
  );
  const [currentTeam, setCurrentTeam] = useState<AESTeamAssignment | null>(
    null
  );
  const [savedEvents, setSavedEvents] = useState<SavedEvent[]>([]);
  const [favoriteTeams, setFavoriteTeams] = useState<FavoriteTeam[]>([]);
  const [defaultTeam, setDefaultTeam] = useState<FavoriteTeam | null>(null);
  const [scoutParams, setScoutParams] = useState<{
    opponentTeamId: number;
    opponentName: string;
  } | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [events, favs, def] = await Promise.all([
          loadSavedEvents(),
          loadFavoriteTeams(),
          loadDefaultTeam(),
        ]);
        setSavedEvents(events);
        setFavoriteTeams(favs);
        setDefaultTeam(def);
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
    saveDefaultTeam(defaultTeam);
  }, [defaultTeam, hydrated]);

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

  const buildFavoriteFromCurrent = useCallback((): FavoriteTeam | null => {
    if (!currentEvent || !currentDivision || !currentTeam) return null;
    return {
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
    };
  }, [currentEvent, currentDivision, currentTeam]);

  const handleNavigateToFavorite = useCallback(
    async (fav: FavoriteTeam) => {
      if (
        currentTeam?.TeamId === fav.teamId &&
        currentEvent?.Key === fav.eventKey &&
        screen === 'TeamDashboard'
      ) {
        return;
      }

      try {
        let event = currentEvent;
        if (!event || event.Key !== fav.eventKey) {
          event = await getEvent(fav.eventKey);
          setCurrentEvent(event);
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
        }

        const division = event.Divisions.find(
          (d) => d.DivisionId === fav.divisionId
        );
        if (!division) {
          Alert.alert('Error', 'Division not found in this event.');
          return;
        }
        setCurrentDivision(division);

        const teams = await getTeamAssignments(
          fav.eventKey,
          fav.divisionId,
          null,
          [fav.teamId]
        );
        const team = teams.find((t) => t.TeamId === fav.teamId);
        if (!team) {
          Alert.alert('Error', 'Team not found in this division.');
          return;
        }
        setCurrentTeam(team);

        setScreenHistory([]);
        setScreen('TeamDashboard');
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to load team data');
      }
    },
    [currentEvent, currentTeam, screen]
  );

  const handleMenuNavigate = useCallback(
    (dest: MenuDestination) => {
      switch (dest) {
        case 'Home':
          setScreen('EventEntry');
          setScreenHistory([]);
          setCurrentDivision(null);
          setCurrentTeam(null);
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
          setScreenHistory((prev) => [...prev, screen]);
          setScreen('VenueMap');
          break;
      }
    },
    [screen, currentEvent, currentDivision, currentTeam]
  );

  const handleSetDefaultTeam = useCallback(() => {
    const fav = buildFavoriteFromCurrent();
    if (fav) {
      setDefaultTeam(fav);
      setFavoriteTeams((prev) => {
        if (
          prev.some(
            (f) => f.teamId === fav.teamId && f.eventKey === fav.eventKey
          )
        ) {
          return prev;
        }
        return [...prev, fav];
      });
    }
  }, [buildFavoriteFromCurrent]);

  const handleClearDefaultTeam = useCallback(() => {
    setDefaultTeam(null);
  }, []);

  const darkHeaderScreens: Screen[] = [
    'EventEntry',
    'DivisionSelect',
    'TeamSearch',
    'TeamDashboard',
    'OpponentScout',
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
      case 'EventEntry':
        return (
          <EventEntryScreen
            onEventLoaded={onEventLoaded}
            onViewVenueMap={() => navigate('VenueMap')}
            savedEvents={savedEvents}
          />
        );
      case 'DivisionSelect':
        return (
          <DivisionSelectScreen
            event={currentEvent!}
            onDivisionSelected={onDivisionSelected}
            onBack={goBack}
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
            event={currentEvent!}
            division={currentDivision!}
            team={currentTeam!}
            onBack={goBack}
            onViewStandings={() => navigate('Standings')}
            onViewCourtSchedule={() => navigate('CourtSchedule')}
            onViewBrackets={() => navigate('Brackets')}
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
            onBack={goBack}
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
          />
        );
      case 'VenueMap':
        return <VenueMapScreen onBack={goBack} />;
      default:
        return null;
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {renderScreen()}
      <View style={styles.menuOverlay}>
        <HamburgerMenu
          onNavigate={handleMenuNavigate}
          onNavigateToFavorite={handleNavigateToFavorite}
          onSetDefaultTeam={handleSetDefaultTeam}
          onClearDefaultTeam={handleClearDefaultTeam}
          hasEvent={!!currentEvent}
          hasDivision={!!currentDivision}
          hasTeam={!!currentTeam}
          currentScreen={screen === 'EventEntry' ? 'Home' : screen}
          light={darkHeaderScreens.includes(screen)}
          eventName={currentEvent?.Name}
          divisionName={currentDivision?.Name}
          divisionColor={currentDivision?.ColorHex}
          teamName={currentTeam?.TeamText || currentTeam?.TeamName}
          defaultTeam={defaultTeam}
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
    paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0,
  },
  menuOverlay: {
    position: 'absolute',
    top: Platform.OS === 'android' ? (RNStatusBar.currentHeight || 0) + 8 : 50,
    right: 8,
    zIndex: 100,
  },
});
