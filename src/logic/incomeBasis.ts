import type { Transaction } from "../types";

const NON_FLOW_INCOME_MAINS = new Set(["TRADING", "TRANSFER", "ASSETS", "DEPOSIT"]);
const NON_SCORE_INCOME_MAINS = new Set(["RETURN", "REIMBURSEMENTS", ...NON_FLOW_INCOME_MAINS]);
const RECURRING_INCOME_MAINS = new Set(["SALARY", "PENSION", "BENEFITS"]);

/**
 * Income that can support an affordability score. When a salary/pension/benefit
 * exists in the period, incidental income is deliberately excluded from the
 * denominator so refunds, prizes and asset sales cannot inflate the score.
 */
export function scoreIncomeTransactions(transactions: Transaction[]): Transaction[] {
  const eligible = transactions.filter(
    (tx) => tx.type === "income" && tx.source !== "card" && !NON_SCORE_INCOME_MAINS.has(tx.categoryMain)
  );
  const recurring = eligible.filter((tx) => RECURRING_INCOME_MAINS.has(tx.categoryMain));
  return recurring.length > 0 ? recurring : eligible;
}

export function medianAmount(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
