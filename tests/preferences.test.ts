import assert from "node:assert/strict";
import test from "node:test";
import { normalizePreferences } from "../server/preferences.ts";

test("preference normalization rejects malformed nested values and impossible dates", () => {
  const normalized = normalizePreferences({
    sectionOverrides: ["not", "a", "record"] as unknown as Record<string, string>,
    oneTimeExpenses: ["valid", 42] as unknown as string[],
    fixedExpenses: ["fixed"],
    highAmountThreshold: Number.POSITIVE_INFINITY,
    householdBirthDate: "2026-02-31",
    householdAge: 999,
    householdSize: 2.5,
    theme: "dark",
  });

  assert.deepEqual(normalized.sectionOverrides, {});
  assert.deepEqual(normalized.oneTimeExpenses, ["valid"]);
  assert.equal(normalized.householdBirthDate, null);
  assert.equal(normalized.householdAge, null);
  assert.equal(normalized.householdSize, null);
  assert.equal(normalized.theme, "dark");
});
