import { describe, expect, it } from "vitest";
import type { PlayerInfo, WeekData, WeeklyLine } from "../../shared/types.ts";
import { buildBoard, type BoardInput } from "./board.ts";

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
  searchRank: null,
});

const line = (playerId: string, pts: number): WeeklyLine => ({
  playerId,
  position: "WR",
  team: "KC",
  opponent: null,
  stats: { pts_ppr: pts, off_snp: 30, tm_off_snp: 60, rec_tgt: 4 },
});

const weeks = (season: number, count: number, lines: WeeklyLine[]): WeekData[] =>
  Array.from({ length: count }, (_, i) => ({ season, week: i + 1, final: true, lines }));

const input = (overrides: Partial<BoardInput>): BoardInput => ({
  players: {},
  weeks: [],
  priorWeeks: [],
  draft: {},
  values: {},
  rosters: [],
  users: [],
  myUserId: null,
  ...overrides,
});

describe("buildBoard", () => {
  it("leaves out players over the age cap", () => {
    const board = buildBoard(input({ players: { young: player("young", "WR", 23), old: player("old", "WR", 30) } }));
    expect(board.map((r) => r.player.id)).toEqual(["young"]);
  });

  it("leaves out players who were starters this season or last", () => {
    const players = { now: player("now", "WR", 23), last: player("last", "WR", 23), new: player("new", "WR", 23) };
    // With only three WRs, every qualified WR ranks inside WR24.
    const board = buildBoard(
      input({
        players,
        weeks: weeks(2026, 4, [line("now", 20), line("new", 5)]).map((w, i) =>
          // "new" only plays one game, too few to be ranked.
          i === 0 ? w : { ...w, lines: w.lines.filter((l) => l.playerId !== "new") },
        ),
        priorWeeks: weeks(2025, 10, [line("last", 15)]),
      }),
    );
    expect(board.map((r) => r.player.id)).toEqual(["new"]);
  });

  it("marks ownership", () => {
    const board = buildBoard(
      input({
        players: { a: player("a", "WR", 23), b: player("b", "WR", 23), c: player("c", "WR", 23) },
        rosters: [
          { roster_id: 1, owner_id: "me", players: ["a"], starters: null, reserve: null, taxi: null },
          { roster_id: 2, owner_id: "rival", players: ["b"], starters: null, reserve: null, taxi: null },
        ],
        users: [{ user_id: "rival", display_name: "Rival", metadata: { team_name: "Rival FC" } }],
        myUserId: "me",
      }),
    );
    const byId = Object.fromEntries(board.map((r) => [r.player.id, r.ownership]));
    expect(byId).toEqual({
      a: { kind: "mine" },
      b: { kind: "rival", ownerName: "Rival FC" },
      c: { kind: "available" },
    });
  });
});
