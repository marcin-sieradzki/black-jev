import { createShoe } from "../src/engine/cards.js";
import { playRound, type TableEvent } from "../src/engine/game.js";
import type { Decider } from "../src/engine/jev.js";
import { money } from "../src/engine/narrate.js";
import { RULES } from "../src/engine/rules.js";
import { settleRound, sitDown, type HandRecord, type State } from "../src/engine/state.js";
import type { Kv } from "./kv.js";

export const BET = 10;
export const STARTING_BANKROLL = 1000;
/** Rounds kept in the history list; older ones are trimmed. */
export const HISTORY_LIMIT = 10_000;

export const KEYS = {
  table: "black-jev:table",
  history: "black-jev:history",
  lock: "black-jev:lock",
};

/** One step of a round as the page shows it: a move at the table, or a line from the dealer. */
export type Step = TableEvent | { type: "note"; text: string };

/** The round being shown. Every viewer plays the same steps back on the same clock. */
export interface CurrentRound {
  id: number;
  steps: Step[];
  stepMs: number;
  /** Step i shows at startedAt + i × stepMs; the next round may start at endsAt. */
  startedAt: number;
  endsAt: number;
  /** Jev's state when the round began (after any rebuy) and once it settled. */
  before: State;
  after: State;
  record: HandRecord;
}

/** Everything in the table key: what survives between requests. */
export interface TableRecord {
  state: State;
  shoe: string;
  current: CurrentRound | null;
}

export interface RoundResponse {
  current: CurrentRound | null;
  /** The server's clock, so a page can line its own up with it. */
  now: number;
}

/**
 * Jev plays only when someone is watching: each page asks for the round to show, and a new one
 * is dealt only once the last has played out. The round is played in full on the server, with
 * Jev's decisions, saved, and then shown one step at a time. A lock keeps two pages that ask at
 * the same moment from dealing two rounds.
 */
export async function nextRound(kv: Kv, decider: Decider, options: { now: number; stepMs: number }): Promise<RoundResponse> {
  const { now, stepMs } = options;
  const table = await kv.get<TableRecord>(KEYS.table);
  if (table?.current && now < table.current.endsAt) return { current: table.current, now };

  if (!(await kv.set(KEYS.lock, now, { nx: true, px: Math.min(15_000, stepMs * 2) }))) return { current: table?.current ?? null, now };
  // Another page may have dealt between the read and the lock.
  const fresh = await kv.get<TableRecord>(KEYS.table);
  if (fresh?.current && now < fresh.current.endsAt) return { current: fresh.current, now };

  const at = new Date(now);
  const { state: before, rebought } = sitDown(fresh?.state, { startingBankroll: STARTING_BANKROLL, bet: BET, now: at });
  const shoe = createShoe(RULES.decks, RULES.penetration, Math.random, fresh?.shoe);
  const steps: Step[] = [];
  if (rebought) steps.push({ type: "note", text: `Jev is broke. Rebuy #${before.rebuys}: bankroll ${money(before.bankroll)}.` });
  if (shoe.needsShuffle) {
    shoe.shuffle();
    steps.push({ type: "note", text: `The cut card is out: the dealer shuffles ${RULES.decks} decks.` });
  }

  const result = await playRound({
    shoe,
    jev: decider,
    rules: RULES,
    bankroll: before.bankroll,
    bet: BET,
    move: (event) => {
      steps.push(event);
    },
  });
  const { state: after, record } = settleRound(before, result, { bet: BET, now: at });
  const current: CurrentRound = {
    id: record.id,
    steps,
    stepMs,
    startedAt: now,
    // The settled result stays up for one step before the next deal.
    endsAt: now + steps.length * stepMs,
    before,
    after,
    record,
  };

  await kv.set(KEYS.table, { state: after, shoe: shoe.snapshot(), current } satisfies TableRecord);
  await kv.lpush(KEYS.history, JSON.stringify(record));
  await kv.ltrim(KEYS.history, 0, HISTORY_LIMIT - 1);
  return { current, now };
}

/** The latest rounds, newest first. */
export async function recentRounds(kv: Kv, limit: number): Promise<HandRecord[]> {
  const rows = await kv.lrange(KEYS.history, 0, Math.min(limit, HISTORY_LIMIT) - 1);
  return rows.map((row) => JSON.parse(row) as HandRecord);
}
