import { getTenantContext } from "@/lib/tenant";
import { redis } from "@/server/cache/redis";
import { tenantChannel } from "@/server/events/bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE (Server-Sent Events) por conta: o front abre uma conexão e recebe eventos
 * de mudança (novas mensagens, movimentação de lead) em vez de fazer polling
 * agressivo. Assina o canal Redis pub/sub da conta logada.
 *
 * Sem Redis → 503: o front degrada para o polling de fallback (30s). Heartbeat
 * a cada 25s mantém a conexão viva através de proxies (Railway).
 */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return new Response("unauthorized", { status: 401 });
  if (!redis) return new Response("realtime indisponível", { status: 503 });

  const channel = tenantChannel(ctx.tenantUserId);
  // Conexão dedicada de subscribe: no ioredis um cliente em modo subscribe não
  // pode rodar comandos normais, então duplicamos o cliente principal.
  const sub = redis.duplicate();
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // controller já fechado (cliente desconectou)
        }
      };
      sub.on("message", (_ch, msg) => safeEnqueue(`data: ${msg}\n\n`));
      await sub.subscribe(channel);
      safeEnqueue(": conectado\n\n"); // comentário SSE: abre o stream
      heartbeat = setInterval(() => safeEnqueue(": ping\n\n"), 25_000);
    },
    async cancel() {
      if (heartbeat) clearInterval(heartbeat);
      try {
        await sub.unsubscribe(channel);
      } catch {
        // ignora
      }
      sub.disconnect();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // desativa o buffering do nginx/proxy p/ o stream fluir em tempo real
      "X-Accel-Buffering": "no",
    },
  });
}
