import type { Transaction } from "../types";

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
  /** True only for explicit demo flows. Missing credentials no longer show sample data. */
  demo: boolean;
}

/**
 * Fetch expense transactions for a date range (ISO dates, inclusive) via the
 * local /api proxy (see vite.config.ts — the open-finance.ai credentials live
 * server-side only). Missing per-user credentials are surfaced to the UI so it
 * can ask the user to fill settings instead of showing unrelated sample data.
 */
export async function fetchTransactions(from: string, to: string): Promise<FetchResult> {
  const status = await fetch("/api/status")
    .then((r) => r.json() as Promise<{ configured: boolean }>)
    .catch(() => ({ configured: false }));

  if (!status.configured) {
    throw new Error("SERVICE_SETTINGS_REQUIRED");
  }

  const res = await fetch(`/api/transactions?from=${from}&to=${to}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return { transactions: (await res.json()) as Transaction[], demo: false };
}
