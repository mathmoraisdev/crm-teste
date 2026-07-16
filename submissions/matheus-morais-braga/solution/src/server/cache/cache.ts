import { redis } from "./redis";

/**
 * Lê do cache ou calcula e grava (cache-aside). Sem Redis (`redis === null`),
 * degrada para chamar a fonte direto — nunca quebra por falta de cache.
 *
 * `ttlSec` é o tempo de vida da chave. Em erro de leitura/escrita no Redis,
 * também cai para a fonte (cache é otimização, não fonte de verdade).
 */
export async function cached<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  if (!redis) return fn();
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    return fn(); // Redis indisponível: serve da fonte.
  }
  const val = await fn();
  try {
    await redis.set(key, JSON.stringify(val), "EX", ttlSec);
  } catch {
    // falha ao gravar não invalida o resultado já calculado
  }
  return val;
}

/** Remove chaves do cache (no-op sem Redis). Use após escritas que as invalidam. */
export async function invalidate(...keys: string[]): Promise<void> {
  if (redis && keys.length) {
    try {
      await redis.del(...keys);
    } catch {
      // invalidação best-effort; o TTL garante a consistência eventual
    }
  }
}

/**
 * Apaga todas as chaves que começam com `prefix` (ex.: variantes por operador de
 * uma mesma conta). Usa SCAN (não-bloqueante, ao contrário de KEYS) em lotes.
 * No-op sem Redis. Best-effort: qualquer falha cai no TTL.
 */
export async function invalidatePrefix(prefix: string): Promise<void> {
  if (!redis) return;
  try {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  } catch {
    // best-effort; o TTL garante consistência eventual
  }
}
