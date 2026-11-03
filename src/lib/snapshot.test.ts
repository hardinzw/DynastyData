import { describe, expect, it } from "vitest";
import type { DynastyValue, PlayerInfo } from "../../shared/types.ts";
import { buildSnapshot, formatKey, type SnapshotInput } from "./snapshot.ts";

const player = (id: string, position: PlayerInfo["position"], age: number): PlayerInfo => ({
  id,
  name: id,
  position,
  team: "KC",
  age,
  birthDate: null,
  yearsExp: 1,
  rookieYear: null,
  depthChartPosition: null,
  depthChartOrder: null,
  injuryStatus: null,
  injuryBodyPart: null,
  status: "Active",
  gsisId: null,
  espnId: null,
  college: null,
  searchRank: null,
});

const priced = (positionRank: number): DynastyValue => ({ value: 1000, overallRank: 50, positionRank, trend30Day: 0, tier: null });

const input = (overrides: Partial<SnapshotInput>): SnapshotInput => ({
  takenAt: "2026-11-03T12:00:00.000Z",
  commit: "abc1234",
  season: 2026,
  throughWeek: 8,
  players: {},
  weeks: [],
  priorWeeks: [],
  draft: {},
  values: {},
  ...overrides,
});

describe("formatKey", () => {
  it("names a league format", () => {
    expect(formatKey({ numQbs: 2, numTeams: 12, ppr: 0.5 })).toBe("2qb-12-0.5ppr");
  });
});

describe("buildSnapshot", () => {
  it("scores the same players the board does", () => {
    const players = { young: player("young", "WR", 23), old: player("old", "WR", 30) };
    const { rows } = buildSnapshot(input({ players }));
    expect(rows.map((r) => r.id)).toEqual(["young"]);
  });

  it("marks cheap separately for each league format", () => {
    const players = { wr: player("wr", "WR", 23) };
    const values = { oneQb: { wr: priced(20) }, superflex: { wr: priced(40) } };
    const [row] = buildSnapshot(input({ players, values })).rows;
    expect(row!.cheap).toEqual({ oneQb: false, superflex: true });
  });

  it("gives the same score whatever the prices are", () => {
    const players = { wr: player("wr", "WR", 23) };
    const unpriced = buildSnapshot(input({ players })).rows[0]!;
    const withPrices = buildSnapshot(input({ players, values: { oneQb: { wr: priced(1) } } })).rows[0]!;
    expect(withPrices.score).toBe(unpriced.score);
  });

  it("records signals with no data as null, not 0", () => {
    const players = { wr: player("wr", "WR", 23) };
    const [row] = buildSnapshot(input({ players })).rows;
    expect(row!.signals.usageLevel).toBeNull();
    expect(row!.signals.draftCapital).toBe(0.05);
  });

  it("records the tier the board shows", () => {
    const players = { rook: player("rook", "WR", 21) };
    const draft = { rook: { season: 2026, round: 1, pick: 8, team: "KC" } };
    const weeks = [{ season: 2026, week: 1, final: true, lines: [] }];
    const [row] = buildSnapshot(input({ players, draft, weeks })).rows;
    expect(row!.tier).toBe("Rookie prospect");
  });

  it("records the projection the board shows", () => {
    const players = { rook: player("rook", "WR", 21), gone: player("gone", "WR", 24) };
    const draft = { rook: { season: 2026, round: 1, pick: 8, team: "KC" } };
    const weeks = [{ season: 2026, week: 1, final: true, lines: [] }];
    const { rows } = buildSnapshot(input({ players, draft, weeks }));
    expect(rows.find((r) => r.id === "rook")!.projection!.ppg).toBeGreaterThan(0);
    expect(rows.find((r) => r.id === "gone")!.projection).toBeNull();
  });

  it("marks usage carried over from last season", () => {
    const players = { hurt: player("hurt", "WR", 24) };
    const line = { playerId: "hurt", position: "WR" as const, team: "KC", opponent: null, stats: { off_snp: 30, rec_tgt: 2 } };
    const priorWeeks = [{ season: 2025, week: 1, final: true, lines: [line] }];
    const weeks = [{ season: 2026, week: 1, final: true, lines: [] }];
    const [row] = buildSnapshot(input({ players, weeks, priorWeeks })).rows;
    expect(row!.usageFromLastSeason).toBe(true);
    expect(row!.tier).toBe("Missed season");
    expect(row!.signals.usageLevel).not.toBeNull();
  });

  it("keeps prices for players who aren't on the board", () => {
    const values = { oneQb: { star: priced(1) } };
    expect(buildSnapshot(input({ values })).values).toEqual(values);
  });
});
