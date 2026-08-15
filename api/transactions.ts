import { createHash } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../server/http.js";
import { getQueryParam, sendJson } from "../server/http.js";
import { getTransactions, isOpenFinanceConfigured } from "../server/openFinance.js";
import { currentUnlockedUser } from "../server/auth.js";
import {
  consumeRateLimit,
  getMerchantLookupCache,
  getServiceSettings,
  upsertMerchantLookupCache,
} from "../server/db.js";
import { lookupMerchantDetails, type MerchantLookupDetails } from "../server/merchantLookup.js";

const MERCHANT_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function clean(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

async function handleMerchantLookup(req: ApiRequest, res: ApiResponse, merchant: string) {
  const user = await currentUnlockedUser(req);
  if (!user) {
    sendJson(res, 401, { error: "PIN_REQUIRED" });
    return;
  }
  const address = clean(getQueryParam(req, "merchantAddress"), 240);
  const categoryCode = clean(getQueryParam(req, "merchantCategoryCode"), 16);
  const key = createHash("sha256")
    .update(`v3\n${merchant.toLocaleLowerCase("he")}\n${address?.toLocaleLowerCase("he") ?? ""}\n${categoryCode ?? ""}`)
    .digest("hex");
  const cached = await getMerchantLookupCache<{ details: MerchantLookupDetails | null }>(key, MERCHANT_CACHE_MAX_AGE_MS);
  if (cached !== undefined) {
    sendJson(res, 200, { ...cached, cached: true });
    return;
  }
  const rateLimit = await consumeRateLimit(user.id, "merchant-lookup", 60, 60 * 60 * 1000);
  if (!rateLimit.allowed) {
    res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
    sendJson(res, 429, { error: "MERCHANT_LOOKUP_RATE_LIMITED", retryAfterSeconds: rateLimit.retryAfterSeconds });
    return;
  }
  const settings = await getServiceSettings(user.id);
  const value = {
    details: await lookupMerchantDetails(merchant, address, {
      ...(settings.aiProvider === "anthropic" ? { anthropicApiKey: settings.aiApiKey } : {}),
      anthropicModel: settings.aiModel,
      ...(categoryCode ? { categoryCode } : {}),
    }),
  };
  await upsertMerchantLookupCache(key, value);
  sendJson(res, 200, { ...value, cached: false });
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end("Method Not Allowed");
    return;
  }
  const merchantLookup = clean(getQueryParam(req, "merchantLookup"), 160);
  if (getQueryParam(req, "merchantLookup") !== undefined) {
    if (!merchantLookup) {
      sendJson(res, 400, { error: "INVALID_MERCHANT" });
      return;
    }
    try {
      await handleMerchantLookup(req, res, merchantLookup);
    } catch (error) {
      sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  const from = getQueryParam(req, "from") ?? "";
  const to = getQueryParam(req, "to") ?? "";
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  };
  if (!validDate(from) || !validDate(to) || from > to) {
    sendJson(res, 400, { error: "from/to must be YYYY-MM-DD" });
    return;
  }

  try {
    const user = await currentUnlockedUser(req);
    if (!user) {
      sendJson(res, 401, { error: "PIN_REQUIRED" });
      return;
    }
    const settings = await getServiceSettings(user.id);
    if (!isOpenFinanceConfigured(settings)) {
      sendJson(res, 503, { error: "NOT_CONFIGURED" });
      return;
    }
    sendJson(res, 200, await getTransactions(settings, from, to));
  } catch (err) {
    sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
  }
}
