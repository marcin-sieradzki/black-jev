import { envFromProcess, handleRound } from "../server/handlers.js";

export function POST(): Promise<Response> {
  return handleRound(envFromProcess());
}
