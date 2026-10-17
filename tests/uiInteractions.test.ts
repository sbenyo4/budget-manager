import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { JSDOM } from "jsdom";
import { emptyPreferences } from "../src/api/preferences.ts";
import { MonthlyView } from "../src/components/MonthlyView.tsx";
import { AIAnalysisView } from "../src/components/AIAnalysisView.tsx";
import type { Transaction } from "../src/types.ts";

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost:5175/",
  });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement,
    Node: globalThis.Node,
    MutationObserver: globalThis.MutationObserver,
  };
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    Node: { configurable: true, value: dom.window.Node },
    MutationObserver: { configurable: true, value: dom.window.MutationObserver },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, writable: true, value: true },
  });
  return () => {
    dom.window.close();
    Object.defineProperties(globalThis, {
      window: { configurable: true, value: previous.window },
      document: { configurable: true, value: previous.document },
      navigator: { configurable: true, value: previous.navigator },
      HTMLElement: { configurable: true, value: previous.HTMLElement },
      Node: { configurable: true, value: previous.Node },
      MutationObserver: { configurable: true, value: previous.MutationObserver },
    });
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  };
}

function futureCharge(id: string, merchant: string, amount: number, cardLast4: string): Transaction {
  return {
    id,
    date: "2026-09-10",
    billingDate: "2026-10-10",
    merchant,
    amount,
    status: "BOOKED",
    source: "card",
    type: "expense",
    cardLast4,
    categoryMain: "HOUSEHOLD_&_SERVICES",
    categorySub: "TV",
  };
}

test("the monthly search filters future charges only after their panel is opened", async () => {
  const restoreDom = installDom();
  const { cleanup, render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const user = userEvent.setup({ document: globalThis.document });

  try {
    const view = render(createElement(MonthlyView, {
      transactions: [
        futureCharge("future-streaming", "Future Streaming", 29.9, "1234"),
        futureCharge("future-grocery", "Future Grocery", 81.4, "5678"),
      ],
      periods: [{ key: "sep", label: "ספטמבר", from: "2026-09-01", to: "2026-09-30", salaryBased: true }],
      bankBalance: null,
      preferences: emptyPreferences,
      onPreferencesChange: () => undefined,
    }));

    assert.equal(view.queryByText("Future Streaming"), null);
    assert.equal(view.queryByText("Future Grocery"), null);

    await user.click(view.getByRole("button", { name: /חיובים עתידיים מאושרים/ }));
    assert.ok(view.getByText("Future Streaming"));
    assert.ok(view.getByText("Future Grocery"));

    await user.type(view.getByRole("searchbox", { name: /חיפוש/ }), "Streaming");
    const visibleMerchants = Array.from(view.container.querySelectorAll(".pending-card-merchant"))
      .map((element) => element.textContent?.trim());
    assert.deepEqual(visibleMerchants, ["Future Streaming"]);
    assert.equal(view.queryByText("Future Grocery"), null);
  } finally {
    cleanup();
    restoreDom();
  }
});

test("advanced search intersects free text, date, and amount across periods", async () => {
  const restoreDom = installDom();
  const { cleanup, fireEvent, render } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const user = userEvent.setup({ document: globalThis.document });
  const bankTransaction = (id: string, date: string, merchant: string, amount: number): Transaction => ({
    id,
    date,
    merchant,
    amount,
    status: "BOOKED",
    source: "bank",
    type: "expense",
    categoryMain: "HOUSEHOLD_&_SERVICES",
    categorySub: "OTHER",
  });

  try {
    const view = render(createElement(MonthlyView, {
      transactions: [
        bankTransaction("july-match", "2026-07-15", "Coffee history", 25),
        bankTransaction("july-pricey", "2026-07-16", "Coffee expensive", 80),
        bankTransaction("september", "2026-09-10", "Coffee current", 25),
      ],
      periods: [{ key: "sep", label: "ספטמבר", from: "2026-09-01", to: "2026-09-30", salaryBased: true }],
      bankBalance: null,
      preferences: emptyPreferences,
      onPreferencesChange: () => undefined,
    }));

    await user.type(view.getByRole("searchbox", { name: /חיפוש/ }), "Coffee");
    await user.click(view.getByRole("button", { name: "סינון חיפוש מתקדם" }));
    assert.ok(view.getByRole("dialog", { name: "סינון חיפוש" }));
    await user.click(view.getByRole("radio", { name: "טווח תאריכים" }));

    fireEvent.change(view.getByLabelText("מתאריך"), { target: { value: "2026-07-01" } });
    fireEvent.change(view.getByLabelText("עד תאריך"), { target: { value: "2026-07-31" } });
    fireEvent.change(view.getByLabelText("סכום מקסימלי"), { target: { value: "30" } });
    await user.click(view.getByRole("button", { name: "החלת סינון" }));

    const visibleRows = Array.from(view.container.querySelectorAll(".tx-table tbody tr"))
      .map((row) => row.textContent ?? "")
      .join("\n");
    assert.match(visibleRows, /Coffee history/);
    assert.doesNotMatch(visibleRows, /Coffee expensive/);
    assert.doesNotMatch(visibleRows, /Coffee current/);
  } finally {
    cleanup();
    restoreDom();
  }
});

test("an AI response for an old selection cannot replace the active selection's result", async () => {
  const restoreDom = installDom();
  const originalFetch = globalThis.fetch;
  const { act, cleanup, render, waitFor } = await import("@testing-library/react");
  const userEvent = (await import("@testing-library/user-event")).default;
  const user = userEvent.setup({ document: globalThis.document });
  let resolveManual: ((response: Response) => void) | undefined;
  let manualStarted: (() => void) | undefined;
  const manualRequestStarted = new Promise<void>((resolve) => {
    manualStarted = resolve;
  });

  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body ?? "{}")) as { cacheOnly?: boolean };
    if (payload.cacheOnly) {
      return new Response(JSON.stringify({ result: null, cached: false, updatedAt: null }), { status: 200 });
    }
    manualStarted?.();
    return new Promise<Response>((resolve) => {
      resolveManual = resolve;
    });
  };

  try {
    const view = render(createElement(AIAnalysisView, {
      transactions: [
        { ...futureCharge("sep", "September expense", 100, "1234"), source: "bank", date: "2026-09-10", billingDate: undefined },
        { ...futureCharge("aug", "August expense", 100, "1234"), source: "bank", date: "2026-08-10", billingDate: undefined },
      ],
      periods: [
        { key: "sep", label: "September", from: "2026-09-01", to: "2026-09-30", salaryBased: false },
        { key: "aug", label: "August", from: "2026-08-01", to: "2026-08-31", salaryBased: false },
      ],
      preferences: emptyPreferences,
    }));

    const runButton = await view.findByRole("button", { name: /AI/ });
    await waitFor(() => assert.equal((runButton as HTMLButtonElement).disabled, false));
    await user.click(runButton);
    await manualRequestStarted;
    await user.selectOptions(view.container.querySelector("#ai-month-select") as HTMLSelectElement, "aug");
    await act(async () => {
      resolveManual?.(new Response(JSON.stringify({
        result: { score: 1, summary: "STALE RESULT", strengths: [], risks: [], recommendations: [] },
        cached: false,
        updatedAt: "2026-09-15T00:00:00.000Z",
      }), { status: 200 }));
      await Promise.resolve();
    });

    assert.equal(view.queryByText("STALE RESULT"), null);
    await waitFor(() => assert.equal((view.getByRole("button", { name: /AI/ }) as HTMLButtonElement).disabled, false));
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
    restoreDom();
  }
});
