import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { ENABLED_POSITIONS, type Position } from "../../shared/positions.ts";
import { ErrorMessage, Loading } from "../components/Status.tsx";
import {
  LAST_REGULAR_SEASON_WEEK,
  statsWindow,
  useDraft,
  useLeague,
  useNflState,
  usePlayers,
  useSeasonWeeks,
  useValues,
} from "../hooks/queries.ts";
import { buildBoard, type BoardRow, type Ownership } from "../lib/board.ts";
import { DEFAULT_WEIGHTS, MAX_BREAKOUT_AGE } from "../lib/breakout.ts";
import { valuesParamsFor } from "../lib/scoring.ts";

const ROWS_SHOWN = 100;

type OwnershipFilter = "all" | Ownership["kind"];

export default function Board() {
  const { leagueId = "" } = useParams();
  const [search] = useSearchParams();
  const myUserId = search.get("user");
  const [position, setPosition] = useState<Position | "ALL">("ALL");
  const [ownership, setOwnership] = useState<OwnershipFilter>("all");

  const state = useNflState();
  const { league, rosters, users } = useLeague(leagueId);
  const players = usePlayers();
  const draft = useDraft();
  const values = useValues(league.data && valuesParamsFor(league.data));
  const range = state.data && statsWindow(state.data);
  const weeks = useSeasonWeeks(range?.season, range?.lastWeek);
  const priorWeeks = useSeasonWeeks(range && range.season - 1, range && LAST_REGULAR_SEASON_WEEK);

  const board = useMemo(() => {
    if (!players.data || !weeks.data || !priorWeeks.data || !draft.data || !values.data || !rosters.data || !users.data)
      return null;
    return buildBoard({
      players: players.data,
      weeks: weeks.data,
      priorWeeks: priorWeeks.data,
      draft: draft.data,
      values: values.data,
      rosters: rosters.data,
      users: users.data,
      myUserId,
    });
  }, [players.data, weeks.data, priorWeeks.data, draft.data, values.data, rosters.data, users.data, myUserId]);

  const error = [state, league, rosters, users, players, draft, values, weeks, priorWeeks].find((q) => q.error)?.error;
  if (error) return <ErrorMessage error={error} />;
  if (!board || !league.data) return <Loading label="Loading players, stats and trade values" />;

  const rows = board
    .filter((r) => position === "ALL" || r.player.position === position)
    .filter((r) => ownership === "all" || r.ownership.kind === ownership)
    .slice(0, ROWS_SHOWN);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-medium">
          {league.data.name} <span className="text-sm text-slate-400">breakout board · {range!.season} stats</span>
          <p className="text-xs font-normal text-slate-500">
            Leaves out players who are already starters (this season or last) and players over{" "}
            {ENABLED_POSITIONS.map((p) => `${p} ${MAX_BREAKOUT_AGE[p]}`).join(", ")}.
          </p>
        </h2>
        <div className="flex gap-2 text-sm">
          <select value={position} onChange={(e) => setPosition(e.target.value as Position | "ALL")} className={selectClass}>
            <option value="ALL">All positions</option>
            {ENABLED_POSITIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select value={ownership} onChange={(e) => setOwnership(e.target.value as OwnershipFilter)} className={selectClass}>
            <option value="all">All players</option>
            <option value="available">Available</option>
            <option value="rival">On rival rosters</option>
            {myUserId && <option value="mine">My roster</option>}
          </select>
        </div>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="text-slate-400">
          <tr className="border-b border-slate-800">
            <th className="py-2 pr-3">#</th>
            <th className="pr-3">Player</th>
            <th className="pr-3">Score</th>
            <th className="pr-3">Value</th>
            <th className="pr-3">Owner</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <BoardTableRow key={row.player.id} row={row} rank={i + 1} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

const selectClass = "rounded border border-slate-700 bg-slate-900 px-2 py-1";

function BoardTableRow({ row, rank }: { row: BoardRow; rank: number }) {
  const { player, value, score, signals, ownership } = row;
  // Only signals the model actually weighs; the others scored near chance in the backtest.
  const reasons = signals.filter((s) => DEFAULT_WEIGHTS[s.key] > 0 && s.reason).map((s) => s.reason);
  return (
    <tr className="border-b border-slate-900 align-top">
      <td className="py-2 pr-3 text-slate-500">{rank}</td>
      <td className="pr-3">
        <div className="font-medium">{player.name}</div>
        <div className="text-xs text-slate-400">
          {player.position} · {player.team} · {player.age ?? "?"} yrs
          {player.injuryStatus && <span className="ml-1 text-amber-400">{player.injuryStatus}</span>}
        </div>
      </td>
      <td className="pr-3 font-semibold text-emerald-400">{score}</td>
      <td className="pr-3 text-slate-300">{value ? `${player.position}${value.positionRank}` : "—"}</td>
      <td className="pr-3">
        <OwnershipBadge ownership={ownership} />
      </td>
      <td className="text-xs text-slate-300">
        {reasons.length ? reasons.map((r) => <div key={r}>{r}</div>) : <span className="text-slate-500">—</span>}
      </td>
    </tr>
  );
}

function OwnershipBadge({ ownership }: { ownership: Ownership }) {
  switch (ownership.kind) {
    case "available":
      return <span className="text-emerald-400">Available</span>;
    case "mine":
      return <span className="text-sky-400">Mine</span>;
    case "rival":
      return <span className="text-slate-300">{ownership.ownerName}</span>;
  }
}
