import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { neon } from "@neondatabase/serverless";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

const SQLITE_PATH = resolve(process.cwd(), ".data", "budget.sqlite");
const WRITE = process.argv.includes("--write");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function parsePreferences(data, userId) {
  try {
    const parsed = JSON.parse(data);
    return {
      sectionOverrides:
        parsed.sectionOverrides && typeof parsed.sectionOverrides === "object"
          ? parsed.sectionOverrides
          : {},
      oneTimeExpenses: Array.isArray(parsed.oneTimeExpenses) ? parsed.oneTimeExpenses : [],
      fixedExpenses: Array.isArray(parsed.fixedExpenses) ? parsed.fixedExpenses : [],
    };
  } catch (error) {
    throw new Error(`Invalid preferences JSON for user ${userId}: ${error.message}`);
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

if (!existsSync(SQLITE_PATH)) {
  console.error(`Local SQLite database was not found at ${SQLITE_PATH}`);
  process.exit(1);
}

const sqlite = new DatabaseSync(SQLITE_PATH, { readOnly: true });
const users = sqlite
  .prepare("SELECT id, email, name, picture FROM users ORDER BY email")
  .all();
const preferenceRows = sqlite
  .prepare("SELECT user_id, data FROM preferences ORDER BY user_id")
  .all();

const preferences = preferenceRows.map((row) => ({
  userId: row.user_id,
  data: parsePreferences(row.data, row.user_id),
}));

console.log(`Found ${users.length} local user(s) and ${preferences.length} preference row(s).`);

if (!WRITE) {
  console.log("Dry run only. Add --write to copy these rows to Neon.");
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is missing. Set it locally before running this script.");
  console.error("PowerShell example:");
  console.error("$env:DATABASE_URL='postgresql://...'; npm run migrate:preferences -- --write");
  process.exit(1);
}

const sql = neon(databaseUrl);

await Promise.all([
  sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      picture TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  sql`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  sql`
    CREATE TABLE IF NOT EXISTS preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
]);

for (const user of users) {
  await sql`
    INSERT INTO users (id, email, name, picture, updated_at)
    VALUES (${user.id}, ${user.email}, ${user.name ?? ""}, ${user.picture ?? ""}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      picture = EXCLUDED.picture,
      updated_at = NOW()
  `;
}

for (const preference of preferences) {
  await sql`
    INSERT INTO preferences (user_id, data, updated_at)
    VALUES (${preference.userId}, ${JSON.stringify(preference.data)}::jsonb, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      data = EXCLUDED.data,
      updated_at = NOW()
  `;
}

console.log("Migration complete. Sessions were not copied; sign in again on the deployed site.");
