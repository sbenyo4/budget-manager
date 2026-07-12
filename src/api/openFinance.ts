import type { Transaction } from "../types";
import { demoTransactions } from "../data/demoTransactions";

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
    const res = await fetch("/api/accounts");
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
  /** True when the API credentials are missing and demo data was returned */
  demo: boolean;
}

/**
 * Fetch expense transactions for a date range (ISO dates, inclusive) via the
 * local /api proxy (see vite.config.ts — the open-finance.ai credentials live
 * server-side only). Falls back to demo data when .env is not configured.
 */
export async function fetchTransactions(from: string, to: string): Promise<FetchResult> {
  const status = await fetch("/api/status")
    .then((r) => r.json() as Promise<{ configured: boolean }>)
    .catch(() => ({ configured: false }));

  if (!status.configured) {
    return {
      transactions: demoTransactions.filter((tx) => tx.date >= from && tx.date <= to),
      demo: true,
    };
  }

  const res = await fetch(`/api/transactions?from=${from}&to=${to}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return { transactions: (await res.json()) as Transaction[], demo: false };
}
