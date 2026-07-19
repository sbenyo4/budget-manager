import type { ApiRequest, ApiResponse } from "../server/http.js";
import { readJson, sendJson } from "../server/http.js";
import { currentUser } from "../server/auth.js";
import { PREFS_DEFAULT, getPreferences, upsertPreferences, type BudgetPreferences } from "../server/db.js";
import { normalizePreferences } from "../server/preferences.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const user = await currentUser(req);
    if (!user) {
      sendJson(res, 401, { error: "AUTH_REQUIRED" });
      return;
    }

    if (req.method === "GET") {
      sendJson(res, 200, await getPreferences(user.id));
      return;
    }

    if (req.method === "PUT" || req.method === "PATCH") {
      const body = await readJson<Partial<BudgetPreferences>>(req);
      const base = req.method === "PATCH" ? await getPreferences(user.id) : PREFS_DEFAULT;
      const prefs = normalizePreferences({ ...base, ...body });
      await upsertPreferences(user.id, prefs);
      sendJson(res, 200, prefs);
      return;
    }

    res.statusCode = 405;
    res.setHeader("Allow", "GET, PUT, PATCH");
    res.end("Method Not Allowed");
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
