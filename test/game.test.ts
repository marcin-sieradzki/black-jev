import assert from "node:assert/strict";
import { test } from "vitest";
import { createShoe, seededRandom } from "../src/engine/cards.js";
import { playRound } from "../src/engine/game.js";
import { localJev, type Decider } from "../src/engine/jev.js";
import { RULES } from "../src/engine/rules.js";
import { applyRound, freshState } from "../src/engine/state.js";
import type { Action } from "../src/engine/strategy.js";
import { round } from "./helpers.js";

/** A decider that plays a fixed script of actions and takes insurance when told to. */
function scripted(actions: Action[], insure = false): Decider {
  const queue = [...actions];
  return {
    async decideAction(_view, legal) {
      const choice = queue.shift() ?? "stand";
      assert.ok(legal.includes(choice), `${choice} isn't legal here (${legal.join(", ")})`);
      return { choice, probabilities: { [choice]: 1 }, confidence: 1, source: "local" };
    },
    async decideInsurance() {
      const choice = insure ? "insure" : "decline";
      return { choice, probabilities: { [choice]: 1 }, confidence: 1, source: "local" };
    },
  };
}

test("a blackjack pays 3:2", async () => {
  const result = await round(["A", "9", "K", "7"]);
  assert.equal(result.hands[0]!.outcome, "blackjack");
  assert.equal(result.net, 15);
});

test("a blackjack against a dealer blackjack pushes", async () => {
  const result = await round(["A", "A", "K", "Q"], { jev: scripted([]) });
  assert.equal(result.hands[0]!.outcome, "push");
  assert.equal(result.net, 0);
});

test("insurance pays 2:1 when the dealer has a blackjack", async () => {
  const result = await round(["10", "A", "7", "K"], { jev: scripted([], true) });
  assert.equal(result.hands[0]!.outcome, "lose");
  assert.deepEqual(result.insurance, { bet: 5, payout: 15 });
  assert.equal(result.net, 0); // -10 on the hand, +10 on insurance
});

test("insurance is lost when the dealer has no blackjack, and play goes on", async () => {
  const result = await round(["10", "A", "9", "6"], { jev: scripted(["stand"], true) });
  // Dealer A 6 is soft 17 and stands; Jev's 19 wins.
  assert.equal(result.hands[0]!.outcome, "win");
  assert.equal(result.net, 10 - 5);
});

test("the dealer stands on soft 17, or hits it under H17", async () => {
  const s17 = await round(["10", "A", "8", "6", "4"], { jev: scripted(["stand"]) });
  assert.equal(s17.dealer.length, 2);
  assert.equal(s17.hands[0]!.outcome, "win");
  const h17 = await round(["10", "A", "8", "6", "4"], { jev: scripted(["stand"]), rules: { dealerHitsSoft17: true } });
  assert.equal(h17.dealer.length, 3); // A 6 4 = 21
  assert.equal(h17.hands[0]!.outcome, "lose");
});

test("doubling doubles the bet and deals exactly one card", async () => {
  const result = await round(["6", "6", "5", "10", "10", "9"], { jev: scripted(["double"]) });
  assert.equal(result.hands[0]!.cards.length, 3);
  assert.equal(result.hands[0]!.bet, 20);
  // Jev 21; dealer 6 10 9 busts.
  assert.equal(result.net, 20);
});

test("late surrender returns half the bet and the dealer doesn't draw", async () => {
  const result = await round(["10", "10", "6", "7"]);
  assert.equal(result.hands[0]!.outcome, "surrender");
  assert.equal(result.net, -5);
  assert.equal(result.dealer.length, 2);
});

test("splitting makes hands with their own bets, and doubling after a split is allowed", async () => {
  // 8 8 against a 6 splits into 8 3 and 8 A. 8 3 doubles onto a king for 21; 8 A stands on 19.
  // The dealer's 16 draws a 4 for 20.
  const result = await round(["8", "6", "8", "10", "3", "A", "K", "4"], { jev: scripted(["split", "double", "stand"]) });
  assert.deepEqual(result.hands.map((h) => h.bet), [20, 10]);
  assert.deepEqual(result.hands.map((h) => h.outcome), ["win", "lose"]);
  assert.equal(result.net, 20 - 10);
});

test("split aces get one card each, and ace-ten after a split pays even money", async () => {
  const result = await round(["A", "9", "A", "9", "K", "5"]);
  assert.deepEqual(result.hands.map((h) => h.cards.length), [2, 2]);
  // Dealer 18: A K is 21 and wins 1:1, not 3:2; A 5 is soft 16 and loses.
  assert.deepEqual(result.hands.map((h) => h.outcome), ["win", "lose"]);
  assert.equal(result.net, 0);
});

test("Jev can't double or split without the money to cover the extra bet", async () => {
  const offered: Action[][] = [];
  const jev: Decider = {
    ...localJev,
    async decideAction(view, legal) {
      offered.push([...legal]);
      return localJev.decideAction(view, legal);
    },
  };
  await round(["8", "6", "8", "10", "5"], { jev, bankroll: 15 });
  assert.deepEqual(offered[0], ["hit", "stand", "surrender"]);
});

test("over many rounds the books balance and the house edge looks like basic strategy's", async () => {
  const shoe = createShoe(RULES.decks, RULES.penetration, seededRandom(2026));
  let state = freshState(1_000_000);
  for (let i = 0; i < 100_000; i++) {
    if (shoe.needsShuffle) shoe.shuffle();
    const result = await playRound({ shoe, jev: localJev, rules: RULES, bankroll: state.bankroll, bet: 10, move: () => {} });
    const paid = result.hands.reduce((sum, h) => sum + h.payout, 0) + (result.insurance?.payout ?? 0);
    const staked = result.hands.reduce((sum, h) => sum + h.bet, 0) + (result.insurance?.bet ?? 0);
    assert.equal(result.net, paid - staked);
    state = applyRound(state, result);
  }
  assert.equal(state.bankroll, 1_000_000 + state.stats.net);
  // About -0.4% of initial bets for this game; 100,000 rounds puts the standard error near 0.36%.
  const edge = state.stats.net / (state.stats.hands * 10);
  assert.ok(edge > -0.02 && edge < 0.012, `edge ${(edge * 100).toFixed(2)}% is out of range`);
});
