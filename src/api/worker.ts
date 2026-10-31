// Calls to this app's own Worker (/api/*), which caches and trims the heavy data sources.
import type { CollegeMap, DraftMap, PlayersMap, ValuesMap, ValuesParams, WeekData } from "../../shared/types.ts";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

export const workerApi = {
  players: () => get<PlayersMap>("/api/players"),
  draft: () => get<DraftMap>("/api/draft"),
  college: () => get<CollegeMap>("/api/college"),
  week: (season: number, week: number) => get<WeekData>(`/api/weeks/${season}/${week}`),
  values: ({ numQbs, numTeams, ppr }: ValuesParams) =>
    get<ValuesMap>(`/api/values?numQbs=${numQbs}&numTeams=${numTeams}&ppr=${ppr}`),
};
