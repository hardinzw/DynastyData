// Backtests the breakout score against past seasons.
//
//   npm run backtest                  # both modes
//   npm run backtest -- in-season     # score after week 8, check weeks 9-18
//   npm run backtest -- next-season   # score after the season, check the next season
//
// Downloads are cached in .cache/backtest (see backtest-data.ts).

import type { DraftMap, PlayersMap } from "../shared/types.ts";
import { combine, DEFAULT_WEIGHTS, SCORE_TIERS, scoreTier, type SignalKey, type Weights } from "../src/lib/breakout.ts";
import {
  buildSamples,
  evaluate,
  evaluateScores,
  signalAucs,
  topResult,
  tuneWeights,
  weightGrid,
  type Evaluation,
  type Fold,
  type Sample,
} from "../src/lib/backtest.ts";
import { IMPACT_PPG, REPLACEMENT_PPG } from "../src/lib/production.ts";
import { ENABLED_POSITIONS, type Position } from "../shared/positions.ts";
import { inSeasonFolds, loadPlayersAndDraft, nextSeasonFolds } from "./backtest-data.ts";

const f2 = (n: number) => (Number.isNaN(n) ? "  —  " : n.toFixed(3));
const pctStr = (n: number) => `${Math.round(n * 100)}%`.padStart(4);

function formatWeights(w: Weights): string {
  return Object.entries(w)
    .map(([k, v]) => `${k} ${v.toFixed(1)}`)
    .join(", ");
}

function evalLine(label: string, e: Evaluation): string {
  return `${label.padEnd(26)} n=${String(e.samples).padStart(4)}  breakouts=${String(e.breakouts).padStart(3)} (${pctStr(e.breakouts / e.samples)})  AUC ${f2(e.auc)}  top-20 hit rate ${pctStr(e.precisionAt20)}`;
}

const positionLine = (ppg: Record<Position, number>) => ENABLED_POSITIONS.map((p) => `${p} ${ppg[p]}`).join(", ");
const marketScore = (s: Sample) => (s.adp == null ? 0 : 1000 - s.adp);
const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;

function compareWithMarket(folds: Fold[], samples: Sample[][]) {
  const avg = (f: (s: Sample[]) => Evaluation) => samples.map(f);
  const score = avg((s) => evaluate(s, DEFAULT_WEIGHTS));
  const market = avg((s) => evaluateScores(s.map(marketScore), s.map((x) => x.brokeOut)));
  for (const [i, f] of folds.entries()) {
    console.log(evalLine(f.label, score[i]!), ` | ADP alone: AUC ${f2(market[i]!.auc)}, top-20 ${pctStr(market[i]!.precisionAt20)}`);
  }
}

/** How each method's top 20 finished, on the graded measure and the Impact rung. */
function compareTop20(samples: Sample[][]) {
  const signal = (key: SignalKey) => (s: Sample) => s.signals.find((x) => x.key === key)!.score;
  const methods: [string, (s: Sample) => number][] = [
    ["Model", (s) => combine(s.signals, DEFAULT_WEIGHTS)],
    ["Usage alone", signal("usageLevel")],
    ["Draft pick alone", signal("draftCapital")],
    ["ADP alone", marketScore],
  ];
  console.log(
    `\nTop 20 by each method, cheap players. Credit = average PPG above ${positionLine(REPLACEMENT_PPG)}. Impact = ${positionLine(IMPACT_PPG)} or better:`,
  );
  for (const [label, score] of methods) {
    const results = samples.map((s) => topResult(s, score));
    const credits = results.map((r) => r.credit);
    const impacts = results.map((r) => r.impact);
    console.log(
      `  ${label.padEnd(18)} credit ${f2(mean(credits))} [${credits.map(f2).join(" ")}]  Impact hits ${impacts.reduce((a, b) => a + b, 0)} [${impacts.join(" ")}]`,
    );
  }
}

/**
 * Players who missed the feature window, scored on the season before it. Reported apart
 * from the main numbers: some have left the league, so they'd inflate AUC with easy misses.
 */
