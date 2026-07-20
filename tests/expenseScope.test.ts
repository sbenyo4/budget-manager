import assert from "node:assert/strict";
import test from "node:test";
import { expenseOverrideKey, fixedExpenseKey, fixedExpenseKeysFor } from "../src/logic/expenseScope.ts";
import type { Period } from "../src/logic/periods.ts";
import type { Transaction } from "../src/types.ts";

const periods: Period[] = [
  { key: "2026-06", label: "יוני", from: "2026-06-01", to: "2026-06-30" },
  { key: "2026-07", label: "יולי", from: "2026-07-01", to: "2026-07-31" },
];

function expense(id: string, date: string, merchant: string): Transaction {
  return {
    id,
    date,
    merchant,
    amount: 100,
    type: "expense",
    source: "bank",
    categoryMain: "HOUSEHOLD",
    categorySub: "OTHER",
  };
}

test("AI and budget UI fixed-expense classification share automatic and manual overrides", () => {
  const rentJune = expense("rent-1", "2026-06-01", "Rent");
  const rentJuly = expense("rent-2", "2026-07-01", "Rent");
  const annualFee = expense("annual", "2026-07-15", "Annual fee");

  const automatic = fixedExpenseKeysFor([rentJune, rentJuly, annualFee], periods, new Set(), new Set());
  assert.equal(automatic.has(fixedExpenseKey(rentJuly)), true);
  assert.equal(automatic.has(fixedExpenseKey(annualFee)), false);

  const manualOneTime = fixedExpenseKeysFor(
    [rentJune, rentJuly],
    periods,
    new Set([expenseOverrideKey(rentJuly)]),
    new Set()
  );
  assert.equal(manualOneTime.has(fixedExpenseKey(rentJuly)), false);

  const manualFixed = fixedExpenseKeysFor(
    [annualFee],
    periods,
    new Set(),
    new Set([expenseOverrideKey(annualFee)])
  );
  assert.equal(manualFixed.has(fixedExpenseKey(annualFee)), true);
});
