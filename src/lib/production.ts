import type { Position } from "../../shared/positions.ts";
import type { WeekData } from "../../shared/types.ts";

/** Positional PPG rank that counts as a weekly starter: RB24, WR24, TE12, QB12. */
export const STARTER_RANK: Record<Position, number> = { QB: 12, RB: 24, WR: 24, TE: 12 };

/**
 * Whether the market prices a player below starter level: his positional rank in the market
 * (ADP in the backtest, FantasyCalc in the app) is past 1.5× starter rank (RB/WR 36, TE 18),
 * or he isn't ranked at all. These are the breakouts the app is meant to find.
 */
export function isCheap(position: Position, marketPosRank: number | null): boolean {
  return marketPosRank == null || marketPosRank > 1.5 * STARTER_RANK[position];
}

/**
 * PPG where a player starts earning credit: roughly where he stops being cheap at his
 * position (RB36, WR36, TE18). QB is a placeholder until QB is enabled.
 */
export const REPLACEMENT_PPG: Record<Position, number> = { QB: 15, RB: 10, WR: 11, TE: 8 };

/** PPG that counts as a difference-maker. QB is a placeholder until QB is enabled. */
export const IMPACT_PPG: Record<Position, number> = { QB: 20, RB: 15, WR: 15, TE: 11 };

export interface Production {
  position: Position;
  games: number;
  /** PPR points per game. */
  ppg: number;
  /** Rank by PPG among players at the position with enough games. Null if too few games. */
  posRank: number | null;
}

/** PPR points per game over a set of weeks, ranked within each position. */
export function production(weeks: WeekData[], minGames: number): Map<string, Production> {
  const totals = new Map<string, { position: Position; games: number; points: number }>();
  for (const week of weeks) {
    for (const line of week.lines) {
      const t = totals.get(line.playerId) ?? { position: line.position, games: 0, points: 0 };
      t.games += 1;
      t.points += line.stats.pts_ppr ?? 0;
      totals.set(line.playerId, t);
    }
  }

  const result = new Map<string, Production>();
  for (const [id, t] of totals) {
    result.set(id, { position: t.position, games: t.games, ppg: t.points / t.games, posRank: null });
  }

  const qualified = [...result.values()].filter((p) => p.games >= minGames).sort((a, b) => b.ppg - a.ppg);
  const nextRank = new Map<Position, number>();
  for (const p of qualified) {
    const rank = (nextRank.get(p.position) ?? 0) + 1;
    nextRank.set(p.position, rank);
    p.posRank = rank;
  }
  return result;
}

export function isStarter(p: Production | undefined): boolean {
  return p?.posRank != null && p.posRank <= STARTER_RANK[p.position];
}

export function isImpact(p: Production | undefined): boolean {
  return p?.posRank != null && p.ppg >= IMPACT_PPG[p.position];
}

/** PPG above replacement. Zero below it or with too few games to be ranked. */
export function gradedCredit(p: Production | undefined): number {
  return p?.posRank != null ? Math.max(0, p.ppg - REPLACEMENT_PPG[p.position]) : 0;
}
