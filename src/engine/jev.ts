import { formatCard, formatCards, formatTotal, type Card } from "./cards.js";
import type { Rules } from "./rules.js";
import { basicStrategy, isCloseCall, type Action } from "./strategy.js";

export type InsuranceChoice = "insure" | "decline";

/**
 * A typed decision the way Jev returns one: one choice from the options it was given, a
 * probability for each option, and a confidence taken from how concentrated those are.
 */
export interface Decision<T extends string> {
  choice: T;
  probabilities: Partial<Record<T, number>>;
  confidence: number;
  /** "typesafe" when the Jev API made the call; "local" for the stand-in. */
  source: "typesafe" | "local";
  /** Why a TypeSafe call fell back to the stand-in. */
  fallback?: string;
}

/** What Jev sees at the moment of a decision: its own cards, never the dealer's hole card. */
export interface TableView {
  cards: readonly Card[];
  dealerUp: Card;
  /** Which of Jev's hands this is, from 0, and how many it has after splits. */
  handIndex: number;
  handCount: number;
  bet: number;
  bankroll: number;
  rules: Rules;
}

export interface Decider {
  decideAction(view: TableView, legal: readonly Action[]): Promise<Decision<Action>>;
  decideInsurance(view: TableView): Promise<Decision<InsuranceChoice>>;
}

/** 1 minus normalised entropy: 1 when one option has all the mass, 0 when they're even. */
export function confidenceOf(probabilities: readonly number[]): number {
  const n = probabilities.length;
  if (n < 2) return 1;
  let entropy = 0;
  for (const p of probabilities) if (p > 0) entropy -= p * Math.log(p);
  return Math.max(0, Math.min(1, 1 - entropy / Math.log(n)));
}

function distribution<T extends string>(choice: T, options: readonly T[], top: number): Decision<T> {
  const others = options.filter((o) => o !== choice);
  const probabilities: Partial<Record<T, number>> = { [choice]: others.length ? top : 1 } as Partial<Record<T, number>>;
  for (const other of others) probabilities[other] = (1 - top) / others.length;
  const values = options.map((o) => probabilities[o] ?? 0);
  return { choice, probabilities, confidence: confidenceOf(values), source: "local" };
}

/**
 * Jev without the network: it plays perfect basic strategy and reports a distribution that is
 * flatter on close calls. It's what runs when no TypeSafe API key is set, and the fallback
 * whenever a call to the API fails.
 */
export const localJev: Decider = {
  async decideAction(view, legal) {
    const choice = basicStrategy(view.cards, view.dealerUp, legal);
    return distribution(choice, legal, isCloseCall(view.cards, view.dealerUp) ? 0.62 : 0.95);
  },
  async decideInsurance() {
    // Insurance loses about 7% for a basic-strategy player, so Jev never takes it.
    return distribution<InsuranceChoice>("decline", ["insure", "decline"], 0.93);
  },
};

const ACTION_CRITERIA: Record<Action, string> = {
  hit: "Take one more card.",
  stand: "Take no more cards and keep this total.",
  double: "Double the bet, take exactly one more card, then stand.",
  split: "Split the pair into two hands, each with its own bet equal to the original.",
  surrender: "Give up the hand now and get half the bet back.",
};

export interface TypeSafeOptions {
  /** Leave it out when `url` is a proxy that adds the key, as the page's /api/jev does. */
  apiKey?: string;
  /** Defaults to https://api.typesafe.ai/v1/systemone. */
  url?: string;
  /** "jev-latest" or "jev-preview". */
  model?: string;
  /** Per call; past this the stand-in decides so the table keeps moving. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

function describe(view: TableView): Record<string, unknown> {
  const { rules } = view;
  return {
    game: "Blackjack. You are the player; maximise expected value of the bet.",
    rules:
      `${rules.decks} decks; dealer ${rules.dealerHitsSoft17 ? "hits" : "stands on"} soft 17; ` +
      `blackjack pays ${rules.blackjackPays === 1.5 ? "3:2" : rules.blackjackPays}; dealer checks for blackjack; ` +
      `double on any two cards${rules.doubleAfterSplit ? ", also after a split" : ""}; ` +
      `split up to ${rules.maxHands} hands; ${rules.lateSurrender ? "late surrender allowed" : "no surrender"}.`,
    player_hand: `${formatCards(view.cards)} (${formatTotal(view.cards)})`,
    dealer_upcard: formatCard(view.dealerUp),
    hand: `${view.handIndex + 1} of ${view.handCount}`,
    bet: view.bet,
    bankroll: view.bankroll,
  };
}

interface ChoiceAnswer {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

/** Pull the answer to `key` out of a response, accepting the shapes the published guides show. */
function readAnswer(body: unknown, key: string): ChoiceAnswer {
  const root = body as Record<string, unknown> | null;
  const answers = (root?.answers ?? root?.results ?? root) as Record<string, unknown> | undefined;
  const answer = answers?.[key] as Record<string, unknown> | undefined;
  const choice = answer?.choice ?? answer?.answer ?? answer?.value;
  if (typeof choice !== "string") throw new Error(`no choice for "${key}" in the response`);
  const probabilities = (answer?.probabilities ?? {}) as Record<string, number>;
  const confidence = typeof answer?.confidence === "number" ? answer.confidence : confidenceOf(Object.values(probabilities));
  return { choice, probabilities, confidence };
}

/**
 * Jev through TypeSafe AI's System One API: each decision is one POST with the table as state and
 * the legal moves as a typed choice. The request shape follows the published guides, not an
 * official reference, so any error, timeout or answer outside the legal moves falls back to
 * the stand-in and says so.
 */
export function typeSafeJev(options: TypeSafeOptions): Decider {
  const url = options.url ?? "https://api.typesafe.ai/v1/systemone";
  const model = options.model ?? "jev-latest";
  const timeoutMs = options.timeoutMs ?? 2500;
  const doFetch = options.fetch ?? fetch;

  async function ask<T extends string>(
    view: TableView,
    key: string,
    instructions: string,
    criteria: Partial<Record<T, string>>,
    fallback: () => Promise<Decision<T>>,
  ): Promise<Decision<T>> {
    try {
      const response = await doFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          state: describe(view),
          questions: { [key]: { type: "choice", instructions, criteria } },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const answer = readAnswer(await response.json(), key);
      if (!(answer.choice in criteria)) throw new Error(`"${answer.choice}" isn't a legal move`);
      return {
        choice: answer.choice as T,
        probabilities: answer.probabilities as Partial<Record<T, number>>,
        confidence: answer.confidence,
        source: "typesafe",
      };
    } catch (error) {
      const decision = await fallback();
      return { ...decision, fallback: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    decideAction(view, legal) {
      const criteria: Partial<Record<Action, string>> = {};
      for (const action of legal) criteria[action] = ACTION_CRITERIA[action];
      return ask(view, "action", "Pick the move with the highest expected value for this hand.", criteria, () =>
        localJev.decideAction(view, legal),
      );
    },
    decideInsurance(view) {
      return ask<InsuranceChoice>(
        view,
        "insurance",
        `The dealer shows an ace. Insurance costs half the bet (${view.bet / 2}) and pays 2:1 if the dealer has a blackjack.`,
        { insure: "Take insurance.", decline: "Decline insurance." },
        () => localJev.decideInsurance(view),
      );
    },
  };
}
