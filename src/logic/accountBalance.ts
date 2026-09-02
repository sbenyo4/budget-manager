import type { CheckingBalance, Transaction } from "../types";

export interface PeriodBalanceReconciliation {
  end: number;
  start: number;
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export function signedBankMovement(transaction: Transaction): number {
  return transaction.type === "income" ? transaction.amount : -transaction.amount;
}

export function isBookedBankMovement(transaction: Transaction): boolean {
  return transaction.source !== "card" && transaction.status?.toUpperCase() !== "PENDING";
}

export function pendingBalanceAdjustment(balance: CheckingBalance): number | null {
  if (balance.bookedBalance === undefined) return null;
  return roundMoney(balance.balance - balance.bookedBalance);
}

export function pendingTransactionsMatchingBalance(
  balance: CheckingBalance,
  transactions: Transaction[]
): Transaction[] {
  const adjustment = pendingBalanceAdjustment(balance);
  if (adjustment === null || Math.abs(adjustment) < 0.005) return [];
  const adjustmentCents = Math.round(adjustment * 100);
  const candidates = transactions.filter(
    (transaction) =>
      transaction.source !== "card" &&
      transaction.status?.toUpperCase() === "PENDING"
  );
  const exact = candidates.filter(
    (transaction) => Math.round(signedBankMovement(transaction) * 100) === adjustmentCents
  );
  if (exact.length === 1) return exact;
  const totalCents = candidates.reduce(
    (total, transaction) => total + Math.round(signedBankMovement(transaction) * 100),
    0
  );
  return totalCents === adjustmentCents ? candidates : [];
}

/**
 * Reconstruct a period against the last fully booked bank balance. Expected
 * balances may already contain future-dated pending movements, so using them
 * against a table of booked rows creates a false opening-balance gap.
 */
export function reconcileBookedPeriod(
  balance: CheckingBalance,
  transactions: Transaction[],
  periodFrom: string,
  periodTo: string
): PeriodBalanceReconciliation {
  const anchorBalance = balance.bookedBalance ?? balance.balance;
  const anchorDate = balance.bookedDate ?? balance.date;
  const bookedBankTransactions = transactions.filter(isBookedBankMovement);
  const netAfterPeriod = bookedBankTransactions
    .filter((transaction) => transaction.date > periodTo && transaction.date <= anchorDate)
    .reduce((total, transaction) => total + signedBankMovement(transaction), 0);
  const end = roundMoney(anchorBalance - netAfterPeriod);
  const netInPeriod = bookedBankTransactions
    .filter(
      (transaction) =>
        transaction.date >= periodFrom &&
        transaction.date <= periodTo &&
        transaction.date <= anchorDate
    )
    .reduce((total, transaction) => total + signedBankMovement(transaction), 0);
  return { end, start: roundMoney(end - netInPeriod) };
}
