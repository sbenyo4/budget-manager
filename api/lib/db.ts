import { neon } from "@neondatabase/serverless";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture: string;
}

export interface BudgetPreferences {
  sectionOverrides: Record<string, string>;
  oneTimeExpenses: string[];
  fixedExpenses: string[];
}

export const PREFS_DEFAULT: BudgetPreferences = {
  sectionOverrides: {},
  oneTimeExpenses: [],
  fixedExpenses: [],
};

let schemaReady: Promise<void> | null = null;

function sql() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  return neon(databaseUrl);
}

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    const db = sql();
    schemaReady = Promise.all([
      db`
        CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        picture TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      db`
        CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      db`
        CREATE TABLE IF NOT EXISTS preferences (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
    ]).then(() => undefined);
  }
  return schemaReady;
}

export async function getUserBySession(tokenHash: string, now: number): Promise<AuthUser | null> {
  await ensureSchema();
  const rows = (await sql()`
    SELECT users.id, users.email, users.name, users.picture
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ${tokenHash} AND sessions.expires_at > ${now}
    LIMIT 1
  `) as AuthUser[];
  return rows[0] ?? null;
}

export async function upsertUser(user: AuthUser): Promise<void> {
  await ensureSchema();
  await sql()`
    INSERT INTO users (id, email, name, picture, updated_at)
    VALUES (${user.id}, ${user.email}, ${user.name}, ${user.picture}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      picture = EXCLUDED.picture,
      updated_at = NOW()
  `;
}

export async function insertSession(tokenHash: string, userId: string, expiresAt: number): Promise<void> {
  await ensureSchema();
  await sql()`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${tokenHash}, ${userId}, ${expiresAt})
  `;
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await ensureSchema();
  await sql()`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
}

export async function getPreferences(userId: string): Promise<BudgetPreferences> {
  await ensureSchema();
  const rows = (await sql()`
    SELECT data
    FROM preferences
    WHERE user_id = ${userId}
    LIMIT 1
  `) as Array<{ data: BudgetPreferences }>;
  return rows[0]?.data ?? PREFS_DEFAULT;
}

export async function upsertPreferences(userId: string, prefs: BudgetPreferences): Promise<void> {
  await ensureSchema();
  await sql()`
    INSERT INTO preferences (user_id, data, updated_at)
    VALUES (${userId}, ${JSON.stringify(prefs)}::jsonb, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      data = EXCLUDED.data,
      updated_at = NOW()
  `;
}
