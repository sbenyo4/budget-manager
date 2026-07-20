import assert from "node:assert/strict";
import test from "node:test";
import type { Transaction } from "../src/types.ts";
import { medianAmount, scoreIncomeTransactions } from "../src/logic/incomeBasis.ts";

function income(amount: number, categoryMain: string, merchant: string): Transaction {
  return {
    id: `${categoryMain}-${amount}`,
    date: "2026-06-30",
    amount,
    type: "income",
    source: "bank",
    categoryMain,
    categorySub: "",
    merchant,
    description: merchant,
  };
}

test("score income sums split salary deposits but excludes incidental credits", () => {
  const transactions = [
    income(30_444.27, "SALARY", "מעסיק"),
    income(4_000.96, "SALARY", "מעסיק"),
    income(2_499.35, "TRADING", "מכירת ניירות ערך"),
    income(3.25, "TRANSFER", "העברה"),
    income(1.24, "RETURN", "החזר"),
    income(100, "OTHER", "פרס"),
  ];

  const scored = scoreIncomeTransactions(transactions);
  assert.equal(scored.reduce((total, tx) => total + tx.amount, 0), 34_445.23);
  assert.deepEqual(scored.map((tx) => tx.categoryMain), ["SALARY", "SALARY"]);
});

test("median completed-period income is robust to an exceptional salary month", () => {
  assert.equal(medianAmount([30_250.04, 30_444.99, 31_285.4, 32_560.51, 121_977.94]), 31_285.4);
  assert.equal(medianAmount([]), null);
});
