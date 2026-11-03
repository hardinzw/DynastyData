// Fits the numbers behind the board's PPG projection and checks them on held-out seasons.
//
//   npm run projection
//
// Prints PROJECTION_FIT for src/lib/projection.ts. Paste it in after any change to the inputs.

import { buildSamples } from "../src/lib/backtest.ts";
import { leastSquares, quantile } from "../src/lib/fit.ts";
import { production } from "../src/lib/production.ts";
import { PROJECTION_RANGE, shrunkPpg } from "../src/lib/projection.ts";
import { loadPlayersAndDraft, longTermFolds } from "./backtest-data.ts";

const HORIZON = 3;
const POSITIONS = ["RB", "WR", "TE"] as const;
type Pos = (typeof POSITIONS)[number];

interface Row {
  position: Pos;
  rookie: boolean;
  cutoff: number;
  cheap: boolean;
  draft: number;
  /** PPG before the cutoff, and the games behind it. */
  games: number;
  ppg: number;
  /** PPG in each season of the window, or null with too few games to count. */
  seasons: (number | null)[];
}

const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;

const { players, draft } = await loadPlayersAndDraft();
const folds = await longTermFolds(HORIZON);
const rows: Row[] = folds.flatMap(({ fold, seasons, hasAdp }) => {
  const before = production(fold.featureWeeks, 1);
  return buildSamples(fold, players, draft)
    .filter((s) => !s.usageFromLastSeason)
    .map((s) => {
      const past = before.get(s.player.id);
      return {
        position: s.player.position as Pos,
        rookie: !s.input.usage,
        cutoff: Number(fold.cutoffDate.slice(0, 4)),
        cheap: hasAdp && s.cheap,
        draft: s.signals.find((x) => x.key === "draftCapital")!.score,
        games: past?.games ?? 0,
        ppg: past?.ppg ?? 0,
        seasons: seasons.map((season) => {
          const finish = season.get(s.player.id);
          return finish?.posRank != null ? finish.ppg : null;
        }),
      };
    });
});

const averagePpg = Object.fromEntries(
  POSITIONS.map((p) => [p, mean(rows.filter((r) => r.position === p && !r.rookie).map((r) => r.ppg))]),
) as Record<Pos, number>;

const featuresOf = (r: Row) => (r.rookie ? [r.draft] : [shrunkPpg(r.ppg, r.games, averagePpg[r.position]), r.draft]);
const predict = (beta: number[], f: number[]) => f.reduce((sum, v, i) => sum + v * beta[i + 1]!, beta[0]!);

/** Coefficients for PPG in seasons he played enough to count, and for reaching that bar. */
function fit(group: Row[]) {
  const counted = group.flatMap((r) => r.seasons.filter((s) => s != null).map((ppg) => ({ r, ppg })));
  const all = group.flatMap((r) => r.seasons.map((ppg) => ({ r, played: ppg != null ? 1 : 0 })));
  return {
    ppg: leastSquares(counted.map((c) => featuresOf(c.r)), counted.map((c) => c.ppg)),
    plays: leastSquares(all.map((a) => featuresOf(a.r)), all.map((a) => a.played)),
  };
}

// Held out: train only on cutoffs whose seasons don't overlap the test window.
function heldOut(group: Row[]) {
  const out: { r: Row; ppg: number | null; projected: number; plays: number }[] = [];
  for (const cutoff of new Set(group.map((r) => r.cutoff))) {
    const betas = fit(group.filter((r) => Math.abs(r.cutoff - cutoff) >= HORIZON));
    for (const r of group.filter((x) => x.cutoff === cutoff)) {
      for (const ppg of r.seasons) out.push({ r, ppg, projected: predict(betas.ppg, featuresOf(r)), plays: predict(betas.plays, featuresOf(r)) });
    }
  }
  return out;
}

const output: Record<string, unknown> = {};
for (const position of POSITIONS) {
  for (const rookie of [false, true]) {
    const group = rows.filter((r) => r.position === position && r.rookie === rookie);
    const name = `${position} ${rookie ? "rookies" : "veterans"}`;
    const test = heldOut(group);
    const counted = test.filter((t) => t.ppg != null) as ((typeof test)[number] & { ppg: number })[];
    const errors = counted.map((t) => t.ppg - t.projected);
    const low = quantile(errors, PROJECTION_RANGE[0]);
    const high = quantile(errors, PROJECTION_RANGE[1]);
    const average = mean(counted.map((t) => t.ppg));
    const r2 = 1 - mean(errors.map((e) => e * e)) / mean(counted.map((t) => (t.ppg - average) ** 2));
    const mae = mean(errors.map(Math.abs));
    const baseMae = mean(counted.map((t) => Math.abs(t.ppg - average)));
    const cheap = counted.filter((t) => t.r.cheap);
    const inRange = (list: typeof counted) => mean(list.map((t) => Number(t.ppg >= t.projected + low && t.ppg <= t.projected + high)));
    const sorted = [...test].sort((a, b) => a.plays - b.plays);
    const third = Math.floor(sorted.length / 3);
    const plays = [sorted.slice(0, third), sorted.slice(third, 2 * third), sorted.slice(2 * third)].map(
      (t) => `${Math.round(100 * mean(t.map((x) => x.plays)))}/${Math.round(100 * mean(t.map((x) => Number(x.ppg != null))))}`,
    );

    console.log(`\n${name}: ${group.length} players, ${counted.length} counted seasons`);
    console.log(`  R2 ${r2.toFixed(3)}  typical miss ${mae.toFixed(2)} (always guessing the average: ${baseMae.toFixed(2)})`);
    console.log(`  Inside the range: ${Math.round(100 * inRange(counted))}%`);
    if (cheap.length) {
      console.log(`  Cheap, 2022-23 cutoffs: ${cheap.length} seasons, actual minus projected ${mean(cheap.map((t) => t.ppg - t.projected)).toFixed(2)}, inside the range ${Math.round(100 * inRange(cheap))}%`);
    }
    console.log(`  Chance of counting, projected/actual percent by thirds: ${plays.join("  ")}`);

    const betas = fit(group);
    output[`${position}${rookie ? "rookie" : "veteran"}`] = {
      ppg: betas.ppg.map((b) => Number(b.toFixed(3))),
      plays: betas.plays.map((b) => Number(b.toFixed(4))),
      range: [Number(low.toFixed(2)), Number(high.toFixed(2))],
    };
  }
}

console.log("\nAVERAGE_PPG:", JSON.stringify(Object.fromEntries(POSITIONS.map((p) => [p, Number(averagePpg[p].toFixed(2))]))));
console.log("PROJECTION_FIT:", JSON.stringify(output, null, 2));
