import type { ApiRequest, ApiResponse } from "../lib/http.js";
import { sendJson } from "../lib/http.js";
import { currentUser } from "../lib/auth.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    sendJson(res, 200, { user: await currentUser(req) });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
