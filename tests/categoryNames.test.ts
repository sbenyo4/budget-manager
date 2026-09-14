import assert from "node:assert/strict";
import test from "node:test";
import { displaySubLabel } from "../src/logic/categoryNames.ts";

test("displayed subcategories never fall back to raw English taxonomy codes", () => {
  assert.equal(displaySubLabel("RESTAURANT"), "");
  assert.equal(displaySubLabel("USER_DEFINED"), "");
  assert.notEqual(displaySubLabel("MORTGAGE"), "MORTGAGE");
});
