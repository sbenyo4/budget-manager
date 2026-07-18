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
  return { transactions: (await res.json()) as Transaction[], demo: false };
}
