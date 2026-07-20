import type { Period } from "./periods";
import type { Transaction } from "../types";
import { budgetDate, isConsumption } from "./flows";
import { isRepeatedExpenseGroup } from "./expenseRecurrence";
import { merchantKey, overrideKey } from "./categoryOverrides";

export function expenseOverrideKey(tx: Transaction): string {
  return overrideKey(tx.categoryMain, merchantKey(tx));
}

export function fixedExpenseKey(tx: Transaction): string {
  return `${tx.categoryMain}::${merchantKey(tx)}`;
}

function periodKeyFor(date: string, periods: Period[]): string | null {
  return periods.find((period) => date >= period.from && date <= period.to)?.key ?? null;
}

export function fixedExpenseKeysFor(
  transactions: Transaction[],
  periods: Period[],
  oneTimeKeys: Set<string>,
  forcedFixedKeys: Set<string>
): Set<string> {
  const groups = new Map<string, { tx: Transaction; count: number; periodKeys: Set<string>; recurring: boolean }>();

  for (const tx of transactions) {
    if (tx.type === "income" || !isConsumption(tx)) continue;
    const key = fixedExpenseKey(tx);
    const periodKey = periodKeyFor(budgetDate(tx), periods);
    const group = groups.get(key) ?? { tx, count: 0, periodKeys: new Set<string>(), recurring: false };
    group.count += 1;
    group.recurring = group.recurring || Boolean(tx.recurring);
    if (periodKey) group.periodKeys.add(periodKey);
    groups.set(key, group);
  }

  const fixedKeys = new Set<string>();
  for (const [key, group] of groups) {
    const detailKey = expenseOverrideKey(group.tx);
    if (forcedFixedKeys.has(detailKey)) {
      fixedKeys.add(key);
      continue;
    }
    if (oneTimeKeys.has(detailKey)) continue;
    if (group.recurring || isRepeatedExpenseGroup(group.count, group.periodKeys.size)) fixedKeys.add(key);
  }
  return fixedKeys;
}

export function isFixedExpense(tx: Transaction, fixedExpenseKeys: Set<string>): boolean {
  return fixedExpenseKeys.has(fixedExpenseKey(tx));
}
