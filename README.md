# DynastyData

Finds dynasty fantasy football breakout candidates in your Sleeper leagues. It ranks RB, WR and TE by their share of the offense and draft capital, and shows how past breakouts scored before they happened. College production is shown next to each player but isn't scored.

## Stack

- **App:** Vite, React, TypeScript, TanStack Query, React Router, Tailwind
- **Worker:** Cloudflare Worker serving `/api/*` and the built app, with KV for caching
- **Data:** Sleeper (league data, players, weekly stats), FantasyCalc (dynasty trade values), nflverse (draft picks), sportsdataverse (college stats from ESPN play-by-play, display only)

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

College stats come from sportsdataverse's `espn_cfb_usage_players` release on GitHub (free, no key, FBS games only, 2004 on). Players are joined by ESPN id, which ESPN keeps from college to the NFL, falling back to name. About 86% of board-eligible players match; most of the rest played at FCS schools. The College column shows RB share of team receiving yards, TE target share and WR breakout age. Logic is in `src/lib/college.ts`.

## Adding QB

QB data is already ingested. Add `"QB"` to `ENABLED_POSITIONS` in `shared/positions.ts`, then review the QB thresholds in `src/lib/breakout.ts` and the QB case in `opportunityShare` in `src/lib/usage.ts`.

## Breakout model

`src/lib/breakout.ts` holds the model. The score is a weighted average of two signals, each 0 to 1, with weights from the backtest:

| Signal | Weight | What it measures |
|---|---|---|
| Usage level | 0.6 | Average opportunity share over every game so far: RB 0.6 carry share + 0.4 target share; WR/TE 0.7 target share + 0.3 air-yard share |
| Draft capital | 0.4 | Draft pick, falling off smoothly (pick 1 = 1.0, pick 32 = 0.77, pick 100 = 0.43) |

A player with no games this season is scored on last season's usage, which the board marks. With no games last season either, usage is left out of the average instead of scored as 0, so his score is his draft pick alone.

Tried and left out of the score:

