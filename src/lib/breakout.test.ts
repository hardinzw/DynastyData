import { describe, expect, it } from "vitest";
import type { CollegeSeason, PlayerInfo } from "../../shared/types.ts";
import {
  collegeStat,
  DEFAULT_WEIGHTS,
  describeCollegeStat,
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
      college: [],
    };
    const backup: BreakoutInput = {
      player: player("backup", 23),
      usage: avg(0.4, 0.08),
      draft: { season: 2024, round: 5, pick: 150, team: "KC" },
      college: [],
    };
    const [first, second] = rankBreakouts([backup, starter]);
    expect(first!.player.id).toBe("starter");
    expect(first!.score).toBeGreaterThan(second!.score);
  });

  it("leaves missing usage and college out of the average instead of scoring them 0", () => {
    const [result] = rankBreakouts([
      { player: player("rookie", 21), usage: null, draft: { season: 2026, round: 1, pick: 5, team: "KC" }, college: [] },
    ]);
    const { youth, draftCapital } = DEFAULT_WEIGHTS;
    const draftScore = Math.exp(-5 / 120);
    expect(result!.score).toBe(Math.round((100 * (youth * 1 + draftCapital * draftScore)) / (youth + draftCapital)));
  });

  it("explains a heavy workload", () => {
    const [result] = rankBreakouts([{ player: player("wr", 22), usage: avg(0.8, 0.22), draft: null, college: [] }]);
    expect(result!.signals.find((s) => s.key === "usageLevel")!.reason).toBe("22% opportunity share over 3 games");
  });
});

const season = (year: number, games: number, overrides: Partial<CollegeSeason>): CollegeSeason => ({
  season: year,
  team: "State",
  games,
  targets: 0,
  teamTargets: 400,
  recYards: 0,
  teamRecYards: 3000,
  rushes: 0,
  rushYards: 0,
  teamRushYards: 2000,
  firstDowns: 0,
  teamFirstDowns: 250,
  ...overrides,
});

describe("collegeStat", () => {
  it("uses an RB's share of team receiving yards in his last full season", () => {
    const rb = { ...player("rb", 22), position: "RB" as const };
    const stat = collegeStat(rb, [season(2023, 12, { recYards: 450 }), season(2024, 3, { recYards: 10 })]);
    // The 3-game season is too short to count.
    expect(stat).toEqual({ kind: "recYardShare", share: 0.15, season: 2023 });
    expect(describeCollegeStat(stat!)).toBe("15% of team rec yds");
  });

  it("uses a WR's age in his first season with 20% of team receiving yards", () => {
    const wr = { ...player("wr", 22), birthDate: "2002-03-01" };
    const stat = collegeStat(wr, [season(2021, 12, { recYards: 300 }), season(2022, 12, { recYards: 700 })]);
    expect(stat).toMatchObject({ kind: "breakoutAge", season: 2022 });
    expect(describeCollegeStat(stat!)).toBe("Broke out at 20");
  });

  it("is null without college data", () => {
    expect(collegeStat(player("wr", 22), [])).toBeNull();
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
  it("splits rookies at 60", () => {
    expect(rookieTier(96).label).toBe("Rookie prospect");
    expect(rookieTier(60).label).toBe("Rookie prospect");
    expect(rookieTier(59).label).toBe("Rookie long shot");
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
