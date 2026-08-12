import assert from "node:assert/strict";
import test from "node:test";
import type { Transaction } from "../src/types.ts";
import {
  budgetDate,
  cardDebitCutoffs,
  cardDebitCutoffsWithFallback,
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

test("pending aggregate debits do not advance cutoffs and known-card debits stay card-scoped", () => {
  const cutoffs = cardDebitCutoffs([
    tx({ id: "booked", date: "2026-06-10", cardLast4: "1111", categoryMain: "INCOMES_EXPENSES", categorySub: "CREDIT_CARD_CHECKING" }),
    tx({ id: "pending", date: "2026-07-10", status: "PENDING", cardLast4: "1111", categoryMain: "INCOMES_EXPENSES", categorySub: "CREDIT_CARD_CHECKING" }),
  ]);

  assert.equal(cutoffs.latest, "");
  assert.equal(cutoffs.byLast4.get("1111"), "2026-06-10");
});

test("a cutoff for another known card does not mark a card transaction as charged", () => {
  const cutoffs = cardDebitCutoffs([
    tx({ id: "debit", date: "2026-07-10", cardLast4: "1111", categoryMain: "INCOMES_EXPENSES", categorySub: "CREDIT_CARD_CHECKING" }),
  ]);
  const cardTransaction = tx({ source: "card", cardLast4: "2222", billingDate: "2026-07-01" });

  assert.equal(isCardTransactionCharged(cardTransaction, cutoffs), false);
});

test("an unmatched booked card debit does not hide unidentified card transactions", () => {
  const unmatchedDebit = tx({
    id: "unmatched-debit",
    source: "bank",
    date: "2026-08-10",
    categoryMain: "INCOMES_EXPENSES",
    categorySub: "CREDIT_CARD_CHECKING",
  });
  const unidentifiedCardTransaction = tx({
    id: "unidentified-card-transaction",
    source: "card",
    date: "2026-08-01",
    billingDate: "2026-08-10",
  });
  const cutoffs = cardDebitCutoffs([unmatchedDebit, unidentifiedCardTransaction]);

  assert.equal(cutoffs.latest, "");
  assert.equal(isCardTransactionCharged(unidentifiedCardTransaction, cutoffs), false);
});

test("fallback debit details advance the cutoff for an API response without attached details", () => {
  const debit = tx({
    id: "debit",
    source: "bank",
    date: "2026-08-11",
    categoryMain: "INCOMES_EXPENSES",
    categorySub: "CREDIT_CARD_CHECKING",
  });
  const detail = tx({
    id: "booked-detail",
    source: "card",
    date: "2026-08-06",
    billingDate: "2026-08-11",
    cardLast4: "5653",
    status: "BOOKED",
  });

  const cutoffs = cardDebitCutoffsWithFallback([debit, detail], new Map([[debit.id, [detail]]]));

  assert.equal(cutoffs.byLast4.get("5653"), "2026-08-11");
  assert.equal(isCardTransactionCharged(detail, cutoffs), true);
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

test("large investment deposits are savings and never consumption", () => {
  const deposit = tx({
    amount: 1_300_000,
    categoryMain: "DEPOSIT",
    categorySub: "CHQ_INCOME",
    merchant: "שיק",
  });

  assert.equal(isSavings(deposit), true);
  assert.equal(isConsumption(deposit), false);
});

test("card transactions use their billing date as the shared budget date", () => {
  assert.equal(
    budgetDate(tx({ source: "card", date: "2026-06-28", billingDate: "2026-07-10" })),
    "2026-07-10"
  );
  assert.equal(budgetDate(tx({ source: "bank", date: "2026-06-28", billingDate: "2026-07-10" })), "2026-06-28");
});

test("a provider-pending card purchase stays uncharged at the booked debit cutoff", () => {
  const transactions = [
    tx({
      id: "debit",
      source: "bank",
      date: "2026-08-11",
      cardLast4: "5653",
      categoryMain: "INCOMES_EXPENSES",
      categorySub: "CREDIT_CARD_CHECKING",
      detailTransactions: [
        tx({ id: "booked-detail", source: "card", billingDate: "2026-08-11", cardLast4: "5653", status: "BOOKED" }),
      ],
    }),
  ];
  const pending = tx({
    id: "new-pending",
    source: "card",
    billingDate: "2026-08-11",
    cardLast4: "5653",
    status: "PENDING",
  });

  assert.equal(isCardTransactionCharged(pending, cardDebitCutoffs(transactions)), false);
});