- **Rising usage.** Nine designs: recent games against earlier games, snap-share jumps, slopes, and usage left behind by teammates. None beat chance, and season-long usage predicted better than recent usage.
- **Market lag** (usage rank above trade-value rank) scored near chance.
- **Opportunity opened up**: share held by teammates ahead of him who are hurt (missed the team's last two games) or, in the offseason, moved teams. It scored below chance, so the board shows it as a note under the player's name but doesn't score it. Logic is in `src/lib/opening.ts`.
- **Youth and college production.** Together they moved AUC by under 0.01 and didn't improve the top 20, so they're out of the score. College stats are still shown on the board, and the age caps below still apply.
- **Efficiency** (yards per target, per snap, catch rate, YAC and others) added nothing beyond usage.

The board leaves out players already established as starters (this season or last) and players over the age caps in `MAX_BREAKOUT_AGE` (RB 25, WR 26, TE 27). The backtest uses the same rules, so the board scores the same group of players the weights were tuned on.

### What a score means

Breakout rates by score among cheap players with NFL games in the backtest (2021-2025, both test modes, about 2,000 player-seasons):

| Score | Label | Broke out |
|---|---|---|
| 75+ | Strong | 28% (14 of 50) |
| 60-74 | Watch | 10% (15 of 151) |
| 40-59 | Long shot | 1.9% (7 of 365) |
| Under 40 | Unlikely | 0.3% (4 of 1,421) |

About 2% of cheap players break out overall, so a Strong score is more than 10 times the base rate. The score ranks players; it isn't a probability. These rates are measured on the same seasons the weights were tuned on, so they're slightly optimistic. The tiers are in `SCORE_TIERS`.

Rookies who haven't played get their own labels, because they break out on a different timeline:

| Score | Label | Broke out in year one (2022-25 classes) | Within three years (2022-23 classes) |
|---|---|---|---|
| 50+ | Rookie prospect | 6 of 72 (about 1 in 12) | 15 of 40 (about 4 in 10) |
| Under 50 | Rookie long shot | 3 of 179 (about 1 in 60) | 9 of 86 (about 1 in 10) |

Veterans with no games this season or last show "No recent games" with no odds, and sort below everyone else.

Players scored on last season's usage show "Missed season" instead of a normal tier. They keep their score and place in the order, so a high score here should be read with caution. They're tested separately, because some of them have left the league and would inflate AUC with easy misses. None of the 531 cheap ones in the backtest broke out or reached Impact, and none scored 75 or higher.

## Breakout history

The Breakout history page (`/history`) lists every RB, WR and TE who wasn't a starter and became one, with the score today's model gives him from what was known at the time: either the offseason before, or after week 8 of that season. It includes expensive players and players over the age cap, and the current season so far.

The data is a static file built from the backtest data, since computing it in the browser would mean downloading every week of six seasons:

```sh
npm run history   # writes public/data/breakout-history.json
```

Rerun it during the season to update the current season's breakouts, after each season, and after any model change, then deploy.

### PPG projection

The board also shows projected PPG beside the score. It doesn't change the score or the order. It covers the next three seasons and separates two questions:

- **PPG when he plays:** expected PPG in seasons with 8+ games, with the range most similar players landed in (the middle 80%).
- **Chance he plays:** how often a season reaches 8 games.

Veterans are projected from past PPG and draft pick, by position. Rookies who haven't played use draft pick alone. Usage added nothing once past PPG was known, and college and age didn't help. Players with no games this season get no projection, unless they're unplayed rookies.

How far to trust it, on seasons held out of the fit (offseason cutoffs 2018-2023):

- It explains about 25-33% of the differences in PPG, and typically misses by 2-3.6 PPG. Always guessing the average misses by 2.7-4.75. So the ranges are wide: about 10 PPG for RB and WR, 7 for TE.
- The ranges covered 75-85% of cheap players' seasons.
- Among cheap players in the 2022-23 cutoffs, veterans and WR rookies came in about 1 PPG under the projection, TE rookies were on it, and RB rookies came in about 1.4 over. That's too few tests to correct for.
- It was fit on offseason scores, so a mid-season projection from a few games is less tested.

Past PPG improved the number, but it didn't pick better cheap players, which is why the score still ranks the board. Run `npm run projection` to refit and check it. The numbers are in `src/lib/projection.ts`.

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
npm run backtest                 # every mode
npm run backtest -- long-term    # score in the offseason, check the next 2 and 3 seasons (2018 cutoffs on)
npm run backtest -- in-season    # score after week 8, check weeks 9-18 (2022-2025)
npm run backtest -- next-season  # score after a season, check the next one (2021→22 to 2024→25)
```

- **Long-term** is the main test, since this is a dynasty app. Credit is added up across the seasons, and a breakout means being a starter in any of them. Results are split into veterans and rookies, because rookies have no usage yet: mixed together, they make usage look useless when it's the strongest veteran signal. Windows overlap, so the tests aren't independent. Cutoffs before 2022 have no ADP, so they can't say who was cheap and only count in the "not yet a starter" results.

- **Breakout** means finishing as a starter by PPR points per game (RB24, WR24, TE12) in the outcome window.
- **Graded credit** gives each player his PPG above replacement (RB 10, WR 11, TE 8), roughly where he stops being cheap at his position, and 0 below that or with too few games. The output averages it over each method's top 20, so it uses every result rather than only who crossed a line.
- **Impact** is a higher line for difference-makers: RB and WR 15+ PPG, TE 11+. Both lines are in `src/lib/production.ts`. They're measured but don't tune the weights, which still use AUC on breakouts.
- **Who gets scored:** RB/WR/TE who played before the cutoff and weren't already starters, either before the cutoff or in the prior season. Next-season tests also score the incoming rookie class, since the draft happens before the cutoff (August 1).
- **No hindsight:** each player's age, team and market price are taken as of the cutoff. The player list includes players who have since left the league. One exception: there's no dated roster history, so in next-season tests a player's team is his team in his first game of the next season, standing in for his August roster.
- **Market price:** Sleeper's point-in-time redraft ADP, from its projections endpoint. FantasyCalc has no historical values, and Sleeper has no usable ADP before 2022.
- **"Cheap" players** have positional ADP past 1.5× starter rank (RB/WR 36, TE 18) or no ADP. These are the players the app is meant to find, so weights are tuned on this group, leaving one season out at a time.

Logic is in `src/lib/backtest.ts` and `src/lib/production.ts`. The runner is `scripts/backtest.ts`. Downloads are cached in `.cache/backtest`.
