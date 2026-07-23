import { redis } from "@/server/cache/redis";

export interface RateLimitResult {
  ok: boolean;
  /** quantas requisições ainda cabem na janela atual */
  remaining: number;
}

/**
 * Rate limit por chave (ex.: conta) com JANELA FIXA via Redis (INCR + EXPIRE).
 * Janela fixa é uma aproximação simples da deslizante — suficiente para proteger
 * rotas de trabalho pesado (disparo em massa) de abuso/clique-frenético.
 *
 * Degradação: SEM Redis nunca bloqueia (`ok: true`) — em dev/local não há limite.
 * Falha do Redis também libera (rate limit é proteção, não pode derrubar a rota).
 *
 * @param key      identificador (será prefixado com `rl:`)
 * @param limit    máximo de requisições permitidas na janela
 * @param windowSec tamanho da janela em segundos
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  if (!redis) return { ok: true, remaining: limit };
  try {
    // Bucket por janela: a chave inclui o índice da janela atual, então expira
    // naturalmente e a contagem reinicia a cada `windowSec`.
    const bucket = Math.floor(Date.now() / 1000 / windowSec);
    const rkey = `rl:${key}:${bucket}`;
    const count = await redis.incr(rkey);
    if (count === 1) await redis.expire(rkey, windowSec);
    return { ok: count <= limit, remaining: Math.max(0, limit - count) };
  } catch {
    return { ok: true, remaining: limit };
  }
}
