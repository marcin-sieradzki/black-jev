import { useEffect, useState, useSyncExternalStore } from "react";
import type { HandRecord } from "../engine/state.js";
import type { CurrentRound, RoundResponse } from "../../server/round.js";
import { playback, shownHistory } from "./playback.js";

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

  const shown = playback(round, now + offset);

  // The history list catches up once a round's result is on the table.
  const historyKey = round ? `${round.id}:${shown.settled}` : "none";
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    fetch("/api/history?limit=20")
      .then((response) => (response.ok ? (response.json() as Promise<HandRecord[]>) : null))
      .then((rounds) => {
        if (!cancelled && rounds) setHistory(rounds);
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
    : shown.ended ? "waiting"
    : "playing";

  return {
    ...shown,
    status,
    error,
    round,
    serverNow: now + offset,
    history: shownHistory(history, shown),
  };
}
