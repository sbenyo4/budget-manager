import type { ApiRequest, ApiResponse } from "../server/http.js";
import { readJson, sendJson } from "../server/http.js";
import { currentUnlockedUser } from "../server/auth.js";
import { createHash } from "node:crypto";
import { consumeRateLimit, getAIAnalysisCache, getServiceSettings, upsertAIAnalysisCache } from "../server/db.js";
import { analyzeBudget, type AIAnalysisPayload, type AIAnalysisResult } from "../server/aiAnalysis.js";
import { isValidAIAnalysisPayload } from "../server/aiPayload.js";

const AI_ANALYSIS_CACHE_VERSION = "ai-analysis-cache-v7";

interface AIAnalysisRequest extends AIAnalysisPayload {
  forceRefresh?: boolean;
  cacheOnly?: boolean;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function cacheKeyFor(settings: Awaited<ReturnType<typeof getServiceSettings>>, payload: AIAnalysisPayload): string {
  return createHash("sha256")
    .update(
      stableStringify({
        version: AI_ANALYSIS_CACHE_VERSION,
        aiProvider: settings.aiProvider,
        aiModel: settings.aiModel,
        payload,
      })
    )
    .digest("hex");
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  try {
    const user = await currentUnlockedUser(req);
    if (!user) {
      sendJson(res, 401, { error: "PIN_REQUIRED" });
      return;
    }
    const settings = await getServiceSettings(user.id);
    const body = await readJson<AIAnalysisRequest>(req);
    const { forceRefresh, cacheOnly, ...payload } = body;
    if (!isValidAIAnalysisPayload(payload)) {
      sendJson(res, 400, { error: "INVALID_AI_ANALYSIS_PAYLOAD" });
      return;
    }
    const cacheKey = cacheKeyFor(settings, payload);

    if (!forceRefresh) {
      const cached = await getAIAnalysisCache<AIAnalysisResult>(user.id, cacheKey);
      if (cached) {
        sendJson(res, 200, { result: cached.data, cached: true, updatedAt: cached.updatedAt });
        return;
      }
    }

    if (cacheOnly) {
      sendJson(res, 200, { result: null, cached: false, updatedAt: null });
      return;
    }

    const rateLimit = await consumeRateLimit(user.id, "ai-analysis", 12, 60 * 60 * 1000);
    if (!rateLimit.allowed) {
      res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
      sendJson(res, 429, { error: "AI_RATE_LIMITED", retryAfterSeconds: rateLimit.retryAfterSeconds });
      return;
    }

    const result = await analyzeBudget(settings, payload);
    const updatedAt = await upsertAIAnalysisCache(user.id, cacheKey, result);
    sendJson(res, 200, { result, cached: false, updatedAt });
  } catch (err) {
    sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
  }
}
