import Redis from "ioredis";

/**
 * Singleton do cliente Redis (mesmo padrão do PrismaClient: guarda no globalThis
 * para o hot-reload do dev não abrir conexões demais).
 *
 * `redis` é `null` quando não há `REDIS_URL` — nesse caso os helpers de cache
 * degradam para "sem cache" (vão direto à fonte). Isso mantém dev/local e os
 * testes funcionando sem um Redis de pé.
 */
const g = globalThis as unknown as { redis?: Redis | null };

export const redis: Redis | null =
  g.redis ??
  (process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, {
        // Não derruba o processo se o Redis estiver fora no boot; reconecta sozinho.
        maxRetriesPerRequest: 2,
        lazyConnect: false,
      })
    : null);

// CRÍTICO: sem um listener de 'error', uma queda de conexão do ioredis vira
// "Unhandled error event" e DERRUBA o processo (web/worker). Aqui só logamos e
// deixamos o ioredis reconectar sozinho — o cache/SSE degradam até voltar.
redis?.on("error", (err) => {
  console.error("[redis] erro de conexão:", err?.message ?? err);
});

if (process.env.NODE_ENV !== "production") g.redis = redis;
