// Persistent storage helpers using AsyncStorage
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FavoriteTeam, SavedEvent } from '../types/aes';
import type { SavedTimuTournament } from '../types/timu';

const KEYS = {
  savedEvents: 'aes.savedEvents',
  favoriteTeams: 'aes.favoriteTeams',
  myTeam: 'aes.myTeam', // the one persistent "My Team"
  courtStreams: 'aes.courtStreams', // per-event court → stream URL mappings
  tournamentHistory: 'aes.tournamentHistory', // cross-tournament results
  themeMode: 'aes.themeMode', // 'light' | 'dark'
  teamNotes: 'aes.teamNotes', // per-team coordination notes
  timuTournaments: 'timu.savedTournaments', // recent Timu tournaments
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

export async function loadMyTeam(): Promise<FavoriteTeam | null> {
  return getJson<FavoriteTeam | null>(KEYS.myTeam, null);
}

export async function saveMyTeam(team: FavoriteTeam | null): Promise<void> {
  return setJson(KEYS.myTeam, team);
}

// Court stream URL mappings: { [eventKey]: { [courtName]: streamUrl } }
export type CourtStreamMap = Record<string, string>;

export async function loadCourtStreams(eventKey: string): Promise<CourtStreamMap> {
  const all = await getJson<Record<string, CourtStreamMap>>(KEYS.courtStreams, {});
  return all[eventKey] || {};
}

export async function saveCourtStreams(eventKey: string, streams: CourtStreamMap): Promise<void> {
  const all = await getJson<Record<string, CourtStreamMap>>(KEYS.courtStreams, {});
  all[eventKey] = streams;
  return setJson(KEYS.courtStreams, all);
}

// ── Timu ──────────────────────────────────────────────────────────────────

export async function loadSavedTimuTournaments(): Promise<SavedTimuTournament[]> {
  const list = await getJson<SavedTimuTournament[]>(KEYS.timuTournaments, []);
  // Self-heal: drop entries written by earlier buggy parser versions
  // where the name field captured inline JavaScript or CSS.
  const healed = list.filter((t) => {
    if (!t || !t.name) return false;
    if (/[{};=]/.test(t.name) || t.name.length > 120) return false;
    if (!/[A-Za-z]/.test(t.name)) return false;
    return true;
  });
  if (healed.length !== list.length) {
    await saveSavedTimuTournaments(healed);
  }
  return healed;
}

export async function saveSavedTimuTournaments(tournaments: SavedTimuTournament[]): Promise<void> {
  return setJson(KEYS.timuTournaments, tournaments);
}

// ─── Cross-Tournament History (DEPRECATED / DEAD STORE) ─────────────────────
//
// This was the original AES-only cross-tournament store, populated by
// `addTournamentHistoryEntry` whenever the user opened a TeamDashboard
// for a team in an event. CrossTournamentScreen now reads from the
// unified AES + Timu indices (`buildMySeasonHistory` in
// `unifiedSeasonHistory.ts`), so this store is no longer written to by
// any screen. The key + types + helpers are kept so devices upgrading
// from older builds don't lose access to their legacy data; nothing
// CALLS the helpers below in current code, and tooling can safely
// retire the storage key in a future migration. **Do not add new
// writes here** — every history surface should come through
// `loadAllSeasonIndices()` so AES and Timu stay in lockstep.

export interface TournamentHistoryEntry {
  eventKey: string;
  eventName: string;
  divisionName: string;
  teamName: string;
  teamText: string;
  clubName: string;
  date: string; // ISO date of tournament
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  finishRank: number | null;
  totalTeams: number;
  results: TournamentMatchResult[];
}

export interface TournamentMatchResult {
  opponentName: string;
  won: boolean;
  setScores: string; // "25-18, 25-21"
  matchType: string; // "Pool A", "Gold Semi", etc.
}

/** @deprecated Use `loadAllSeasonIndices()` + `buildMySeasonHistory()` from
 *  `unifiedSeasonHistory.ts`. Retained for legacy data only. */
export async function loadTournamentHistory(): Promise<TournamentHistoryEntry[]> {
  return getJson<TournamentHistoryEntry[]>(KEYS.tournamentHistory, []);
}

/** @deprecated See `loadTournamentHistory`. */
export async function saveTournamentHistory(history: TournamentHistoryEntry[]): Promise<void> {
  return setJson(KEYS.tournamentHistory, history);
}

/** @deprecated The legacy `tournamentHistory` store is no longer the source
 *  of truth for cross-tournament views — `loadAllSeasonIndices()` is. New
 *  code should NEVER call this; AES indexing is handled by
 *  `indexAesSnapshot` and Timu by `indexTimuTournament`, both of which
 *  feed the unified path that every history screen reads from. */
export async function addTournamentHistoryEntry(entry: TournamentHistoryEntry): Promise<void> {
  const history = await loadTournamentHistory();
  // Replace if same event+team already exists, otherwise append
  const idx = history.findIndex(
    (h) => h.eventKey === entry.eventKey && h.teamText === entry.teamText
  );
  if (idx >= 0) {
    history[idx] = entry;
  } else {
    history.push(entry);
  }
  // Sort by date descending
  history.sort((a, b) => b.date.localeCompare(a.date));
  return saveTournamentHistory(history);
}

// ─── Theme Mode ──────────────────────────────────────────────────────────────

export async function loadThemeMode(): Promise<'light' | 'dark'> {
  const mode = await getJson<string>(KEYS.themeMode, 'light');
  return mode === 'dark' ? 'dark' : 'light';
}

export async function saveThemeMode(mode: 'light' | 'dark'): Promise<void> {
  return setJson(KEYS.themeMode, mode);
}

// ─── Team Notes (coordination) ───────────────────────────────────────────────

export interface TeamNote {
  id: string;
  text: string;
  timestamp: number;
  author?: string;
}

export async function loadTeamNotes(eventKey: string, teamId: number): Promise<TeamNote[]> {
  const all = await getJson<Record<string, TeamNote[]>>(KEYS.teamNotes, {});
  return all[`${eventKey}-${teamId}`] || [];
}

export async function saveTeamNote(eventKey: string, teamId: number, note: TeamNote): Promise<void> {
  const all = await getJson<Record<string, TeamNote[]>>(KEYS.teamNotes, {});
  const key = `${eventKey}-${teamId}`;
  if (!all[key]) all[key] = [];
  all[key].unshift(note); // newest first
  // Keep last 50 notes per team
  if (all[key].length > 50) all[key] = all[key].slice(0, 50);
  return setJson(KEYS.teamNotes, all);
}

export async function deleteTeamNote(eventKey: string, teamId: number, noteId: string): Promise<void> {
  const all = await getJson<Record<string, TeamNote[]>>(KEYS.teamNotes, {});
  const key = `${eventKey}-${teamId}`;
  if (all[key]) {
    all[key] = all[key].filter((n) => n.id !== noteId);
    return setJson(KEYS.teamNotes, all);
  }
}
