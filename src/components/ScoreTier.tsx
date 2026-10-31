import { SCORE_TIERS, scoreTier, type ScoreTier } from "../lib/breakout.ts";

const TIER_TEXT: Record<ScoreTier["label"], string> = {
  Strong: "text-highlight",
  Watch: "text-ink",
  "Long shot": "text-muted",
  Unlikely: "text-muted/70",
};

const range = (i: number) => {
  const tier = SCORE_TIERS[i]!;
  const above = SCORE_TIERS[i - 1];
  return above ? `${tier.min}–${above.min - 1}` : `${tier.min}+`;
};

/** What each score band meant in the backtest, shown above the tables. */
export function TierLegend() {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs text-muted">
      {SCORE_TIERS.map((t, i) => (
        <span key={t.label}>
          <span className={`font-mono font-semibold ${TIER_TEXT[t.label]}`}>{range(i)}</span>{" "}
          <span className="font-semibold text-ink">{t.label}</span> · {t.odds}
        </span>
      ))}
      <span>(cheap players, backtest 2021–2025)</span>
    </div>
  );
}

export function ScoreCell({ score }: { score: number }) {
  const tier = scoreTier(score);
  return (
    <td className="px-3">
      <div className={`font-mono text-base font-semibold tabular-nums ${TIER_TEXT[tier.label]}`}>{score}</div>
      <div className="text-[11px] text-muted">{tier.label}</div>
    </td>
  );
}
