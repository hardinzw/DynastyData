import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ENABLED_POSITIONS, type Position } from "../../shared/positions.ts";
import { PlayerPhoto } from "../components/PlayerPhoto.tsx";
import { POSITION_TAG } from "../components/positionColors.ts";
import { ScoreCell, TierLegend } from "../components/ScoreTier.tsx";
import { Empty, ErrorMessage, Loading } from "../components/Status.tsx";
import { describeCollegeStat, scoreTier, SCORE_TIERS } from "../lib/breakout.ts";
import type { History as HistoryData, HistoryRow } from "../lib/history.ts";

// Built by `npm run history` and served as a static file.
async function fetchHistory(): Promise<HistoryData> {
  const res = await fetch("/data/breakout-history.json");
  if (!res.ok) throw new Error(`breakout history returned ${res.status}`);
  return res.json() as Promise<HistoryData>;
}

type Kind = HistoryRow["kind"];
type PriceFilter = "cheap" | "all";

const KIND_LABEL: Record<Kind, string> = {
  "next-season": "Scored the offseason before",
  "in-season": "Scored after week 8",
};

export default function History() {
  const history = useQuery({ queryKey: ["history"], queryFn: fetchHistory, staleTime: Infinity });
  const [kind, setKind] = useState<Kind>("next-season");
  const [season, setSeason] = useState<number | "all">("all");
  const [position, setPosition] = useState<Position | "ALL">("ALL");
  const [price, setPrice] = useState<PriceFilter>("all");
  const [tier, setTier] = useState<string>("all");

  const seasons = useMemo(
    () => [...new Set((history.data?.rows ?? []).filter((r) => r.kind === kind).map((r) => r.season))].sort((a, b) => b - a),
    [history.data, kind],
  );

  if (history.error) return <ErrorMessage error={history.error} />;
  if (!history.data) return <Loading label="Loading breakout history" />;
  const { inProgress } = history.data;

  const rows = history.data.rows
    .filter((r) => r.kind === kind)
    .filter((r) => season === "all" || r.season === season)
    .filter((r) => position === "ALL" || r.position === position)
    .filter((r) => price === "all" || r.cheap)
    .filter((r) => tier === "all" || scoreTier(r.score).label === tier)
    .sort((a, b) => b.season - a.season || b.score - a.score);
  const strong = rows.filter((r) => scoreTier(r.score).label === "Strong").length;

  const seasonLabel = (s: number) =>
    inProgress?.season === s ? `${s}, weeks 1–${inProgress.throughWeek}` : kind === "in-season" ? `${s}, weeks 9–18` : String(s);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Breakout history</h2>
          <p className="max-w-3xl text-xs text-muted">
            Every RB, WR and TE who wasn't a starter and became one (top 24 RB or WR, top 12 TE in points per game), with
            the score today's model gives him from what was known at the time. Includes expensive players and players
            over the board's age cap, which the board itself leaves out.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as Kind);
              setSeason("all");
            }}
            className={selectClass}
          >
            <option value="next-season">{KIND_LABEL["next-season"]}</option>
            <option value="in-season">{KIND_LABEL["in-season"]}</option>
          </select>
          <select
            value={season}
            onChange={(e) => setSeason(e.target.value === "all" ? "all" : Number(e.target.value))}
            className={selectClass}
          >
            <option value="all">All seasons</option>
            {seasons.map((s) => (
              <option key={s} value={s}>
                {seasonLabel(s)}
              </option>
            ))}
          </select>
          <select value={position} onChange={(e) => setPosition(e.target.value as Position | "ALL")} className={selectClass}>
            <option value="ALL">All positions</option>
            {ENABLED_POSITIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select value={price} onChange={(e) => setPrice(e.target.value as PriceFilter)} className={selectClass}>
            <option value="all">All prices</option>
            <option value="cheap">Cheap at the time</option>
          </select>
          <select value={tier} onChange={(e) => setTier(e.target.value)} className={selectClass}>
            <option value="all">All scores</option>
            {SCORE_TIERS.map((t) => (
              <option key={t.label} value={t.label}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <TierLegend />
      <p className="mb-2 text-sm">
        <span className="font-semibold">{rows.length}</span> breakouts
        {rows.length > 0 && (
          <span className="text-muted">
            {" "}
            · {strong} scored Strong ({Math.round((100 * strong) / rows.length)}%)
          </span>
        )}
      </p>
      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-[11px] font-semibold tracking-wider text-muted uppercase">
              <th className="px-3 py-2.5">Season</th>
              <th className="px-3">Player</th>
              <th className="px-3">Score then</th>
              <th className="px-3" title="Where he ranked on the cheap board at the time">
                Board rank
              </th>
              <th className="px-3" title="Average share of the team's targets, carries and air yards before the cutoff">
                Opp. share
              </th>
              <th className="px-3">Age</th>
              <th className="px-3">Draft</th>
              <th className="px-3">College</th>
              <th className="px-3" title="Sleeper positional ADP at the time">
                ADP then
              </th>
              <th className="px-3">Became</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <HistoryTableRow key={`${row.kind}-${row.season}-${row.playerId}`} row={row} seasonLabel={seasonLabel} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Updated {history.data.generatedAt}.</p>
    </section>
  );
}

const selectClass = "rounded border border-line bg-card px-2 py-1 text-ink";

function HistoryTableRow({ row, seasonLabel }: { row: HistoryRow; seasonLabel: (s: number) => string }) {
  const { usage, draft, college, outcome } = row;
  const notes = [
    !usage && "Rookie",
    row.overAgeCap && "Over age cap",
    row.openedBy.length > 0 && `${row.kind === "in-season" ? "Out" : "Left"} ahead of him: ${row.openedBy.join(", ")}`,
  ].filter(Boolean);
  return (
    <tr className="border-b border-line align-middle last:border-b-0">
      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-muted tabular-nums">{seasonLabel(row.season)}</td>
      <td className="px-3">
        <div className="flex items-center gap-3">
          <PlayerPhoto playerId={row.playerId} name={row.name} position={row.position} />
          <div>
            <div className="font-semibold">{row.name}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span className={`rounded px-1.5 text-[11px] font-semibold ${POSITION_TAG[row.position]}`}>{row.position}</span>
              {row.team}
            </div>
            {notes.length > 0 && <div className="text-xs text-muted">{notes.join(" · ")}</div>}
          </div>
        </div>
      </td>
      <ScoreCell score={row.score} />
      <td className="px-3 font-mono text-xs whitespace-nowrap tabular-nums">
        {row.cheapRank != null ? (
          <>
            <div className="text-sm">#{row.cheapRank}</div>
            <div className="text-muted">of {row.cheapPool}</div>
          </>
        ) : (
          <span className="text-muted">{row.overAgeCap ? "Over age cap" : "Not cheap"}</span>
        )}
      </td>
      <td className="px-3 font-mono whitespace-nowrap tabular-nums">
        {usage ? (
          <>
            <div>{Math.round(usage.share * 100)}%</div>
            <div className="text-xs text-muted">{usage.games} games</div>
          </>
        ) : (
          <Empty />
        )}
      </td>
      <td className="px-3 font-mono whitespace-nowrap tabular-nums">{row.age ?? <Empty />}</td>
      <td className="px-3 font-mono whitespace-nowrap tabular-nums">
        {draft ? (
          <>
            <div>
              Rd {draft.round}, #{draft.pick}
            </div>
            <div className="text-xs text-muted">{draft.season}</div>
          </>
        ) : (
          <span className="text-xs text-muted">Undrafted</span>
        )}
      </td>
      <td className="px-3 text-xs whitespace-nowrap">{college ? describeCollegeStat(college) : <Empty />}</td>
      <td className="px-3 font-mono whitespace-nowrap tabular-nums">
        {row.adp != null ? `${row.position}${row.adp}` : <span className="text-xs text-muted">Unranked</span>}
      </td>
      <td className="px-3 font-mono whitespace-nowrap tabular-nums">
        <div className="font-semibold">
          {row.position}
          {outcome.posRank}
        </div>
        <div className="text-xs text-muted">
          {outcome.ppg} ppg · {outcome.games} g
        </div>
      </td>
    </tr>
  );
}
