import type { ApiRequest, ApiResponse } from "./_lib/http";
import { sendJson } from "./_lib/http";
import { isOpenFinanceConfigured } from "./_lib/openFinance";

export default function handler(_req: ApiRequest, res: ApiResponse) {
  sendJson(res, 200, { configured: isOpenFinanceConfigured() });
}

