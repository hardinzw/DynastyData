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

`src/lib/breakout.ts` holds the v0 model: hand-picked weights and thresholds for five signals (usage trend, usage level, youth, draft capital, market lag). It hasn't been backtested yet.
