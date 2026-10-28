export const SUITS = ["♠", "♥", "♦", "♣"] as const;
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];

export interface Card {
  rank: Rank;
  suit: Suit;
}

/** A source of numbers in [0, 1), so a seeded shoe can replay the same cards. */
export type Random = () => number;

/** Blackjack value with an ace counted as 1; `handTotal` lifts one ace to 11 when it fits. */
export function cardValue(card: Card): number {
  if (card.rank === "A") return 1;
  if (card.rank === "J" || card.rank === "Q" || card.rank === "K") return 10;
  return Number(card.rank);
}

export interface Total {
  total: number;
  /** An ace is counted as 11. */
  soft: boolean;
}

export function handTotal(cards: readonly Card[]): Total {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardValue(card);
    if (card.rank === "A") aces++;
  }
  if (aces > 0 && total + 10 <= 21) return { total: total + 10, soft: true };
  return { total, soft: false };
}

/** Two cards making 21. A split hand that makes 21 is not a blackjack; the engine checks that. */
export function isNatural(cards: readonly Card[]): boolean {
  return cards.length === 2 && handTotal(cards).total === 21;
}

export function formatCard(card: Card): string {
  return `${card.rank}${card.suit}`;
}

export function formatCards(cards: readonly Card[]): string {
  return cards.map(formatCard).join(" ");
}

export function formatTotal(cards: readonly Card[]): string {
  const { total, soft } = handTotal(cards);
  return soft && total < 21 ? `soft ${total}` : String(total);
}

/** Mulberry32: small, fast and seedable. Fine for a game, not for cryptography. */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function freshDecks(decks: number): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) cards.push({ rank, suit });
    }
  }
  return cards;
}

export interface Shoe {
  draw(): Card;
  /** The shoe as a short string, so a stateless server can keep dealing from it next round. */
  snapshot(): string;
  /** The cut card has come out: shuffle before the next round. */
  readonly needsShuffle: boolean;
  shuffle(): void;
  readonly remaining: number;
}

const SUIT_CODES: Record<Suit, string> = { "♠": "S", "♥": "H", "♦": "D", "♣": "C" };
const CODE_SUITS = Object.fromEntries(Object.entries(SUIT_CODES).map(([suit, code]) => [code, suit])) as Record<string, Suit>;

/** "AS", "TH": a rank letter (T for 10) and a suit letter. */
function encodeCard(card: Card): string {
  return (card.rank === "10" ? "T" : card.rank) + SUIT_CODES[card.suit];
}

function decodeCard(code: string): Card {
  const rank = code[0] === "T" ? "10" : (code[0] as Rank);
  const suit = CODE_SUITS[code[1] ?? ""];
  if (!RANKS.includes(rank) || !suit) throw new Error(`"${code}" isn't a card`);
  return { rank, suit };
}

/**
 * A shoe of `decks` decks with a cut card at `penetration` of the way through, fresh or carried
 * on from a `snapshot()`.
 */
export function createShoe(decks: number, penetration: number, random: Random, snapshot?: string): Shoe {
  let cards: Card[] = [];
  let next = 0;
  const cutAt = Math.floor(decks * 52 * penetration);

  const shuffle = () => {
    cards = freshDecks(decks);
    // Fisher-Yates.
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [cards[i], cards[j]] = [cards[j]!, cards[i]!];
    }
    next = 0;
  };
  if (snapshot) {
    const [position, codes = ""] = snapshot.split(":");
    cards = (codes.match(/../g) ?? []).map(decodeCard);
    next = Number(position);
    if (cards.length !== decks * 52 || !(next >= 0 && next <= cards.length)) shuffle();
  } else {
    shuffle();
  }

  return {
    snapshot() {
      return `${next}:${cards.map(encodeCard).join("")}`;
    },
    draw() {
      // The cut card sits deep enough that a round never reaches the end; this is a guard.
      if (next >= cards.length) shuffle();
      return cards[next++]!;
    },
    get needsShuffle() {
      return next >= cutAt;
    },
    shuffle,
    get remaining() {
      return cards.length - next;
    },
  };
}

/** A shoe that deals exactly these cards in order, for tests. */
export function stackedShoe(cards: readonly Card[]): Shoe {
  let next = 0;
  return {
    draw() {
      const card = cards[next++];
      if (!card) throw new Error("stacked shoe ran out of cards");
      return card;
    },
    snapshot() {
      return "";
    },
    needsShuffle: false,
    shuffle() {},
    get remaining() {
      return cards.length - next;
    },
  };
}
