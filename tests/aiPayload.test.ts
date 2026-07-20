import assert from "node:assert/strict";
import test from "node:test";
import { isValidAIAnalysisPayload } from "../server/aiPayload.ts";
import { compactPayload, parseResult, promptFor } from "../server/aiAnalysis.ts";

test("AI payload validation accepts bounded financial input", () => {
  assert.equal(isValidAIAnalysisPayload({ periodLabel: "יולי 2026", transactions: [{ amount: 10, type: "expense" }], bankBalance: null }), true);
});

test("AI payload validation rejects non-finite amounts and oversized labels", () => {
  assert.equal(isValidAIAnalysisPayload({ periodLabel: "x", transactions: [{ amount: Number.NaN }], bankBalance: null }), false);
  assert.equal(isValidAIAnalysisPayload({ periodLabel: "x".repeat(301), transactions: [], bankBalance: null }), false);
});

test("the compact AI payload excludes checking balance and retains affordability metrics", () => {
  const compact = compactPayload({
    periodLabel: "יולי 2026",
    transactions: [{ amount: 2_000, type: "expense", source: "bank" }],
    analytics: {
      affordability: {
        incomeBasisMethod: "actual_salary_period_income",
        incomeBasisAmount: 10_000,
        monthlyConsumptionExpenses: 2_000,
        consumptionToIncomePercent: 20,
      },
    },
    ...({ bankBalance: { balance: 1, date: "2026-07-21" } } as object),
  });

  assert.equal("bankBalance" in compact, false);
  assert.deepEqual((compact.analytics as { affordability: unknown }).affordability, {
    incomeBasisMethod: "actual_salary_period_income",
    incomeBasisAmount: 10_000,
    monthlyConsumptionExpenses: 2_000,
    consumptionToIncomePercent: 20,
  });
});

test("the compact AI payload treats large deposits as positive savings, not consumption", () => {
  const compact = compactPayload({
    periodLabel: "מגמות",
    analysisMode: "trend",
    transactions: [
      { date: "2025-08-11", amount: 1_300_000, type: "expense", source: "bank", categoryMain: "DEPOSIT", categorySub: "CHQ_INCOME", merchant: "שיק" },
      { date: "2025-08-20", amount: 700_000, type: "expense", source: "bank", categoryMain: "DEPOSIT", categorySub: "CHQ_INCOME", merchant: "שיק" },
    ],
  });

  assert.deepEqual(compact.totals, {
    income: 0,
    consumptionExpenses: 0,
    savingsAndInvestments: 2_000_000,
    leftover: -2_000_000,
    categories: {},
  });
  assert.deepEqual(compact.topCategories, []);
});

test("the AI scoring prompt uses stable weights and guards against excessive volatility penalties", () => {
  const prompt = promptFor({ periodLabel: "מגמות", analysisMode: "trend", transactions: [] });

  assert.match(prompt, /55% ongoing affordability/);
  assert.match(prompt, /20% recurring burden/);
  assert.match(prompt, /15% savings\/investment capacity/);
  assert.match(prompt, /10% income\/spending stability/);
  assert.match(prompt, /Do not give a score below 80 solely because of travel/);
  assert.match(prompt, /Data uncertainty alone is not such a weakness/);
});

test("AI response parsing reports incomplete JSON without exposing a parser error", () => {
  assert.throws(() => parseResult('{"score": 90, "summary": "נקטע'), /AI_INVALID_JSON_RESPONSE/);
  assert.throws(() => parseResult(""), /AI_EMPTY_RESPONSE/);
});
