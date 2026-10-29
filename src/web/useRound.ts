import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { HandRecord } from "../engine/state.js";
import type { CurrentRound, RoundResponse } from "../../server/round.js";
import { emptyTable, note, reduceTable, type Table } from "./table.js";

export type Status = "connecting" | "playing" | "waiting" | "paused" | "hidden" | "offline";

function subscribeVisibility(callback: () => void) {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}

const isVisible = () => document.visibilityState === "visible";

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {}
  return `The table answered ${response.status}.`;
}

/** The table at step `index` of a round. */
export function tableAt(round: CurrentRound, index: number): Table {
  let table = emptyTable;
  for (const step of round.steps.slice(0, index + 1)) {
    table = step.type === "note" ? note(table, step.text) : reduceTable(table, step, round.id);
  }
  return table;
}

/**
 * Follows the table while this tab is visible and not paused: asks the server for the round to
 * show, plays its steps back on the server's clock, and asks again when it has played out. Jev
 * only plays while some tab is asking.
 */
export function useRound(paused: boolean) {
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, () => true);
  const following = visible && !paused;
  const [round, setRound] = useState<CurrentRound | null>(null);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HandRecord[]>([]);

  useEffect(() => {
    if (!following) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      try {
        const response = await fetch("/api/round", { method: "POST" });
        if (!response.ok) throw new Error(await readError(response));
        const body = (await response.json()) as RoundResponse;
        if (cancelled) return;
        setOffset(body.now - Date.now());
        setRound(body.current);
        setError(null);
        // No round, or one that has played out while another page deals: ask again shortly.
        const wait = body.current && body.current.endsAt > body.now ? body.current.endsAt - body.now : 1000;
        timer = setTimeout(ask, wait);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        timer = setTimeout(ask, 5000);
      }
    };
    void ask();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [following]);

  useEffect(() => {
    if (!following) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [following]);

  const index = round ? Math.min(round.steps.length - 1, Math.floor((now + offset - round.startedAt) / round.stepMs)) : -1;
  const settled = round ? round.steps.slice(0, index + 1).some((step) => step.type === "settle") : false;
  const table = useMemo(() => (round && index >= 0 ? tableAt(round, index) : emptyTable), [round, index]);

  // The history list catches up once a round's result is on the table.
  const historyKey = round ? `${round.id}:${settled}` : "none";
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    fetch("/api/history?limit=20")
      .then((response) => (response.ok ? (response.json() as Promise<HandRecord[]>) : null))
      .then((rounds) => {
        if (!cancelled && rounds) setHistory(settled || !round ? rounds : rounds.filter((r) => r.id !== round.id));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch per round and result, not per tick
  }, [historyKey, visible]);

  const status: Status =
    !visible ? "hidden"
    : paused ? "paused"
    : error ? "offline"
    : !round ? "connecting"
    : now + offset >= round.endsAt ? "waiting"
    : "playing";

  return {
    status,
    error,
    round,
    table,
    step: index,
    settled,
    /** Jev's state as the table shows it: the result only counts once it's on the table. */
    state: round ? (settled ? round.after : round.before) : null,
    history,
  };
}
