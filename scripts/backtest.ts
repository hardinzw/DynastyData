// Backtests the breakout score against past seasons.
//
//   npm run backtest                  # both modes
//   npm run backtest -- in-season     # score after week 8, check weeks 9-18
//   npm run backtest -- next-season   # score after the season, check the next season
//
// Downloads are cached in .cache/backtest. Delete that folder to refetch.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DraftMap, PlayersMap, WeekData } from "../shared/types.ts";
import { combine, DEFAULT_WEIGHTS, type SignalKey, type Weights } from "../src/lib/breakout.ts";
import {
  buildSamples,
  evaluate,
  evaluateScores,
  signalAucs,
  tuneWeights,
  weightGrid,
  type Evaluation,
  type Fold,
  type Sample,
} from "../src/lib/backtest.ts";
import { fetchDraft } from "../worker/sources/nflverse.ts";
import { fetchPlayers, fetchWeek } from "../worker/sources/sleeper.ts";

const CACHE_DIR = join(import.meta.dirname, "..", ".cache", "backtest");
// Sleeper's projections have no usable ADP before 2022, so in-season folds start there.
// Next-season folds can start a year earlier because they price at the next season's ADP.
const IN_SEASON_SEASONS = [2022, 2023, 2024, 2025];
const NEXT_SEASON_SEASONS = [2021, 2022, 2023, 2024];
const LAST_WEEK = 18;
const IN_SEASON_CUTOFF_WEEK = 8;

async function cached<T>(name: string, load: () => Promise<T>): Promise<T> {
  const file = join(CACHE_DIR, `${name}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as T;
  const data = await load();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  return data;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function loadWeeks(season: number, from: number, to: number): Promise<WeekData[]> {
  return Promise.all(range(from, to).map((w) => cached(`week-${season}-${w}`, () => fetchWeek(season, w, true))));
}

/**
 * Sleeper's positional ADP as of a given week, from its projections. It's redraft PPR ADP,
 * not dynasty, but it's the only point-in-time market price available.
 */
function loadAdp(season: number, week: number): Promise<Record<string, number>> {
  return cached(`posadp-${season}-${week}`, async () => {
    const url = `https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=regular&position[]=RB&position[]=WR&position[]=TE`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    const rows = (await res.json()) as { player_id: string; stats: { pos_adp_dd_ppr?: number } }[];
    const UNRANKED = 1000;
    const adp: Record<string, number> = {};
    for (const r of rows) {
      const posAdp = r.stats.pos_adp_dd_ppr;
      if (posAdp && posAdp < UNRANKED) adp[r.player_id] = posAdp;
    }
    return adp;
  });
}

async function inSeasonFold(season: number): Promise<Fold> {
  const weeks = await loadWeeks(season, 1, LAST_WEEK);
  return {
    label: `${season} wk1-${IN_SEASON_CUTOFF_WEEK} → wk${IN_SEASON_CUTOFF_WEEK + 1}-${LAST_WEEK}`,
    priorWeeks: await loadWeeks(season - 1, 1, LAST_WEEK),
    featureWeeks: weeks.slice(0, IN_SEASON_CUTOFF_WEEK),
    outcomeWeeks: weeks.slice(IN_SEASON_CUTOFF_WEEK),
    cutoffDate: `${season}-11-01`,
    adp: await loadAdp(season, IN_SEASON_CUTOFF_WEEK + 1),
    minFeatureGames: 4,
    minOutcomeGames: 5,
  };
}

async function nextSeasonFold(season: number): Promise<Fold> {
  return {
    label: `${season} → ${season + 1}`,
    priorWeeks: await loadWeeks(season - 1, 1, LAST_WEEK),
    featureWeeks: await loadWeeks(season, 1, LAST_WEEK),
    outcomeWeeks: await loadWeeks(season + 1, 1, LAST_WEEK),
    // Scores are taken in the offseason, priced at the next season's week 1 ADP.
    cutoffDate: `${season + 1}-08-01`,
    adp: await loadAdp(season + 1, 1),
    minFeatureGames: 8,
    minOutcomeGames: 8,
  };
}

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

function runMode(name: string, folds: Fold[], players: PlayersMap, draft: DraftMap) {
  console.log(`\n=== ${name} ===`);
  const all = folds.map((f) => buildSamples(f, players, draft));
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
  const players = await cached("players-all", () => fetchPlayers({ includeFormer: true }));
  const draft = await cached("draft", () => fetchDraft(players));

  if (!mode || mode === "in-season") {
    const folds = [];
    for (const s of IN_SEASON_SEASONS) folds.push(await inSeasonFold(s));
    runMode("In-season: score after week 8, breakout = starter in weeks 9-18", folds, players, draft);
  }
  if (!mode || mode === "next-season") {
    const folds = [];
    for (const s of NEXT_SEASON_SEASONS) folds.push(await nextSeasonFold(s));
    runMode("Next season: score after the season, breakout = starter the next season", folds, players, draft);
  }
}

await main();
