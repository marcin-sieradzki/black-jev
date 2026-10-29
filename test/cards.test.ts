import assert from "node:assert/strict";
import { test } from "vitest";
import { createShoe, handTotal, isNatural, seededRandom } from "../src/engine/cards.js";
import { cards } from "./helpers.js";

test("an ace counts 11 while it fits and 1 after", () => {
  assert.deepEqual(handTotal(cards("A", "6")), { total: 17, soft: true });
  assert.deepEqual(handTotal(cards("A", "6", "10")), { total: 17, soft: false });
  assert.deepEqual(handTotal(cards("A", "A", "9")), { total: 21, soft: true });
  assert.deepEqual(handTotal(cards("K", "Q", "2")), { total: 22, soft: false });
});

test("a natural is two cards making 21", () => {
  assert.equal(isNatural(cards("A", "K")), true);
  assert.equal(isNatural(cards("7", "7", "7")), false);
});

test("a six-deck shoe holds 312 cards and asks for a shuffle at the cut card", () => {
  const shoe = createShoe(6, 0.75, seededRandom(1));
  assert.equal(shoe.remaining, 312);
  let dealt = 0;
  while (!shoe.needsShuffle) {
    shoe.draw();
    dealt++;
  }
  assert.equal(dealt, 234);
  shoe.shuffle();
  assert.equal(shoe.remaining, 312);
});

test("a seeded shoe deals the same cards every time", () => {
  const a = createShoe(6, 0.75, seededRandom(42));
  const b = createShoe(6, 0.75, seededRandom(42));
  for (let i = 0; i < 50; i++) assert.deepEqual(a.draw(), b.draw());
});
