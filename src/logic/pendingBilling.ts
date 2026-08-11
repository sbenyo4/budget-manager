import type { Transaction } from "../types";
import { isCardDebit, isCardTransactionCharged, type CardDebitCutoffs } from "./flows";

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

function normalizedPendingMerchant(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/giu, "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*[-‐‑‒–—―−־]\s*צמ\s*$/u, "")
    .trim()
    .toLocaleLowerCase("he");
}

function hasPendingMerchantProviderSuffix(value: string): boolean {
  return /\s*[-‐‑‒–—―−־]\s*צמ\s*$/u.test(
    value.normalize("NFKC").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/giu, "")
  );
}

function dedupePendingDisplayTransactions(transactions: Transaction[]): Transaction[] {
  const unique: Transaction[] = [];
  const indexes = new Map<string, number>();
  for (const tx of transactions) {
    const key = [
      tx.cardLast4 ?? "",
      tx.date,
      Math.round(tx.amount * 100),
      normalizedPendingMerchant(tx.merchant),
    ].join(":");
    const existingIndex = indexes.get(key);
    if (existingIndex !== undefined) {
      if (
        hasPendingMerchantProviderSuffix(unique[existingIndex].merchant) &&
        !hasPendingMerchantProviderSuffix(tx.merchant)
      ) {
        unique[existingIndex] = tx;
      }
      continue;
    }
    indexes.set(key, unique.length);
    unique.push(tx);
  }
  return unique;
}

/**
 * Future card charges are account state, not reporting-period activity.
 * Include every card transaction that has not reached a booked aggregate
 * card debit yet, even when the purchase belongs to an earlier budget period.
 */
export function selectPendingCardTransactions(
  transactions: Transaction[],
  cutoffs: CardDebitCutoffs,
  cardLast4 = "",
  excludedTransactionIds: ReadonlySet<string> = new Set()
): Transaction[] {
  return dedupePendingDisplayTransactions(
    transactions.filter(
      (tx) =>
        tx.source === "card" &&
        (!cardLast4 || tx.cardLast4 === cardLast4) &&
        !excludedTransactionIds.has(tx.id) &&
        !isCardTransactionCharged(tx, cutoffs)
    )
  );
}

/**
 * Card purchases already represented by an aggregate bank debit that is in
 * PENDING status. They are still unsettled, but no longer belong to the next
 * card cycle because the debit is already on its way to the checking account.
 */
export function selectCardTransactionsInPendingDebits(
  transactions: Transaction[],
  fallbackDetailsByDebitId: ReadonlyMap<string, Transaction[]> = new Map(),
  cardLast4 = ""
): Transaction[] {
  const cardTransactionsById = new Map(
    transactions.filter((tx) => tx.source === "card").map((tx) => [tx.id, tx])
  );
  const selected = new Map<string, Transaction>();

  for (const debit of transactions) {
    if (!isCardDebit(debit) || debit.type === "income" || debit.status?.toUpperCase() !== "PENDING") continue;
    const details = debit.detailTransactions?.length
      ? debit.detailTransactions
      : fallbackDetailsByDebitId.get(debit.id) ?? [];
    for (const detail of details) {
      const transaction = cardTransactionsById.get(detail.id) ?? detail;
      if (cardLast4 && transaction.cardLast4 !== cardLast4) continue;
      selected.set(transaction.id, transaction);
    }
  }

  return [...selected.values()];
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
