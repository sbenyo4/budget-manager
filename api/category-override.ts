import type { ApiRequest, ApiResponse } from "../server/http.js";
import { readJson, sendJson } from "../server/http.js";
import { currentSessionToken, tokenHash } from "../server/auth.js";
import { patchCategoryOverrideForSession } from "../server/db.js";
import { normalizeCategoryOverrideInput } from "../server/categoryOverride.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const startedAt = Date.now();
  const requestId = req.headers["x-vercel-id"] ?? "";
  try {
    if (req.method !== "PATCH") {
      res.statusCode = 405;
      res.setHeader("Allow", "PATCH");
      res.end("Method Not Allowed");
      return;
    }
    const sessionToken = currentSessionToken(req);
    if (!sessionToken) {
      sendJson(res, 401, { error: "AUTH_REQUIRED" });
      return;
    }
    const input = normalizeCategoryOverrideInput(await readJson<unknown>(req));
    if (!input) {
      sendJson(res, 400, { error: "INVALID_CATEGORY_OVERRIDE" });
      return;
    }
    const { merchant, category } = input;
    const saved = await patchCategoryOverrideForSession(tokenHash(sessionToken), Date.now(), merchant, category);
    if (!saved) {
      sendJson(res, 401, { error: "AUTH_REQUIRED" });
      return;
    }
    sendJson(res, 200, saved);
    console.log(JSON.stringify({
      level: "info",
      route: "/api/category-override",
      method: "PATCH",
      status: 200,
      requestId,
      ms: Date.now() - startedAt,
    }));
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      route: "/api/category-override",
      method: req.method,
      requestId,
      error: error instanceof Error ? error.message : String(error),
      ms: Date.now() - startedAt,
    }));
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}
