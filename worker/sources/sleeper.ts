import { INGESTED_POSITIONS, isIngestedPosition } from "../../shared/positions.ts";
import { STAT_KEYS } from "../../shared/types.ts";
import type { PlayersMap, StatLine, WeekData, WeeklyLine } from "../../shared/types.ts";

const API = "https://api.sleeper.app/v1";
// Undocumented endpoint. Sleeper's own app uses it, but it can change without notice.
const STATS_API = "https://api.sleeper.com/stats/nfl";

export interface NflState {
  week: number;
  season: string;
  season_type: string;
}

interface RawPlayer {
  player_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string | null;
  team?: string | null;
  age?: number | null;
  birth_date?: string | null;
  years_exp?: number | null;
  depth_chart_position?: string | null;
  depth_chart_order?: number | null;
  injury_status?: string | null;
  injury_body_part?: string | null;
  status?: string | null;
  gsis_id?: string | null;
  search_rank?: number | null;
  metadata?: { rookie_year?: string } | null;
}

interface RawWeeklyStat {
  player_id: string;
  team: string | null;
  opponent: string | null;
  player?: { position?: string | null };
  stats: Record<string, number>;
}

const UNRANKED = 9_999_999;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return (await res.json()) as T;
}

export function fetchState(): Promise<NflState> {
  return getJson<NflState>(`${API}/state/nfl`);
}

/**
 * Downloads the full players list (~15 MB) and keeps QB/RB/WR/TE who are on a team
 * or still ranked. Sleeper asks for this to be fetched at most once a day.
 *
 * `includeFormer` keeps players who have since left the league. The backtest needs them,
 * or past seasons would only contain players who survived.
 */
export async function fetchPlayers({ includeFormer = false } = {}): Promise<PlayersMap> {
  const raw = await getJson<Record<string, RawPlayer>>(`${API}/players/nfl`);
  const players: PlayersMap = {};
  for (const p of Object.values(raw)) {
    if (!isIngestedPosition(p.position)) continue;
    const ranked = p.search_rank != null && p.search_rank < UNRANKED;
    if (!includeFormer && !p.team && !ranked) continue;
    const rookieYear = Number(p.metadata?.rookie_year);
    players[p.player_id] = {
      id: p.player_id,
      name: p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      position: p.position,
      team: p.team ?? null,
      age: p.age ?? null,
      birthDate: p.birth_date ?? null,
      yearsExp: p.years_exp ?? null,
      rookieYear: Number.isFinite(rookieYear) && rookieYear > 0 ? rookieYear : null,
      depthChartPosition: p.depth_chart_position ?? null,
      depthChartOrder: p.depth_chart_order ?? null,
      injuryStatus: p.injury_status ?? null,
      injuryBodyPart: p.injury_body_part ?? null,
      status: p.status ?? null,
      // Sleeper sometimes pads gsis_id with whitespace.
      gsisId: p.gsis_id?.trim() || null,
      searchRank: ranked ? p.search_rank! : null,
    };
  }
  return players;
}

/** Fetches one regular-season week of stats for QB/RB/WR/TE, with each player's team that week. */
export async function fetchWeek(season: number, week: number, final: boolean): Promise<WeekData> {
  const positions = INGESTED_POSITIONS.map((p) => `position[]=${p}`).join("&");
  const raw = await getJson<RawWeeklyStat[]>(
    `${STATS_API}/${season}/${week}?season_type=regular&${positions}`,
  );
  const lines: WeeklyLine[] = [];
  for (const r of raw) {
    const position = r.player?.position;
    if (!r.team || !isIngestedPosition(position)) continue;
    const stats: StatLine = {};
    for (const key of STAT_KEYS) {
      const v = r.stats[key];
      if (v) stats[key] = v;
    }
    // Skip players who were listed but never took the field.
    if (!stats.off_snp && !stats.gp) continue;
    lines.push({ playerId: r.player_id, position, team: r.team, opponent: r.opponent, stats });
  }
  return { season, week, final, lines };
}
