import { ENABLED_POSITIONS } from "../../shared/positions.ts";
import type { DraftMap, PlayerInfo, PlayersMap, WeekData, WeeklyLine } from "../../shared/types.ts";
import { combine, computeSignals, type BreakoutInput, type Signal, type SignalKey, type Weights } from "./breakout.ts";
import { isStarter, production, STARTER_RANK, type Production } from "./production.ts";
import { buildUsage, summarizeUsage } from "./usage.ts";

/**
 * One historical test: score players as of a cutoff, then check who became a starter
 * (see STARTER_RANK) in the outcome window.
 */
export interface Fold {
  label: string;
  /** The full season before the feature window. Starters there are already established. */
  priorWeeks: WeekData[];
  /** Weeks available at the cutoff. */
  featureWeeks: WeekData[];
  /** Weeks used to decide who broke out. */
  outcomeWeeks: WeekData[];
  /** Date the scores are taken, for age. ISO date. */
  cutoffDate: string;
  /** Positional ADP at the cutoff by player id (1 = first at his position). */
  adp: Record<string, number>;
  /** Games needed in the feature window to count as an established starter. */
  minFeatureGames: number;
  /** Games needed in the outcome window to count as a breakout. */
  minOutcomeGames: number;
}

/** Games needed in the prior season to count as an established starter. */
const MIN_PRIOR_GAMES = 8;

/**
 * Players the market isn't pricing as starters: positional ADP beyond 1.5× starter rank
 * (RB/WR 36, TE 18), or no ADP. These are the breakouts the app is meant to find.
 */
const CHEAP_ADP_FACTOR = 1.5;

export interface Sample {
  player: PlayerInfo;
  signals: Signal[];
  /** Positional ADP at the cutoff, or null if unranked. */
  adp: number | null;
  cheap: boolean;
  /** True if the player became a starter in the outcome window. */
  brokeOut: boolean;
  outcome: Production | null;
}

