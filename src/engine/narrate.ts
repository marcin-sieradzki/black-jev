import { formatCard, formatCards, formatTotal } from "./cards.js";
import type { TableEvent } from "./game.js";
import type { Decision } from "./jev.js";

export const money = (amount: number): string =>
  `${amount < 0 ? "-" : ""}$${Math.abs(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

const percent = (p: number | undefined): string => `${Math.round((p ?? 0) * 100)}%`;

/** Jev doesn't chat: it states the choice, the distribution and its confidence. */
function decided<T extends string>(decision: Decision<T>): string {
  const spread = Object.entries(decision.probabilities as Record<string, number>)
    .sort(([, a], [, b]) => b - a)
    .map(([option, p]) => `${option} ${percent(p)}`)
    .join(" · ");
  const note = decision.fallback ? `  [stand-in: ${decision.fallback}]` : "";
  return `Jev → ${decision.choice.toUpperCase()}   (${spread}; confidence ${decision.confidence.toFixed(2)})${note}`;
}

/** One line per move. */
export function narrate(event: TableEvent): string {
  switch (event.type) {
    case "bet":
      return `Jev bets ${money(event.bet)}`;
    case "deal":
      return `Jev has ${formatCards(event.cards)} (${formatTotal(event.cards)}) · dealer shows ${formatCard(event.dealerUp)}`;
    case "insurance":
      return `Insurance for ${money(event.bet)}? ${decided(event.decision)}`;
    case "peek":
      return event.dealerBlackjack ? "Dealer checks the hole card: blackjack." : "Dealer checks the hole card: no blackjack.";
    case "decision":
      return `Hand ${event.hand + 1}, ${formatTotal(event.cards)}: ${decided(event.decision)}`;
    case "card":
      return `  ${formatCard(event.card)} → ${formatCards(event.cards)} (${formatTotal(event.cards)})`;
    case "split":
      return `  Split: ${event.hands.map((h) => `[${formatCards(h)}]`).join(" ")}`;
    case "reveal":
      return `Dealer turns over: ${formatCards(event.dealer)} (${formatTotal(event.dealer)})`;
    case "dealer-card":
      return `  Dealer draws ${formatCard(event.card)} → ${formatTotal(event.dealer)}`;
    case "settle": {
      const hands = event.hands.map((h) => `${h.outcome} ${h.net >= 0 ? "+" : ""}${money(h.net)}`).join(", ");
      return `Result: ${hands} · round ${event.net >= 0 ? "+" : ""}${money(event.net)} · bankroll ${money(event.bankroll)}`;
    }
  }
}
