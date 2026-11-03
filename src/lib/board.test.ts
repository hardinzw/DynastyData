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
  espnId: null,
  college: null,
  searchRank: null,
});

const line = (playerId: string, pts: number, targets = 4): WeeklyLine => ({
  playerId,
  position: "WR",
  team: "KC",
  opponent: null,
  stats: { pts_ppr: pts, off_snp: 30, tm_off_snp: 60, rec_tgt: targets },
});

const weeks = (season: number, count: number, lines: WeeklyLine[]): WeekData[] =>
  Array.from({ length: count }, (_, i) => ({ season, week: i + 1, final: true, lines }));

const input = (overrides: Partial<BoardInput>): BoardInput => ({
  players: {},
  weeks: [],
  inSeason: true,
  priorWeeks: [],
  draft: {},
  college: {},
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

  it("gives unplayed rookies a rookie tier without changing their score", () => {
    const players = { rook: player("rook", "WR", 21), vet: player("vet", "WR", 21) };
    const draft = {
      rook: { season: 2026, round: 1, pick: 8, team: "KC" },
      vet: { season: 2023, round: 1, pick: 8, team: "KC" },
    };
    const board = buildBoard(input({ players, draft, weeks: weeks(2026, 1, []) }));
    const rook = board.find((r) => r.player.id === "rook")!;
    const vet = board.find((r) => r.player.id === "vet")!;
    expect(rook).toMatchObject({ rookie: true, tier: { label: "Rookie prospect" } });
    expect(vet).toMatchObject({ rookie: false, tier: { label: "No recent games" } });
    expect(rook.score).toBe(vet.score);
  });

  it("projects PPG for players with games and unplayed rookies, but not for anyone else", () => {
    const players = {
      active: player("active", "WR", 24),
      rook: player("rook", "WR", 21),
      hurt: player("hurt", "WR", 24),
      gone: player("gone", "WR", 24),
    };
    const draft = { rook: { season: 2026, round: 1, pick: 8, team: "KC" } };
    const board = buildBoard(
      input({
        players,
        draft,
        // Enough better receivers that he isn't ranked as a starter and left off the board.
        weeks: weeks(2026, 4, [line("active", 8), ...Array.from({ length: 24 }, (_, i) => line(`star${i}`, 20))]),
        priorWeeks: weeks(2025, 1, [line("hurt", 8)]),
      }),
    );
    const projection = (id: string) => board.find((r) => r.player.id === id)!.projection;
    expect(projection("active")!.ppg).toBeGreaterThan(0);
    expect(projection("rook")!.ppg).toBeGreaterThan(0);
    expect(projection("hurt")).toBeNull();
    expect(projection("gone")).toBeNull();
  });

  it("scores a veteran who missed this season on last season's usage", () => {
    const players = { hurt: player("hurt", "WR", 24), other: player("other", "WR", 24) };
    const draft = { hurt: { season: 2023, round: 1, pick: 8, team: "KC" } };
    // Too few games last season to rank as a starter.
    const board = buildBoard(
      input({
        players,
        draft,
        weeks: weeks(2026, 3, [line("other", 5)]),
        priorWeeks: weeks(2025, 2, [line("hurt", 5, 1), line("other", 5, 9)]),
      }),
    );
    const hurt = board.find((r) => r.player.id === "hurt")!;
    expect(hurt.usageFromLastSeason).toBe(true);
    expect(hurt.usage!.games).toBe(2);
    expect(hurt.score).toBeLessThan(Math.round(100 * Math.exp(-8 / 120)));
    expect(hurt.rookie).toBe(false);
    expect(hurt.tier.label).toBe("Missed season");
  });

  it("shows college stats without changing the score", () => {
    const players = { wr: player("wr", "WR", 23) };
    const seasons = [{ season: 2022, team: "State", games: 12, targets: 100, teamTargets: 400, recYards: 900, teamRecYards: 3000, rushes: 0, rushYards: 0, teamRushYards: 2000, firstDowns: 40, teamFirstDowns: 250 }];
    const plain = buildBoard(input({ players }))[0]!;
    const shown = buildBoard(input({ players: { wr: { ...players.wr, birthDate: "2002-03-01" } }, college: { wr: seasons } }))[0]!;
    expect(plain.college).toBeNull();
    expect(shown.college).toMatchObject({ kind: "breakoutAge", season: 2022 });
    expect(shown.score).toBe(plain.score);
  });

  it("doesn't rate a veteran with no games this season or last, and ranks him last", () => {
    const players = { gone: player("gone", "WR", 24), active: player("active", "WR", 24) };
    const draft = { gone: { season: 2022, round: 1, pick: 1, team: "KC" } };
    // One game of four is too few to rank him as a starter.
    const season = [...weeks(2026, 1, [line("active", 5, 1)]), ...weeks(2026, 3, [])];
    const board = buildBoard(input({ players, draft, weeks: season }));
    expect(board.map((r) => r.player.id)).toEqual(["active", "gone"]);
    expect(board[1]!.tier.label).toBe("No recent games");
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

  it("flags players FantasyCalc ranks outside starter range as cheap", () => {
    const value = (positionRank: number) => ({ value: 1000, overallRank: 100, positionRank, trend30Day: 0, tier: null });
    const board = buildBoard(
      input({
        players: { pricey: player("pricey", "WR", 23), cheap: player("cheap", "WR", 23), unvalued: player("unvalued", "WR", 23) },
        values: { pricey: value(20), cheap: value(50) },
      }),
    );
    const cheap = Object.fromEntries(board.map((r) => [r.player.id, r.cheap]));
    expect(cheap).toEqual({ pricey: false, cheap: true, unvalued: true });
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

  it("notes a teammate ahead of him who has missed the last two games", () => {
    const players = { lead: player("lead", "WR", 23), backup: player("backup", "WR", 23) };
    // 24 better WRs on another team, so "backup" isn't ranked a starter.
    const others = Array.from({ length: 24 }, (_, i): WeeklyLine => ({ ...line(`other${i}`, 20), team: "BUF" }));
    const weeks = [1, 2, 3, 4, 5].map((week) => ({
      season: 2026,
      week,
      final: true,
      lines: [...(week <= 3 ? [line("lead", 3, 10)] : []), line("backup", 2, 2), ...others],
    }));
    const board = buildBoard(input({ players, weeks }));
    const backup = board.find((r) => r.player.id === "backup")!;
    expect(backup.opening.holders.map((h) => h.playerId)).toEqual(["lead"]);
  });
});
