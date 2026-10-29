import type { Card } from "../engine/cards.js";
import type { Outcome } from "../engine/game.js";
import type { Decision } from "../engine/jev.js";
import { narrate } from "../engine/narrate.js";
import type { HandRecord, State } from "../engine/state.js";
import type { CurrentRound, Step } from "../../server/round.js";

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

const emptyTable: Table = {
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

/** Folds one step into the table. `round` is the number of the round the step belongs to. */
function reduceTable(table: Table, step: Step, round: number): Table {
  const line = step.type === "note" ? step.text : narrate(step);
  const next = { ...table, log: [...table.log, line] };
  switch (step.type) {
    case "note":
      return next;
    case "bet":
      // The dealer's lines before the bet, a rebuy or a shuffle, stay in the log.
      return { ...emptyTable, round, bet: step.bet, log: next.log };
    case "deal":
      return { ...next, hands: [{ cards: step.cards, bet: table.bet }], dealer: [step.dealerUp], active: 0 };
    case "insurance":
      return { ...next, decision: { kind: "insurance", hand: 0, decision: step.decision } };
    case "peek":
      return next;
    case "decision": {
      const hands = table.hands.map((hand, i) =>
        i === step.hand && step.decision.choice === "double" ? { ...hand, bet: hand.bet * 2 } : hand,
      );
      return { ...next, hands, active: step.hand, decision: { kind: "action", hand: step.hand, decision: step.decision } };
    }
    case "card":
      return { ...next, hands: table.hands.map((hand, i) => (i === step.hand ? { ...hand, cards: step.cards } : hand)) };
    case "split": {
      // Hands up to the one being split keep their bets; the new hand and those after it haven't doubled yet.
      const splitAt = table.active ?? 0;
      const hands = step.hands.map((cards, i) => ({ cards, bet: i <= splitAt ? (table.hands[i]?.bet ?? table.bet) : table.bet }));
      return { ...next, hands };
    }
    case "reveal":
      return { ...next, dealer: step.dealer, holeHidden: false, active: null };
    case "dealer-card":
      return { ...next, dealer: step.dealer };
    case "settle":
      return {
        ...next,
        hands: step.hands.map((hand) => ({ cards: hand.cards, bet: hand.bet, outcome: hand.outcome, net: hand.net })),
        active: null,
        net: step.net,
      };
  }
}

/** What a page shows of a round at a moment on the server's clock. */
export interface Playback {
  table: Table;
  /** The step on the table, or -1 before the first. */
  step: number;
  /** When the next step shows, or null with no round. */
  nextMoveAt: number | null;
  /** The round's result is on the table. */
  settled: boolean;
  /** Every step has shown its time: the next round may be dealt. */
  ended: boolean;
  /** Jev's state as the table shows it: the result only counts once it's on the table. */
  state: State | null;
  /** The round whose result isn't on the table yet, to keep out of the history until it is. */
  pending: number | null;
}

/**
 * The round as it stands at `at`: step i shows from startedAt + i × stepMs, so every page plays
 * the same round back on the same clock, and the last step stays up until the next round.
 */
export function playback(round: CurrentRound | null, at: number): Playback {
  if (!round) {
    return { table: emptyTable, step: -1, nextMoveAt: null, settled: false, ended: false, state: null, pending: null };
  }
  const step = Math.min(round.steps.length - 1, Math.floor((at - round.startedAt) / round.stepMs));
  let table = emptyTable;
  let settled = false;
  for (const shown of round.steps.slice(0, step + 1)) {
    table = reduceTable(table, shown, round.id);
    if (shown.type === "settle") settled = true;
  }
  return {
    table,
    step,
    nextMoveAt: round.startedAt + (step + 1) * round.stepMs,
    settled,
    ended: at >= round.endsAt,
    state: settled ? round.after : round.before,
    pending: settled ? null : round.id,
  };
}

/** The history list as the table stands: without the round still being played out. */
export function shownHistory(history: HandRecord[], shown: Playback): HandRecord[] {
  return shown.pending === null ? history : history.filter((round) => round.id !== shown.pending);
}
