import type { ApiRequest, ApiResponse } from "../_lib/http";
import { sendJson } from "../_lib/http";
import { currentSessionToken, sessionCookie, tokenHash } from "../_lib/auth";
import { deleteSession } from "../_lib/db";

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
    res.setHeader("Set-Cookie", sessionCookie("", 0));
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

