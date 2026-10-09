import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const viteSource = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
const productionSource = readFileSync(new URL("../api/transactions.ts", import.meta.url), "utf8");

test("the local API and production API use the same Open Finance transaction pipeline", () => {
  const routeStart = viteSource.indexOf('if (url.pathname === "/api/transactions")');
  const routeEnd = viteSource.indexOf("\n    next();", routeStart);
  assert.notEqual(routeStart, -1);
  assert.notEqual(routeEnd, -1);
  const localRoute = viteSource.slice(routeStart, routeEnd);

  assert.match(localRoute, /getTransactions\(settings, from, to\)/);
  assert.doesNotMatch(localRoute, /normalize\(|dedupeTransactions\(|attachCardDebitDetails\(/);
  assert.match(productionSource, /getTransactions\(settings, from, to\)/);
});
