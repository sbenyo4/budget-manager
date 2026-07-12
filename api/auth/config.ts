import type { ApiRequest, ApiResponse } from "../lib/http.js";
import { sendJson } from "../lib/http.js";

export default function handler(_req: ApiRequest, res: ApiResponse) {
  sendJson(res, 200, { googleClientId: process.env.GOOGLE_CLIENT_ID ?? "" });
}
