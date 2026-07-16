import type { ApiRequest, ApiResponse } from "../server/http.js";
import { getQueryParam, sendJson } from "../server/http.js";
import { getTransactions, isOpenFinanceConfigured } from "../server/openFinance.js";
import { currentUser } from "../server/auth.js";
import { getServiceSettings } from "../server/db.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end("Method Not Allowed");
    return;
  }
  const from = getQueryParam(req, "from") ?? "";
  const to = getQueryParam(req, "to") ?? "";
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  };
  if (!validDate(from) || !validDate(to) || from > to) {
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
