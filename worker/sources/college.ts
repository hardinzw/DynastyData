import type { CollegeMap, CollegeSeason, PlayersMap } from "../../shared/types.ts";
import { nameKey, parseCsvLine } from "./nflverse.ts";

// Season usage tables built from ESPN play-by-play, published by sportsdataverse on GitHub.
// Free, no key. Each season is about 1 MB of CSV.
const usageUrl = (season: number) =>
  `https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_cfb_usage_players/usage_players_${season}.csv`;

const SKILL_GROUPS = new Set(["RB", "WR", "TE"]);
// Players are matched by name only if their last college season is this close to their rookie year.
const MAX_GAP_YEARS = 3;
// All-star games show up as teams like "National" with a handful of targets. Real teams have hundreds.
const MIN_TEAM_TARGETS = 100;

/** One college season row, keyed by ESPN id so it can be joined to Sleeper players later. */
export interface CollegeRow extends CollegeSeason {
  espnId: string;
  name: string;
  /** ESPN's position group: RB, WR or TE. */
  group: string;
}

/** Downloads one college season and keeps RB/WR/TE rows, with team totals for shares. */
export async function fetchCollegeSeason(season: number): Promise<CollegeRow[]> {
  const res = await fetch(usageUrl(season));
  if (!res.ok) throw new Error(`college usage ${season} returned ${res.status}`);
  const [header = "", ...lines] = (await res.text()).trim().split("\n");
  const cols = parseCsvLine(header.trimEnd());
  const at = (f: string[], name: string) => f[cols.indexOf(name)] ?? "";
  const num = (f: string[], name: string) => Number(at(f, name)) || 0;

  const rows = lines.map((l) => parseCsvLine(l.trimEnd())).filter((f) => f.length === cols.length);

  // Team totals come from every player, including QBs and others not kept below.
  const teams = new Map<string, { recYards: number; rushYards: number }>();
  for (const f of rows) {
    const t = teams.get(at(f, "pos_team")) ?? { recYards: 0, rushYards: 0 };
    t.recYards += num(f, "receiving_yards");
    t.rushYards += num(f, "rush_yards");
    teams.set(at(f, "pos_team"), t);
  }

  const out: CollegeRow[] = [];
  for (const f of rows) {
    const group = at(f, "position_group");
    if (!SKILL_GROUPS.has(group) || num(f, "team_targets") < MIN_TEAM_TARGETS) continue;
    const team = at(f, "pos_team");
    out.push({
      espnId: at(f, "player_id"),
      name: at(f, "player_name"),
      group,
      season,
      team,
      games: num(f, "games"),
      targets: num(f, "targets"),
      teamTargets: num(f, "team_targets"),
      recYards: num(f, "receiving_yards"),
      teamRecYards: teams.get(team)!.recYards,
      rushes: num(f, "rushes"),
      rushYards: num(f, "rush_yards"),
      teamRushYards: teams.get(team)!.rushYards,
      firstDowns: num(f, "first_downs"),
      teamFirstDowns: num(f, "team_first_downs"),
    });
  }
  return out;
}

const strip = ({ espnId: _id, name: _name, group: _group, ...season }: CollegeRow): CollegeSeason => season;

/**
 * Joins college seasons to Sleeper players. Uses Sleeper's ESPN id when it has one (ESPN
 * keeps the same id from college to the NFL). Otherwise matches on name, among players
 * whose last college season ended within a few years of the Sleeper player's rookie year,
 * and skips the name if it's still ambiguous. Only seasons before the rookie year are kept.
 */
export function buildCollegeMap(players: PlayersMap, seasons: CollegeRow[][]): CollegeMap {
  const byEspn = new Map<string, CollegeRow[]>();
  for (const row of seasons.flat()) {
    const list = byEspn.get(row.espnId) ?? [];
    list.push(row);
    byEspn.set(row.espnId, list);
  }
  const byName = new Map<string, string[]>();
  for (const [espnId, rows] of byEspn) {
    const key = nameKey(rows.at(-1)!.name);
    byName.set(key, [...(byName.get(key) ?? []), espnId]);
  }

  const map: CollegeMap = {};
  for (const p of Object.values(players)) {
    if (!SKILL_GROUPS.has(p.position)) continue;
    const before = (rows: CollegeRow[]) => rows.filter((r) => p.rookieYear == null || r.season < p.rookieYear);

    let rows = p.espnId ? before(byEspn.get(p.espnId) ?? []) : [];
    if (rows.length === 0 && p.rookieYear != null) {
      const candidates = (byName.get(nameKey(p.name)) ?? [])
        .map((id) => before(byEspn.get(id)!))
        .filter((r) => r.length > 0 && p.rookieYear! - r.at(-1)!.season <= MAX_GAP_YEARS);
      // Two players with the same name: keep the one from his Sleeper college, if that settles it.
      const college = p.college?.toLowerCase();
      const fromCollege = college ? candidates.filter((r) => r.at(-1)!.team.toLowerCase().startsWith(college)) : [];
      if (candidates.length === 1) rows = candidates[0]!;
      else if (fromCollege.length === 1) rows = fromCollege[0]!;
    }
    if (rows.length > 0) map[p.id] = rows.sort((a, b) => a.season - b.season).map(strip);
  }
  return map;
}
