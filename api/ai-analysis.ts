import type { ApiRequest, ApiResponse } from "../server/http.js";
import { readJson, sendJson } from "../server/http.js";
import { currentUser } from "../server/auth.js";
import { getServiceSettings } from "../server/db.js";
import { analyzeBudget, type AIAnalysisPayload } from "../server/aiAnalysis.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  try {
    const user = await currentUser(req);
    if (!user) {
      sendJson(res, 401, { error: "AUTH_REQUIRED" });
      return;
    }
    const settings = await getServiceSettings(user.id);
    const payload = await readJson<AIAnalysisPayload>(req);
    sendJson(res, 200, await analyzeBudget(settings, payload));
  } catch (err) {
    sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
  }
}
