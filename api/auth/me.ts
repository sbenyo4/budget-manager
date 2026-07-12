import type { ApiRequest, ApiResponse } from "../_lib/http";
import { sendJson } from "../_lib/http";
import { currentUser } from "../_lib/auth";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    sendJson(res, 200, { user: await currentUser(req) });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

