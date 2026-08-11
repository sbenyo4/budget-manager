import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const trendsSource = readFileSync(new URL("../src/components/TrendsView.tsx", import.meta.url), "utf8");

test("salary periods depend on raw transactions rather than category overrides", () => {
  assert.match(appSource, /buildPeriods\(allTransactions\)/);
  assert.doesNotMatch(appSource, /buildPeriods\(learnedTransactions\)/);
});

test("monthly, trends, and AI share one fixed-expense selector implementation", () => {
  assert.match(trendsSource, /import \{ fixedExpenseKey, fixedExpenseKeysFor \} from "\.\.\/logic\/expenseScope"/);
  assert.doesNotMatch(trendsSource, /function fixedExpenseKeysFor\(/);
});
