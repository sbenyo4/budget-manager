import assert from "node:assert/strict";
import test from "node:test";
import {
  detectHighCheckingBalanceAlert,
  detectTransactionAlerts,
  mergeAlertApprovals,
  type TransactionAlert,
} from "../src/logic/transactionAlerts.ts";
import { applyCategoryOverrides } from "../src/logic/categoryOverrides.ts";
import type { Transaction } from "../src/types.ts";

function expense(id: string, date: string, merchant: string, amount: number, extra: Partial<Transaction> = {}): Transaction {
  return {
    id,
    date,
    merchant,
    amount,
    categoryMain: "HOUSEHOLD_&_SERVICES",
    categorySub: "COMMUNICATIONS",
    ...extra,
  };
}

test("detects a checking balance above the configured threshold", () => {
  assert.equal(
    detectHighCheckingBalanceAlert({ balance: 15_000, date: "2026-08-05" }, 15_000),
    null,
  );

  assert.equal(
    detectHighCheckingBalanceAlert({ balance: 15_450, date: "2026-08-05" }, 15_000),
    null,
  );

  assert.ok(
    detectHighCheckingBalanceAlert({ balance: 15_450.01, date: "2026-08-05" }, 15_000),
  );

  const alert = detectHighCheckingBalanceAlert(
    { balance: 18_250, date: "2026-08-05" },
    15_000,
  );

  assert.ok(alert);
  assert.equal(alert.kind, "high_balance");
  assert.equal(alert.amount, 18_250);
  assert.equal(alert.previousAmount, 15_000);
  assert.equal(alert.transactionIds.length, 0);
  assert.equal(
    detectHighCheckingBalanceAlert(
      { balance: 18_250, date: "2026-08-05" },
      15_000,
      { [alert.approvalKey]: alert.approvalValue },
    ),
    null,
  );
});

test("detects a recurring service price increase", () => {
  const alerts = detectTransactionAlerts(
    [
      expense("n1", "2026-05-01", "Netflix", 50, { recurring: true }),
      expense("n2", "2026-06-01", "Netflix", 50, { recurring: true }),
      expense("n3", "2026-07-01", "Netflix", 65, { recurring: true }),
    ],
    { highAmountThreshold: 5_000 }
  );

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "price_increase");
  assert.equal(alerts[0].previousAmount, 50);
  assert.equal(alerts[0].amount, 65);
});

test("an approved new price becomes the baseline until another increase", () => {
  const transactions = [
    expense("n1", "2026-05-01", "Netflix", 50, { recurring: true }),
    expense("n2", "2026-06-01", "Netflix", 50, { recurring: true }),
    expense("n3", "2026-07-01", "Netflix", 65, { recurring: true }),
  ];
  const approved = { "price:netflix": 65 };

  assert.equal(
    detectTransactionAlerts(transactions, { highAmountThreshold: 5_000, approvals: approved }).length,
    0
  );

  const alerts = detectTransactionAlerts(
    [...transactions, expense("n4", "2026-08-01", "Netflix", 66, { recurring: true })],
    { highAmountThreshold: 5_000, approvals: approved }
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].previousAmount, 65);
  assert.equal(alerts[0].amount, 66);
});

test("detects a significant utility spike", () => {
  const alerts = detectTransactionAlerts(
    [
      expense("e1", "2026-04-05", "חברת החשמל", 400, { categorySub: "UTILITIES" }),
      expense("e2", "2026-05-05", "חברת החשמל", 420, { categorySub: "UTILITIES" }),
      expense("e3", "2026-06-05", "חברת החשמל", 410, { categorySub: "UTILITIES" }),
      expense("e4", "2026-07-05", "חברת החשמל", 650, { categorySub: "UTILITIES" }),
    ],
    { highAmountThreshold: 5_000 }
  );

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "monthly_spike");
});

