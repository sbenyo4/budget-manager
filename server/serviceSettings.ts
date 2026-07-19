import type { ServiceSettings } from "./db.js";
import { normalizeOpenFinanceApiPrefix } from "./openFinanceEndpoint.js";

function clean(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeServiceSettings(body: Partial<ServiceSettings>): ServiceSettings {
  const provider = body.aiProvider === "anthropic" || body.aiProvider === "gemini" ? body.aiProvider : "openai";
  return {
    openFinanceClientId: clean(body.openFinanceClientId, 500),
    openFinanceClientSecret: clean(body.openFinanceClientSecret, 4_000),
    openFinanceUserId: clean(body.openFinanceUserId, 500),
    openFinanceApiPrefix: normalizeOpenFinanceApiPrefix(body.openFinanceApiPrefix),
    aiProvider: provider,
    aiApiKey: clean(body.aiApiKey, 4_000),
    aiModel:
      typeof body.aiModel === "string" && body.aiModel.trim()
        ? body.aiModel.trim().slice(0, 200)
        : provider === "anthropic"
          ? "claude-haiku-4-5"
          : provider === "gemini"
            ? "gemini-2.0-flash"
            : "gpt-4o-mini",
  };
}

/** Secrets stay server-side; empty values mean “already configured or unchanged” to the client. */
export function publicServiceSettings(settings: ServiceSettings): ServiceSettings {
  return {
    ...settings,
    openFinanceClientSecret: "",
    aiApiKey: "",
  };
}
