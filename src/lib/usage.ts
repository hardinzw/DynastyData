import type { Position } from "../../shared/positions.ts";
import type { StatLine, WeekData } from "../../shared/types.ts";

/** One player's share of his team's opportunities in one game. Shares are 0-1. */
export interface UsageWeek {
  season: number;
  week: number;
  team: string;
  position: Position;
  snapShare: number;
  targetShare: number;
  carryShare: number;
  airYardShare: number;
  /** Red-zone targets plus carries, over the team's red-zone targets plus carries. */
  redZoneShare: number;
  /** Position-weighted blend of target and carry share; see opportunityShare(). */
  opportunityShare: number;
  stats: StatLine;
}

interface TeamTotals {
  targets: number;
  carries: number;
  airYards: number;
  redZone: number;
}

const share = (part: number | undefined, total: number) => (total > 0 && part ? part / total : 0);

/**
 * How much of the offense runs through a player. RBs are weighted toward carries,
 * pass catchers toward targets and air yards.
 */
export function opportunityShare(
  position: Position,
  u: Pick<UsageWeek, "targetShare" | "carryShare" | "airYardShare">,
): number {
  switch (position) {
    case "RB":
      return 0.6 * u.carryShare + 0.4 * u.targetShare;
    case "WR":
    case "TE":
      return 0.7 * u.targetShare + 0.3 * u.airYardShare;
    case "QB":
      return u.carryShare;
  }
}

function teamTotals(week: WeekData): Map<string, TeamTotals> {
  const totals = new Map<string, TeamTotals>();
  for (const { team, stats: s } of week.lines) {
    const t = totals.get(team) ?? { targets: 0, carries: 0, airYards: 0, redZone: 0 };
    t.targets += s.rec_tgt ?? 0;
    t.carries += s.rush_att ?? 0;
    // Negative air yards (screens) would distort shares, so only count positive totals.
    t.airYards += Math.max(0, s.rec_air_yd ?? 0);
    t.redZone += (s.rec_rz_tgt ?? 0) + (s.rush_rz_att ?? 0);
    totals.set(team, t);
  }
  return totals;
}

/** Builds each player's game-by-game usage, oldest first. */
export function buildUsage(weeks: WeekData[]): Map<string, UsageWeek[]> {
  const byPlayer = new Map<string, UsageWeek[]>();
  const ordered = [...weeks].sort((a, b) => a.season - b.season || a.week - b.week);
  for (const week of ordered) {
    const totals = teamTotals(week);
    for (const line of week.lines) {
      const t = totals.get(line.team)!;
      const s = line.stats;
      const base = {
        targetShare: share(s.rec_tgt, t.targets),
        carryShare: share(s.rush_att, t.carries),
        airYardShare: share(Math.max(0, s.rec_air_yd ?? 0), t.airYards),
      };
      const usage: UsageWeek = {
        season: week.season,
        week: week.week,
        team: line.team,
        position: line.position,
        snapShare: share(s.off_snp, s.tm_off_snp ?? 0),
        ...base,
        redZoneShare: share((s.rec_rz_tgt ?? 0) + (s.rush_rz_att ?? 0), t.redZone),
        opportunityShare: opportunityShare(line.position, base),
        stats: s,
      };
      const list = byPlayer.get(line.playerId) ?? [];
      list.push(usage);
      byPlayer.set(line.playerId, list);
    }
  }
  return byPlayer;
}

export interface UsageAverages {
  games: number;
  snapShare: number;
  targetShare: number;
  carryShare: number;
  redZoneShare: number;
  opportunityShare: number;
}

/**
 * A player's average usage over every game he played. The backtest found the whole
 * window predicts breakouts better than recent games or any measure of rising usage.
 */
export function summarizeUsage(games: UsageWeek[]): UsageAverages | null {
  if (games.length === 0) return null;
  const mean = (f: (u: UsageWeek) => number) => games.reduce((sum, g) => sum + f(g), 0) / games.length;
  return {
    games: games.length,
    snapShare: mean((g) => g.snapShare),
    targetShare: mean((g) => g.targetShare),
    carryShare: mean((g) => g.carryShare),
    redZoneShare: mean((g) => g.redZoneShare),
    opportunityShare: mean((g) => g.opportunityShare),
  };
}
