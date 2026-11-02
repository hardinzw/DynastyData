import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { isDynasty, type League } from "../api/sleeper.ts";
import { ENABLED_POSITIONS, type Position } from "../../shared/positions.ts";
import type { PlayersMap } from "../../shared/types.ts";
import { PlayerPhoto } from "../components/PlayerPhoto.tsx";
import { POSITION_TAG } from "../components/positionColors.ts";
import { Empty, ErrorMessage, Loading } from "../components/Status.tsx";
import {
  LAST_REGULAR_SEASON_WEEK,
  statsWindow,
  useCollege,
  useDraft,
  useLeague,
  useLeagues,
  useNflState,
  usePlayers,
  useSeasonWeeks,
  useValues,
} from "../hooks/queries.ts";
import { buildBoard, type BoardRow, type Ownership } from "../lib/board.ts";
import { describeCollegeStat, MAX_BREAKOUT_AGE } from "../lib/breakout.ts";
import { STARTER_RANK } from "../lib/production.ts";
import { valuesParamsFor } from "../lib/scoring.ts";
import { ScoreCell, TierLegend } from "../components/ScoreTier.tsx";

const ROWS_SHOWN = 100;

type OwnershipFilter = "all" | Ownership["kind"];
type PriceFilter = "cheap" | "all";
type RookieFilter = "include" | "hide" | "only";

