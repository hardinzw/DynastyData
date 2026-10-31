import { isIngestedPosition } from "../../shared/positions.ts";
import type { DraftMap, PlayersMap } from "../../shared/types.ts";

const DRAFT_PICKS_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv";
// Earliest draft class that can still matter in a dynasty league.
const FIRST_SEASON = 2010;
// nflverse draft picks use Pro Football Reference team codes. Sleeper uses these instead.
const SLEEPER_TEAM: Record<string, string> = {
  GNB: "GB",
  KAN: "KC",
  LVR: "LV",
  OAK: "LV",
  NOR: "NO",
  NWE: "NE",
  SFO: "SF",
  TAM: "TB",
  SDG: "LAC",
  STL: "LAR",
};

/** Splits one CSV line, handling quoted fields. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

/** Lowercase name without punctuation or suffixes, for matching when gsis_id is missing. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, "");
}

/**
 * Downloads nflverse draft picks and maps them to Sleeper player ids. Joins on gsis_id,
 * then falls back to name + position + rookie year, since Sleeper often lacks gsis_id for rookies.
 */
export async function fetchDraft(players: PlayersMap): Promise<DraftMap> {
  const res = await fetch(DRAFT_PICKS_URL);
  if (!res.ok) throw new Error(`nflverse draft_picks returned ${res.status}`);
  const [header = "", ...rows] = (await res.text()).trim().split("\n");
  const cols = parseCsvLine(header.trimEnd());
  const idx = (name: string) => cols.indexOf(name);
  const iSeason = idx("season");
  const iRound = idx("round");
  const iPick = idx("pick");
  const iTeam = idx("team");
  const iGsis = idx("gsis_id");
  const iName = idx("pfr_player_name");
  const iPos = idx("position");

  const byGsis = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const p of Object.values(players)) {
    if (p.gsisId) byGsis.set(p.gsisId, p.id);
    byName.set(`${nameKey(p.name)}|${p.position}|${p.rookieYear ?? ""}`, p.id);
  }

  const draft: DraftMap = {};
  for (const row of rows) {
    const f = parseCsvLine(row.trimEnd());
    const season = Number(f[iSeason]);
    const position = f[iPos];
    if (season < FIRST_SEASON || !isIngestedPosition(position)) continue;
    const sleeperId =
      byGsis.get(f[iGsis] ?? "") ??
      byName.get(`${nameKey(f[iName] ?? "")}|${position}|${season}`);
    if (!sleeperId) continue;
    draft[sleeperId] = {
      season,
      round: Number(f[iRound]),
      pick: Number(f[iPick]),
      team: SLEEPER_TEAM[f[iTeam] ?? ""] ?? f[iTeam] ?? "",
    };
  }
  return draft;
}
