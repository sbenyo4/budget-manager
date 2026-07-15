import type { ApiRequest, ApiResponse } from "../server/http.js";
import { readJson, sendJson } from "../server/http.js";
import { currentUser } from "../server/auth.js";
import { getServiceSettings, type ServiceSettings } from "../server/db.js";
import { listAIModels } from "../server/aiModels.js";

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
    const saved = await getServiceSettings(user.id);
    const body = await readJson<Partial<Pick<ServiceSettings, "aiProvider" | "aiApiKey">>>(req);
    const provider = body.aiProvider === "anthropic" || body.aiProvider === "gemini" ? body.aiProvider : "openai";
    const apiKey = typeof body.aiApiKey === "string" && body.aiApiKey.trim() ? body.aiApiKey.trim() : saved.aiApiKey;
    sendJson(res, 200, { models: await listAIModels(provider, apiKey) });
  } catch (err) {
    sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
  }
}