export default function Board() {
  const { leagueId = "" } = useParams();
  const [search] = useSearchParams();
  const myUserId = search.get("user");
  // Cheap players are where the backtest found an edge over the market, so start there.
  const [price, setPrice] = useState<PriceFilter>("cheap");
  const [position, setPosition] = useState<Position | "ALL">("ALL");
  const [ownership, setOwnership] = useState<OwnershipFilter>("all");
  const [rookies, setRookies] = useState<RookieFilter>("include");

  const state = useNflState();
  const navigate = useNavigate();
  const { league, rosters, users } = useLeague(leagueId);
  // The user's other dynasty leagues, for the league switcher. Needs ?user= from the leagues page.
  const myLeagues = useLeagues(myUserId ?? undefined, league.data?.season);
  const players = usePlayers();
  const draft = useDraft();
  const college = useCollege();
  const values = useValues(league.data && valuesParamsFor(league.data));
  const range = state.data && statsWindow(state.data);
  const weeks = useSeasonWeeks(range?.season, range?.lastWeek);
  const priorWeeks = useSeasonWeeks(range && range.season - 1, range && LAST_REGULAR_SEASON_WEEK);

  const inSeason = state.data?.season_type === "regular";

  const board = useMemo(() => {
    if (
      !players.data ||
      !weeks.data ||
      !priorWeeks.data ||
      !draft.data ||
      !college.data ||
      !values.data ||
      !rosters.data ||
      !users.data
    )
      return null;
    return buildBoard({
      players: players.data,
      weeks: weeks.data,
      inSeason,
      priorWeeks: priorWeeks.data,
      draft: draft.data,
      college: college.data,
      values: values.data,
      rosters: rosters.data,
      users: users.data,
      myUserId,
    });
  }, [
    players.data,
    weeks.data,
    inSeason,
    priorWeeks.data,
    draft.data,
    college.data,
    values.data,
    rosters.data,
    users.data,
    myUserId,
  ]);

  const error = [state, league, rosters, users, players, draft, college, values, weeks, priorWeeks].find(
    (q) => q.error,
  )?.error;
  if (error) return <ErrorMessage error={error} />;
  if (!board || !league.data) return <Loading label="Loading players, stats and trade values" />;

  const rows = board
    .filter((r) => price === "all" || r.cheap)
    .filter((r) => position === "ALL" || r.player.position === position)
    .filter((r) => ownership === "all" || r.ownership.kind === ownership)
    .filter((r) => rookies === "include" || r.rookie === (rookies === "only"))
    .slice(0, ROWS_SHOWN);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="flex flex-wrap items-baseline gap-x-2 text-lg font-medium">
            <LeagueSwitcher
              current={league.data}
              leagues={myLeagues.data?.filter(isDynasty) ?? []}
              onChange={(id) => navigate(`/league/${id}?user=${myUserId}`)}
            />
            <span className="text-sm text-muted">breakout board · {range!.season} stats</span>
          </h2>
          <p className="text-xs text-muted">
            Leaves out players who are already starters (this season or last) and players over{" "}
            {ENABLED_POSITIONS.map((p) => `${p} ${MAX_BREAKOUT_AGE[p]}`).join(", ")}. “Cheap” means FantasyCalc
            ranks him outside {ENABLED_POSITIONS.map((p) => `${p}${1.5 * STARTER_RANK[p]}`).join(", ")}.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <select value={price} onChange={(e) => setPrice(e.target.value as PriceFilter)} className={selectClass}>
            <option value="cheap">Cheap only</option>
            <option value="all">All prices</option>
          </select>
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
          <select value={rookies} onChange={(e) => setRookies(e.target.value as RookieFilter)} className={selectClass}>
            <option value="include">Unplayed rookies included</option>
            <option value="hide">Hide unplayed rookies</option>
            <option value="only">Unplayed rookies only</option>
          </select>
        </div>
      </div>
      <TierLegend rookies />
      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-[11px] font-semibold tracking-wider text-muted uppercase">
              <th className="px-3 py-2.5">#</th>
              <th className="px-3">Player</th>
              <th className="px-3">Score</th>
              <th className="px-3" title="Average share of the team's targets, carries and air yards, weighted by position">
                Opp. share
              </th>
              <th className="px-3">Age</th>
              <th className="px-3">Draft</th>
              <th
                className="px-3"
                title="RB: share of team receiving yards, final season. TE: target share, final season. WR: age at first season with 20% of team receiving yards."
              >
                College
              </th>
              <th className="px-3">Value</th>
              <th className="px-3">Owner</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <BoardTableRow key={row.player.id} row={row} rank={i + 1} players={players.data!} inSeason={inSeason} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const selectClass = "rounded border border-line bg-card px-2 py-1 text-ink";

/** League name, or a dropdown of the user's dynasty leagues when there's more than one. */
function LeagueSwitcher({
  current,
  leagues,
  onChange,
}: {
  current: League;
  leagues: League[];
  onChange: (leagueId: string) => void;
}) {
  if (leagues.length < 2) return <span>{current.name}</span>;
  return (
    <select
      aria-label="Switch league"
      value={current.league_id}
      onChange={(e) => onChange(e.target.value)}
      className="max-w-full cursor-pointer rounded border border-line bg-card px-2 py-1 text-lg font-medium text-ink"
    >
      {leagues.map((l) => (
        <option key={l.league_id} value={l.league_id}>
          {l.name}
        </option>
      ))}
    </select>
  );
}

function BoardTableRow({
  row,
  rank,
  players,
  inSeason,
}: {
  row: BoardRow;
  rank: number;
  players: PlayersMap;
  inSeason: boolean;
}) {
  const { player, usage, draft, college, value, score, tier, ownership, opening } = row;
  const openedBy = opening.holders.map((h) => players[h.playerId]?.name ?? h.playerId).join(", ");
  return (
    <tr className="border-b border-line align-middle last:border-b-0">
      <td className="px-3 py-2 font-mono text-muted tabular-nums">{rank}</td>
      <td className="px-3">
        <div className="flex items-center gap-3">
          <PlayerPhoto playerId={player.id} name={player.name} position={player.position} />
          <div>
            <div className="font-semibold">{player.name}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span className={`rounded px-1.5 text-[11px] font-semibold ${POSITION_TAG[player.position]}`}>
                {player.position}
              </span>
              {player.team}
              {player.injuryStatus && (
                <span className="rounded border border-line px-1 text-[10px] font-semibold uppercase">
                  {player.injuryStatus}
                </span>
              )}
            </div>
            {openedBy && (
              <div
                className="text-xs text-muted"
                title="Teammates ahead of him who are gone. Context only: the backtest found this didn't predict breakouts, so it isn't in the score."
              >
                {inSeason ? "Out ahead of him" : "Left ahead of him"}: {openedBy}
              </div>
            )}
          </div>
        </div>
      </td>
      <ScoreCell score={score} tier={tier} />
      <td className="px-3 font-mono tabular-nums">
        {usage ? (
          <>
            <div>{Math.round(usage.opportunityShare * 100)}%</div>
            <div className="text-xs text-muted">{usage.games} games</div>
          </>
        ) : (
          <Empty />
        )}
      </td>
      <td className="px-3 font-mono tabular-nums">{player.age ?? <Empty />}</td>
      <td className="px-3 font-mono tabular-nums">
        {draft ? (
          <>
            <div>
              Rd {draft.round}, #{draft.pick}
            </div>
            <div className="text-xs text-muted">{draft.season}</div>
          </>
        ) : (
          <Empty />
        )}
      </td>
      <td className="px-3 text-xs whitespace-nowrap">{college ? describeCollegeStat(college) : <Empty />}</td>
      <td className="px-3 font-mono tabular-nums">{value ? `${player.position}${value.positionRank}` : <Empty />}</td>
      <td className="px-3 whitespace-nowrap">
        <OwnershipBadge ownership={ownership} />
      </td>
    </tr>
  );
}

function OwnershipBadge({ ownership }: { ownership: Ownership }) {
  switch (ownership.kind) {
    case "available":
      return <span className="font-semibold text-accent">Available</span>;
    case "mine":
      return <span className="font-semibold text-mine">Mine</span>;
    case "rival":
      return <span className="text-muted">{ownership.ownerName}</span>;
  }
}
