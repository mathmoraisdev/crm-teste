import { redis } from "@/server/cache/redis";

/** Evento empurrado a uma conta via SSE. `type` orienta a revalidação no front. */
export interface TenantEvent {
  type: "tenant:changed" | "conversation:changed";
  /** lead afetado (quando aplicável) — permite revalidação dirigida. */
  leadId?: string;
}

/** Canal pub/sub por conta. Um assinante SSE por sessão escuta o seu. */
export function tenantChannel(tenantUserId: string): string {
  return `tenant:${tenantUserId}`;
}

/**
 * Publica um evento para todas as abas/sessões da conta (SSE). No-op sem Redis
 * (degrada para o polling de fallback do front). Best-effort: falha de publish
 * nunca quebra a mutação que a originou.
 */
export async function publishTenantEvent(
  tenantUserId: string,
  event: TenantEvent,
): Promise<void> {
  if (!redis) return;
  try {
    await redis.publish(tenantChannel(tenantUserId), JSON.stringify(event));
  } catch {
    // sem realtime neste tick; o polling de 30s cobre
  }
}
