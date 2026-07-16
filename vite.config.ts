import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import { createHash, createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { analyzeBudget, type AIAnalysisPayload, type AIAnalysisResult } from "./server/aiAnalysis";
import { listAIModels } from "./server/aiModels";

/**
 * Server-side proxy for the open-finance.ai API.
 *
 * The clientSecret must never reach the browser, so token exchange and data
 * fetching run inside the Vite dev/preview server process. The frontend only
 * talks to /api/status and /api/transactions.
 *
 * Docs: https://docs.open-finance.ai/
 */

const TOKEN_URL = "https://api.open-finance.ai/oauth/token";
const SESSION_COOKIE = "budget_session";
const AI_ANALYSIS_CACHE_VERSION = "ai-analysis-cache-v2";
const PREFS_DEFAULT = {
  sectionOverrides: {},
  oneTimeExpenses: [],
  fixedExpenses: [],
  highAmountThreshold: 5000,
  householdBirthDate: null as string | null,
  householdAge: null as number | null,
  householdSize: null as number | null,
  theme: "light" as "light" | "dark",
};
const require = createRequire(import.meta.url);

/**
 * Nothing is excluded here: bank transactions ARE the account state
 * (including the aggregate credit-card debits, securities and transfers),
 * and card transactions are the detail behind those debits plus future,
 * not-yet-debited charges. Each transaction is tagged with its source so
 * the frontend can separate account state from card breakdown.
 */

interface RawBalance {
  balanceType?: string;
  creditLimitIncluded?: boolean;
  balanceAmount?: { currency?: string; amount?: string | number };
  referenceDate?: string;
}

interface RawAccount {
  id?: string;
  providerId?: string;
  accountType?: string;
  accountName?: string;
  accountNumber?: string;
  product?: string;
  balances?: RawBalance[];
}

/** The freshest real balance, without the credit-limit padding. */
function pickBalance(balances: RawBalance[] = []): RawBalance | undefined {
  const preference = ["expected", "closingBooked", "interimAvailable", "forwardAvailable"];
  for (const type of preference) {
    const found = balances.find((b) => b.balanceType === type && b.creditLimitIncluded === false);
    if (found) return found;
  }
  return balances[0];
}

interface RawTransaction {
  id?: string;
  accountNumber?: string;
  providerId?: string;
  date?: { valueDate?: string; bookingDate?: string; transactionDate?: string };
  amount?: {
    originalAmount?: { amount?: number; currency?: string };
    chargedAmount?: { amount?: number; currency?: string };
  };
  description?: { description?: string; additionalInfo?: string };
  merchantName?: string;
  category?: { main?: string; sub?: string };
  status?: string;
  installments?: { number?: number; total?: number };
  isCreditCardInstallment?: boolean;
}

interface GooglePayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  aud?: string;
  iss?: string;
  exp?: number;
}

interface ServiceSettings {
  openFinanceClientId: string;
  openFinanceClientSecret: string;
  openFinanceUserId: string;
  openFinanceApiPrefix: string;
  aiProvider: "openai" | "anthropic" | "gemini";
  aiApiKey: string;
  aiModel: string;
}

const EMPTY_SERVICE_SETTINGS: ServiceSettings = {
  openFinanceClientId: "",
  openFinanceClientSecret: "",
  openFinanceUserId: "",
  openFinanceApiPrefix: "api",
  aiProvider: "openai",
  aiApiKey: "",
  aiModel: "gpt-4o-mini",
};

function normalizeServiceSettings(body: Partial<ServiceSettings>): ServiceSettings {
  const provider = body.aiProvider === "anthropic" || body.aiProvider === "gemini" ? body.aiProvider : "openai";
  return {
    openFinanceClientId: typeof body.openFinanceClientId === "string" ? body.openFinanceClientId.trim() : "",
    openFinanceClientSecret:
      typeof body.openFinanceClientSecret === "string" ? body.openFinanceClientSecret.trim() : "",
    openFinanceUserId: typeof body.openFinanceUserId === "string" ? body.openFinanceUserId.trim() : "",
    openFinanceApiPrefix: typeof body.openFinanceApiPrefix === "string" && body.openFinanceApiPrefix.trim()
      ? body.openFinanceApiPrefix.trim()
      : "api",
    aiProvider: provider,
    aiApiKey: typeof body.aiApiKey === "string" ? body.aiApiKey.trim() : "",
    aiModel:
      typeof body.aiModel === "string" && body.aiModel.trim()
        ? body.aiModel.trim()
        : provider === "anthropic"
          ? "claude-haiku-4-5"
          : provider === "gemini"
            ? "gemini-2.0-flash"
            : "gpt-4o-mini",
  };
}

