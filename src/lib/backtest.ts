import { ENABLED_POSITIONS } from "../../shared/positions.ts";
import type { DraftMap, PlayerInfo, PlayersMap, WeekData, WeeklyLine } from "../../shared/types.ts";
import { combine, computeSignals, withinAgeCap, type BreakoutInput, type Signal, type SignalKey, type Weights } from "./breakout.ts";
import { currentlyOut, openingFor, roleHolders, type Opening, type RoleHolder } from "./opening.ts";
import { gradedCredit, isCheap, isImpact, isStarter, production, type Production } from "./production.ts";
import { buildUsage, usageOrLastSeason } from "./usage.ts";

/**
 * One historical test: score players as of a cutoff, then check who became a starter
 * (see STARTER_RANK) in the outcome window.
 */
export interface Fold {
  label: string;
  /**
   * in-season: scored mid-season, outcome is the rest of the season.
   * next-season: scored in the offseason after the draft, outcome is the next season.
   */
  kind: "in-season" | "next-season";
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

export interface Sample {
  player: PlayerInfo;
  input: BreakoutInput;
  /** He hadn't played in the feature window, so `input.usage` is from the season before. */
  usageFromLastSeason: boolean;
  signals: Signal[];
  /** Teammates ahead of him who were gone at the cutoff. Not scored; see opening.ts. */
  opening: Opening;
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

type Spot = Pick<WeeklyLine, "position" | "team">;

/** The player as he was at the cutoff: his team and position then, and his age then. */
function playerAtCutoff(base: PlayerInfo | undefined, id: string, spot: Spot, fold: Fold): PlayerInfo {
  const season = Number(fold.cutoffDate.slice(0, 4));
  return {
    ...(base ?? {
      id,
      name: id,
      birthDate: null,
      rookieYear: null,
      depthChartPosition: null,
      depthChartOrder: null,
      injuryStatus: null,
      injuryBodyPart: null,
      status: null,
      gsisId: null,
      espnId: null,
      college: null,
      searchRank: null,
    }),
    position: spot.position,
    team: spot.team,
    age: ageOn(base?.birthDate ?? null, fold.cutoffDate),
    yearsExp: base?.rookieYear != null ? Math.max(0, season - base.rookieYear) : null,
  };
}

/** Each player's team in his first game of a window. */
function firstTeams(weeks: WeekData[]): Map<string, string> {
  const first = new Map<string, string>();
  for (const week of [...weeks].sort((a, b) => a.week - b.week)) {
    for (const l of week.lines) if (!first.has(l.playerId)) first.set(l.playerId, l.team);
  }
  return first;
}

export interface SampleOptions {
  /** Keep players over the dynasty age cap. The breakout history shows them; tuning doesn't. */
  ignoreAgeCap?: boolean;
}

/**
 * Builds the scored population for one fold: every RB/WR/TE who played in the feature
 * window or the prior season and wasn't already a starter in either, within the age cap.
 * Next-season folds also score the incoming rookie class, which is drafted by the cutoff.
 *
 * Players who missed the feature window are scored on the prior season's usage, as on the
 * board. Some will have left the league, which the board would leave out because they have
 * no team; there's no dated roster history to do the same here.
 *
 * In next-season folds a player's team is his team in his first game of the next season,
 * standing in for the roster at the cutoff (August 1); there's no dated roster history.
 */
export function buildSamples(
  fold: Fold,
  players: PlayersMap,
  draft: DraftMap,
  { ignoreAgeCap = false }: SampleOptions = {},
): Sample[] {
  const cutoffYear = Number(fold.cutoffDate.slice(0, 4));
  const prior = production(fold.priorWeeks, MIN_PRIOR_GAMES);
  const before = production(fold.featureWeeks, fold.minFeatureGames);
  const after = production(fold.outcomeWeeks, fold.minOutcomeGames);
  const usage = buildUsage(fold.featureWeeks);
  const priorUsage = buildUsage(fold.priorWeeks);
  const holders = roleHolders(usage);

  // Who counts as gone: hurt right now in-season, or on a new team after the offseason.
  const nextTeam = fold.kind === "next-season" ? firstTeams(fold.outcomeWeeks) : new Map<string, string>();
  const out = fold.kind === "in-season" ? currentlyOut(fold.featureWeeks) : new Set<string>();
  const gone = (h: RoleHolder) =>
    fold.kind === "in-season"
      ? out.has(`${h.playerId}|${h.team}`)
      : nextTeam.has(h.playerId) && nextTeam.get(h.playerId) !== h.team;

  const lastLine = new Map<string, WeeklyLine>();
  for (const week of [...fold.featureWeeks].sort((a, b) => a.season - b.season || a.week - b.week)) {
    for (const line of week.lines) lastLine.set(line.playerId, line);
  }
  const candidates: { id: string; spot: Spot }[] = [];
  for (const [id, line] of lastLine) {
    candidates.push({ id, spot: { position: line.position, team: nextTeam.get(id) ?? line.team } });
  }
  const lastPriorLine = new Map<string, WeeklyLine>();
  for (const week of [...fold.priorWeeks].sort((a, b) => a.week - b.week)) {
    for (const line of week.lines) lastPriorLine.set(line.playerId, line);
  }
  for (const [id, line] of lastPriorLine) {
    if (lastLine.has(id)) continue;
    candidates.push({ id, spot: { position: line.position, team: nextTeam.get(id) ?? line.team } });
  }
  if (fold.kind === "next-season") {
    for (const [id, pick] of Object.entries(draft)) {
      const position = players[id]?.position;
      if (pick.season !== cutoffYear || !position || lastLine.has(id) || lastPriorLine.has(id)) continue;
      candidates.push({ id, spot: { position, team: pick.team } });
    }
  }

  const samples: Sample[] = [];
  for (const { id, spot } of candidates) {
    if (!ENABLED_POSITIONS.includes(spot.position)) continue;
    if (isStarter(before.get(id)) || isStarter(prior.get(id))) continue;
    const player = playerAtCutoff(players[id], id, spot, fold);
    if (!ignoreAgeCap && !withinAgeCap(player)) continue;
    const { usage: averages, fromLastSeason } = usageOrLastSeason(id, usage, priorUsage);
    // Draft picks made after the cutoff can't be known at the cutoff.
    const pick = draft[id];
    const share = fromLastSeason ? 0 : (averages?.opportunityShare ?? 0);
    const input: BreakoutInput = {
      player,
      usage: averages,
      draft: pick && pick.season <= cutoffYear ? pick : null,
    };
    const outcome = after.get(id) ?? null;
    const adp = fold.adp[id] ?? null;
    samples.push({
      player,
      input,
      usageFromLastSeason: fromLastSeason,
      signals: computeSignals(input),
      opening: openingFor({ id, team: player.team, position: player.position, share }, holders, gone),
      adp,
      cheap: isCheap(player.position, adp),
      brokeOut: isStarter(outcome ?? undefined),
      outcome,
    });
  }
  return samples;
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

export interface TopResult {
  /** Average PPG above replacement across the top players; see gradedCredit. */
  credit: number;
  /** How many of them reached Impact; see isImpact. */
  impact: number;
}

/** How the top `k` by `score` finished. Uses every result, not just who crossed a line. */
export function topResult(samples: Sample[], score: (s: Sample) => number, k = 20): TopResult {
  const top = [...samples].sort((a, b) => score(b) - score(a)).slice(0, k);
  return {
    credit: top.reduce((sum, s) => sum + gradedCredit(s.outcome ?? undefined), 0) / top.length,
    impact: top.filter((s) => isImpact(s.outcome ?? undefined)).length,
  };
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
