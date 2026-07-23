import { getTenantContext } from "@/lib/tenant";
import { redis } from "@/server/cache/redis";
import { subscribeTenant } from "@/server/events/subscriber";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE (Server-Sent Events) por conta: o front abre uma conexão e recebe eventos
 * de mudança (novas mensagens, movimentação de lead) em vez de fazer polling
 * agressivo.
 *
 * Multiplexado: TODAS as conexões/abas compartilham UMA conexão de subscribe no
 * Redis (ver server/events/subscriber.ts) — abrir muitas abas não multiplica
 * conexões no provedor. Sem Redis → 503 e o front cai no polling de fallback.
 * Heartbeat a cada 25s mantém a conexão viva através de proxies (Railway).
 */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return new Response("unauthorized", { status: 401 });
  if (!redis) return new Response("realtime indisponível", { status: 503 });

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // controller já fechado (cliente desconectou)
        }
      };
      unsubscribe = subscribeTenant(ctx.tenantUserId, (msg) => safeEnqueue(`data: ${msg}\n\n`));
      safeEnqueue(": conectado\n\n"); // comentário SSE: abre o stream
      heartbeat = setInterval(() => safeEnqueue(": ping\n\n"), 25_000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
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
