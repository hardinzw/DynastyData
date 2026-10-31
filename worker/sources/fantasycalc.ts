import type { ValuesMap, ValuesParams } from "../../shared/types.ts";

interface RawValue {
  player: { sleeperId?: string | null };
  value: number;
  overallRank: number;
  positionRank: number;
  trend30Day: number;
  maybeTier: number | null;
}

/** Dynasty trade values from FantasyCalc, keyed by Sleeper player id. */
export async function fetchValues({ numQbs, numTeams, ppr }: ValuesParams): Promise<ValuesMap> {
  const url = `https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=${numQbs}&numTeams=${numTeams}&ppr=${ppr}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FantasyCalc returned ${res.status}`);
  const raw = (await res.json()) as RawValue[];
  const values: ValuesMap = {};
  for (const v of raw) {
    if (!v.player.sleeperId) continue;
    values[v.player.sleeperId] = {
      value: v.value,
      overallRank: v.overallRank,
      positionRank: v.positionRank,
      trend30Day: v.trend30Day,
      tier: v.maybeTier,
    };
  }
  return values;
}
