import type { ApiRequest, ApiResponse } from "../_lib/http";
import { sendJson } from "../_lib/http";

export default function handler(_req: ApiRequest, res: ApiResponse) {
  sendJson(res, 200, { googleClientId: process.env.GOOGLE_CLIENT_ID ?? "" });
}

