import { describe, expect, it } from "vitest";
import type { PlayerInfo } from "../../shared/types.ts";
import {
  isUnplayedRookie,
  rankBreakouts,
  rookieTier,
  scoreTier,
  withinAgeCap,
  type BreakoutInput,
} from "./breakout.ts";
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
  espnId: null,
  college: null,
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
      usage: avg(0.8, 0.22),
      draft: { season: 2024, round: 2, pick: 40, team: "KC" },
    };
    const backup: BreakoutInput = {
      player: player("backup", 23),
      usage: avg(0.4, 0.08),
      draft: { season: 2024, round: 5, pick: 150, team: "KC" },
    };
    const [first, second] = rankBreakouts([backup, starter]);
    expect(first!.player.id).toBe("starter");
    expect(first!.score).toBeGreaterThan(second!.score);
  });

  it("leaves missing usage out of the average instead of scoring it 0", () => {
    const [result] = rankBreakouts([
      { player: player("rookie", 21), usage: null, draft: { season: 2026, round: 1, pick: 5, team: "KC" } },
    ]);
    expect(result!.score).toBe(Math.round(100 * Math.exp(-5 / 120)));
  });

  it("explains a heavy workload", () => {
    const [result] = rankBreakouts([{ player: player("wr", 22), usage: avg(0.8, 0.22), draft: null }]);
    expect(result!.signals.find((s) => s.key === "usageLevel")!.reason).toBe("22% opportunity share over 3 games");
  });
});

describe("scoreTier", () => {
  it("bands scores by what they meant in the backtest", () => {
    expect(scoreTier(75).label).toBe("Strong");
    expect(scoreTier(74).label).toBe("Watch");
    expect(scoreTier(40).label).toBe("Long shot");
    expect(scoreTier(39).label).toBe("Unlikely");
  });
});

describe("rookieTier", () => {
  it("splits rookies at 50", () => {
    expect(rookieTier(96).label).toBe("Rookie prospect");
    expect(rookieTier(50).label).toBe("Rookie prospect");
    expect(rookieTier(49).label).toBe("Rookie long shot");
  });
});

describe("isUnplayedRookie", () => {
  const usage = { games: 3 } as UsageAverages;
  const drafted = (season: number) => ({ season, round: 1, pick: 8, team: "NO" });

  it("is true for a player drafted this season with no games", () => {
    expect(isUnplayedRookie(player("wr", 21), drafted(2026), null, 2026)).toBe(true);
  });

  it("is true in the offseason for a player drafted after the season being scored", () => {
    expect(isUnplayedRookie(player("wr", 21), drafted(2027), null, 2026)).toBe(true);
  });

  it("is false once he has played", () => {
    expect(isUnplayedRookie(player("wr", 21), drafted(2026), usage, 2026)).toBe(false);
  });

  it("is false for a veteran with no games", () => {
    expect(isUnplayedRookie(player("wr", 24), drafted(2023), null, 2026)).toBe(false);
  });

  it("uses his rookie year when he went undrafted", () => {
    expect(isUnplayedRookie({ ...player("wr", 22), rookieYear: 2026 }, null, null, 2026)).toBe(true);
  });

  it("is false when nothing says when he started", () => {
    expect(isUnplayedRookie(player("wr", 22), null, null, 2026)).toBe(false);
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
