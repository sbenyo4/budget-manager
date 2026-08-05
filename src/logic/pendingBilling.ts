import type { Transaction } from "../types";
import { isCardTransactionCharged, type CardDebitCutoffs } from "./flows";

export interface PendingBillingSummary {
  billingDate?: string;
  total: number;
  count: number;
  pendingInstallmentCount: number;
}

export interface PendingBillingMonthSummary {
  monthKey?: string;
  total: number;
  count: number;
  pendingInstallmentCount: number;
  billingDateCount: number;
}

/**
 * Future card charges are account state, not reporting-period activity.
 * Include every card transaction that has not reached a booked aggregate
 * card debit yet, even when the purchase belongs to an earlier budget period.
 */
export function selectPendingCardTransactions(
  transactions: Transaction[],
  cutoffs: CardDebitCutoffs,
  cardLast4 = ""
): Transaction[] {
  return transactions.filter(
    (tx) =>
      tx.source === "card" &&
      (!cardLast4 || tx.cardLast4 === cardLast4) &&
      !isCardTransactionCharged(tx, cutoffs)
  );
}

/** Combines individual card billing dates into compact calendar-month totals. */
export function summarizePendingBillingMonths(
  billingSummaries: PendingBillingSummary[]
): PendingBillingMonthSummary[] {
  const months = new Map<string, PendingBillingMonthSummary>();

  for (const summary of billingSummaries) {
    const monthKey = summary.billingDate?.slice(0, 7);
    const key = monthKey ?? "next";
    const month = months.get(key) ?? {
      monthKey,
      total: 0,
      count: 0,
      pendingInstallmentCount: 0,
      billingDateCount: 0,
    };
    month.total += summary.total;
    month.count += summary.count;
    month.pendingInstallmentCount += summary.pendingInstallmentCount;
    if (summary.billingDate) month.billingDateCount += 1;
    months.set(key, month);
  }

  return [...months.values()]
    .map((month) => ({ ...month, total: Math.round(month.total * 100) / 100 }))
    .sort((a, b) =>
      (a.monthKey ?? "9999-99").localeCompare(b.monthKey ?? "9999-99")
    );
}
