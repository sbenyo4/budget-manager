import assert from "node:assert/strict";
import test from "node:test";
import { summarizePendingBillingMonths } from "../src/logic/pendingBilling";

test("pending billing summaries combine charge dates by calendar month", () => {
  const result = summarizePendingBillingMonths([
    { billingDate: "2026-07-20", total: 15.39, count: 1, pendingInstallmentCount: 0 },
    { billingDate: "2026-07-21", total: 6.6, count: 1, pendingInstallmentCount: 0 },
    { billingDate: "2026-08-10", total: 1252.04, count: 2, pendingInstallmentCount: 1 },
  ]);

  assert.deepEqual(result, [
    {
      monthKey: "2026-07",
      total: 21.99,
      count: 2,
      pendingInstallmentCount: 0,
      billingDateCount: 2,
    },
    {
      monthKey: "2026-08",
      total: 1252.04,
      count: 2,
      pendingInstallmentCount: 1,
      billingDateCount: 1,
    },
  ]);
});

test("pending billing summaries keep transactions without a date in a final next-charge bucket", () => {
  const result = summarizePendingBillingMonths([
    { billingDate: "2026-08-10", total: 100, count: 1, pendingInstallmentCount: 0 },
    { total: 50, count: 2, pendingInstallmentCount: 1 },
  ]);

  assert.equal(result[1].monthKey, undefined);
  assert.equal(result[1].total, 50);
  assert.equal(result[1].count, 2);
});
