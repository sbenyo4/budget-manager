import type { ApiRequest, ApiResponse } from "../../server/http.js";
import { readJson, sendJson } from "../../server/http.js";
import { createSessionToken, tokenHash, verifyGoogleCredential } from "../../server/auth.js";
import { createGoogleLoginSession } from "../../server/db.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const startedAt = Date.now();
  const requestId = req.headers["x-vercel-id"] ?? "";
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
    const googleStartedAt = Date.now();
    const payload = await verifyGoogleCredential(body.credential, googleClientId);
    const googleVerifyMs = Date.now() - googleStartedAt;
    const user = {
      id: payload.sub,
      email: payload.email ?? "",
      name: payload.name ?? "",
      picture: payload.picture ?? "",
    };
    const token = createSessionToken();
    const maxAge = 60 * 60 * 12;
    const databaseStartedAt = Date.now();
    const bootstrap = await createGoogleLoginSession(
      user,
      tokenHash(token),
      Date.now() + maxAge * 1000
    );
    const databaseMs = Date.now() - databaseStartedAt;
    const totalMs = Date.now() - startedAt;
    res.setHeader("Server-Timing", `google;dur=${googleVerifyMs}, db;dur=${databaseMs}`);
    sendJson(res, 200, { user, token, ...bootstrap });
    console.log(JSON.stringify({
      level: "info",
      route: "/api/auth/google",
      method: "POST",
      status: 200,
      requestId,
      googleVerifyMs,
      databaseMs,
      ms: totalMs,
    }));
  } catch (err) {
    console.error(JSON.stringify({
      level: "error",
      route: "/api/auth/google",
      method: "POST",
      status: 401,
      requestId,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - startedAt,
    }));
    sendJson(res, 401, { error: err instanceof Error ? err.message : String(err) });
  }
}
