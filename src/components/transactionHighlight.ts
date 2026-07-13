import type { Transaction } from "../types";
import { isSavings } from "../logic/flows";
import { isTodayIso } from "./format";

export function transactionHighlightClass(tx: Transaction, highAmountThreshold: number): string {
  const isPositive = tx.type === "income";
  const isSecurityMovement = isSavings(tx);
  return [
    isTodayIso(tx.date) ? "today-transaction" : "",
    isPositive ? "positive-transaction" : "",
    isSecurityMovement ? "securities-transaction" : "",
    !isPositive && !isSecurityMovement && tx.amount >= highAmountThreshold ? "large-transaction" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
