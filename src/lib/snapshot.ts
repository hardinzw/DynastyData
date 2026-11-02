import type { DraftMap, PlayersMap, ValuesMap, ValuesParams, WeekData } from "../../shared/types.ts";
import { buildBoard } from "./board.ts";
import { DEFAULT_WEIGHTS, type SignalKey, type Weights } from "./breakout.ts";
import { isCheap } from "./production.ts";

/** Key for one league format's values in a snapshot, e.g. "1qb-12-1ppr". */
export const formatKey = ({ numQbs, numTeams, ppr }: ValuesParams) => `${numQbs}qb-${numTeams}-${ppr}ppr`;

export interface SnapshotRow {
  id: string;
  name: string;
  position: string;
  team: string | null;
  age: number | null;
  /** 0-100, as the board shows it. */
  score: number;
  tier: string;
  /** He hadn't played this season, so his usage signal is from last season. */
  usageFromLastSeason: boolean;
  /** Each signal 0-1, or null if it had no data and was left out of the score. */
  signals: Record<SignalKey, number | null>;
  /** Whether FantasyCalc prices him as cheap, by league format. */
  cheap: Record<string, boolean>;
}

/**
 * The board and dynasty prices as they stood after a finished week. Nothing here can be
 * rebuilt later: FantasyCalc has no price history, and Sleeper's player data changes.
 */
export interface Snapshot {
  takenAt: string;
  /** Git commit the scores came from, with "-dirty" if the working tree had changes. */
  commit: string;
  season: number;
  throughWeek: number;
  weights: Weights;
  rows: SnapshotRow[];
  /** Every player FantasyCalc prices, not just the board, so price moves can be measured. */
  values: Record<string, ValuesMap>;
}

export interface SnapshotInput {
  takenAt: string;
  commit: string;
  season: number;
  throughWeek: number;
  players: PlayersMap;
  weeks: WeekData[];
  priorWeeks: WeekData[];
  draft: DraftMap;
  values: Record<string, ValuesMap>;
}

/** Scores the same players the board does. Prices don't affect the score, only `cheap`. */
export function buildSnapshot({ takenAt, commit, season, throughWeek, players, weeks, priorWeeks, draft, values }: SnapshotInput): Snapshot {
  const board = buildBoard({ players, weeks, inSeason: true, priorWeeks, draft, college: {}, values: {}, rosters: [], users: [], myUserId: null });
  const rows = board.map((r): SnapshotRow => ({
    id: r.player.id,
    name: r.player.name,
    position: r.player.position,
    team: r.player.team,
    age: r.player.age,
    score: r.score,
    tier: r.tier.label,
    usageFromLastSeason: r.usageFromLastSeason,
    signals: Object.fromEntries(r.signals.map((s) => [s.key, s.missing ? null : Number(s.score.toFixed(3))])) as Record<SignalKey, number | null>,
    cheap: Object.fromEntries(
      Object.entries(values).map(([key, map]) => [key, isCheap(r.player.position, map[r.player.id]?.positionRank ?? null)]),
    ),
  }));
  return { takenAt, commit, season, throughWeek, weights: DEFAULT_WEIGHTS, rows, values };
}
