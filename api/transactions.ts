import type { ApiRequest, ApiResponse } from "./lib/http.js";
import { getQueryParam, sendJson } from "./lib/http.js";
import { getTransactions, isOpenFinanceConfigured } from "./lib/openFinance.js";
import { currentUser } from "./lib/auth.js";
import { getServiceSettings } from "./lib/db.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const from = getQueryParam(req, "from") ?? "";
  const to = getQueryParam(req, "to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    sendJson(res, 400, { error: "from/to must be YYYY-MM-DD" });
    return;
  }

  try {
    const user = await currentUser(req);
    if (!user) {
      sendJson(res, 401, { error: "AUTH_REQUIRED" });
      return;
    }
    const settings = await getServiceSettings(user.id);
    if (!isOpenFinanceConfigured(settings)) {
      sendJson(res, 503, { error: "NOT_CONFIGURED" });
      return;
    }
    sendJson(res, 200, await getTransactions(settings, from, to));
  } catch (err) {
    sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
  }
}
