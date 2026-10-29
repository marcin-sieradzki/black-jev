import type { Card } from "./cards.js";
import type { DecisionRecord, Outcome, RoundResult } from "./game.js";

export interface Stats {
  /** Rounds played. */
  hands: number;
  /** Hands by outcome; a split round counts each of its hands. */
  outcomes: Record<Outcome, number>;
  wagered: number;
  net: number;
  peak: number;
  trough: number;
  /** TypeSafe calls that fell back to the stand-in. */
  fallbacks: number;
}

/** What survives a restart: the bankroll and the running totals. */
export interface State {
  version: 1;
  bankroll: number;
  startingBankroll: number;
  /** Times Jev went broke and bought back in with the starting bankroll. */
  rebuys: number;
  stats: Stats;
  startedAt: string;
  updatedAt: string;
}

/** One round of history. */
export interface HandRecord {
  id: number;
  at: string;
  bet: number;
  dealer: Card[];
  hands: RoundResult["hands"];
  insurance: RoundResult["insurance"];
  decisions: DecisionRecord[];
  net: number;
  bankroll: number;
}

export function freshState(startingBankroll: number, now = new Date()): State {
  return {
    version: 1,
    bankroll: startingBankroll,
    startingBankroll,
    rebuys: 0,
    stats: {
      hands: 0,
      outcomes: { blackjack: 0, win: 0, push: 0, lose: 0, bust: 0, surrender: 0 },
      wagered: 0,
      net: 0,
      peak: startingBankroll,
      trough: startingBankroll,
      fallbacks: 0,
    },
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/** Folds a finished round into the state. Pure, so the runner and tests share it. */
export function applyRound(state: State, result: RoundResult, now = new Date()): State {
  const stats = structuredClone(state.stats);
  stats.hands++;
  for (const hand of result.hands) {
    stats.outcomes[hand.outcome]++;
    stats.wagered += hand.bet;
  }
  if (result.insurance) stats.wagered += result.insurance.bet;
  stats.net += result.net;
  stats.peak = Math.max(stats.peak, result.bankrollAfter);
  stats.trough = Math.min(stats.trough, result.bankrollAfter);
  stats.fallbacks += result.decisions.filter((d) => d.decision.fallback).length;
  return { ...state, bankroll: result.bankrollAfter, stats, updatedAt: now.toISOString() };
}

export function toRecord(id: number, bet: number, result: RoundResult, now = new Date()): HandRecord {
  return {
    id,
    at: now.toISOString(),
    bet,
    dealer: result.dealer,
    hands: result.hands,
    insurance: result.insurance,
    decisions: result.decisions,
    net: result.net,
    bankroll: result.bankrollAfter,
  };
}
