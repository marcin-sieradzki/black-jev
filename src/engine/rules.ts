/**
 * The table's rules: a common Las Vegas Strip six-deck game. The README explains each one.
 */
export interface Rules {
  decks: number;
  /** How far through the shoe the cut card sits. */
  penetration: number;
  /** H17 when true, S17 when false. */
  dealerHitsSoft17: boolean;
  /** Payout for a natural, as a multiple of the bet: 1.5 is 3:2. */
  blackjackPays: number;
  /** Insurance pays 2:1 when the dealer has a blackjack. */
  insurancePays: number;
  doubleAfterSplit: boolean;
  /** Most hands a player can split up to. */
  maxHands: number;
  resplitAces: boolean;
  /** Split aces get one card each and may not be hit. */
  hitSplitAces: boolean;
  /** Late surrender: give up half the bet on the first two cards, after the dealer checks for a blackjack. */
  lateSurrender: boolean;
}

export const RULES: Rules = {
  decks: 6,
  penetration: 0.75,
  dealerHitsSoft17: false,
  blackjackPays: 1.5,
  insurancePays: 2,
  doubleAfterSplit: true,
  maxHands: 4,
  resplitAces: false,
  hitSplitAces: false,
  lateSurrender: true,
};
