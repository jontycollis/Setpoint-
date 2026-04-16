import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors, fontSize } from '../utils/theme';

import { EventEntryScreen } from '../screens/EventEntryScreen';
import { DivisionSelectScreen } from '../screens/DivisionSelectScreen';
import { TeamSelectScreen } from '../screens/TeamSelectScreen';
import { TeamDashboardScreen } from '../screens/TeamDashboardScreen';
import { StandingsScreen } from '../screens/StandingsScreen';
import { CourtScheduleScreen } from '../screens/CourtScheduleScreen';
import { OpponentScoutScreen } from '../screens/OpponentScoutScreen';

const Stack = createNativeStackNavigator();

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="EventEntry"
        screenOptions={{
          headerStyle: {
            backgroundColor: colors.primary,
          },
          headerTintColor: colors.textOnPrimary,
          headerTitleStyle: {
            fontWeight: '700',
            fontSize: fontSize.lg,
          },
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Screen
          name="EventEntry"
          component={EventEntryScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="DivisionSelect"
          component={DivisionSelectScreen}
          options={{ title: 'Select Division' }}
        />
        <Stack.Screen
          name="TeamSelect"
          component={TeamSelectScreen}
          options={{ title: 'Select Team' }}
        />
        <Stack.Screen
          name="TeamDashboard"
          component={TeamDashboardScreen}
          options={{ title: 'Team Dashboard' }}
        />
        <Stack.Screen
          name="Standings"
          component={StandingsScreen}
          options={{ title: 'Standings' }}
        />
        <Stack.Screen
          name="CourtSchedule"
          component={CourtScheduleScreen}
          options={{ title: 'Court Schedule' }}
        />
        <Stack.Screen
          name="OpponentScout"
          component={OpponentScoutScreen}
          options={({ route }: any) => ({
            title: `Scout: ${route.params?.opponentName || 'Opponent'}`,
            headerStyle: {
              backgroundColor: colors.accent,
            },
          })}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
