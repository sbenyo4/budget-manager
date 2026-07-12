import type { ApiRequest, ApiResponse } from "../lib/http.js";
import { readJson, sendJson } from "../lib/http.js";
import { createSessionToken, sessionCookie, tokenHash, verifyGoogleCredential } from "../lib/auth.js";
import { insertSession, upsertUser } from "../lib/db.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID ?? "";
  if (!googleClientId) {
    sendJson(res, 500, { error: "GOOGLE_CLIENT_ID is not configured" });
    return;
  }

  try {
    const body = await readJson<{ credential?: string }>(req);
    if (!body.credential) throw new Error("Missing Google credential");
    const payload = await verifyGoogleCredential(body.credential, googleClientId);
    const user = {
      id: payload.sub,
      email: payload.email ?? "",
      name: payload.name ?? "",
      picture: payload.picture ?? "",
    };
    await upsertUser(user);
    const token = createSessionToken();
    const maxAge = 60 * 60 * 24 * 30;
    await insertSession(tokenHash(token), user.id, Date.now() + maxAge * 1000);
    res.setHeader("Set-Cookie", sessionCookie(token, maxAge));
    sendJson(res, 200, { user });
  } catch (err) {
    sendJson(res, 401, { error: err instanceof Error ? err.message : String(err) });
  }
}
