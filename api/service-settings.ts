import type { ApiRequest, ApiResponse } from "./lib/http.js";
import { readJson, sendJson } from "./lib/http.js";
import { currentUser } from "./lib/auth.js";
import {
  getServiceSettings,
  upsertServiceSettings,
  type ServiceSettings,
} from "./lib/db.js";

function normalizeServiceSettings(body: Partial<ServiceSettings>): ServiceSettings {
  return {
    openFinanceClientId: typeof body.openFinanceClientId === "string" ? body.openFinanceClientId.trim() : "",
    openFinanceClientSecret:
      typeof body.openFinanceClientSecret === "string" ? body.openFinanceClientSecret.trim() : "",
    openFinanceUserId: typeof body.openFinanceUserId === "string" ? body.openFinanceUserId.trim() : "",
    openFinanceApiPrefix:
      typeof body.openFinanceApiPrefix === "string" && body.openFinanceApiPrefix.trim()
        ? body.openFinanceApiPrefix.trim()
        : "api",
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

    if (req.method === "PUT") {
      const settings = normalizeServiceSettings(await readJson<Partial<ServiceSettings>>(req));
      await upsertServiceSettings(user.id, settings);
      sendJson(res, 200, settings);
      return;
    }

    res.statusCode = 405;
    res.setHeader("Allow", "GET, PUT");
    res.end("Method Not Allowed");
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
