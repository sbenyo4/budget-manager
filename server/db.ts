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
  highAmountThreshold: number;
  householdBirthDate: string | null;
  householdAge: number | null;
  householdSize: number | null;
  theme: "light" | "dark";
}

export interface ServiceSettings {
  openFinanceClientId: string;
  openFinanceClientSecret: string;
  openFinanceUserId: string;
  openFinanceApiPrefix: string;
  aiProvider: "openai" | "anthropic" | "gemini";
  aiApiKey: string;
  aiModel: string;
}

export interface AIAnalysisCacheRecord<T = unknown> {
  data: T;
  updatedAt: string;
}

export const PREFS_DEFAULT: BudgetPreferences = {
  sectionOverrides: {},
  oneTimeExpenses: [],
  fixedExpenses: [],
  highAmountThreshold: 5000,
  householdBirthDate: null,
  householdAge: null,
  householdSize: null,
  theme: "light",
};

export const SERVICE_SETTINGS_DEFAULT: ServiceSettings = {
  openFinanceClientId: "",
  openFinanceClientSecret: "",
  openFinanceUserId: "",
  openFinanceApiPrefix: "api",
  aiProvider: "openai",
  aiApiKey: "",
  aiModel: "gpt-4o-mini",
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
      db`
        CREATE TABLE IF NOT EXISTS service_settings (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      db`
        CREATE TABLE IF NOT EXISTS user_pins (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        salt TEXT NOT NULL,
        pin_hash TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      `,
      db`
        CREATE TABLE IF NOT EXISTS ai_analysis_cache (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        cache_key TEXT NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, cache_key)
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
  return { ...PREFS_DEFAULT, ...(rows[0]?.data ?? {}) };
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

export async function getServiceSettings(userId: string): Promise<ServiceSettings> {
  await ensureSchema();
  const rows = (await sql()`
    SELECT data
    FROM service_settings
    WHERE user_id = ${userId}
    LIMIT 1
  `) as Array<{ data: ServiceSettings }>;
  return { ...SERVICE_SETTINGS_DEFAULT, ...(rows[0]?.data ?? {}) };
}

export async function upsertServiceSettings(userId: string, settings: ServiceSettings): Promise<void> {
  await ensureSchema();
  await sql()`
    INSERT INTO service_settings (user_id, data, updated_at)
    VALUES (${userId}, ${JSON.stringify(settings)}::jsonb, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      data = EXCLUDED.data,
      updated_at = NOW()
  `;
}

export async function getAIAnalysisCache<T = unknown>(
  userId: string,
  cacheKey: string
): Promise<AIAnalysisCacheRecord<T> | null> {
  await ensureSchema();
  const rows = (await sql()`
    SELECT data, updated_at AS "updatedAt"
    FROM ai_analysis_cache
    WHERE user_id = ${userId} AND cache_key = ${cacheKey}
    LIMIT 1
  `) as Array<{ data: T; updatedAt: Date | string }>;
  const row = rows[0];
  if (!row) return null;
  return {
    data: row.data,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

export async function upsertAIAnalysisCache<T = unknown>(
  userId: string,
  cacheKey: string,
  data: T
): Promise<string> {
  await ensureSchema();
  const rows = (await sql()`
    INSERT INTO ai_analysis_cache (user_id, cache_key, data, updated_at)
    VALUES (${userId}, ${cacheKey}, ${JSON.stringify(data)}::jsonb, NOW())
    ON CONFLICT (user_id, cache_key) DO UPDATE SET
      data = EXCLUDED.data,
      updated_at = NOW()
    RETURNING updated_at AS "updatedAt"
  `) as Array<{ updatedAt: Date | string }>;
  const updatedAt = rows[0]?.updatedAt;
  return updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt ?? new Date().toISOString());
}

export async function getPinCredential(userId: string): Promise<{ salt: string; pinHash: string } | null> {
  await ensureSchema();
  const rows = (await sql()`
    SELECT salt, pin_hash AS "pinHash"
    FROM user_pins
    WHERE user_id = ${userId}
    LIMIT 1
  `) as Array<{ salt: string; pinHash: string }>;
  return rows[0] ?? null;
}

export async function upsertPinCredential(userId: string, salt: string, pinHash: string): Promise<void> {
  await ensureSchema();
  await sql()`
    INSERT INTO user_pins (user_id, salt, pin_hash, updated_at)
    VALUES (${userId}, ${salt}, ${pinHash}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      salt = EXCLUDED.salt,
      pin_hash = EXCLUDED.pin_hash,
      updated_at = NOW()
  `;
}
