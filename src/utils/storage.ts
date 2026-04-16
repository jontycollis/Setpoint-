// Persistent storage helpers using AsyncStorage
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FavoriteTeam, SavedEvent } from '../types/aes';

const KEYS = {
  savedEvents: 'aes.savedEvents',
  favoriteTeams: 'aes.favoriteTeams',
  defaultTeam: 'aes.defaultTeam',
};

async function getJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function setJson(key: string, value: unknown): Promise<void> {
  try {
    if (value == null) {
      await AsyncStorage.removeItem(key);
    } else {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // Ignore storage errors silently
  }
}

export async function loadSavedEvents(): Promise<SavedEvent[]> {
  return getJson<SavedEvent[]>(KEYS.savedEvents, []);
}

export async function saveSavedEvents(events: SavedEvent[]): Promise<void> {
  return setJson(KEYS.savedEvents, events);
}

export async function loadFavoriteTeams(): Promise<FavoriteTeam[]> {
  return getJson<FavoriteTeam[]>(KEYS.favoriteTeams, []);
}

export async function saveFavoriteTeams(teams: FavoriteTeam[]): Promise<void> {
  return setJson(KEYS.favoriteTeams, teams);
}

export async function loadDefaultTeam(): Promise<FavoriteTeam | null> {
  return getJson<FavoriteTeam | null>(KEYS.defaultTeam, null);
}

export async function saveDefaultTeam(team: FavoriteTeam | null): Promise<void> {
  return setJson(KEYS.defaultTeam, team);
}
