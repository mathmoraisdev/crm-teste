/**
 * Autenticação do dashboard — sessão por cookie assinado (HMAC-SHA256).
 *
 * Este módulo é **Edge-safe**: usa apenas Web Crypto / TextEncoder / btoa-atob,
 * sem `node:*`. Por isso pode ser importado tanto no `middleware.ts` (Edge runtime)
 * quanto nas rotas de API (Node runtime).
 *
 * Login é único e vem de variáveis de ambiente (não há tabela de usuários):
 *   AUTH_USER       — nome de usuário
 *   AUTH_PASSWORD   — senha
 *   SESSION_SECRET  — segredo aleatório que assina o cookie de sessão
 *
 * Se as três não estiverem setadas, a autenticação fica DESLIGADA (app aberto,
 * útil em dev local). Em produção/Vercel, setar as três liga a proteção.
 */

export const SESSION_COOKIE = "crm_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 dias

/** Auth só é exigida quando as três variáveis estão configuradas. */
export function isAuthEnabled(): boolean {
  return Boolean(
    process.env.AUTH_USER &&
      process.env.AUTH_PASSWORD &&
      process.env.SESSION_SECRET,
  );
}

/** Credenciais esperadas (lidas direto do ambiente). */
export function getExpectedCredentials(): { user: string; pass: string } {
  return {
    user: process.env.AUTH_USER ?? "",
    pass: process.env.AUTH_PASSWORD ?? "",
  };
}

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET não configurado");
  return s;
}

const encoder = new TextEncoder();

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmac(data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return new Uint8Array(sig);
}

/** Comparação de strings em tempo ~constante (evita timing attack na assinatura). */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Gera o token de sessão assinado para um usuário. */
export async function signSession(username: string): Promise<string> {
  const payload = { u: username, exp: nowSeconds() + SESSION_TTL_SECONDS };
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const sig = bytesToBase64Url(await hmac(body));
  return `${body}.${sig}`;
}

/** Valida o token; retorna o payload ou `null` se inválido/expirado. */
export async function verifySession(
  token: string | undefined | null,
): Promise<{ u: string } | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = bytesToBase64Url(await hmac(body));
  if (!timingSafeEqualStr(sig, expected)) return null;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(body)),
    ) as { u: string; exp: number };
    if (!payload.exp || payload.exp < nowSeconds()) return null;
    return { u: payload.u };
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE = SESSION_TTL_SECONDS;
