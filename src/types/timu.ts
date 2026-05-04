// ── Timu Tournament Types ───────────────────────────────────────────────────

export interface TimuTournamentInfo {
  tid: number;
  name: string;
  subtitle?: string;
  dateText?: string;
  /** Start of the tournament in ms-epoch. Parsed from `dateText`. */
  dateMs?: number;
  startTime?: string;
  venueName?: string;
  venueAddress?: string;
  hostClub?: string;
  hostContact?: string;
  venueContact?: string;
  notes?: string;
}

export interface TimuPoolTeam {
  teamName: string;
  globalNumber: number;
  setsFor: number;
  setsAgainst: number;
  matchesFor: number;
  matchesAgainst: number;
  rank: number | null;
  day1Tag: boolean;
}

export interface TimuPoolHeadToHead {
  forGlobalNumber: number;
  vsGlobalNumber: number;
  sets: Array<{ us: number; them: number }>;
}

export interface TimuPool {
  poolId: string;
  name: string;
  matchesComplete?: string;
  teams: TimuPoolTeam[];
  headToHead: TimuPoolHeadToHead[];
}

export interface TimuPoolsPage {
  info: TimuTournamentInfo;
  pools: TimuPool[];
}

export interface TimuScheduleMatch {
  day: number;
  dayLabel: string;
  time: string;
  court: string;
  home: { ref: string; name?: string };
  away: { ref: string; name?: string };
  extraLabel?: string;
  isPlayoff: boolean;
  playoffMatchNumber?: number;
  rescheduled?: boolean;
}

export interface TimuSchedulePage {
  info: TimuTournamentInfo;
  matches: TimuScheduleMatch[];
  courts: string[];
}

export interface TimuPlayoffMatch {
  round: string;
  label?: string;
  team1Name: string;
  team2Name: string;
  sets: Array<{ a: number; b: number }>;
  winnerSide?: 1 | 2;
}

export interface TimuFinalRanking {
  rank: number;
  rankLabel: string;
  teamName: string;
}

export interface TimuPlayoffsPage {
  info: TimuTournamentInfo;
  matches: TimuPlayoffMatch[];
  finalRankings: TimuFinalRanking[];
}

export interface TimuMatchResult {
  dateText: string;
  time: string;
  matchLabel: string;
  format: string;
  court: string;
  home: { name: string; setsWon: number; scores: number[] };
  away: { name: string; setsWon: number; scores: number[] };
  isPool: boolean;
  isPlayoff: boolean;
}

export interface TimuResultsPage {
  info: TimuTournamentInfo;
  matches: TimuMatchResult[];
}

export interface TimuFavoriteTeam {
  source: 'timu';
  teamName: string;
  lastTid?: number;
  lastTournamentName?: string;
}

export interface SavedTimuTournament {
  source: 'timu';
  tid: number;
  name: string;
  subtitle?: string;
  dateText?: string;
  venueName?: string;
}
