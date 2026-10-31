// Builds the breakout history page's data from the backtest folds:
//
//   npm run history
//
// Writes public/data/breakout-history.json. Rerun after each season (and after changing
// the model) so the history shows the scores today's model would have given.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSamples } from "../src/lib/backtest.ts";
import { historyRows, type History } from "../src/lib/history.ts";
import { currentSeasonFold, inSeasonFolds, loadPlayersAndDraft, nextSeasonFolds } from "./backtest-data.ts";

const OUT_DIR = join(import.meta.dirname, "..", "public", "data");

const { players, draft, college } = await loadPlayersAndDraft();
const names = (id: string) => players[id]?.name ?? id;
const current = await currentSeasonFold();
const folds = [...(await inSeasonFolds()), ...(await nextSeasonFolds()), ...(current ? [current.fold] : [])];
const rows = [];
for (const fold of folds) {
  rows.push(...historyRows(fold, buildSamples(fold, players, draft, college, { ignoreAgeCap: true }), names));
}

const history: History = {
  generatedAt: new Date().toISOString().slice(0, 10),
  inProgress: current && { season: Number(current.fold.cutoffDate.slice(0, 4)), throughWeek: current.throughWeek },
  rows,
};
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "breakout-history.json"), JSON.stringify(history));
console.log(`Wrote ${rows.length} breakouts to public/data/breakout-history.json`);
