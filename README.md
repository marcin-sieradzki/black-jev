# Black Jev

Jev, TypeSafe AI's decision model, playing Blackjack against a simulated dealer, one move every 5 seconds, but only while someone has the page open. Its bankroll and every round's history live in Upstash, so every device sees the same Jev and it picks up where it stopped. Hosting is free: Vercel Hobby and Upstash's free plan.

The page is built with Perron, Mylder's design system (`@mylder/perron`): its tokens, fonts and components, in light and dark.

## Jev

Jev isn't a chat model. Given a state and a typed question, it returns one of the options it was offered, a probability for each and a confidence. That's what the table asks it at every decision: here is the hand, the dealer's upcard and the bankroll; pick one of the legal moves. The page shows the answer the way Jev gives it, with a bar per option.

- **With `TYPESAFE_API_KEY` set**, every decision is a call to Jev's System One API (`POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`), made on the server so the key never reaches a browser. The request shape follows the published guides; TypeSafe's official reference wasn't reachable when this was written, so `src/engine/jev.ts` reads the answer defensively. If a call fails, times out (2.5 s) or answers with a move that isn't legal, the stand-in decides that move and the page says why.
- **Without a key**, a local stand-in plays Jev: perfect basic strategy for these rules, with a flatter distribution on close calls such as 16 against a 10. It never takes insurance.

## The rules

A common six-deck Las Vegas Strip game, set in `src/engine/rules.ts`:

| Rule | This table |
| --- | --- |
| Shoe | 6 decks, reshuffled when the cut card comes out at 75% |
| Dealer | stands on soft 17 (S17); peeks for blackjack under an ace or ten |
| Blackjack | pays 3:2; blackjack against a dealer blackjack pushes |
| Insurance | offered under an ace for half the bet, pays 2:1 |
| Double | on any first two cards, also after a split |
| Split | pairs of equal value, up to 4 hands; aces split once and get one card each |
| 21 after a split | counts as 21, not blackjack, and pays 1:1 |
| Surrender | late: on the first two cards, after the dealer's peek, for half the bet back |
| Bet | flat $10 from a $1,000 bankroll; Jev can only double or split when it can cover the extra bet |

Over 300,000 simulated rounds the stand-in loses 0.35% of its bets, in line with basic strategy's house edge for this game (about 0.4%). When the bankroll can't cover a bet, Jev buys back in with the starting $1,000 and the rebuy is counted.

## How it plays only while watched

The server never runs a loop. A page asks `POST /api/round` for the round to show. If the last round has played out, the server deals a new one: it plays the whole round at once, with Jev's decisions, saves it to Upstash and returns its steps with a start time. Every page plays those steps back one every 5 seconds on the server's clock, so two devices watching see the same move, and asks again when the round ends. A short lock in Redis keeps two pages asking at the same moment from dealing two rounds.

A page stops asking when its tab is hidden or paused, so with no tab open Jev doesn't play and nothing is spent. A round takes about 7 moves, so about 36 seconds and 100 rounds an hour.

## Running it locally

```sh
npm install
npm run dev       # http://localhost:5173, with Redis in memory unless .env.local sets Upstash
npm run check     # type check, tests and production build
```

`STEP_MS=1000 npm run dev` speeds the table up while working on it. Put `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and `TYPESAFE_API_KEY` in `.env.local` to try the real services locally.

## Deploying for free

1. Import the repository as a new project on Vercel (Hobby). Vite is detected; the routes in `api/` become functions.
2. In the project, open **Storage**, add **Upstash for Redis** on the free plan and connect it to the project. Vercel sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`, which the code reads (as it does `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`).
3. Optionally add `TYPESAFE_API_KEY` under **Environment Variables** so the real Jev decides, and `STEP_MS` to change the pace.

Everything lives under `black-jev:` keys, so it can share a Redis database with another project.

### What it costs

| | Use | Free allowance |
| --- | --- | --- |
| Upstash commands | about 6 per round to deal it, plus 1 per watching page per round and 1 per history refresh: about 800 an hour of play with one page open | 500,000 a month, about 600 hours of play |
| Upstash storage | the table (a few KB) and the last 10,000 rounds (~8 MB) | 256 MB |
| Vercel functions | a few hundred calls an hour of play | well inside Hobby |
| Jev API (optional) | about 140 decisions an hour, ~300 tokens each | none: about $0.002 an hour at the published $0.042 per million input tokens |

The Jev price comes from third-party listings; TypeSafe's direct API is in early access.

## Routes

- `POST /api/round`: the round to show now, dealing a new one if the last has played out.
- `GET /api/history?limit=20`: the latest rounds, newest first (up to 100).
- `GET /api/history?format=jsonl`: every kept round as JSON Lines, oldest first, for download.

To start Jev over, delete the `black-jev:table` and `black-jev:history` keys in the Upstash console.

## Code

- `src/engine/`: the game, with no browser or server in it. `cards.ts` (cards, totals, the shoe), `rules.ts`, `strategy.ts` (basic strategy and the close calls), `jev.ts` (the decider interface, the TypeSafe client and the stand-in), `game.ts` (one round, move by move), `state.ts` (bankroll and running totals), `narrate.ts` (a line per move).
- `server/`: `round.ts` deals and saves rounds, `kv.ts` is Upstash or Redis in memory, `handlers.ts` turns them into HTTP responses.
- `api/`: the Vercel functions, one line each over `server/handlers.ts`.
- `src/web/`: the page. `useRound.ts` follows the table and pauses with the tab, `table.ts` folds moves into what's drawn, `App.tsx` draws it with Perron.
