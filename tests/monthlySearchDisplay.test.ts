import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sortTransactionsByDisplayedDate, transactionForDisplayedDebitDetails } from "../src/components/MonthlyView";
import type { Transaction } from "../src/types";

const monthlyViewSource = readFileSync(new URL("../src/components/MonthlyView.tsx", import.meta.url), "utf8");

const aggregateDebit: Transaction = {
  id: "debit-5961",
  date: "2026-07-10",
  merchant: "aggregate card debit",
  amount: 584.12,
  categoryMain: "INCOMES_EXPENSES",
  categorySub: "CREDIT_CARD_CHECKING",
  source: "bank",
};

const matchedPurchase: Transaction = {
  id: "free-tv",
  date: "2026-07-09",
  billingDate: "2026-08-10",
  merchant: "Free TV",
  amount: 29.9,
  categoryMain: "HOUSEHOLD",
  categorySub: "TV",
  source: "card",
};

test("a single matching card detail replaces the aggregate debit in the displayed row", () => {
  assert.equal(transactionForDisplayedDebitDetails(aggregateDebit, [matchedPurchase]), matchedPurchase);
  assert.equal(transactionForDisplayedDebitDetails(aggregateDebit, [matchedPurchase]).amount, 29.9);
  assert.equal(transactionForDisplayedDebitDetails(aggregateDebit, [matchedPurchase]).date, "2026-07-09");
});

test("multiple matching card details keep the aggregate row for expansion", () => {
  assert.equal(transactionForDisplayedDebitDetails(aggregateDebit, [matchedPurchase, { ...matchedPurchase, id: "other" }]), aggregateDebit);
});

test("a single matched card transaction supplies every displayed row value", () => {
  assert.match(monthlyViewSource, /new Date\(`\$\{displayTx\.date\}T00:00:00`\)/);
  assert.match(monthlyViewSource, /transactionHighlightClass\(displayTx, highAmountThreshold\)/);
  assert.match(monthlyViewSource, /className=\{`num \$\{displayTx\.type === "income"/);
  assert.match(monthlyViewSource, /formatILS\(displayTx\.amount\)/);
});

test("rows are sorted by the date the table actually displays", () => {
  const newerBankMovement: Transaction = {
    ...aggregateDebit,
    id: "bank-transfer",
    date: "2026-08-25",
    merchant: "bank transfer",
    categorySub: "BANK_TRANSFER",
  };
  const laterCardDebitWithOlderDisplayedPurchase: Transaction = {
    ...aggregateDebit,
    id: "card-debit",
    date: "2026-08-26",
  };
  const olderDisplayedPurchase: Transaction = {
    ...matchedPurchase,
    id: "purchase",
    date: "2026-08-21",
    billingDate: "2026-08-26",
  };

  const sorted = sortTransactionsByDisplayedDate(
    [laterCardDebitWithOlderDisplayedPurchase, newerBankMovement],
    (tx) => tx.id === laterCardDebitWithOlderDisplayedPurchase.id ? [olderDisplayedPurchase] : []
  );

  assert.deepEqual(sorted.map((tx) => tx.id), ["bank-transfer", "card-debit"]);
});

test("aggregate debits with multiple displayed details stay sorted by their debit date", () => {
  const aggregateWithTwoDetails: Transaction = { ...aggregateDebit, id: "card-debit", date: "2026-08-26" };
  const olderBankMovement: Transaction = { ...aggregateDebit, id: "bank-transfer", date: "2026-08-25" };
  const secondPurchase: Transaction = { ...matchedPurchase, id: "second-purchase", date: "2026-08-20" };

  const sorted = sortTransactionsByDisplayedDate(
    [olderBankMovement, aggregateWithTwoDetails],
    (tx) => tx.id === aggregateWithTwoDetails.id ? [matchedPurchase, secondPurchase] : []
  );

  assert.deepEqual(sorted.map((tx) => tx.id), ["card-debit", "bank-transfer"]);
});
