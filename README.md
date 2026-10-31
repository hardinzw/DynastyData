# DynastyData

Finds dynasty fantasy football breakout candidates in your Sleeper leagues. It ranks RB, WR and TE by rising usage, youth, draft capital, and how far their trade value lags their role.

## Stack

- **App:** Vite, React, TypeScript, TanStack Query, React Router, Tailwind
- **Worker:** Cloudflare Worker serving `/api/*` and the built app, with KV for caching
- **Data:** Sleeper (league data, players, weekly stats), FantasyCalc (dynasty trade values), nflverse (draft picks)

## Commands

```sh
npm run dev        # app and Worker together on a local server
npm test           # Vitest
npm run typecheck
npm run deploy     # build and deploy to Cloudflare (creates the KV namespace on first deploy)
npm run cf-typegen # regenerate worker-configuration.d.ts after editing wrangler.jsonc
```

## Layout

```
shared/          types and position config used by both the app and the Worker
worker/          /api routes and the daily cron job
  sources/       one module per upstream: sleeper, fantasycalc, nflverse
src/
  api/           Sleeper calls made from the browser, and calls to the Worker
  hooks/         TanStack Query hooks
  lib/           pure logic: scoring, usage shares, breakout score, board assembly
  routes/        Home, Leagues, Board
```

## Worker API

| Route | Source | Cache |
|---|---|---|
| `/api/players` | Sleeper `/players/nfl`, trimmed to QB/RB/WR/TE | KV, refreshed daily by cron |
| `/api/draft` | nflverse draft picks joined to Sleeper ids | KV, refreshed daily by cron |
| `/api/weeks/:season/:week` | Sleeper weekly stats with each player's team | KV; final weeks kept forever, current week 10 min |
| `/api/values?numQbs=&numTeams=&ppr=` | FantasyCalc dynasty values | KV, 6 hours |

The weekly stats endpoint is undocumented, so Sleeper can change it without notice. All calls to it are in `worker/sources/sleeper.ts`.

## Adding QB

QB data is already ingested. Add `"QB"` to `ENABLED_POSITIONS` in `shared/positions.ts`, then review the QB thresholds in `src/lib/breakout.ts` and the QB case in `opportunityShare` in `src/lib/usage.ts`.

## Breakout model

`src/lib/breakout.ts` holds the model: weights and thresholds for five signals (usage trend, usage level, youth, draft capital, market lag).

## Backtest

```sh
npm run backtest                 # both modes
npm run backtest -- in-season    # score after week 8, check weeks 9-18 (2022-2025)
npm run backtest -- next-season  # score after a season, check the next one (2021→22 to 2024→25)
```

- **Breakout** means finishing as a starter by PPR points per game (RB24, WR24, TE12) in the outcome window.
- **Who gets scored:** RB/WR/TE who played before the cutoff and weren't already starters, either before the cutoff or in the prior season.
- **No hindsight:** each player's age, team and market price are taken as of the cutoff. The player list includes players who have since left the league.
- **Market price:** Sleeper's point-in-time redraft ADP, from its projections endpoint. FantasyCalc has no historical values, and Sleeper has no usable ADP before 2022.
- **"Cheap" players** have positional ADP past 1.5× starter rank (RB/WR 36, TE 18) or no ADP. These are the players the app is meant to find, so weights are tuned on this group, leaving one season out at a time.

Logic is in `src/lib/backtest.ts` and `src/lib/production.ts`. The runner is `scripts/backtest.ts`. Downloads are cached in `.cache/backtest`.
