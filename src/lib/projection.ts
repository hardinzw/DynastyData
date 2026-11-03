import type { Position } from "../../shared/positions.ts";

/** Share of past outcomes the shown range is built to cover: the middle 80%. */
export const PROJECTION_RANGE = [0.1, 0.9] as const;

/** Games of an average player's PPG added in, so a few big games don't dominate. */
const SHRINK_GAMES = 4;

/** Past PPG pulled toward the position's average, more so with few games. */
export function shrunkPpg(ppg: number, games: number, averagePpg: number): number {
  return (ppg * games + averagePpg * SHRINK_GAMES) / (games + SHRINK_GAMES);
}

/**
 * Average past PPG among veterans in the fit. Coefficients are [intercept, past PPG, draft
 * score] for veterans and [intercept, draft score] for rookies. `range` is the held-out miss
 * at the edges of PROJECTION_RANGE. All from `npm run projection`, offseason cutoffs 2018-2023.
 */
const AVERAGE_PPG = { RB: 3.75, WR: 3.65, TE: 2.23 };

interface Fit {
  ppg: number[];
  plays: number[];
  range: [number, number];
}

const FITS: Record<keyof typeof AVERAGE_PPG, { veteran: Fit; rookie: Fit }> = {
  RB: {
    veteran: { ppg: [0.872, 0.78, 5.535], plays: [0.1773, 0.0569, 0.2641], range: [-5.02, 5.72] },
    rookie: { ppg: [0.905, 16.033], plays: [0.3835, 0.7374], range: [-5.11, 5.68] },
  },
  WR: {
    veteran: { ppg: [1.02, 0.761, 3.431], plays: [0.153, 0.0554, 0.2691], range: [-4.46, 5.27] },
    rookie: { ppg: [1.973, 10.819], plays: [0.3963, 0.6831], range: [-5.67, 5.17] },
  },
  TE: {
    veteran: { ppg: [0.506, 0.8, 2.832], plays: [0.2478, 0.0568, 0.4715], range: [-2.96, 3.98] },
    rookie: { ppg: [-0.218, 9.993], plays: [0.4813, 0.5915], range: [-3.53, 3.44] },
  },
};

export interface Projection {
  /** Expected PPG per season over the next three, in seasons he plays enough to count. */
  ppg: number;
  /** The middle 80% of what players like him have scored in those seasons. */
  low: number;
  high: number;
  /** Chance a given season has enough games to count (8), 0-1. */
  chancePlays: number;
}

export interface ProjectionInput {
  position: Position;
  /** Draft score, 0-1; see draftCapital in breakout.ts. */
  draftScore: number;
  /** His PPG and games so far, or null for a rookie who hasn't played. */
  past: { ppg: number; games: number } | null;
}

const predict = (beta: number[], features: number[]) => features.reduce((sum, v, i) => sum + v * beta[i + 1]!, beta[0]!);
const MIN_CHANCE = 0.05;
const MAX_CHANCE = 0.95;

/**
 * Past PPG and draft pick, since usage added nothing to them when predicting points. College
 * and age didn't help either. The score still ranks the board: this improves the number, but
 * it didn't pick better cheap players. Cheap veterans came in about 1 PPG under it.
 */
export function projectPpg({ position, draftScore, past }: ProjectionInput): Projection | null {
  if (position === "QB") return null;
  const averagePpg = AVERAGE_PPG[position];
  const fit = past ? FITS[position].veteran : FITS[position].rookie;
  const features = past ? [shrunkPpg(past.ppg, past.games, averagePpg), draftScore] : [draftScore];
  const ppg = Math.max(0, predict(fit.ppg, features));
  return {
    ppg,
    low: Math.max(0, ppg + fit.range[0]),
    high: ppg + fit.range[1],
    chancePlays: Math.min(MAX_CHANCE, Math.max(MIN_CHANCE, predict(fit.plays, features))),
  };
}
