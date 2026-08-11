import { performance } from "node:perf_hooks";
import { applyCategoryOverrides } from "../src/logic/categoryOverrides";
import type { Transaction } from "../src/types";

interface Scenario {
  label: string;
  transactions: Transaction[];
  overrides: Record<string, string>;
  budgetMs: number;
}

function makeTransactions(count: number, merchantCount: number, categoryMain = "SHOPPING"): Transaction[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `tx-${index}`,
    date: "2026-08-01",
    merchant: `Merchant ${index % merchantCount}`,
    amount: 20 + (index % 480),
    status: "BOOKED",
    source: "card",
    type: "expense",
    categoryMain,
    categorySub: "USER_DEFINED",
  }));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const overrides200 = Object.fromEntries(
  Array.from({ length: 200 }, (_, index) => [`Merchant ${index}`, "SHOPPING"])
);
const scenarios: Scenario[] = [
  {
    label: "3,000 transactions / 300 merchants / 1 override",
    transactions: makeTransactions(3_000, 300),
    overrides: { "Merchant 1": "FOOD_&_DRINKS" },
    budgetMs: 200,
  },
  {
    label: "3,000 transactions / 300 merchants / 200 overrides",
    transactions: makeTransactions(3_000, 300),
    overrides: overrides200,
    budgetMs: 250,
  },
  {
    label: "3,000 transactions / 3,000 merchants / 200 overrides",
    transactions: makeTransactions(3_000, 3_000),
    overrides: overrides200,
    budgetMs: 750,
  },
  {
    label: "3,000 unknown-category transactions / 3,000 merchants",
    transactions: makeTransactions(3_000, 3_000, "OTHER"),
    overrides: {},
    budgetMs: 500,
  },
];

let failed = false;
for (const scenario of scenarios) {
  applyCategoryOverrides(scenario.transactions, scenario.overrides);
  const samples: number[] = [];
  for (let run = 0; run < 3; run += 1) {
    const start = performance.now();
    applyCategoryOverrides(scenario.transactions, scenario.overrides);
    samples.push(performance.now() - start);
  }
  const medianMs = median(samples);
  const withinBudget = medianMs <= scenario.budgetMs;
  failed ||= !withinBudget;
  console.log(JSON.stringify({
    scenario: scenario.label,
    medianMs: Number(medianMs.toFixed(2)),
    budgetMs: scenario.budgetMs,
    withinBudget,
  }));
}

if (failed) process.exitCode = 1;
