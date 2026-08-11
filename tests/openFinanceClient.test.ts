import assert from "node:assert/strict";
import test from "node:test";
import { fetchBudgetData, fetchTransactions } from "../src/api/openFinance.ts";
import type { Transaction } from "../src/types.ts";

const transaction: Transaction = {
  id: "tx-1",
  date: "2026-08-01",
  merchant: "Merchant",
  amount: 100,
  status: "BOOKED",
  source: "card",
  type: "expense",
  categoryMain: "SHOPPING",
  categorySub: "GENERAL",
};

test("transaction loading uses the authoritative transactions endpoint without a status preflight", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(JSON.stringify([transaction]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await fetchTransactions("2026-08-01", "2026-08-31");
    assert.deepEqual(result, { transactions: [transaction], demo: false });
    assert.deepEqual(urls, ["/api/transactions?from=2026-08-01&to=2026-08-31"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a not-configured transactions response retains the existing settings-required error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "NOT_CONFIGURED" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });

  try {
    await assert.rejects(
      fetchTransactions("2026-08-01", "2026-08-31"),
      new Error("SERVICE_SETTINGS_REQUIRED")
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("budget loading starts transactions and balance requests concurrently", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  let releaseTransactions: (() => void) | undefined;
  const transactionsReady = new Promise<void>((resolve) => {
    releaseTransactions = resolve;
  });
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith("/api/transactions")) {
      await transactionsReady;
      return new Response(JSON.stringify([transaction]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "/api/accounts") {
      return new Response(JSON.stringify([{
        id: "account-1",
        providerId: "bank",
        accountType: "CHECKING",
        accountName: "Checking",
        currency: "ILS",
        balance: 12_345,
        balanceDate: "2026-08-01",
      }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const pending = fetchBudgetData("2026-08-01", "2026-08-31");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(urls, [
      "/api/transactions?from=2026-08-01&to=2026-08-31",
      "/api/accounts",
    ]);
    releaseTransactions?.();
    assert.deepEqual(await pending, {
      transactions: [transaction],
      demo: false,
      bankBalance: { balance: 12_345, date: "2026-08-01" },
    });
  } finally {
    releaseTransactions?.();
    globalThis.fetch = originalFetch;
  }
});

test("budget loading forwards cancellation to both requests", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const signals: AbortSignal[] = [];
  globalThis.fetch = async (_input, init) => {
    if (init?.signal) signals.push(init.signal);
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  };

  try {
    const pending = fetchBudgetData("2026-08-01", "2026-08-31", controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.deepEqual(signals, [controller.signal, controller.signal]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
