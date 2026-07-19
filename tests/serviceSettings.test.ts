import assert from "node:assert/strict";
import test from "node:test";
import { normalizeServiceSettings, publicServiceSettings } from "../server/serviceSettings.ts";

test("service settings responses never expose stored secrets", () => {
  const stored = normalizeServiceSettings({
    openFinanceClientId: "client",
    openFinanceClientSecret: "finance-secret",
    openFinanceUserId: "user",
    openFinanceApiPrefix: "api",
    aiProvider: "openai",
    aiApiKey: "ai-secret",
    aiModel: "gpt-4o-mini",
  });

  const result = publicServiceSettings(stored);
  assert.equal(result.openFinanceClientSecret, "");
  assert.equal(result.aiApiKey, "");
  assert.equal(result.openFinanceClientId, "client");
  assert.equal(stored.openFinanceClientSecret, "finance-secret");
});
