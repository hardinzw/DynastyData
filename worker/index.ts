import type { CollegeMap, DraftMap, PlayersMap, ValuesMap, ValuesParams, WeekData } from "../shared/types.ts";
import { buildCollegeMap, fetchCollegeSeason, type CollegeRow } from "./sources/college.ts";
import { fetchDraft } from "./sources/nflverse.ts";
import { fetchValues } from "./sources/fantasycalc.ts";
import { fetchPlayers, fetchState, fetchWeek } from "./sources/sleeper.ts";

const KEYS = {
  players: "players:v2",
  draft: "draft:v1",
  college: "college:v1",
  collegeSeason: (season: number) => `college-season:v1:${season}`,
  week: (season: number, week: number) => `week:v1:${season}:${week}`,
  values: (p: ValuesParams) => `values:v1:${p.numQbs}:${p.numTeams}:${p.ppr}`,
};

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const LAST_REGULAR_SEASON_WEEK = 18;
// College seasons kept: enough to cover every player young enough for the board.
const COLLEGE_SEASONS = 8;

function json(body: unknown, maxAge: number, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": `public, max-age=${maxAge}` },
  });
}

function error(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

async function getPlayers(env: Env): Promise<PlayersMap> {
  const cached = await env.DATA.get<PlayersMap>(KEYS.players, "json");
  if (cached) return cached;
  return refreshPlayers(env);
}

async function refreshPlayers(env: Env): Promise<PlayersMap> {
  const players = await fetchPlayers();
  await env.DATA.put(KEYS.players, JSON.stringify(players));
  return players;
}

async function getDraft(env: Env): Promise<DraftMap> {
  const cached = await env.DATA.get<DraftMap>(KEYS.draft, "json");
  if (cached) return cached;
  return refreshDraft(env, await getPlayers(env));
}

async function refreshDraft(env: Env, players: PlayersMap): Promise<DraftMap> {
  const draft = await fetchDraft(players);
  await env.DATA.put(KEYS.draft, JSON.stringify(draft));
  return draft;
}

/** A finished college season never changes, so each is stored forever once fetched. */
async function getCollegeSeason(env: Env, season: number): Promise<CollegeRow[]> {
  const key = KEYS.collegeSeason(season);
  const cached = await env.DATA.get<CollegeRow[]>(key, "json");
  if (cached) return cached;
  const rows = await fetchCollegeSeason(season);
  await env.DATA.put(key, JSON.stringify(rows));
  return rows;
}

async function getCollege(env: Env): Promise<CollegeMap> {
  const cached = await env.DATA.get<CollegeMap>(KEYS.college, "json");
  if (cached) return cached;
  return refreshCollege(env, await getPlayers(env));
}

/** Rebuilt daily so new players (rookies, signings) get matched to their college stats. */
async function refreshCollege(env: Env, players: PlayersMap): Promise<CollegeMap> {
  // The NFL season's year: the college season of the same year is still being played.
  const lastFinished = Number((await fetchState()).season) - 1;
  const seasons = [];
  for (let s = lastFinished - COLLEGE_SEASONS + 1; s <= lastFinished; s++) seasons.push(await getCollegeSeason(env, s));
  const college = buildCollegeMap(players, seasons);
  await env.DATA.put(KEYS.college, JSON.stringify(college), { expirationTtl: 2 * DAY });
  return college;
}

/** Finished weeks are stored forever. The current week is re-fetched every 10 minutes. */
async function getWeek(env: Env, season: number, week: number): Promise<WeekData | null> {
  const key = KEYS.week(season, week);
  const cached = await env.DATA.get<WeekData>(key, "json");
  if (cached?.final) return cached;

  const state = await fetchState();
  const currentSeason = Number(state.season);
  if (season > currentSeason || (season === currentSeason && week > state.week)) return null;
  const final = season < currentSeason || week < state.week || state.season_type !== "regular";
  if (cached && !final) return cached;

  const data = await fetchWeek(season, week, final);
  await env.DATA.put(key, JSON.stringify(data), final ? {} : { expirationTtl: 10 * MINUTE });
  return data;
}

async function getValues(env: Env, params: ValuesParams): Promise<ValuesMap> {
  const key = KEYS.values(params);
  const cached = await env.DATA.get<ValuesMap>(key, "json");
  if (cached) return cached;
  const values = await fetchValues(params);
  await env.DATA.put(key, JSON.stringify(values), { expirationTtl: 6 * HOUR });
  return values;
}

function parseValuesParams(url: URL): ValuesParams | null {
  const numQbs = Number(url.searchParams.get("numQbs") ?? 1);
  const numTeams = Number(url.searchParams.get("numTeams") ?? 12);
  const ppr = Number(url.searchParams.get("ppr") ?? 1);
  if (numQbs !== 1 && numQbs !== 2) return null;
  if (!Number.isInteger(numTeams) || numTeams < 4 || numTeams > 32) return null;
  if (![0, 0.5, 1].includes(ppr)) return null;
  return { numQbs, numTeams, ppr };
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/players") return json(await getPlayers(env), HOUR);
  if (path === "/api/draft") return json(await getDraft(env), DAY);
  if (path === "/api/college") return json(await getCollege(env), DAY);

  if (path === "/api/values") {
    const params = parseValuesParams(url);
    if (!params) return error("numQbs must be 1 or 2, numTeams 4-32, ppr 0, 0.5 or 1", 400);
    return json(await getValues(env, params), HOUR);
  }

  const weekMatch = path.match(/^\/api\/weeks\/(\d{4})\/(\d{1,2})$/);
  if (weekMatch) {
    const season = Number(weekMatch[1]);
    const week = Number(weekMatch[2]);
    if (week < 1 || week > LAST_REGULAR_SEASON_WEEK) return error("week must be 1-18", 400);
    const data = await getWeek(env, season, week);
    if (!data) return error("week has not been played yet", 404);
    return json(data, data.final ? DAY : 5 * MINUTE);
  }

  return error("not found", 404);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (e) {
      console.error(e);
      return error(e instanceof Error ? e.message : "upstream error", 502);
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const players = await refreshPlayers(env);
        await refreshDraft(env, players);
        await refreshCollege(env, players);
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
