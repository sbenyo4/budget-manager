import type { ApiRequest, ApiResponse } from "../server/http.js";
import { sendJson } from "../server/http.js";
import { isOpenFinanceConfigured } from "../server/openFinance.js";
import { currentUnlockedUser } from "../server/auth.js";
import { getServiceSettings } from "../server/db.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const user = await currentUnlockedUser(req);
    if (!user) {
      sendJson(res, 200, { configured: false });
      return;
    }
    sendJson(res, 200, { configured: isOpenFinanceConfigured(await getServiceSettings(user.id)) });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err), configured: false });
  }
}
