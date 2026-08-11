import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeOpenFinanceTransaction,
  normalizeOpenFinanceTransactions,
  type RawTransaction,
} from "../server/openFinance.ts";
import {
  dedupeCardProviderAliasTransactions,
  dedupePendingInvestmentTransactions,
} from "../src/api/openFinance.ts";
import { cardDebitCutoffs } from "../src/logic/flows.ts";
import { selectPendingCardTransactions } from "../src/logic/pendingBilling.ts";
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

test("merges two card records when one is missing the billing date", () => {
  const normalized = normalizeOpenFinanceTransactions([], [
    baseCardTransaction({
      id: "incomplete-copy",
      date: { transactionDate: "2026-07-19" },
    }),
    baseCardTransaction({ id: "dated-copy" }),
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, "card:dated-copy");
  assert.equal(normalized[0].billingDate, "2026-08-16");
});

test("merges identical fully reported card records with different provider IDs", () => {
  const normalized = normalizeOpenFinanceTransactions([], [
    baseCardTransaction({ id: "first-purchase", providerId: "provider-a" }),
    baseCardTransaction({
      id: "second-purchase",
      providerId: "provider-b",
      category: { main: "SHOPPING", sub: "SHOPPING_OTHER" },
      status: "BOOKED",
    }),
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, "card:second-purchase");
});

test("merges the Brand duplicate when one merchant name has the provider suffix", () => {
  const amount = {
    originalAmount: { amount: -59, currency: "ILS" },
    chargedAmount: { amount: -59, currency: "ILS" },
  };
  const date = { transactionDate: "2026-08-09", valueDate: "2026-08-16" };
  const normalized = normalizeOpenFinanceTransactions([], [
    baseCardTransaction({
      id: "brand-with-suffix",
      accountNumber: "9699",
      date,
      amount,
      merchantName: 'בראנד אספקה טכנית בע"מ-צמ',
    }),
    baseCardTransaction({
      id: "brand-clean",
      accountNumber: "9699",
      date,
      amount,
      merchantName: 'בראנד אספקה טכנית בע"מ',
    }),
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, "card:brand-clean");
  assert.equal(normalized[0].merchant, 'בראנד אספקה טכנית בע"מ');
  assert.equal(normalized.reduce((total, tx) => total + tx.amount, 0), 59);

  const pending = selectPendingCardTransactions(normalized, cardDebitCutoffs(normalized), "9699");
  assert.equal(pending.length, 1);
  assert.equal(pending.reduce((total, tx) => total + tx.amount, 0), 59);
});

test("client fallback also removes the Brand provider alias before rendering", () => {
  const transaction = (id: string, merchant: string): Transaction => ({
    id,
    source: "card",
    cardLast4: "9699",
    date: "2026-08-09",
    billingDate: "2026-08-16",
    merchant,
    amount: 59,
    status: "PENDING",
    type: "expense",
    categoryMain: "SHOPPING",
    categorySub: "SHOPPING_OTHER",
  });

  const transactions = dedupeCardProviderAliasTransactions([
    transaction("card:brand-with-suffix", 'בראנד אספקה טכנית בע"מ-צמ'),
    transaction("card:brand-clean", 'בראנד אספקה טכנית בע"מ'),
  ]);

  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].id, "card:brand-clean");
  assert.equal(transactions.reduce((total, tx) => total + tx.amount, 0), 59);
});

test("keeps similar card purchases when their amounts differ", () => {
  const normalized = normalizeOpenFinanceTransactions([], [
    baseCardTransaction({ id: "first-purchase" }),
    baseCardTransaction({
      id: "second-purchase",
      amount: {
        originalAmount: { amount: -1301, currency: "ILS" },
        chargedAmount: { amount: -1301, currency: "ILS" },
      },
    }),
  ]);

  assert.deepEqual(normalized.map((tx) => tx.id), ["card:first-purchase", "card:second-purchase"]);
});

test("deduplicates card purchases before attaching them to a bank debit", () => {
  const debit: RawTransaction = {
    id: "debit-1",
    date: { transactionDate: "2026-08-16" },
    amount: {
      originalAmount: { amount: -1300, currency: "ILS" },
      chargedAmount: { amount: -1300, currency: "ILS" },
    },
    merchantName: "credit card debit",
    category: { main: "INCOMES_EXPENSES", sub: "CREDIT_CARD_CHECKING" },
    status: "BOOKED",
  };

  const normalized = normalizeOpenFinanceTransactions(
    [debit],
    [baseCardTransaction(), baseCardTransaction()]
  );
  const normalizedDebit = normalized.find((tx) => tx.id === "bank:debit-1");

  assert.equal(normalizedDebit?.detailTransactions?.length, 1);
  assert.equal(normalizedDebit?.detailTransactions?.[0].id, "card:tx-1");
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
