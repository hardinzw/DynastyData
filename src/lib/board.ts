import { ENABLED_POSITIONS } from "../../shared/positions.ts";
import type { DraftMap, DynastyValue, PlayersMap, ValuesMap, WeekData } from "../../shared/types.ts";
import type { LeagueUser, Roster } from "../api/sleeper.ts";
import { rankBreakouts, withinAgeCap, type BreakoutResult } from "./breakout.ts";
import { isStarter, production } from "./production.ts";
import { buildUsage, summarizeUsage } from "./usage.ts";

export type Ownership =
  | { kind: "available" }
  | { kind: "mine" }
  | { kind: "rival"; ownerName: string };

export interface BoardRow extends BreakoutResult {
  value: DynastyValue | null;
  ownership: Ownership;
}

export interface BoardInput {
  players: PlayersMap;
  /** Weeks of the season being scored. */
  weeks: WeekData[];
  /** The full season before it, to spot players who were already starters. */
  priorWeeks: WeekData[];
  draft: DraftMap;
  values: ValuesMap;
  rosters: Roster[];
  users: LeagueUser[];
  myUserId: string | null;
}

function ownershipMap(rosters: Roster[], users: LeagueUser[], myUserId: string | null): Map<string, Ownership> {
  const names = new Map(users.map((u) => [u.user_id, u.metadata?.team_name || u.display_name]));
  const owned = new Map<string, Ownership>();
  for (const r of rosters) {
    const ownership: Ownership =
      r.owner_id && r.owner_id === myUserId
        ? { kind: "mine" }
        : { kind: "rival", ownerName: (r.owner_id && names.get(r.owner_id)) || `Team ${r.roster_id}` };
    for (const id of r.players ?? []) owned.set(id, ownership);
  }
  return owned;
}

/** Games needed in the prior season to count as an established starter. Matches the backtest. */
const MIN_PRIOR_GAMES = 8;

/**
 * Scores the same population the backtest tuned on: players at the enabled positions who
 * are within the age cap and weren't already starters this season or last season.
 */
export function buildBoard({ players, weeks, priorWeeks, draft, values, rosters, users, myUserId }: BoardInput): BoardRow[] {
  const usage = buildUsage(weeks);
  const owned = ownershipMap(rosters, users, myUserId);
  // Half the weeks played so far, capped at 8: 4 games at week 8, as in the in-season backtest.
  const current = production(weeks, Math.max(1, Math.min(MIN_PRIOR_GAMES, Math.ceil(weeks.length / 2))));
  const prior = production(priorWeeks, MIN_PRIOR_GAMES);
  const inputs = Object.values(players)
    .filter((p) => p.team && ENABLED_POSITIONS.includes(p.position) && withinAgeCap(p))
    .filter((p) => !isStarter(current.get(p.id)) && !isStarter(prior.get(p.id)))
    .map((player) => ({
      player,
      usage: summarizeUsage(usage.get(player.id) ?? []),
      draft: draft[player.id] ?? null,
      market: values[player.id]?.value ?? null,
    }));
  return rankBreakouts(inputs).map((r) => ({
    ...r,
    value: values[r.player.id] ?? null,
    ownership: owned.get(r.player.id) ?? { kind: "available" },
  }));
}
