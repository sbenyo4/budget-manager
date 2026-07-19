import { randomBytes } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../server/http.js";
import { readJson, sendJson } from "../server/http.js";
import { currentSessionToken, currentUser, tokenHash } from "../server/auth.js";
import {
  getPinAttemptState,
  getPinCredential,
  recordPinFailure,
  unlockSession,
  upsertPinCredential,
} from "../server/db.js";
import { hashPin, verifyPinHash } from "../server/pinSecurity.js";

const MAX_PIN_FAILURES = 5;
const PIN_LOCK_MS = 5 * 60 * 1000;

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
    const sessionToken = currentSessionToken(req);
    if (!sessionToken) {
      sendJson(res, 401, { error: "AUTH_REQUIRED" });
      return;
    }
    const sessionHash = tokenHash(sessionToken);

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
      await upsertPinCredential(user.id, salt, hashPin(pin, salt));
      await unlockSession(sessionHash, Date.now());
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST") {
      const body = await readJson<{ pin?: string }>(req);
      const pin = normalizePin(body.pin);
      const now = Date.now();
      const attemptState = await getPinAttemptState(sessionHash);
      if (attemptState?.lockedUntil && attemptState.lockedUntil > now) {
        const retryAfterSeconds = Math.max(1, Math.ceil((attemptState.lockedUntil - now) / 1000));
        res.setHeader("Retry-After", String(retryAfterSeconds));
        sendJson(res, 429, { error: "PIN_RATE_LIMITED", retryAfterSeconds });
        return;
      }
      const stored = await getPinCredential(user.id);
      const verification = stored && pin.length === 4
        ? verifyPinHash(pin, stored.salt, stored.pinHash)
        : { ok: false, needsUpgrade: false };
      if (!verification.ok) {
        await recordPinFailure(sessionHash, now, MAX_PIN_FAILURES, PIN_LOCK_MS);
        sendJson(res, 200, { ok: false });
        return;
      }
      if (verification.needsUpgrade && stored) {
        await upsertPinCredential(user.id, stored.salt, hashPin(pin, stored.salt));
      }
      await unlockSession(sessionHash, now);
      sendJson(res, 200, { ok: true });
      return;
    }

    res.statusCode = 405;
    res.setHeader("Allow", "GET, POST, PUT");
    res.end("Method Not Allowed");
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
