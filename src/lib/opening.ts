import type { Position } from "../../shared/positions.ts";
import type { WeekData } from "../../shared/types.ts";
import type { UsageWeek } from "./usage.ts";

/** Smallest share that counts as a real role worth inheriting. */
const MEANINGFUL_SHARE: Record<Position, number> = { QB: 0.1, RB: 0.2, WR: 0.12, TE: 0.1 };
/** Games a player needs on a team to count as holding a role there. */
const MIN_ROLE_GAMES = 3;

export interface RoleHolder {
  playerId: string;
  team: string;
  position: Position;
  /** Average opportunity share in his games for that team. */
  share: number;
}

/** Everyone who held a meaningful role on a team over the window, by team and position. */
export function roleHolders(usage: Map<string, UsageWeek[]>): RoleHolder[] {
  const out: RoleHolder[] = [];
  for (const [playerId, games] of usage) {
    const byTeam = new Map<string, UsageWeek[]>();
    for (const g of games) byTeam.set(g.team, [...(byTeam.get(g.team) ?? []), g]);
    for (const [team, list] of byTeam) {
      if (list.length < MIN_ROLE_GAMES) continue;
      const position = list[0]!.position;
      const share = list.reduce((sum, g) => sum + g.opportunityShare, 0) / list.length;
      if (share >= MEANINGFUL_SHARE[position]) out.push({ playerId, team, position, share });
    }
  }
  return out;
}

export interface Opening {
  /** Total opportunity share the gone teammates held. */
  share: number;
  holders: RoleHolder[];
}

/**
 * Teammates ahead of a player (bigger share than his own) who are gone, and the share they
 * held. `gone` decides what that means: hurt right now in-season, or departed in the
 * offseason. Shown on the board as context only: it scored below chance in the backtest
 * (players behind an injured or departed starter broke out less often, not more).
 */
export function openingFor(
  player: { id: string; team: string | null; position: Position; share: number },
  holders: RoleHolder[],
  gone: (holder: RoleHolder) => boolean,
): Opening {
  const open = player.team
    ? holders
        .filter((h) => h.team === player.team && h.position === player.position && h.playerId !== player.id)
        .filter((h) => h.share > player.share && gone(h))
    : [];
  return { share: open.reduce((sum, h) => sum + h.share, 0), holders: open };
}

/** Recent team games to check for absences. Two in a row means more than a one-week rest. */
const RECENT_GAMES = 2;

/**
 * Players who missed each of their team's last two games in the window: hurt, suspended or
 * benched right now. Returns "playerId|team" keys.
 */
export function currentlyOut(weeks: WeekData[]): Set<string> {
  const ordered = [...weeks].sort((a, b) => b.season - a.season || b.week - a.week);
  const recent = new Map<string, Set<string>[]>(); // team -> rosters of its last games
  for (const week of ordered) {
    const byTeam = new Map<string, Set<string>>();
    for (const l of week.lines) byTeam.set(l.team, (byTeam.get(l.team) ?? new Set()).add(l.playerId));
    for (const [team, ids] of byTeam) {
      const list = recent.get(team) ?? [];
      if (list.length < RECENT_GAMES) list.push(ids);
      recent.set(team, list);
    }
  }
  const out = new Set<string>();
  const everOn = new Map<string, Set<string>>();
  for (const week of weeks) for (const l of week.lines) everOn.set(l.team, (everOn.get(l.team) ?? new Set()).add(l.playerId));
  for (const [team, games] of recent) {
    if (games.length < RECENT_GAMES) continue;
    for (const id of everOn.get(team) ?? []) {
      if (games.every((g) => !g.has(id))) out.add(`${id}|${team}`);
    }
  }
  return out;
}
