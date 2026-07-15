import type { ApiRequest, ApiResponse } from "../server/http.js";
import { readJson, sendJson } from "../server/http.js";
import { currentUser } from "../server/auth.js";
import {
  getServiceSettings,
  upsertServiceSettings,
  type ServiceSettings,
} from "../server/db.js";

function normalizeServiceSettings(body: Partial<ServiceSettings>): ServiceSettings {
  const provider = body.aiProvider === "anthropic" || body.aiProvider === "gemini" ? body.aiProvider : "openai";
  return {
    openFinanceClientId: typeof body.openFinanceClientId === "string" ? body.openFinanceClientId.trim() : "",
    openFinanceClientSecret:
      typeof body.openFinanceClientSecret === "string" ? body.openFinanceClientSecret.trim() : "",
    openFinanceUserId: typeof body.openFinanceUserId === "string" ? body.openFinanceUserId.trim() : "",
    openFinanceApiPrefix:
      typeof body.openFinanceApiPrefix === "string" && body.openFinanceApiPrefix.trim()
        ? body.openFinanceApiPrefix.trim()
        : "api",
    aiProvider: provider,
    aiApiKey: typeof body.aiApiKey === "string" ? body.aiApiKey.trim() : "",
    aiModel:
      typeof body.aiModel === "string" && body.aiModel.trim()
        ? body.aiModel.trim()
        : provider === "anthropic"
          ? "claude-haiku-4-5"
          : provider === "gemini"
            ? "gemini-2.0-flash"
            : "gpt-4o-mini",
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const user = await currentUser(req);
    if (!user) {
      sendJson(res, 401, { error: "AUTH_REQUIRED" });
      return;
    }

    if (req.method === "GET") {
      sendJson(res, 200, await getServiceSettings(user.id));
      return;
    }

    if (req.method === "PUT" || req.method === "PATCH") {
      const body = await readJson<Partial<ServiceSettings>>(req);
      const base = req.method === "PATCH" ? await getServiceSettings(user.id) : {};
      const settings = normalizeServiceSettings({ ...base, ...body });
      await upsertServiceSettings(user.id, settings);
      sendJson(res, 200, settings);
      return;
    }

    res.statusCode = 405;
    res.setHeader("Allow", "GET, PUT, PATCH");
    res.end("Method Not Allowed");
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
