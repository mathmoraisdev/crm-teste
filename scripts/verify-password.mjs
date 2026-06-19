// Confere se uma senha bate com um passwordHash no formato do app.
// Uso:  node scripts/verify-password.mjs "minha-senha" "scrypt$<salt>$<hash>"
// Espelha exatamente o verifyPassword de src/lib/password.ts.
import crypto from "node:crypto";

const KEYLEN = 64;
const password = process.argv[2];
const stored = process.argv[3];

if (!password || !stored) {
  console.error('Uso: node scripts/verify-password.mjs "senha" "scrypt$<salt>$<hash>"');
  process.exit(1);
}

const [scheme, saltHex, hashHex] = stored.split("$");
if (scheme !== "scrypt" || !saltHex || !hashHex) {
  console.error('FORMATO INVÁLIDO: o hash precisa começar com "scrypt$" e ter salt e hash.');
  console.error("=> Provavelmente você colou a senha em texto puro, não o hash gerado.");
  process.exit(1);
}

const expected = Buffer.from(hashHex, "hex");
const derived = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), KEYLEN);
const ok = expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
console.log(ok ? "MATCH ✅ — essa senha bate com esse hash." : "NÃO BATE ❌ — senha errada ou hash de outra senha.");
