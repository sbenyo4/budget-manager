import assert from "node:assert/strict";
import test from "node:test";
import {
  pendingBalanceAdjustment,
  pendingTransactionsMatchingBalance,
  reconcileBookedPeriod,
} from "../src/logic/accountBalance.ts";
import type { CheckingBalance, Transaction } from "../src/types.ts";

const balance: CheckingBalance = {
  balance: 14_507.76,
  date: "2026-09-02",
  bookedBalance: 34_506.77,
  bookedDate: "2026-09-01",
};

const transaction = (
  id: string,
  date: string,
  amount: number,
  type: "income" | "expense",
  status: "BOOKED" | "PENDING",
  merchant: string
): Transaction => ({
  id,
  date,
  amount,
  type,
  status,
  merchant,
  source: "bank",
  categoryMain: "INCOMES_EXPENSES",
  categorySub: "OTHER",
});

const incidentTransactions = [
  transaction("salary", "2026-08-31", 31_040.18, "income", "BOOKED", "Salary"),
  transaction("fee-1", "2026-09-01", 6.75, "expense", "BOOKED", "Fee"),
  transaction("fee-2", "2026-09-01", 9, "expense", "BOOKED", "Fee"),
  transaction("securities", "2026-09-03", 19_999.01, "expense", "PENDING", "ני״ע-קניה"),
];

test("reconciles booked movements without turning a future pending debit into an opening-balance gap", () => {
  assert.deepEqual(reconcileBookedPeriod(balance, incidentTransactions, "2026-08-31", "2026-09-02"), {
    end: 34_506.77,
    start: 3_482.34,
  });
  assert.equal(pendingBalanceAdjustment(balance), -19_999.01);
});

test("identifies the pending movement already reflected in the expected balance", () => {
  assert.deepEqual(
    pendingTransactionsMatchingBalance(balance, incidentTransactions).map((item) => item.id),
    ["securities"]
  );
});

test("does not guess when several pending movements do not reconcile to the bank adjustment", () => {
  const unrelatedPending = transaction("other", "2026-09-03", 500, "expense", "PENDING", "Other");
  assert.deepEqual(
    pendingTransactionsMatchingBalance(balance, [...incidentTransactions.slice(0, 3), unrelatedPending]),
    []
  );
});
