import { cardValue, handTotal, isNatural, type Card, type Shoe } from "./cards.js";
import type { Decider, Decision, InsuranceChoice, TableView } from "./jev.js";
import type { Rules } from "./rules.js";
import type { Action } from "./strategy.js";

export type Outcome = "blackjack" | "win" | "push" | "lose" | "bust" | "surrender";

export interface Hand {
  cards: Card[];
  bet: number;
  fromSplit: boolean;
  splitAces: boolean;
  doubled: boolean;
  surrendered: boolean;
}

export interface SettledHand {
  cards: Card[];
  bet: number;
  outcome: Outcome;
  /** Money back to the bankroll from this hand, including the returned stake. */
  payout: number;
  /** payout - bet. */
  net: number;
  doubled: boolean;
  fromSplit: boolean;
}

export interface DecisionRecord<T extends string = string> {
  hand: number;
  cards: Card[];
  dealerUp: Card;
  legal: readonly T[];
  decision: Decision<T>;
}

/** Everything that happens at the table. Each one is a move, so the runner paces on it. */
export type TableEvent =
  | { type: "bet"; bet: number; bankroll: number }
  | { type: "deal"; cards: Card[]; dealerUp: Card }
  | { type: "insurance"; decision: Decision<InsuranceChoice>; bet: number }
  | { type: "peek"; dealerBlackjack: boolean }
  | { type: "decision"; hand: number; cards: Card[]; decision: Decision<Action> }
  | { type: "card"; hand: number; card: Card; cards: Card[] }
  | { type: "split"; hands: Card[][] }
  | { type: "reveal"; dealer: Card[] }
  | { type: "dealer-card"; card: Card; dealer: Card[] }
  | { type: "settle"; hands: SettledHand[]; net: number; bankroll: number };

export interface RoundInput {
  shoe: Shoe;
  jev: Decider;
  rules: Rules;
  bankroll: number;
  bet: number;
  /** Called after every move; the runner narrates it and waits about three seconds. */
  move: (event: TableEvent) => Promise<void> | void;
}

export interface RoundResult {
  dealer: Card[];
  hands: SettledHand[];
  insurance: { bet: number; payout: number } | null;
  decisions: DecisionRecord[];
  bankrollBefore: number;
  bankrollAfter: number;
  /** bankrollAfter - bankrollBefore. */
  net: number;
}

export function dealerShouldHit(cards: readonly Card[], rules: Rules): boolean {
  const { total, soft } = handTotal(cards);
  return total < 17 || (total === 17 && soft && rules.dealerHitsSoft17);
}

/** Legal moves for a hand, given the rules and what's left in the bankroll for extra bets. */
export function legalActions(hand: Hand, handCount: number, bankroll: number, rules: Rules): Action[] {
  const actions: Action[] = ["hit", "stand"];
  const twoCards = hand.cards.length === 2;
  const affordable = bankroll >= hand.bet;
  if (twoCards && affordable && (!hand.fromSplit || rules.doubleAfterSplit)) actions.push("double");
  const [a, b] = hand.cards;
  if (twoCards && affordable && a && b && cardValue(a) === cardValue(b) && handCount < rules.maxHands) {
    if (!(a.rank === "A" && hand.fromSplit && !rules.resplitAces)) actions.push("split");
  }
  if (twoCards && rules.lateSurrender && handCount === 1 && !hand.fromSplit) actions.push("surrender");
  return actions;
}

/**
 * Plays one round: Jev bets, the dealer deals, insurance and the peek, Jev's hands, the dealer's
 * hand, and settlement. Bets leave the bankroll when placed and payouts return to it.
 */
