import type { ApiRequest, ApiResponse } from "../server/http.js";
import { readJson, sendJson } from "../server/http.js";
import { currentUnlockedUser } from "../server/auth.js";
import {
  getServiceSettings,
  upsertServiceSettings,
  type ServiceSettings,
} from "../server/db.js";
import { InvalidOpenFinanceApiPrefixError } from "../server/openFinanceEndpoint.js";
import { normalizeServiceSettings, publicServiceSettings } from "../server/serviceSettings.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const user = await currentUnlockedUser(req);
    if (!user) {
      sendJson(res, 401, { error: "PIN_REQUIRED" });
      return;
    }

    if (req.method === "GET") {
      sendJson(res, 200, publicServiceSettings(await getServiceSettings(user.id)));
      return;
    }

    if (req.method === "PUT" || req.method === "PATCH") {
      const body = await readJson<Partial<ServiceSettings>>(req);
      const base = req.method === "PATCH" ? await getServiceSettings(user.id) : {};
      const settings = normalizeServiceSettings({ ...base, ...body });
      await upsertServiceSettings(user.id, settings);
      sendJson(res, 200, publicServiceSettings(settings));
      return;
    }

    res.statusCode = 405;
    res.setHeader("Allow", "GET, PUT, PATCH");
    res.end("Method Not Allowed");
  } catch (err) {
    if (err instanceof InvalidOpenFinanceApiPrefixError) {
      sendJson(res, 400, { error: err.message });
      return;
    }
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
