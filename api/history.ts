import { envFromProcess, handleHistory } from "../server/handlers.js";

export function GET(request: Request): Promise<Response> {
  return handleHistory(envFromProcess(), request);
}
