import { Buffer } from "node:buffer";
import { createHash, createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import type { ApiRequest, ApiResponse } from "./http.js";
import { getUserBySession, getUserByUnlockedSession, type AuthUser } from "./db.js";
import { fetchWithTimeout } from "./fetchWithTimeout.js";

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

function base64UrlJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function currentUser(req: ApiRequest): Promise<AuthUser | null> {
  const token = currentSessionToken(req);
  if (!token) return null;
  return getUserBySession(tokenHash(token), Date.now());
}

export async function currentUnlockedUser(req: ApiRequest): Promise<AuthUser | null> {
  const token = currentSessionToken(req);
  if (!token) return null;
  return getUserByUnlockedSession(tokenHash(token), Date.now());
}

export function currentSessionToken(req: ApiRequest): string | undefined {
  const authorization = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1];
}

export async function verifyGoogleCredential(credential: string, clientId: string): Promise<GooglePayload> {
  const [encodedHeader, encodedPayload, encodedSignature] = credential.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error("Invalid Google credential");
  const header = base64UrlJson<{ kid?: string; alg?: string }>(encodedHeader);
  const payload = base64UrlJson<GooglePayload>(encodedPayload);
  if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported Google credential");

  const certsRes = await fetchWithTimeout("https://www.googleapis.com/oauth2/v3/certs");
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

export function methodNotAllowed(res: ApiResponse) {
  res.statusCode = 405;
  res.setHeader("Allow", "GET, POST, PUT");
  res.end("Method Not Allowed");
}
