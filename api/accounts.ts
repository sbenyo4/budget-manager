import type { ApiRequest, ApiResponse } from "../server/http.js";
import { sendJson } from "../server/http.js";
import { getAccounts, isOpenFinanceConfigured } from "../server/openFinance.js";
import { currentUser } from "../server/auth.js";
import { getServiceSettings } from "../server/db.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
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
    sendJson(res, 200, await getAccounts(settings));
  } catch (err) {
    sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
  }
}
