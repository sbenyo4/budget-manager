import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCategoryOverrideInput } from "../server/categoryOverride";

test("category override input accepts one bounded merchant delta", () => {
  assert.deepEqual(
    normalizeCategoryOverrideInput({ merchant: "  Merchant A  ", category: " TRANSPORT " }),
    { merchant: "Merchant A", category: "TRANSPORT" }
  );
  assert.deepEqual(
    normalizeCategoryOverrideInput({ merchant: "Merchant A", category: null }),
    { merchant: "Merchant A", category: null }
  );
});

test("category override input rejects missing, blank, and oversized values", () => {
  assert.equal(normalizeCategoryOverrideInput({ merchant: "", category: "SHOPPING" }), null);
  assert.equal(normalizeCategoryOverrideInput({ merchant: "Merchant A", category: "" }), null);
  assert.equal(normalizeCategoryOverrideInput({ merchant: "x".repeat(301), category: "SHOPPING" }), null);
  assert.equal(normalizeCategoryOverrideInput({ merchant: "Merchant A", category: "x".repeat(301) }), null);
});
