import type { ApiRequest, ApiResponse } from "./lib/http";
import { readJson, sendJson } from "./lib/http";
import { currentUser } from "./lib/auth";
import { getPreferences, upsertPreferences, type BudgetPreferences } from "./lib/db";

function normalizePreferences(body: Partial<BudgetPreferences>): BudgetPreferences {
  return {
    sectionOverrides:
      body.sectionOverrides && typeof body.sectionOverrides === "object" ? body.sectionOverrides : {},
    oneTimeExpenses: Array.isArray(body.oneTimeExpenses) ? body.oneTimeExpenses : [],
    fixedExpenses: Array.isArray(body.fixedExpenses) ? body.fixedExpenses : [],
  };
}

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

    if (req.method === "PUT") {
      const prefs = normalizePreferences(await readJson<Partial<BudgetPreferences>>(req));
      await upsertPreferences(user.id, prefs);
      sendJson(res, 200, prefs);
      return;
    }

    res.statusCode = 405;
    res.setHeader("Allow", "GET, PUT");
    res.end("Method Not Allowed");
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
