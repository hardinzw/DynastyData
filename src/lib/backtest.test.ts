import { describe, expect, it } from "vitest";
import type { WeekData, WeeklyLine } from "../../shared/types.ts";
import { auc, precisionAtK, weightGrid } from "./backtest.ts";
import { isCheap, isStarter, production } from "./production.ts";

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

describe("weightGrid", () => {
  it("lists every weighting that sums to 1", () => {
    const grid = weightGrid(["usageTrend", "usageLevel", "youth", "draftCapital", "marketLag"], 0.5);
    // 5 weights in steps of 0.5 summing to 1: C(6, 4) = 15.
    expect(grid).toHaveLength(15);
    for (const w of grid) expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
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
