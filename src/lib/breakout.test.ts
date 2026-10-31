import { describe, expect, it } from "vitest";
import type { PlayerInfo } from "../../shared/types.ts";
import { rankBreakouts, type BreakoutInput } from "./breakout.ts";
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
  it("ranks a cheap young player with rising usage above an expensive veteran with flat usage", () => {
    const riser: BreakoutInput = {
      player: player("riser", 22),
      usage: { recent: avg(0.8, 0.22), earlier: avg(0.4, 0.1) },
      draft: { season: 2025, round: 2, pick: 40, team: "KC" },
      value: { value: 1500, overallRank: 150, positionRank: 60, trend30Day: 0, tier: 8 },
    };
    const veteran: BreakoutInput = {
      player: player("veteran", 30),
      usage: { recent: avg(0.9, 0.25), earlier: avg(0.9, 0.25) },
      draft: { season: 2018, round: 1, pick: 20, team: "KC" },
      value: { value: 6000, overallRank: 30, positionRank: 12, trend30Day: 0, tier: 3 },
    };
    const [first, second] = rankBreakouts([veteran, riser]);
    expect(first!.player.id).toBe("riser");
    expect(first!.score).toBeGreaterThan(second!.score);
    expect(first!.signals.find((s) => s.key === "usageTrend")!.reason).toMatch(/40% → 80%/);
  });

  it("scores players with no usage on youth and draft capital alone", () => {
    const [result] = rankBreakouts([
      { player: player("rookie", 21), usage: null, draft: { season: 2026, round: 1, pick: 5, team: "KC" }, value: null },
    ]);
    expect(result!.score).toBe(Math.round(100 * (0.15 + 0.15)));
  });
});
