import { describe, expect, it } from "vitest";
import type { PlayerInfo } from "../../shared/types.ts";
import { DEFAULT_WEIGHTS, rankBreakouts, withinAgeCap, type BreakoutInput } from "./breakout.ts";
import type { UsageAverages } from "./usage.ts";

const player = (id: string, age: number): PlayerInfo => ({
  id,
  name: id,
  position: "WR",
  team: "KC",
  age,
  birthDate: null,
  yearsExp: 1,
  rookieYear: 2025,
  depthChartPosition: "WR",
  depthChartOrder: 2,
  injuryStatus: null,
  injuryBodyPart: null,
  status: "Active",
  gsisId: null,
  searchRank: 100,
});

const avg = (snapShare: number, opportunityShare: number): UsageAverages => ({
  games: 3,
  snapShare,
  targetShare: opportunityShare,
  carryShare: 0,
  redZoneShare: 0,
  opportunityShare,
});

describe("rankBreakouts", () => {
  it("ranks a bigger workload and better draft capital first", () => {
    const starter: BreakoutInput = {
      player: player("starter", 23),
      usage: { recent: avg(0.8, 0.22), earlier: avg(0.8, 0.22) },
      draft: { season: 2024, round: 2, pick: 40, team: "KC" },
      market: 1500,
    };
    const backup: BreakoutInput = {
      player: player("backup", 23),
      usage: { recent: avg(0.4, 0.08), earlier: avg(0.4, 0.08) },
      draft: { season: 2024, round: 5, pick: 150, team: "KC" },
      market: 500,
    };
    const [first, second] = rankBreakouts([backup, starter]);
    expect(first!.player.id).toBe("starter");
    expect(first!.score).toBeGreaterThan(second!.score);
  });

  it("scores players with no usage on youth and draft capital alone", () => {
    const [result] = rankBreakouts([
      { player: player("rookie", 21), usage: null, draft: { season: 2026, round: 1, pick: 5, team: "KC" }, market: null },
    ]);
    const total = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(result!.score).toBe(Math.round((100 * (DEFAULT_WEIGHTS.youth + DEFAULT_WEIGHTS.draftCapital)) / total));
  });

  it("explains a usage jump even though the trend isn't weighted", () => {
    const [result] = rankBreakouts([
      { player: player("riser", 22), usage: { recent: avg(0.8, 0.22), earlier: avg(0.4, 0.1) }, draft: null, market: null },
    ]);
    expect(result!.signals.find((s) => s.key === "usageTrend")!.reason).toMatch(/40% → 80%/);
  });
});

describe("withinAgeCap", () => {
  it("applies the cap for the player's position", () => {
    expect(withinAgeCap({ ...player("wr", 26), position: "WR" })).toBe(true);
    expect(withinAgeCap({ ...player("wr", 27), position: "WR" })).toBe(false);
    expect(withinAgeCap({ ...player("rb", 26), position: "RB" })).toBe(false);
    expect(withinAgeCap({ ...player("te", 27), position: "TE" })).toBe(true);
  });

  it("keeps players with unknown age", () => {
    expect(withinAgeCap({ ...player("rookie", 0), age: null })).toBe(true);
  });
});
