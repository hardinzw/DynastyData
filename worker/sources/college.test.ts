import { describe, expect, it } from "vitest";
import type { PlayerInfo } from "../../shared/types.ts";
import { buildCollegeMap, type CollegeRow } from "./college.ts";

const player = (id: string, name: string, overrides: Partial<PlayerInfo> = {}): PlayerInfo => ({
  id,
  name,
  position: "WR",
  team: "KC",
  age: 23,
  birthDate: null,
  yearsExp: 1,
  rookieYear: 2025,
  depthChartPosition: null,
  depthChartOrder: null,
  injuryStatus: null,
  injuryBodyPart: null,
  status: "Active",
  gsisId: null,
  espnId: null,
  college: null,
  searchRank: null,
  ...overrides,
});

const row = (espnId: string, name: string, season: number, team = "State Bulldogs"): CollegeRow => ({
  espnId,
  name,
  group: "WR",
  season,
  team,
  games: 12,
  targets: 80,
  teamTargets: 400,
  recYards: 900,
  teamRecYards: 3000,
  rushes: 0,
  rushYards: 0,
  teamRushYards: 2000,
  firstDowns: 40,
  teamFirstDowns: 250,
});

describe("buildCollegeMap", () => {
  it("joins on ESPN id and keeps only seasons before the rookie year", () => {
    const map = buildCollegeMap({ a: player("a", "Different Name", { espnId: "1" }) }, [
      [row("1", "A Player", 2023)],
      [row("1", "A Player", 2024)],
      [row("1", "A Player", 2025)],
    ]);
    expect(map.a!.map((s) => s.season)).toEqual([2023, 2024]);
  });

  it("falls back to name, ignoring suffixes and punctuation", () => {
    const map = buildCollegeMap({ b: player("b", "Brian Thomas Jr.") }, [[row("2", "Brian Thomas", 2024)]]);
    expect(map.b).toHaveLength(1);
  });

  it("settles a shared name with the Sleeper college, and skips it otherwise", () => {
    const seasons = [[row("3", "Mike Smith", 2024, "Georgia Bulldogs"), row("4", "Mike Smith", 2024, "Ohio State Buckeyes")]];
    expect(buildCollegeMap({ c: player("c", "Mike Smith", { college: "Georgia" }) }, seasons).c![0]!.team).toBe(
      "Georgia Bulldogs",
    );
    expect(buildCollegeMap({ c: player("c", "Mike Smith") }, seasons).c).toBeUndefined();
  });

  it("doesn't match a name whose college career ended long before the rookie year", () => {
    const map = buildCollegeMap({ d: player("d", "Old Name") }, [[row("5", "Old Name", 2015)]]);
    expect(map.d).toBeUndefined();
  });
});
