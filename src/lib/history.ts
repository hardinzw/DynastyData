import type { Position } from "../../shared/positions.ts";
import type { CollegeMap, DraftInfo } from "../../shared/types.ts";
import type { Fold, Sample } from "./backtest.ts";
import { combine, DEFAULT_WEIGHTS, withinAgeCap, type SignalKey } from "./breakout.ts";
import { collegeStat, type CollegeStat } from "./college.ts";

/**
 * One past breakout: a player who wasn't a starter and became one, with what the model
 * saw at the cutoff. Built by `npm run history` into public/data/breakout-history.json.
 */
export interface HistoryRow {
  kind: Fold["kind"];
  /** Season he broke out in. */
  season: number;
  playerId: string;
  name: string;
  position: Position;
  team: string | null;
  age: number | null;
  /** Score at the cutoff with today's weights. */
  score: number;
  signals: Record<SignalKey, number | null>;
  /** Rank on that cutoff's cheap board, or null if he wasn't on it (expensive or over the age cap). */
  cheapRank: number | null;
  cheapPool: number;
  cheap: boolean;
  /** Positional ADP at the cutoff, or null if unranked. */
  adp: number | null;
  overAgeCap: boolean;
  usage: { share: number; games: number } | null;
  /** He hadn't played that season, so `usage` is from the season before. */
  usageFromLastSeason: boolean;
  draft: DraftInfo | null;
  /** Shown next to the player. Not part of the score. */
  college: CollegeStat | null;
  /** Names of teammates ahead of him who were gone at the cutoff. */
  openedBy: string[];
  outcome: { posRank: number; ppg: number; games: number };
}

export interface History {
  generatedAt: string;
  /** The season being played when the file was built, whose rows are breakouts so far. */
  inProgress: { season: number; throughWeek: number } | null;
  rows: HistoryRow[];
}

/**
 * Every breakout in a fold. `samples` must be built with ignoreAgeCap so older breakouts
 * show up too; the cheap-board rank still only counts players the board would have shown.
 */
export function historyRows(fold: Fold, samples: Sample[], names: (id: string) => string, college: CollegeMap): HistoryRow[] {
  const scoreOf = (s: Sample) => Math.round(combine(s.signals, DEFAULT_WEIGHTS));
  const board = samples
    .filter((s) => s.cheap && withinAgeCap(s.player) && !s.usageFromLastSeason)
    .sort((a, b) => scoreOf(b) - scoreOf(a));
  const rank = new Map(board.map((s, i) => [s.player.id, i + 1]));
  const season = fold.outcomeWeeks[0]!.season;

  return samples
    .filter((s) => s.brokeOut && s.outcome?.posRank != null)
    .map((s) => ({
      kind: fold.kind,
      season,
      playerId: s.player.id,
      name: s.player.name,
      position: s.player.position,
      team: s.player.team,
      age: s.player.age,
      score: scoreOf(s),
      signals: Object.fromEntries(s.signals.map((x) => [x.key, x.missing ? null : +x.score.toFixed(3)])) as Record<
        SignalKey,
        number | null
      >,
      cheapRank: rank.get(s.player.id) ?? null,
      cheapPool: board.length,
      cheap: s.cheap,
      adp: s.adp,
      overAgeCap: !withinAgeCap(s.player),
      usage: s.input.usage
        ? { share: +s.input.usage.opportunityShare.toFixed(3), games: s.input.usage.games }
        : null,
      usageFromLastSeason: s.usageFromLastSeason,
      draft: s.input.draft,
      college: collegeStat(s.player, college[s.player.id] ?? []),
      openedBy: s.opening.holders.map((h) => names(h.playerId)),
      outcome: { posRank: s.outcome!.posRank!, ppg: +s.outcome!.ppg.toFixed(1), games: s.outcome!.games },
    }));
}
