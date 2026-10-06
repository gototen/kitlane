import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Lowercase, DNS-safe, no ambiguous characters. Used for entry, version, and collection IDs.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function newId(length = 12): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function newToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function verifySignature(secret: string, payload: string, signature: string): boolean {
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
