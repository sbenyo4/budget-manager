import assert from "node:assert/strict";
import test from "node:test";
import { normalizePreferences, normalizePreferencesPatch } from "../server/preferences.ts";
import { wereAlertApprovalsPersisted } from "../src/api/preferences.ts";

test("preference normalization rejects malformed nested values and impossible dates", () => {
  const normalized = normalizePreferences({
    sectionOverrides: ["not", "a", "record"] as unknown as Record<string, string>,
    oneTimeExpenses: ["valid", 42] as unknown as string[],
    fixedExpenses: ["fixed"],
    highAmountThreshold: Number.POSITIVE_INFINITY,
    highCheckingBalanceThreshold: Number.POSITIVE_INFINITY,
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
  assert.equal(normalized.highCheckingBalanceThreshold, 15_000);
  assert.equal(normalized.theme, "dark");
});

test("checking balance alert threshold defaults to 15000 and accepts a configured value", () => {
  assert.equal(normalizePreferences({}).highCheckingBalanceThreshold, 15_000);
  assert.equal(
    normalizePreferences({ highCheckingBalanceThreshold: 22_500 })
      .highCheckingBalanceThreshold,
    22_500,
  );
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

test("installment overrides retain only bounded integer installment counts", () => {
  const normalized = normalizePreferences({
    installmentOverrides: {
      "card:real-transaction": 4,
      "card:fractional": 3.5,
      "card:too-small": 1,
      "card:too-large": 121,
    },
  });

  assert.deepEqual(normalized.installmentOverrides, { "card:real-transaction": 4 });
});

test("alert approvals retain only safe numeric baselines", () => {
  const normalized = normalizePreferences({
    alertApprovals: {
      "price:netflix": 65,
      "transaction:approved": 7_500,
      "transaction:invalid": Number.POSITIVE_INFINITY,
      "merchant:invalid": -1,
    },
  });

  assert.deepEqual(normalized.alertApprovals, {
    "price:netflix": 65,
    "transaction:approved": 7_500,
  });
});

test("the client accepts an alert approval only when the server echoes every saved baseline", () => {
  const requested = {
    "price:netflix": 65,
    "transaction:approved": 7_500,
  };

  assert.equal(wereAlertApprovalsPersisted(requested, undefined), false);
  assert.equal(wereAlertApprovalsPersisted({}, undefined), false);
  assert.equal(wereAlertApprovalsPersisted({}, {}), true);
  assert.equal(wereAlertApprovalsPersisted(requested, { "price:netflix": 65 }), false);
  assert.equal(
    wereAlertApprovalsPersisted(requested, {
      "price:netflix": 65,
      "transaction:approved": 7_500,
      "merchant:existing": 1,
    }),
    true
  );
});
