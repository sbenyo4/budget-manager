import assert from "node:assert/strict";
import test from "node:test";
import { futureDataEndIso } from "../src/logic/dateRange";

test("future data horizon spans year boundaries and includes the full ending month", () => {
  assert.equal(futureDataEndIso(new Date(2026, 7, 25)), "2028-02-29");
});

test("future data horizon handles a January leap-day endpoint", () => {
  assert.equal(futureDataEndIso(new Date(2023, 6, 1), 7), "2024-02-29");
});
