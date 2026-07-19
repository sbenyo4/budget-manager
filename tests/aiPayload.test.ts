import assert from "node:assert/strict";
import test from "node:test";
import { isValidAIAnalysisPayload } from "../server/aiPayload.ts";

test("AI payload validation accepts bounded financial input", () => {
  assert.equal(isValidAIAnalysisPayload({ periodLabel: "יולי 2026", transactions: [{ amount: 10, type: "expense" }], bankBalance: null }), true);
});

test("AI payload validation rejects non-finite amounts and oversized labels", () => {
  assert.equal(isValidAIAnalysisPayload({ periodLabel: "x", transactions: [{ amount: Number.NaN }], bankBalance: null }), false);
  assert.equal(isValidAIAnalysisPayload({ periodLabel: "x".repeat(301), transactions: [], bankBalance: null }), false);
});
