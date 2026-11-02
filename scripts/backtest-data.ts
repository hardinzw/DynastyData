// Loads and caches the historical data the backtest needs.
// Downloads are cached in .cache/backtest. Delete that folder to refetch.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CollegeMap, DraftMap, PlayersMap, WeekData } from "../shared/types.ts";
import type { Fold } from "../src/lib/backtest.ts";
import { buildCollegeMap, fetchCollegeSeason } from "../worker/sources/college.ts";
import { fetchDraft } from "../worker/sources/nflverse.ts";
import { fetchPlayers, fetchState, fetchWeek } from "../worker/sources/sleeper.ts";

const CACHE_DIR = join(import.meta.dirname, "..", ".cache", "backtest");
// Sleeper's projections have no usable ADP before 2022, so in-season folds start there.
// Next-season folds can start a year earlier because they price at the next season's ADP.
const IN_SEASON_SEASONS = [2022, 2023, 2024, 2025];
const NEXT_SEASON_SEASONS = [2021, 2022, 2023, 2024];
const LAST_WEEK = 18;
const IN_SEASON_CUTOFF_WEEK = 8;

async function cached<T>(name: string, load: () => Promise<T>): Promise<T> {
  const file = join(CACHE_DIR, `${name}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as T;
  const data = await load();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  return data;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export function loadWeeks(season: number, from: number, to: number): Promise<WeekData[]> {
  return Promise.all(range(from, to).map((w) => cached(`week-${season}-${w}`, () => fetchWeek(season, w, true))));
}

/**
 * Sleeper's positional ADP as of a given week, from its projections. It's redraft PPR ADP,
 * not dynasty, but it's the only point-in-time market price available.
 */
function loadAdp(season: number, week: number): Promise<Record<string, number>> {
  return cached(`posadp-${season}-${week}`, async () => {
    const url = `https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=regular&position[]=RB&position[]=WR&position[]=TE`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    const rows = (await res.json()) as { player_id: string; stats: { pos_adp_dd_ppr?: number } }[];
    const UNRANKED = 1000;
    const adp: Record<string, number> = {};
    for (const r of rows) {
      const posAdp = r.stats.pos_adp_dd_ppr;
      if (posAdp && posAdp < UNRANKED) adp[r.player_id] = posAdp;
    }
    return adp;
  });
}

async function inSeasonFold(season: number): Promise<Fold> {
  const weeks = await loadWeeks(season, 1, LAST_WEEK);
  return {
    label: `${season} wk1-${IN_SEASON_CUTOFF_WEEK} → wk${IN_SEASON_CUTOFF_WEEK + 1}-${LAST_WEEK}`,
    kind: "in-season",
    priorWeeks: await loadWeeks(season - 1, 1, LAST_WEEK),
    featureWeeks: weeks.slice(0, IN_SEASON_CUTOFF_WEEK),
    outcomeWeeks: weeks.slice(IN_SEASON_CUTOFF_WEEK),
    cutoffDate: `${season}-11-01`,
    adp: await loadAdp(season, IN_SEASON_CUTOFF_WEEK + 1),
    minFeatureGames: 4,
    minOutcomeGames: 5,
  };
}

async function nextSeasonFold(season: number): Promise<Fold> {
  return {
    label: `${season} → ${season + 1}`,
    kind: "next-season",
    priorWeeks: await loadWeeks(season - 1, 1, LAST_WEEK),
    featureWeeks: await loadWeeks(season, 1, LAST_WEEK),
    outcomeWeeks: await loadWeeks(season + 1, 1, LAST_WEEK),
    // Scores are taken in the offseason, priced at the next season's week 1 ADP.
    cutoffDate: `${season + 1}-08-01`,
    adp: await loadAdp(season + 1, 1),
    minFeatureGames: 8,
    minOutcomeGames: 8,
  };
}

// College seasons for every draft class the backtest can see (2016 on).
const FIRST_COLLEGE_SEASON = 2012;
const LAST_COLLEGE_SEASON = 2025;

/** College stats for the history page. The score doesn't use them. */
export async function loadCollege(players: PlayersMap): Promise<CollegeMap> {
  const seasons = await Promise.all(
    range(FIRST_COLLEGE_SEASON, LAST_COLLEGE_SEASON).map((s) => cached(`college-${s}`, () => fetchCollegeSeason(s))),
  );
  return buildCollegeMap(players, seasons);
}

export async function loadPlayersAndDraft(): Promise<{ players: PlayersMap; draft: DraftMap }> {
  const players = await cached("players-all-v2", () => fetchPlayers({ includeFormer: true }));
  const draft = await cached("draft", () => fetchDraft(players));
  return { players, draft };
}

/** Score after week 8, breakout = starter in weeks 9-18. */
export async function inSeasonFolds(): Promise<Fold[]> {
  const folds = [];
  for (const s of IN_SEASON_SEASONS) folds.push(await inSeasonFold(s));
  return folds;
}

/** Score after the season, breakout = starter the next season. */
export async function nextSeasonFolds(): Promise<Fold[]> {
  const folds = [];
  for (const s of NEXT_SEASON_SEASONS) folds.push(await nextSeasonFold(s));
  return folds;
}

/**
 * Last offseason's scores against the current season so far, for the breakout history.
 * Not used for tuning: the season isn't over. Null outside the regular season or before
 * enough weeks have been played to rank anyone.
 */
export async function currentSeasonFold(): Promise<{ fold: Fold; throughWeek: number } | null> {
  const state = await fetchState();
  const season = Number(state.season);
  const throughWeek = state.week - 1; // Only finished weeks, which are safe to cache.
  const MIN_WEEKS = 4;
  if (state.season_type !== "regular" || throughWeek < MIN_WEEKS) return null;
  return {
    throughWeek,
    fold: {
      label: `${season - 1} → ${season} (through week ${throughWeek})`,
      kind: "next-season",
      priorWeeks: await loadWeeks(season - 2, 1, LAST_WEEK),
      featureWeeks: await loadWeeks(season - 1, 1, LAST_WEEK),
      outcomeWeeks: await loadWeeks(season, 1, throughWeek),
      cutoffDate: `${season}-08-01`,
      adp: await loadAdp(season, 1),
      minFeatureGames: 8,
      // Half the weeks played, as the board does.
      minOutcomeGames: Math.ceil(throughWeek / 2),
    },
  };
}