function ageOn(birthDate: string | null, date: string): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const on = new Date(date);
  let age = on.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    on.getUTCMonth() < birth.getUTCMonth() ||
    (on.getUTCMonth() === birth.getUTCMonth() && on.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** The player as he was at the cutoff: that week's team and position, and his age then. */
function playerAtCutoff(base: PlayerInfo | undefined, line: WeeklyLine, fold: Fold): PlayerInfo {
  const season = Number(fold.cutoffDate.slice(0, 4));
  return {
    ...(base ?? {
      id: line.playerId,
      name: line.playerId,
      birthDate: null,
      rookieYear: null,
      depthChartPosition: null,
      depthChartOrder: null,
      injuryStatus: null,
      injuryBodyPart: null,
      status: null,
      gsisId: null,
      searchRank: null,
    }),
    position: line.position,
    team: line.team,
    age: ageOn(base?.birthDate ?? null, fold.cutoffDate),
    yearsExp: base?.rookieYear != null ? Math.max(0, season - base.rookieYear) : null,
  };
}

/** Turns positional ADP into a market price where higher is more expensive. */
const priceFromAdp = (adp: number | undefined) => (adp == null ? null : 1000 - adp);

/**
 * Builds the scored population for one fold: every RB/WR/TE who played in the feature
 * window and wasn't already a starter there or in the prior season.
 */
export function buildSamples(fold: Fold, players: PlayersMap, draft: DraftMap): Sample[] {
  const prior = production(fold.priorWeeks, MIN_PRIOR_GAMES);
  const before = production(fold.featureWeeks, fold.minFeatureGames);
  const after = production(fold.outcomeWeeks, fold.minOutcomeGames);
  const usage = buildUsage(fold.featureWeeks);

  const lastLine = new Map<string, WeeklyLine>();
  for (const week of [...fold.featureWeeks].sort((a, b) => a.season - b.season || a.week - b.week)) {
    for (const line of week.lines) lastLine.set(line.playerId, line);
  }

  const inputs: BreakoutInput[] = [];
  for (const [id, line] of lastLine) {
    if (!ENABLED_POSITIONS.includes(line.position)) continue;
    if (isStarter(before.get(id)) || isStarter(prior.get(id))) continue;
    // Draft picks made after the cutoff can't be known at the cutoff.
    const pick = draft[id];
    inputs.push({
      player: playerAtCutoff(players[id], line, fold),
      usage: summarizeUsage(usage.get(id) ?? []),
      draft: pick && pick.season <= Number(fold.cutoffDate.slice(0, 4)) ? pick : null,
      market: priceFromAdp(fold.adp[id]),
    });
  }

  const signals = computeSignals(inputs);
  return inputs.map((input, i) => {
    const { player } = input;
    const outcome = after.get(player.id) ?? null;
    const adp = fold.adp[player.id] ?? null;
    return {
      player,
      signals: signals[i]!,
      adp,
      cheap: adp == null || adp > CHEAP_ADP_FACTOR * STARTER_RANK[player.position],
      brokeOut: isStarter(outcome ?? undefined),
      outcome,
    };
  });
}

/**
 * Area under the ROC curve: the chance a random breakout scores above a random
 * non-breakout. 0.5 is a coin flip, 1.0 is perfect. Ties count half.
 */
export function auc(scores: number[], labels: boolean[]): number {
  const order = scores.map((s, i) => [s, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(scores.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]![1]] = avgRank;
    i = j + 1;
  }
  const positives = labels.filter(Boolean).length;
  const negatives = labels.length - positives;
  if (positives === 0 || negatives === 0) return NaN;
  const rankSum = labels.reduce((sum, l, i) => (l ? sum + ranks[i]! : sum), 0);
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

/** Share of the top `k` scores that broke out. */
export function precisionAtK(scores: number[], labels: boolean[], k: number): number {
  const top = scores
    .map((s, i) => [s, labels[i]!] as const)
    .sort((a, b) => b[0] - a[0])
    .slice(0, k);
  return top.filter(([, l]) => l).length / top.length;
}

export interface Evaluation {
  samples: number;
  breakouts: number;
  auc: number;
  precisionAt20: number;
}

export function evaluateScores(scores: number[], labels: boolean[]): Evaluation {
  return {
    samples: labels.length,
    breakouts: labels.filter(Boolean).length,
    auc: auc(scores, labels),
    precisionAt20: precisionAtK(scores, labels, 20),
  };
}

export function evaluate(samples: Sample[], weights: Weights): Evaluation {
  return evaluateScores(
    samples.map((s) => combine(s.signals, weights)),
    samples.map((s) => s.brokeOut),
  );
}

/** AUC of each signal used alone. */
export function signalAucs(samples: Sample[]): Record<SignalKey, number> {
  const labels = samples.map((s) => s.brokeOut);
  const keys = samples[0]?.signals.map((s) => s.key) ?? [];
  return Object.fromEntries(
    keys.map((key) => [key, auc(samples.map((s) => s.signals.find((x) => x.key === key)!.score), labels)]),
  ) as Record<SignalKey, number>;
}

/** Every weighting whose weights are multiples of `step` and sum to 1. */
export function weightGrid(keys: SignalKey[], step = 0.1): Weights[] {
  const units = Math.round(1 / step);
  const out: Weights[] = [];
  const walk = (i: number, left: number, acc: number[]) => {
    if (i === keys.length - 1) {
      out.push(Object.fromEntries(keys.map((k, j) => [k, ((j === i ? left : acc[j]!) * step)])) as Weights);
      return;
    }
    for (let u = 0; u <= left; u++) walk(i + 1, left - u, [...acc, u]);
  };
  walk(0, units, []);
  return out;
}

/** The grid weighting with the best mean AUC across the given folds. */
export function tuneWeights(folds: Sample[][], grid: Weights[]): { weights: Weights; meanAuc: number } {
  let best = { weights: grid[0]!, meanAuc: -Infinity };
  for (const weights of grid) {
    const meanAuc = folds.reduce((sum, f) => sum + evaluate(f, weights).auc, 0) / folds.length;
    if (meanAuc > best.meanAuc) best = { weights, meanAuc };
  }
  return best;
}
