import assert from "node:assert/strict";
import { test } from "vitest";
import { createShoe, seededRandom } from "../src/engine/cards.js";
import { localJev } from "../src/engine/jev.js";
import { handleHistory, handleRound, type Env } from "../server/handlers.js";
import { memoryKv } from "../server/kv.js";
import { KEYS, nextRound, recentRounds, type TableRecord } from "../server/round.js";

const STEP = 5000;

test("a shoe carries on from its snapshot", () => {
  const shoe = createShoe(6, 0.75, seededRandom(3));
  for (let i = 0; i < 40; i++) shoe.draw();
  const resumed = createShoe(6, 0.75, seededRandom(99), shoe.snapshot());
  assert.equal(resumed.remaining, shoe.remaining);
  for (let i = 0; i < 20; i++) assert.deepEqual(resumed.draw(), shoe.draw());
});

test("a round is dealt once and every page asking before it ends gets the same one", async () => {
  let now = 1_000_000;
  const kv = memoryKv(() => now);
  const first = await nextRound(kv, localJev, { now, stepMs: STEP });
  assert.ok(first.current);
  assert.equal(first.current.id, 1);
  assert.equal(first.current.endsAt, now + first.current.steps.length * STEP);

  now += STEP;
  const again = await nextRound(kv, localJev, { now, stepMs: STEP });
  assert.deepEqual(again.current, first.current);

  now = first.current.endsAt;
  const second = await nextRound(kv, localJev, { now, stepMs: STEP });
  assert.equal(second.current?.id, 2);
  assert.equal(second.current?.before.bankroll, first.current.after.bankroll);
});

test("two pages asking at the same moment deal one round", async () => {
  const kv = memoryKv(() => 0);
  const [a, b] = await Promise.all([
    nextRound(kv, localJev, { now: 0, stepMs: STEP }),
    nextRound(kv, localJev, { now: 0, stepMs: STEP }),
  ]);
  const rounds = await recentRounds(kv, 10);
  assert.equal(rounds.length, 1);
  // One page dealt; the other found the lock taken and got nothing new to show yet.
  assert.equal([a.current, b.current].filter(Boolean).length, 1);
});

test("the bankroll and history add up over many rounds, and the history is newest first", async () => {
  let now = 0;
  const kv = memoryKv(() => now);
  let last = null;
  for (let i = 0; i < 300; i++) {
    const { current } = await nextRound(kv, localJev, { now, stepMs: STEP });
    assert.ok(current);
    last = current;
    now = current.endsAt;
  }
  const table = await kv.get<TableRecord>(KEYS.table);
  assert.equal(table?.state.stats.hands, 300);
  const rounds = await recentRounds(kv, 300);
  assert.deepEqual(rounds.map((r) => r.id).slice(0, 3), [300, 299, 298]);
  const rebought = table!.state.rebuys * table!.state.startingBankroll;
  assert.equal(table!.state.bankroll, 1000 + rebought + table!.state.stats.net);
  assert.equal(last?.after.bankroll, table?.state.bankroll);
});

test("the routes answer 503 without Upstash, and serve the round and history with it", async () => {
  const base: Env = { kv: null, decider: localJev, stepMs: STEP, now: () => 0 };
  assert.equal((await handleRound(base)).status, 503);

  const env = { ...base, kv: memoryKv(() => 0) };
  const round = await (await handleRound(env)).json();
  assert.equal(round.current.id, 1);
  const history = await (await handleHistory(env, new Request("http://x/api/history?limit=5"))).json();
  assert.equal(history.length, 1);
  const download = await handleHistory(env, new Request("http://x/api/history?format=jsonl"));
  assert.equal(download.headers.get("content-type"), "application/x-ndjson");
  assert.equal((await download.text()).trim().split("\n").length, 1);
});