test("detects a meaningful mortgage payment increase", () => {
  const mortgage = (id: string, date: string, amount: number) =>
    expense(id, date, "פועלים-משכנתא", amount, {
      categoryMain: "LOAN_TRANSACTION",
      categorySub: "MORTGAGE",
    });

  const learnedTransactions = applyCategoryOverrides(
    [
      mortgage("mortgage-feb", "2026-02-15", 3_651.71),
      mortgage("mortgage-mar", "2026-03-15", 3_646.69),
      mortgage("mortgage-apr", "2026-04-15", 3_650.04),
      mortgage("mortgage-may", "2026-05-15", 3_656.73),
      mortgage("mortgage-jun", "2026-06-15", 3_676.8),
      mortgage("mortgage-jul", "2026-07-15", 3_671.78),
      mortgage("mortgage-aug", "2026-08-16", 3_809.56),
      expense("future-card", "2026-08-17", "Future card purchase", 100, {
        source: "card",
        billingDate: "2026-09-15",
        categoryMain: "FOOD_&_DRINKS",
        categorySub: "RESTAURANT",
      }),
    ],
    { "פועלים-משכנתא": "LOAN_TRANSACTION" }
  );
  const alerts = detectTransactionAlerts(
    learnedTransactions,
    { highAmountThreshold: 5_000 }
  );

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "price_increase");
  assert.equal(alerts[0].merchant, "פועלים-משכנתא");
  assert.equal(alerts[0].amount, 3_809.56);
  assert.equal(alerts[0].previousMonthAmount, 3_671.78);
  assert.equal(alerts[0].previousAmount, 3_654.22);
  assert.equal(alerts[0].increasePercent, 4);
});

test("detects and remembers approval for a high transaction", () => {
  const tx = expense("large-1", "2026-07-10", "חנות רהיטים", 7_500, {
    categoryMain: "SHOPPING",
    categorySub: "FURNITURE",
  });
  const alert = detectTransactionAlerts([tx], { highAmountThreshold: 5_000 })[0];
  assert.equal(alert.kind, "high_amount");
  assert.equal(
    detectTransactionAlerts([tx], {
      highAmountThreshold: 5_000,
      approvals: { [alert.approvalKey]: alert.approvalValue },
    }).length,
    0
  );
});

test("ignores aggregate card debits and savings movements", () => {
  const alerts = detectTransactionAlerts(
    [
      expense("card", "2026-07-10", "חיוב כרטיס", 8_000, {
        categoryMain: "INCOMES_EXPENSES",
        categorySub: "CREDIT_CARD_CHECKING",
      }),
      expense("saving", "2026-07-11", "הפקדה להשקעה", 10_000, {
        categoryMain: "TRADING",
        categorySub: "SECURITIES",
      }),
    ],
    { highAmountThreshold: 5_000 }
  );
  assert.deepEqual(alerts, []);
});

test("detects an unclear numeric merchant name", () => {
  const alerts = detectTransactionAlerts(
    [
      expense("odd", "2026-07-12", "998877665544", 900, {
        categoryMain: "SHOPPING",
        categorySub: "OTHER",
      }),
    ],
    { highAmountThreshold: 5_000 }
  );
  assert.equal(alerts[0].kind, "strange_merchant");
});

test("period alerts include historical changes only inside the selected range", () => {
  const alerts = detectTransactionAlerts(
    [
      expense("s1", "2026-01-01", "Streaming", 50, { recurring: true }),
      expense("s2", "2026-02-01", "Streaming", 50, { recurring: true }),
      expense("s3", "2026-03-01", "Streaming", 70, { recurring: true }),
      expense("s4", "2026-04-01", "Streaming", 70, { recurring: true }),
      expense("old-high", "2026-01-15", "חנות ישנה", 8_000, {
        categoryMain: "SHOPPING",
        categorySub: "OTHER",
      }),
      expense("range-high", "2026-03-15", "חנות בטווח", 8_000, {
        categoryMain: "SHOPPING",
        categorySub: "OTHER",
      }),
    ],
    {
      highAmountThreshold: 5_000,
      alertFrom: "2026-02-01",
      alertTo: "2026-03-31",
      includeHistoricalPriceChanges: true,
    }
  );

  assert.deepEqual(
    alerts.map((alert) => alert.id).sort(),
    ["high:range-high", "price:streaming:2026-03:70"]
  );
});

test("multiple alert approvals merge into one preference payload", () => {
  const alerts = [
    {
      approvalKey: "price:streaming",
      approvalValue: 70,
    },
    {
      approvalKey: "transaction:large",
      approvalValue: 8_000,
    },
    {
      approvalKey: "price:streaming",
      approvalValue: 65,
    },
  ] as TransactionAlert[];

  assert.deepEqual(mergeAlertApprovals({ "merchant:known": 1 }, alerts), {
    "merchant:known": 1,
    "price:streaming": 70,
    "transaction:large": 8_000,
  });
});
