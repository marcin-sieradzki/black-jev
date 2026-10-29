import { localJev, typeSafeJev, type Decider } from "../src/engine/jev.js";
import { upstashKv, type Kv } from "./kv.js";
import { nextRound, recentRounds } from "./round.js";

export interface Env {
  kv: Kv | null;
  decider: Decider;
  stepMs: number;
  now: () => number;
}

/** Upstash and Jev from the environment: TYPESAFE_API_KEY lets the real Jev decide. */
export function envFromProcess(env: Record<string, string | undefined> = process.env): Env {
  const key = env.TYPESAFE_API_KEY;
  return {
    kv: upstashKv(env),
    decider: key ? typeSafeJev({ apiKey: key, url: env.TYPESAFE_API_URL, model: env.JEV_MODEL }) : localJev,
    stepMs: Number(env.STEP_MS) || 5000,
    now: Date.now,
  };
}

const noStore = { "cache-control": "no-store" };

function unconfigured(): Response {
  return Response.json(
    { error: "Upstash isn't configured: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN." },
    { status: 503, headers: noStore },
  );
}

/** POST /api/round: the round to show now, dealing a new one if the last has played out. */
export async function handleRound(env: Env): Promise<Response> {
  if (!env.kv) return unconfigured();
  const body = await nextRound(env.kv, env.decider, { now: env.now(), stepMs: env.stepMs });
  return Response.json(body, { headers: noStore });
}

/** GET /api/history?limit=20, or ?format=jsonl to download every kept round. */
export async function handleHistory(env: Env, request: Request): Promise<Response> {
  if (!env.kv) return unconfigured();
  const url = new URL(request.url);
  if (url.searchParams.get("format") === "jsonl") {
    const rounds = await recentRounds(env.kv, Infinity);
    const body = rounds.reverse().map((round) => JSON.stringify(round)).join("\n") + "\n";
    return new Response(body, {
      headers: {
        ...noStore,
        "content-type": "application/x-ndjson",
        "content-disposition": 'attachment; filename="black-jev-history.jsonl"',
      },
    });
  }
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 20));
  return Response.json(await recentRounds(env.kv, limit), { headers: noStore });
}
