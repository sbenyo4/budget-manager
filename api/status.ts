import type { ApiRequest, ApiResponse } from "./lib/http.js";
import { sendJson } from "./lib/http.js";
import { isOpenFinanceConfigured } from "./lib/openFinance.js";

export default function handler(_req: ApiRequest, res: ApiResponse) {
  sendJson(res, 200, { configured: isOpenFinanceConfigured() });
}
