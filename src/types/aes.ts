// AES API Types - based on reverse-engineered API from results.advancedeventsystems.com

export interface AESEvent {
  Key: string;
  EventId: number;
  Name: string;
  StartDate: string;
  EndDate: string;
  Location: string;
  CustomEventType: string | null;
  IsOver: boolean;
  Clubs: AESClub[];
  Divisions: AESDivision[];
}

export interface AESClub {
  ClubId: number;
  Name: string;
}

export interface AESDivision {
  IsFinished: boolean;
  DivisionId: number;
  Name: string;
  TeamCount: number;
  CodeAlias: string;
  ColorHex: string;
}

export interface AESCourt {
  CourtId: number;
  Name: string;
  VideoLink: string;
}

export interface AESMatch {
  MatchId: number;
  ScheduledStartDateTime: string;
  ScheduledEndDateTime: string;
  // Court is nullable on the wire — matches that haven't been assigned a
  // court (TBD slots, postponed/deferred matches) come back with
  // `Court: null`. Was originally typed non-null which crashed
  // `Court.Name` reads at runtime; every consumer now uses `?.`.
  Court: AESCourt | null;
}

export interface AESTeamAssignment {
  TeamId: number;
  TeamName: string;
  TeamCode: string;
  TeamText: string;
  OpponentTeamName: string;
  OpponentTeamText: string;
  OpponentTeamId: number;
  SearchableTeamName: string;
  NextPendingReseed: boolean;
  NextWorkMatchDate: string | null;
  // Both clubs are nullable in the wire data — teams without a club
  // affiliation (the most common case for invitational rosters) come
  // back with `TeamClub: null` / `OpponentClub: null`. Type was
  // originally non-null which crashed `TeamClub.Name` reads at
  // runtime; every consumer now uses optional-chain access.
  TeamClub: AESClub | null;
  TeamDivision: AESDivision;
  OpponentClub: AESClub | null;
  NextMatch: AESMatch | null;
  WorkMatchs: AESMatch[];
}

export interface AESPoolTeam {
  TeamId: number;
  TeamName: string;
  TeamCode: string;
  MatchesWon: number;
  MatchesLost: number;
  SetsWon: number;
  SetsLost: number;
  MatchPercentage: number;
  SetPercentage: number;
  PointPercentage: number;
  Rank: number;
}

export interface AESPool {
  PoolId: number;
  Name: string;
  Courts: string;
  Teams: AESPoolTeam[];
  Matches: AESPoolMatch[];
}

export interface AESPoolMatch {
  MatchId: number;
  MatchCode: string;
  ScheduledStartDateTime: string;
  Court: AESCourt;
  HomeTeam: AESMatchTeam;
  AwayTeam: AESMatchTeam;
  Sets: AESSet[];
  IsComplete: boolean;
  WinnerTeamId: number | null;
}

export interface AESMatchTeam {
  TeamId: number;
  TeamName: string;
  TeamCode: string;
  TeamText: string;
  ClubName: string;
}

export interface AESSet {
  SetNumber: number;
  HomeScore: number;
  AwayScore: number;
}

export interface AESStanding {
  TeamId: number;
  TeamName: string;
  TeamCode: string;
  TeamText: string;
  MatchesWon: number;
  MatchesLost: number;
  MatchPercent: number;
  SetsWon: number;
  SetsLost: number;
  SetPercent: number;
  PointRatio: number;
  FinishRank: number | null;
  OverallRank: number | null;
  FinishRankText: string;
  SearchableTeamName: string;
  Club: { ClubId: number; Name: string };
  Division: { DivisionId: number; Name: string; TeamCount: number; CodeAlias: string; ColorHex: string };
  BidIdentification: any;
}

export interface AESCourtScheduleEntry {
  MatchId: number;
  MatchCode: string;
  DivisionName: string;
  ScheduledStartDateTime: string;
  ScheduledEndDateTime: string;
  Court: AESCourt;
  HomeTeam: AESMatchTeam;
  AwayTeam: AESMatchTeam;
  WorkTeam: AESMatchTeam | null;
}

// App-specific types
//
// FavoriteTeam covers both AES and Timu tournaments. AES favorites pin a
// specific (teamId, eventKey) pair. Timu favorites match by team NAME,
// since Timu has no stable IDs across tournaments — the `lastTid` field
// is used for navigation ("take me back to where I saw this team").
export interface FavoriteTeam {
  /** 'aes' (default when undefined) or 'timu'. */
  source?: 'aes' | 'timu';
  // AES fields (required for AES; filled with sentinels for Timu)
  eventKey: string;       // AES: Base64 event key. Timu: `timu:${tid}` for uniqueness
  eventName: string;      // AES event name or Timu tournament name
  teamId: number;         // AES: numeric team id. Timu: 0 (not used)
  teamName: string;
  teamText: string;
  teamCode: string;       // "" for Timu
  clubName: string;       // "" for Timu (Timu doesn't expose club)
  divisionId: number;     // 0 for Timu
  divisionName: string;   // "" for Timu
  divisionColorHex: string; // neutral color for Timu (we use accent)
  // Timu-only
  lastTid?: number;       // Most recently seen Timu tournament id for this team
}

export interface SavedEvent {
  key: string;
  name: string;
  startDate: string;
  endDate: string;
  location: string;
}
