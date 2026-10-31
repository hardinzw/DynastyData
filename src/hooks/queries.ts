import { useQueries, useQuery } from "@tanstack/react-query";
import type { ValuesParams } from "../../shared/types.ts";
import { sleeper, type NflState } from "../api/sleeper.ts";
import { workerApi } from "../api/worker.ts";

const HOUR = 60 * 60 * 1000;
export const LAST_REGULAR_SEASON_WEEK = 18;

export function useNflState() {
  return useQuery({ queryKey: ["state"], queryFn: sleeper.state, staleTime: 10 * 60 * 1000 });
}

export function useUser(username: string) {
  return useQuery({ queryKey: ["user", username], queryFn: () => sleeper.user(username), staleTime: HOUR });
}

export function useLeagues(userId: string | undefined, season: string | undefined) {
  return useQuery({
    queryKey: ["leagues", userId, season],
    queryFn: () => sleeper.leagues(userId!, season!),
    enabled: !!userId && !!season,
  });
}

export function useLeague(leagueId: string) {
  const [league, rosters, users] = useQueries({
    queries: [
      { queryKey: ["league", leagueId], queryFn: () => sleeper.league(leagueId) },
      { queryKey: ["rosters", leagueId], queryFn: () => sleeper.rosters(leagueId) },
      { queryKey: ["leagueUsers", leagueId], queryFn: () => sleeper.users(leagueId) },
    ],
  });
  return { league, rosters, users };
}

export function usePlayers() {
  return useQuery({ queryKey: ["players"], queryFn: workerApi.players, staleTime: 6 * HOUR });
}

export function useDraft() {
  return useQuery({ queryKey: ["draft"], queryFn: workerApi.draft, staleTime: 24 * HOUR });
}

export function useValues(params: ValuesParams | undefined) {
  return useQuery({
    queryKey: ["values", params],
    queryFn: () => workerApi.values(params!),
    enabled: !!params,
    staleTime: HOUR,
  });
}

/**
 * The season and weeks to read stats from. During the regular season that's this season
 * up to the current week; otherwise it's the last completed regular season.
 */
export function statsWindow(state: NflState): { season: number; lastWeek: number } {
  if (state.season_type === "regular") return { season: Number(state.season), lastWeek: state.week };
  if (state.season_type === "post") return { season: Number(state.season), lastWeek: LAST_REGULAR_SEASON_WEEK };
  return { season: Number(state.previous_season), lastWeek: LAST_REGULAR_SEASON_WEEK };
}

export function useSeasonWeeks(season: number | undefined, lastWeek: number | undefined) {
  const weeks = season && lastWeek ? Array.from({ length: lastWeek }, (_, i) => i + 1) : [];
  return useQueries({
    queries: weeks.map((week) => ({
      queryKey: ["week", season, week],
      queryFn: () => workerApi.week(season!, week),
      staleTime: week < lastWeek! ? Infinity : 5 * 60 * 1000,
    })),
    combine: (results) => ({
      data: results.every((r) => r.data) ? results.map((r) => r.data!) : undefined,
      isLoading: results.some((r) => r.isLoading),
      error: results.find((r) => r.error)?.error ?? null,
    }),
  });
}
