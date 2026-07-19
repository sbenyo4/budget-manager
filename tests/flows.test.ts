import assert from "node:assert/strict";
import test from "node:test";
import type { Transaction } from "../src/types.ts";
import {
  budgetDate,
  cardDebitCutoffs,
  isCardTransactionCharged,
  isConsumption,
  isSavings,
} from "../src/logic/flows.ts";

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: "tx",
    date: "2026-07-01",
    merchant: "merchant",
    amount: 100,
    type: "expense",
    source: "bank",
    categoryMain: "OTHER",
    categorySub: "OTHER",
    ...overrides,
  };
}

test("pending aggregate card debits do not advance charged cutoffs", () => {
  const cutoffs = cardDebitCutoffs([
    tx({ id: "booked", date: "2026-06-10", cardLast4: "1111", categoryMain: "INCOMES_EXPENSES", categorySub: "CREDIT_CARD_CHECKING" }),
    tx({ id: "pending", date: "2026-07-10", status: "PENDING", cardLast4: "1111", categoryMain: "INCOMES_EXPENSES", categorySub: "CREDIT_CARD_CHECKING" }),
  ]);

  assert.equal(cutoffs.latest, "2026-06-10");
  assert.equal(cutoffs.byLast4.get("1111"), "2026-06-10");
});

test("a cutoff for another known card does not mark a card transaction as charged", () => {
  const cutoffs = cardDebitCutoffs([
    tx({ id: "debit", date: "2026-07-10", cardLast4: "1111", categoryMain: "INCOMES_EXPENSES", categorySub: "CREDIT_CARD_CHECKING" }),
  ]);
  const cardTransaction = tx({ source: "card", cardLast4: "2222", billingDate: "2026-07-01" });

  assert.equal(isCardTransactionCharged(cardTransaction, cutoffs), false);
});

test("small transfers and outgoing checks remain consumption", () => {
  assert.equal(isConsumption(tx({ categoryMain: "TRANSFER", amount: 250 })), true);
  assert.equal(isConsumption(tx({ categoryMain: "DEPOSIT", amount: 800 })), true);
});

test("large outgoing transfers retain the existing savings classification", () => {
  const transfer = tx({ categoryMain: "TRANSFER", amount: 1_500 });
  assert.equal(isSavings(transfer), true);
  assert.equal(isConsumption(transfer), false);
});

test("card transactions use their billing date as the shared budget date", () => {
  assert.equal(
    budgetDate(tx({ source: "card", date: "2026-06-28", billingDate: "2026-07-10" })),
    "2026-07-10"
  );
  assert.equal(budgetDate(tx({ source: "bank", date: "2026-06-28", billingDate: "2026-07-10" })), "2026-06-28");
});
