import type { Position } from "../../shared/positions.ts";
import type { CollegeSeason, DraftInfo, PlayerInfo } from "../../shared/types.ts";
import type { UsageAverages } from "./usage.ts";

export type SignalKey = "usageLevel" | "youth" | "draftCapital" | "college";

export type Weights = Record<SignalKey, number>;

/**
 * Backtested weights (npm run backtest): mean held-out AUC about 0.91 in both the in-season
 * and next-season tests, against 0.70 and 0.78 for ADP. College adds little in the backtest
 * but is backed by the 2020-23 draft classes for RBs and TEs; see collegeProduction().
 *
 * Tried and left out: rising usage (recent vs earlier games, snap-share jumps, slopes) and
 * usage rank above market-price rank both scored near chance. Opportunity opened by an
 * injured or departed teammate scored below chance, so it's shown on the board but not
 * scored; see opening.ts.
 */
export const DEFAULT_WEIGHTS: Weights = {
  usageLevel: 0.5,
  youth: 0.1,
  draftCapital: 0.3,
  college: 0.1,
};

/**
 * What a score meant in the backtest, among cheap players (2021-2025, both test modes).
 * About 2% of cheap players broke out overall; none who scored under 40 did.
 */
export const SCORE_TIERS = [
  { min: 75, label: "Strong", odds: "about 1 in 5 broke out" },
  { min: 60, label: "Watch", odds: "about 1 in 14 broke out" },
  { min: 40, label: "Long shot", odds: "about 1 in 60 broke out" },
  { min: 0, label: "Unlikely", odds: "none broke out" },
] as const;

export type ScoreTier = (typeof SCORE_TIERS)[number];

export function scoreTier(score: number): ScoreTier {
  return SCORE_TIERS.find((t) => score >= t.min)!;
}

/**
 * Tiers for rookies who haven't played. SCORE_TIERS' odds don't fit them: they rarely break
 * out in year one, but high scorers often do later. Backtest, cheap rookies: year one from the
 * 2022-25 classes (6 of 74 at 60+, 3 of 177 under), within three years from the 2022-23
 * classes (18 of 44, 6 of 82). Above 60, Strong and Watch rookies did about the same.
 */
export const ROOKIE_TIERS = [
  { min: 60, label: "Rookie prospect", odds: "about 1 in 12 broke out in year one, about 4 in 10 within three years" },
  { min: 0, label: "Rookie long shot", odds: "about 1 in 60 broke out in year one, about 1 in 14 within three years" },
] as const;

export type RookieTier = (typeof ROOKIE_TIERS)[number];
export type BoardTier = ScoreTier | RookieTier;

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

/** Age where breakout odds start to fall, and age where they are treated as zero. */
const AGE_WINDOW: Record<Position, [peak: number, done: number]> = {
  QB: [26, 31],
  RB: [24, 27],
  WR: [24, 28],
  TE: [25, 29],
};

/**
 * Draft score falls off smoothly with pick number: 1st overall 1.0, pick 32 0.77, pick 100
 * 0.43. Exact pick separated players better than round buckets.
 */
const DRAFT_PICK_SCALE = 120;
const UNDRAFTED_SCORE = 0.05;

/** College seasons shorter than this are ignored (injuries, redshirt years). */
const MIN_COLLEGE_GAMES = 5;
/** College shares that count as a full role: RB share of team receiving yards, TE target share. */
const FULL_COLLEGE_SHARE = { RB: 0.1, TE: 0.18 };
/** WR college breakout: first season with this share of his team's receiving yards. */
const WR_BREAKOUT_SHARE = 0.2;
/** WR breakout age that scores 1, and the age that scores 0. */
const WR_BREAKOUT_AGES: [young: number, old: number] = [19, 22];

export interface BreakoutInput {
  player: PlayerInfo;
  /** Average usage over the games played so far. */
  usage: UsageAverages | null;
  draft: DraftInfo | null;
  /** College seasons before his rookie year, oldest first. Empty if unknown. */
  college: CollegeSeason[];
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
  college: CollegeStat | null;
  /** 0-100. */
  score: number;
  signals: Signal[];
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
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

function youth({ player }: BreakoutInput): Signal {
  // Rough fallback: most players enter the league around 22.
  const age = player.age ?? (player.yearsExp != null ? 22 + player.yearsExp : null);
  if (age == null) return { key: "youth", score: 0, reason: null };
  const [peak, done] = AGE_WINDOW[player.position];
  const score = age <= peak ? 1 : clamp01((done - age) / (done - peak));
  return { key: "youth", score, reason: score === 1 ? `Age ${age}` : null };
}

function draftCapital({ draft }: BreakoutInput): Signal {
  if (!draft) return { key: "draftCapital", score: UNDRAFTED_SCORE, reason: null };
  const score = Math.exp(-draft.pick / DRAFT_PICK_SCALE);
  const reason = draft.round <= 2 ? `${draft.season} round ${draft.round}, pick ${draft.pick}` : null;
  return { key: "draftCapital", score, reason };
}

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

function collegeProduction({ player, college }: BreakoutInput): Signal {
  const stat = collegeStat(player, college);
  // Unknown (FCS, pre-2012, unmatched) is left out rather than scored as no production.
  if (!stat) return { key: "college", score: 0, reason: null, missing: true };
  let score: number;
  switch (stat.kind) {
    case "recYardShare":
      score = saturate(stat.share, FULL_COLLEGE_SHARE.RB);
      break;
    case "targetShare":
      score = saturate(stat.share, FULL_COLLEGE_SHARE.TE);
      break;
    case "breakoutAge": {
      const [young, old] = WR_BREAKOUT_AGES;
      score = stat.age == null ? 0 : clamp01((old - stat.age) / (old - young));
      break;
    }
  }
  return { key: "college", score, reason: score > 0.6 ? `College: ${describeCollegeStat(stat)}` : null };
}

/** Weighted average of signal scores, 0-100. Missing signals are left out, not scored as 0. */
export function combine(signals: Signal[], weights: Weights): number {
  const known = signals.filter((s) => !s.missing);
  const totalWeight = known.reduce((sum, s) => sum + weights[s.key], 0);
  const weighted = known.reduce((sum, s) => sum + s.score * weights[s.key], 0);
  return totalWeight > 0 ? (100 * weighted) / totalWeight : 0;
}

export function computeSignals(input: BreakoutInput): Signal[] {
  return [usageLevel(input), youth(input), draftCapital(input), collegeProduction(input)];
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
        college: collegeStat(input.player, input.college),
        score: Math.round(combine(signals, weights)),
        signals,
      };
    })
    .sort((a, b) => b.score - a.score);
}
