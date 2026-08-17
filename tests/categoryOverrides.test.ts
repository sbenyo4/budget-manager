import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCategoryOverrides,
  customCategoryKey,
  normalizeCategoryKey,
} from "../src/logic/categoryOverrides.ts";
import type { Transaction } from "../src/types.ts";

function transaction(
  id: string,
  merchant: string,
  categoryMain = "SHOPPING",
  categorySub = "GENERAL"
): Transaction {
  return {
    id,
    date: "2026-08-01",
    merchant,
    amount: 100,
    status: "BOOKED",
    source: "card",
    type: "expense",
    categoryMain,
    categorySub,
  };
}

test("category overrides preserve exact, normalized, substring, and token-based merchant matching", () => {
  const overrides = {
    "Exact Merchant": "FOOD_&_DRINKS",
    "Acme Store Tel Aviv": "HOUSEHOLD_&_SERVICES",
    "Alpha Market Center North": "TRANSPORT",
  };
  const result = applyCategoryOverrides(
    [
      transaction("exact", "Exact Merchant"),
      transaction("normalized", "  exact   merchant  "),
      transaction("substring", "Acme Store"),
      transaction("tokens", "Alpha Market Center South"),
      transaction("single-token", "Alpha Bakery"),
    ],
    overrides
  );

  assert.deepEqual(
    result.map(({ id, categoryMain }) => ({ id, categoryMain })),
    [
      { id: "exact", categoryMain: "FOOD_&_DRINKS" },
      { id: "normalized", categoryMain: "FOOD_&_DRINKS" },
      { id: "substring", categoryMain: "HOUSEHOLD_&_SERVICES" },
      { id: "tokens", categoryMain: "TRANSPORT" },
      { id: "single-token", categoryMain: "SHOPPING" },
    ]
  );
});

test("brand matching retains the existing longest-candidate tie breaker", () => {
  const [result] = applyCategoryOverrides(
    [transaction("brand", "OpenAI unrelated description")],
    {
      "OpenAI short": "TRANSPORT",
      "OpenAI substantially longer merchant": "FOOD_&_DRINKS",
    }
  );

  assert.equal(result.categoryMain, "FOOD_&_DRINKS");
});

test("default merchant rules and recurring flags retain their existing output", () => {
  const [result] = applyCategoryOverrides([transaction("openai", "OpenAI")], {});

  assert.equal(result.categoryMain, customCategoryKey("מינויים"));
  assert.equal(result.categorySub, "USER_DEFINED");
  assert.equal(result.recurring, true);
});

test("an agreeing category rule preserves the provider subtype", () => {
  const mortgage = transaction(
    "mortgage",
    "פועלים-משכנתא",
    "LOAN_TRANSACTION",
    "MORTGAGE"
  );
  const [result] = applyCategoryOverrides(
    [mortgage],
    { "פועלים-משכנתא": "LOAN_TRANSACTION" }
  );

  assert.equal(result, mortgage);
  assert.equal(result.categoryMain, "LOAN_TRANSACTION");
  assert.equal(result.categorySub, "MORTGAGE");
});

test("category overrides are applied recursively to card debit details", () => {
  const detail = transaction("detail", "Detail Merchant");
  const aggregate: Transaction = {
    ...transaction("aggregate", "Card debit", "CREDIT_CARD", "CARD_PAYMENT"),
    source: "bank",
    detailTransactions: [detail],
  };

  const [result] = applyCategoryOverrides([aggregate], { "Detail Merchant": "TRANSPORT" });

  assert.equal(result.detailTransactions?.[0]?.categoryMain, "TRANSPORT");
  assert.equal(result.detailTransactions?.[0]?.categorySub, "USER_DEFINED");
});

test("unchanged categorized transactions retain their array and object references", () => {
  const detail = transaction("detail-stable", "Stable Detail", "SHOPPING", "USER_DEFINED");
  const aggregate: Transaction = {
    ...transaction("aggregate-stable", "Stable Aggregate", "SHOPPING", "USER_DEFINED"),
    detailTransactions: [detail],
  };
  const input = [aggregate];

  const result = applyCategoryOverrides(input, {});

  assert.equal(result, input);
  assert.equal(result[0], aggregate);
  assert.equal(result[0].detailTransactions, aggregate.detailTransactions);
  assert.equal(result[0].detailTransactions?.[0], detail);
});

test("changing one override only replaces transactions in the matching alias group", () => {
  const matching = transaction("matching", "Acme Store", "SHOPPING", "USER_DEFINED");
  const matchingAlias = transaction("matching-alias", "Acme Store Tel Aviv", "SHOPPING", "USER_DEFINED");
  const unrelated = transaction("unrelated", "Different Merchant", "SHOPPING", "USER_DEFINED");
  const input = [matching, matchingAlias, unrelated];

  const result = applyCategoryOverrides(input, { "Acme Store": "TRANSPORT" });

  assert.notEqual(result, input);
  assert.notEqual(result[0], matching);
  assert.notEqual(result[1], matchingAlias);
  assert.equal(result[2], unrelated);
  assert.equal(result[0].categoryMain, "TRANSPORT");
  assert.equal(result[1].categoryMain, "TRANSPORT");
});

test("custom and canonical category labels normalize without changing stored semantics", () => {
  assert.equal(normalizeCategoryKey("SHOPPING"), "SHOPPING");
  assert.equal(customCategoryKey("קטגוריה אישית"), "CUSTOM:קטגוריה אישית");
});
