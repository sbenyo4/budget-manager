import assert from "node:assert/strict";
import test from "node:test";
import { cardDebitCutoffs } from "../src/logic/flows";
import { selectPendingCardTransactions, summarizePendingBillingMonths } from "../src/logic/pendingBilling";
import type { Transaction } from "../src/types";

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: "tx",
    date: "2026-08-01",
    merchant: "merchant",
    amount: 100,
    type: "expense",
    source: "card",
    categoryMain: "OTHER",
    categorySub: "OTHER",
    ...overrides,
  };
}

test("future charges include uncharged purchases from an earlier reporting period", () => {
  const transactions = [
    tx({
      id: "last-debit",
      source: "bank",
      date: "2026-07-10",
      cardLast4: "1111",
      categoryMain: "INCOMES_EXPENSES",
      categorySub: "CREDIT_CARD_CHECKING",
    }),
    tx({ id: "older-purchase", date: "2026-07-28", billingDate: "2026-08-05", cardLast4: "1111" }),
    tx({ id: "current-purchase", date: "2026-08-02", billingDate: "2026-08-10", cardLast4: "1111" }),
    tx({ id: "already-charged", date: "2026-07-03", billingDate: "2026-07-10", cardLast4: "1111" }),
  ];

  const result = selectPendingCardTransactions(transactions, cardDebitCutoffs(transactions));

  assert.deepEqual(result.map(({ id }) => id), ["older-purchase", "current-purchase"]);
});

test("future charges still respect an explicitly selected card", () => {
  const transactions = [
    tx({ id: "first-card", date: "2026-07-28", billingDate: "2026-08-05", cardLast4: "1111" }),
    tx({ id: "second-card", date: "2026-07-29", billingDate: "2026-08-08", cardLast4: "2222" }),
  ];

  const result = selectPendingCardTransactions(transactions, cardDebitCutoffs(transactions), "2222");

  assert.deepEqual(result.map(({ id }) => id), ["second-card"]);
});

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