function normalizeBudgetPreferences(body: Partial<typeof PREFS_DEFAULT>) {
  const threshold = Number(body.highAmountThreshold);
  const householdAge = Number(body.householdAge);
  const householdSize = Number(body.householdSize);
  const householdBirthDate =
    typeof body.householdBirthDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.householdBirthDate)
      ? body.householdBirthDate
      : null;
  return {
    sectionOverrides: body.sectionOverrides && typeof body.sectionOverrides === "object" ? body.sectionOverrides : {},
    oneTimeExpenses: Array.isArray(body.oneTimeExpenses) ? body.oneTimeExpenses : [],
    fixedExpenses: Array.isArray(body.fixedExpenses) ? body.fixedExpenses : [],
    highAmountThreshold: Number.isFinite(threshold) && threshold >= 0 ? threshold : PREFS_DEFAULT.highAmountThreshold,
    householdBirthDate,
    householdAge: Number.isFinite(householdAge) && householdAge > 0 ? householdAge : null,
    householdSize: Number.isFinite(householdSize) && householdSize > 0 ? householdSize : null,
    theme: body.theme === "dark" ? "dark" : "light",
  };
}

interface AIAnalysisRequest extends AIAnalysisPayload {
  forceRefresh?: boolean;
  cacheOnly?: boolean;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function aiAnalysisCacheKey(settings: ServiceSettings, payload: AIAnalysisPayload): string {
  return createHash("sha256")
    .update(
      stableStringify({
        version: AI_ANALYSIS_CACHE_VERSION,
        aiProvider: settings.aiProvider,
        aiModel: settings.aiModel,
        payload,
      })
    )
    .digest("hex");
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1
          ? [part, ""]
          : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function sessionCookie(value: string, maxAgeSeconds: number, secureCookie: boolean): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    secureCookie ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function base64UrlJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

async function verifyGoogleCredential(credential: string, clientId: string): Promise<GooglePayload> {
  const [encodedHeader, encodedPayload, encodedSignature] = credential.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error("Invalid Google credential");
  const header = base64UrlJson<{ kid?: string; alg?: string }>(encodedHeader);
  const payload = base64UrlJson<GooglePayload>(encodedPayload);
  if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported Google credential");

  const certsRes = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!certsRes.ok) throw new Error(`Google certs failed (${certsRes.status})`);
  const certs = (await certsRes.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
  const jwk = certs.keys?.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("Google signing key not found");

  const ok = verifySignature(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(encodedSignature, "base64url")
  );
  if (!ok) throw new Error("Invalid Google signature");
  if (payload.aud !== clientId) throw new Error("Google audience mismatch");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(payload.iss ?? "")) {
    throw new Error("Invalid Google issuer");
  }
  if (!payload.exp || payload.exp * 1000 < Date.now()) throw new Error("Google credential expired");
  if (!payload.sub || !payload.email || payload.email_verified !== true) {
    throw new Error("Google email is not verified");
  }
  return payload;
}

function preferencesAuth(env: Record<string, string>): Plugin {
  const googleClientId = env.GOOGLE_CLIENT_ID ?? "";
  const secureCookie = env.NODE_ENV === "production" || env.SECURE_COOKIES === "true";
  const dbPath = env.BUDGET_DB_PATH || join(process.cwd(), ".data", "budget.sqlite");
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      picture TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS service_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS user_pins (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      salt TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ai_analysis_cache (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cache_key TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, cache_key)
    );
  `);

  const getUserBySession = db.prepare(`
    SELECT users.id, users.email, users.name, users.picture
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `);
  const upsertUser = db.prepare(`
    INSERT INTO users (id, email, name, picture, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      name = excluded.name,
      picture = excluded.picture,
      updated_at = CURRENT_TIMESTAMP
  `);
  const insertSession = db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)");
  const deleteSession = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
  const getPrefs = db.prepare("SELECT data FROM preferences WHERE user_id = ?");
  const upsertPrefs = db.prepare(`
    INSERT INTO preferences (user_id, data, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP
  `);
  const getServiceSettings = db.prepare("SELECT data FROM service_settings WHERE user_id = ?");
  const upsertServiceSettings = db.prepare(`
    INSERT INTO service_settings (user_id, data, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP
  `);
  const getPinCredential = db.prepare("SELECT salt, pin_hash AS pinHash FROM user_pins WHERE user_id = ?");
  const upsertPinCredential = db.prepare(`
    INSERT INTO user_pins (user_id, salt, pin_hash, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      salt = excluded.salt,
      pin_hash = excluded.pin_hash,
      updated_at = CURRENT_TIMESTAMP
  `);
  const getAIAnalysisCache = db.prepare("SELECT data, updated_at AS updatedAt FROM ai_analysis_cache WHERE user_id = ? AND cache_key = ?");
  const upsertAIAnalysisCache = db.prepare(`
    INSERT INTO ai_analysis_cache (user_id, cache_key, data, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, cache_key) DO UPDATE SET
      data = excluded.data,
      updated_at = CURRENT_TIMESTAMP
    RETURNING updated_at AS updatedAt
  `);

  function pinHash(pin: string, salt: string): string {
    return createHash("sha256").update(`${salt}:${pin}`).digest("hex");
  }

  function normalizePin(value: unknown): string {
    return typeof value === "string" ? value.replace(/\D/g, "").slice(0, 4) : "";
  }

  function currentUser(req: IncomingMessage) {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (!token) return null;
    return getUserBySession.get(tokenHash(token), Date.now()) as
      | { id: string; email: string; name: string; picture: string }
      | undefined
      | null;
  }

  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/api/auth/config") {
      sendJson(res, 200, { googleClientId });
      return;
    }

    if (url.pathname === "/api/auth/me") {
      sendJson(res, 200, { user: currentUser(req) });
      return;
    }

    if (url.pathname === "/api/auth/google" && req.method === "POST") {
      if (!googleClientId) {
        sendJson(res, 500, { error: "GOOGLE_CLIENT_ID is not configured" });
        return;
      }
      readBody(req)
        .then((raw) => verifyGoogleCredential(JSON.parse(raw).credential, googleClientId))
        .then((payload) => {
          const user = {
            id: payload.sub,
            email: payload.email ?? "",
            name: payload.name ?? "",
            picture: payload.picture ?? "",
          };
          upsertUser.run(user.id, user.email, user.name, user.picture);
          const token = randomBytes(32).toString("base64url");
          const maxAge = 60 * 60 * 24 * 30;
          insertSession.run(tokenHash(token), user.id, Date.now() + maxAge * 1000);
          res.setHeader("Set-Cookie", sessionCookie(token, maxAge, secureCookie));
          sendJson(res, 200, { user });
        })
        .catch((err: unknown) => sendJson(res, 401, { error: err instanceof Error ? err.message : String(err) }));
      return;
    }

    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      const token = parseCookies(req)[SESSION_COOKIE];
      if (token) deleteSession.run(tokenHash(token));
      res.setHeader("Set-Cookie", sessionCookie("", 0, secureCookie));
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/preferences") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "AUTH_REQUIRED" });
        return;
      }
      if (req.method === "GET") {
        const row = getPrefs.get(user.id) as { data: string } | undefined;
        sendJson(res, 200, row ? normalizeBudgetPreferences(JSON.parse(row.data)) : PREFS_DEFAULT);
        return;
      }
      if (req.method === "PUT" || req.method === "PATCH") {
        readBody(req)
          .then((raw) => {
            const row = getPrefs.get(user.id) as { data: string } | undefined;
            const base = req.method === "PATCH" && row ? normalizeBudgetPreferences(JSON.parse(row.data)) : PREFS_DEFAULT;
            const prefs = normalizeBudgetPreferences({ ...base, ...JSON.parse(raw) });
            upsertPrefs.run(user.id, JSON.stringify(prefs));
            sendJson(res, 200, prefs);
          })
          .catch((err: unknown) => sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) }));
        return;
      }
    }

    if (url.pathname === "/api/service-settings") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "AUTH_REQUIRED" });
        return;
      }
      if (req.method === "GET") {
        const row = getServiceSettings.get(user.id) as { data: string } | undefined;
        sendJson(res, 200, row ? normalizeServiceSettings(JSON.parse(row.data)) : EMPTY_SERVICE_SETTINGS);
        return;
      }
      if (req.method === "PUT" || req.method === "PATCH") {
        readBody(req)
          .then((raw) => {
            const row = getServiceSettings.get(user.id) as { data: string } | undefined;
            const base = req.method === "PATCH" && row ? normalizeServiceSettings(JSON.parse(row.data)) : EMPTY_SERVICE_SETTINGS;
            const settings = normalizeServiceSettings({ ...base, ...JSON.parse(raw) });
            upsertServiceSettings.run(user.id, JSON.stringify(settings));
            sendJson(res, 200, settings);
          })
          .catch((err: unknown) => sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) }));
        return;
      }
    }

    if (url.pathname === "/api/ai-analysis" && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "AUTH_REQUIRED" });
        return;
      }
      const row = getServiceSettings.get(user.id) as { data: string } | undefined;
      const settings = row ? normalizeServiceSettings(JSON.parse(row.data)) : EMPTY_SERVICE_SETTINGS;
      readBody(req)
        .then(async (raw) => {
          const body = JSON.parse(raw) as AIAnalysisRequest;
          const { forceRefresh, cacheOnly, ...payload } = body;
          const cacheKey = aiAnalysisCacheKey(settings, payload);

          if (!forceRefresh) {
            const cached = getAIAnalysisCache.get(user.id, cacheKey) as { data: string; updatedAt: string } | undefined;
            if (cached) {
              return {
                result: JSON.parse(cached.data) as AIAnalysisResult,
                cached: true,
                updatedAt: cached.updatedAt,
              };
            }
          }

          if (cacheOnly) {
            return {
              result: null,
              cached: false,
              updatedAt: null,
            };
          }

          const result = await analyzeBudget(settings, payload);
          const saved = upsertAIAnalysisCache.get(user.id, cacheKey, JSON.stringify(result)) as { updatedAt: string } | undefined;
          return {
            result,
            cached: false,
            updatedAt: saved?.updatedAt ?? new Date().toISOString(),
          };
        })
        .then((analysis) => sendJson(res, 200, analysis))
        .catch((err: unknown) => sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) }));
      return;
    }

    if (url.pathname === "/api/ai-models" && req.method === "POST") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "AUTH_REQUIRED" });
        return;
      }
      const row = getServiceSettings.get(user.id) as { data: string } | undefined;
      const saved = row ? normalizeServiceSettings(JSON.parse(row.data)) : EMPTY_SERVICE_SETTINGS;
      readBody(req)
        .then((raw) => {
          const body = JSON.parse(raw) as Partial<Pick<ServiceSettings, "aiProvider" | "aiApiKey">>;
          const provider = body.aiProvider === "anthropic" || body.aiProvider === "gemini" ? body.aiProvider : "openai";
          const apiKey = typeof body.aiApiKey === "string" && body.aiApiKey.trim() ? body.aiApiKey.trim() : saved.aiApiKey;
          return listAIModels(provider, apiKey);
        })
        .then((models) => sendJson(res, 200, { models }))
        .catch((err: unknown) => sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) }));
      return;
    }

    if (url.pathname === "/api/pin") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "AUTH_REQUIRED" });
        return;
      }
      if (req.method === "GET") {
        sendJson(res, 200, { hasPin: Boolean(getPinCredential.get(user.id)) });
        return;
      }
      if (req.method === "PUT") {
        readBody(req)
          .then((raw) => {
            const pin = normalizePin(JSON.parse(raw).pin);
            if (pin.length !== 4) {
              sendJson(res, 400, { error: "PIN_MUST_BE_4_DIGITS" });
              return;
            }
            const salt = randomBytes(16).toString("hex");
            upsertPinCredential.run(user.id, salt, pinHash(pin, salt));
            sendJson(res, 200, { ok: true });
          })
          .catch((err: unknown) => sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) }));
        return;
      }
      if (req.method === "POST") {
        readBody(req)
          .then((raw) => {
            const pin = normalizePin(JSON.parse(raw).pin);
            const stored = getPinCredential.get(user.id) as { salt: string; pinHash: string } | undefined;
            sendJson(res, 200, { ok: Boolean(stored && pin.length === 4 && pinHash(pin, stored.salt) === stored.pinHash) });
          })
          .catch((err: unknown) => sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) }));
        return;
      }
    }

    next();
  };

  return {
    name: "preferences-auth",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

function openFinanceProxy(env: Record<string, string>): Plugin {
  const dbPath = env.BUDGET_DB_PATH || join(process.cwd(), ".data", "budget.sqlite");
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS service_settings (
      user_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const getUserBySession = db.prepare(`
    SELECT users.id, users.email, users.name, users.picture
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `);
  const getServiceSettings = db.prepare("SELECT data FROM service_settings WHERE user_id = ?");

  const tokens = new Map<string, { value: string; expiresAt: number }>();

  function currentUser(req: IncomingMessage) {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (!token) return null;
    return getUserBySession.get(tokenHash(token), Date.now()) as
      | { id: string; email: string; name: string; picture: string }
      | undefined
      | null;
  }

  function settingsForUser(userId: string): ServiceSettings {
    const row = getServiceSettings.get(userId) as { data: string } | undefined;
    return row ? normalizeServiceSettings(JSON.parse(row.data)) : EMPTY_SERVICE_SETTINGS;
  }

  function isConfigured(settings: ServiceSettings): boolean {
    return Boolean(settings.openFinanceClientId && settings.openFinanceClientSecret && settings.openFinanceUserId);
  }

  async function getToken(ownerId: string, settings: ServiceSettings): Promise<string> {
    const token = tokens.get(ownerId);
    if (token && Date.now() < token.expiresAt - 60_000) return token.value;
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: settings.openFinanceUserId,
        clientId: settings.openFinanceClientId,
        clientSecret: settings.openFinanceClientSecret,
      }),
    });
    if (!res.ok) {
      throw new Error(`Token request failed (${res.status}): ${await res.text()}`);
    }
    const body = (await res.json()) as { accessToken: string; expiresIn?: number };
    // expiresIn is in milliseconds per the docs' example (3600000)
    tokens.set(ownerId, { value: body.accessToken, expiresAt: Date.now() + (body.expiresIn ?? 3_600_000) });
    return body.accessToken;
  }

  async function fetchTransactions(
    ownerId: string,
    settings: ServiceSettings,
    from: string,
    to: string,
    providerType: "BANK" | "CARD"
  ): Promise<RawTransaction[]> {
    const accessToken = await getToken(ownerId, settings);
    const items: RawTransaction[] = [];
    let nextPage: string | undefined;
    do {
      const url = new URL(`https://${settings.openFinanceApiPrefix}.open-finance.ai/v2/data/transactions`);
      url.searchParams.set("dateFrom", from);
      url.searchParams.set("dateTo", to);
      url.searchParams.set("sort", "1");
      url.searchParams.set("type", providerType);
      if (nextPage) url.searchParams.set("nextPage", nextPage);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) {
        throw new Error(`Transactions request failed (${res.status}): ${await res.text()}`);
      }
      const body = (await res.json()) as { nextPage?: string | null; items?: RawTransaction[] };
      items.push(...(body.items ?? []));
      nextPage = body.nextPage ?? undefined;
    } while (nextPage);
    return items;
  }

  function finiteAmount(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  function rawAmount(raw: RawTransaction): number {
    const charged = finiteAmount(raw.amount?.chargedAmount?.amount);
    if (charged !== undefined) return charged;

    const original = finiteAmount(raw.amount?.originalAmount?.amount);
    const installmentTotal = raw.installments?.total;
    if (original !== undefined && installmentTotal && installmentTotal > 1) {
      return original / installmentTotal;
    }
    return original ?? 0;
  }

  function rawOriginalAmount(raw: RawTransaction): number | undefined {
    return finiteAmount(raw.amount?.originalAmount?.amount);
  }

  function isCardInstallment(raw: RawTransaction): boolean {
    return Boolean(raw.isCreditCardInstallment || raw.installments);
  }

  function normalizeDate(value: string): string {
    return value.slice(0, 10);
  }

  function parseAdditionalInfo(raw: RawTransaction): Record<string, unknown> | null {
    const info = raw.description?.additionalInfo;
    if (!info) return null;
    try {
      const parsed = JSON.parse(info) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }

  function cardDebitDuplicateKey(raw: RawTransaction, source: "bank" | "card", date: string, amount: number): string | undefined {
    if (
      source !== "bank" ||
      raw.category?.main !== "INCOMES_EXPENSES" ||
      raw.category?.sub !== "CREDIT_CARD_CHECKING"
    ) {
      return undefined;
    }
    const info = parseAdditionalInfo(raw);
    const accountNo = typeof info?.accountNo === "string" ? info.accountNo : raw.accountNumber ?? "";
    const description =
      typeof info?.transactionDescription === "string"
        ? info.transactionDescription
        : raw.merchantName || raw.description?.description || "";
    if (!accountNo || !description) return undefined;
    return [
      "bank-card-debit",
      raw.providerId ?? "",
      date,
      Math.abs(amount).toFixed(2),
      accountNo,
      description,
    ].join(":");
  }

  function cardLast4(raw: RawTransaction, source: "bank" | "card"): string | undefined {
    if (source === "card") {
      const digits = raw.accountNumber?.replace(/\D/g, "") ?? "";
      return digits.length >= 4 ? digits.slice(-4) : undefined;
    }

    const isBankCardDebit =
      raw.category?.main === "INCOMES_EXPENSES" && raw.category?.sub === "CREDIT_CARD_CHECKING";
    if (!isBankCardDebit) return undefined;

    const info = raw.description?.additionalInfo ?? "";
    const idMatch = info.match(/מזהה\s*(\d{4,})/);
    return idMatch ? idMatch[1].slice(-4) : undefined;
  }

  function normalize(raw: RawTransaction, index: number, source: "bank" | "card") {
    const rawDate =
      source === "card"
        ? raw.date?.transactionDate ?? raw.date?.bookingDate ?? raw.date?.valueDate ?? ""
        : raw.date?.transactionDate ?? raw.date?.valueDate ?? raw.date?.bookingDate ?? "";
    const date = normalizeDate(rawDate);
    const billingDate = source === "card" && raw.date?.valueDate ? normalizeDate(raw.date.valueDate) : undefined;
    const amount = rawAmount(raw);
    const originalAmount = rawOriginalAmount(raw);
    const last4 = cardLast4(raw, source);
    const installment = isCardInstallment(raw)
      ? { number: raw.installments?.number, total: raw.installments?.total }
      : undefined;

    return {
      id: raw.id ? `${source}:${raw.id}` : `${source}-tx-${index}`,
      duplicateKey: cardDebitDuplicateKey(raw, source, date, amount) ?? (raw.id ? `${source}:${raw.id}` : undefined),
      source,
      date,
      ...(billingDate ? { billingDate } : {}),
      ...(last4 ? { cardLast4: last4 } : {}),
      ...(raw.providerId ? { cardProvider: raw.providerId } : {}),
      merchant: raw.merchantName || raw.description?.description || "לא ידוע",
      amount: Math.abs(amount),
      ...(originalAmount !== undefined && Math.abs(originalAmount) !== Math.abs(amount)
        ? { originalAmount: Math.abs(originalAmount) }
        : {}),
      ...(installment ? { installment } : {}),
      // outflows are negative in this API; positives are income/refunds
      type: amount > 0 ? "income" : "expense",
      categoryMain: raw.category?.main ?? "OTHER",
      categorySub: raw.category?.sub ?? "UNCATEGORIZED",
    };
  }

  type DevTransaction = ReturnType<typeof normalize> & { detailTransactions?: DevPublicTransaction[] };
  type DevPublicTransaction = Omit<DevTransaction, "detailTransactions" | "duplicateKey">;

  function dedupeTransactions(transactions: DevTransaction[]): DevPublicTransaction[] {
    const seen = new Set<string>();
    const unique: DevPublicTransaction[] = [];
    for (const tx of transactions) {
      if (tx.duplicateKey) {
        if (seen.has(tx.duplicateKey)) continue;
        seen.add(tx.duplicateKey);
      }
      const { duplicateKey: _duplicateKey, ...publicTx } = tx;
      unique.push(publicTx);
    }
    return unique;
  }

  function isCardDebit(tx: DevTransaction): boolean {
    return tx.source === "bank" && tx.categoryMain === "INCOMES_EXPENSES" && tx.categorySub === "CREDIT_CARD_CHECKING";
  }

  function amountCents(value: number): number {
    return Math.round(value * 100);
  }

  function assignDebitDetailsForDate(
    debits: DevTransaction[],
    groups: Array<{ totalCents: number; details: DevPublicTransaction[] }>
  ): Map<string, DevPublicTransaction[]> {
    const assignments = new Map<string, DevPublicTransaction[]>();
    const usedGroupIndexes = new Set<number>();

    for (const tx of debits) {
      if (!tx.cardLast4) continue;
      const groupIndex = groups.findIndex(
        (group, index) => !usedGroupIndexes.has(index) && group.details.some((detail) => detail.cardLast4 === tx.cardLast4)
      );
      if (groupIndex >= 0) {
        usedGroupIndexes.add(groupIndex);
        assignments.set(tx.id, groups[groupIndex].details);
      }
    }

    for (const tx of debits) {
      if (assignments.has(tx.id)) continue;
      const txAmountCents = amountCents(tx.amount);
      const groupIndex = groups.findIndex(
        (group, index) =>
          !usedGroupIndexes.has(index) &&
          group.totalCents === txAmountCents &&
          (!tx.cardLast4 || group.details.some((detail) => detail.cardLast4 === tx.cardLast4))
      );
      if (groupIndex >= 0) {
        usedGroupIndexes.add(groupIndex);
        assignments.set(tx.id, groups[groupIndex].details);
      }
    }

    const unmatchedDebits = debits.filter((tx) => !assignments.has(tx.id));
    const unusedGroups = groups
      .map((group, index) => ({ ...group, index }))
      .filter((group) => !usedGroupIndexes.has(group.index));

    if (unmatchedDebits.length === 1 && unusedGroups.length > 1) {
      const totalCents = unusedGroups.reduce((total, group) => total + group.totalCents, 0);
      if (Math.abs(totalCents - amountCents(unmatchedDebits[0].amount)) <= 1) {
        assignments.set(unmatchedDebits[0].id, unusedGroups.flatMap((group) => group.details));
        return assignments;
      }
    }

    if (unmatchedDebits.length === unusedGroups.length) {
      for (const tx of unmatchedDebits) {
        const txAmountCents = amountCents(tx.amount);
        const best = unusedGroups
          .filter((group) => !usedGroupIndexes.has(group.index))
          .map((group) => ({ ...group, delta: Math.abs(group.totalCents - txAmountCents) }))
          .sort((a, b) => a.delta - b.delta)[0];
        if (best && best.delta <= 1) {
          usedGroupIndexes.add(best.index);
          assignments.set(tx.id, best.details);
        }
      }
    }

    return assignments;
  }

  function attachCardDebitDetails(transactions: DevTransaction[]): DevTransaction[] {
    const cardGroupsByBillingDate = new Map<string, Array<{ totalCents: number; details: DevPublicTransaction[] }>>();
    const debitDetailsById = new Map<string, DevPublicTransaction[]>();

    for (const tx of transactions) {
      if (tx.source !== "card" || !tx.billingDate) continue;
      const groups = cardGroupsByBillingDate.get(tx.billingDate) ?? [];
      const key = `${tx.cardProvider ?? ""}:${tx.cardLast4 ?? ""}`;
      const { detailTransactions: _detailTransactions, ...publicTx } = tx;
      const existing = groups.find((group) => group.details[0] && `${group.details[0].cardProvider ?? ""}:${group.details[0].cardLast4 ?? ""}` === key);
      if (existing) {
        existing.totalCents += amountCents(tx.amount);
        existing.details.push(publicTx);
      } else {
        groups.push({ totalCents: amountCents(tx.amount), details: [publicTx] });
      }
      cardGroupsByBillingDate.set(tx.billingDate, groups);
    }

    const debitsByDate = new Map<string, DevTransaction[]>();
    for (const tx of transactions) {
      if (!isCardDebit(tx)) continue;
      const debits = debitsByDate.get(tx.date) ?? [];
      debits.push(tx);
      debitsByDate.set(tx.date, debits);
    }

  for (const [date, debits] of debitsByDate) {
      const assignments = assignDebitDetailsForDate(debits, cardGroupsByBillingDate.get(date) ?? []);
      for (const [id, details] of assignments) {
        debitDetailsById.set(id, details);
      }
    }

    return transactions.map((tx) => {
      if (!isCardDebit(tx)) return tx;
      const details = debitDetailsById.get(tx.id);
      if (!details?.length) return tx;
      return {
        ...tx,
        detailTransactions: [...details].sort((a, b) => b.date.localeCompare(a.date)),
      };
    });
  }

  async function fetchAccounts(ownerId: string, settings: ServiceSettings): Promise<RawAccount[]> {
    const accessToken = await getToken(ownerId, settings);
    const items: RawAccount[] = [];
    let nextPage: string | undefined;
    do {
      const url = new URL(`https://${settings.openFinanceApiPrefix}.open-finance.ai/v2/data/accounts`);
      if (nextPage) url.searchParams.set("nextPage", nextPage);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) {
        throw new Error(`Accounts request failed (${res.status}): ${await res.text()}`);
      }
      const body = (await res.json()) as { nextPage?: string | null; items?: RawAccount[] };
      items.push(...(body.items ?? []));
      nextPage = body.nextPage ?? undefined;
    } while (nextPage);
    return items;
  }

  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/api/status") {
      const user = currentUser(req);
      if (!user) {
        sendJson(res, 200, { configured: false });
        return;
      }
      sendJson(res, 200, { configured: isConfigured(settingsForUser(user.id)) });
      return;
    }

    if (url.pathname === "/api/accounts") {
      const user = currentUser(req);
      const settings = user ? settingsForUser(user.id) : EMPTY_SERVICE_SETTINGS;
      if (!user || !isConfigured(settings)) {
        sendJson(res, 503, { error: "NOT_CONFIGURED" });
        return;
      }
      fetchAccounts(user.id, settings)
        .then((items) => {
          const accounts = items.map((raw, i) => {
            const balance = pickBalance(raw.balances);
            return {
              id: raw.id ?? `acc-${i}`,
              providerId: raw.providerId ?? "",
              accountType: raw.accountType ?? "",
              accountName: raw.product ?? raw.accountName ?? raw.accountNumber ?? "",
              currency: balance?.balanceAmount?.currency ?? "ILS",
              balance: Number(balance?.balanceAmount?.amount ?? 0),
              balanceDate: balance?.referenceDate ?? "",
            };
          });
          sendJson(res, 200, accounts);
        })
        .catch((err: unknown) => {
          sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
        });
      return;
    }

    if (url.pathname === "/api/transactions") {
      const user = currentUser(req);
      const settings = user ? settingsForUser(user.id) : EMPTY_SERVICE_SETTINGS;
      if (!user || !isConfigured(settings)) {
        sendJson(res, 503, { error: "NOT_CONFIGURED" });
        return;
      }
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        sendJson(res, 400, { error: "from/to must be YYYY-MM-DD" });
        return;
      }
      Promise.all([
        fetchTransactions(user.id, settings, from, to, "BANK"),
        fetchTransactions(user.id, settings, from, to, "CARD"),
      ])
        .then(([bank, card]) => {
          const flows = attachCardDebitDetails([
            ...bank.map((raw, i) => normalize(raw, i, "bank")),
            ...card.map((raw, i) => normalize(raw, i, "card")),
          ]).filter((tx) => tx.date && tx.date >= from && tx.date <= to && tx.amount > 0);
          sendJson(res, 200, dedupeTransactions(flows));
        })
        .catch((err: unknown) => {
          sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
        });
      return;
    }

    next();
  };

  return {
    name: "open-finance-proxy",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devPlugins = command === "serve" ? [preferencesAuth(env), openFinanceProxy(env)] : [];
  return {
    plugins: [react(), ...devPlugins],
    server: {
      host: "localhost",
      port: 5175,
      strictPort: true,
    },
  };
});
