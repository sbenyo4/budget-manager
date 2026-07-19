import type { AIAnalysisPayload } from "./aiAnalysis.js";

const MAX_TRANSACTIONS = 5_000;

export function isValidAIAnalysisPayload(value: unknown): value is AIAnalysisPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<AIAnalysisPayload>;
  if (typeof payload.periodLabel !== "string" || payload.periodLabel.length > 300) return false;
  if (!Array.isArray(payload.transactions) || payload.transactions.length > MAX_TRANSACTIONS) return false;
  let transactionCount = payload.transactions.length;
  for (const tx of payload.transactions) {
    if (!tx || typeof tx !== "object") return false;
    if (typeof tx.merchant === "string" && tx.merchant.length > 500) return false;
    if (tx.amount !== undefined && (typeof tx.amount !== "number" || !Number.isFinite(tx.amount))) return false;
    if (tx.type !== undefined && tx.type !== "income" && tx.type !== "expense") return false;
    if (tx.source !== undefined && tx.source !== "bank" && tx.source !== "card") return false;
    if (tx.detailTransactions !== undefined) {
      if (!Array.isArray(tx.detailTransactions)) return false;
      transactionCount += tx.detailTransactions.length;
      if (transactionCount > MAX_TRANSACTIONS) return false;
    }
  }
  return true;
}
