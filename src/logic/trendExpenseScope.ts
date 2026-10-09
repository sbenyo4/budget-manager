import type { Transaction } from "../types";
import type { Period } from "./periods";
import { budgetDate } from "./flows";
import { fixedExpenseKeysFor } from "./expenseScope";

export function trendFixedExpenseKeys(
  transactions: Transaction[],
  periods: Period[],
  oneTimeExpenses: Set<string>,
  fixedExpenses: Set<string>
): Set<string> {
  const from = periods.reduce((earliest, period) => !earliest || period.from < earliest ? period.from : earliest, "");
  const to = periods.reduce((latest, period) => period.to > latest ? period.to : latest, "");
  const rangeTransactions = transactions.filter((transaction) => {
    const date = budgetDate(transaction);
    return Boolean(from && to && date >= from && date <= to);
  });
  return fixedExpenseKeysFor(rangeTransactions, periods, oneTimeExpenses, fixedExpenses);
}
