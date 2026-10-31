import type { Position } from "./positions.ts";

/** Trimmed player record served at /api/players. Built from Sleeper /players/nfl. */
export interface PlayerInfo {
  id: string;
  name: string;
  position: Position;
  team: string | null;
  age: number | null;
  birthDate: string | null;
  yearsExp: number | null;
  rookieYear: number | null;
  depthChartPosition: string | null;
  depthChartOrder: number | null;
  injuryStatus: string | null;
  injuryBodyPart: string | null;
  status: string | null;
  gsisId: string | null;
  searchRank: number | null;
}

export type PlayersMap = Record<string, PlayerInfo>;

/** Stat keys kept from Sleeper's weekly stats. Keep in sync with what lib/ uses. */
export const STAT_KEYS = [
  "gp",
  "off_snp",
  "tm_off_snp",
  "pass_att",
  "pass_cmp",
  "pass_yd",
  "pass_td",
  "pass_int",
  "pass_2pt",
  "pass_fd",
  "rush_att",
  "rush_yd",
  "rush_td",
  "rush_fd",
  "rush_rz_att",
  "rush_2pt",
  "rec_tgt",
  "rec",
  "rec_yd",
  "rec_td",
  "rec_fd",
  "rec_air_yd",
  "rec_rz_tgt",
  "rec_2pt",
  "fum_lost",
  "pts_half_ppr",
  "pts_ppr",
] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type StatLine = Partial<Record<StatKey, number>>;

/** One player's game in one week, served at /api/weeks/:season/:week. */
export interface WeeklyLine {
  playerId: string;
  position: Position;
  team: string;
  opponent: string | null;
  stats: StatLine;
}

export interface WeekData {
  season: number;
  week: number;
  /** True once the week is over and the data will no longer change. */
  final: boolean;
  lines: WeeklyLine[];
}

/** nflverse draft pick, served at /api/draft keyed by Sleeper player id. */
export interface DraftInfo {
  season: number;
  round: number;
  pick: number;
  team: string;
}

export type DraftMap = Record<string, DraftInfo>;

/** FantasyCalc dynasty value, served at /api/values keyed by Sleeper player id. */
export interface DynastyValue {
  value: number;
  overallRank: number;
  positionRank: number;
  trend30Day: number;
  tier: number | null;
}

export type ValuesMap = Record<string, DynastyValue>;

/** League format FantasyCalc values are computed for. */
export interface ValuesParams {
  /** 1 for 1QB leagues, 2 for superflex or 2QB. */
  numQbs: 1 | 2;
  numTeams: number;
  /** Points per reception: 0, 0.5 or 1. */
  ppr: number;
}
