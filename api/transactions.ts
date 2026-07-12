import type { ApiRequest, ApiResponse } from "./_lib/http";
import { getQueryParam, sendJson } from "./_lib/http";
import { getTransactions, isOpenFinanceConfigured } from "./_lib/openFinance";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!isOpenFinanceConfigured()) {
    sendJson(res, 503, { error: "NOT_CONFIGURED" });
    return;
  }

  const from = getQueryParam(req, "from") ?? "";
  const to = getQueryParam(req, "to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    sendJson(res, 400, { error: "from/to must be YYYY-MM-DD" });
    return;
  }

  try {
    sendJson(res, 200, await getTransactions(from, to));
  } catch (err) {
    sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
  }
}

