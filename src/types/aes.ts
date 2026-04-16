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
  Court: AESCourt;
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
  TeamClub: AESClub;
  TeamDivision: AESDivision;
  OpponentClub: AESClub;
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
export interface FavoriteTeam {
  eventKey: string;
  eventName: string;
  teamId: number;
  teamName: string;
  teamText: string;
  teamCode: string;
  clubName: string;
  divisionId: number;
  divisionName: string;
  divisionColorHex: string;
}

export interface SavedEvent {
  key: string;
  name: string;
  startDate: string;
  endDate: string;
  location: string;
}
