import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import { createHash, createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

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
const PREFS_DEFAULT = {
  sectionOverrides: {},
  oneTimeExpenses: [],
  fixedExpenses: [],
  highAmountThreshold: 5000,
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
}

const EMPTY_SERVICE_SETTINGS: ServiceSettings = {
  openFinanceClientId: "",
  openFinanceClientSecret: "",
  openFinanceUserId: "",
  openFinanceApiPrefix: "api",
};

function normalizeServiceSettings(body: Partial<ServiceSettings>): ServiceSettings {
  return {
    openFinanceClientId: typeof body.openFinanceClientId === "string" ? body.openFinanceClientId.trim() : "",
    openFinanceClientSecret:
      typeof body.openFinanceClientSecret === "string" ? body.openFinanceClientSecret.trim() : "",
    openFinanceUserId: typeof body.openFinanceUserId === "string" ? body.openFinanceUserId.trim() : "",
    openFinanceApiPrefix: typeof body.openFinanceApiPrefix === "string" && body.openFinanceApiPrefix.trim()
      ? body.openFinanceApiPrefix.trim()
      : "api",
  };
}

function normalizeBudgetPreferences(body: Partial<typeof PREFS_DEFAULT>) {
  const threshold = Number(body.highAmountThreshold);
  return {
    sectionOverrides: body.sectionOverrides && typeof body.sectionOverrides === "object" ? body.sectionOverrides : {},
    oneTimeExpenses: Array.isArray(body.oneTimeExpenses) ? body.oneTimeExpenses : [],
    fixedExpenses: Array.isArray(body.fixedExpenses) ? body.fixedExpenses : [],
    highAmountThreshold: Number.isFinite(threshold) && threshold >= 0 ? threshold : PREFS_DEFAULT.highAmountThreshold,
    theme: body.theme === "dark" ? "dark" : "light",
  };
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
      if (req.method === "PUT") {
        readBody(req)
          .then((raw) => {
            const prefs = normalizeBudgetPreferences(JSON.parse(raw));
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
      if (req.method === "PUT") {
        readBody(req)
          .then((raw) => {
            const settings = normalizeServiceSettings(JSON.parse(raw));
            upsertServiceSettings.run(user.id, JSON.stringify(settings));
            sendJson(res, 200, settings);
          })
          .catch((err: unknown) => sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) }));
        return;
      }
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

  function rawAmount(raw: RawTransaction): number {
    return raw.amount?.chargedAmount?.amount ?? raw.amount?.originalAmount?.amount ?? 0;
  }

  function isCardInstallment(raw: RawTransaction): boolean {
    return Boolean(raw.isCreditCardInstallment || raw.installments);
  }

  function normalize(raw: RawTransaction, index: number, source: "bank" | "card") {
    const date =
      source === "card"
        ? isCardInstallment(raw)
          ? raw.date?.valueDate ?? raw.date?.transactionDate ?? raw.date?.bookingDate ?? ""
          : raw.date?.transactionDate ?? raw.date?.valueDate ?? raw.date?.bookingDate ?? ""
        : raw.date?.transactionDate ?? raw.date?.valueDate ?? raw.date?.bookingDate ?? "";

    return {
      id: raw.id ? `${source}:${raw.id}` : `${source}-tx-${index}`,
      source,
      // Use purchase date for regular card purchases. Installments use the
      // billing date so each monthly charge lands in the right month.
      date,
      merchant: raw.merchantName || raw.description?.description || "לא ידוע",
      amount: Math.abs(rawAmount(raw)),
      // outflows are negative in this API; positives are income/refunds
      type: rawAmount(raw) > 0 ? "income" : "expense",
      categoryMain: raw.category?.main ?? "OTHER",
      categorySub: raw.category?.sub ?? "UNCATEGORIZED",
    };
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
          const flows = [
            ...bank.map((raw, i) => normalize(raw, i, "bank")),
            ...card.map((raw, i) => normalize(raw, i, "card")),
          ].filter((tx) => tx.date && tx.date >= from && tx.date <= to && tx.amount > 0);
          sendJson(res, 200, flows);
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
