import { ENABLED_POSITIONS } from "../../shared/positions.ts";
import type { CollegeMap, DraftMap, DynastyValue, PlayersMap, ValuesMap, WeekData } from "../../shared/types.ts";
import type { LeagueUser, Roster } from "../api/sleeper.ts";
import { isUnplayedRookie, MISSED_SEASON_TIER, NO_RECENT_GAMES_TIER, rankBreakouts, rookieTier, scoreTier, withinAgeCap, type BoardTier, type BreakoutResult } from "./breakout.ts";
import { collegeStat, type CollegeStat } from "./college.ts";
import { currentlyOut, openingFor, roleHolders, type Opening, type RoleHolder } from "./opening.ts";
import { isCheap, isStarter, production } from "./production.ts";
import { buildUsage, usageOrLastSeason } from "./usage.ts";

export type Ownership =
  | { kind: "available" }
  | { kind: "mine" }
  | { kind: "rival"; ownerName: string };

export interface BoardRow extends BreakoutResult {
  /** A rookie who hasn't played. His tier comes from ROOKIE_TIERS; the score is unchanged. */
  rookie: boolean;
  /** He hasn't played this season, so `usage` is from last season. */
  usageFromLastSeason: boolean;
  tier: BoardTier;
  /** Shown next to the player. Not part of the score. */
  college: CollegeStat | null;
  value: DynastyValue | null;
  /** FantasyCalc ranks him outside starter range at his position; see isCheap. */
  cheap: boolean;
  ownership: Ownership;
  /** Teammates ahead of him who are out right now (in-season) or left (offseason). Not scored. */
  opening: Opening;
}

export interface BoardInput {
  players: PlayersMap;
  /** Weeks of the season being scored. */
  weeks: WeekData[];
  /** True while that season is being played; false when `weeks` is last season, in the offseason. */
  inSeason: boolean;
  /** The full season before it, to spot players who were already starters. */
  priorWeeks: WeekData[];
  draft: DraftMap;
  college: CollegeMap;
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
export function buildBoard({
  players,
  weeks,
  inSeason,
  priorWeeks,
  draft,
  college,
  values,
  rosters,
  users,
  myUserId,
}: BoardInput): BoardRow[] {
  const usage = buildUsage(weeks);
  const lastSeasonUsage = buildUsage(priorWeeks);
  const holders = roleHolders(usage);
  // In-season, gone means missing the team's last two games. In the offseason, it means
  // Sleeper now lists him on another team or none.
  const out = currentlyOut(weeks);
  const gone = inSeason
    ? (h: RoleHolder) => out.has(`${h.playerId}|${h.team}`)
    : (h: RoleHolder) => players[h.playerId]?.team !== h.team;
  const owned = ownershipMap(rosters, users, myUserId);
  // Half the weeks played so far, capped at 8: 4 games at week 8, as in the in-season backtest.
  const current = production(weeks, Math.max(1, Math.min(MIN_PRIOR_GAMES, Math.ceil(weeks.length / 2))));
  const prior = production(priorWeeks, MIN_PRIOR_GAMES);
  const inputs = Object.values(players)
    .filter((p) => p.team && ENABLED_POSITIONS.includes(p.position) && withinAgeCap(p))
    .filter((p) => !isStarter(current.get(p.id)) && !isStarter(prior.get(p.id)))
    .map((player) => ({
      player,
      usage: usageOrLastSeason(player.id, usage, lastSeasonUsage).usage,
      draft: draft[player.id] ?? null,
    }));
  const scoredSeason = weeks[0]?.season;
  const rookieRow = (r: BreakoutResult) =>
    scoredSeason != null && isUnplayedRookie(r.player, r.draft, r.usage, scoredSeason);
  const tierOf = (r: BreakoutResult, fromLastSeason: boolean): BoardTier => {
    if (rookieRow(r)) return rookieTier(r.score);
    if (fromLastSeason) return MISSED_SEASON_TIER;
    return r.usage ? scoreTier(r.score) : NO_RECENT_GAMES_TIER;
  };
  return rankBreakouts(inputs)
    .map((r) => {
      const { fromLastSeason } = usageOrLastSeason(r.player.id, usage, lastSeasonUsage);
      return {
        ...r,
        rookie: rookieRow(r),
        usageFromLastSeason: fromLastSeason,
        tier: tierOf(r, fromLastSeason),
        college: collegeStat(r.player, college[r.player.id] ?? []),
        opening: openingFor(
          {
            id: r.player.id,
            team: r.player.team,
            position: r.player.position,
            // Teammates ahead of him are judged on what he's done this season.
            share: fromLastSeason ? 0 : (r.usage?.opportunityShare ?? 0),
          },
          holders,
          gone,
        ),
        value: values[r.player.id] ?? null,
        cheap: isCheap(r.player.position, values[r.player.id]?.positionRank ?? null),
        ownership: owned.get(r.player.id) ?? { kind: "available" },
      };
    })
    .sort((a, b) => Number(a.tier === NO_RECENT_GAMES_TIER) - Number(b.tier === NO_RECENT_GAMES_TIER));
}
