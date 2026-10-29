import assert from "node:assert/strict";
import { test } from "vitest";
import { localJev } from "../src/engine/jev.js";
import { freshState } from "../src/engine/state.js";
import { memoryKv } from "../server/kv.js";
import { KEYS, nextRound, type CurrentRound, type TableRecord } from "../server/round.js";
import { playback } from "../src/web/playback.js";

const STEP = 3000;

async function dealt(table?: Partial<TableRecord>): Promise<CurrentRound> {
  const kv = memoryKv(() => 0);
  if (table) await kv.set(KEYS.table, { state: freshState(1000, new Date(0)), shoe: "", current: null, ...table });
  const { current } = await nextRound(kv, localJev, { now: 0, stepMs: STEP });
  assert.ok(current);
  return current;
}

const at = (round: CurrentRound, step: number) => round.startedAt + step * round.stepMs;
const settleStep = (round: CurrentRound) => round.steps.findIndex((s) => s.type === "settle");

test("with no round yet the table is empty and nothing is counting down", () => {
  const shown = playback(null, 0);
  assert.equal(shown.step, -1);
  assert.deepEqual(shown.table.hands, []);
  assert.equal(shown.nextMoveAt, null);
  assert.equal(shown.state, null);
  assert.equal(shown.ended, false);
});

test("each step shows for one step's time, and the countdown runs to the next", async () => {
  const round = await dealt();
  assert.equal(playback(round, at(round, 0)).step, 0);
  const midway = playback(round, at(round, 2) + STEP / 2);
  assert.equal(midway.step, 2);
  assert.equal(midway.nextMoveAt, at(round, 3));
  // A page whose clock runs ahead of the round sees nothing yet, and counts down to the first step.
  const early = playback(round, round.startedAt - 1);
  assert.equal(early.step, -1);
  assert.equal(early.nextMoveAt, round.startedAt);
});

test("the hole card stays face down until the reveal", async () => {
  const round = await dealt();
  const deal = round.steps.findIndex((s) => s.type === "deal");
  const table = playback(round, at(round, deal)).table;
  assert.equal(table.holeHidden, true);
  assert.equal(table.dealer.length, 1);
  const end = playback(round, round.endsAt).table;
  assert.equal(end.holeHidden, false);
  assert.equal(end.net, round.record.net);
});

test("the result counts, and the round joins the history, only once it's on the table", async () => {
  const round = await dealt();
  const before = playback(round, at(round, settleStep(round) - 1));
  assert.equal(before.settled, false);
  assert.equal(before.state, round.before);
  assert.equal(before.pending, round.id);

  const after = playback(round, at(round, settleStep(round)));
  assert.equal(after.settled, true);
  assert.equal(after.state, round.after);
  assert.equal(after.pending, null);
});

test("a round that has played out stays on its last step until the next is dealt", async () => {
  const round = await dealt();
  assert.equal(playback(round, round.endsAt - 1).ended, false);
  const done = playback(round, round.endsAt + 10 * STEP);
  assert.equal(done.ended, true);
  assert.equal(done.step, round.steps.length - 1);
});

test("the dealer's lines before the bet stay in the round's log", async () => {
  const broke = freshState(1000, new Date(0));
  const round = await dealt({ state: { ...broke, bankroll: 5 } });
  const log = playback(round, round.endsAt).table.log;
  assert.match(log[0]!, /Jev is broke/);
  assert.match(log[1]!, /Jev bets/);
});
