import assert from "node:assert/strict";
import { test } from "vitest";
import { confidenceOf, localJev, typeSafeJev, type TableView } from "../src/engine/jev.js";
import { RULES } from "../src/engine/rules.js";
import { cards } from "./helpers.js";

const view: TableView = { cards: cards("10", "6"), dealerUp: cards("10")[0]!, handIndex: 0, handCount: 1, bet: 10, bankroll: 990, rules: RULES };

function fakeFetch(respond: (body: any) => Response | Promise<Response>) {
  const calls: any[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ headers: init.headers, body });
    return respond(body);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

test("confidence is 1 for a sure thing and 0 for an even split", () => {
  assert.equal(confidenceOf([1, 0, 0]), 1);
  assert.equal(confidenceOf([0.5, 0.5]), 0);
});

test("the stand-in is less sure on close calls", async () => {
  const close = await localJev.decideAction(view, ["hit", "stand", "surrender"]);
  const clear = await localJev.decideAction({ ...view, cards: cards("10", "9") }, ["hit", "stand"]);
  assert.equal(close.choice, "surrender");
  assert.ok(close.confidence < clear.confidence);
});

test("Jev through the API gets the table as state and the legal moves as a typed choice", async () => {
  const { fetch, calls } = fakeFetch(() =>
    Response.json({ answers: { action: { choice: "hit", probabilities: { hit: 0.7, stand: 0.3 }, confidence: 0.4 } } }),
  );
  const jev = typeSafeJev({ apiKey: "test-key", fetch });
  const decision = await jev.decideAction(view, ["hit", "stand"]);
  assert.deepEqual(decision, { choice: "hit", probabilities: { hit: 0.7, stand: 0.3 }, confidence: 0.4, source: "typesafe" });
  const { headers, body } = calls[0];
  assert.equal(headers.authorization, "Bearer test-key");
  assert.equal(body.model, "jev-latest");
  assert.equal(body.state.player_hand, "10♠ 6♠ (16)");
  assert.equal(body.questions.action.type, "choice");
  assert.deepEqual(Object.keys(body.questions.action.criteria), ["hit", "stand"]);
});

test("an API error or an illegal answer falls back to the stand-in and says why", async () => {
  const down = typeSafeJev({ apiKey: "k", fetch: fakeFetch(() => new Response("nope", { status: 503 })).fetch });
  const failed = await down.decideAction(view, ["hit", "stand"]);
  assert.equal(failed.source, "local");
  assert.equal(failed.fallback, "HTTP 503");

  const wrong = typeSafeJev({ apiKey: "k", fetch: fakeFetch(() => Response.json({ answers: { action: { choice: "split" } } })).fetch });
  const illegal = await wrong.decideAction(view, ["hit", "stand"]);
  assert.equal(illegal.choice, "hit");
  assert.match(illegal.fallback!, /isn't a legal move/);
});
