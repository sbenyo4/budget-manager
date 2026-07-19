import type { ApiRequest, ApiResponse } from "../server/http.js";
import { sendJson } from "../server/http.js";
import { getAccounts, isOpenFinanceConfigured } from "../server/openFinance.js";
import { currentUnlockedUser } from "../server/auth.js";
import { getServiceSettings } from "../server/db.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end("Method Not Allowed");
    return;
  }
  try {
    const user = await currentUnlockedUser(req);
    if (!user) {
      sendJson(res, 401, { error: "PIN_REQUIRED" });
      return;
    }
    const settings = await getServiceSettings(user.id);
    if (!isOpenFinanceConfigured(settings)) {
      sendJson(res, 503, { error: "NOT_CONFIGURED" });
      return;
    }
    sendJson(res, 200, await getAccounts(settings));
  } catch (err) {
    sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
  }
}
