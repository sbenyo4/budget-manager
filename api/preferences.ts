import type { ApiRequest, ApiResponse } from "../server/http.js";
import { readJson, sendJson } from "../server/http.js";
import { currentSessionToken, currentUser, tokenHash } from "../server/auth.js";
import {
  getPreferences,
  patchStoredPreferencesForSession,
  upsertPreferences,
  type BudgetPreferences,
} from "../server/db.js";
import { normalizePreferences, normalizePreferencesPatch } from "../server/preferences.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const startedAt = Date.now();
  const requestId = req.headers["x-vercel-id"] ?? "";
  try {
    if (req.method === "PATCH") {
      const sessionToken = currentSessionToken(req);
      if (!sessionToken) {
        sendJson(res, 401, { error: "AUTH_REQUIRED" });
        console.log(JSON.stringify({ level: "info", route: "/api/preferences", method: "PATCH", status: 401, requestId, ms: Date.now() - startedAt }));
        return;
      }
      const body = await readJson<Partial<BudgetPreferences>>(req);
      const saved = await patchStoredPreferencesForSession(
        tokenHash(sessionToken),
        Date.now(),
        normalizePreferencesPatch(body)
      );
      if (!saved) {
        sendJson(res, 401, { error: "AUTH_REQUIRED" });
        console.log(JSON.stringify({ level: "info", route: "/api/preferences", method: "PATCH", status: 401, requestId, path: "single-query", ms: Date.now() - startedAt }));
        return;
      }
      sendJson(res, 200, saved);
      console.log(JSON.stringify({ level: "info", route: "/api/preferences", method: "PATCH", status: 200, requestId, path: "single-query", ms: Date.now() - startedAt }));
      return;
    }

    const user = await currentUser(req);
    if (!user) {
      sendJson(res, 401, { error: "AUTH_REQUIRED" });
      console.log(JSON.stringify({ level: "info", route: "/api/preferences", method: req.method, status: 401, requestId, ms: Date.now() - startedAt }));
      return;
    }

    if (req.method === "GET") {
      sendJson(res, 200, await getPreferences(user.id));
      console.log(JSON.stringify({ level: "info", route: "/api/preferences", method: "GET", status: 200, requestId, ms: Date.now() - startedAt }));
      return;
    }

    if (req.method === "PUT") {
      const body = await readJson<Partial<BudgetPreferences>>(req);
      const prefs = normalizePreferences(body);
      await upsertPreferences(user.id, prefs);
      sendJson(res, 200, prefs);
      console.log(JSON.stringify({ level: "info", route: "/api/preferences", method: "PUT", status: 200, requestId, ms: Date.now() - startedAt }));
      return;
    }

    res.statusCode = 405;
    res.setHeader("Allow", "GET, PUT, PATCH");
    res.end("Method Not Allowed");
  } catch (err) {
    console.error(JSON.stringify({
      level: "error",
      route: "/api/preferences",
      method: req.method,
      requestId,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - startedAt,
    }));
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
