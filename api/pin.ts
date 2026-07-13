import { createHash, randomBytes } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../server/http.js";
import { readJson, sendJson } from "../server/http.js";
import { currentUser } from "../server/auth.js";
import { getPinCredential, upsertPinCredential } from "../server/db.js";

function pinHash(pin: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${pin}`).digest("hex");
}

function normalizePin(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "").slice(0, 4) : "";
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const user = await currentUser(req);
    if (!user) {
      sendJson(res, 401, { error: "AUTH_REQUIRED" });
      return;
    }

    if (req.method === "GET") {
      sendJson(res, 200, { hasPin: Boolean(await getPinCredential(user.id)) });
      return;
    }

    if (req.method === "PUT") {
      const body = await readJson<{ pin?: string }>(req);
      const pin = normalizePin(body.pin);
      if (pin.length !== 4) {
        sendJson(res, 400, { error: "PIN_MUST_BE_4_DIGITS" });
        return;
      }
      const salt = randomBytes(16).toString("hex");
      await upsertPinCredential(user.id, salt, pinHash(pin, salt));
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST") {
      const body = await readJson<{ pin?: string }>(req);
      const pin = normalizePin(body.pin);
      const stored = await getPinCredential(user.id);
      sendJson(res, 200, { ok: Boolean(stored && pin.length === 4 && pinHash(pin, stored.salt) === stored.pinHash) });
      return;
    }

    res.statusCode = 405;
    res.setHeader("Allow", "GET, POST, PUT");
    res.end("Method Not Allowed");
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
