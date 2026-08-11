import type { Transaction } from "../types";
import { authFetch } from "./authToken";

export interface Account {
  id: string;
  providerId: string;
  accountType: string;
  accountName: string;
  currency: string;
  balance: number;
  balanceDate: string;
}

/**
 * Current ILS checking-account balance (sum over checking accounts), or null
 * in demo mode / on failure — the UI falls back to relative cumulative sums.
 */
export async function fetchCheckingBalance(): Promise<{ balance: number; date: string } | null> {
  try {
    const res = await authFetch("/api/accounts");
    if (!res.ok) return null;
    const accounts = (await res.json()) as Account[];
    const checking = accounts.filter((a) => a.accountType === "CHECKING" && a.currency === "ILS");
    if (checking.length === 0) return null;
    return {
      balance: checking.reduce((s, a) => s + a.balance, 0),
      date: checking[0].balanceDate,
    };
  } catch {
    return null;
  }
}

export interface FetchResult {
  transactions: Transaction[];
  /** True only for explicit demo flows. Missing credentials no longer show sample data. */
  demo: boolean;
}

function pendingInvestmentKey(tx: Transaction): string | null {
  if (tx.source !== "bank" || tx.status?.toUpperCase() !== "PENDING") return null;
  const merchant = tx.merchant.replace(/[\s\-–—_'״”"]/g, "").toLowerCase();
  if (!merchant.includes("ניעקניה")) return null;
  return [tx.date, merchant, tx.categoryMain, tx.categorySub].join(":");
}

export function dedupePendingInvestmentTransactions(transactions: Transaction[]): Transaction[] {
  const unique: Transaction[] = [];
  const candidateIndexes = new Map<string, number[]>();
  for (const tx of transactions) {
    const key = pendingInvestmentKey(tx);
    if (!key) {
      unique.push(tx);
      continue;
    }
    const indexes = candidateIndexes.get(key) ?? [];
    const matchingIndex = indexes.find((index) => {
      const existingAmount = unique[index].amount;
      const delta = Math.abs(existingAmount - tx.amount);
      return delta <= 10 && delta <= Math.min(existingAmount, tx.amount) * 0.001;
    });
    if (matchingIndex !== undefined) {
      if (tx.amount > unique[matchingIndex].amount) unique[matchingIndex] = tx;
      continue;
    }
    indexes.push(unique.length);
    candidateIndexes.set(key, indexes);
    unique.push(tx);
  }
  return unique;
}

function hasCardMerchantProviderSuffix(value: string): boolean {
  return /\s*[-‐‑‒–—―−־]\s*צמ\s*$/u.test(
    value.normalize("NFKC").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/giu, "")
  );
}

function normalizedCardMerchant(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/giu, "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*[-‐‑‒–—―−־]\s*צמ\s*$/u, "")
    .trim()
    .toLocaleLowerCase("he");
}

function cardTransactionScore(tx: Transaction): number {
  return (
    (tx.status?.toUpperCase() === "PENDING" ? 0 : tx.status ? 4 : 1) +
    (tx.billingDate ? 2 : 0) +
    (hasCardMerchantProviderSuffix(tx.merchant) ? 0 : 1)
  );
}

export function dedupeCardProviderAliasTransactions(transactions: Transaction[]): Transaction[] {
  const unique: Transaction[] = [];
  const cardIndexes = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.source !== "card") {
      unique.push(tx);
      continue;
    }
    const key = [
      tx.cardLast4 ?? "",
      tx.date,
      Math.round(tx.amount * 100),
      normalizedCardMerchant(tx.merchant),
    ].join(":");
    const existingIndex = cardIndexes.get(key);
    if (existingIndex !== undefined) {
      if (cardTransactionScore(tx) > cardTransactionScore(unique[existingIndex])) unique[existingIndex] = tx;
      continue;
    }
    cardIndexes.set(key, unique.length);
    unique.push(tx);
  }
  return unique;
}

/**
 * Fetch expense transactions for a date range (ISO dates, inclusive) via the
 * local /api proxy (see vite.config.ts — the open-finance.ai credentials live
 * server-side only). Missing per-user credentials are surfaced to the UI so it
 * can ask the user to fill settings instead of showing unrelated sample data.
 */
export async function fetchTransactions(from: string, to: string): Promise<FetchResult> {
  const status = await authFetch("/api/status")
    .then(async (r) => {
      if (!r.ok) return { configured: false };
      return (await r.json()) as { configured: boolean };
    })
    .catch(() => ({ configured: false }));

  if (!status.configured) {
    throw new Error("SERVICE_SETTINGS_REQUIRED");
  }

  const res = await authFetch(`/api/transactions?from=${from}&to=${to}`);
  if (!res.ok) {
    const text = await res.text();
    let message = text || `HTTP ${res.status}`;
    try {
      const body = JSON.parse(text) as { error?: string };
      message = body.error ?? message;
    } catch {
      // Keep the raw message for Vercel function errors.
    }
    if (
      res.status === 401 ||
      res.status === 404 ||
      res.status === 503 ||
      message === "AUTH_REQUIRED" ||
      message === "NOT_CONFIGURED" ||
      message.includes("NOT_FOUND") ||
      message.includes("page could not be found")
    ) {
      throw new Error("SERVICE_SETTINGS_REQUIRED");
    }
    throw new Error(message);
  }
  const transactions = (await res.json()) as Transaction[];
  return {
    transactions: dedupePendingInvestmentTransactions(dedupeCardProviderAliasTransactions(transactions)),
    demo: false,
  };
}
