import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { envFromProcess, handleHistory, handleRound, type Env } from "./server/handlers.js";
import { memoryKv } from "./server/kv.js";

/**
 * Serves /api/round and /api/history in `npm run dev`, as Vercel does in production: with
 * Upstash when .env.local sets it, otherwise with Redis in memory.
 */
function api(): Plugin {
  return {
    name: "black-jev-api",
    configureServer(server) {
      const fromFile = loadEnv(server.config.mode, process.cwd(), "");
      const fromEnv = envFromProcess({ ...fromFile, ...process.env });
      const env: Env = { ...fromEnv, kv: fromEnv.kv ?? memoryKv() };
      const send = async (res: ServerResponse, response: Response) => {
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      };
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname === "/api/round" && req.method === "POST") return send(res, await handleRound(env));
        if (url.pathname === "/api/history" && req.method === "GET") return send(res, await handleHistory(env, new Request(url)));
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), api()],
});
