import type { ServiceSettings } from "./db.js";

export type AIProvider = ServiceSettings["aiProvider"];

const FALLBACK_MODELS: Record<AIProvider, string[]> = {
  openai: [
    "gpt-5.6",
    "gpt-5.6-mini",
    "gpt-5.6-nano",
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-4o",
    "gpt-4o-mini",
    "o4-mini",
    "o3",
    "o3-mini",
  ],
  anthropic: [
    "claude-fable-5",
    "claude-opus-4-8",
    "claude-sonnet-5",
    "claude-haiku-4-5",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-sonnet-4-5",
    "claude-opus-4-1",
    "claude-opus-4-0",
    "claude-sonnet-4-0",
  ],
  gemini: [
    "gemini-3.5-flash",
    "gemini-3.1-pro",
    "gemini-3-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
  ],
};

function uniqueModels(values: string[], fallback: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  [...values, ...fallback].forEach((value) => {
    const clean = value.trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    result.push(clean);
  });
  return result;
}

export async function listAIModels(provider: AIProvider, apiKey: string): Promise<string[]> {
  if (!apiKey) return FALLBACK_MODELS[provider];

  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`OpenAI models request failed (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    return uniqueModels(body.data?.map((model) => model.id ?? "") ?? [], FALLBACK_MODELS.openai);
  }

  if (provider === "anthropic") {
    const models: string[] = [];
    let afterId = "";
    for (let page = 0; page < 20; page += 1) {
      const url = new URL("https://api.anthropic.com/v1/models");
      url.searchParams.set("limit", "100");
      if (afterId) url.searchParams.set("after_id", afterId);
      const res = await fetch(url, {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
      });
      if (!res.ok) throw new Error(`Anthropic models request failed (${res.status}): ${await res.text()}`);
      const body = (await res.json()) as {
        data?: Array<{ id?: string }>;
        has_more?: boolean;
        last_id?: string;
      };
      models.push(...(body.data?.map((model) => model.id ?? "") ?? []));
      if (!body.has_more || !body.last_id) break;
      afterId = body.last_id;
    }
    return uniqueModels(models, FALLBACK_MODELS.anthropic);
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  );
  if (!res.ok) throw new Error(`Gemini models request failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  };
  return uniqueModels(
    body.models
      ?.filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
      .map((model) => (model.name ?? "").replace(/^models\//, "")) ?? [],
    FALLBACK_MODELS.gemini
  );
}
