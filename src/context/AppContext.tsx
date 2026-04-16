import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import type {
  AESEvent,
  AESDivision,
  AESTeamAssignment,
  FavoriteTeam,
  SavedEvent,
} from '../types/aes';

// ─── State ──────────────────────────────────────────────────────────────────

interface AppState {
  // Current selections
  currentEvent: AESEvent | null;
  currentDivision: AESDivision | null;
  currentTeam: AESTeamAssignment | null;

  // Saved data
  savedEvents: SavedEvent[];
  favoriteTeams: FavoriteTeam[];

  // Loading
  loading: boolean;
  error: string | null;
}

const initialState: AppState = {
  currentEvent: null,
  currentDivision: null,
  currentTeam: null,
  savedEvents: [],
  favoriteTeams: [],
  loading: false,
  error: null,
};

// ─── Actions ────────────────────────────────────────────────────────────────

type Action =
  | { type: 'SET_EVENT'; payload: AESEvent }
  | { type: 'SET_DIVISION'; payload: AESDivision }
  | { type: 'SET_TEAM'; payload: AESTeamAssignment }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'ADD_FAVORITE'; payload: FavoriteTeam }
  | { type: 'REMOVE_FAVORITE'; payload: { teamId: number; eventKey: string } }
  | { type: 'ADD_SAVED_EVENT'; payload: SavedEvent };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_EVENT':
      return {
        ...state,
        currentEvent: action.payload,
        currentDivision: null,
        currentTeam: null,
        error: null,
      };
    case 'SET_DIVISION':
      return { ...state, currentDivision: action.payload, currentTeam: null };
    case 'SET_TEAM':
      return { ...state, currentTeam: action.payload };
    case 'CLEAR_SELECTION':
      return {
        ...state,
        currentEvent: null,
        currentDivision: null,
        currentTeam: null,
      };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false };
    case 'ADD_FAVORITE': {
      const exists = state.favoriteTeams.some(
        (f) =>
          f.teamId === action.payload.teamId &&
          f.eventKey === action.payload.eventKey
      );
      if (exists) return state;
      return {
        ...state,
        favoriteTeams: [...state.favoriteTeams, action.payload],
      };
    }
    case 'REMOVE_FAVORITE':
      return {
        ...state,
        favoriteTeams: state.favoriteTeams.filter(
          (f) =>
            !(
              f.teamId === action.payload.teamId &&
              f.eventKey === action.payload.eventKey
            )
        ),
      };
    case 'ADD_SAVED_EVENT': {
      const exists = state.savedEvents.some(
        (e) => e.key === action.payload.key
      );
      if (exists) return state;
      return {
        ...state,
        savedEvents: [...state.savedEvents, action.payload],
      };
    }
    default:
      return state;
  }
}

// ─── Context ────────────────────────────────────────────────────────────────

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}
