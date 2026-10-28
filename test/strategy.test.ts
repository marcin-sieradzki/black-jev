import assert from "node:assert/strict";
import { test } from "vitest";
import type { Rank } from "../src/engine/cards.js";
import { basicStrategy, type Action } from "../src/engine/strategy.js";
import { cards } from "./helpers.js";

const ALL: Action[] = ["hit", "stand", "double", "split", "surrender"];

function play(hand: Rank[], up: Rank, legal: Action[] = ALL): Action {
  return basicStrategy(cards(...hand), cards(up)[0]!, legal);
}

test("hard totals", () => {
  assert.equal(play(["10", "2"], "3"), "hit");
  assert.equal(play(["10", "2"], "4"), "stand");
  assert.equal(play(["10", "6"], "6"), "stand");
  assert.equal(play(["10", "6"], "7"), "hit");
  assert.equal(play(["6", "5"], "10"), "double");
  assert.equal(play(["6", "5"], "A"), "hit"); // S17
  assert.equal(play(["5", "4"], "2"), "hit");
  assert.equal(play(["5", "4"], "3"), "double");
  assert.equal(play(["10", "7"], "A"), "stand");
});

test("surrender 16 against 9, 10 and ace, and 15 against 10; hit when surrender isn't allowed", () => {
  assert.equal(play(["10", "6"], "9"), "surrender");
  assert.equal(play(["10", "6"], "K"), "surrender");
  assert.equal(play(["10", "6"], "A"), "surrender");
  assert.equal(play(["10", "5"], "10"), "surrender");
  assert.equal(play(["10", "5"], "A"), "hit");
  assert.equal(play(["10", "6"], "10", ["hit", "stand"]), "hit");
});

test("soft totals", () => {
  assert.equal(play(["A", "2"], "5"), "double");
  assert.equal(play(["A", "2"], "4"), "hit");
  assert.equal(play(["A", "4"], "4"), "double");
  assert.equal(play(["A", "6"], "3"), "double");
  assert.equal(play(["A", "7"], "2"), "stand");
  assert.equal(play(["A", "7"], "6"), "double");
  assert.equal(play(["A", "7"], "6", ["hit", "stand"]), "stand");
  assert.equal(play(["A", "7"], "9"), "hit");
  assert.equal(play(["A", "8"], "6"), "stand"); // S17
  assert.equal(play(["A", "3", "2"], "5", ["hit", "stand"]), "hit");
});

test("pairs", () => {
  assert.equal(play(["A", "A"], "A"), "split");
  assert.equal(play(["8", "8"], "10"), "split");
  assert.equal(play(["10", "K"], "6"), "stand");
  assert.equal(play(["9", "9"], "7"), "stand");
  assert.equal(play(["9", "9"], "8"), "split");
  assert.equal(play(["5", "5"], "6"), "double");
  assert.equal(play(["4", "4"], "5"), "split");
  assert.equal(play(["4", "4"], "4"), "hit");
  assert.equal(play(["2", "2"], "7"), "split");
  assert.equal(play(["A", "A"], "6", ["hit", "stand"]), "hit");
  assert.equal(play(["8", "8"], "6", ["hit", "stand", "double"]), "stand");
});
