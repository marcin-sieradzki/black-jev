import { Redis } from "@upstash/redis";

/** The few Redis commands the table needs, so tests and local dev can run without Upstash. */
export interface Kv {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options?: { nx?: boolean; px?: number }): Promise<boolean>;
  lpush(key: string, value: string): Promise<void>;
  ltrim(key: string, start: number, stop: number): Promise<void>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
}

/** Upstash over REST, from the environment variables Upstash or Vercel's Upstash integration set. */
export function upstashKv(env: Record<string, string | undefined> = process.env): Kv | null {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  // Values go in and out as JSON strings we write ourselves, so they come back exactly as stored.
  const redis = new Redis({ url, token, automaticDeserialization: false });
  return {
    async get<T>(key: string) {
      const value = await redis.get<string>(key);
      return value === null ? null : (JSON.parse(value) as T);
    },
    async set(key, value, options = {}) {
      const json = JSON.stringify(value);
      const result =
        options.nx && options.px ? await redis.set(key, json, { nx: true, px: options.px })
        : options.px ? await redis.set(key, json, { px: options.px })
        : await redis.set(key, json);
      return result === "OK";
    },
    async lpush(key, value) {
      await redis.lpush(key, value);
    },
    async ltrim(key, start, stop) {
      await redis.ltrim(key, start, stop);
    },
    async lrange(key, start, stop) {
      return redis.lrange<string>(key, start, stop);
    },
  };
}

/** Redis in memory, for tests and `npm run dev`. Gone when the process stops. */
export function memoryKv(clock: () => number = Date.now): Kv {
  const values = new Map<string, { json: string; expires: number }>();
  const lists = new Map<string, string[]>();
  const live = (key: string) => {
    const entry = values.get(key);
    if (entry && entry.expires <= clock()) values.delete(key);
    return values.get(key);
  };
  return {
    async get<T>(key: string) {
      const entry = live(key);
      return entry ? (JSON.parse(entry.json) as T) : null;
    },
    async set(key, value, options = {}) {
      if (options.nx && live(key)) return false;
      values.set(key, { json: JSON.stringify(value), expires: options.px ? clock() + options.px : Infinity });
      return true;
    },
    async lpush(key, value) {
      lists.set(key, [value, ...(lists.get(key) ?? [])]);
    },
    async ltrim(key, start, stop) {
      lists.set(key, (lists.get(key) ?? []).slice(start, stop + 1));
    },
    async lrange(key, start, stop) {
      return (lists.get(key) ?? []).slice(start, stop + 1);
    },
  };
}
