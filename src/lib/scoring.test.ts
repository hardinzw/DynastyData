import { describe, expect, it } from "vitest";
import type { League } from "../api/sleeper.ts";
import { fantasyPoints, valuesParamsFor } from "./scoring.ts";

const PPR = { rec: 1, rec_yd: 0.1, rec_td: 6, rush_yd: 0.1, rush_td: 6, fum_lost: -2 };

describe("fantasyPoints", () => {
  it("multiplies each stat by its scoring weight", () => {
    const stats = { rec: 5, rec_yd: 62, rec_td: 1, rush_yd: 10, fum_lost: 1, off_snp: 40 };
    expect(fantasyPoints(stats, "WR", PPR)).toBe(5 + 6.2 + 6 + 1 - 2);
  });

  it("adds TE premium only for tight ends", () => {
    const scoring = { ...PPR, bonus_rec_te: 0.5 };
    const stats = { rec: 4 };
    expect(fantasyPoints(stats, "TE", scoring)).toBe(6);
    expect(fantasyPoints(stats, "WR", scoring)).toBe(4);
  });
});

describe("valuesParamsFor", () => {
  const league = (roster_positions: string[], rec: number) =>
    ({ roster_positions, total_rosters: 12, scoring_settings: { rec } }) as unknown as League;

  it("detects superflex and half PPR", () => {
    expect(valuesParamsFor(league(["QB", "RB", "WR", "SUPER_FLEX"], 0.5))).toEqual({
      numQbs: 2,
      numTeams: 12,
      ppr: 0.5,
    });
  });

  it("treats one QB slot as 1QB", () => {
    expect(valuesParamsFor(league(["QB", "RB", "FLEX"], 1)).numQbs).toBe(1);
  });
});
