import type { CollegeSeason, PlayerInfo } from "../../shared/types.ts";

// College production shown next to each player. It isn't part of the score: it barely moved
// the backtest once usage and draft pick were known.

/** College seasons shorter than this are ignored (injuries, redshirt years). */
const MIN_COLLEGE_GAMES = 5;
/** WR college breakout: first season with this share of his team's receiving yards. */
const WR_BREAKOUT_SHARE = 0.2;
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Age on September 1 of a season, in years with decimals. */
function ageInSeason(birthDate: string | null, season: number): number | null {
  if (!birthDate) return null;
  return (Date.UTC(season, 8, 1) - Date.parse(birthDate)) / (365.25 * 24 * 3600 * 1000);
}

/**
 * The college number the model uses at each position. Among the 2020-23 draft classes,
 * these predicted NFL starter seasons beyond draft pick: RBs who caught passes, TEs who
 * drew targets, and (weakly) WRs who produced young. WR market share itself added nothing
 * once draft pick was known.
 */
export type CollegeStat =
  | { kind: "recYardShare"; share: number; season: number } // RB
  | { kind: "targetShare"; share: number; season: number } // TE
  | { kind: "breakoutAge"; age: number | null; season: number | null }; // WR; null age: never broke out

export function collegeStat(player: PlayerInfo, college: CollegeSeason[]): CollegeStat | null {
  const seasons = college.filter((c) => c.games >= MIN_COLLEGE_GAMES);
  const last = seasons.at(-1);
  if (!last) return null;
  switch (player.position) {
    case "RB":
      return { kind: "recYardShare", share: last.teamRecYards > 0 ? last.recYards / last.teamRecYards : 0, season: last.season };
    case "TE":
      return { kind: "targetShare", share: last.teamTargets > 0 ? last.targets / last.teamTargets : 0, season: last.season };
    case "WR": {
      const breakout = seasons.find((c) => c.teamRecYards > 0 && c.recYards / c.teamRecYards >= WR_BREAKOUT_SHARE);
      if (!breakout) return { kind: "breakoutAge", age: null, season: null };
      const age = ageInSeason(player.birthDate, breakout.season);
      return age == null ? null : { kind: "breakoutAge", age, season: breakout.season };
    }
    case "QB":
      return null;
  }
}

/** Short text for a college stat, e.g. "12% rec yds" or "Broke out at 19". */
export function describeCollegeStat(stat: CollegeStat): string {
  switch (stat.kind) {
    case "recYardShare":
      return `${pct(stat.share)} of team rec yds`;
    case "targetShare":
      return `${pct(stat.share)} target share`;
    case "breakoutAge":
      return stat.age == null ? "No college breakout" : `Broke out at ${Math.floor(stat.age)}`;
  }
}
