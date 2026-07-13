import type { ApiRequest, ApiResponse } from "../../server/http.js";
import { sendJson } from "../../server/http.js";

export default function handler(_req: ApiRequest, res: ApiResponse) {
  sendJson(res, 200, { googleClientId: process.env.GOOGLE_CLIENT_ID ?? "" });
}
