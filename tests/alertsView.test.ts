import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AlertsView } from "../src/components/AlertsView.tsx";
import { detectTransactionAlerts } from "../src/logic/transactionAlerts.ts";
import type { Transaction } from "../src/types.ts";

function yango(id: string, date: string, amount: number): Transaction {
  return {
    id,
    date,
    merchant: "YANGO DELI B2C",
    amount,
    categoryMain: "FOOD_&_DRINKS",
    categorySub: "RESTAURANT",
    recurring: true,
  };
}

test("recurring alert renders its current transaction and median breakdown", () => {
  const alert = detectTransactionAlerts(
    [
      yango("y1", "2026-07-02", 280),
      yango("y2", "2026-08-02", 297.6),
      yango("y3", "2026-09-02", 180.12),
      yango("y4", "2026-09-15", 200.2),
    ],
    { highAmountThreshold: 5_000 }
  )[0];
  const html = renderToStaticMarkup(
    createElement(AlertsView, { alerts: [alert], onApprove: async () => undefined })
  );

  assert.match(html, /איך חישבנו את הסכום/);
  assert.match(html, /02\.09\.2026/);
  assert.match(html, /15\.09\.2026/);
  assert.match(html, /180\.12/);
  assert.match(html, /200\.20/);
  assert.match(html, /380\.32/);
  assert.match(html, /288\.80/);
});
