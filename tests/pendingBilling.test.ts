import assert from "node:assert/strict";
import test from "node:test";
import { cardDebitCutoffs } from "../src/logic/flows";
import {
  partitionOpenCardTransactions,
  selectCardTransactionsInPendingDebits,
  selectPendingCardTransactions,
  summarizePendingBillingMonths,
} from "../src/logic/pendingBilling";
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

test("future charges collapse the booked and pending Brand provider aliases", () => {
  const transactions = [
    tx({
      id: "brand-old-provider-copy",
      date: "2026-08-09",
      billingDate: "2026-08-16",
      cardLast4: "9699",
      merchant: 'בראנד אספקה טכנית בע"מ-צמ',
      amount: 59,
      status: "BOOKED",
      categoryMain: "SHOPPING",
      categorySub: "SHOPPING_OTHER",
    }),
    tx({
      id: "brand-clean",
      date: "2026-08-09",
      cardLast4: "9699",
      merchant: 'בראנד אספקה טכנית בע"מ',
      amount: 59,
      status: "PENDING",
      categoryMain: "SHOPPING",
      categorySub: "SHOPPING_OTHER",
    }),
  ];

  const result = selectPendingCardTransactions(transactions, cardDebitCutoffs(transactions), "9699");

  assert.equal(result.length, 1);
  assert.equal(result[0].id, "brand-clean");
  assert.equal(result.reduce((total, transaction) => total + transaction.amount, 0), 59);
});

test("future charges keep two legitimate identical booked purchases", () => {
  const transactions = [
    tx({
      id: "first-booked",
      date: "2026-08-09",
      billingDate: "2026-08-16",
      cardLast4: "9699",
      merchant: "Same merchant",
      amount: 59,
      status: "BOOKED",
    }),
    tx({
      id: "second-booked",
      date: "2026-08-09",
      billingDate: "2026-08-16",
      cardLast4: "9699",
      merchant: "Same merchant",
      amount: 59,
      status: "BOOKED",
    }),
  ];

  const result = selectPendingCardTransactions(transactions, cardDebitCutoffs(transactions), "9699");

  assert.deepEqual(result.map(({ id }) => id), ["first-booked", "second-booked"]);
  assert.equal(result.reduce((total, transaction) => total + transaction.amount, 0), 118);
});

test("provider-pending authorizations stay outside confirmed billing-cycle totals", () => {
  const confirmed = [102.98, 96, 108.8, 200.7, 508.31, 210.1, 72.84].map((amount, index) => tx({
    id: `booked-${index}`,
    billingDate: "2026-09-10",
    cardLast4: "5653",
    amount,
    status: "BOOKED",
  }));
  const spotify = tx({
    id: "spotify-pending",
    date: "2026-08-11",
    billingDate: "2026-08-11",
    cardLast4: "5653",
    merchant: "Spotify",
    amount: 23.9,
    status: "PENDING",
  });
  const openFinance = tx({
    id: "open-finance-pending",
    date: "2026-08-11",
    billingDate: "2026-08-11",
    cardLast4: "5961",
    merchant: "Open Finance",
    amount: 49,
    status: "PENDING",
  });

  const partitioned = partitionOpenCardTransactions([...confirmed, spotify, openFinance]);

  assert.equal(
    Number(partitioned.confirmed.reduce((total, transaction) => total + transaction.amount, 0).toFixed(2)),
    1299.73
  );
  assert.deepEqual(partitioned.providerPending.map(({ id }) => id), ["spotify-pending", "open-finance-pending"]);
  assert.equal(partitioned.confirmed.some(({ id }) => id === "spotify-pending"), false);
});

test("transactions attached to a pending bank debit are clearing, not next-cycle charges", () => {
  const cardPurchase = tx({ id: "card:purchase", billingDate: "2026-08-10", cardLast4: "1111" });
  const pendingDebit = tx({
    id: "bank:pending-debit",
    source: "bank",
    date: "2026-08-10",
    status: "PENDING",
    cardLast4: "1111",
    categoryMain: "INCOMES_EXPENSES",
    categorySub: "CREDIT_CARD_CHECKING",
    detailTransactions: [cardPurchase],
  });
  const transactions = [pendingDebit, cardPurchase];
  const clearing = selectCardTransactionsInPendingDebits(transactions);
  const future = selectPendingCardTransactions(
    transactions,
    cardDebitCutoffs(transactions),
    "",
    new Set(clearing.map(({ id }) => id))
  );

  assert.deepEqual(clearing.map(({ id }) => id), ["card:purchase"]);
  assert.deepEqual(future, []);
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
