import { ENABLED_POSITIONS } from "../../shared/positions.ts";
import type { DraftMap, DynastyValue, PlayersMap, ValuesMap, WeekData } from "../../shared/types.ts";
import type { LeagueUser, Roster } from "../api/sleeper.ts";
import { rankBreakouts, type BreakoutResult } from "./breakout.ts";
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
  weeks: WeekData[];
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

/** Scores every rostered-or-available player at the enabled positions for one league. */
export function buildBoard({ players, weeks, draft, values, rosters, users, myUserId }: BoardInput): BoardRow[] {
  const usage = buildUsage(weeks);
  const owned = ownershipMap(rosters, users, myUserId);
  const inputs = Object.values(players)
    .filter((p) => p.team && ENABLED_POSITIONS.includes(p.position))
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
