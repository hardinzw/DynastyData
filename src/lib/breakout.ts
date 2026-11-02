import type { Position } from "../../shared/positions.ts";
import type { DraftInfo, PlayerInfo } from "../../shared/types.ts";
import type { UsageAverages } from "./usage.ts";

export type SignalKey = "usageLevel" | "draftCapital";

export type Weights = Record<SignalKey, number>;

/**
 * Backtested weights (npm run backtest): mean AUC about 0.90 in both the in-season and
 * next-season tests, against 0.70 and 0.78 for ADP.
 *
 * Tried and left out: rising usage (recent vs earlier games, snap-share jumps, slopes) and
 * usage rank above market-price rank both scored near chance. Opportunity opened by an
 * injured or departed teammate scored below chance, so it's shown on the board but not
 * scored; see opening.ts. Youth and college barely moved AUC or the top 20, so they're out.
 */
export const DEFAULT_WEIGHTS: Weights = {
  usageLevel: 0.6,
  draftCapital: 0.4,
};

/**
 * What a score meant in the backtest for players with NFL games, among cheap players
 * (2021-2025, both test modes). About 2% of cheap players broke out overall.
 */
export const SCORE_TIERS = [
  { min: 75, label: "Strong", odds: "about 3 in 10 broke out" },
  { min: 60, label: "Watch", odds: "about 1 in 10 broke out" },
  { min: 40, label: "Long shot", odds: "about 1 in 50 broke out" },
  { min: 0, label: "Unlikely", odds: "about 1 in 350 broke out" },
] as const;

export type ScoreTier = (typeof SCORE_TIERS)[number];

export function scoreTier(score: number): ScoreTier {
  return SCORE_TIERS.find((t) => score >= t.min)!;
}

/**
 * Tiers for rookies who haven't played, whose score is their draft pick alone. SCORE_TIERS'
 * odds don't fit them: they rarely break out in year one, but high scorers often do later.
 * Backtest, cheap rookies: year one from the 2022-25 classes (6 of 72 at 50+, 3 of 179 under),
 * within three years from the 2022-23 classes (15 of 40, 9 of 86).
 */
export const ROOKIE_TIERS = [
  { min: 50, label: "Rookie prospect", odds: "about 1 in 12 broke out in year one, about 4 in 10 within three years" },
  { min: 0, label: "Rookie long shot", odds: "about 1 in 60 broke out in year one, about 1 in 10 within three years" },
] as const;

export type RookieTier = (typeof ROOKIE_TIERS)[number];

/**
 * A veteran with no games this season or last. His score is his draft pick alone, which the
 * backtest can't test, so he gets no odds and sits below everyone else.
 */
export const NO_RECENT_GAMES_TIER = { min: 0, label: "No recent games", odds: "no games this season or last, so not rated" } as const;

/**
 * A veteran with no games this season, scored on last season's usage. SCORE_TIERS' odds don't
 * fit him: none of the 531 cheap players like this in the backtest broke out, though few scored
 * high and some had left the league.
 */
export const MISSED_SEASON_TIER = { min: 0, label: "Missed season", odds: "none of 531 broke out" } as const;

export type BoardTier = ScoreTier | RookieTier | typeof NO_RECENT_GAMES_TIER | typeof MISSED_SEASON_TIER;

export function rookieTier(score: number): RookieTier {
  return ROOKIE_TIERS.find((t) => score >= t.min)!;
}

/** A rookie with no games in the season being scored, including one drafted after it. */
export function isUnplayedRookie(
  player: PlayerInfo,
  draft: DraftInfo | null,
  usage: UsageAverages | null,
  scoredSeason: number,
): boolean {
  if (usage) return false;
  const firstSeason = draft?.season ?? player.rookieYear;
  return firstSeason != null && firstSeason >= scoredSeason;
}

/**
 * Oldest age that still counts as a dynasty breakout. Older players are left off the board
 * entirely rather than scored down, so the tuned weights only rank players worth buying.
 * QB is a placeholder until QB is enabled.
 */
export const MAX_BREAKOUT_AGE: Record<Position, number> = { QB: 28, RB: 25, WR: 26, TE: 27 };

/** Players with unknown age are kept; they're almost always rookies. */
export function withinAgeCap(player: PlayerInfo): boolean {
  return player.age == null || player.age <= MAX_BREAKOUT_AGE[player.position];
}

/** Opportunity share that counts as a full workload at each position. */
export const FULL_OPPORTUNITY: Record<Position, number> = { QB: 0.2, RB: 0.45, WR: 0.25, TE: 0.2 };

/**
 * Draft score falls off smoothly with pick number: 1st overall 1.0, pick 32 0.77, pick 100
 * 0.43. Exact pick separated players better than round buckets.
 */
const DRAFT_PICK_SCALE = 120;
const UNDRAFTED_SCORE = 0.05;

export interface BreakoutInput {
  player: PlayerInfo;
  /** Average usage over the games played so far. */
  usage: UsageAverages | null;
  draft: DraftInfo | null;
}

export interface Signal {
  key: SignalKey;
  /** 0-1. */
  score: number;
  reason: string | null;
  /** No data, as opposed to a bad score. Left out of the average; see combine(). */
  missing?: boolean;
}

export interface BreakoutResult {
  player: PlayerInfo;
  usage: UsageAverages | null;
  draft: DraftInfo | null;
  /** 0-100. */
  score: number;
  signals: Signal[];
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
/** Smooth curve rather than a cap, so big shares still separate: `full` scores about 0.86. */
const saturate = (share: number, full: number) => 1 - Math.exp((-2 * share) / full);

function usageLevel({ player, usage }: BreakoutInput): Signal {
  // Rookies before their first game have no usage yet, which isn't the same as no role.
  if (!usage) return { key: "usageLevel", score: 0, reason: null, missing: true };
  const score = saturate(usage.opportunityShare, FULL_OPPORTUNITY[player.position]);
  const reason =
    score > 0.6 ? `${pct(usage.opportunityShare)} opportunity share over ${usage.games} games` : null;
  return { key: "usageLevel", score, reason };
}

function draftCapital({ draft }: BreakoutInput): Signal {
  if (!draft) return { key: "draftCapital", score: UNDRAFTED_SCORE, reason: null };
  const score = Math.exp(-draft.pick / DRAFT_PICK_SCALE);
  const reason = draft.round <= 2 ? `${draft.season} round ${draft.round}, pick ${draft.pick}` : null;
  return { key: "draftCapital", score, reason };
}

/** Weighted average of signal scores, 0-100. Missing signals are left out, not scored as 0. */
export function combine(signals: Signal[], weights: Weights): number {
  const known = signals.filter((s) => !s.missing);
  const totalWeight = known.reduce((sum, s) => sum + weights[s.key], 0);
  const weighted = known.reduce((sum, s) => sum + s.score * weights[s.key], 0);
  return totalWeight > 0 ? (100 * weighted) / totalWeight : 0;
}

export function computeSignals(input: BreakoutInput): Signal[] {
  return [usageLevel(input), draftCapital(input)];
}

/** Scores every player and sorts them best first. */
export function rankBreakouts(inputs: BreakoutInput[], weights: Weights = DEFAULT_WEIGHTS): BreakoutResult[] {
  return inputs
    .map((input) => {
      const signals = computeSignals(input);
      return {
        player: input.player,
        usage: input.usage,
        draft: input.draft,
        score: Math.round(combine(signals, weights)),
        signals,
      };
    })
    .sort((a, b) => b.score - a.score);
}
