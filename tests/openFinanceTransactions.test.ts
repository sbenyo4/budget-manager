import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOpenFinanceTransaction, type RawTransaction } from "../server/openFinance.ts";

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
