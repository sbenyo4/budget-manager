import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const databaseSource = readFileSync(new URL("../server/db.ts", import.meta.url), "utf8");

test("a cold database client checks schema metadata before running DDL", () => {
  const probeIndex = databaseSource.indexOf("to_regclass('public.users')");
  const earlyReturnIndex = databaseSource.indexOf("if (schemaState[0]?.ready) return;");
  const ddlIndex = databaseSource.indexOf("CREATE TABLE IF NOT EXISTS users");

  assert.ok(probeIndex >= 0);
  assert.ok(earlyReturnIndex > probeIndex);
  assert.ok(ddlIndex > earlyReturnIndex);
});

test("the schema probe covers every runtime table, migrated PIN column, and index", () => {
  for (const relation of [
    "users",
    "sessions",
    "preferences",
    "service_settings",
    "user_pins",
    "ai_analysis_cache",
    "api_rate_limits",
    "merchant_lookup_cache",
    "sessions_expires_at_idx",
    "ai_analysis_cache_user_updated_idx",
  ]) {
    assert.match(databaseSource, new RegExp(`to_regclass\\('public\\.${relation}'\\)`));
  }
  for (const column of ["pin_unlocked_at", "pin_failures", "pin_locked_until"]) {
    assert.match(databaseSource, new RegExp(`column_name = '${column}'`));
  }
});
