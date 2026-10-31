import type { Position } from "../../shared/positions.ts";
import type { DraftInfo, PlayerInfo } from "../../shared/types.ts";
import type { UsageSummary } from "./usage.ts";

// v0 model: hand-picked weights and thresholds. Replace with backtested values.

export type SignalKey = "usageTrend" | "usageLevel" | "youth" | "draftCapital" | "marketLag";

export type Weights = Record<SignalKey, number>;

export const DEFAULT_WEIGHTS: Weights = {
  usageTrend: 0.3,
  usageLevel: 0.2,
  youth: 0.15,
  draftCapital: 0.15,
  marketLag: 0.2,
};

/** Opportunity share that counts as a full workload at each position. */
const FULL_OPPORTUNITY: Record<Position, number> = { QB: 0.2, RB: 0.45, WR: 0.25, TE: 0.2 };

/** Age where breakout odds start to fall, and age where they are treated as zero. */
const AGE_WINDOW: Record<Position, [peak: number, done: number]> = {
  QB: [26, 31],
  RB: [24, 27],
  WR: [24, 28],
  TE: [25, 29],
};

const DRAFT_ROUND_SCORE = [1, 0.75, 0.5, 0.3]; // rounds 1-4; later rounds get LATE_ROUND_SCORE
const LATE_ROUND_SCORE = 0.15;
const UNKNOWN_DRAFT_SCORE = 0.1;

// Gains that score a full 1.0 on the trend signal.
const FULL_OPPORTUNITY_GAIN = 0.1;
const FULL_SNAP_GAIN = 0.25;

export interface BreakoutInput {
  player: PlayerInfo;
  usage: UsageSummary | null;
  draft: DraftInfo | null;
  /**
   * What the market charges for the player; higher is more expensive. Only its rank within
   * the position matters. The app uses FantasyCalc value; the backtest uses ADP at the time.
   * Null means the market doesn't price him at all.
   */
  market: number | null;
}

export interface Signal {
  key: SignalKey;
  /** 0-1. */
  score: number;
  reason: string | null;
}

export interface BreakoutResult {
  player: PlayerInfo;
  /** 0-100. */
  score: number;
  signals: Signal[];
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const pct = (n: number) => `${Math.round(n * 100)}%`;

function usageTrend({ usage }: BreakoutInput): Signal {
  if (!usage?.earlier) return { key: "usageTrend", score: 0, reason: null };
  const { recent, earlier } = usage;
  const oppGain = recent.opportunityShare - earlier.opportunityShare;
  const snapGain = recent.snapShare - earlier.snapShare;
  const score = clamp01(0.6 * (oppGain / FULL_OPPORTUNITY_GAIN) + 0.4 * (snapGain / FULL_SNAP_GAIN));
  const reason =
    score > 0.3
      ? `Snap share ${pct(earlier.snapShare)} → ${pct(recent.snapShare)}, opportunity share ${pct(earlier.opportunityShare)} → ${pct(recent.opportunityShare)} over the last ${recent.games} games`
      : null;
  return { key: "usageTrend", score, reason };
}

function usageLevel({ player, usage }: BreakoutInput): Signal {
  if (!usage) return { key: "usageLevel", score: 0, reason: null };
  // Smooth curve rather than a cap, so heavy workloads still separate from each other:
  // a full workload scores about 0.86.
  const score = 1 - Math.exp((-2 * usage.recent.opportunityShare) / FULL_OPPORTUNITY[player.position]);
  const reason = score > 0.6 ? `Already a ${pct(usage.recent.opportunityShare)} opportunity share` : null;
  return { key: "usageLevel", score, reason };
}

function youth({ player }: BreakoutInput): Signal {
  // Rough fallback: most players enter the league around 22.
  const age = player.age ?? (player.yearsExp != null ? 22 + player.yearsExp : null);
  if (age == null) return { key: "youth", score: 0, reason: null };
  const [peak, done] = AGE_WINDOW[player.position];
  const score = age <= peak ? 1 : clamp01((done - age) / (done - peak));
  return { key: "youth", score, reason: score === 1 ? `Age ${age}` : null };
}

function draftCapital({ draft }: BreakoutInput): Signal {
  if (!draft) return { key: "draftCapital", score: UNKNOWN_DRAFT_SCORE, reason: null };
  const score = DRAFT_ROUND_SCORE[draft.round - 1] ?? LATE_ROUND_SCORE;
  const reason = draft.round <= 2 ? `${draft.season} round ${draft.round}, pick ${draft.pick}` : null;
  return { key: "draftCapital", score, reason };
}

/** Rank of `n` within `sorted` (ascending) as 0-1. */
function percentile(sorted: number[], n: number): number {
  if (sorted.length <= 1) return 0;
  let i = 0;
  while (i < sorted.length && sorted[i]! < n) i++;
  return i / (sorted.length - 1);
}

/** Weighted average of signal scores, 0-100. */
export function combine(signals: Signal[], weights: Weights): number {
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const weighted = signals.reduce((sum, s) => sum + s.score * weights[s.key], 0);
  return totalWeight > 0 ? (100 * weighted) / totalWeight : 0;
}

/**
 * Computes every player's signals. Market lag is relative: it compares a player's usage
 * percentile with his market-price percentile among the inputs at the same position.
 */
export function computeSignals(inputs: BreakoutInput[]): Signal[][] {
  const usageByPos = new Map<Position, number[]>();
  const marketByPos = new Map<Position, number[]>();
  for (const { player, usage, market } of inputs) {
    if (!usageByPos.has(player.position)) {
      usageByPos.set(player.position, []);
      marketByPos.set(player.position, []);
    }
    usageByPos.get(player.position)!.push(usage?.recent.opportunityShare ?? 0);
    marketByPos.get(player.position)!.push(market ?? 0);
  }
  for (const list of [...usageByPos.values(), ...marketByPos.values()]) list.sort((a, b) => a - b);

  return inputs.map((input) => {
    const pos = input.player.position;
    const usagePct = percentile(usageByPos.get(pos)!, input.usage?.recent.opportunityShare ?? 0);
    const marketPct = percentile(marketByPos.get(pos)!, input.market ?? 0);
    const lag = clamp01(usagePct - marketPct);
    const marketLag: Signal = {
      key: "marketLag",
      score: lag,
      reason:
        lag > 0.25
          ? `Usage ranks above ${pct(usagePct)} of ${pos}s, market price only above ${pct(marketPct)}`
          : null,
    };
    return [usageTrend(input), usageLevel(input), youth(input), draftCapital(input), marketLag];
  });
}

/** Scores every player and sorts them best first. */
export function rankBreakouts(inputs: BreakoutInput[], weights: Weights = DEFAULT_WEIGHTS): BreakoutResult[] {
  const signals = computeSignals(inputs);
  return inputs
    .map((input, i) => ({
      player: input.player,
      score: Math.round(combine(signals[i]!, weights)),
      signals: signals[i]!,
    }))
    .sort((a, b) => b.score - a.score);
}
