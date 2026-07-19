import assert from "node:assert/strict";
import test from "node:test";
import { normalizePreferences, normalizePreferencesPatch } from "../server/preferences.ts";

test("preference normalization rejects malformed nested values and impossible dates", () => {
  const normalized = normalizePreferences({
    sectionOverrides: ["not", "a", "record"] as unknown as Record<string, string>,
    oneTimeExpenses: ["valid", 42] as unknown as string[],
    fixedExpenses: ["fixed"],
    highAmountThreshold: Number.POSITIVE_INFINITY,
    householdBirthDate: "2026-02-31",
    householdAge: 999,
    householdSize: 2.5,
    autoLogoutMinutes: 0,
    theme: "dark",
  });

  assert.deepEqual(normalized.sectionOverrides, {});
  assert.deepEqual(normalized.oneTimeExpenses, ["valid"]);
  assert.equal(normalized.householdBirthDate, null);
  assert.equal(normalized.householdAge, null);
  assert.equal(normalized.householdSize, null);
  assert.equal(normalized.autoLogoutMinutes, 5);
  assert.equal(normalized.theme, "dark");
});

test("preference normalization accepts a bounded auto-logout duration", () => {
  assert.equal(normalizePreferences({ autoLogoutMinutes: 17 }).autoLogoutMinutes, 17);
  assert.equal(normalizePreferences({ autoLogoutMinutes: 1_441 }).autoLogoutMinutes, 5);
});

test("preference PATCH normalization never clears fields that were not sent or were malformed", () => {
  const patch = normalizePreferencesPatch({
    autoLogoutMinutes: 9,
    householdBirthDate: "not-a-date",
    householdSize: 2.5,
  });

  assert.deepEqual(patch, { autoLogoutMinutes: 9 });
  assert.equal("householdBirthDate" in patch, false);
  assert.equal("householdSize" in patch, false);
});
