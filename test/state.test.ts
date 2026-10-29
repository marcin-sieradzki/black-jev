import assert from "node:assert/strict";
import { test } from "vitest";
import { freshState, settleRound, sitDown } from "../src/engine/state.js";
import { round } from "./helpers.js";

const now = new Date(0);
const seating = { startingBankroll: 1000, bet: 10, now };

test("the first round sits Jev down with the starting bankroll", () => {
  const { state, rebought } = sitDown(null, seating);
  assert.equal(state.bankroll, 1000);
  assert.equal(state.rebuys, 0);
  assert.equal(rebought, false);
});

test("Jev keeps its bankroll while it covers the bet", () => {
  const playing = { ...freshState(1000, now), bankroll: 10 };
  const { state, rebought } = sitDown(playing, seating);
  assert.equal(state, playing);
  assert.equal(rebought, false);
});

test("Jev buys back in with the starting bankroll when it can't cover the bet", () => {
  const broke = { ...freshState(1000, now), bankroll: 5 };
  const { state, rebought } = sitDown(broke, seating);
  assert.equal(rebought, true);
  assert.equal(state.bankroll, 1005);
  assert.equal(state.rebuys, 1);
});

test("settling a round counts it, numbers it and writes its line in the history", async () => {
  // Jev's 10 + 9 stands against the dealer's 10 + 7.
  const result = await round(["10", "10", "9", "7"]);
  const seated = sitDown(null, seating).state;
  const first = settleRound(seated, result, { bet: 10, now });
  assert.equal(first.record.id, 1);
  assert.equal(first.record.net, 10);
  assert.equal(first.record.bankroll, 1010);
  assert.equal(first.state.bankroll, 1010);
  assert.equal(first.state.stats.outcomes.win, 1);
  assert.equal(first.state.stats.wagered, 10);

  const second = settleRound(first.state, result, { bet: 10, now });
  assert.equal(second.record.id, 2);
  assert.equal(second.state.stats.hands, 2);
});
