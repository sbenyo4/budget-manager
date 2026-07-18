import type { ApiRequest, ApiResponse } from "../../server/http.js";
import { sendJson } from "../../server/http.js";
import { currentSessionToken, tokenHash } from "../../server/auth.js";
import { deleteSession } from "../../server/db.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  try {
    const token = currentSessionToken(req);
    if (token) await deleteSession(tokenHash(token));
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
