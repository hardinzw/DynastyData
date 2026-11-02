# DynastyData

Finds dynasty fantasy football breakout candidates in your Sleeper leagues. It ranks RB, WR and TE by their share of the offense, draft capital, youth and college production, and shows how past breakouts scored before they happened.

## Stack

- **App:** Vite, React, TypeScript, TanStack Query, React Router, Tailwind
- **Worker:** Cloudflare Worker serving `/api/*` and the built app, with KV for caching
- **Data:** Sleeper (league data, players, weekly stats), FantasyCalc (dynasty trade values), nflverse (draft picks), sportsdataverse (college stats from ESPN play-by-play)

## Commands

```sh
npm run dev        # app and Worker together on a local server
npm test           # Vitest
npm run typecheck
npm run history    # rebuild public/data/breakout-history.json (see Breakout history)
npm run snapshot   # save this week's scores and dynasty prices (see Snapshots)
npm run deploy     # build and deploy to Cloudflare (creates the KV namespace on first deploy)
npm run cf-typegen # regenerate worker-configuration.d.ts after editing wrangler.jsonc
```

## Layout

```
shared/          types and position config used by both the app and the Worker
worker/          /api routes and the daily cron job
  sources/       one module per upstream: sleeper, fantasycalc, nflverse, college
src/
  api/           Sleeper calls made from the browser, and calls to the Worker
  hooks/         TanStack Query hooks
  lib/           pure logic: scoring, usage shares, breakout score, board assembly, history
  routes/        Home, Leagues, Board, History
public/data/     breakout-history.json, built by npm run history
data/snapshots/  weekly scores and prices, built by npm run snapshot
```

## Worker API

| Route | Source | Cache |
|---|---|---|
| `/api/players` | Sleeper `/players/nfl`, trimmed to QB/RB/WR/TE | KV, refreshed daily by cron |
| `/api/draft` | nflverse draft picks joined to Sleeper ids | KV, refreshed daily by cron |
| `/api/college` | College seasons before each player's rookie year, by Sleeper id | KV, refreshed daily by cron; each finished college season kept forever |
| `/api/weeks/:season/:week` | Sleeper weekly stats with each player's team | KV; final weeks kept forever, current week 10 min |
| `/api/values?numQbs=&numTeams=&ppr=` | FantasyCalc dynasty values | KV, 6 hours |

The weekly stats endpoint is undocumented, so Sleeper can change it without notice. All calls to it are in `worker/sources/sleeper.ts`.

College stats come from sportsdataverse's `espn_cfb_usage_players` release on GitHub (free, no key, FBS games only, 2004 on). Players are joined by ESPN id, which ESPN keeps from college to the NFL, falling back to name. About 86% of board-eligible players match; most of the rest played at FCS schools.

## Adding QB

QB data is already ingested. Add `"QB"` to `ENABLED_POSITIONS` in `shared/positions.ts`, then review the QB thresholds in `src/lib/breakout.ts` and the QB case in `opportunityShare` in `src/lib/usage.ts`.

## Breakout model

`src/lib/breakout.ts` holds the model. The score is a weighted average of four signals, each 0 to 1, with weights from the backtest:

| Signal | Weight | What it measures |
|---|---|---|
| Usage level | 0.5 | Average opportunity share over every game so far: RB 0.6 carry share + 0.4 target share; WR/TE 0.7 target share + 0.3 air-yard share |
| Draft capital | 0.3 | Draft pick, falling off smoothly (pick 1 = 1.0, pick 32 = 0.77, pick 100 = 0.43) |
| Youth | 0.1 | Full score up to RB 24, WR 24, TE 25, falling to 0 by RB 27, WR 28, TE 29 |
| College | 0.1 | RB: share of team receiving yards, final college season. TE: target share, final season. WR: age at first season with 20% of team receiving yards |

A signal with no data (usage for a rookie before his first game, college for an FCS player) is left out of the average instead of scored as 0.

The college stats are the ones that predicted NFL starter seasons beyond draft pick across the 2020-23 draft classes. WR college market share added nothing once draft pick was known. In the backtest, college is roughly neutral (it moves held-out AUC by less than 0.005), so it gets a small weight.

Tried and left out of the score:

