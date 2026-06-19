import crypto from "node:crypto";

/**
 * Tokens one-time (confirmação de e-mail, reset de senha).
 *
 * Princípio: o token "claro" vai para o link enviado por e-mail; no banco
 * guardamos apenas o **hash** (sha-256). Assim um vazamento da tabela não
 * expõe tokens utilizáveis. Roda apenas em rotas Node (usa `node:crypto`).
 */

/** Gera um token aleatório opaco (URL-safe) para colocar no link do e-mail. */
export function generateToken(): string {
  // randomUUID() e randomBytes() são ambos CSPRNG; combinamos os dois para um
  // token opaco longo (~32 + 48 hex chars), impraticável de adivinhar.
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomBytes(24).toString("hex");
}

/** Hash determinístico (sha-256 hex) do token — é isto que persistimos. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