export async function playRound(input: RoundInput): Promise<RoundResult> {
  const { shoe, jev, rules, bet, move } = input;
  if (bet % 2 !== 0) throw new Error("the bet must be even so 3:2 and insurance pay whole amounts");
  const bankrollBefore = input.bankroll;
  let bankroll = bankrollBefore - bet;
  if (bankroll < 0) throw new Error("Jev can't cover the bet");
  const decisions: DecisionRecord[] = [];
  await move({ type: "bet", bet, bankroll });

  const first = [shoe.draw()];
  const dealer = [shoe.draw()];
  first.push(shoe.draw());
  dealer.push(shoe.draw());
  const dealerUp = dealer[0]!;
  const hands: Hand[] = [{ cards: first, bet, fromSplit: false, splitAces: false, doubled: false, surrendered: false }];
  await move({ type: "deal", cards: [...first], dealerUp });

  const view = (index: number): TableView => ({
    cards: hands[index]!.cards,
    dealerUp,
    handIndex: index,
    handCount: hands.length,
    bet: hands[index]!.bet,
    bankroll,
    rules,
  });

  let insurance: RoundResult["insurance"] = null;
  if (dealerUp.rank === "A" && bankroll >= bet / 2) {
    const decision = await jev.decideInsurance(view(0));
    decisions.push({ hand: 0, cards: [...first], dealerUp, legal: ["insure", "decline"], decision });
    if (decision.choice === "insure") {
      insurance = { bet: bet / 2, payout: 0 };
      bankroll -= insurance.bet;
    }
    await move({ type: "insurance", decision, bet: bet / 2 });
  }

  const finish = async (settled: SettledHand[]): Promise<RoundResult> => {
    for (const hand of settled) bankroll += hand.payout;
    const net = bankroll - bankrollBefore;
    await move({ type: "settle", hands: settled, net, bankroll });
    return { dealer, hands: settled, insurance, decisions, bankrollBefore, bankrollAfter: bankroll, net };
  };

  const settle = (hand: Hand, outcome: Outcome, payout: number): SettledHand => ({
    cards: hand.cards,
    bet: hand.bet,
    outcome,
    payout,
    net: payout - hand.bet,
    doubled: hand.doubled,
    fromSplit: hand.fromSplit,
  });

  const playerNatural = isNatural(first);
  if (dealerUp.rank === "A" || cardValue(dealerUp) === 10) {
    const dealerBlackjack = isNatural(dealer);
    await move({ type: "peek", dealerBlackjack });
    if (insurance && dealerBlackjack) {
      insurance.payout = insurance.bet * (1 + rules.insurancePays);
      bankroll += insurance.payout;
    }
    if (dealerBlackjack) {
      await move({ type: "reveal", dealer: [...dealer] });
      return finish([playerNatural ? settle(hands[0]!, "push", bet) : settle(hands[0]!, "lose", 0)]);
    }
  }

  if (playerNatural) {
    await move({ type: "reveal", dealer: [...dealer] });
    return finish([settle(hands[0]!, "blackjack", bet * (1 + rules.blackjackPays))]);
  }

  for (let index = 0; index < hands.length; index++) {
    const hand = hands[index]!;
    while (!hand.surrendered && !hand.splitAces && handTotal(hand.cards).total < 21) {
      const legal = legalActions(hand, hands.length, bankroll, rules);
      const decision = await jev.decideAction(view(index), legal);
      decisions.push({ hand: index, cards: [...hand.cards], dealerUp, legal, decision });
      await move({ type: "decision", hand: index, cards: [...hand.cards], decision });
      const action = decision.choice;

      if (action === "stand") break;
      if (action === "surrender") {
        hand.surrendered = true;
        break;
      }
      if (action === "split") {
        bankroll -= hand.bet;
        const moved = hand.cards.pop()!;
        const aces = moved.rank === "A";
        const sibling: Hand = { cards: [moved], bet: hand.bet, fromSplit: true, splitAces: aces, doubled: false, surrendered: false };
        hand.fromSplit = true;
        hand.splitAces = aces && !rules.hitSplitAces;
        sibling.splitAces = hand.splitAces;
        hand.cards.push(shoe.draw());
        sibling.cards.push(shoe.draw());
        hands.splice(index + 1, 0, sibling);
        await move({ type: "split", hands: hands.map((h) => [...h.cards]) });
        continue;
      }

      const card = shoe.draw();
      hand.cards.push(card);
      if (action === "double") {
        bankroll -= hand.bet;
        hand.bet *= 2;
        hand.doubled = true;
      }
      await move({ type: "card", hand: index, card, cards: [...hand.cards] });
      if (action === "double") break;
    }
  }

  await move({ type: "reveal", dealer: [...dealer] });
  const live = hands.some((h) => !h.surrendered && handTotal(h.cards).total <= 21);
  while (live && dealerShouldHit(dealer, rules)) {
    const card = shoe.draw();
    dealer.push(card);
    await move({ type: "dealer-card", card, dealer: [...dealer] });
  }

  const dealerTotal = handTotal(dealer).total;
  return finish(
    hands.map((hand) => {
      if (hand.surrendered) return settle(hand, "surrender", hand.bet / 2);
      const total = handTotal(hand.cards).total;
      if (total > 21) return settle(hand, "bust", 0);
      if (dealerTotal > 21 || total > dealerTotal) return settle(hand, "win", hand.bet * 2);
      if (total === dealerTotal) return settle(hand, "push", hand.bet);
      return settle(hand, "lose", 0);
    }),
  );
}
