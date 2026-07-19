import { createHash, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_PREFIX = "scrypt$";

export function hashPin(pin: string, salt: string): string {
  return `${SCRYPT_PREFIX}${scryptSync(pin, salt, 32).toString("hex")}`;
}

export function verifyPinHash(pin: string, salt: string, storedHash: string): { ok: boolean; needsUpgrade: boolean } {
  const isScrypt = storedHash.startsWith(SCRYPT_PREFIX);
  const expected = isScrypt
    ? Buffer.from(storedHash.slice(SCRYPT_PREFIX.length), "hex")
    : Buffer.from(storedHash, "hex");
  const actual = isScrypt
    ? scryptSync(pin, salt, 32)
    : Buffer.from(createHash("sha256").update(`${salt}:${pin}`).digest("hex"), "hex");
  const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
  return { ok, needsUpgrade: ok && !isScrypt };
}
