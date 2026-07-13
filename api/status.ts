import type { ApiRequest, ApiResponse } from "./lib/http.js";
import { sendJson } from "./lib/http.js";
import { isOpenFinanceConfigured } from "./lib/openFinance.js";
import { currentUser } from "./lib/auth.js";
import { getServiceSettings } from "./lib/db.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const user = await currentUser(req);
    if (!user) {
      sendJson(res, 200, { configured: false });
      return;
    }
    sendJson(res, 200, { configured: isOpenFinanceConfigured(await getServiceSettings(user.id)) });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err), configured: false });
  }
}
