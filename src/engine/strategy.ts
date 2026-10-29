import { cardValue, handTotal, type Card } from "./cards.js";

export const ACTIONS = ["hit", "stand", "double", "split", "surrender"] as const;
export type Action = (typeof ACTIONS)[number];

/** Dealer upcard as 2-10, with an ace as 11. */
export function upcardValue(card: Card): number {
  return card.rank === "A" ? 11 : cardValue(card);
}

function between(up: number, low: number, high: number): boolean {
  return up >= low && up <= high;
}

interface Play {
  best: Action;
  /** What to do instead when doubling isn't allowed. */
  noDouble: Action;
}

const always = (action: Action): Play => ({ best: action, noDouble: action });
const doubleElse = (fallback: Action): Play => ({ best: "double", noDouble: fallback });

/** Whether to split a pair of this card value (ace = 1). */
function splitPair(value: number, up: number): boolean {
  switch (value) {
    case 1:
    case 8:
      return true;
    case 10:
    case 5:
      return false;
    case 9:
      return between(up, 2, 6) || between(up, 8, 9);
    case 7:
      return between(up, 2, 7);
    case 6:
      return between(up, 2, 6);
    case 4:
      return between(up, 5, 6);
    default: // 2s and 3s
      return between(up, 2, 7);
  }
}

function softPlay(total: number, up: number): Play {
  if (total >= 19) return always("stand");
  if (total === 18) {
    if (between(up, 3, 6)) return doubleElse("stand");
    return always(between(up, 9, 11) ? "hit" : "stand");
  }
  if (total === 12) return always("hit"); // two aces that can't be split
  const doubleFrom = total === 17 ? 3 : total >= 15 ? 4 : 5;
  return between(up, doubleFrom, 6) ? doubleElse("hit") : always("hit");
}

function hardPlay(total: number, up: number): Play {
  if (total >= 17) return always("stand");
  if (total === 16 && between(up, 9, 11)) return always("surrender");
  if (total === 15 && up === 10) return always("surrender");
  if (total >= 13) return always(between(up, 2, 6) ? "stand" : "hit");
  if (total === 12) return always(between(up, 4, 6) ? "stand" : "hit");
  if (total === 11) return up === 11 ? always("hit") : doubleElse("hit");
  if (total === 10) return between(up, 2, 9) ? doubleElse("hit") : always("hit");
  if (total === 9) return between(up, 3, 6) ? doubleElse("hit") : always("hit");
  return always("hit");
}

/**
 * Basic strategy for six decks, dealer stands on soft 17, double after split, late surrender:
 * the action with the best expected value among the legal ones.
 */
export function basicStrategy(cards: readonly Card[], dealerUp: Card, legal: readonly Action[]): Action {
  const up = upcardValue(dealerUp);
  const [first, second] = cards;
  const pair = cards.length === 2 && first && second && cardValue(first) === cardValue(second);
  if (pair && legal.includes("split") && splitPair(cardValue(first), up)) {
    return "split";
  }

  const { total, soft } = handTotal(cards);
  const play = soft ? softPlay(total, up) : hardPlay(total, up);
  // Without surrender, 16 against 9, 10 or ace and 15 against 10 are hits.
  if (play.best === "surrender" && !legal.includes("surrender")) return "hit";
  if (play.best === "double" && !legal.includes("double")) return play.noDouble;
  return play.best;
}

/**
 * Spots where the best play beats the next best by only a little, so a calibrated decider
 * should be less sure. Keys are "<hard|soft> <total> v <upcard>".
 */
const CLOSE_CALLS = new Set([
  "hard 16 v 10",
  "hard 16 v 9",
  "hard 15 v 10",
  "hard 16 v 11",
  "hard 12 v 2",
  "hard 12 v 3",
  "hard 12 v 4",
  "hard 13 v 2",
  "hard 11 v 11",
  "hard 10 v 10",
  "hard 9 v 2",
  "hard 9 v 7",
  "soft 18 v 2",
  "soft 18 v 11",
  "soft 17 v 2",
  "soft 13 v 4",
  "soft 19 v 6",
]);

export function isCloseCall(cards: readonly Card[], dealerUp: Card): boolean {
  const { total, soft } = handTotal(cards);
  return CLOSE_CALLS.has(`${soft ? "soft" : "hard"} ${total} v ${upcardValue(dealerUp)}`);
}
