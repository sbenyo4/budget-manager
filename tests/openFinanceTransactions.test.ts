import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeOpenFinanceTransaction,
  normalizeOpenFinanceTransactions,
  type RawTransaction,
} from "../server/openFinance.ts";
import { dedupePendingInvestmentTransactions } from "../src/api/openFinance.ts";
import type { Transaction } from "../src/types.ts";

function baseCardTransaction(overrides: Partial<RawTransaction> = {}): RawTransaction {
  return {
    id: "tx-1",
    date: { transactionDate: "2026-07-19", valueDate: "2026-08-16" },
    amount: {
      originalAmount: { amount: -1300, currency: "ILS" },
      chargedAmount: { amount: -1300, currency: "ILS" },
    },
    merchantName: "מפעלי ע.שנפ ושות' בע\"מ",
    category: { main: "TRANSPORT", sub: "CAR_&_FUEL" },
    status: "PENDING",
    ...overrides,
  };
}

test("marks provider details=תשלומים as an installment whose monthly amount is pending", () => {
  const normalized = normalizeOpenFinanceTransaction(
    baseCardTransaction({ details: "תשלומים", isCreditCardInstallment: false }),
    0,
    "card"
  );

  assert.deepEqual(normalized.installment, { monthlyAmountPending: true });
  assert.equal(normalized.originalAmount, 1300);
  assert.equal(normalized.amount, 1300);
  assert.equal(normalized.billingDate, "2026-08-16");
});

test("keeps a provider-supplied installment amount and position", () => {
  const normalized = normalizeOpenFinanceTransaction(
    baseCardTransaction({
      amount: { originalAmount: { amount: -1300, currency: "ILS" } },
      installments: { number: 1, total: 4 },
      isCreditCardInstallment: true,
    }),
    0,
    "card"
  );

  assert.deepEqual(normalized.installment, { number: 1, total: 4 });
  assert.equal(normalized.amount, 325);
  assert.equal(normalized.originalAmount, 1300);
});

function pendingInvestment(id: string, amount: number): RawTransaction {
  return {
    id,
    providerId: "hapoalim",
    accountNumber: "checking-account",
    date: { valueDate: "2026-08-06" },
    amount: {
      originalAmount: { amount: -amount, currency: "ILS" },
      chargedAmount: { amount: -amount, currency: "ILS" },
    },
    description: {
      description: "ני”ע-קניה",
      additionalInfo: JSON.stringify({
        accountNo: "account-1",
        pendingEventDate: "2026-08-05",
        transactionDescription: "ני”ע-קניה",
      }),
    },
    status: "PENDING",
    category: { main: "INCOMES_EXPENSES", sub: "OTHER" },
  };
}

test("keeps only the fee-inclusive pending securities debit returned by Hapoalim", () => {
  const normalized = normalizeOpenFinanceTransactions([
    pendingInvestment("principal", 21_999),
    pendingInvestment("with-fee", 22_001.11),
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, "bank:with-fee");
  assert.equal(normalized[0].amount, 22_001.11);
});

test("does not merge distinct pending securities purchases", () => {
  const normalized = normalizeOpenFinanceTransactions([
    pendingInvestment("first", 10_000),
    pendingInvestment("second", 12_000),
  ]);

  assert.equal(normalized.length, 2);
});

test("client fallback removes a fee-less pending investment returned by an older API", () => {
  const transaction = (id: string, amount: number): Transaction => ({
    id,
    source: "bank",
    date: "2026-08-06",
    merchant: "ני”ע-קניה",
    amount,
    status: "PENDING",
    type: "expense",
    categoryMain: "INCOMES_EXPENSES",
    categorySub: "OTHER",
  });

  const transactions = dedupePendingInvestmentTransactions([
    transaction("bank:principal", 21_999),
    transaction("bank:with-fee", 22_001.11),
  ]);

  assert.deepEqual(transactions.map((tx) => [tx.id, tx.amount]), [["bank:with-fee", 22_001.11]]);
});
