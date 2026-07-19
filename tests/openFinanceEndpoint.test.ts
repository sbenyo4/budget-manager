import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidOpenFinanceApiPrefixError,
  normalizeOpenFinanceApiPrefix,
  openFinanceApiUrl,
} from "../server/openFinanceEndpoint.ts";

test("builds Open Finance URLs only under the expected HTTPS origin", () => {
  assert.equal(normalizeOpenFinanceApiPrefix(" Tenant-123 "), "tenant-123");
  assert.equal(
    openFinanceApiUrl("tenant-123", "/v2/data/transactions").href,
    "https://tenant-123.open-finance.ai/v2/data/transactions"
  );
});

test("rejects prefixes that can change URL authority or path", () => {
  for (const prefix of ["evil.example\\", "127.0.0.1\\", "api/path", "evil@example", "api.open-finance.ai", "#fragment"]) {
    assert.throws(() => openFinanceApiUrl(prefix, "/v2/data/transactions"), InvalidOpenFinanceApiPrefixError);
  }
});
