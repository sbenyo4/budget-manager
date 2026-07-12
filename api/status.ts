import type { ApiRequest, ApiResponse } from "./lib/http";
import { sendJson } from "./lib/http";
import { isOpenFinanceConfigured } from "./lib/openFinance";

export default function handler(_req: ApiRequest, res: ApiResponse) {
  sendJson(res, 200, { configured: isOpenFinanceConfigured() });
}
