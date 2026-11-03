import { describe, expect, it } from "vitest";
import type { WeekData, WeeklyLine } from "../../shared/types.ts";
import {
  auc,
  buildSamples,
  longTermOutcome,
  precisionAtK,
  topLongTerm,
  topResult,
  weightGrid,
  withLongTerm,
  type Fold,
  type Sample,
} from "./backtest.ts";
import { gradedCredit, isCheap, isImpact, isStarter, production, type Production } from "./production.ts";

describe("auc", () => {
  it("is 1 when every positive outscores every negative", () => {
    expect(auc([0.9, 0.8, 0.2, 0.1], [true, true, false, false])).toBe(1);
  });

  it("is 0.5 when scores are all tied", () => {
    expect(auc([1, 1, 1, 1], [true, false, true, false])).toBe(0.5);
  });

  it("counts pairs correctly with a mix", () => {
    // Positives at 0.8 and 0.3; negatives at 0.5 and 0.1. 3 of 4 pairs ordered correctly.
    expect(auc([0.8, 0.5, 0.3, 0.1], [true, false, true, false])).toBe(0.75);
  });

  it("is NaN with no positives", () => {
    expect(auc([1, 2], [false, false])).toBeNaN();
  });
});

describe("precisionAtK", () => {
  it("is the share of the top k that are positive", () => {
    expect(precisionAtK([5, 4, 3, 2, 1], [true, false, true, false, false], 2)).toBe(0.5);
  });
});

describe("long-term outcomes", () => {
  const finish = (ppg: number, posRank: number | null): Production => ({ position: "WR", games: 10, ppg, posRank });
  const seasons = [
    new Map([["a", finish(12, 40)], ["b", finish(9, 60)]]),
    new Map([["a", finish(16, 10)], ["b", finish(30, null)]]),
  ];
  const sample = (id: string) => ({ player: { id }, brokeOut: false }) as Sample;

  it("adds credit across seasons and counts a rung reached in any of them", () => {
    // WR replacement is 11: 1 point in the first season, 5 in the second.
    expect(longTermOutcome("a", seasons)).toEqual({ credit: 6, starter: true, impact: true });
  });

  it("gives nothing for a season he was too hurt to rank in, or a player who never appears", () => {
    expect(longTermOutcome("b", seasons)).toEqual({ credit: 0, starter: false, impact: false });
    expect(longTermOutcome("gone", seasons)).toEqual({ credit: 0, starter: false, impact: false });
  });

  it("judges a sample on the whole window", () => {
    const [a, b] = withLongTerm([sample("a"), sample("b")], seasons);
    expect(a!.brokeOut).toBe(true);
    expect(b!.brokeOut).toBe(false);
  });

  it("reports how the top players finished", () => {
    const samples = withLongTerm([sample("a"), sample("b")], seasons);
    expect(topLongTerm(samples, (s) => (s.player.id === "a" ? 1 : 0), 1)).toEqual({ credit: 6, starters: 1, impact: 1 });
    expect(topLongTerm(samples, () => 0)).toEqual({ credit: 3, starters: 1, impact: 1 });
  });
});

