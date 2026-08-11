import { performance } from "node:perf_hooks";
import { applyCategoryOverrides } from "../src/logic/categoryOverrides";
import { anonymizedCategoryScenario } from "../tests/fixtures/categoryPerformance";

interface Scenario {
  label: string;
  transactionCount: number;
  merchantCount: number;
  overrideCount: number;
  budgetMs: number;
}

const parsedBudgetMultiplier = Number(process.env.CATEGORY_BENCH_BUDGET_MULTIPLIER ?? 1);
const budgetMultiplier = Number.isFinite(parsedBudgetMultiplier) && parsedBudgetMultiplier >= 1
  ? parsedBudgetMultiplier
  : 1;

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

const scenarios: Scenario[] = [
  {
    label: "3,000 transactions / 300 merchants / 1 override",
    transactionCount: 3_000,
    merchantCount: 300,
    overrideCount: 1,
    budgetMs: 50,
  },
  {
    label: "3,000 transactions / 3,000 merchants / 200 overrides",
    transactionCount: 3_000,
    merchantCount: 3_000,
    overrideCount: 200,
    budgetMs: 100,
  },
  {
    label: "10,000 transactions / 1,000 merchants / 1,000 overrides",
    transactionCount: 10_000,
    merchantCount: 1_000,
    overrideCount: 1_000,
    budgetMs: 100,
  },
  {
    label: "10,000 transactions / 10,000 merchants / 1,000 overrides",
    transactionCount: 10_000,
    merchantCount: 10_000,
    overrideCount: 1_000,
    budgetMs: 400,
  },
];

let failed = false;
for (const scenario of scenarios) {
  const fixture = anonymizedCategoryScenario(
    scenario.transactionCount,
    scenario.merchantCount,
    scenario.overrideCount
  );
  for (let warmup = 0; warmup < 3; warmup += 1) {
    applyCategoryOverrides(fixture.transactions, fixture.overrides);
  }
  const samples: number[] = [];
  for (let run = 0; run < 10; run += 1) {
    const start = performance.now();
    applyCategoryOverrides(fixture.transactions, fixture.overrides);
    samples.push(performance.now() - start);
  }
  const medianMs = percentile(samples, 0.5);
  const p95Ms = percentile(samples, 0.95);
  const effectiveBudgetMs = scenario.budgetMs * budgetMultiplier;
  const withinBudget = medianMs <= effectiveBudgetMs;
  failed ||= !withinBudget;
  console.log(JSON.stringify({
    scenario: scenario.label,
    medianMs: Number(medianMs.toFixed(2)),
    p95Ms: Number(p95Ms.toFixed(2)),
    budgetMs: scenario.budgetMs,
    effectiveBudgetMs,
    withinBudget,
  }));
}

if (failed) process.exitCode = 1;
