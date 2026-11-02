import { describe, expect, it } from "vitest";
import type { WeekData, WeeklyLine } from "../../shared/types.ts";
import { buildUsage, summarizeUsage, usageOrLastSeason, type UsageWeek } from "./usage.ts";

const line = (playerId: string, position: WeeklyLine["position"], stats: WeeklyLine["stats"]): WeeklyLine => ({
  playerId,
  position,
  team: "KC",
  opponent: "BUF",
  stats: { tm_off_snp: 60, ...stats },
});

const week = (n: number, lines: WeeklyLine[]): WeekData => ({ season: 2026, week: n, final: true, lines });

describe("buildUsage", () => {
  it("computes shares against team totals", () => {
    const usage = buildUsage([
      week(1, [
        line("wr1", "WR", { off_snp: 54, rec_tgt: 9, rec_air_yd: 120 }),
        line("wr2", "WR", { off_snp: 30, rec_tgt: 3, rec_air_yd: -5 }),
        line("rb1", "RB", { off_snp: 40, rush_att: 15, rec_tgt: 3 }),
      ]),
    ]);
    const wr1 = usage.get("wr1")![0]!;
    expect(wr1.snapShare).toBeCloseTo(0.9);
    expect(wr1.targetShare).toBeCloseTo(9 / 15);
    // Negative air yards are excluded from team totals.
    expect(wr1.airYardShare).toBe(1);
    expect(usage.get("rb1")![0]!.carryShare).toBe(1);
  });

  it("orders games oldest first regardless of input order", () => {
    const usage = buildUsage([week(2, [line("a", "WR", { off_snp: 1 })]), week(1, [line("a", "WR", { off_snp: 1 })])]);
    expect(usage.get("a")!.map((u) => u.week)).toEqual([1, 2]);
  });
});

describe("summarizeUsage", () => {
  it("averages every game played", () => {
    const weeks = [1, 2, 3, 4, 5].map((n) =>
      week(n, [line("a", "WR", { off_snp: n * 10, rec_tgt: 1 }), line("b", "WR", { off_snp: 60, rec_tgt: 1 })]),
    );
    const summary = summarizeUsage(buildUsage(weeks).get("a")!)!;
    expect(summary.games).toBe(5);
    expect(summary.snapShare).toBeCloseTo(30 / 60);
    expect(summary.targetShare).toBeCloseTo(0.5);
  });

  it("returns null with no games", () => {
    expect(summarizeUsage([])).toBeNull();
  });
});

describe("usageOrLastSeason", () => {
  const game = (opportunityShare: number) => ({ opportunityShare, snapShare: 0, targetShare: 0, carryShare: 0, redZoneShare: 0 }) as UsageWeek;
  const now = new Map([["a", [game(0.2)]]]);
  const before = new Map([["a", [game(0.1)]], ["b", [game(0.3)]]]);

  it("prefers this season", () => {
    const { usage, fromLastSeason } = usageOrLastSeason("a", now, before);
    expect(usage!.opportunityShare).toBe(0.2);
    expect(fromLastSeason).toBe(false);
  });

  it("falls back to last season when he hasn't played", () => {
    const { usage, fromLastSeason } = usageOrLastSeason("b", now, before);
    expect(usage!.opportunityShare).toBe(0.3);
    expect(fromLastSeason).toBe(true);
  });

  it("is null when he played in neither", () => {
    expect(usageOrLastSeason("c", now, before)).toEqual({ usage: null, fromLastSeason: false });
  });
});
