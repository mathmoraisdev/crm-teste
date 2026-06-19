// Gera um passwordHash no MESMO formato do app (scrypt$<saltHex>$<hashHex>, KEYLEN=64).
// Uso:  node scripts/hash-password.mjs "minha-senha-forte"
// Depois: cole a saída na coluna passwordHash da sua linha na tabela User (Supabase).
import crypto from "node:crypto";

const KEYLEN = 64;
const password = process.argv[2];

if (!password) {
  console.error('Uso: node scripts/hash-password.mjs "sua-senha"');
  process.exit(1);
}
if (password.length < 8) {
  console.error("A senha precisa ter ao menos 8 caracteres.");
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const derived = crypto.scryptSync(password, salt, KEYLEN);
const hash = `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
console.log(hash);
