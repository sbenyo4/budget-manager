import type { ApiRequest, ApiResponse } from "../../server/http.js";
import { sendJson } from "../../server/http.js";
import { currentUser } from "../../server/auth.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    sendJson(res, 200, { user: await currentUser(req) });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
