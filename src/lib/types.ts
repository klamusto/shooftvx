import type { MatchStatus } from "@/lib/parse";

export type { MatchStatus, ParsedMatch } from "@/lib/parse";

/** What the watch page should render above the fold. */
export type PlayerState =
  | "live" // embed the player iframe
  | "waiting" // upcoming match — countdown, player appears at kickoff
  | "ended" // broadcast over (or not covered) — show final state, no iframe
  | "unavailable"; // no player right now — keep retrying, no broken iframe

export interface MatchView {
  id: number;
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
  league: string | null;
  competition: string | null;
  startTime: string;
  status: MatchStatus;
  statusLabel: string | null;
  homeScore: number | null;
  awayScore: number | null;
  gameTime: string | null;
  homeScorers: string[];
  awayScorers: string[];
  watchUrl: string;
}

export interface MatchesResponse {
  matches: MatchView[];
  generatedAt: string;
  source: string;
  counts: { all: number; live: number; upcoming: number; finished: number };
  history: { date: string; count: number }[];
  syncError?: string | null;
  dbError?: string | null;
  usedDate?: string;
}

export interface KooraGame {
  id?: number;
  competitionDisplayName?: string;
  startTime?: string;
  statusGroup?: number;
  statusText?: string;
  shortStatusText?: string;
  gameTimeDisplay?: string;
  roundName?: string;
  seasonNum?: number;
  homeCompetitor?: { name?: string; score?: number };
  awayCompetitor?: { name?: string; score?: number };
  [key: string]: unknown;
}

export interface WatchResponse {
  matchId: number;
  playerSrc: string | null;
  playerState: PlayerState;
  watchUrl: string | null;
  sourceUrl: string | null;
  match: MatchView | null;
  game: KooraGame | null;
  details: MatchDetails | null;
  resolved: boolean;
}

/* ---------- Match details (lineups / stats / standings) ---------- */

export interface LineupPlayer {
  name: string;
  number: number | null;
  position: string;
  goals: number | null;
  yellow: number;
  red: number;
}

export interface TeamLineup {
  formation: string | null;
  players: LineupPlayer[];
}

export interface StatRow {
  name: string;
  home: string;
  away: string;
  homePct: number;
  awayPct: number;
}

export interface StandingRow {
  position: number;
  name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  points: number;
  isMatchTeam?: boolean;
}

export interface MatchDetails {
  venue: string | null;
  referee: string | null;
  kickoff: string | null;
  roundName: string | null;
  competition: string | null;
  home: TeamLineup | null;
  away: TeamLineup | null;
  stats: StatRow[];
  standings: StandingRow[];
}