function reportMissedSeason(samples: Sample[][]) {
  const missed = samples.flat().filter((s) => s.cheap && s.usageFromLastSeason);
  console.log("\nCheap players with no games in the window, scored on the season before it:");
  for (const tier of SCORE_TIERS) {
    const group = missed.filter((s) => scoreTier(Math.round(combine(s.signals, DEFAULT_WEIGHTS))).label === tier.label);
    console.log(`  ${tier.label.padEnd(10)} n=${String(group.length).padStart(4)}  breakouts ${group.filter((s) => s.brokeOut).length}`);
  }
}

function runMode(name: string, folds: Fold[], players: PlayersMap, draft: DraftMap) {
  console.log(`\n=== ${name} ===`);
  const samples = folds.map((f) => buildSamples(f, players, draft));
  const all = samples.map((s) => s.filter((x) => !x.usageFromLastSeason));
  const cheap = all.map((s) => s.filter((x) => x.cheap));
  const keys = Object.keys(DEFAULT_WEIGHTS) as SignalKey[];

  console.log("\nAll players who weren't already starters, default weights:");
  compareWithMarket(folds, all);

  console.log("\nCheap players only (positional ADP past RB/WR 36, TE 18, or unranked), default weights:");
  compareWithMarket(folds, cheap);

  console.log("\nAUC of each signal alone, cheap players:");
  console.log("".padEnd(26) + keys.map((k) => k.padStart(13)).join(""));
  for (const [i, s] of cheap.entries()) {
    const aucs = signalAucs(s);
    console.log(folds[i]!.label.padEnd(26) + keys.map((k) => f2(aucs[k]).padStart(13)).join(""));
  }

  // Leave one season out: tune on the others, report on the held-out one.
  const grid = weightGrid(keys, 0.1);
  console.log(`\nTuned on cheap players, leave-one-season-out (${grid.length} weightings tried):`);
  const heldOut: Evaluation[] = [];
  for (const [i, s] of cheap.entries()) {
    const { weights } = tuneWeights(cheap.filter((_, j) => j !== i), grid);
    const e = evaluate(s, weights);
    heldOut.push(e);
    console.log(evalLine(folds[i]!.label, e), " ", formatWeights(weights));
  }
  const defaults = cheap.map((s) => evaluate(s, DEFAULT_WEIGHTS));
  const market = cheap.map((s) => evaluateScores(s.map(marketScore), s.map((x) => x.brokeOut)));
  const row = (label: string, list: Evaluation[]) =>
    console.log(`  ${label.padEnd(22)} AUC ${f2(mean(list.map((e) => e.auc)))}  top-20 hit rate ${pctStr(mean(list.map((e) => e.precisionAt20)))}`);
  console.log("\nMeans over seasons, cheap players:");
  row("ADP alone", market);
  row("Default weights", defaults);
  row("Tuned (held out)", heldOut);
  compareTop20(cheap);
  reportMissedSeason(samples);
  const best = tuneWeights(cheap, grid);
  console.log(`Best weights on all seasons: ${formatWeights(best.weights)} (mean AUC ${f2(best.meanAuc)})`);

  printTop(folds.at(-1)!.label, cheap.at(-1)!, best.weights);
}

function printTop(label: string, samples: Sample[], weights: Weights) {
  console.log(`\nTop 15 cheap players for ${label} with those weights (✓ = broke out):`);
  const scored = samples
    .map((s) => ({ s, score: combine(s.signals, weights) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
  for (const { s, score } of scored) {
    const out = s.outcome ? `${s.outcome.position}${s.outcome.posRank ?? "—"} ${s.outcome.ppg.toFixed(1)} ppg` : "didn't play";
    const adp = s.adp == null ? "unranked" : `ADP ${s.player.position}${s.adp}`;
    console.log(
      `  ${s.brokeOut ? "✓" : " "} ${score.toFixed(0).padStart(3)}  ${s.player.name.padEnd(24)} ${s.player.position} age ${String(s.player.age ?? "?").padEnd(3)} ${adp.padEnd(9)} → ${out}`,
    );
  }
}

async function main() {
  const mode = process.argv[2];
  console.log("Loading data (cached after the first run)…");
  const { players, draft } = await loadPlayersAndDraft();

  if (!mode || mode === "in-season") {
    runMode("In-season: score after week 8, breakout = starter in weeks 9-18", await inSeasonFolds(), players, draft);
  }
  if (!mode || mode === "next-season") {
    runMode("Next season: score after the season, breakout = starter the next season", await nextSeasonFolds(), players, draft);
  }
}

await main();
