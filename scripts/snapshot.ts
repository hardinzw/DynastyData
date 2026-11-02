// Saves the board's scores and dynasty prices after the last finished week:
//
//   npm run snapshot               # writes data/snapshots/<season>-wk<week>.json
//   npm run snapshot -- --dry-run  # prints the summary without writing anything
//
// Run it once a week, after Monday's game and before Thursday's. A snapshot is never
// overwritten, so once committed, git shows the scores were made before the results.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ValuesMap, ValuesParams } from "../shared/types.ts";
import { buildSnapshot, formatKey } from "../src/lib/snapshot.ts";
import { fetchDraft } from "../worker/sources/nflverse.ts";
import { fetchValues } from "../worker/sources/fantasycalc.ts";
import { fetchPlayers, fetchState } from "../worker/sources/sleeper.ts";
import { loadWeeks } from "./backtest-data.ts";

const OUT_DIR = join(import.meta.dirname, "..", "data", "snapshots");
const LAST_WEEK = 18;
// Prices can't be collected later, so keep both common formats, not just one league's.
const FORMATS: ValuesParams[] = [
  { numQbs: 1, numTeams: 12, ppr: 1 },
  { numQbs: 2, numTeams: 12, ppr: 1 },
];

function currentCommit(): string {
  const commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim() !== "";
  return dirty ? `${commit}-dirty` : commit;
}

const dryRun = process.argv.includes("--dry-run");
const state = await fetchState();
const season = Number(state.season);
// Sleeper moves to the next week after Monday's game, so everything before it is finished.
const throughWeek = state.week - 1;
if (state.season_type !== "regular" || throughWeek < 1) {
  console.error(`No finished regular-season week to snapshot (${state.season_type}, week ${state.week}).`);
  process.exit(1);
}

const file = join(OUT_DIR, `${season}-wk${String(throughWeek).padStart(2, "0")}.json`);
if (existsSync(file) && !dryRun) {
  console.log(`${file} already exists. Snapshots are never overwritten.`);
  process.exit(0);
}

// Fresh, not the backtest's cached copies: teams and ages have to be as of today.
const players = await fetchPlayers();
const draft = await fetchDraft(players);
const values: Record<string, ValuesMap> = {};
for (const format of FORMATS) values[formatKey(format)] = await fetchValues(format);

const snapshot = buildSnapshot({
  takenAt: new Date().toISOString(),
  commit: currentCommit(),
  season,
  throughWeek,
  players,
  weeks: await loadWeeks(season, 1, throughWeek),
  priorWeeks: await loadWeeks(season - 1, 1, LAST_WEEK),
  draft,
  values,
});

const [mainFormat] = Object.keys(values);
const cheap = snapshot.rows.filter((r) => r.cheap[mainFormat!]);
console.log(`${season} through week ${throughWeek}, model ${snapshot.commit}`);
console.log(`${snapshot.rows.length} players scored, ${cheap.length} cheap in ${mainFormat}`);
for (const format of Object.keys(values)) console.log(`  ${format}: ${Object.keys(values[format]!).length} prices`);
console.log(`\nTop 10 cheap:`);
for (const r of cheap.slice(0, 10)) {
  console.log(`  ${String(r.score).padStart(3)}  ${r.tier.padEnd(9)} ${r.name.padEnd(24)} ${r.position} ${r.team ?? "—"}`);
}

if (dryRun) {
  console.log("\nDry run: nothing written.");
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(snapshot));
  console.log(`\nWrote ${file}. Commit it to lock in the date.`);
}
