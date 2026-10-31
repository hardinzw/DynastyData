import type { Position } from "../../shared/positions.ts";
import { STAT_KEYS, type StatKey, type StatLine, type ValuesParams } from "../../shared/types.ts";
import type { League, ScoringSettings } from "../api/sleeper.ts";

// Stat keys that are context, not scoring categories.
const NON_SCORING = new Set<StatKey>(["gp", "off_snp", "tm_off_snp", "pts_half_ppr", "pts_ppr"]);
const SCORED_KEYS = STAT_KEYS.filter((k) => !NON_SCORING.has(k));

// Per-reception bonuses by position, e.g. TE premium.
const RECEPTION_BONUS: Partial<Record<Position, string>> = {
  RB: "bonus_rec_rb",
  WR: "bonus_rec_wr",
  TE: "bonus_rec_te",
};

/**
 * Fantasy points for one stat line under a league's scoring_settings.
 * Sleeper scoring keys match its stat keys, so most categories are stat × weight.
 * Yardage-threshold bonuses (e.g. bonus_rec_yd_100) are not handled yet.
 */
export function fantasyPoints(stats: StatLine, position: Position, scoring: ScoringSettings): number {
  let pts = 0;
  for (const key of SCORED_KEYS) {
    const weight = scoring[key];
    const value = stats[key];
    if (weight && value) pts += weight * value;
  }
  const bonusKey = RECEPTION_BONUS[position];
  if (bonusKey && scoring[bonusKey] && stats.rec) pts += scoring[bonusKey] * stats.rec;
  return Math.round(pts * 100) / 100;
}

/** FantasyCalc parameters that best match a league's format. */
export function valuesParamsFor(league: League): ValuesParams {
  const qbSlots = league.roster_positions.filter((p) => p === "QB" || p === "SUPER_FLEX").length;
  const rec = league.scoring_settings.rec ?? 0;
  return {
    numQbs: qbSlots >= 2 ? 2 : 1,
    numTeams: league.total_rosters,
    ppr: rec >= 0.75 ? 1 : rec >= 0.25 ? 0.5 : 0,
  };
}
