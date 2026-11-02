import { describe, expect, it } from "vitest";
import type { CollegeSeason, PlayerInfo } from "../../shared/types.ts";
import { collegeStat, describeCollegeStat } from "./college.ts";

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