describe("weightGrid", () => {
  it("lists every weighting that sums to 1", () => {
    const grid = weightGrid(["usageLevel", "draftCapital"], 0.5);
    // 2 weights in steps of 0.5 summing to 1: 0/1, 0.5/0.5, 1/0.
    expect(grid).toHaveLength(3);
    for (const w of grid) expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

describe("buildSamples", () => {
  const line = (playerId: string): WeeklyLine => ({
    playerId,
    position: "WR",
    team: "KC",
    opponent: null,
    stats: { pts_ppr: 1, off_snp: 10, rec_tgt: 2 },
  });
  const week = (season: number, lines: WeeklyLine[]): WeekData => ({ season, week: 1, final: true, lines });

  it("scores a player who missed the window on the season before it", () => {
    const fold: Fold = {
      label: "test",
      kind: "in-season",
      priorWeeks: [week(2024, [line("hurt"), line("x")])],
      featureWeeks: [week(2025, [line("x")])],
      outcomeWeeks: [week(2025, [line("x")])],
      cutoffDate: "2025-11-01",
      adp: {},
      minFeatureGames: 4,
      minOutcomeGames: 5,
    };
    const samples = buildSamples(fold, {}, {});
    const hurt = samples.find((s) => s.player.id === "hurt")!;
    expect(hurt.usageFromLastSeason).toBe(true);
    expect(hurt.input.usage!.games).toBe(1);
    expect(samples.find((s) => s.player.id === "x")!.usageFromLastSeason).toBe(false);
  });
});

describe("gradedCredit", () => {
  const finish = (position: Production["position"], ppg: number, posRank: number | null = 30): Production => ({
    position,
    games: 10,
    ppg,
    posRank,
  });

  it("is PPG above each position's replacement level", () => {
    expect(gradedCredit(finish("RB", 12))).toBe(2);
    expect(gradedCredit(finish("WR", 12))).toBe(1);
    expect(gradedCredit(finish("TE", 12))).toBe(4);
  });

  it("is 0 below replacement, with too few games, or without a result", () => {
    expect(gradedCredit(finish("WR", 7))).toBe(0);
    expect(gradedCredit(finish("WR", 18, null))).toBe(0);
    expect(gradedCredit(undefined)).toBe(0);
  });
});

describe("isImpact", () => {
  const finish = (position: Production["position"], ppg: number, posRank: number | null = 10): Production => ({
    position,
    games: 10,
    ppg,
    posRank,
  });

  it("uses 15 PPG for RB and WR, and 11 for TE", () => {
    expect(isImpact(finish("RB", 15))).toBe(true);
    expect(isImpact(finish("WR", 14.9))).toBe(false);
    expect(isImpact(finish("TE", 11))).toBe(true);
    expect(isImpact(finish("TE", 10.9))).toBe(false);
  });

  it("needs enough games to be ranked", () => {
    expect(isImpact(finish("WR", 20, null))).toBe(false);
    expect(isImpact(undefined)).toBe(false);
  });
});

describe("topResult", () => {
  const sample = (score: number, ppg: number) =>
    ({ score, outcome: { position: "WR", games: 10, ppg, posRank: 10 } }) as unknown as Sample;
  const score = (s: Sample) => (s as unknown as { score: number }).score;

  it("averages credit and counts Impact among the top k only", () => {
    const samples = [sample(1, 30), sample(3, 16), sample(2, 11)];
    // Top 2 are 16 PPG (5 credit, Impact) and 11 PPG (0 credit). The 30 PPG player ranks last.
    expect(topResult(samples, score, 2)).toEqual({ credit: 2.5, impact: 1 });
  });
});

describe("production", () => {
  const line = (playerId: string, position: WeeklyLine["position"], pts: number): WeeklyLine => ({
    playerId,
    position,
    team: "KC",
    opponent: null,
    stats: { pts_ppr: pts },
  });
  const week = (n: number, lines: WeeklyLine[]): WeekData => ({ season: 2025, week: n, final: true, lines });

  it("ranks PPG within position and skips players with too few games", () => {
    const weeks = [
      week(1, [line("a", "WR", 20), line("b", "WR", 10), line("c", "WR", 30), line("t", "TE", 5)]),
      week(2, [line("a", "WR", 20), line("b", "WR", 12), line("t", "TE", 5)]),
    ];
    const p = production(weeks, 2);
    expect(p.get("a")).toMatchObject({ games: 2, ppg: 20, posRank: 1 });
    expect(p.get("b")!.posRank).toBe(2);
    expect(p.get("c")!.posRank).toBeNull();
    expect(p.get("t")!.posRank).toBe(1);
    expect(isStarter(p.get("t"))).toBe(true);
    expect(isStarter(p.get("c"))).toBe(false);
  });
});

describe("isCheap", () => {
  it("is past 1.5x starter rank, or unranked", () => {
    expect(isCheap("WR", 36)).toBe(false);
    expect(isCheap("WR", 37)).toBe(true);
    expect(isCheap("TE", 18)).toBe(false);
    expect(isCheap("TE", 19)).toBe(true);
    expect(isCheap("RB", null)).toBe(true);
  });
});