- **Rising usage.** Nine designs: recent games against earlier games, snap-share jumps, slopes, and usage left behind by teammates. None beat chance, and season-long usage predicted better than recent usage.
- **Market lag** (usage rank above trade-value rank) scored near chance.
- **Opportunity opened up**: share held by teammates ahead of him who are hurt (missed the team's last two games) or, in the offseason, moved teams. It scored below chance, so the board shows it as a note under the player's name but doesn't score it. Logic is in `src/lib/opening.ts`.
- **Efficiency** (yards per target, per snap, catch rate, YAC and others) added nothing beyond usage.

The board leaves out players already established as starters (this season or last) and players over the age caps in `MAX_BREAKOUT_AGE` (RB 25, WR 26, TE 27). The backtest uses the same rules, so the board scores the same group of players the weights were tuned on.

### What a score means

Breakout rates by score among cheap players in the backtest (2021-2025, both test modes, about 2,200 player-seasons):

| Score | Label | Broke out |
|---|---|---|
| 75+ | Strong | 21% (about 1 in 5) |
| 60-74 | Watch | 7% (about 1 in 14) |
| 40-59 | Long shot | 1.7% (about 1 in 60) |
| Under 40 | Unlikely | 0 of 1,257 |

About 2% of cheap players break out overall, so a Strong score is roughly 10 times the base rate. The score ranks players; it isn't a probability. These rates are measured on the same seasons the weights were tuned on, so they're slightly optimistic. The tiers are in `SCORE_TIERS`.

Rookies who haven't played get their own labels, because they break out on a different timeline. Their scores are unchanged:

| Score | Label | Broke out in year one (2022-25 classes) | Within three years (2022-23 classes) |
|---|---|---|---|
| 60+ | Rookie prospect | 6 of 74 (about 1 in 12) | 18 of 44 (about 4 in 10) |
| Under 60 | Rookie long shot | 3 of 177 (about 1 in 60) | 6 of 82 (about 1 in 14) |

Veterans with no games this season have no such label yet. Their usage is left out of the score too, which the backtest doesn't cover, so an injured veteran's score can run high.

## Breakout history

The Breakout history page (`/history`) lists every RB, WR and TE who wasn't a starter and became one, with the score today's model gives him from what was known at the time: either the offseason before, or after week 8 of that season. It includes expensive players and players over the age cap, and the current season so far.

The data is a static file built from the backtest data, since computing it in the browser would mean downloading every week of six seasons:

```sh
npm run history   # writes public/data/breakout-history.json
```

Rerun it during the season to update the current season's breakouts, after each season, and after any model change, then deploy.

## Snapshots

The backtest can only compare the model with redraft ADP, because FantasyCalc has no price history and the board's dynasty prices aren't saved anywhere. Snapshots build that history, and give the model a test on seasons it wasn't tuned on.

```sh
npm run snapshot               # writes data/snapshots/<season>-wk<week>.json
npm run snapshot -- --dry-run  # prints the summary without writing anything
```

Run it once a week during the regular season, after Monday's game and before Thursday's, then commit the file. It covers the weeks before Sleeper's current week, so it can't pick up a week in progress. Sleeper's week doesn't change the moment Monday's game ends, so check that the output says the week you expect.

Each file holds every board player's score, tier and signals, plus every FantasyCalc price in 12-team PPR for 1QB and superflex. Existing files are never overwritten, so the commit date shows the scores came before the results.

## Backtest

```sh
npm run backtest                 # both modes
npm run backtest -- in-season    # score after week 8, check weeks 9-18 (2022-2025)
npm run backtest -- next-season  # score after a season, check the next one (2021→22 to 2024→25)
```

- **Breakout** means finishing as a starter by PPR points per game (RB24, WR24, TE12) in the outcome window.
- **Who gets scored:** RB/WR/TE who played before the cutoff and weren't already starters, either before the cutoff or in the prior season. Next-season tests also score the incoming rookie class, since the draft happens before the cutoff (August 1).
- **No hindsight:** each player's age, team and market price are taken as of the cutoff. The player list includes players who have since left the league. One exception: there's no dated roster history, so in next-season tests a player's team is his team in his first game of the next season, standing in for his August roster.
- **Market price:** Sleeper's point-in-time redraft ADP, from its projections endpoint. FantasyCalc has no historical values, and Sleeper has no usable ADP before 2022.
- **"Cheap" players** have positional ADP past 1.5× starter rank (RB/WR 36, TE 18) or no ADP. These are the players the app is meant to find, so weights are tuned on this group, leaving one season out at a time.

Logic is in `src/lib/backtest.ts` and `src/lib/production.ts`. The runner is `scripts/backtest.ts`. Downloads are cached in `.cache/backtest`.
