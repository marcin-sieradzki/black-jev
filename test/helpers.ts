import { stackedShoe, type Card, type Rank } from "../src/engine/cards.js";
import { playRound, type RoundResult, type TableEvent } from "../src/engine/game.js";
import { localJev, type Decider } from "../src/engine/jev.js";
import { RULES, type Rules } from "../src/engine/rules.js";

/** Cards from ranks, e.g. cards("A", "K"). Suits don't matter to the game. */
export function cards(...ranks: Rank[]): Card[] {
  return ranks.map((rank) => ({ rank, suit: "♠" }));
}

/**
 * Plays one round from a stacked shoe. The deal order is Jev, dealer up, Jev, dealer hole,
 * then cards in the order they're drawn.
 */
export async function round(
  deck: Rank[],
  options: { jev?: Decider; rules?: Partial<Rules>; bankroll?: number; bet?: number } = {},
): Promise<RoundResult & { events: TableEvent[] }> {
  const events: TableEvent[] = [];
  const result = await playRound({
    shoe: stackedShoe(cards(...deck)),
    jev: options.jev ?? localJev,
    rules: { ...RULES, ...options.rules },
    bankroll: options.bankroll ?? 1000,
    bet: options.bet ?? 10,
    move: (event) => {
      events.push(event);
    },
  });
  return { ...result, events };
}
