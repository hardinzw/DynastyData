// Documented Sleeper endpoints, called straight from the browser (Sleeper allows CORS).
// Data that needs caching or trimming goes through the Worker instead; see api/worker.ts.

const API = "https://api.sleeper.app/v1";

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
}

export interface NflState {
  week: number;
  season: string;
  previous_season: string;
  season_type: "pre" | "regular" | "post" | "off";
}

export type ScoringSettings = Record<string, number>;

export interface League {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: ScoringSettings;
  /** settings.type: 0 redraft, 1 keeper, 2 dynasty. */
  settings: { type: number };
  previous_league_id: string | null;
  avatar: string | null;
}

export interface Roster {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
}

export interface LeagueUser {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`Sleeper ${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

export const sleeper = {
  state: () => get<NflState>("/state/nfl"),
  // Returns null (not 404) for an unknown username.
  user: (usernameOrId: string) => get<SleeperUser | null>(`/user/${encodeURIComponent(usernameOrId)}`),
  leagues: (userId: string, season: string) => get<League[]>(`/user/${userId}/leagues/nfl/${season}`),
  league: (leagueId: string) => get<League>(`/league/${leagueId}`),
  rosters: (leagueId: string) => get<Roster[]>(`/league/${leagueId}/rosters`),
  users: (leagueId: string) => get<LeagueUser[]>(`/league/${leagueId}/users`),
};

export const DYNASTY_LEAGUE_TYPE = 2;

export function isDynasty(league: League): boolean {
  return league.settings.type === DYNASTY_LEAGUE_TYPE;
}
