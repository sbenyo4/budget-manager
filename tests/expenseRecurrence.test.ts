import assert from "node:assert/strict";
import test from "node:test";
import { isRepeatedExpenseGroup } from "../src/logic/expenseRecurrence.ts";

test("two purchases from the same merchant in one period are not one-time", () => {
  assert.equal(isRepeatedExpenseGroup(2, 1), true);
});

test("one purchase remains one-time until the merchant repeats", () => {
  assert.equal(isRepeatedExpenseGroup(1, 1), false);
});

test("a merchant appearing across periods is repeated", () => {
  assert.equal(isRepeatedExpenseGroup(2, 2), true);
});
