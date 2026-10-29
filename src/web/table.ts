import type { Card } from "../engine/cards.js";
import type { Outcome, TableEvent } from "../engine/game.js";
import type { Decision } from "../engine/jev.js";
import { narrate } from "../engine/narrate.js";

export interface TableHand {
  cards: Card[];
  bet: number;
  outcome?: Outcome;
  net?: number;
}

/** What the page draws: the table as Jev's moves have left it. */
export interface Table {
  round: number;
  bet: number;
  dealer: Card[];
  /** The dealer's second card is still face down. */
  holeHidden: boolean;
  hands: TableHand[];
  /** The hand Jev is playing, or null between turns. */
  active: number | null;
  decision: { kind: "action" | "insurance"; hand: number; decision: Decision<string> } | null;
  /** The round's result once settled. */
  net: number | null;
  /** This round's moves as lines, oldest first. */
  log: string[];
}

export const emptyTable: Table = {
  round: 0,
  bet: 0,
  dealer: [],
  holeHidden: true,
  hands: [],
  active: null,
  decision: null,
  net: null,
  log: [],
};

export function note(table: Table, line: string): Table {
  return { ...table, log: [...table.log, line] };
}

/** Folds one move into the table. `round` is the number of the round the move belongs to. */
export function reduceTable(table: Table, event: TableEvent, round: number): Table {
  const line = narrate(event);
  const next = { ...table, log: [...table.log, line] };
  switch (event.type) {
    case "bet":
      return { ...emptyTable, round, bet: event.bet, log: [line] };
    case "deal":
      return { ...next, hands: [{ cards: event.cards, bet: table.bet }], dealer: [event.dealerUp], active: 0 };
    case "insurance":
      return { ...next, decision: { kind: "insurance", hand: 0, decision: event.decision } };
    case "peek":
      return next;
    case "decision": {
      const hands = table.hands.map((hand, i) =>
        i === event.hand && event.decision.choice === "double" ? { ...hand, bet: hand.bet * 2 } : hand,
      );
      return { ...next, hands, active: event.hand, decision: { kind: "action", hand: event.hand, decision: event.decision } };
    }
    case "card":
      return { ...next, hands: table.hands.map((hand, i) => (i === event.hand ? { ...hand, cards: event.cards } : hand)) };
    case "split": {
      // Hands up to the one being split keep their bets; the new hand and those after it haven't doubled yet.
      const splitAt = table.active ?? 0;
      const hands = event.hands.map((cards, i) => ({ cards, bet: i <= splitAt ? (table.hands[i]?.bet ?? table.bet) : table.bet }));
      return { ...next, hands };
    }
    case "reveal":
      return { ...next, dealer: event.dealer, holeHidden: false, active: null };
    case "dealer-card":
      return { ...next, dealer: event.dealer };
    case "settle":
      return {
        ...next,
        hands: event.hands.map((hand) => ({ cards: hand.cards, bet: hand.bet, outcome: hand.outcome, net: hand.net })),
        active: null,
        net: event.net,
      };
  }
}
