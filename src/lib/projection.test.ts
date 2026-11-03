import { describe, expect, it } from "vitest";
import { leastSquares, quantile } from "./fit.ts";
import { projectPpg, shrunkPpg } from "./projection.ts";

describe("leastSquares", () => {
  it("recovers an exact line", () => {
    const [intercept, slope] = leastSquares([[1], [2], [3]], [5, 7, 9]);
    expect(intercept).toBeCloseTo(3);
    expect(slope).toBeCloseTo(2);
  });
});

describe("quantile", () => {
  it("reads a share of the way through the sorted list", () => {
    expect(quantile([3, 1, 2, 4], 0.5)).toBe(3);
    expect(quantile([3, 1, 2, 4], 1)).toBe(4);
  });
});

describe("shrunkPpg", () => {
  it("pulls small samples further toward the average", () => {
    expect(shrunkPpg(20, 1, 4)).toBeCloseTo(7.2);
    expect(shrunkPpg(20, 16, 4)).toBeCloseTo(16.8);
  });
});

describe("projectPpg", () => {
  it("projects more for better past scoring and an earlier pick", () => {
    const base = projectPpg({ position: "WR", draftScore: 0.3, past: { ppg: 8, games: 12 } })!;
    expect(projectPpg({ position: "WR", draftScore: 0.3, past: { ppg: 12, games: 12 } })!.ppg).toBeGreaterThan(base.ppg);
    expect(projectPpg({ position: "WR", draftScore: 0.8, past: { ppg: 8, games: 12 } })!.ppg).toBeGreaterThan(base.ppg);
  });

  it("uses draft pick alone for a rookie who hasn't played", () => {
    const early = projectPpg({ position: "RB", draftScore: 0.8, past: null })!;
    const late = projectPpg({ position: "RB", draftScore: 0.1, past: null })!;
    expect(early.ppg).toBeGreaterThan(late.ppg);
    expect(early.chancePlays).toBeGreaterThan(late.chancePlays);
  });

  it("puts the projection inside a range that can't go below 0", () => {
    const p = projectPpg({ position: "TE", draftScore: 0.05, past: { ppg: 0, games: 3 } })!;
    expect(p.low).toBe(0);
    expect(p.low).toBeLessThanOrEqual(p.ppg);
    expect(p.high).toBeGreaterThan(p.ppg);
  });

  it("keeps the chance of playing between 5% and 95%", () => {
    const low = projectPpg({ position: "WR", draftScore: 0, past: { ppg: 0, games: 16 } })!;
    const high = projectPpg({ position: "WR", draftScore: 1, past: { ppg: 40, games: 16 } })!;
    expect(low.chancePlays).toBeGreaterThanOrEqual(0.05);
    expect(high.chancePlays).toBe(0.95);
  });

  it("has no projection for quarterbacks yet", () => {
    expect(projectPpg({ position: "QB", draftScore: 1, past: null })).toBeNull();
  });
});
