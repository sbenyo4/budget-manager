import type { ApiRequest, ApiResponse } from "./_lib/http";
import { sendJson } from "./_lib/http";
import { getAccounts, isOpenFinanceConfigured } from "./_lib/openFinance";

export default async function handler(_req: ApiRequest, res: ApiResponse) {
  if (!isOpenFinanceConfigured()) {
    sendJson(res, 503, { error: "NOT_CONFIGURED" });
    return;
  }

  try {
    sendJson(res, 200, await getAccounts());
  } catch (err) {
    sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
  }
}

