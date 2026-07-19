import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { hashPin, verifyPinHash } from "../server/pinSecurity.ts";

test("PIN hashes use scrypt and compare without plain-text storage", () => {
  const hash = hashPin("1234", "fixed-test-salt");
  assert.match(hash, /^scrypt\$/);
  assert.deepEqual(verifyPinHash("1234", "fixed-test-salt", hash), { ok: true, needsUpgrade: false });
  assert.deepEqual(verifyPinHash("9999", "fixed-test-salt", hash), { ok: false, needsUpgrade: false });
});

test("legacy SHA-256 PIN hashes remain valid and are marked for upgrade", () => {
  const legacy = createHash("sha256").update("fixed-test-salt:1234").digest("hex");
  assert.deepEqual(verifyPinHash("1234", "fixed-test-salt", legacy), { ok: true, needsUpgrade: true });
});
