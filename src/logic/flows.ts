import type { Transaction } from "../types";

/**
 * The aggregate debit of the credit card on the checking account. The card's
 * individual transactions are the detail behind these rows — summing both
 * double-counts.
 */
export function isCardDebit(tx: Transaction): boolean {
  return tx.categoryMain === "INCOMES_EXPENSES" && tx.categorySub === "CREDIT_CARD_CHECKING";
}

/**
 * Bank transfers this size and up are investment deposits, not payments —
 * the user's monthly investment routine shows up partly as TRANSFER and
 * partly as ASSETS/INVESTMENTS depending on how the bank tagged it. Small
 * transfers (a few hundred ₪ to people) stay out.
 */
const LARGE_TRANSFER_MIN = 1000;

/**
 * Money put aside: securities (buys, FX), deposits, investment transfers,
 * and large bank transfers (see above). Income-typed rows of the same
 * categories are withdrawals — net savings is expenses minus incomes.
 */
export function isSavings(tx: Transaction): boolean {
  if (tx.categoryMain === "TRADING" || tx.categoryMain === "ASSETS") return true;
  if (tx.categoryMain === "TRANSFER" && tx.amount >= LARGE_TRANSFER_MIN) return true;
  return false;
}

/**
 * Consumption spending — what the No-Buy calendar and the category donut
 * track. Excludes the aggregate card debits (detail arrives separately),
 * money movements that aren't purchases (securities, transfers, deposits)
 * and huge one-off checks (DEPOSIT — e.g. a house payment isn't groceries).
 */
export function isConsumption(tx: Transaction): boolean {
  return (
    !isCardDebit(tx) &&
    !isSavings(tx) &&
    tx.categoryMain !== "TRANSFER" &&
    tx.categoryMain !== "DEPOSIT"
  );
}
