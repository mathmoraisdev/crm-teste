import crypto from "node:crypto";

/**
 * Hash de senha com scrypt (node:crypto) — sem dependências externas.
 * Formato armazenado: `scrypt$<saltHex>$<hashHex>`.
 *
 * Roda apenas em rotas Node (register/login), nunca no middleware (Edge).
 */
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const derived = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), KEYLEN);
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}
